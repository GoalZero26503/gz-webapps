import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import { artifactsFor, platform } from '../platform/client.js';
import { ENVS, type Env, type Project } from '../platform/types.js';
import { programs as programsTable } from '../store/repo.js';
import type { Program } from '../store/types.js';
import { chrome } from '../views/chrome.js';
import { programHealth } from '../views/helpers.js';

const PAGE_SIZE = 6;

const byId = (projects: Project[]): Record<string, Project> =>
  Object.fromEntries(projects.map((p) => [p.id, p]));

interface ProgramCard {
  id: string;
  name: string;
  description: string;
  status: Program['status'];
  chips: { name: string }[];
  health: { failed: number; deploying: number };
}

function buildCards(progs: Program[], projects: Record<string, Project>): ProgramCard[] {
  return progs.map((pr) => ({
    id: pr.id,
    name: pr.name,
    description: pr.description,
    status: pr.status,
    chips: pr.sections.map((s) => ({ name: projects[s.projectId]?.name ?? s.projectId })),
    health: programHealth(pr.sections, projects),
  }));
}

/** Shared filtering for the dashboard overview (full page + HTMX search). */
async function overviewData(query: { q?: string; status?: string; page?: string }, canEdit: boolean) {
  const allPrograms = await programsTable().list();
  // Only the projects referenced by programs appear on the overview — enrich
  // just those (live env-state) instead of fanning out for every platform project.
  const memberIds = [...new Set(allPrograms.flatMap((pr) => pr.sections.map((s) => s.projectId)))];
  const projects = await platform.getProjectsByIds(memberIds, { withState: true });
  const projById = byId(projects);

  const q = (query.q ?? '').toLowerCase();
  const statusFilter = query.status ?? 'all';
  const page = Math.max(1, parseInt(query.page ?? '1', 10));

  let progs = allPrograms.filter((pr) => canEdit || pr.status === 'published');
  if (statusFilter !== 'all') progs = progs.filter((pr) => pr.status === statusFilter);
  if (q) progs = progs.filter((pr) => pr.name.toLowerCase().includes(q) || (pr.description ?? '').toLowerCase().includes(q));
  progs.sort((a, b) => a.name.localeCompare(b.name));

  const pages = Math.max(1, Math.ceil(progs.length / PAGE_SIZE));
  const pageItems = progs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Portfolio-wide alerts mapped to programs (published only).
  const alerts: { prId: string; prName: string; cls: string; text: string; detail: string }[] = [];
  for (const pr of allPrograms.filter((p) => p.status === 'published')) {
    for (const i of programHealth(pr.sections, projById).issues) {
      if (!alerts.some((a) => a.text === i.text)) alerts.push({ ...i, prId: pr.id, prName: pr.name });
    }
  }

  return {
    cards: buildCards(pageItems, projById),
    total: progs.length,
    alerts,
    q: query.q ?? '',
    statusFilter,
    page,
    pages,
    canEdit,
  };
}

