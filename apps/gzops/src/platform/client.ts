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
import {
  ENVS,
  type Artifact,
  type Deployment,
  type DeploymentLogLine,
  type Env,
  type EnvProjectState,
  type Project,
  type Rail,
  type RailCell,
} from './types.js';

export interface CreateDeploymentInput {
  projectId: string;
  version: string;
  env: Env;
  by: string;
}

interface SimMeta {
  startedAtMs: number;
  durationMs: number;
}

class PlatformClient {
  /** Mutable in-memory deployment list for fake mode (seed + session deploys). */
  private fakeDeployments: Deployment[] | null = null;
  private readonly sims = new Map<string, SimMeta>();

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

  // ── Access groups (flattened from projects) ───────────────
  async listAccessGroups(): Promise<{ name: string; project: string; published: string }[]> {
    const projects = await this.listProjects();
    return projects.flatMap((p) => (p.accessGroups ?? []).map((g) => ({ name: g.name, project: p.name, published: g.published })));
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
    return this.fetchSigned<T>('GET', path);
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    return this.fetchSigned<T>('POST', path, JSON.stringify(body));
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
