import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { verifyJwt } from './jwt.js';
import { hasPermission } from './rbac.js';
import type { AppJwtPayload, Permission } from './types.js';

export const SESSION_COOKIE = 'gz_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: AppJwtPayload | null;
  }
}

function isHtmlNavigation(request: FastifyRequest): boolean {
  // HTMX fragment requests and API calls get status codes; full-page
  // navigations get redirected to /login.
  return request.method === 'GET' && !request.headers['hx-request'] && !request.url.startsWith('/api/');
}

/** preHandler: requires a valid session. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.user) return;
  if (isHtmlNavigation(request)) {
    return reply.redirect(`/login?return_to=${encodeURIComponent(request.url)}`);
  }
  return reply.code(401).send({ error: 'Authentication required' });
}

/** preHandler factory: requires a valid session holding a specific permission. */
export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    if (!hasPermission(request.user!, permission)) {
      return reply.code(403).send({ error: 'Insufficient permissions' });
    }
  };
}

/**
 * Decorates every request with `request.user`, parsed from the session
 * cookie. Invalid or expired sessions resolve to null — enforcement happens
 * in requireAuth/requirePermission.
 */
export const authPlugin = fp(async (app) => {
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    try {
      request.user = verifyJwt(token);
    } catch {
      request.user = null;
    }
  });
});
