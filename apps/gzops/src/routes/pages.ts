import type { FastifyInstance } from 'fastify';
import { requireAuth, requirePermission } from '../auth/plugin.js';
import { platform, channelLabel, type DeployConfigInput } from '../platform/client.js';
import { ENVS, type Env, type Project, type KitReleaseRow } from '../platform/types.js';
import { programs as programsTable } from '../store/repo.js';
import type { Program } from '../store/types.js';
import { chrome } from '../views/chrome.js';
import { programHealth } from '../views/helpers.js';
import { resolveReleaseRepos } from './programs.js';

const PAGE_SIZE = 6;
/** BUILDS-tab artifact rows per page (HTMX load-more appends the next batch). */
const ARTIFACT_PAGE = 20;

/** Suggest the next kit version: patch-bump the highest existing release version. */
function nextKitVersion(versions: string[]): string {
  const parse = (v: string): number[] => v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const cmp = (a: number[], b: number[]): number => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
  let best: number[] | null = null;
  for (const v of versions) {
    const p = [...parse(v), 0, 0, 0].slice(0, 3);
    if (!best || cmp(p, best) > 0) best = p;
  }
  return best ? `${best[0]}.${best[1]}.${best[2] + 1}` : '1.0.0';
}

/** Count "current" deploy failures: group by project × env × channel (pipeline) and
 *  count only groups whose MOST-RECENT deploy failed — a later success to the same
 *  target clears the failure (so the badge doesn't stay red forever). */
function currentFailureCount(
  deployments: { projectId: string; env: string; pipeline: string; status: string; at: string }[],
): number {
  const latest = new Map<string, { status: string; at: string }>();
  for (const d of deployments) {
    const key = `${d.projectId}|${d.env}|${d.pipeline}`;
    const cur = latest.get(key);
    if (!cur || d.at > cur.at) latest.set(key, { status: d.status, at: d.at });
  }
  let n = 0;
  for (const d of latest.values()) if (d.status === 'failed') n++;
  return n;
}

const byId = (projects: Project[]): Record<string, Project> =>
  Object.fromEntries(projects.map((p) => [p.id, p]));

/**
 * Firmware-kit Components rail enrichment. A kit's components live in its
 * deploy-config schema (kit.components), not on the project record — so map them
 * onto each kit project's `.components` and fetch the referenced node projects
 * (with live per-env state) so the component matrix renders real versions instead
 * of "0 nodes". Returns the node projects to merge into projectsById. Shared by
 * the project detail page and the program dashboard (both render the matrix).
 */
async function enrichKitComponents(kitProjects: Project[]): Promise<Project[]> {
  const nodeIds = new Set<string>();
  for (const project of kitProjects) {
    if (project.type !== 'firmware-kit') continue;
    const dc = await platform.getDeployConfig(project.id).catch(() => null);
    project.components = (dc?.kit?.components ?? [])
      .filter((c) => c.project)
      .map((c) => ({ label: c.name || c.project, projectId: c.project }));
    for (const c of project.components) nodeIds.add(c.projectId);
  }
  return nodeIds.size ? platform.getProjectsByIds([...nodeIds], { withState: true }) : [];
}

/**
 * Reverse of enrichKitComponents: which firmware-kit(s) include this node project
 * as a component. firmware-node projects don't deploy standalone (Phase 4) — they
 * ship via a kit — so their page surfaces the kits that carry them.
 */
async function kitsIncluding(nodeProjectId: string): Promise<{ id: string; name: string }[]> {
  const kits = (await platform.listProjects()).filter((p) => p.type === 'firmware-kit');
  const out: { id: string; name: string }[] = [];
  for (const k of kits) {
    const dc = await platform.getDeployConfig(k.id).catch(() => null);
    if ((dc?.kit?.components ?? []).some((c) => c.project === nodeProjectId)) out.push({ id: k.id, name: k.name });
  }
  return out;
}

/** Compact a /health gzopsHash for a tile: short hash, or the date when it's a
 *  `local-<unix>` fallback (no gzops hash was computed for that deploy). */
function formatHash(h?: string): string {
  if (!h) return '';
  if (h.startsWith('local-')) {
    const ts = Number(h.slice(6));
    return Number.isFinite(ts) && ts > 0 ? `ts ${new Date(ts * 1000).toISOString().slice(0, 10)}` : 'no hash';
  }
  return h.slice(0, 8);
}

interface ProgramCard {
  id: string;
  name: string;
  description: string;
  status: Program['status'];
  chips: { name: string }[];
  health: { failed: number; deploying: number };
}

function buildCards(progs: Program[], projects: Record<string, Project>): ProgramCard[] {
  return progs.map((pr) => ({
    id: pr.id,
    name: pr.name,
    description: pr.description,
    status: pr.status,
    chips: pr.sections.map((s) => ({ name: projects[s.projectId]?.name ?? s.projectId })),
    health: programHealth(pr.sections, projects),
  }));
}

