// Kits & Releases deploy: two-beat confirm without a per-toggle backend round-trip.
//   0 selected                → no Confirm section.
//   1+ selected (client-side) → Confirm section: title + count + a yellow CHECK button.
//                               Toggling more slots just updates the count — no request.
//   click CHECK               → ONE /kit-deploy/review request (hx-include the matrix
//                               form) verifies + reveals the target list/warnings + a
//                               DEPLOY button (server-rendered, kit-deploy-review.eta).
// Any slot change resets back to the CHECK state (a prior verification is now stale).
declare global { interface Window { htmx?: { process: (el: Element) => void } } }

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function render(form: HTMLFormElement): void {
  const rid = form.dataset.rid ?? '';
  const target = document.getElementById(`deploy-review-${rid}`);
  if (!target) return;
  const n = form.querySelectorAll<HTMLInputElement>('.deploy-slot input:checked').length;
  if (n === 0) { target.innerHTML = ''; return; }
  const version = form.dataset.kitVersion ?? '';
  const pid = form.dataset.pid ?? '';
  const noun = `${n} target${n === 1 ? '' : 's'}`;
  // Pre-check card — matches kit-deploy-review.eta's shell so the swap is seamless.
  target.innerHTML = `<div class="dc-card" style="padding:14px;margin-top:10px;border:1px solid var(--border-focus);">
    <div class="label-caps" style="margin-bottom:10px;">Confirm deploy · v${esc(version)} · ${noun}</div>
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;">
      <span class="small faint">Verify targets before deploying</span>
      <button type="button" class="btn btn-check" style="padding:5px 14px;font-size:12px;"
        hx-post="/cicd/projects/${encodeURIComponent(pid)}/kit-deploy/review"
        hx-include="#${form.id}" hx-target="#deploy-review-${rid}" hx-swap="innerHTML">Check ${noun}</button>
    </div>
  </div>`;
  window.htmx?.process(target);
}

document.addEventListener('change', (ev) => {
  const el = ev.target as HTMLElement | null;
  if (!el || !(el instanceof HTMLInputElement) || !el.closest('.deploy-slot')) return;
  const form = el.closest('form');
  if (form) render(form as HTMLFormElement);
});

export {};
