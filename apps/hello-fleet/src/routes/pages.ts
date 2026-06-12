import type { FastifyInstance } from 'fastify';
import { requireAuth, requirePermission } from '../auth/plugin.js';
import { getDb } from '../db/client.js';
import { getConfig } from '../config.js';

export async function pageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    return reply.view('index.eta', {
      user: request.user,
      appName: getConfig().appName,
      stage: getConfig().stage,
    });
  });

  app.get('/users', { preHandler: requirePermission('users:read') }, async (request, reply) => {
    const allUsers = await getDb().query.users.findMany();
    return reply.view('users.eta', { user: request.user, users: allUsers });
  });
}