/** Shared filtering for the dashboard overview (full page + HTMX search). */
async function overviewData(query: { q?: string; status?: string; page?: string }, canEdit: boolean) {
  const allPrograms = await programsTable().list();
  // Only the projects referenced by programs appear on the overview — enrich
  // just those (live env-state) instead of fanning out for every platform project.
  const memberIds = [...new Set(allPrograms.flatMap((pr) => pr.sections.map((s) => s.projectId)))];
  const projects = await platform.getProjectsByIds(memberIds, { withState: true });
  const projById = byId(projects);

  const q = (query.q ?? '').toLowerCase();
  const statusFilter = query.status ?? 'all';
  const page = Math.max(1, parseInt(query.page ?? '1', 10));

  let progs = allPrograms.filter((pr) => canEdit || pr.status === 'published');
  if (statusFilter !== 'all') progs = progs.filter((pr) => pr.status === statusFilter);
  if (q) progs = progs.filter((pr) => pr.name.toLowerCase().includes(q) || (pr.description ?? '').toLowerCase().includes(q));
  progs.sort((a, b) => a.name.localeCompare(b.name));

  const pages = Math.max(1, Math.ceil(progs.length / PAGE_SIZE));
  const pageItems = progs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Portfolio-wide alerts mapped to programs (published only).
  const alerts: { prId: string; prName: string; cls: string; text: string; detail: string }[] = [];
  for (const pr of allPrograms.filter((p) => p.status === 'published')) {
    for (const i of programHealth(pr.sections, projById).issues) {
      if (!alerts.some((a) => a.text === i.text)) alerts.push({ ...i, prId: pr.id, prName: pr.name });
    }
  }

  return {
    cards: buildCards(pageItems, projById),
    total: progs.length,
    alerts,
    q: query.q ?? '',
    statusFilter,
    page,
    pages,
    canEdit,
  };
}

