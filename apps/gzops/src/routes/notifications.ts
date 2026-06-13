import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import { markNotificationsRead } from '../store/repo.js';

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  // Bell "mark all read" — clears unread for the current user, returns to referer.
  app.post('/notifications/read', { preHandler: requireAuth }, async (request, reply) => {
    await markNotificationsRead(request.user!);
    const back = request.headers.referer && request.headers.referer.startsWith('http') ? request.headers.referer : '/';
    return reply.redirect(back);
  });
}
