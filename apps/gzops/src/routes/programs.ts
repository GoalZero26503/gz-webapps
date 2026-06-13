import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requirePermission } from '../auth/plugin.js';
import { platform } from '../platform/client.js';
import type { Project, ProjectType } from '../platform/types.js';
import { newId, programs as programsTable } from '../store/repo.js';
import type { Program, ProgramSection } from '../store/types.js';
import { chrome } from '../views/chrome.js';

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
  const projects = await platform.listProjects({ withState: true });
  const projectsById = Object.fromEntries(projects.map((p) => [p.id, p]));
  return reply.view('partials/program-editor.eta', {
    program,
    form,
    projects,
    projectsById,
    facets: FACETS,
    deployments: await platform.listDeploymentsAcross([...new Set(program.sections.map((sec) => sec.projectId))]),
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
