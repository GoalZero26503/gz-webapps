import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

export interface AppConfig {
  appName: string;
  stage: string;
  /** Canonical origin for OAuth redirects, e.g. https://myapp.goalzeroapp.com */
  baseUrl: string;
  allowedDomains: string[];
  seedAdminEmail: string | null;
  jwtSecret: string;
  googleClientId: string;
  googleClientSecret: string;
  /** DSQL cluster endpoint host. Empty when DATABASE_URL is set (local dev). */
  dsqlEndpoint: string;
  databaseUrl: string | null;
  isLocal: boolean;
}

let config: AppConfig | null = null;

async function getParam(ssm: SSMClient, name: string, decrypt: boolean): Promise<string> {
  const result = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: decrypt }));
  return result.Parameter!.Value!;
}

/**
 * Loads configuration once at startup. Non-secret values come from the
 * environment (set by CDK in AWS, by .env/direnv locally). Secrets come from
 * SSM under /gzweb/{app}/{stage}/* in AWS, or plain env vars locally.
 */
export async function loadConfig(): Promise<AppConfig> {
  if (config) return config;

  const appName = process.env.APP_NAME || 'hello-fleet';
  const stage = process.env.STAGE || 'dev';
  const isLocal = !process.env.AWS_LAMBDA_FUNCTION_NAME;

  let jwtSecret = process.env.JWT_SECRET;
  let googleClientId = process.env.GOOGLE_CLIENT_ID;
  let googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!jwtSecret || !googleClientId || !googleClientSecret) {
    const ssm = new SSMClient({});
    const prefix = `/gzweb/${appName}/${stage}`;
    [jwtSecret, googleClientId, googleClientSecret] = await Promise.all([
      getParam(ssm, `${prefix}/jwt_secret`, true),
      getParam(ssm, `${prefix}/google_client_id`, false),
      getParam(ssm, `${prefix}/google_client_secret`, true),
    ]);
  }

  config = {
    appName,
    stage,
    baseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
    allowedDomains: (process.env.ALLOWED_DOMAINS || 'bioliteenergy.com,goalzero.com')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean),
    seedAdminEmail: process.env.SEED_ADMIN_EMAIL || null,
    jwtSecret,
    googleClientId,
    googleClientSecret,
    dsqlEndpoint: process.env.DSQL_ENDPOINT || '',
    databaseUrl: process.env.DATABASE_URL || null,
    isLocal,
  };
  return config;
}

export function getConfig(): AppConfig {
  if (!config) throw new Error('loadConfig() must complete before getConfig()');
  return config;
}