export async function pageRoutes(app: FastifyInstance): Promise<void> {
  // ── Dashboard area ──────────────────────────────────────
  app.get<{ Querystring: { q?: string; status?: string; page?: string } }>('/', { preHandler: requireAuth }, async (request, reply) => {
    const canEdit = request.user!.permissions.includes('programs:write');
    return reply.view('dashboard.eta', {
      ...(await chrome(request, 'dashboard', 'overview')),
      ...(await overviewData(request.query, canEdit)),
    });
  });

  app.get<{ Querystring: { q?: string; status?: string; page?: string } }>('/dashboard/search', { preHandler: requireAuth }, async (request, reply) => {
    const canEdit = request.user!.permissions.includes('programs:write');
    return reply.view('partials/program-cards.eta', await overviewData(request.query, canEdit));
  });

  app.get<{ Params: { id: string } }>('/dashboard/:id', { preHandler: requireAuth }, async (request, reply) => {
    const program = await programsTable().get(request.params.id);
    if (!program) return reply.code(404).view('not-found.eta', { ...(await chrome(request, 'dashboard', '')), title: 'Not found', what: 'Program' });
    const memberIds = [...new Set(program.sections.map((sec) => sec.projectId))];
    const [projects, deployments] = await Promise.all([
      platform.getProjectsByIds(memberIds, { withState: true }),
      platform.listDeploymentsAcross(memberIds),
    ]);
    const projById = byId(projects);
    return reply.view('program-dashboard.eta', {
      ...(await chrome(request, 'dashboard', program.id)),
      title: program.name,
      program,
      projectsById: projById,
      deployments,
      health: programHealth(program.sections, projById),
      inflight: deployments.filter((d) => d.status === 'in_progress').length,
      failures: deployments.filter((d) => d.status === 'failed').length,
      canEdit: request.user!.permissions.includes('programs:write'),
    });
  });

  // ── CI/CD area ──────────────────────────────────────────
  app.get('/cicd/programs', { preHandler: requireAuth }, async (request, reply) => {
    const programs = (await programsTable().list()).sort((a, b) => a.name.localeCompare(b.name));
    return reply.view('programs.eta', {
      ...(await chrome(request, 'cicd', 'programs')),
      title: 'Programs',
      programs,
      canEdit: request.user!.permissions.includes('programs:write'),
    });
  });

  app.get<{ Querystring: { q?: string; type?: string } }>('/cicd/projects', { preHandler: requireAuth }, async (request, reply) => {
    return reply.view('projects.eta', {
      ...(await chrome(request, 'cicd', 'projects')),
      title: 'Projects',
      ...(await projectsData(request.query)),
    });
  });

  app.get<{ Querystring: { q?: string; type?: string } }>('/cicd/projects/search', { preHandler: requireAuth }, async (request, reply) => {
    return reply.view('partials/project-rows.eta', await projectsData(request.query));
  });

  app.get<{ Params: { id: string }; Querystring: { tab?: string } }>('/cicd/projects/:id', { preHandler: requireAuth }, async (request, reply) => {
    const [project, deployments] = await Promise.all([
      platform.getProject(request.params.id),
      platform.listDeployments({ projectId: request.params.id }),
    ]);
    if (!project) return reply.code(404).view('not-found.eta', { ...(await chrome(request, 'cicd', 'projects')), title: 'Not found', what: 'Project' });
    const tab = request.query.tab === 'builds' ? 'builds' : 'deployment';
    // The component matrix only references this project's own (already-enriched)
    // state; no need to fan out env-state for every platform project.
    const projects = [project];
    const latestByEnv: Partial<Record<Env, string>> = {};
    for (const e of ENVS) {
      const d = deployments.find((x) => x.env === e);
      if (d) latestByEnv[e] = d.id;
    }
    return reply.view('project-detail.eta', {
      ...(await chrome(request, 'cicd', 'projects')),
      title: project.name,
      project,
      projectsById: byId(projects),
      deployments,
      latestByEnv,
      artifacts: artifactsFor(project),
      tab,
      canDeploy: request.user!.permissions.includes('deploys:create'),
    });
  });

  app.get<{ Querystring: { env?: string } }>('/cicd/environments', { preHandler: requireAuth }, async (request, reply) => {
    const env = (ENVS as readonly string[]).includes(request.query.env ?? '') ? (request.query.env as Env) : 'beta';
    return reply.view('environments.eta', {
      ...(await chrome(request, 'cicd', 'environments')),
      title: 'Environments',
      env,
      rows: await platform.listEnvironment(env),
    });
  });

  app.get('/cicd/deployments', { preHandler: requireAuth }, async (request, reply) => {
    const projects = await platform.listProjects();
    const deployments = await platform.listDeploymentsAcross(projects.map((p) => p.id));
    return reply.view('deployments.eta', {
      ...(await chrome(request, 'cicd', 'deployments')),
      title: 'Deployments',
      deployments,
      projectsById: byId(projects),
    });
  });

  app.get<{ Params: { id: string } }>('/cicd/deployments/:id', { preHandler: requireAuth }, async (request, reply) => {
    const deployment = await platform.getDeployment(request.params.id);
    if (!deployment) return reply.code(404).view('not-found.eta', { ...(await chrome(request, 'cicd', 'deployments')), title: 'Not found', what: 'Deployment' });
    const project = await platform.getProject(deployment.projectId);
    return reply.view('deployment-detail.eta', {
      ...(await chrome(request, 'cicd', 'deployments')),
      title: `Deploy ${deployment.version}`,
      deployment,
      project,
    });
  });

  app.get('/cicd/access-groups', { preHandler: requireAuth }, async (request, reply) => {
    return reply.view('access-groups.eta', {
      ...(await chrome(request, 'cicd', 'access-groups')),
      title: 'Access Groups',
      groups: await platform.listAccessGroups(),
      canEdit: request.user!.permissions.includes('programs:write'),
    });
  });
}

async function projectsData(query: { q?: string; type?: string }) {
  const projects = await platform.listProjects({ withState: true });
  const q = (query.q ?? '').toLowerCase();
  const type = query.type ?? 'all';
  const list = projects.filter(
    (p) => (type === 'all' || p.type.startsWith(type)) && (!q || p.name.toLowerCase().includes(q) || p.id.includes(q)),
  );
  return { projects: list, total: projects.length, q: query.q ?? '', type };
}
