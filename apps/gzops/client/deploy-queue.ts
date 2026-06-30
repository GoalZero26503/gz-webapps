// Kits & Releases deploy matrix: keep the "Deploy →" button (.deploy-go) disabled
// until at least one slot is queued, and reflect the count in its label/title.
function syncForm(form: HTMLFormElement): void {
  const n = form.querySelectorAll('.deploy-slot input:checked').length;
  const btn = form.querySelector<HTMLButtonElement>('button.deploy-go');
  if (!btn) return;
  btn.disabled = n === 0;
  btn.textContent = n === 0 ? 'Deploy →' : `Deploy ${n} →`;
  btn.title = n === 0 ? 'Select at least one slot to deploy' : `Deploy ${n} target${n === 1 ? '' : 's'} →`;
}

function syncAll(): void {
  document.querySelectorAll<HTMLFormElement>('form:has(.deploy-slot)').forEach(syncForm);
}

document.addEventListener('change', (ev) => {
  const el = ev.target as HTMLElement | null;
  if (!el?.closest?.('.deploy-slot')) return;
  const form = el.closest('form');
  if (form) syncForm(form as HTMLFormElement);
});
// Initial state on load (matrix is server-rendered into the page).
if (document.readyState !== 'loading') syncAll();
else document.addEventListener('DOMContentLoaded', syncAll);

export {};
