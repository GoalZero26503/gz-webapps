/**
 * Pure HTML render helpers shared across Eta views — ported from the prototype
 * (`ui-prototype/js/components.js` + `views.js`). They build the promotion
 * rails, channel grids, component matrices, badges, and program sections that
 * are too structural to inline in templates. Merged into Eta's defaultContext
 * (see app.ts), so views call them as `<%~ it.rail(...) %>`.
 *
 * All return ESCAPED, ready-to-emit HTML — callers use the raw `<%~ %>` slot.
 */
import { ENVS, type Deployment, type Env, type Project, type Rail, type RailCell } from '../platform/types.js';
import type { ProgramMilestone } from '../store/types.js';

type ProjectsById = Record<string, Project>;
type NavFor = (env: Env) => string | null;
/** Channel-aware nav for the kit channel rail: each tile links to the latest deployment of THAT channel+env. */
type ChannelNavFor = (channel: string, env: Env) => string | null;

export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

export function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / 86400 / 30)}mo ago`;
}

export function typeBadge(type: string): string {
  return `<span class="badge type">${esc(type)}</span>`;
}

export function statusBadge(status: string): string {
  const map: Record<string, [string, string]> = {
    succeeded: ['ok', 'Succeeded'], live: ['ok', 'Live'], healthy: ['ok', 'Healthy'],
    in_progress: ['info', 'In progress'], deploying: ['info', 'Deploying'], pending: ['warn', 'Pending'],
    resolving_secrets: ['info', 'Resolving'], cancelled: ['idle', 'Cancelled'],
    failed: ['err', 'Failed'], denied: ['err', 'Denied'],
    draft: ['idle', 'Draft'], published: ['ok', 'Published'], approved: ['ok', 'Approved'],
  };
  const [cls, label] = map[status] ?? ['idle', status];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

/** One promotion-rail cell. `nav` (a hash/href) makes the cell a deep link. */
export function cell(c: RailCell | null | undefined, nav?: string | null): string {
  if (!c) return `<div class="cell empty"><div class="v">—</div></div>`;
  const cls = c.state || 'live';
  let meta: string;
  if (c.state === 'deploying') meta = `<span class="dot info"></span>${c.note ? `${esc(c.note)} · ` : ''}${c.progress != null ? `${c.progress}%` : 'deploying…'}`;
  else if (c.state === 'failed') meta = `<span class="dot err"></span>${esc(c.note || 'failed')}`;
  else meta = `${c.age ? esc(c.age) : ''}${c.age ? ' · ' : ''}<span class="dot ok"></span>`;
  const v = esc(c.v) + (c.b ? ` <span class="faint">(${c.b})</span>` : '');
  const navAttrs = nav ? ` data-nav="${esc(nav)}" onclick="location.href='${esc(nav)}'" style="cursor:pointer;" title="View deployment"` : '';
  return `<div class="cell ${cls}${nav ? ' cell-link' : ''}"${navAttrs}><div class="v">${v}</div><div class="meta">${meta}</div></div>`;
}

export function envHeader(offset = false): string {
  return `<div class="rail-envs ${offset ? 'offset' : ''}">${offset ? '<span></span>' : ''}${ENVS.map((e) => `<span class="label-caps">${e}</span>`).join('')}</div>`;
}

export function rail(railData: Rail, withHeader = false, navFor?: NavFor): string {
  return `<div class="rail-scroll">${withHeader ? envHeader(false) : ''}<div class="rail">${ENVS.map((e) => cell(railData[e], navFor ? navFor(e) : null)).join('')}</div></div>`;
}

/** Dim placeholder rail shown while a lazy (HTMX) health panel loads. */
export function railSkeleton(): string {
  return `<div class="rail-scroll">${envHeader(false)}<div class="rail">${ENVS.map(() => `<div class="cell"><div class="v faint">…</div></div>`).join('')}</div></div>`;
}

export function channelRail(channels: Record<string, Rail>, navFor?: ChannelNavFor): string {
  const rows = Object.entries(channels)
    .map(([name, envs]) => `<span class="env-label">${esc(name)}</span>${ENVS.map((e) => cell(envs[e], navFor ? navFor(name, e) : null)).join('')}`)
    .join('');
  return `<div class="rail-scroll">${envHeader(true)}<div class="rail labeled">${rows}</div></div>`;
}

export function componentMatrix(components: Project['components'], projectsById: ProjectsById, withHeader = true): string {
  const rows = (components ?? [])
    .map((c) => {
      const p = projectsById[c.projectId];
      const label = p ? `<a href="/cicd/projects/${esc(p.id)}">${esc(c.label)}</a>` : esc(c.label);
      return `<span class="env-label">${label}</span>${ENVS.map((e) => {
        const cl = p?.rail ? p.rail[e] : null;
        const cls = cl ? cl.state || 'live' : 'empty';
        return `<div class="cell ${cls}"><div class="v">${cl ? esc(cl.v) : '—'}</div></div>`;
      }).join('')}`;
    })
    .join('');
  return `<div class="rail-scroll">${withHeader ? envHeader(true) : ''}<div class="rail labeled compact">${rows}</div></div>`;
}

export interface ProgramSectionInput {
  projectId: string;
  facets: string[];
}

/** Health rollup for a program: scan its member projects' rails. */
export function programHealth(
  sections: ProgramSectionInput[],
  projectsById: ProjectsById,
): { failed: number; deploying: number; issues: { cls: string; text: string; detail: string }[] } {
  let failed = 0;
  let deploying = 0;
  const issues: { cls: string; text: string; detail: string }[] = [];
  for (const sec of sections) {
    const p = projectsById[sec.projectId];
    if (!p?.rail) continue;
    for (const e of ENVS) {
      const c = p.rail[e];
      if (!c) continue;
      if (c.state === 'failed') { failed++; issues.push({ cls: 'err', text: `${p.name}: deploy to ${e} failed`, detail: c.note || '' }); }
      if (c.state === 'deploying') { deploying++; issues.push({ cls: 'info', text: `${p.name}: ${c.note || 'deploy'} to ${e} in progress`, detail: c.progress != null ? `${c.progress}%` : '' }); }
    }
  }
  return { failed, deploying, issues };
}

/** Render one program section card (shared by program dashboard + editor preview). */
export function programSection(
  sec: ProgramSectionInput,
  projectsById: ProjectsById,
  deployments: Deployment[],
): string {
  const p = projectsById[sec.projectId];
  if (!p) return '';
  const has = (id: string): boolean => sec.facets.includes(id);
  let body = '';

  if (p.type === 'firmware-kit') {
    body += has('channels') && p.channels ? channelRail(p.channels) : rail(p.rail ?? {}, true);
    if (has('components')) {
      const failing = (p.components ?? []).reduce((n, c) => {
        const np = projectsById[c.projectId];
        return n + (np?.rail ? ENVS.filter((e) => np.rail?.[e]?.state === 'failed').length : 0);
      }, 0);
      body += `<details class="collapse" style="margin-top:14px;">
        <summary><span class="label-caps">Components</span><span class="small faint">${(p.components ?? []).length} nodes · version per environment</span>${failing ? `<span class="badge err">${failing} failing</span>` : ''}</summary>
        <div style="margin-top:10px;">${componentMatrix(p.components, projectsById)}</div>
      </details>`;
    }
  } else if (p.type === 'cloud') {
    // Live health: lazy-load the real /health probe (version/hash + reachability)
    // so the page renders instantly; falls back to platform deploy-state if the
    // project has no health_check configured. Replaces the old static pill.
    if (has('rail') || has('health')) {
      body += `<div class="health-lazy" hx-get="/cicd/health/${esc(p.id)}" hx-trigger="load" hx-swap="outerHTML">${railSkeleton()}</div>`;
    }
  } else if (p.type === 'mobile') {
    if (has('envs')) body += rail(p.rail ?? {}, true);
    if (has('stores') || has('groups')) {
      body += `<div class="dist-grid" style="margin-top:14px;">`;
      if (has('stores')) {
        body += Object.entries(p.cohorts ?? {})
          .map(([store, rows]) => `<div><div class="label-caps" style="margin-bottom:6px;">${esc(store)}</div>${rows.map(([cohort, v]) => `<div class="kv"><span class="k">${esc(cohort)}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>`)
          .join('');
      }
      if (has('groups')) {
        body += `<div><div class="label-caps" style="margin-bottom:6px;">Access groups</div>${(p.accessGroups ?? []).map((g) => `<div class="kv"><span class="k">${esc(g.name)}</span><span class="v">${esc(g.published)}</span></div>`).join('') || '<div class="small faint">none</div>'}</div>`;
      }
      body += `</div>`;
    }
  } else if (has('rail')) {
    body += rail(p.rail ?? {}, true);
  }

  if (has('activity')) {
    const acts = deployments.filter((d) => d.projectId === p.id).slice(0, 3);
    body += `<div style="margin-top:12px;">${acts.map((d) => `<div class="kv"><span class="k">${statusBadge(d.status)} <span class="mono">${esc(d.version)}</span> → ${esc(d.env)}</span><span class="small faint">${timeAgo(d.at)}</span></div>`).join('') || '<div class="small faint">no recent deploys</div>'}</div>`;
  }

  return `<div class="card">
    <div class="card-head"><span class="accent-bar"></span><h2>${esc(p.name)}</h2>${typeBadge(p.type)}<span class="grow"></span><a href="/cicd/projects/${esc(p.id)}">view project →</a></div>
    <div class="card-body">${body}</div>
  </div>`;
}

