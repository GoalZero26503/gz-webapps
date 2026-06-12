import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { requirePermission } from '../auth/plugin.js';
import { canAssignRole } from '../auth/rbac.js';
import { APP_ROLES, type AppRole } from '../auth/types.js';
import { getDb } from '../db/client.js';
import { users } from '../db/schema.js';

function isRole(value: string): value is AppRole {
  return (APP_ROLES as readonly string[]).includes(value);
}

/**
 * User-management endpoints. These are HTMX endpoints: they take form bodies
 * and return rendered HTML fragments (partials), not JSON.
 */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { email: string; role: string } }>(
    '/users/invite',
    { preHandler: requirePermission('users:invite') },
    async (request, reply) => {
      const db = getDb();
      // HTMX swaps the whole #users-section, so errors render as part of it
      // (4xx responses would not be swapped at all).
      const section = async (error: string | null) =>
        reply.view('partials/users-section.eta', {
          user: request.user,
          users: await db.query.users.findMany(),
          error,
        });

      const email = request.body.email?.trim().toLowerCase();
      const role = request.body.role;
      if (!email || !email.includes('@')) return section('A valid email is required.');
      if (!isRole(role) || !canAssignRole(request.user!.role, role)) {
        return section('You cannot assign that role.');
      }
      if (await db.query.users.findFirst({ where: eq(users.email, email) })) {
        return section(`${email} is already invited.`);
      }

      await db.insert(users).values({ email, role, invitedBy: request.user!.email });
      return section(null);
    },
  );

  app.post<{ Params: { email: string }; Body: { role: string } }>(
    '/users/:email/role',
    { preHandler: requirePermission('users:write') },
    async (request, reply) => {
      const role = request.body.role;
      if (!isRole(role) || !canAssignRole(request.user!.role, role)) {
        return reply.code(400).send({ error: 'You cannot assign that role' });
      }

      const db = getDb();
      const [updated] = await db
        .update(users)
        .set({ role })
        .where(eq(users.email, request.params.email))
        .returning();
      if (!updated) return reply.code(404).send({ error: 'User not found' });

      return reply.view('partials/user-row.eta', { user: request.user, row: updated });
    },
  );

  app.delete<{ Params: { email: string } }>(
    '/users/:email',
    { preHandler: requirePermission('users:delete') },
    async (request, reply) => {
      if (request.params.email === request.user!.email) {
        return reply.code(400).send({ error: 'You cannot delete yourself' });
      }
      await getDb().delete(users).where(eq(users.email, request.params.email));
      // HTMX removes the row when the response body is empty
      return reply.code(200).send('');
    },
  );
}
