// Action menu for a deployed kit cell on the Status rail. Cells carry
// data-cell-menu + data-* (see views/helpers.ts `cell()`). Clicking one opens a
// small modal: View · Promote · Un-publish. Un-publish is a two-step confirm and
// is only offered when the cell is data-can-unpublish="1" (admin beyond dev).
function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function closeMenu(): void {
  document.getElementById('cell-menu-overlay')?.remove();
}

function openMenu(ds: DOMStringMap): void {
  closeMenu();
  const project = ds.project ?? '';
  const env = ds.env ?? '';
  const channel = ds.channel ?? '';
  const version = ds.version ?? '';
  const id = ds.deploymentId ?? '';
  const canUnpublish = ds.canUnpublish === '1';
  const head = `<div class="cell-menu-head"><span class="label-caps">${esc(channel)} → ${esc(env)}</span><span class="mono">v${esc(version)}</span></div>`;

  const overlay = document.createElement('div');
  overlay.id = 'cell-menu-overlay';
  overlay.className = 'gz-modal-overlay';
  overlay.innerHTML = `<div class="gz-modal cell-menu" role="dialog" aria-modal="true">${head}
    <div class="cell-menu-body">
      <a class="btn" href="/cicd/deployments/${encodeURIComponent(id)}">View deployment</a>
      <a class="btn" href="/cicd/projects/${encodeURIComponent(project)}?tab=builds" title="Open Kits & Releases to deploy this version onward">Promote…</a>
      ${canUnpublish ? '<button type="button" class="btn btn-danger" data-step-confirm>⌫ Un-publish</button>' : ''}
    </div>
    <div class="cell-menu-foot"><button type="button" class="btn btn-ghost" data-close>Cancel</button></div>
  </div>`;

  const card = overlay.querySelector('.cell-menu') as HTMLElement;

  const toConfirm = (): void => {
    card.innerHTML = `${head}
      <div class="cell-menu-body">
        <p class="small">Un-publish <span class="mono">v${esc(version)}</span> from <b>${esc(channel)} · ${esc(env)}</b>? This deletes the deployed manifests so devices on this channel stop seeing the firmware. The build is kept — you can re-deploy it.</p>
      </div>
      <div class="cell-menu-foot">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="button" class="btn btn-danger" data-do-undeploy>Un-publish v${esc(version)}</button>
      </div>`;
    card.querySelector('[data-close]')?.addEventListener('click', closeMenu);
    card.querySelector('[data-do-undeploy]')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Un-publishing…';
      try {
        const res = await fetch(`/cicd/projects/${encodeURIComponent(project)}/undeploy`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ channel, version, environment: env }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        location.reload();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = `Un-publish v${version}`;
        const msg = document.createElement('div');
        msg.className = 'small';
        msg.style.color = 'var(--red)';
        msg.textContent = 'Failed: ' + (err instanceof Error ? err.message : 'error');
        card.querySelector('.cell-menu-foot')?.before(msg);
      }
    });
  };

  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeMenu(); });
  card.querySelector('[data-close]')?.addEventListener('click', closeMenu);
  card.querySelector('[data-step-confirm]')?.addEventListener('click', toConfirm);
  document.body.appendChild(overlay);
}

document.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement | null)?.closest?.('[data-cell-menu]') as HTMLElement | null;
  if (!el) return;
  ev.preventDefault();
  openMenu(el.dataset);
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenu(); });

export {};
