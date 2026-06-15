/**
 * View-facing shapes for data READ from the gzops-platform API. These mirror
 * the prototype data model (`ui-prototype/js/data.js`), which was deliberately
 * shaped to match the platform's own types. The live client normalizes the
 * platform's JSON into these; fake mode (`fixtures.ts`) returns them directly.
 *
 * Nothing here is persisted by this app — it is all owned by gzops-platform.
 * App-owned state (programs, users, access) lives in `../store/`.
 */

export const ENVS = ['dev', 'test', 'alpha', 'beta', 'stage', 'prod'] as const;
export type Env = (typeof ENVS)[number];

export type ProjectType = 'firmware-kit' | 'firmware-node' | 'cloud' | 'mobile';

/** One promotion-rail / channel cell: the artifact live in a given environment. */
export interface RailCell {
  v: string;
  /** Build number for mobile artifacts. */
  b?: number;
  age?: string;
  state: 'live' | 'deploying' | 'failed';
  progress?: number;
  note?: string;
}

export type Rail = Partial<Record<Env, RailCell | null>>;

export interface KitComponent {
  label: string;
  projectId: string;
}

export interface AccessGroupRef {
  name: string;
  published: string;
}

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  repo: string;
  /** Firmware promotes env→env; mobile/cloud may build per-env (promotes:false). */
  promotes?: boolean;
  /** firmware-kit: member node projects. */
  components?: KitComponent[];
  /** firmware-kit: manifest channels (App/Warehouse/Manual), each a rail. */
  channels?: Record<string, Rail>;
  /** Single promotion rail for non-kit projects. */
  rail?: Rail;
  /** mobile: store/track cohorts → [cohort, version] pairs. */
  cohorts?: Record<string, [string, string][]>;
  /** mobile: tester/partner access groups. */
  accessGroups?: AccessGroupRef[];
  /** cloud: free-text health summary. */
  health?: string;
}

export type DeploymentStatus =
  | 'pending'
  | 'resolving_secrets'
  | 'in_progress'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

/** A bounded event-timeline line: [HH:MM:SS, level, message]. */
export type DeploymentLogLine = [string, 'info' | 'error', string];

export interface Deployment {
  id: string;
  projectId: string;
  version: string;
  env: Env;
  pipeline: string;
  executor: string;
  status: DeploymentStatus;
  progress?: number;
  by: string;
  at: string;
  note?: string;
  workflowUrl?: string;
  externalUrl?: string;
  /** Bounded event timeline (platform Deployment.events[]); full logs live in S3. */
  log?: DeploymentLogLine[];
}

/** A single project's version in one environment (Environments lens row). */
export interface EnvProjectState {
  projectId: string;
  projectName: string;
  type: ProjectType;
  cell: RailCell | null;
}

/**
 * Per-project live health-check config, declared in the repo's gzops/config.json
 * `project.health_check` and synced to the platform (config_snapshot). The
 * webapp probes each env's `{url}/health` to surface real running state.
 */
export interface HealthCheckConfig {
  /** URL with an `{env}` placeholder, e.g. https://yeti-{env}.goalzeroapp.com/health */
  url: string;
  /** Which environments to probe (defaults to all ENVS). */
  environments?: string[];
  /** Per-env full URLs that don't fit the template. */
  overrides?: Record<string, string>;
}

/** Result of probing one environment's `/health` endpoint. */
export interface EnvHealth {
  env: Env;
  /** Reachable and 200. */
  ok: boolean;
  /** HTTP status (0 = network error / timeout). */
  status: number;
  version?: string;
  gitSha?: string;
  /** Real gzops content hash, or a `local-<ts>` fallback when not computed. */
  gzopsHash?: string;
  error?: string;
}

/** An artifact row in the per-project build matrix. */
export interface Artifact {
  name: string;
  kind: string;
  size: string;
  /** Per-env deploy eligibility/state. */
  envs: Partial<Record<Env, 'deployed' | 'eligible' | 'ineligible'>>;
}
