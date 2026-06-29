// Action menu for a deployed kit cell on the Status rail. Cells carry
// data-cell-menu + data-* (see views/helpers.ts `cell()`). Clicking one opens a
// small modal: View · Promote · and a channel-kind-specific action:
//   • VERSIONED channel ({version} manifests, e.g. app-release) → Un-publish: a
//     two-step confirm that deletes this version's manifests (devices fall back to
//     the previous version). The build is kept; re-deployable.
//   • FIXED-POINTER channel (warehouse/manual) → Revert: its manifest must always
//     exist for the factory, so we never delete — instead deep-link to the deploy
//     flow to re-publish an older version.
// The destructive/revert action shows only when data-can-unpublish="1" (admin beyond dev).
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
  const channelKey = ds.channelKey ?? '';
  const channelLabel = ds.channelLabel ?? channelKey;
  const versioned = ds.versioned === '1';
  const version = ds.version ?? '';
  const id = ds.deploymentId ?? '';
  const canAct = ds.canUnpublish === '1';
  const buildsHref = `/cicd/projects/${encodeURIComponent(project)}?tab=builds`;
  const head = `<div class="cell-menu-head"><span class="label-caps">${esc(channelLabel)} → ${esc(env)}</span><span class="mono">v${esc(version)}</span></div>`;

  // Versioned → Un-publish (destructive, in-modal confirm). Fixed-pointer → Revert
  // (re-deploy via the builds tab; deleting the factory pointer is never allowed).
  const action = !canAct
    ? ''
    : versioned
      ? '<button type="button" class="btn btn-danger" data-step-confirm>⌫ Un-publish</button>'
      : `<a class="btn" href="${buildsHref}" title="Re-deploy an older version (the factory pointer can't be deleted)">↩ Revert…</a>`;

  const overlay = document.createElement('div');
  overlay.id = 'cell-menu-overlay';
  overlay.className = 'gz-modal-overlay';
  overlay.innerHTML = `<div class="gz-modal cell-menu" role="dialog" aria-modal="true">${head}
    <div class="cell-menu-body">
      <a class="btn" href="/cicd/deployments/${encodeURIComponent(id)}">View deployment</a>
      <a class="btn" href="${buildsHref}" title="Open Kits & Releases to deploy this version onward">Promote…</a>
      ${action}
    </div>
    <div class="cell-menu-foot"><button type="button" class="btn btn-ghost" data-close>Cancel</button></div>
  </div>`;

  const card = overlay.querySelector('.cell-menu') as HTMLElement;

  const toConfirm = (): void => {
    card.innerHTML = `${head}
      <div class="cell-menu-body">
        <p class="small">Un-publish <span class="mono">v${esc(version)}</span> from <b>${esc(channelLabel)} · ${esc(env)}</b>? This deletes this version's manifests so devices on this channel fall back to the previous version. The build is kept — you can re-deploy it.</p>
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
          body: JSON.stringify({ channel: channelKey, version, environment: env }),
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
