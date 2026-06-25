/**
 * BFF client for the gzops-platform API. The browser NEVER calls the platform
 * directly — every read/write is made here, server-side, signed with the
 * Lambda role's SigV4 credentials (charter: kills the CORS class; no browser
 * JWT → SigV4 dance).
 *
 * Two modes (config.platformMode):
 *  - 'fake' (local dev): serves `fixtures.ts`; deploys created in-session
 *    animate to completion so the live-progress tile is exercisable offline.
 *  - 'live' (AWS): SigV4-signed fetch against config.platformBaseUrl. The
 *    live response→view normalizers below match the documented platform
 *    contract (snake_case fields); validate against the real API once the
 *    deploy role + API are reachable (untestable from a local machine).
 */
import { getConfig } from '../config.js';
import { FIXTURE_PROJECTS, fixtureDeployments } from './fixtures.js';
import { signRequest } from './sigv4.js';

// Keep platform-API connections warm across requests. Without this, fanning out
// env-state reads pays a fresh TLS handshake per call (measured ~1s/call cold vs
// ~0.4s warm); a pooled keep-alive dispatcher lets a warm Lambda reuse sockets.
void (async () => {
  try {
    const { setGlobalDispatcher, Agent } = await import('undici');
    setGlobalDispatcher(new Agent({ keepAliveTimeout: 30_000, keepAliveMaxTimeout: 60_000, connections: 128 }));
  } catch {
    /* undici not resolvable — Node's built-in fetch keep-alive defaults apply */
  }
})();
import {
  ENVS,
  type Artifact,
  type DeployConfig,
  type Deployment,
  type DeploymentLogLine,
  type Env,
  type EnvHealth,
  type EnvProjectState,
  type HealthCheckConfig,
  type KitDeployConfig,
  type KitPreview,
  type KitReleaseResult,
  type MilestoneSyncResult,
  type Project,
  type Rail,
  type RailCell,
  type VersionLock,
} from './types.js';

const pickStr = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export interface CreateDeploymentInput {
  projectId: string;
  version: string;
  env: Env;
  by: string;
}

/** Editable subset of a deploy-config (a PUT body); the platform stamps the rest. */
export interface DeployConfigInput {
  environments: string[];
  deploy_pipelines: DeployConfig['deploy_pipelines'];
  artifacts: DeployConfig['artifacts'];
  kit?: KitDeployConfig;
  health_check?: HealthCheckConfig;
  note?: string;
  /** Acting user — the BFF authorizes via SigV4, so it attributes the author. */
  author?: string;
  source?: DeployConfig['source'];
}

interface SimMeta {
  startedAtMs: number;
  durationMs: number;
}

class PlatformClient {
  /** Mutable in-memory deployment list for fake mode (seed + session deploys). */
  private fakeDeployments: Deployment[] | null = null;
  private readonly sims = new Map<string, SimMeta>();
  /** In-session saved deploy-configs for fake mode (keyed by projectId). */
  private readonly fakeConfigs = new Map<string, DeployConfig>();

  /** Short-TTL cache for live GETs, keyed by path. Dedupes the per-request
   *  fan-out (e.g. chrome + page both list projects) and makes navigation within
   *  the warm window near-instant. Writes (createDeployment) clear it. */
  private readonly cache = new Map<string, { at: number; data: unknown }>();
  private static readonly CACHE_TTL_MS = 20_000;

  /** Cache for external `/health` probes (separate from the SigV4 platform cache). */
  private readonly healthCache = new Map<string, { at: number; data: EnvHealth }>();
  private static readonly HEALTH_TIMEOUT_MS = 5_000;

  private get isFake(): boolean {
    return getConfig().platformMode === 'fake';
  }

  // ── Projects ──────────────────────────────────────────────
  async listProjects(opts: { withState?: boolean } = {}): Promise<Project[]> {
    if (this.isFake) return structuredClone(FIXTURE_PROJECTS);
    const projects = (await this.getJson<{ projects?: unknown[] }>('/projects')).projects?.map(normalizeProject) ?? [];
    if (!opts.withState) return projects;
    return Promise.all(projects.map((p) => this.enrich(p)));
  }

  /**
   * Fetch a specific subset of projects, reusing the cached `/projects` list and
   * enriching only those with live env-state. Program-scoped views (overview,
   * program dashboard) call this so we don't fan out `/environments` for all ~20
   * platform projects when we only render a handful.
   */
  async getProjectsByIds(ids: string[], opts: { withState?: boolean } = {}): Promise<Project[]> {
    const want = new Set(ids);
    const subset = (await this.listProjects()).filter((p) => want.has(p.id));
    if (this.isFake || !opts.withState) return subset;
    return Promise.all(subset.map((p) => this.enrich(p)));
  }

