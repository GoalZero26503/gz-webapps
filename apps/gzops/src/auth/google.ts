import { createHash, randomBytes } from 'node:crypto';
import { getConfig } from '../config.js';
import { ensureSeeded, users } from '../store/repo.js';
import type { AppUser } from '../store/types.js';

export interface OAuthState {
  state: string;
  codeVerifier: string;
  returnTo: string;
}

export interface GoogleIdPayload {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  hd?: string;
}

export function buildAuthorizationUrl(returnTo: string): { url: string; oauthState: OAuthState } {
  const config = getConfig();
  const state = randomBytes(16).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: `${config.baseUrl}/auth/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    oauthState: { state, codeVerifier, returnTo },
  };
}

async function exchangeCode(code: string, codeVerifier: string): Promise<GoogleIdPayload> {
  const config = getConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: `${config.baseUrl}/auth/callback`,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${await response.text()}`);
  }

  const tokens = (await response.json()) as { id_token: string };
  // No signature verification needed: the token came directly from Google over TLS.
  return JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64').toString());
}

export type LoginResult =
  | { ok: true; user: AppUser; google: GoogleIdPayload }
  | { ok: false; reason: 'domain' }
  | { ok: false; reason: 'disabled' }
  | { ok: false; reason: 'not-invited'; google: GoogleIdPayload };

/**
 * Completes the OAuth flow: exchanges the code, then applies the two access
 * gates — Google Workspace domain (hd claim) and the per-user allow-list. The
 * seed admin (SEED_ADMIN_EMAIL) is bootstrapped on first login so a fresh
 * deployment is never locked out. A passed-domain but not-allow-listed user
 * gets their verified identity back so the caller can offer "request access".
 */
export async function completeLogin(code: string, codeVerifier: string): Promise<LoginResult> {
  const config = getConfig();
  const google = await exchangeCode(code, codeVerifier);

  if (!google.hd || !config.allowedDomains.includes(google.hd)) {
    return { ok: false, reason: 'domain' };
  }

  await ensureSeeded();
  const table = users();
  let user = await table.get(google.email);

  if (!user && config.seedAdminEmail && google.email === config.seedAdminEmail) {
    user = { email: google.email, name: google.name, role: 'admin', status: 'active', addedBy: 'system', addedAt: new Date().toISOString() };
  }

  if (!user) return { ok: false, reason: 'not-invited', google };
  if (user.status !== 'active') return { ok: false, reason: 'disabled' };

  user = { ...user, name: google.name, googleSub: google.sub, lastLoginAt: new Date().toISOString() };
  await table.put(user);

  return { ok: true, user, google };
}