/** The edit/create form for a single milestone (key empty = create). */
function milestoneForm(programId: string, m: ProgramMilestone | null): string {
  const a = `hx-post="/cicd/programs/${esc(programId)}/milestones/save" hx-target="#milestones-section" hx-swap="outerHTML"`;
  return `<form class="ms-form" ${a}>
    <input type="hidden" name="key" value="${esc(m?.key ?? '')}" />
    <div class="ms-grid">
      <label class="ms-field"><span class="label-caps">Title</span><input name="title" value="${esc(m?.title ?? '')}" placeholder="R7" required /></label>
      <label class="ms-field"><span class="label-caps">Release date</span><input type="date" name="dueOn" value="${esc(m?.dueOn ?? '')}" /></label>
      <label class="ms-field"><span class="label-caps">State</span><select name="state">
        <option value="open"${m?.state !== 'closed' ? ' selected' : ''}>Open</option>
        <option value="closed"${m?.state === 'closed' ? ' selected' : ''}>Closed</option>
      </select></label>
    </div>
    <label class="ms-field"><span class="label-caps">Description</span><textarea name="description" rows="3" placeholder="What ships in this release…">${esc(m?.description ?? '')}</textarea></label>
    <div class="ms-actions"><button type="submit" class="btn btn-primary">${m ? 'Save changes' : 'Add milestone'}</button></div>
  </form>`;
}

