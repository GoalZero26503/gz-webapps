import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../auth/plugin.js';
import { platform } from '../platform/client.js';
import { ENVS, type Env } from '../platform/types.js';
import { addNotification, notifications } from '../store/repo.js';

/**
 * Deploy action + live progress tile.
 *
 * SHIPPED: HTMX polling (`/tile`, re-fetched every ~1.5s until terminal). It is
 * robust through CloudFront, whose managed cache policies buffer
 * `text/event-stream`, so a naive SSE tile would stall behind the CDN.
 *
 * SPIKE: `/stream` is a working Server-Sent-Events endpoint (the brief's SSE
 * spike). It streams correctly from the Lambda Web Adapter once the Function
 * URL runs in RESPONSE_STREAM mode (set in CDK). Wiring it end-to-end through
 * CloudFront needs a dedicated no-buffer behavior for `/cicd/deployments/*\/stream`
 * — deferred; the UI uses polling. (Decision recorded in the PR description.)
 */
function isEnv(v: string): v is Env {
  return (ENVS as readonly string[]).includes(v);
}

export async function deployRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { projectId?: string; version?: string; env?: string } }>(
    '/cicd/deploy',
    { preHandler: requirePermission('deploys:create') },
    async (request, reply) => {
      const { projectId, version, env } = request.body;
      if (!projectId || !version || !env || !isEnv(env)) {
        return reply.code(400).send('Invalid deploy request');
      }
      const deployment = await platform.createDeployment({ projectId, version, env, by: request.user!.email });
      return reply.view('partials/deploy-tile.eta', { deployment });
    },
  );

  app.get<{ Params: { id: string } }>('/cicd/deployments/:id/tile', { preHandler: requirePermission('deploys:create') }, async (request, reply) => {
    const deployment = await platform.getDeployment(request.params.id);
    if (!deployment) return reply.code(404).send('');
    if (deployment.status === 'succeeded') await notifyOnce(request.user!.email, deployment.id, `Deploy ${deployment.version} → ${deployment.env} succeeded`);
    return reply.view('partials/deploy-tile.eta', { deployment });
  });

  // ── SSE spike (see file header) ──────────────────────────
  app.get<{ Params: { id: string } }>('/cicd/deployments/:id/stream', { preHandler: requirePermission('deploys:create') }, async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const tick = async (): Promise<boolean> => {
      const d = await platform.getDeployment(request.params.id);
      if (!d) {
        send('error', { message: 'not found' });
        return true;
      }
      send('progress', { id: d.id, status: d.status, progress: d.progress ?? 0 });
      return d.status !== 'in_progress' && d.status !== 'pending';
    };

    if (await tick()) return reply.raw.end();
    const interval = setInterval(() => {
      void tick().then((done) => {
        if (done) {
          clearInterval(interval);
          reply.raw.end();
        }
      });
    }, 1000);
    request.raw.on('close', () => clearInterval(interval));
  });
}

/** Add a deploy-completion notification at most once per deployment. */
async function notifyOnce(to: string, deploymentId: string, text: string): Promise<void> {
  const tag = `[${deploymentId}]`;
  const existing = await notifications().list();
  if (existing.some((n) => n.to === to && n.text.includes(tag))) return;
  await addNotification(to, `${text} ${tag}`, `/cicd/deployments/${deploymentId}`);
}