export async function pageRoutes(app: FastifyInstance): Promise<void> {
  // ── Dashboard area ──────────────────────────────────────
  app.get<{ Querystring: { q?: string; status?: string; page?: string } }>('/', { preHandler: requireAuth }, async (request, reply) => {
    const canEdit = request.user!.permissions.includes('programs:write');
    return reply.view('dashboard.eta', {
      ...(await chrome(request, 'dashboard', 'overview')),
      ...(await overviewData(request.query, canEdit)),
    });
  });

  app.get<{ Querystring: { q?: string; status?: string; page?: string } }>('/dashboard/search', { preHandler: requireAuth }, async (request, reply) => {
    const canEdit = request.user!.permissions.includes('programs:write');
    return reply.view('partials/program-cards.eta', await overviewData(request.query, canEdit));
  });

  app.get<{ Params: { id: string } }>('/dashboard/:id', { preHandler: requireAuth }, async (request, reply) => {
    const program = await programsTable().get(request.params.id);
    if (!program) return reply.code(404).view('not-found.eta', { ...(await chrome(request, 'dashboard', '')), title: 'Not found', what: 'Program' });
    const memberIds = [...new Set(program.sections.map((sec) => sec.projectId))];
    const [projects, deployments] = await Promise.all([
      platform.getProjectsByIds(memberIds, { withState: true }),
      platform.listDeploymentsAcross(memberIds),
    ]);
    // Enrich kit projects so the program's Components matrix renders (it pulls
    // node versions from projectsById, same as the project detail page).
    const componentProjects = await enrichKitComponents(projects.filter((p) => p.type === 'firmware-kit'));
    const allProjects = [...projects, ...componentProjects];
    const projById = byId(allProjects);
    const { memberRepos, releaseRepo } = await resolveReleaseRepos(program, allProjects);
    return reply.view('program-dashboard.eta', {
      ...(await chrome(request, 'dashboard', program.id)),
      title: program.name,
      program,
      projectsById: projById,
      deployments,
      memberRepos,
      releaseRepo,
      health: programHealth(program.sections, projById),
      inflight: deployments.filter((d) => d.status === 'in_progress').length,
      // A failure is "current" only if it's the latest deploy for that
      // project × env × channel — a later success to the same target clears it.
      failures: currentFailureCount(deployments),
      canEdit: request.user!.permissions.includes('programs:write'),
    });
  });

  // ── CI/CD area ──────────────────────────────────────────
  app.get('/cicd/programs', { preHandler: requireAuth }, async (request, reply) => {
    const programs = (await programsTable().list()).sort((a, b) => a.name.localeCompare(b.name));
    return reply.view('programs.eta', {
      ...(await chrome(request, 'cicd', 'programs')),
      title: 'Programs',
      programs,
      canEdit: request.user!.permissions.includes('programs:write'),
    });
  });

  app.get<{ Querystring: { q?: string; type?: string } }>('/cicd/projects', { preHandler: requireAuth }, async (request, reply) => {
    return reply.view('projects.eta', {
      ...(await chrome(request, 'cicd', 'projects')),
      title: 'Projects',
      ...(await projectsData(request.query)),
    });
  });

  app.get<{ Querystring: { q?: string; type?: string } }>('/cicd/projects/search', { preHandler: requireAuth }, async (request, reply) => {
    return reply.view('partials/project-rows.eta', await projectsData(request.query));
  });

  app.get<{ Params: { id: string }; Querystring: { tab?: string; edit?: string; warn?: string } }>('/cicd/projects/:id', { preHandler: requireAuth }, async (request, reply) => {
    const [project, deployments] = await Promise.all([
      platform.getProject(request.params.id),
      platform.listDeployments({ projectId: request.params.id }),
    ]);
    if (!project) return reply.code(404).view('not-found.eta', { ...(await chrome(request, 'cicd', 'projects')), title: 'Not found', what: 'Project' });
    const tab = ['builds', 'config'].includes(request.query.tab ?? '') ? request.query.tab! : 'deployment';
    // Firmware-kit Components rail — populate kit.components + their node projects.
    const componentProjects = project.type === 'firmware-kit' && tab === 'deployment'
      ? await enrichKitComponents([project])
      : [];
    // firmware-node pages show which kit(s) carry this node (no standalone deploy).
    const includingKits = project.type === 'firmware-node' && tab === 'deployment'
      ? await kitsIncluding(project.id)
      : [];
    // The component matrix references this project plus its component node
    // projects (enriched with env-state) so each row shows its deployed versions.
    const projects = [project, ...componentProjects];
    const latestByEnv: Partial<Record<Env, string>> = {};
    for (const e of ENVS) {
      const d = deployments.find((x) => x.env === e);
      if (d) latestByEnv[e] = d.id;
    }
    // For the firmware-kit channel rail, each tile must link to the latest
    // deployment of THAT channel+env — not just the env's latest (which would send
    // every channel to the same record). Key by channelLabel(pipeline) so it lines
    // up with project.channels. deployments are newest-first → first match wins.
    const latestByChannelEnv: Record<string, Partial<Record<Env, string>>> = {};
    // Per-channel metadata the cell menu needs, keyed by the SAME display label as
    // project.channels: the raw pipeline `key` (what the platform matches on — the
    // label is lossy) and whether it's a `versioned` channel (path_template carries
    // {version} → Un-publish deletes a version; a fixed pointer offers Revert only).
    const channelMeta: Record<string, { key: string; versioned: boolean }> = {};
    // The Kits & Releases matrix marks a slot "v ✓" ONLY when this row's version is the
    // one CURRENTLY live there (env-state truth), not merely ever-deployed (history).
    // channelLive[pipelineName][env] = the version currently deployed there (or absent).
    const channelLive: Record<string, Partial<Record<Env, string>>> = {};
    if (project.type === 'firmware-kit') {
      for (const d of deployments) {
        const ch = channelLabel(d.pipeline);
        const m = (latestByChannelEnv[ch] ??= {});
        if (!m[d.env]) m[d.env] = d.id;
      }
      const kitDc = await platform.getDeployConfig(project.id).catch(() => null);
      for (const p of kitDc?.deploy_pipelines ?? []) {
        if (p.plugin !== 'firmware-kit-deploy') continue;
        const tmpl = (p.config as { path_template?: string } | undefined)?.path_template ?? '';
        channelMeta[channelLabel(p.name)] = { key: p.name, versioned: tmpl.includes('{version}') };
        // project.channels (live env-state) is keyed by the display label.
        const rail = project.channels?.[channelLabel(p.name)];
        if (rail) {
          const live: Partial<Record<Env, string>> = {};
          for (const e of ENVS) { const v = rail[e]?.v; if (v && v !== '—') live[e] = v; }
          channelLive[p.name] = live;
        }
      }
    }
    // Firmware-kit RELEASES tab: a kit version isn't a compiled build — it's a
    // composed release. Group the kit's deployments by version (newest-first) into
    // one release per version: the component versions it bundles + which
    // channels/envs it reached (each cell links to that deployment).
    const kitReleases: KitReleaseRow[] = [];
    if (project.type === 'firmware-kit' && tab === 'builds') {
      // A CI kit-bundle (.zip) may exist per version — offer it as a download.
      // Version locks carry the GitHub Release published on first non-dev deploy.
      const [artifacts, locks, kitDc] = await Promise.all([
        platform.listArtifacts(project),
        platform.listVersionLocks(project.id),
        platform.getDeployConfig(project.id).catch(() => null),
      ]);
      // Every configured firmware-kit channel — shown as a matrix row even where the
      // kit was never deployed, so any channel is selectable to deploy to.
      const allChannelKeys = (kitDc?.deploy_pipelines ?? [])
        .filter((p) => p.plugin === 'firmware-kit-deploy')
        .map((p) => p.name);
      const bundles = new Map<string, { hashId: string; artifactId: string; name: string }>();
      for (const a of artifacts) {
        if (a.kind?.toLowerCase() === 'zip' && a.version && a.hashId && a.artifactId && !bundles.has(a.version)) {
          bundles.set(a.version, { hashId: a.hashId, artifactId: a.artifactId, name: a.name });
        }
      }
      const releaseByVersion = new Map(locks.map((l) => [l.version, l]));
      const order: string[] = [];
      const map: Record<string, { version: string; at: string; comps?: Record<string, string>; channels: Record<string, Partial<Record<Env, string>>> }> = {};
      for (const d of deployments) {
        if (!map[d.version]) { map[d.version] = { version: d.version, at: d.at, channels: {} }; order.push(d.version); }
        const r = map[d.version];
        // Key channels by the raw pipeline name (the deploy target the basket fires);
        // channelLabel() is applied only for display.
        const ch = d.pipeline;
        (r.channels[ch] ??= {});
        if (!r.channels[ch][d.env]) r.channels[ch][d.env] = d.id;
        if (!r.comps && d.componentVersions) r.comps = d.componentVersions;
      }
      for (const v of order) {
        const r = map[v];
        const lock = releaseByVersion.get(r.version);
        // A version is a cut Release only once its lock is PUBLISHED. No lock, or a
        // failed/pending publish, stays a Dev Kit (draft) — failed cuts get retried
        // from the Drafts list rather than masquerading as a Release.
        const cut = lock?.publish_status === 'published';
        let cutFromDeploymentId: string | undefined;
        for (const cells of Object.values(r.channels)) { if (cells.dev) { cutFromDeploymentId = cells.dev; break; } }
        // Union of configured channels + any with deployments → every channel is a row.
        const channelKeys = [...new Set([...allChannelKeys, ...Object.keys(r.channels)])];
        kitReleases.push({
          version: r.version,
          at: r.at,
          isDraft: !cut,
          cutFromDeploymentId,
          components: Object.entries(r.comps ?? lock?.component_versions ?? {}).map(([name, version]) => ({ name, version })),
          channels: channelKeys.map((key) => ({ name: channelLabel(key), key, cells: r.channels[key] ?? {} })),
          bundle: bundles.get(r.version),
          release: lock ? { url: lock.github?.release_url, status: lock.publish_status, notesShort: lock.release_notes?.short } : undefined,
          componentReleases: lock?.component_releases,
          imported: lock?.source === 'github',
          prerelease: lock?.github?.prerelease === true,
        });
      }
      // Imported / lock-only releases — pre-existing GitHub releases brought in by
      // sync have no deployment rows, so add them here (Releases group, every channel
      // selectable, no gzops composition until a cut "enriches" them).
      const seenVersions = new Set(order);
      for (const lock of locks) {
        if (seenVersions.has(lock.version)) continue;
        const cut = lock.publish_status === 'published';
        kitReleases.push({
          version: lock.version,
          at: lock.locked_at || '',
          isDraft: !cut,
          components: Object.entries(lock.component_versions ?? {}).map(([name, version]) => ({ name, version })),
          channels: allChannelKeys.map((key) => ({ name: channelLabel(key), key, cells: {} })),
          release: { url: lock.github?.release_url, status: lock.publish_status, notesShort: lock.release_notes?.short },
          componentReleases: lock.component_releases,
          imported: lock.source === 'github',
          prerelease: lock.github?.prerelease === true,
        });
      }
      // Order every row by real date descending (deployment date, or the imported
      // release's created_at). Version sort would be wrong here — the kit repo's
      // version scheme reset (old v5.x from 2023 outranks the current v1.x), so a
      // version sort floats ancient releases to the top and looks like a gap.
      kitReleases.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    }

    // BUILDS artifacts (non-kit) and deploy-config (CONFIG tab) are fetched lazily.
    const allArtifacts = tab === 'builds' && project.type !== 'firmware-kit' ? await platform.listArtifacts(project) : [];
    // Deploy-config versioning is retained in the backend but no longer surfaced
    // in the UI — load only the active config for the CONFIG tab.
    const deployConfig = tab === 'config' ? await platform.getDeployConfig(project.id) : null;
    const canEditConfig = request.user!.permissions.includes('deploy-config:write');
    const editing = tab === 'config' && request.query.edit === '1' && canEditConfig;
    return reply.view('project-detail.eta', {
      ...(await chrome(request, 'cicd', 'projects')),
      title: project.name,
      project,
      projectsById: byId(projects),
      deployments,
      latestByEnv,
      latestByChannelEnv,
      channelMeta,
      channelLive,
      includingKits,
      kitReleases,
      artifacts: allArtifacts.slice(0, ARTIFACT_PAGE),
      artifactTotal: allArtifacts.length,
      artifactNextOffset: allArtifacts.length > ARTIFACT_PAGE ? ARTIFACT_PAGE : null,
      tab,
      warn: request.query.warn || null,
      deployConfig,
      editing,
      deployConfigJson: deployConfig ? JSON.stringify(deployConfig) : '{}',
      // Every firmware-node project is selectable as a kit component source. Sourced
      // from the full project list (cached) — NOT `projects`, which here is just the
      // kit + its current components and would leave the editor dropdown empty.
      // `hasOta` = the project declares a role='deployable' (OTA image) artifact, so
      // the kit editor can warn when a chosen component can't actually be deployed.
      nodeProjectsJson: JSON.stringify(
        project.type === 'firmware-kit'
          ? await Promise.all(
              (await platform.listProjects())
                .filter((p) => p.type === 'firmware-node')
                .map(async (p) => {
                  const dc = await platform.getDeployConfig(p.id).catch(() => null);
                  const hasOta = (dc?.artifacts ?? []).some((a) => a.role === 'deployable');
                  return { id: p.id, name: p.name, hasOta };
                }),
            )
          : [],
      ),
      canDeploy: request.user!.permissions.includes('deploys:create'),
      isAdmin: request.user!.role === 'admin',
      canEditConfig,
    });
  });

  // HTMX "load more" for the BUILDS artifact list — returns the next page of rows
  // plus a fresh load-more button (which swaps itself out when the list is exhausted).
  app.get<{ Params: { id: string }; Querystring: { offset?: string } }>(
    '/cicd/projects/:id/artifacts',
    { preHandler: requireAuth },
    async (request, reply) => {
      const project = await platform.getProject(request.params.id);
      if (!project) return reply.code(404).send('');
      const offset = Math.max(0, parseInt(request.query.offset ?? '0', 10) || 0);
      const all = await platform.listArtifacts(project);
      const page = all.slice(offset, offset + ARTIFACT_PAGE);
      const nextOffset = offset + ARTIFACT_PAGE < all.length ? offset + ARTIFACT_PAGE : null;
      return reply.view('partials/artifact-rows.eta', {
        artifacts: page,
        project,
        artifactNextOffset: nextOffset,
        canDeploy: request.user!.permissions.includes('deploys:create'),
      });
    },
  );

  // Save a new deploy-config version (Lit editor POSTs JSON here).
  app.post<{ Params: { id: string }; Body: DeployConfigInput }>(
    '/cicd/projects/:id/config',
    { preHandler: requirePermission('deploy-config:write') },
    async (request, reply) => {
      const b = request.body;
      if (!Array.isArray(b?.environments) || !Array.isArray(b?.deploy_pipelines)) {
        return reply.code(400).send({ error: 'environments and deploy_pipelines are required arrays' });
      }
      const saved = await platform.saveDeployConfig(request.params.id, {
        environments: b.environments,
        deploy_pipelines: b.deploy_pipelines,
        artifacts: Array.isArray(b.artifacts) ? b.artifacts : [],
        kit: b.kit,
        health_check: b.health_check,
        note: b.note,
        author: request.user!.email, // BFF did the deploy-config:write RBAC; attribute the user
        source: 'webapp',
      });
      return reply.send({ ok: true, version: saved.version });
    },
  );

  // ── Create Release (firmware-kit) — preview-only for now (phase 3b) ──
  app.get<{ Params: { id: string } }>(
    '/cicd/projects/:id/release/new',
    { preHandler: requirePermission('deploys:create') },
    async (request, reply) => {
      const project = await platform.getProject(request.params.id);
      if (!project) return reply.code(404).view('not-found.eta', { ...(await chrome(request, 'cicd', 'projects')), title: 'Not found', what: 'Project' });
      if (project.type !== 'firmware-kit') return reply.redirect(`/cicd/projects/${project.id}`);
      const dc = await platform.getDeployConfig(project.id);
      const kit = dc.kit ?? { host_ids: [], components: [], releases: [] };
      // Available built versions per component, fetched in parallel.
      const components = await Promise.all(
        (kit.components ?? []).map(async (c) => ({
          name: c.name,
          set: c.set ?? 'iNode',
          slots: c.slots ?? [],
          project: c.project,
          artifact: c.artifact,
          versions: c.project ? await platform.availableVersions(c.project, c.artifact) : [],
        })),
      );
      const suggested = nextKitVersion((kit.releases ?? []).map((r) => r.version ?? '').filter(Boolean));
      return reply.view('release-new.eta', {
        ...(await chrome(request, 'cicd', 'projects')),
        title: `New release — ${project.name}`,
        project,
        hostIdsJson: JSON.stringify(kit.host_ids ?? []),
        componentsJson: JSON.stringify(components),
        suggested,
      });
    },
  );

  // BFF proxy for the live preview (read-only — expands a selection to manifests).
  app.post<{ Params: { id: string }; Body: { versions?: Record<string, string>; hostIds?: string[] } }>(
    '/cicd/projects/:id/release/preview',
    { preHandler: requirePermission('deploys:create') },
    async (request, reply) => {
      const preview = await platform.previewKitRelease(request.params.id, {
        versions: request.body?.versions ?? {},
        hostIds: request.body?.hostIds,
      });
      return reply.send(preview);
    },
  );

  // BFF proxy for the submit — copies component binaries, gates readiness, and
  // publishes per-host manifests across the chosen channels (one deployment per
  // channel). The user is attributed via their authenticated email.
  app.post<{ Params: { id: string }; Body: { versions?: Record<string, string>; hostIds?: string[]; channels?: string[]; environment?: string; kit_version?: string } }>(
    '/cicd/projects/:id/release/submit',
    { preHandler: requirePermission('deploys:create') },
    async (request, reply) => {
      const b = request.body ?? {};
      if (!b.environment) return reply.code(400).send({ error: 'environment is required' });
      if (!b.kit_version) return reply.code(400).send({ error: 'kit_version is required' });
      if (!b.channels?.length) return reply.code(400).send({ error: 'at least one channel is required' });
      try {
        const result = await platform.createKitRelease(request.params.id, {
          versions: b.versions ?? {},
          hostIds: b.hostIds,
          channels: b.channels,
          environment: b.environment,
          kit_version: b.kit_version,
          by: request.user!.email,
        });
        return reply.send(result);
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'Release failed' });
      }
    },
  );

  // BFF proxy for Cut Release (two-object model) — freeze a dev kit into an
  // immutable, GitHub-tagged release. HTMX posts the dev deployment to cut from;
  // on success we redirect back to Kits & Releases (the draft is now a release).
  app.post<{ Params: { id: string }; Body: { deployment_id?: string; version?: string } }>(
    '/cicd/projects/:id/cut-release',
    { preHandler: requirePermission('deploys:create') },
    async (request, reply) => {
      const escHtml = (s: string): string => s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));
      // 200 (not 5xx) so HTMX swaps the message into the target — a cut/enrich that
      // can't proceed is a readable outcome, not a server fault.
      const fail = (msg: string): unknown => reply.type('text/html').send(`<div class="small" style="color:var(--red);">Cut failed: ${escHtml(msg)}</div>`);
      // deployment_id cuts a dev kit; version enriches an imported release (no deployment).
      const deploymentId = request.body?.deployment_id;
      const version = request.body?.version;
      if (!deploymentId && !version) return reply.code(400).type('text/html').send('<div class="small" style="color:var(--red);">No dev deployment to cut from — deploy to dev first.</div>');
      try {
        const result = await platform.cutRelease(request.params.id, { deploymentId, version, by: request.user!.email });
        if (result.publish_status === 'failed') return fail(result.publish_error || 'release publish error');
        // A redirect's response body is never shown (htmx navigates away), so a
        // partial failure (e.g. a component release that couldn't be tagged) must ride
        // along as a query param the next page renders as a visible banner — otherwise
        // it's silently lost behind the "success" navigation.
        const warnQs = result.warning ? `&warn=${encodeURIComponent(result.warning)}` : '';
        // Non-empty body + explicit content-type: an empty 200 gets malformed over
        // HTTP/2 by the Lambda-URL/CloudFront path, aborting the HX-Redirect.
        reply.header('HX-Redirect', `/cicd/projects/${request.params.id}?tab=builds${warnQs}`);
        return reply.type('text/html').send('<div class="small faint">Release cut…</div>');
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'error');
      }
    },
  );

  // BFF proxy for Un-publish (un-deploy): delete a versioned channel's manifests for
  // a given version (the platform refuses fixed-pointer channels — those revert via a
  // re-deploy). `channel` is the RAW pipeline name (not the display label). Baseline
  // deploys:create; beyond dev it's admin-only (prod un-publish is high-blast-radius).
  app.post<{ Params: { id: string }; Body: { channel?: string; version?: string; environment?: string } }>(
    '/cicd/projects/:id/undeploy',
    { preHandler: requirePermission('deploys:create') },
    async (request, reply) => {
      const channel = request.body?.channel;
      const version = request.body?.version;
      const env = request.body?.environment;
      if (!channel || !env) return reply.code(400).send({ error: 'channel and environment are required' });
      if (env !== 'dev' && request.user!.role !== 'admin') {
        return reply.code(403).send({ error: `Un-publishing from ${env} requires an admin role.` });
      }
      try {
        const result = await platform.undeploy(request.params.id, { channel, version, environment: env }, request.user!.email);
        return reply.send(result);
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'un-publish failed' });
      }
    },
  );

  // BFF proxy for Revert (versioned/app-release channels): delete every manifest ahead
  // of the target so the target becomes newest/live. `channel` is the RAW pipeline name.
  // Same gating as un-publish — admin-only beyond dev (destructive).
  app.post<{ Params: { id: string }; Body: { channel?: string; target_version?: string; environment?: string } }>(
    '/cicd/projects/:id/revert-channel',
    { preHandler: requirePermission('deploys:create') },
    async (request, reply) => {
      const channel = request.body?.channel;
      const target = request.body?.target_version;
      const env = request.body?.environment;
      if (!channel || !target || !env) return reply.code(400).send({ error: 'channel, target_version and environment are required' });
      if (env !== 'dev' && request.user!.role !== 'admin') {
        return reply.code(403).send({ error: `Reverting in ${env} requires an admin role.` });
      }
      try {
        const result = await platform.revertChannel(request.params.id, { channel, target_version: target, environment: env }, request.user!.email);
        return reply.send(result);
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'revert failed' });
      }
    },
  );

  // BFF proxy for Sync from GitHub — reconcile gzops version-locks with the repo's
  // actual GitHub Releases (import pre-existing ones; self-heal failed publishes).
  // Returns a small summary line + an HX-Refresh so the list reflects the new state.
  app.post<{ Params: { id: string } }>(
    '/cicd/projects/:id/sync-releases',
    { preHandler: requirePermission('deploys:create') },
    async (request, reply) => {
      const escHtml = (s: string): string => s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));
      try {
        const r = await platform.syncReleases(request.params.id);
        reply.header('HX-Refresh', 'true');
        return reply.type('text/html').send(`<span class="small faint">imported ${r.imported} · healed ${r.healed} · ${r.unchanged} unchanged</span>`);
      } catch (err) {
        return reply.code(502).type('text/html').send(`<span class="small" style="color:var(--red);">Sync failed: ${escHtml(err instanceof Error ? err.message : 'error')}</span>`);
      }
    },
  );

  // ── Deploy basket (cut release → env × channel) ──────────────────────────
  // The Releases coverage matrix stages empty cells as `target=<pipeline>|<env>`
  // checkboxes; review renders a confirmation (prod + warehouse warnings); submit
  // fires kit-release per env with the release's frozen component versions.
  const parseTargets = (raw: unknown): { key: string; env: string }[] => {
    const arr = Array.isArray(raw) ? raw : raw ? [raw as string] : [];
    return arr
      .map((t) => String(t).split('|'))
      .filter((p) => p.length === 2 && (ENVS as readonly string[]).includes(p[1]))
      .map(([key, env]) => ({ key, env }));
  };

  app.post<{ Params: { id: string }; Body: { kit_version?: string; versions?: string; target?: string | string[] } }>(
    '/cicd/projects/:id/kit-deploy/review',
    { preHandler: requirePermission('deploys:create') },
    async (request, reply) => {
      const b = request.body ?? {};
      const targets = parseTargets(b.target);
      // Live-rendered on every slot toggle: nothing selected → clear the section.
      if (!b.kit_version || targets.length === 0) return reply.type('text/html').send('');
      // "Deploy = make live": on a versioned channel (app-release), deploying a version
      // older than what's live there removes the newer ones. Flag those targets so the
      // review screen warns before confirm. Live version per channel×env comes from
      // env-state (enriched project.channels, keyed by label); versioned-ness from the
      // deploy-config path_template.
      const [proj, dc] = await Promise.all([
        platform.getProject(request.params.id),
        platform.getDeployConfig(request.params.id).catch(() => null),
      ]);
      const versionedByKey: Record<string, boolean> = {};
      for (const p of dc?.deploy_pipelines ?? []) {
        if (p.plugin === 'firmware-kit-deploy') versionedByKey[p.name] = ((p.config as { path_template?: string } | undefined)?.path_template ?? '').includes('{version}');
      }
      const cmpVer = (x: string, y: string): number => {
        const px = x.split('.').map((n) => parseInt(n, 10) || 0);
        const py = y.split('.').map((n) => parseInt(n, 10) || 0);
        for (let i = 0; i < Math.max(px.length, py.length); i++) { const d = (px[i] || 0) - (py[i] || 0); if (d) return d; }
        return 0;
      };
      const liveOf = (key: string, env: Env): string | undefined => proj?.channels?.[channelLabel(key)]?.[env]?.v;
      const rows = targets
        .map((t) => {
          const liveV = liveOf(t.key, t.env as Env);
          const removesLive = !!(versionedByKey[t.key] && liveV && liveV !== '—' && cmpVer(b.kit_version!, liveV) < 0);
          return { ...t, label: channelLabel(t.key), isProd: t.env === 'prod', isWarehouse: /warehouse/i.test(t.key), removesLive, liveV: removesLive ? liveV : null };
        })
        .sort((a, b2) => ENVS.indexOf(a.env as Env) - ENVS.indexOf(b2.env as Env));
      return reply.view('partials/kit-deploy-review.eta', {
        projectId: request.params.id,
        kitVersion: b.kit_version,
        versionsJson: b.versions ?? '{}',
        targets: rows,
        anyProd: rows.some((r) => r.isProd),
        anyWarehouse: rows.some((r) => r.isWarehouse),
        anyRemovesLive: rows.some((r) => r.removesLive),
      });
    },
  );

  app.post<{ Params: { id: string }; Body: { kit_version?: string; versions?: string; target?: string | string[] } }>(
    '/cicd/projects/:id/kit-deploy/submit',
    { preHandler: requirePermission('deploys:create') },
    async (request, reply) => {
      const escHtml = (s: string): string => s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));
      const b = request.body ?? {};
      const targets = parseTargets(b.target);
      if (!b.kit_version || targets.length === 0) return reply.code(400).type('text/html').send('<div class="small" style="color:var(--red);">Nothing to deploy.</div>');
      let versions: Record<string, string> = {};
      try { versions = JSON.parse(b.versions || '{}'); } catch { /* empty */ }
      // Group channels by env — kit-release takes one env + its channels per call.
      const byEnv = new Map<string, string[]>();
      for (const t of targets) { (byEnv.get(t.env) ?? byEnv.set(t.env, []).get(t.env)!).push(t.key); }
      const errors: string[] = [];
      for (const [env, channels] of byEnv) {
        try {
          await platform.createKitRelease(request.params.id, { versions, channels, environment: env, kit_version: b.kit_version, by: request.user!.email });
        } catch (err) {
          errors.push(`${env}: ${err instanceof Error ? err.message : 'failed'}`);
        }
      }
      // Return 200 (not 5xx) so HTMX swaps the message into #deploy-submit-msg — a
      // rejected deploy (e.g. a version with no recorded component versions) is a
      // user-facing validation outcome, not a server fault, and must be readable.
      if (errors.length) return reply.type('text/html').send(`<span style="color:var(--red);">Couldn’t deploy — ${escHtml(errors.join('; '))}</span>`);
      // HX-Redirect drives the client-side navigation. Send a NON-empty body with an
      // explicit content-type — an empty 200 body gets malformed over HTTP/2 by the
      // Lambda-URL/CloudFront path (ERR_HTTP2_PROTOCOL_ERROR), aborting the redirect.
      reply.header('HX-Redirect', `/cicd/projects/${request.params.id}?tab=builds`);
      return reply.type('text/html').send('<div class="small faint">Deploy started…</div>');
    },
  );

  app.get<{ Querystring: { env?: string } }>('/cicd/environments', { preHandler: requireAuth }, async (request, reply) => {
    const env = (ENVS as readonly string[]).includes(request.query.env ?? '') ? (request.query.env as Env) : 'beta';
    return reply.view('environments.eta', {
      ...(await chrome(request, 'cicd', 'environments')),
      title: 'Environments',
      env,
      rows: await platform.listEnvironment(env),
    });
  });

  // Lazy health panel for a cloud project — probes each env's /health server-side
  // (loaded via HTMX so the page paints first). Falls back to platform deploy
  // state when the project declares no health_check.
  app.get<{ Params: { projectId: string } }>('/cicd/health/:projectId', { preHandler: requireAuth }, async (request, reply) => {
    const id = request.params.projectId;
    const health = await platform.projectHealth(id);
    if (health) {
      const cells = health.map((h) => ({
        env: h.env,
        ok: h.ok,
        v: h.ok ? h.version ?? '—' : '—',
        meta: h.ok ? formatHash(h.gzopsHash) : h.error ?? `HTTP ${h.status}`,
      }));
      const down = health.filter((h) => !h.ok).map((h) => h.env);
      return reply.view('partials/health-panel.eta', { cells, configured: true, healthy: down.length === 0, down });
    }
    // No /health endpoint (firmware / mobile / kit): "healthy" means the most recent
    // CI/CD deploy to each env succeeded. A failed latest deploy marks that env down;
    // a later successful deploy to the same env clears it (the rail is current state).
    const p = await platform.getProject(id);
    const cells = ENVS.map((e) => {
      const c = p?.rail?.[e];
      const failed = c?.state === 'failed';
      return { env: e, ok: !!c && !failed, v: c?.v ?? '—', meta: failed ? 'last deploy failed' : (c?.age ?? '') };
    });
    const down = ENVS.filter((e) => p?.rail?.[e]?.state === 'failed');
    return reply.view('partials/health-panel.eta', { cells, configured: false, healthy: down.length === 0, down });
  });

  app.get<{ Querystring: { project?: string; env?: string; channel?: string; status?: string; q?: string } }>(
    '/cicd/deployments',
    { preHandler: requireAuth },
    async (request, reply) => {
      const f = {
        project: request.query.project?.trim() || '',
        env: request.query.env?.trim() || '',
        channel: request.query.channel?.trim() || '',
        status: request.query.status?.trim() || '',
        q: request.query.q?.trim() || '',
      };
      const projects = await platform.listProjects();
      const byProj = byId(projects);
      // Scope the fetch to one project when filtered (cheaper + deeper history); else
      // merge across all. Pull a generous window so the history view is useful.
      const all = f.project
        ? await platform.listDeployments({ projectId: f.project, limit: 250 })
        : await platform.listDeploymentsAcross(projects.map((p) => p.id), 250);
      // Facet options come from the pre-filter set so the dropdowns stay populated.
      const channelOptions = [...new Set(all.map((d) => d.pipeline).filter(Boolean))].sort();
      const statusOptions = [...new Set(all.map((d) => d.status).filter(Boolean))].sort();
      const ql = f.q.toLowerCase();
      const deployments = all.filter(
        (d) =>
          (!f.env || d.env === f.env) &&
          (!f.channel || d.pipeline === f.channel) &&
          (!f.status || d.status === f.status) &&
          (!ql ||
            [d.version, d.by, d.note, byProj[d.projectId]?.name, d.projectId].some((x) =>
              (x ?? '').toLowerCase().includes(ql),
            )),
      );
      return reply.view('deployments.eta', {
        ...(await chrome(request, 'cicd', 'deployments')),
        title: 'Deployments',
        deployments,
        projectsById: byProj,
        projectList: [...projects].sort((a, b) => a.name.localeCompare(b.name)),
        filters: f,
        channelOptions,
        statusOptions,
        total: all.length,
      });
    },
  );

  app.get<{ Params: { id: string } }>('/cicd/deployments/:id', { preHandler: requireAuth }, async (request, reply) => {
    const deployment = await platform.getDeployment(request.params.id);
    if (!deployment) return reply.code(404).view('not-found.eta', { ...(await chrome(request, 'cicd', 'deployments')), title: 'Not found', what: 'Deployment' });
    const project = await platform.getProject(deployment.projectId);
    return reply.view('deployment-detail.eta', {
      ...(await chrome(request, 'cicd', 'deployments')),
      title: `Deploy ${deployment.version}`,
      deployment,
      project,
    });
  });

  // Lightweight JSON status for client-side polling (the Create Release progress UI).
  app.get<{ Params: { id: string } }>('/cicd/deployments/:id/status', { preHandler: requireAuth }, async (request, reply) => {
    const d = await platform.getDeployment(request.params.id);
    if (!d) return reply.code(404).send({ error: 'not found' });
    return reply.send({ id: d.id, status: d.status, progress: d.progress ?? null, note: d.note ?? null, env: d.env, version: d.version });
  });

  // Fetch a published manifest's body for view (inline) or download. Proxies the
  // platform (which reads it from S3) so the browser never touches S3 directly.
  app.get<{ Params: { id: string }; Querystring: { key?: string; download?: string } }>(
    '/cicd/deployments/:id/manifest',
    { preHandler: requireAuth },
    async (request, reply) => {
      const key = request.query.key;
      if (!key) return reply.code(400).send({ error: 'key is required' });
      try {
        const body = await platform.getDeploymentManifest(request.params.id, key);
        const filename = key.split('/').pop() || 'manifest.json';
        reply.header('content-type', 'application/json; charset=utf-8');
        if (request.query.download) reply.header('content-disposition', `attachment; filename="${filename}"`);
        return reply.send(body);
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'Failed to fetch manifest' });
      }
    },
  );

  // Download a build artifact: fetch a presigned S3 URL from the platform and
  // redirect the browser to it (the URL is short-lived and works cross-origin).
  app.get<{ Params: { hashId: string; artifactId: string } }>(
    '/cicd/artifacts/:hashId/:artifactId/download',
    { preHandler: requireAuth },
    async (request, reply) => {
      const url = await platform.artifactDownloadUrl(request.params.hashId, request.params.artifactId);
      if (!url) return reply.code(404).send({ error: 'Artifact not found' });
      return reply.redirect(url);
    },
  );

  app.get('/cicd/access-groups', { preHandler: requireAuth }, async (request, reply) => {
    return reply.view('access-groups.eta', {
      ...(await chrome(request, 'cicd', 'access-groups')),
      title: 'Access Groups',
      groups: await platform.listAccessGroups(),
      canEdit: request.user!.permissions.includes('programs:write'),
    });
  });
}

async function projectsData(query: { q?: string; type?: string }) {
  const projects = await platform.listProjects({ withState: true });
  const q = (query.q ?? '').toLowerCase();
  const type = query.type ?? 'all';
  const list = projects.filter(
    (p) => (type === 'all' || p.type.startsWith(type)) && (!q || p.name.toLowerCase().includes(q) || p.id.includes(q)),
  );
  return { projects: list, total: projects.length, q: query.q ?? '', type };
}
