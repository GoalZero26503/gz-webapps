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
  type Project,
  type Rail,
  type RailCell,
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
export function artifactsFor(p: Project): Artifact[] {
  const newest = p.rail?.dev ?? { v: 'v1.0.0' as string, b: undefined as number | undefined };
  const mk = (suffix: string, kind: string, size: string, deployedIn: Env[]): Artifact => ({
    name: `${p.id}.${suffix}.${newest.v}${'b' in newest && newest.b ? `.${newest.b}` : ''}.2ec53ed1.${kind.toLowerCase()}`,
    kind,
    size,
    envs: Object.fromEntries(
      ENVS.map((e) => [
        e,
        deployedIn.includes(e)
          ? 'deployed'
          : e === 'prod' && p.type !== 'cloud'
            ? 'eligible'
            : ['dev', 'test', 'alpha', 'beta', 'stage'].includes(e)
              ? 'eligible'
              : 'ineligible',
      ]),
    ),
  });
  if (p.type === 'mobile') return [mk('ios.dev', 'IPA', '6.6 MB', ['dev']), mk('android.dev', 'AAB', '19.8 MB', ['dev']), mk('android.dev', 'APK', '50.7 MB', ['dev'])];
  if (p.type === 'firmware-kit') return [mk('kit-bundle', 'ZIP', '4.1 MB', ['dev', 'test'])];
  if (p.type === 'cloud') return [mk('serverless', 'ZIP', '12.2 MB', ['dev', 'test', 'stage'])];
  return [mk('fw-ota', 'BIN', '1.2 MB', ['dev']), mk('fw-bundle', 'ZIP', '2.0 MB', ['dev'])];
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

const channelLabel = (p?: string): string =>
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
    pipeline: String(r.pipeline ?? r.pipeline_type ?? 'platform'),
    executor: String(r.executor ?? 'platform'),
    status: (r.status as Deployment['status']) ?? 'pending',
    progress: r.progress as number | undefined,
    by: String(r.triggered_by ?? r.by ?? 'system'),
    at: String(r.triggered_at ?? r.at ?? new Date().toISOString()),
    note: r.status_message as string | undefined,
    workflowUrl: r.workflow_url as string | undefined,
    externalUrl: r.external_url as string | undefined,
    log: (r.events as DeploymentLogLine[] | undefined) ?? undefined,
  };
}
