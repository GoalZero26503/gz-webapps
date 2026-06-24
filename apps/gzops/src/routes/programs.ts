import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requirePermission } from '../auth/plugin.js';
import { platform } from '../platform/client.js';
import type { Project, ProjectType } from '../platform/types.js';
import { newId, programs as programsTable } from '../store/repo.js';
import type { Program, ProgramMilestone, ProgramSection } from '../store/types.js';
import { chrome } from '../views/chrome.js';
import { milestonesSection } from '../views/helpers.js';

/** Facet options offered per project type in the program editor. */
export const FACETS: Record<ProjectType, { id: string; label: string }[]> = {
  'firmware-kit': [
    { id: 'channels', label: 'Manifest channels rail' },
    { id: 'components', label: 'Component drill-down' },
    { id: 'activity', label: 'Deploy activity' },
  ],
  cloud: [
    { id: 'rail', label: 'Promotion rail' },
    { id: 'health', label: 'Health' },
    { id: 'activity', label: 'Deploy activity' },
  ],
  mobile: [
    { id: 'envs', label: 'Per-env versions' },
    { id: 'stores', label: 'Store distribution' },
    { id: 'groups', label: 'Access groups' },
    { id: 'activity', label: 'Deploy activity' },
  ],
  'firmware-node': [
    { id: 'rail', label: 'Promotion rail' },
    { id: 'activity', label: 'Deploy activity' },
  ],
};

const slugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'program';

const GH_ORG = 'GoalZero26503';

