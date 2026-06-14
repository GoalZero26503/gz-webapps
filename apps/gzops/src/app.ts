import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCompress from '@fastify/compress';
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

  // Compress responses at the origin (HTML + JS/CSS). CloudFront caches the
  // compressed static responses; for the dynamic HTML (no CDN cache) this is the
  // only place compression can happen. Cuts the 95KB vendor CSS et al. ~5–8×.
  app.register(fastifyCompress, { global: true, encodings: ['br', 'gzip'], threshold: 1024 });

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
  // Cache static assets so they stop revalidating on every page load (the old
  // max-age=0 forced a CloudFront→Lambda round-trip per asset per navigation).
  // Bundles aren't content-hashed, so app-owned assets (app.js, styles.css) use
  // a short TTL — revalidation-free within a session, refreshed soon after a
  // deploy — while versioned third-party libs under /vendor cache for a day.
  app.register(fastifyStatic, {
    root: path.join(rootDir, 'public'),
    prefix: '/',
    wildcard: false,
    cacheControl: false,
    setHeaders(res, filePath) {
      const maxAge = filePath.includes(`${path.sep}vendor${path.sep}`) ? 86_400 : 600;
      res.setHeader('cache-control', `public, max-age=${maxAge}`);
    },
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
