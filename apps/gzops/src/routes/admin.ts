import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../auth/plugin.js';
import { canAssignRole } from '../auth/rbac.js';
import { APP_ROLES, type AppRole } from '../auth/types.js';
import {
  addAccessLog,
  addNotification,
  recentAccessLog,
  requests,
  users,
} from '../store/repo.js';
import type { AccessRequest } from '../store/types.js';
import { chrome } from '../views/chrome.js';

function isRole(value: string): value is AppRole {
  return (APP_ROLES as readonly string[]).includes(value);
}

/** Everything the admin body partial + page need (pending queue, users, log). */
async function adminBodyData() {
  const [allRequests, allUsers, log] = await Promise.all([
    requests().list(),
    users().list(),
    recentAccessLog(),
  ]);
  return {
    pending: allRequests.filter((r) => r.status === 'pending').sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1)),
    users: allUsers.sort((a, b) => a.email.localeCompare(b.email)),
    accessLog: log,
  };
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/users', { preHandler: requirePermission('users:read') }, async (request, reply) => {
    return reply.view('admin-users.eta', {
      ...(await chrome(request, 'admin', 'users')),
      title: 'Users & Access',
      ...(await adminBodyData()),
      me: request.user!.email,
    });
  });

  app.post<{ Params: { id: string }; Body: { role?: string } }>(
    '/admin/requests/:id/approve',
    { preHandler: requirePermission('users:write') },
    async (request, reply) => {
      const all = await requests().list();
      const req = all.find((r) => r.id === request.params.id);
      const role = request.body.role ?? 'viewer';
      if (req && req.status === 'pending' && isRole(role) && canAssignRole(request.user!.role, role)) {
        await users().put({ email: req.email, name: req.name, role, status: 'active', addedBy: request.user!.email, addedAt: new Date().toISOString() });
        await markDecided(req, 'approved', request.user!.email);
        await addNotification(req.email, `Your access request was approved (${role}).`, '/');
        await addAccessLog(request.user!.email, 'approved request', `${req.email} as ${role}`);
      }
      return reply.view('partials/admin-body.eta', { ...(await adminBodyData()), me: request.user!.email });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/requests/:id/deny',
    { preHandler: requirePermission('users:write') },
    async (request, reply) => {
      const all = await requests().list();
      const req = all.find((r) => r.id === request.params.id);
      if (req && req.status === 'pending') {
        await markDecided(req, 'denied', request.user!.email);
        await addNotification(req.email, 'Your access request was denied. You may request again.');
        await addAccessLog(request.user!.email, 'denied request', req.email);
      }
      return reply.view('partials/admin-body.eta', { ...(await adminBodyData()), me: request.user!.email });
    },
  );

  app.post<{ Params: { email: string }; Body: { role?: string } }>(
    '/admin/users/:email/role',
    { preHandler: requirePermission('users:write') },
    async (request, reply) => {
      const email = decodeURIComponent(request.params.email);
      const role = request.body.role ?? '';
      const user = await users().get(email);
      if (user && email !== request.user!.email && isRole(role) && canAssignRole(request.user!.role, role)) {
        await users().put({ ...user, role });
        await addAccessLog(request.user!.email, 'changed role', `${email} → ${role}`);
      }
      return reply.view('partials/admin-body.eta', { ...(await adminBodyData()), me: request.user!.email });
    },
  );

  app.post<{ Params: { email: string } }>(
    '/admin/users/:email/remove',
    { preHandler: requirePermission('users:write') },
    async (request, reply) => {
      const email = decodeURIComponent(request.params.email);
      if (email !== request.user!.email) {
        await users().delete(email);
        await addAccessLog(request.user!.email, 'removed user', email);
      }
      return reply.view('partials/admin-body.eta', { ...(await adminBodyData()), me: request.user!.email });
    },
  );
}

async function markDecided(req: AccessRequest, status: 'approved' | 'denied', by: string): Promise<void> {
  await requests().put({ ...req, status, decidedBy: by, decidedAt: new Date().toISOString() });
}
