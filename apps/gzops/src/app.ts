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
 * Map a logical asset path (e.g. /assets/app.js) to its content-hashed filename
 * (e.g. /assets/app.<hash>.js), built by scripts/hash-assets.mjs into
 * public/assets/manifest.json. Hashed FILENAMES (not a ?v= query on a stable name)
 * are required behind a Lambda fleet + CloudFront: a hashed filename can never be
 * served stale bytes (an old instance 404s a name it doesn't have) and changing the
 * filename busts every cached copy. Falls back to the logical path if the manifest
 * is missing (e.g. local dev before a build).
 */
const ASSET_MANIFEST: Record<string, string> = (() => {
  try {
    return JSON.parse(readFileSync(path.join(rootDir, 'public', 'assets', 'manifest.json'), 'utf8'));
  } catch {
    return {};
  }
})();
function assetUrl(rel: string): string {
  return ASSET_MANIFEST[rel] ?? rel;
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
  // Content-hashed assets (app.<hash>.js, styles.<hash>.css — the names the manifest
  // points at) cache immutably for a year: the filename IS the content, so it can
  // never be stale. Versioned third-party libs under /vendor cache for a day. The
  // un-hashed originals (bare app.js/styles.css) + everything else (favicon) get a
  // short TTL — they're never referenced by the page but stay self-healing if hit.
  const HASHED = /\.[0-9a-f]{10}\.(?:js|css)$/;
  app.register(fastifyStatic, {
    root: path.join(rootDir, 'public'),
    prefix: '/',
    wildcard: false,
    cacheControl: false,
    setHeaders(res, filePath) {
      const cacheControl = HASHED.test(filePath)
        ? 'public, max-age=31536000, immutable'
        : filePath.includes(`${path.sep}vendor${path.sep}`)
          ? 'public, max-age=86400'
          : 'public, max-age=300';
      res.setHeader('cache-control', cacheControl);
    },
  });

  // SSR HTML (full pages + HTMX partials) must never be cached: it embeds the
  // content-hashed asset URLs, so a stale HTML doc would keep pointing at an old
  // bundle (defeating the cache-bust) — and it's per-user authed content. Mark every
  // text/html response no-store unless a route set its own cache policy.
  app.addHook('onSend', async (_req, reply, payload) => {
    const ct = reply.getHeader('content-type');
    if (typeof ct === 'string' && ct.includes('text/html') && !reply.getHeader('cache-control')) {
      reply.header('cache-control', 'no-store');
    }
    return payload;
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