  /** Populate rail / channels / cohorts from the project's live env-state. */
  private async enrich(p: Project): Promise<Project> {
    if (this.isFake) return p;
    const items = await this.envStates(p.id);
    return items.length ? { ...p, ...buildState(items, p.type) } : p;
  }

  private async envStates(projectId: string): Promise<EnvStateItem[]> {
    const data = await this
      .getJson<{ environments?: EnvStateItem[] }>(`/environments?project_id=${encodeURIComponent(projectId)}`)
      .catch(() => ({ environments: [] as EnvStateItem[] }));
    return data.environments ?? [];
  }

  async getProject(id: string): Promise<Project | null> {
    if (this.isFake) return structuredClone(FIXTURE_PROJECTS.find((p) => p.id === id)) ?? null;
    const raw = await this.getJson<unknown>(`/projects/${encodeURIComponent(id)}`).catch(() => null);
    return raw ? this.enrich(normalizeProject(raw)) : null;
  }

  // ── Deployments ───────────────────────────────────────────
  async listDeployments(opts: { projectId: string; limit?: number }): Promise<Deployment[]> {
    if (this.isFake) {
      const list = this.fakeStore().map((d) => this.advance(d)).filter((d) => d.projectId === opts.projectId);
      list.sort((a, b) => (a.at < b.at ? 1 : -1));
      return opts.limit ? list.slice(0, opts.limit) : list;
    }
    // The platform requires project_id (a global list 400s). Callers needing a
    // cross-project view use listDeploymentsAcross().
    const qs = new URLSearchParams({ project_id: opts.projectId, limit: String(opts.limit ?? 50) });
    const res = await this.getJson<{ deployments?: unknown[] }>(`/deployments?${qs}`);
    return res.deployments?.map(normalizeDeployment) ?? [];
  }

  /** Merge recent deployments across several projects (per-project fetch + merge). */
  async listDeploymentsAcross(projectIds: string[], limit = 50): Promise<Deployment[]> {
    if (this.isFake) {
      const ids = new Set(projectIds);
      return this.fakeStore().map((d) => this.advance(d)).filter((d) => ids.has(d.projectId))
        .sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
    }
    const lists = await Promise.all(projectIds.map((pid) => this.listDeployments({ projectId: pid }).catch(() => [] as Deployment[])));
    return lists.flat().sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
  }

  async getDeployment(id: string): Promise<Deployment | null> {
    if (this.isFake) {
      const d = this.fakeStore().find((x) => x.id === id);
      return d ? this.advance(d) : null;
    }
    const raw = await this.getJson<unknown>(`/deployments/${encodeURIComponent(id)}`).catch(() => null);
    return raw ? normalizeDeployment(raw) : null;
  }

  /** Fetch the raw body of a manifest this deployment published (deployment-detail view). */
  async getDeploymentManifest(id: string, key: string): Promise<string> {
    if (this.isFake) return JSON.stringify({ iNodes: {}, note: 'fake manifest' }, null, 2);
    return this.fetchSignedText('GET', `/deployments/${encodeURIComponent(id)}/manifest?key=${encodeURIComponent(key)}`);
  }

  async createDeployment(input: CreateDeploymentInput): Promise<Deployment> {
    if (this.isFake) return this.createFakeDeployment(input);
    const raw = await this.postJson<unknown>('/deployments', {
      project_id: input.projectId,
      version: input.version,
      environment: input.env,
    });
    return normalizeDeployment(raw);
  }

  // ── Environments lens ─────────────────────────────────────
  async listEnvironment(env: Env): Promise<EnvProjectState[]> {
    const projects = await this.listProjects({ withState: true });
    return projects.map((p) => ({
      projectId: p.id,
      projectName: p.name,
      type: p.type,
      cell: p.rail?.[env] ?? null,
    }));
  }

