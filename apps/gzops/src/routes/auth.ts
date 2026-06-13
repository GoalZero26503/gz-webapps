import type { FastifyInstance } from 'fastify';
import { buildAuthorizationUrl, completeLogin, type OAuthState } from '../auth/google.js';
import { signJwt, signToken, verifyToken } from '../auth/jwt.js';
import { SESSION_COOKIE } from '../auth/plugin.js';
import { resolvePermissions } from '../auth/rbac.js';
import { getConfig } from '../config.js';
import { addAccessLog, addNotification, newId, requests } from '../store/repo.js';

const OAUTH_COOKIE = 'gz_oauth';
const PENDING_COOKIE = 'gz_pending';
const PENDING_TTL = 900; // 15 min to act on the access-request screen

interface PendingIdentity {
  email: string;
  name: string;
  iat: number;
  exp: number;
}

const LOGIN_ERRORS: Record<string, string> = {
  domain: 'Access is restricted to company Google Workspace accounts.',
  disabled: 'Your account has been disabled. Contact an admin.',
  oauth: 'Sign-in failed. Please try again.',
};

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { return_to?: string; error?: string } }>('/login', async (request, reply) => {
    if (request.user) return reply.redirect('/');
    return reply.view('login.eta', {
      error: request.query.error ? (LOGIN_ERRORS[request.query.error] ?? LOGIN_ERRORS.oauth) : null,
      returnTo: request.query.return_to ?? '/',
    });
  });

  app.get<{ Querystring: { return_to?: string } }>('/auth/login', async (request, reply) => {
    const returnTo = request.query.return_to?.startsWith('/') ? request.query.return_to : '/';
    const { url, oauthState } = buildAuthorizationUrl(returnTo);
    return reply
      .setCookie(OAUTH_COOKIE, JSON.stringify(oauthState), {
        path: '/auth',
        httpOnly: true,
        secure: !getConfig().isLocal,
        sameSite: 'lax',
        maxAge: 600,
      })
      .redirect(url);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/auth/callback', async (request, reply) => {
    const raw = request.cookies[OAUTH_COOKIE];
    reply.clearCookie(OAUTH_COOKIE, { path: '/auth' });

    if (!raw || !request.query.code || !request.query.state) {
      return reply.redirect('/login?error=oauth');
    }

    let oauthState: OAuthState;
    try {
      oauthState = JSON.parse(raw);
    } catch {
      return reply.redirect('/login?error=oauth');
    }
    if (oauthState.state !== request.query.state) {
      return reply.redirect('/login?error=oauth');
    }

    let result;
    try {
      result = await completeLogin(request.query.code, oauthState.codeVerifier);
    } catch (err) {
      request.log.error({ err }, 'OAuth login failed');
      return reply.redirect('/login?error=oauth');
    }

    if (!result.ok) {
      // Domain-passed but not allow-listed → carry the verified identity into
      // the request-access screen via a short-lived signed cookie.
      if (result.reason === 'not-invited') {
        const pending = signToken({ email: result.google.email, name: result.google.name }, PENDING_TTL);
        return reply
          .setCookie(PENDING_COOKIE, pending, { path: '/', httpOnly: true, secure: !getConfig().isLocal, sameSite: 'lax', maxAge: PENDING_TTL })
          .redirect('/request-access');
      }
      return reply.redirect(`/login?error=${result.reason}`);
    }

    const token = signJwt({
      sub: result.google.sub,
      email: result.user.email,
      name: result.user.name ?? result.google.name,
      role: result.user.role,
      permissions: resolvePermissions(result.user.role),
    });

    return reply
      .setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, secure: !getConfig().isLocal, sameSite: 'lax', maxAge: 604800 })
      .redirect(oauthState.returnTo.startsWith('/') ? oauthState.returnTo : '/');
  });

  // ── Request-access flow (403 → request → admin decision) ──
  app.get('/request-access', async (request, reply) => {
    const pending = readPending(request.cookies[PENDING_COOKIE]);
    if (!pending) return reply.redirect('/login');
    const existing = (await requests().list()).find((r) => r.email === pending.email && r.status === 'pending');
    return reply.view('request-access.eta', { identity: pending, alreadyPending: Boolean(existing), submitted: false });
  });

  app.post('/request-access', async (request, reply) => {
    const pending = readPending(request.cookies[PENDING_COOKIE]);
    if (!pending) return reply.redirect('/login');

    const open = (await requests().list()).find((r) => r.email === pending.email && r.status === 'pending');
    if (!open) {
      await requests().put({ id: newId('req'), email: pending.email, name: pending.name, requestedAt: new Date().toISOString(), status: 'pending' });
      await addNotification('admins', `${pending.name} requested access`, '/admin/users');
      await addAccessLog(pending.email, 'requested access', `${pending.name} (${pending.email})`);
    }
    reply.clearCookie(PENDING_COOKIE, { path: '/' });
    return reply.view('request-access.eta', { identity: pending, alreadyPending: true, submitted: true });
  });

  app.post('/auth/logout', async (_request, reply) => {
    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).redirect('/login');
  });

  app.get('/api/me', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
    const { email, name, role, permissions } = request.user;
    return { email, name, role, permissions };
  });
}

function readPending(raw: string | undefined): PendingIdentity | null {
  if (!raw) return null;
  try {
    return verifyToken<PendingIdentity>(raw);
  } catch {
    return null;
  }
}
