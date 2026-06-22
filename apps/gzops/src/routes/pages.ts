import type { FastifyInstance } from 'fastify';
import { requireAuth, requirePermission } from '../auth/plugin.js';
import { platform, channelLabel, type DeployConfigInput } from '../platform/client.js';
import { ENVS, type Env, type Project } from '../platform/types.js';
import { programs as programsTable } from '../store/repo.js';
import type { Program } from '../store/types.js';
import { chrome } from '../views/chrome.js';
import { programHealth } from '../views/helpers.js';

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
    const projById = byId([...projects, ...componentProjects]);
    return reply.view('program-dashboard.eta', {
      ...(await chrome(request, 'dashboard', program.id)),
      title: program.name,
      program,
      projectsById: projById,
      deployments,
      health: programHealth(program.sections, projById),
      inflight: deployments.filter((d) => d.status === 'in_progress').length,
      failures: deployments.filter((d) => d.status === 'failed').length,
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

  app.get<{ Params: { id: string }; Querystring: { tab?: string; edit?: string } }>('/cicd/projects/:id', { preHandler: requireAuth }, async (request, reply) => {
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
    if (project.type === 'firmware-kit') {
      for (const d of deployments) {
        const ch = channelLabel(d.pipeline);
        const m = (latestByChannelEnv[ch] ??= {});
        if (!m[d.env]) m[d.env] = d.id;
      }
    }
    // Artifacts (BUILDS tab) and deploy-config (CONFIG tab) are fetched lazily.
    const allArtifacts = tab === 'builds' ? await platform.listArtifacts(project) : [];
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
      artifacts: allArtifacts.slice(0, ARTIFACT_PAGE),
      artifactTotal: allArtifacts.length,
      artifactNextOffset: allArtifacts.length > ARTIFACT_PAGE ? ARTIFACT_PAGE : null,
      tab,
      deployConfig,
      editing,
      deployConfigJson: deployConfig ? JSON.stringify(deployConfig) : '{}',
      // Every firmware-node project is selectable as a kit component source. Sourced
      // from the full project list (cached) — NOT `projects`, which here is just the
      // kit + its current components and would leave the editor dropdown empty.
      nodeProjectsJson: JSON.stringify(
        project.type === 'firmware-kit'
          ? (await platform.listProjects())
              .filter((p) => p.type === 'firmware-node')
              .map((p) => ({ id: p.id, name: p.name }))
          : [],
      ),
      canDeploy: request.user!.permissions.includes('deploys:create'),
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
          versions: c.project ? await platform.availableVersions(c.project) : [],
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
    const p = await platform.getProject(id);
    const cells = ENVS.map((e) => {
      const c = p?.rail?.[e];
      return { env: e, ok: !!c, v: c?.v ?? '—', meta: c?.age ?? '' };
    });
    return reply.view('partials/health-panel.eta', { cells, configured: false, healthy: true, down: [] });
  });

  app.get('/cicd/deployments', { preHandler: requireAuth }, async (request, reply) => {
    const projects = await platform.listProjects();
    const deployments = await platform.listDeploymentsAcross(projects.map((p) => p.id));
    return reply.view('deployments.eta', {
      ...(await chrome(request, 'cicd', 'deployments')),
      title: 'Deployments',
      deployments,
      projectsById: byId(projects),
    });
  });

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
