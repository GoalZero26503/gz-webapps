// Themed confirm modal — replaces the browser-default confirm()/hx-confirm dialog.
// Exposes window.gzConfirm() (a promise) and wires HTMX's `htmx:confirm` hook so
// every `hx-confirm` attribute renders this modal instead of window.confirm.

export {}; // make this a module so `declare global` is valid

interface ConfirmOpts {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

declare global {
  interface Window { gzConfirm: (opts: ConfirmOpts) => Promise<boolean>; }
}

let els: { overlay: HTMLDivElement; title: HTMLDivElement; msg: HTMLDivElement; ok: HTMLButtonElement; cancel: HTMLButtonElement } | null = null;
let resolver: ((v: boolean) => void) | null = null;

function build(): NonNullable<typeof els> {
  const overlay = document.createElement('div');
  overlay.className = 'gz-modal-overlay';
  overlay.setAttribute('hidden', '');
  const card = document.createElement('div');
  card.className = 'gz-modal';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  const title = document.createElement('div');
  title.className = 'gz-modal-title';
  const msg = document.createElement('div');
  msg.className = 'gz-modal-msg';
  const actions = document.createElement('div');
  actions.className = 'gz-modal-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-ghost';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'btn btn-primary';
  actions.append(cancel, ok);
  card.append(title, msg, actions);
  overlay.append(card);
  document.body.appendChild(overlay);

  const close = (v: boolean): void => {
    overlay.setAttribute('hidden', '');
    const r = resolver;
    resolver = null;
    if (r) r(v);
  };
  cancel.addEventListener('click', () => close(false));
  ok.addEventListener('click', () => close(true));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  document.addEventListener('keydown', (e) => {
    if (overlay.hasAttribute('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(false); }
    else if (e.key === 'Enter') { e.preventDefault(); close(true); }
  });

  els = { overlay, title, msg, ok, cancel };
  return els;
}

function gzConfirm(opts: ConfirmOpts): Promise<boolean> {
  const e = els ?? build();
  // Resolve any in-flight prompt as cancelled before showing a new one.
  if (resolver) { const r = resolver; resolver = null; r(false); }
  e.title.textContent = opts.title || 'Please confirm';
  e.msg.textContent = opts.message;
  e.ok.textContent = opts.confirmLabel || 'Confirm';
  e.cancel.textContent = opts.cancelLabel || 'Cancel';
  e.ok.classList.toggle('btn-danger', !!opts.danger);
  e.ok.classList.toggle('btn-primary', !opts.danger);
  e.overlay.removeAttribute('hidden');
  e.ok.focus();
  return new Promise<boolean>((res) => { resolver = res; });
}

window.gzConfirm = gzConfirm;

// HTMX integration: render this modal for any element carrying hx-confirm.
// htmx:confirm fires before every htmx request; detail.question is only set when
// hx-confirm is present, so other requests pass through untouched.
document.addEventListener('htmx:confirm', (evt: Event) => {
  const detail = (evt as CustomEvent<{ question?: string; issueRequest: (skipConfirm?: boolean) => void }>).detail;
  if (!detail?.question) return;
  evt.preventDefault();
  const q = detail.question;
  const danger = /\b(remove|delete|destroy|prod|warehouse)\b|cannot be undone/i.test(q);
  void gzConfirm({ message: q, confirmLabel: 'Continue', danger }).then((ok) => {
    if (ok) detail.issueRequest(true);
  });
});
