import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import { Eta } from 'eta';
import Fastify, { type FastifyInstance } from 'fastify';
import { authPlugin } from './auth/plugin.js';
import { getConfig } from './config.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { deployRoutes } from './routes/deploy.js';
import { notificationRoutes } from './routes/notifications.js';
import { pageRoutes } from './routes/pages.js';
import { programRoutes } from './routes/programs.js';
import { viewHelpers } from './views/helpers.js';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: getConfig().isLocal ? 'debug' : 'info' },
    trustProxy: true, // behind CloudFront + Lambda Web Adapter
  });

  app.register(fastifyCookie);
  app.register(fastifyFormbody);
  app.register(fastifyView, {
    engine: { eta: new Eta() },
    root: path.join(rootDir, 'views'),
    viewExt: 'eta',
    // Helpers (rails, badges, timeAgo, …) are stateless, so they ride in the
    // default context and every template can call them as `<%~ it.rail(...) %>`.
    defaultContext: { appName: getConfig().appName, stage: getConfig().stage, ...viewHelpers },
  });
  // no-cache + ETag: bundles aren't content-hashed, so clients must
  // revalidate (cheap 304s) rather than serve stale JS after a deploy
  app.register(fastifyStatic, {
    root: path.join(rootDir, 'public'),
    prefix: '/',
    wildcard: false,
    cacheControl: true,
    maxAge: 0,
  });

  app.register(authPlugin);
  app.register(authRoutes);
  app.register(pageRoutes);
  app.register(programRoutes);
  app.register(deployRoutes);
  app.register(adminRoutes);
  app.register(notificationRoutes);

  app.get('/healthz', async () => ({ ok: true }));

  return app;
}
