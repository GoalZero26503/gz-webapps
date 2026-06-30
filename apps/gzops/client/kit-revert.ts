// Revert a versioned (app-release) channel to an older version from the Kits &
// Releases matrix. A `.cell-revert` button (see partials/kit-release-body.eta) marks
// a cell whose row version is BEHIND what's live: reverting means deleting every
// version ahead so this one becomes newest. Two-step confirm → POST → reload.
function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function closeModal(): void {
  document.getElementById('revert-overlay')?.remove();
}

function openRevert(ds: DOMStringMap): void {
  closeModal();
  const project = ds.revertProject ?? '';
  const channel = ds.revertChannel ?? '';
  const channelLabel = ds.revertChannelLabel ?? channel;
  const version = ds.revertVersion ?? '';
  const env = ds.revertEnv ?? '';
  const live = ds.revertLive ?? '';

  const overlay = document.createElement('div');
  overlay.id = 'revert-overlay';
  overlay.className = 'gz-modal-overlay';
  overlay.innerHTML = `<div class="gz-modal cell-menu" role="dialog" aria-modal="true">
    <div class="cell-menu-head"><span class="label-caps">${esc(channelLabel)} → ${esc(env)}</span><span class="mono">revert → v${esc(version)}</span></div>
    <div class="cell-menu-body">
      <p class="small">Revert <b>${esc(channelLabel)} · ${esc(env)}</b> to <span class="mono">v${esc(version)}</span>? This <b>deletes</b> the manifests for <span class="mono">v${esc(live)}</span> and any newer version on this channel, so devices fall back to v${esc(version)}. Builds and node images are kept — re-deploy to roll forward again.</p>
    </div>
    <div class="cell-menu-foot">
      <button type="button" class="btn btn-ghost" data-close>Cancel</button>
      <button type="button" class="btn btn-danger" data-do-revert>Revert to v${esc(version)}</button>
    </div>
  </div>`;
  const card = overlay.querySelector('.cell-menu') as HTMLElement;
  card.querySelector('[data-close]')?.addEventListener('click', closeModal);
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeModal(); });

  card.querySelector('[data-do-revert]')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Reverting…';
    try {
      const res = await fetch(`/cicd/projects/${encodeURIComponent(project)}/revert-channel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel, target_version: version, environment: env }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      location.reload();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = `Revert to v${version}`;
      const msg = document.createElement('div');
      msg.className = 'small';
      msg.style.color = 'var(--red)';
      msg.textContent = 'Failed: ' + (err instanceof Error ? err.message : 'error');
      card.querySelector('.cell-menu-foot')?.before(msg);
    }
  });

  document.body.appendChild(overlay);
}

document.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement | null)?.closest?.('.cell-revert') as HTMLElement | null;
  if (!el) return;
  ev.preventDefault();
  ev.stopPropagation();
  openRevert(el.dataset);
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeModal(); });

export {};
