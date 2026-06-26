import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

/**
 * Cache-busting asset URLs. App-owned bundles (app.js, styles.css) have stable
 * filenames, so a deploy that changes them would otherwise be masked by the
 * browser's cached copy. Stamp `?v=<content-hash>` (computed once at boot) so the
 * URL changes exactly when the file's bytes change — a deploy is picked up
 * immediately, and unchanged files keep their cache. Hashing the content (not a
 * git sha / mtime) needs no build-time env var and never busts on a no-op rebuild.
 */
const assetVersions = new Map<string, string>();
function assetUrl(rel: string): string {
  let v = assetVersions.get(rel);
  if (v === undefined) {
    try {
      v = createHash('sha1').update(readFileSync(path.join(rootDir, 'public', rel))).digest('hex').slice(0, 10);
    } catch {
      v = ''; // file not found (shouldn't happen in a built image) → no query
    }
    assetVersions.set(rel, v);
  }
  return v ? `${rel}?v=${v}` : rel;
}

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
    defaultContext: {
      appName: getConfig().appName,
      stage: getConfig().stage,
      version: getConfig().version,
      gitSha: getConfig().gitSha,
      assetUrl,
      ...viewHelpers,
    },
  });
  // Cache static assets so they stop revalidating on every page load (the old
  // max-age=0 forced a CloudFront→Lambda round-trip per asset per navigation).
  // app.js / styles.css are referenced via assetUrl() with a content-hash query, so
  // their URL changes whenever they change — they can cache immutably for a year
  // (a deploy is picked up by the new ?v=, never a stale copy). Versioned third-party
  // libs under /vendor cache for a day; everything else (favicon, etc.) keeps a short TTL.
  app.register(fastifyStatic, {
    root: path.join(rootDir, 'public'),
    prefix: '/',
    wildcard: false,
    cacheControl: false,
    setHeaders(res, filePath) {
      const isHashed = /(?:app\.js|styles\.css)$/.test(filePath);
      const cacheControl = isHashed
        ? 'public, max-age=31536000, immutable'
        : filePath.includes(`${path.sep}vendor${path.sep}`)
          ? 'public, max-age=86400'
          : 'public, max-age=600';
      res.setHeader('cache-control', cacheControl);
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