/** "github.com/Owner/Name" | "Owner/Name" | "Name" → "Owner/Name" (org-defaulted). */
function normalizeRepo(raw: string): string | null {
  const c = raw.replace(/^https?:\/\//, '').replace(/^github\.com\//, '').replace(/\.git$/, '').trim();
  const parts = c.split('/').filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return `${GH_ORG}/${parts[0]}`;
  return parts.slice(-2).join('/');
}

/**
 * Resolve a program's release-sync surface from its sections: every section's
 * repo, with firmware-kit sections expanded to their component node repos (from
 * the kit's deploy-config). The Release issue is hosted in the first firmware-kit
 * repo (else the first member repo).
 */
export async function resolveReleaseRepos(
  program: Program,
  projects: Project[],
): Promise<{ memberRepos: string[]; releaseRepo: string | null }> {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const repos = new Set<string>();
  let releaseRepo: string | null = null;
  for (const sec of program.sections) {
    const proj = byId.get(sec.projectId);
    if (!proj?.repo) continue;
    const norm = normalizeRepo(proj.repo);
    if (norm) repos.add(norm);
    if (proj.type === 'firmware-kit') {
      if (!releaseRepo && norm) releaseRepo = norm;
      const dc = await platform.getDeployConfig(proj.id).catch(() => null);
      for (const c of dc?.kit?.components ?? []) {
        const nodeRepo = byId.get(c.project)?.repo;
        const n = nodeRepo ? normalizeRepo(nodeRepo) : null;
        if (n) repos.add(n);
      }
    }
  }
  if (!releaseRepo && repos.size) releaseRepo = [...repos][0];
  return { memberRepos: [...repos], releaseRepo };
}

/** Render the milestones section (the HTMX swap target) for a program. */
async function renderMilestones(reply: FastifyReply, program: Program, flash?: string): Promise<FastifyReply> {
  const projects = await platform.listProjects();
  const { memberRepos, releaseRepo } = await resolveReleaseRepos(program, projects);
  return reply.type('text/html').send(milestonesSection(program, { memberRepos, releaseRepo, canEdit: true, flash }));
}

/** First unused key from a base slug (key, key-2, key-3, …). */
function uniqueKey(base: string, existing: ProgramMilestone[]): string {
  const used = new Set(existing.map((m) => m.key));
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

interface EditorForm {
  name: string;
  description: string;
  published: boolean;
  sections: ProgramSection[];
}

function parseEditorBody(body: Record<string, unknown>): EditorForm {
  let sections: ProgramSection[] = [];
  try {
    sections = JSON.parse(String(body.sectionsJson ?? '[]'));
  } catch {
    sections = [];
  }
  return {
    name: String(body.name ?? '').trim(),
    description: String(body.description ?? '').trim(),
    published: body.published === 'on' || body.published === 'true',
    sections,
  };
}

/** Render the editor fragment (the live-editable column + preview pane). */
async function renderEditor(reply: FastifyReply, program: Program, form: EditorForm): Promise<FastifyReply> {
  const memberIds = [...new Set(form.sections.map((sec) => sec.projectId))];
  // All projects (names) feed the section picker; only previewed members need
  // live env-state, so enrich just those rather than fanning out for all.
  const [projects, enriched, deployments] = await Promise.all([
    platform.listProjects(),
    platform.getProjectsByIds(memberIds, { withState: true }),
    platform.listDeploymentsAcross(memberIds),
  ]);
  const projectsById = Object.fromEntries(projects.map((p) => [p.id, p]));
  for (const p of enriched) projectsById[p.id] = p; // member projects carry rail/state
  return reply.view('partials/program-editor.eta', {
    program,
    form,
    projects,
    projectsById,
    facets: FACETS,
    deployments,
  });
}

async function loadProgramOr404(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<Program | null> {
  const program = await programsTable().get(request.params.id);
  if (!program) {
    await reply.code(404).view('not-found.eta', { ...(await chrome(request, 'cicd', 'programs')), title: 'Not found', what: 'Program' });
    return null;
  }
  return program;
}

export async function programRoutes(app: FastifyInstance): Promise<void> {
  // Create a fresh draft, then open its editor.
  app.post('/cicd/programs/new', { preHandler: requirePermission('programs:write') }, async (request, reply) => {
    const program: Program = {
      id: newId('prog'),
      name: 'Untitled program',
      slug: newId('program'),
      description: '',
      status: 'draft',
      version: 1,
      updatedBy: request.user!.email,
      updatedAt: new Date().toISOString(),
      sections: [],
    };
    await programsTable().put(program);
    reply.header('HX-Redirect', `/cicd/programs/${program.id}/edit`);
    return reply.redirect(`/cicd/programs/${program.id}/edit`);
  });

  app.get<{ Params: { id: string } }>('/cicd/programs/:id/edit', { preHandler: requirePermission('programs:write') }, async (request, reply) => {
    const program = await loadProgramOr404(request, reply);
    if (!program) return reply;
    const form: EditorForm = {
      name: program.name,
      description: program.description,
      published: program.status === 'published',
      sections: program.sections,
    };
    const projects = await platform.listProjects();
    return reply.view('program-edit.eta', {
      ...(await chrome(request, 'cicd', 'programs')),
      title: `Edit ${program.name}`,
      program,
      form,
      projects,
      projectsById: Object.fromEntries(projects.map((p) => [p.id, p])),
      facets: FACETS,
      deployments: await platform.listDeploymentsAcross([...new Set(program.sections.map((sec) => sec.projectId))]),
    });
  });

  // Stateless structural edits — operate on the submitted form, re-render.
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/cicd/programs/:id/edit/apply',
    { preHandler: requirePermission('programs:write') },
    async (request, reply) => {
      const program = await loadProgramOr404(request, reply);
      if (!program) return reply;
      const form = parseEditorBody(request.body);
      const projects = await platform.listProjects();
      applyAction(form, String(request.body.action ?? ''), request.body, projects);
      return renderEditor(reply, program, form);
    },
  );

  // Persist: bump version, set status, write.
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/cicd/programs/:id/save',
    { preHandler: requirePermission('programs:write') },
    async (request, reply) => {
      const program = await loadProgramOr404(request, reply);
      if (!program) return reply;
      const form = parseEditorBody(request.body);
      const updated: Program = {
        ...program,
        name: form.name || program.name,
        slug: slugify(form.name || program.name),
        description: form.description,
        status: form.published ? 'published' : 'draft',
        version: program.version + 1,
        updatedBy: request.user!.email,
        updatedAt: new Date().toISOString(),
        sections: form.sections,
      };
      await programsTable().put(updated);
      reply.header('HX-Redirect', `/dashboard/${updated.id}`);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>('/cicd/programs/:id/delete', { preHandler: requirePermission('programs:write') }, async (request, reply) => {
    await programsTable().delete(request.params.id);
    reply.header('HX-Redirect', '/cicd/programs');
    return reply.code(204).send();
  });

  // ── Release milestones ────────────────────────────────────────────────────
  // Create/update a milestone definition (no GitHub side effect — Sync does that).
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/cicd/programs/:id/milestones/save',
    { preHandler: requirePermission('programs:write') },
    async (request, reply) => {
      const program = await loadProgramOr404(request, reply);
      if (!program) return reply;
      const b = request.body;
      const title = String(b.title ?? '').trim();
      if (!title) return renderMilestones(reply, program, 'Title is required.');
      const list = program.milestones ?? [];
      const key = String(b.key ?? '').trim();
      const dueOn = String(b.dueOn ?? '').trim() || null;
      const state: 'open' | 'closed' = b.state === 'closed' ? 'closed' : 'open';
      const description = String(b.description ?? '').trim();

      const existing = key ? list.find((m) => m.key === key) : undefined;
      if (existing) {
        // Title change after a sync → remember the old title so the next sync renames in place.
        if (existing.title !== title && existing.syncedAt && !existing.renamedFrom) existing.renamedFrom = existing.title;
        Object.assign(existing, { title, description, dueOn, state });
      } else {
        list.push({ key: uniqueKey(slugify(title), list), title, description, dueOn, state });
      }
      const updated: Program = { ...program, milestones: list, updatedBy: request.user!.email, updatedAt: new Date().toISOString() };
      await programsTable().put(updated);
      return renderMilestones(reply, updated, existing ? `Updated “${title}”.` : `Added “${title}”. Click Sync to push it to GitHub.`);
    },
  );

  // Sync a milestone to GitHub: upsert across member repos + maintain the Release issue.
  app.post<{ Params: { id: string; key: string } }>(
    '/cicd/programs/:id/milestones/:key/sync',
    { preHandler: requirePermission('programs:write') },
    async (request, reply) => {
      const program = await loadProgramOr404(request, reply);
      if (!program) return reply;
      const m = (program.milestones ?? []).find((x) => x.key === request.params.key);
      if (!m) return renderMilestones(reply, program, 'Milestone not found.');
      const projects = await platform.listProjects();
      const { memberRepos, releaseRepo } = await resolveReleaseRepos(program, projects);
      if (!memberRepos.length || !releaseRepo) return renderMilestones(reply, program, 'No member repos resolved — add sections to the program first.');
      try {
        const res = await platform.syncMilestones({
          title: m.title,
          description: m.description,
          dueOn: m.dueOn,
          state: m.state,
          memberRepos,
          releaseRepo,
          releaseIssueNumber: m.releaseIssue?.number,
          oldTitles: m.renamedFrom ? [m.renamedFrom] : undefined,
          syncedBy: request.user!.email,
        });
        m.releaseIssue = res.release_issue ?? undefined;
        m.repos = res.milestones.map((x) => ({ repo: x.repo, number: x.number, url: x.url }));
        m.syncErrors = res.errors;
        m.syncedAt = new Date().toISOString();
        m.syncedBy = request.user!.email;
        m.renamedFrom = undefined;
        const updated: Program = { ...program, updatedBy: request.user!.email, updatedAt: new Date().toISOString() };
        await programsTable().put(updated);
        const flash = res.errors.length
          ? `Synced “${m.title}” with ${res.errors.length} error${res.errors.length === 1 ? '' : 's'} — see below.`
          : `Synced “${m.title}” → ${res.milestones.length} milestone${res.milestones.length === 1 ? '' : 's'}${res.release_issue ? ` + Release issue #${res.release_issue.number}` : ''}.`;
        return renderMilestones(reply, updated, flash);
      } catch (e) {
        return renderMilestones(reply, program, `Sync failed: ${(e as Error).message}`);
      }
    },
  );

  // Remove a milestone definition (does NOT delete GitHub milestones).
  app.post<{ Params: { id: string; key: string } }>(
    '/cicd/programs/:id/milestones/:key/delete',
    { preHandler: requirePermission('programs:write') },
    async (request, reply) => {
      const program = await loadProgramOr404(request, reply);
      if (!program) return reply;
      const list = (program.milestones ?? []).filter((m) => m.key !== request.params.key);
      const updated: Program = { ...program, milestones: list, updatedBy: request.user!.email, updatedAt: new Date().toISOString() };
      await programsTable().put(updated);
      return renderMilestones(reply, updated, 'Milestone definition removed (GitHub milestones were not deleted).');
    },
  );
}

/** Mutate the in-flight editor form per the clicked control. */
function applyAction(form: EditorForm, action: string, body: Record<string, unknown>, projects: Project[]): void {
  const idx = parseInt(String(body.sec ?? '-1'), 10);
  const firstProject = projects[0]?.id ?? '';
  switch (action) {
    case 'sec-add':
      form.sections.push({ projectId: firstProject, facets: defaultFacets(firstProject, projects) });
      break;
    case 'sec-remove':
      if (idx >= 0) form.sections.splice(idx, 1);
      break;
    case 'sec-up':
      if (idx > 0) [form.sections[idx - 1], form.sections[idx]] = [form.sections[idx], form.sections[idx - 1]];
      break;
    case 'sec-down':
      if (idx >= 0 && idx < form.sections.length - 1) [form.sections[idx + 1], form.sections[idx]] = [form.sections[idx], form.sections[idx + 1]];
      break;
    case 'sec-project': {
      const pid = String(body.projectId ?? '');
      if (idx >= 0 && form.sections[idx]) form.sections[idx] = { projectId: pid, facets: defaultFacets(pid, projects) };
      break;
    }
    case 'sec-facet': {
      const facet = String(body.facet ?? '');
      const sec = idx >= 0 ? form.sections[idx] : undefined;
      if (sec && facet) {
        sec.facets = sec.facets.includes(facet) ? sec.facets.filter((f) => f !== facet) : [...sec.facets, facet];
      }
      break;
    }
  }
}

function defaultFacets(projectId: string, projects: Project[]): string[] {
  const type = projects.find((p) => p.id === projectId)?.type;
  return type ? FACETS[type].slice(0, 1).map((f) => f.id) : [];
}