/**
 * "Releases & Milestones" section for a program dashboard. Lists the program's
 * release milestones with their GitHub sync state and edit/sync/delete actions,
 * plus a create form. Rendered both inline (full page) and as the HTMX swap
 * target (`#milestones-section`) after a save/sync/delete.
 */
export function milestonesSection(
  program: { id: string; milestones?: ProgramMilestone[] },
  ctx: { memberRepos: string[]; releaseRepo: string | null; canEdit: boolean; flash?: string },
): string {
  const { memberRepos, releaseRepo, canEdit, flash } = ctx;
  const milestones = program.milestones ?? [];

  const reposPreview = memberRepos.length
    ? `<details class="collapse ms-repos"><summary><span class="label-caps">Member repos</span><span class="small faint">${memberRepos.length} repo${memberRepos.length === 1 ? '' : 's'} · milestone fans out to all${releaseRepo ? ` · Release issue in <span class="mono">${esc(releaseRepo)}</span>` : ''}</span></summary>
        <div class="ms-repolist">${memberRepos.map((r) => `<span class="chip${r === releaseRepo ? ' chip-sel' : ''}" title="${r === releaseRepo ? 'Release issue host' : 'milestone synced here'}">${esc(r)}</span>`).join('')}</div>
      </details>`
    : `<div class="small faint">This program has no member repos to sync — add sections with a firmware-kit/cloud/mobile project first.</div>`;

  const rows = milestones.length
    ? milestones.map((m) => {
        const synced = m.syncedAt
          ? `${m.releaseIssue ? `<a href="${esc(m.releaseIssue.url)}" target="_blank" rel="noopener">Release issue #${esc(m.releaseIssue.number)}</a> · ` : ''}<span class="small faint">${(m.repos ?? []).length} repo${(m.repos ?? []).length === 1 ? '' : 's'} · synced ${timeAgo(m.syncedAt)}${m.syncedBy ? ` by ${esc(m.syncedBy)}` : ''}</span>`
          : `<span class="small faint">not synced yet</span>`;
        const errs = (m.syncErrors ?? []).length
          ? `<details class="collapse"><summary><span class="badge err">${m.syncErrors!.length} sync error${m.syncErrors!.length === 1 ? '' : 's'}</span></summary><div class="small mono" style="margin-top:6px;">${m.syncErrors!.map((e) => `${esc(e.repo)}: ${esc(e.error)}`).join('<br/>')}</div></details>`
          : '';
        const perRepo = (m.repos ?? []).length
          ? `<details class="collapse"><summary><span class="label-caps">Milestones</span></summary><div class="ms-repolist" style="margin-top:6px;">${m.repos!.map((r) => `<a class="chip" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.repo)} #${esc(r.number)}</a>`).join('')}</div></details>`
          : '';
        const actions = canEdit
          ? `<div class="ms-row-actions">
              <form hx-post="/cicd/programs/${esc(program.id)}/milestones/${esc(m.key)}/sync" hx-target="#milestones-section" hx-swap="outerHTML" hx-confirm="Sync '${esc(m.title)}' to ${memberRepos.length} member repo${memberRepos.length === 1 ? '' : 's'}${releaseRepo ? ` and the Release issue in ${esc(releaseRepo)}` : ''}? This creates/updates real GitHub milestones and an issue." hx-indicator="#ms-busy-${esc(m.key)}">
                <button type="submit" class="btn btn-primary"${memberRepos.length ? '' : ' disabled'}>${m.syncedAt ? 'Re-sync' : 'Sync to GitHub'} →</button>
              </form>
              <span id="ms-busy-${esc(m.key)}" class="htmx-indicator small faint">syncing…</span>
              <form hx-post="/cicd/programs/${esc(program.id)}/milestones/${esc(m.key)}/delete" hx-target="#milestones-section" hx-swap="outerHTML" hx-confirm="Remove the '${esc(m.title)}' milestone definition? (GitHub milestones already created are NOT deleted.)">
                <button type="submit" class="btn btn-ghost">Delete</button>
              </form>
            </div>`
          : '';
        const editForm = canEdit
          ? `<details class="collapse" style="margin-top:8px;"><summary><span class="small">Edit details</span></summary><div style="margin-top:8px;">${milestoneForm(program.id, m)}</div></details>`
          : '';
        return `<div class="ms-item">
          <div class="ms-item-head">
            <span class="ms-title">${esc(m.title)}</span>${statusBadge(m.state === 'closed' ? 'cancelled' : 'open')}
            ${m.dueOn ? `<span class="small faint">📅 ${esc(m.dueOn)}</span>` : ''}
            <span class="grow"></span>${synced}
          </div>
          ${m.description ? `<div class="small" style="margin:6px 0;white-space:pre-wrap;">${esc(m.description)}</div>` : ''}
          <div class="ms-meta">${perRepo}${errs}</div>
          ${actions}${editForm}
        </div>`;
      }).join('')
    : `<div class="small faint">No release milestones yet.${canEdit ? ' Add one below to fan a milestone out across the member repos.' : ''}</div>`;

  const createForm = canEdit
    ? `<details class="collapse ms-new"><summary><span class="btn btn-ghost">＋ New milestone</span></summary><div style="margin-top:10px;">${milestoneForm(program.id, null)}</div></details>`
    : '';

  return `<section id="milestones-section" class="card">
    <div class="card-head"><span class="accent-bar"></span><h2>Releases &amp; Milestones</h2><span class="grow"></span></div>
    <div class="card-body">
      ${flash ? `<div class="ms-flash">${esc(flash)}</div>` : ''}
      ${reposPreview}
      <div class="ms-list">${rows}</div>
      ${createForm}
    </div>
  </section>`;
}

export const viewHelpers = {
  ENVS,
  esc,
  timeAgo,
  typeBadge,
  statusBadge,
  cell,
  envHeader,
  rail,
  channelRail,
  componentMatrix,
  programHealth,
  programSection,
  milestonesSection,
};