  // ── Artifacts (build outputs) ─────────────────────────────
  /**
   * Real build artifacts for a project (newest upload first). Per-env state is
   * derived from the project's live rail: an artifact whose version+build matches
   * what's deployed in an env shows `deployed`; envs the artifact targets show
   * `eligible`; the rest `ineligible`. Pass the rail-enriched `project`.
   */
  async listArtifacts(project: Project): Promise<Artifact[]> {
    if (this.isFake) return fakeArtifacts(project);
    const res = await this.getJson<{ artifacts?: unknown[] }>(
      `/projects/${encodeURIComponent(project.id)}/artifacts?limit=100`,
    );
    return (res.artifacts ?? [])
      .map((a) => a as Record<string, unknown>)
      .filter((a) => a.uploaded_at) // hide pending (not-yet-uploaded) rows
      .map((a) => normalizeArtifact(a, project))
      .sort((a, b) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''));
  }

  /** Presigned S3 URL to download a build artifact's file (BUILDS tab download links). */
  async artifactDownloadUrl(hashId: string, artifactId: string): Promise<string | null> {
    if (this.isFake) return null;
    const res = await this.getJson<{ download_url?: string }>(
      `/artifacts/${encodeURIComponent(hashId)}/${encodeURIComponent(artifactId)}/download`,
    ).catch(() => null);
    return res?.download_url ?? null;
  }

  // ── Platform build identity (GET /health) ─────────────────
  /** The backend's own version + git sha (sidebar footer). Cached via getJson;
   *  null if the platform is unreachable so the footer just omits the line. */
  async serviceHealth(): Promise<{ version?: string; gitSha?: string } | null> {
    if (this.isFake) return { version: '1.0.0', gitSha: 'bdca198a' };
    try {
      const h = await this.getJson<{ version?: string; gitSha?: string }>('/health');
      return { version: pickStr(h.version), gitSha: pickStr(h.gitSha) };
    } catch {
      return null;
    }
  }

  // ── Live health checks (cloud /health probing) ────────────
  /** Read a project's health-check config from its synced config_snapshot. */
  async healthConfig(projectId: string): Promise<HealthCheckConfig | null> {
    if (this.isFake) return { url: 'https://yeti-{env}.goalzeroapp.com/health', environments: ['dev', 'test', 'prod'] };
    const raw = await this
      .getJson<{ config_snapshot?: { project?: { health_check?: HealthCheckConfig } } }>(`/projects/${encodeURIComponent(projectId)}`)
      .catch(() => null);
    return raw?.config_snapshot?.project?.health_check ?? null;
  }

  /** Probe every configured environment's `/health`. Returns null if unconfigured. */
  async projectHealth(projectId: string): Promise<EnvHealth[] | null> {
    const cfg = await this.healthConfig(projectId);
    if (!cfg) return null;
    const envs = (cfg.environments?.length ? cfg.environments : ENVS).filter((e): e is Env => (ENVS as readonly string[]).includes(e));
    return Promise.all(envs.map((env) => this.probeHealth(env, cfg.overrides?.[env] ?? cfg.url.replace(/\{env\}/g, env))));
  }

  private async probeHealth(env: Env, url: string): Promise<EnvHealth> {
    if (this.isFake) {
      return { env, ok: true, status: 200, version: '1.5.2', gitSha: 'bdca198a', gzopsHash: env === 'dev' ? 'local-1774031122' : '95d19c51d8fc' };
    }
    const cached = this.healthCache.get(url);
    if (cached && Date.now() - cached.at < PlatformClient.CACHE_TTL_MS) return { ...cached.data, env };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PlatformClient.HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      let body: Record<string, unknown> = {};
      try { body = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON health body */ }
      const data: EnvHealth = {
        env,
        ok: res.ok,
        status: res.status,
        version: pickStr(body.version),
        gitSha: pickStr(body.gitSha),
        gzopsHash: pickStr(body.gzopsHash),
      };
      this.healthCache.set(url, { at: Date.now(), data });
      return data;
    } catch (e) {
      return { env, ok: false, status: 0, error: e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Access groups (flattened from projects) ───────────────
  async listAccessGroups(): Promise<{ name: string; project: string; published: string }[]> {
    const projects = await this.listProjects();
    return projects.flatMap((p) => (p.accessGroups ?? []).map((g) => ({ name: g.name, project: p.name, published: g.published })));
  }

  // ── Deploy-domain config (versioned; webapp-editable) ─────
  /** The active deploy-config (newest saved version, else a synthesized v0). */
  async getDeployConfig(projectId: string): Promise<DeployConfig> {
    if (this.isFake) return this.fakeConfigs.get(projectId) ?? this.fakeDeployConfig(projectId);
    return this.getJson<DeployConfig>(`/projects/${encodeURIComponent(projectId)}/deploy-config`);
  }

  /** Version locks for a project — the GitHub Release published on first non-dev deploy. */
  async listVersionLocks(projectId: string): Promise<VersionLock[]> {
    if (this.isFake) return [];
    const res = await this.getJson<{ version_locks?: VersionLock[] }>(
      `/projects/${encodeURIComponent(projectId)}/version-locks`,
    ).catch(() => ({ version_locks: [] as VersionLock[] }));
    return res.version_locks ?? [];
  }

  /**
   * Distinct built artifact versions for a node project, newest-first (release dropdown).
   * For a multi-variant project, pass the component's `artifact` (build_pipeline/variant
   * token) — versions are then filtered to that variant and read from the artifact filename
   * (a build ships every variant at its own version, so the hash `version` is unreliable).
   */
  async availableVersions(projectId: string, artifact?: string): Promise<string[]> {
    if (this.isFake) return ['2.6.0', '2.5.9', '2.5.8'];
    const res = await this.getJson<{ artifacts?: { version?: string; name?: string; build_pipeline?: string; artifact_def_id?: string }[] }>(
      `/projects/${encodeURIComponent(projectId)}/artifacts?limit=200`,
    ).catch(() => ({ artifacts: [] as { version?: string; name?: string; build_pipeline?: string; artifact_def_id?: string }[] }));
    // Reduce a build_pipeline / artifact_def_id to its variant token
    // ("y300-hp-bundle" → "y300-hp", "pcu" → "pcu").
    const variantOf = (s: string): string => s.replace(/-(bundle|ota|image|fw|firmware)$/i, '');
    const want = artifact ? variantOf(artifact) : '';
    const set = new Set<string>();
    for (const a of res.artifacts ?? []) {
      if (artifact) {
        const matches = a.build_pipeline === want || variantOf(a.artifact_def_id ?? '') === want;
        if (!matches) continue;
        const v = a.name?.match(/\.v(\d+\.\d+\.\d+)(?:\.|$)/)?.[1];
        if (v) set.add(v);
      } else if (a.version) {
        set.add(a.version);
      }
    }
    return [...set].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }

  /** Read-only: expand a kit-release selection into per-host manifests (no writes). */
  async previewKitRelease(
    projectId: string,
    selection: { versions: Record<string, string>; hostIds?: string[] },
  ): Promise<KitPreview> {
    if (this.isFake) return { manifests: [], missing: [], host_count: 0 };
    return this.postJson<KitPreview>(`/projects/${encodeURIComponent(projectId)}/kit-release/preview`, selection);
  }

  /** Publish a kit release: copy component binaries, gate readiness, write per-host manifests per channel. */
  async createKitRelease(
    projectId: string,
    input: { versions: Record<string, string>; hostIds?: string[]; channels: string[]; environment: string; kit_version: string; by?: string },
  ): Promise<KitReleaseResult> {
    if (this.isFake) {
      return { environment: input.environment, kit_version: input.kit_version, host_count: 0, copied_binaries: 0, deployments: input.channels.map((channel) => ({ channel, deployment_id: 'fake', manifests: 0 })) };
    }
    return this.postJson<KitReleaseResult>(`/projects/${encodeURIComponent(projectId)}/kit-release`, input);
  }

  /**
   * Cut a release (two-object model): freeze a dev kit into an immutable,
   * GitHub-tagged release. Pass the dev deployment to cut from; the platform
   * creates the version-lock (tagging the kit repo's HEAD) + publishes notes.
   * Idempotent — re-cutting a version returns its existing release.
   */
  async cutRelease(
    projectId: string,
    input: { deploymentId: string; by?: string },
  ): Promise<{ version?: string; git_sha?: string; publish_status?: string; already_cut?: boolean; publish_error?: string; github?: { release_url?: string } | null }> {
    if (this.isFake) return { version: '0.0.0', publish_status: 'published', github: null };
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/cut-release`, { deployment_id: input.deploymentId, by: input.by });
  }

  /**
   * Reconcile gzops version-locks with the repo's actual GitHub Releases: import
   * pre-existing releases (provenance-only) and self-heal failed publishes.
   */
  async syncReleases(projectId: string): Promise<{ imported: number; healed: number; unchanged: number; skipped: number; total: number }> {
    if (this.isFake) return { imported: 0, healed: 0, unchanged: 0, skipped: 0, total: 0 };
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/sync-releases`, {});
  }

  /**
   * Sync a release milestone to GitHub: upsert it across `memberRepos` and
   * create/maintain the `Release` issue in `releaseRepo`. The platform holds no
   * milestone state — the def + membership are resolved here and passed in.
   */
  async syncMilestones(input: {
    title: string;
    description: string;
    dueOn: string | null;
    state: 'open' | 'closed';
    memberRepos: string[];
    releaseRepo: string;
    releaseIssueNumber?: number;
    oldTitles?: string[];
    syncedBy?: string;
  }): Promise<MilestoneSyncResult> {
    if (this.isFake) {
      return {
        title: input.title,
        release_issue: { repo: input.releaseRepo, number: 1, url: `https://github.com/${input.releaseRepo}/issues/1` },
        milestones: input.memberRepos.map((repo, i) => ({ repo, number: i + 1, url: `https://github.com/${repo}/milestone/${i + 1}`, action: 'created' as const })),
        errors: [],
      };
    }
    return this.postJson<MilestoneSyncResult>('/milestones/sync', {
      title: input.title,
      description: input.description,
      due_on: input.dueOn,
      state: input.state,
      member_repos: input.memberRepos,
      release: { repo: input.releaseRepo, issue_number: input.releaseIssueNumber },
      old_titles: input.oldTitles,
      synced_by: input.syncedBy,
    });
  }

  /** Saved versions, newest first (the active one is [0]). */
  async getDeployConfigVersions(projectId: string): Promise<DeployConfig[]> {
    if (this.isFake) return [await this.getDeployConfig(projectId)];
    const res = await this.getJson<DeployConfig[] | { versions?: DeployConfig[] }>(
      `/projects/${encodeURIComponent(projectId)}/deploy-config/versions`,
    );
    return Array.isArray(res) ? res : res.versions ?? [];
  }

  /** Save a new immutable deploy-config version. */
  async saveDeployConfig(projectId: string, input: DeployConfigInput): Promise<DeployConfig> {
    if (this.isFake) {
      const prev = await this.getDeployConfig(projectId);
      const next: DeployConfig = {
        ...prev,
        ...input,
        version: prev.version + 1,
        config_id: `v${String(prev.version + 1).padStart(7, '0')}`,
        source: 'webapp',
        author: 'you@local',
        created_at: new Date().toISOString(),
      };
      this.fakeConfigs.set(projectId, next);
      return next;
    }
    return this.putJson<DeployConfig>(`/projects/${encodeURIComponent(projectId)}/deploy-config`, input);
  }

  /** Fake-mode deploy-config derived from a fixture project (type-shaped). */
  private fakeDeployConfig(projectId: string): DeployConfig {
    const p = FIXTURE_PROJECTS.find((x) => x.id === projectId);
    const type = p?.type ?? 'cloud';
    const base: DeployConfig = {
      project_id: projectId,
      config_id: 'v0000000',
      version: 0,
      environments: [...ENVS],
      deploy_pipelines: [],
      artifacts: [],
      author: 'config-sync',
      source: 'seed',
      note: 'Synthesized from config_snapshot (fake mode).',
      created_at: new Date().toISOString(),
    };
    if (type === 'cloud') {
      base.deploy_pipelines = [{ name: 'serverless', plugin: 'github-action', config: { workflow: 'deploy.yml' } }];
      base.artifacts = [{ id: 'serverless', name_pattern: '*.zip', build_pipeline: 'serverless', deploy_pipelines: ['serverless'], envs: ['*'] }];
      base.health_check = { url: 'https://yeti-{env}.goalzeroapp.com/health', environments: [...ENVS] };
    } else if (type === 'mobile') {
      base.deploy_pipelines = [
        { name: 'testflight', plugin: 'testflight', config: { group: 'Internal' } },
        { name: 'playstore', plugin: 'playstore', config: { track: 'internal' } },
      ];
      base.artifacts = [
        { id: 'ios', name_pattern: '*.ipa', build_pipeline: 'ios', deploy_pipelines: ['testflight'], envs: ['*'] },
        { id: 'android', name_pattern: '*.aab', build_pipeline: 'android', deploy_pipelines: ['playstore'], envs: ['*'] },
      ];
    } else if (type === 'firmware-kit') {
      base.deploy_pipelines = [
        { name: 'app', plugin: 'firmware-kit-deploy', config: { bucket: 'gz-{env}-firmware-manifests', source_dir: 'minimized' } },
        { name: 'warehouse', plugin: 'firmware-kit-deploy', config: { bucket: 'gz-{env}-warehouse-manifests', source_dir: 'populated' } },
      ];
      base.kit = {
        host_ids: ['H-36900-A20-B1-C1', 'H-37000-A20-B1-C1', 'H-36900-A20-B2-C1'],
        components: [
          { name: 'A20 board', project: 'goalzero26503-a20-node', version: '2.0.6' },
          { name: 'B1 board', project: 'goalzero26503-b1-node', version: '0.5.8' },
        ],
        releases: [
          { version: '1.3.6', build_targets: ['H-36900-A20-B1-C1', 'H-37000-A20-B1-C1'], manifest: { iNodes: { 'A20-1': '2.0.6', 'B1-1': '0.5.8' } } },
          { version: '1.3.6', build_targets: ['H-36900-A20-B2-C1'], manifest: { iNodes: { 'A20-1': '2.0.6', 'B2-1': '0.1.6' } } },
        ],
      };
    } else {
      base.deploy_pipelines = [{ name: 's3', plugin: 's3', config: { bucket: 'gz-{env}-firmware-images' } }];
    }
    return base;
  }

  // ── Fake-mode internals ───────────────────────────────────
  private fakeStore(): Deployment[] {
    if (!this.fakeDeployments) this.fakeDeployments = fixtureDeployments();
    return this.fakeDeployments;
  }

  private createFakeDeployment(input: CreateDeploymentInput): Deployment {
    const id = `d-${Date.now().toString(36)}`;
    const dep: Deployment = {
      id,
      projectId: input.projectId,
      version: input.version,
      env: input.env,
      pipeline: 'manual',
      executor: 'lambda',
      status: 'in_progress',
      progress: 0,
      by: input.by,
      at: new Date().toISOString(),
      log: [['00:00:00', 'info', `Deployment created by ${input.by} — ${input.version} → ${input.env}`]],
    };
    this.fakeStore().unshift(dep);
    this.sims.set(id, { startedAtMs: Date.now(), durationMs: 12_000 });
    return this.advance(dep);
  }

  /** Recompute a simulated deploy's progress/status from elapsed time. */
  private advance(d: Deployment): Deployment {
    const sim = this.sims.get(d.id);
    if (!sim || d.status !== 'in_progress') return d;
    const elapsed = Date.now() - sim.startedAtMs;
    const pct = Math.min(100, Math.round((elapsed / sim.durationMs) * 100));
    d.progress = pct;
    const log = d.log ?? (d.log = []);
    const stamp = new Date(sim.startedAtMs + elapsed).toISOString().slice(11, 19);
    const milestone = (at: number, line: string): void => {
      if (pct >= at && !log.some((l) => l[2] === line)) log.push([stamp, 'info', line]);
    };
    milestone(20, 'Resolved artifact; checksums verified');
    milestone(55, 'Uploading to target environment…');
    if (pct >= 100) {
      d.status = 'succeeded';
      d.progress = 100;
      milestone(100, 'Deploy succeeded');
      this.sims.delete(d.id);
    }
    return d;
  }

  // ── Live transport ────────────────────────────────────────
  private async getJson<T>(path: string): Promise<T> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < PlatformClient.CACHE_TTL_MS) return hit.data as T;
    const data = await this.fetchSigned<T>('GET', path);
    this.cache.set(path, { at: Date.now(), data });
    return data;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const out = await this.fetchSigned<T>('POST', path, JSON.stringify(body));
    this.cache.clear(); // a write (e.g. new deploy) invalidates cached reads
    return out;
  }

  private async putJson<T>(path: string, body: unknown): Promise<T> {
    const out = await this.fetchSigned<T>('PUT', path, JSON.stringify(body));
    this.cache.clear();
    return out;
  }

  /** Signed request that returns the raw response text (endpoints that aren't {success,data}-wrapped). */
  private async fetchSignedText(method: string, path: string): Promise<string> {
    const { platformBaseUrl } = getConfig();
    const region = process.env.AWS_REGION || 'us-east-1';
    const signed = signRequest(method, `${platformBaseUrl}${path}`, region, '');
    const res = await fetch(signed.url, { method: signed.method, headers: signed.headers });
    if (!res.ok) throw new Error(`Platform API ${method} ${path} → ${res.status}`);
    return res.text();
  }

  private async fetchSigned<T>(method: string, path: string, body = ''): Promise<T> {
    const { platformBaseUrl } = getConfig();
    const region = process.env.AWS_REGION || 'us-east-1';
    const signed = signRequest(method, `${platformBaseUrl}${path}`, region, body);
    const res = await fetch(signed.url, {
      method: signed.method,
      headers: body ? { ...signed.headers, 'content-type': 'application/json' } : signed.headers,
      body: signed.body,
    });
    if (!res.ok) throw new Error(`Platform API ${method} ${path} → ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    // Platform wraps every payload in {success, data}; unwrap to the inner object.
    return (json && typeof json === 'object' && 'data' in json ? json.data : json) as T;
  }
}

export const platform = new PlatformClient();

// ── Pure derivations (shared by views) ──────────────────────

/** Demo artifact list derived from a project's rail (build matrix rows). */
/** Human-readable byte size, e.g. 52978 → "51.7 KB". */
function fmtBytes(n: unknown): string {
  const b = typeof n === 'number' && n >= 0 ? n : 0;
  if (!b) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Artifact kind from filename extension (".bin" → "BIN"). */
function kindFromName(name: string): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return ext ? ext.toUpperCase() : 'FILE';
}

/** Strip a leading "v" so "v2.6.6" and "2.6.6" compare equal. */
const bareVersion = (v: unknown): string => String(v ?? '').replace(/^v/i, '');

/** Per-env state for one artifact, from the project's live rail + the artifact's target envs. */
function artifactEnvStatus(
  raw: Record<string, unknown>,
  project: Project,
): Artifact['envs'] {
  const targets = Array.isArray(raw.envs) ? (raw.envs as string[]) : [];
  const eligible = (e: Env): boolean => targets.includes('*') || targets.includes(e);
  const version = bareVersion(raw.version);
  const build = typeof raw.build_number === 'number' ? raw.build_number : undefined;
  return Object.fromEntries(
    ENVS.map((e) => {
      const cell = project.rail?.[e];
      const deployed =
        !!cell &&
        !!version &&
        bareVersion(cell.v) === version &&
        (cell.b == null || build == null || cell.b === build);
      return [e, deployed ? 'deployed' : eligible(e) ? 'eligible' : 'ineligible'];
    }),
  ) as Artifact['envs'];
}

function normalizeArtifact(raw: Record<string, unknown>, project: Project): Artifact {
  const name = String(raw.name ?? '');
  return {
    name,
    kind: kindFromName(name),
    size: fmtBytes(raw.size),
    uploadedAt: typeof raw.uploaded_at === 'string' ? raw.uploaded_at : undefined,
    uploadedBy: typeof raw.uploaded_by === 'string' ? raw.uploaded_by : undefined,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    buildNumber: typeof raw.build_number === 'number' ? raw.build_number : undefined,
    hashId: typeof raw.hash_id === 'string' ? raw.hash_id : undefined,
    artifactId: typeof raw.artifact_id === 'string' ? raw.artifact_id : undefined,
    gitSha: typeof raw.git_sha === 'string' ? raw.git_sha : undefined,
    workflowUrl: typeof raw.workflow_run_url === 'string' ? raw.workflow_run_url : undefined,
    envs: artifactEnvStatus(raw, project),
  };
}

/** Local-dev (fake mode) artifacts so the BUILDS tab renders offline. */
function fakeArtifacts(p: Project): Artifact[] {
  const v = bareVersion(p.rail?.dev?.v ?? '1.0.0');
  const at = '2026-06-18T15:43:18.000Z';
  const mk = (suffix: string, ext: string, size: number): Record<string, unknown> => ({
    name: `${p.id}.${suffix}.v${v}.1.84affa81.${ext}`,
    size,
    version: v,
    build_number: 1,
    hash_id: 'fake0000',
    uploaded_at: at,
    uploaded_by: 'ci-bot',
    envs: ['*'],
  });
  const rows =
    p.type === 'mobile'
      ? [mk('ios', 'ipa', 6_920_000), mk('android', 'aab', 20_700_000)]
      : p.type === 'cloud'
        ? [mk('serverless', 'zip', 12_800_000)]
        : [mk('fw-ota', 'bin', 52_978), mk('fw-bundle', 'zip', 37_449)];
  return rows.map((r) => normalizeArtifact(r, p));
}

// ── Live response normalizers (platform snake_case → view types) ──

interface EnvStateItem {
  environment: string;
  deploy_pipeline?: string;
  current_version?: string;
  current_build_number?: number;
  deployed_at?: string;
  status?: string;
  cohorts?: { cohort: string; version?: string; build?: string; at?: string }[];
}

function normalizeType(t: unknown): Project['type'] {
  const s = String(t ?? '');
  if (s === 'firmware-kit' || s === 'firmware-node') return s;
  if (s === 'mobile' || s === 'mobile-react-native') return 'mobile';
  return 'cloud'; // backend + anything else
}

function relAge(iso?: string): string | undefined {
  if (!iso) return undefined;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return undefined;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d` : `${Math.floor(d / 30)}mo`;
}

function railState(status?: string): 'live' | 'deploying' | 'failed' {
  if (status === 'failed') return 'failed';
  if (status === 'in_progress' || status === 'deploying' || status === 'pending') return 'deploying';
  return 'live';
}

export const channelLabel = (p?: string): string =>
  (p ?? 'default').replace(/-manifests?$/i, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const storeLabel = (p?: string): string =>
  p === 'play' ? 'Play' : p === 'app-store' || p === 'testflight' ? 'TestFlight' : channelLabel(p);

/** Compose rail / channels / cohorts from a project's live env-state rows. */
function buildState(items: EnvStateItem[], type: Project['type']): Partial<Project> {
  const cellOf = (it: EnvStateItem): RailCell => ({
    v: String(it.current_version ?? '—'),
    b: it.current_build_number,
    age: relAge(it.deployed_at),
    state: railState(it.status),
  });
  const rail: Rail = {};
  for (const env of ENVS) {
    const inEnv = items.filter((i) => i.environment === env);
    if (!inEnv.length) continue;
    inEnv.sort((a, b) => ((a.deployed_at ?? '') < (b.deployed_at ?? '') ? 1 : -1));
    rail[env] = cellOf(inEnv[0]);
  }
  const out: Partial<Project> = { rail };
  if (type === 'firmware-kit') {
    const channels: Record<string, Rail> = {};
    for (const it of items) {
      const label = channelLabel(it.deploy_pipeline);
      (channels[label] ??= {})[it.environment as Env] = cellOf(it);
    }
    out.channels = channels;
  }
  if (type === 'mobile') {
    const cohorts: Record<string, [string, string][]> = {};
    for (const it of items) {
      const store = storeLabel(it.deploy_pipeline);
      for (const c of it.cohorts ?? []) {
        (cohorts[store] ??= []).push([c.cohort, `${c.version ?? '—'}${c.build ? ` (${c.build})` : ''}`]);
      }
    }
    if (Object.keys(cohorts).length) out.cohorts = cohorts;
  }
  return out;
}

function normalizeProject(raw: unknown): Project {
  const r = raw as Record<string, unknown>;
  return {
    id: String(r.project_id ?? r.id ?? ''),
    name: String(r.display_name ?? r.name ?? r.project_id ?? r.id ?? ''),
    type: normalizeType(r.project_type ?? r.type),
    repo: String(r.repository ?? r.repo ?? ''),
    promotes: r.promotes as boolean | undefined,
  };
}

function normalizeDeployment(raw: unknown): Deployment {
  const r = raw as Record<string, unknown>;
  return {
    id: String(r.id ?? r.deployment_id ?? ''),
    projectId: String(r.project_id ?? r.projectId ?? ''),
    version: String(r.version ?? ''),
    env: (r.environment ?? r.env) as Env,
    pipeline: String(r.pipeline ?? r.deploy_pipeline ?? r.pipeline_type ?? 'platform'),
    executor: String(r.executor ?? 'platform'),
    status: (r.status as Deployment['status']) ?? 'pending',
    progress: r.progress as number | undefined,
    by: String(r.triggered_by ?? r.by ?? 'system'),
    at: String(r.triggered_at ?? r.at ?? new Date().toISOString()),
    note: r.status_message as string | undefined,
    workflowUrl: r.workflow_url as string | undefined,
    externalUrl: r.external_url as string | undefined,
    log: (r.events as DeploymentLogLine[] | undefined) ?? undefined,
    manifests: manifestsFromResult(r.result),
    componentVersions: (r.result as { metadata?: { component_versions?: Record<string, string> } } | undefined)?.metadata?.component_versions ?? undefined,
  };
}

/** Pull the published manifests (key → s3 destination) out of a deployment result. */
function manifestsFromResult(result: unknown): { key: string; uri: string }[] | undefined {
  const urls = (result as { urls?: Record<string, string> } | undefined)?.urls;
  if (!urls || typeof urls !== 'object') return undefined;
  const list = Object.entries(urls).map(([key, uri]) => ({ key, uri: String(uri) }));
  return list.length ? list : undefined;
}
