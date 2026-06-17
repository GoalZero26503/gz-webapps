import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

export interface AppConfig {
  appName: string;
  stage: string;
  /** Canonical origin for OAuth redirects, e.g. https://gzops2-dev.goalzeroapp.com */
  baseUrl: string;
  allowedDomains: string[];
  seedAdminEmail: string | null;
  jwtSecret: string;
  googleClientId: string;
  googleClientSecret: string;
  /** DynamoDB table name prefix, e.g. gzweb-dev-gzops- (KV escape hatch, charter §3.5). */
  tablePrefix: string;
  /** 'dynamo' in AWS; 'memory' for local dev (seeded demo data, no AWS writes). */
  storeMode: 'dynamo' | 'memory';
  /** gzops-platform API origin for the server-side BFF client (SigV4). */
  platformBaseUrl: string;
  /** 'live' signs real requests; 'fake' serves seeded demo data for local dev. */
  platformMode: 'live' | 'fake';
  /** App version (package.json), surfaced in the sidebar footer. */
  version: string;
  /** Short git sha of the deployed build, surfaced in the sidebar footer. */
  gitSha: string;
  isLocal: boolean;
}

let config: AppConfig | null = null;

async function getParam(ssm: SSMClient, name: string, decrypt: boolean): Promise<string> {
  const result = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: decrypt }));
  return result.Parameter!.Value!;
}

// Build identity comes from the env in AWS (set by CDK). For local dev the
// env is absent, so fall back to the working tree — package.json + git sha.
function localPkgVersion(): string | undefined {
  try {
    return JSON.parse(readFileSync('package.json', 'utf8')).version as string;
  } catch {
    return undefined;
  }
}

function localGitSha(): string | undefined {
  try {
    return execSync('git rev-parse --short=8 HEAD').toString().trim();
  } catch {
    return undefined;
  }
}

/**
 * Loads configuration once at startup. Non-secret values come from the
 * environment (set by CDK in AWS, by .env/direnv locally). Secrets come from
 * SSM under /gzweb/{app}/{stage}/* in AWS, or plain env vars locally.
 */
export async function loadConfig(): Promise<AppConfig> {
  if (config) return config;

  const appName = process.env.APP_NAME || 'gzops';
  const stage = process.env.STAGE || 'dev';
  const isLocal = !process.env.AWS_LAMBDA_FUNCTION_NAME;

  let jwtSecret = process.env.JWT_SECRET;
  let googleClientId = process.env.GOOGLE_CLIENT_ID;
  let googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  // The BFF signs SigV4 against the API's regional execute-api endpoint — IAM
  // auth fails through the CloudFront custom domain (signed-Host mismatch). In
  // AWS the endpoint comes from SSM (authoritative — reconfigurable without a
  // redeploy), overriding the CDK-set env; local dev uses the env/default.
  let platformBaseUrl = process.env.PLATFORM_BASE_URL;

  if (!isLocal || !jwtSecret || !googleClientId || !googleClientSecret) {
    const ssm = new SSMClient({});
    const prefix = `/gzweb/${appName}/${stage}`;
    const [j, ci, cs, pb] = await Promise.all([
      jwtSecret ?? getParam(ssm, `${prefix}/jwt_secret`, true),
      googleClientId ?? getParam(ssm, `${prefix}/google_client_id`, false),
      googleClientSecret ?? getParam(ssm, `${prefix}/google_client_secret`, true),
      isLocal ? Promise.resolve('') : getParam(ssm, `${prefix}/platform_base_url`, false).catch(() => ''),
    ]);
    jwtSecret = j;
    googleClientId = ci;
    googleClientSecret = cs;
    if (pb) platformBaseUrl = pb; // SSM wins over the CDK env when set
  }

  config = {
    appName,
    stage,
    baseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
    allowedDomains: (process.env.ALLOWED_DOMAINS || 'bioliteenergy.com')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean),
    seedAdminEmail: process.env.SEED_ADMIN_EMAIL || null,
    jwtSecret,
    googleClientId,
    googleClientSecret,
    tablePrefix: process.env.TABLE_PREFIX || `gzweb-${stage}-${appName}-`,
    storeMode: (process.env.STORE_MODE as 'dynamo' | 'memory') || (isLocal ? 'memory' : 'dynamo'),
    platformBaseUrl: platformBaseUrl || 'https://gzops-api-dev.goalzeroapp.com',
    platformMode: (process.env.PLATFORM_MODE as 'live' | 'fake') || (isLocal ? 'fake' : 'live'),
    version: process.env.APP_VERSION || localPkgVersion() || 'dev',
    gitSha: process.env.GIT_SHA || localGitSha() || 'local',
    isLocal,
  };
  return config;
}

export function getConfig(): AppConfig {
  if (!config) throw new Error('loadConfig() must complete before getConfig()');
  return config;
}
