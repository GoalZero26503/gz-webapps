import { html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

/**
 * Create Release composer for a firmware-kit.
 *
 * You pick one built version per component, an environment, channels, and a host
 * scope; the widget calls the read-only preview endpoint and renders the per-host
 * manifests the release WOULD write. Submitting POSTs to the CD endpoint, which
 * copies the component binaries, gates readiness, and publishes the manifests
 * across the chosen channels (one deployment per channel).
 *
 *   <gz-kit-release project-id="…" envs="dev,test,…" suggested-version="1.8.8"
 *      host-ids='[...]' components='[{name,set,slots,project,versions[]}]'
 *      preview-url="/cicd/projects/ID/release/preview"
 *      submit-url="/cicd/projects/ID/release/submit" cancel-url="…">
 */
interface Comp { name: string; set: 'iNode' | 'xNode'; slots: string[]; project: string; versions: string[] }
interface HostManifest { hostId: string; iNodes: Record<string, string>; xNodes?: Record<string, string> }
interface Preview { manifests: HostManifest[]; missing: string[]; host_count: number }

@customElement('gz-kit-release')
export class GzKitRelease extends LitElement {
  @property({ attribute: 'project-id' }) projectId = '';
  @property({ attribute: 'preview-url' }) previewUrl = '';
  @property({ attribute: 'submit-url' }) submitUrl = '';
  @property({ attribute: 'cancel-url' }) cancelUrl = '';
  /** Base for polling deployment status, e.g. "/cicd/deployments" → "{base}/{id}/status". */
  @property({ attribute: 'status-url' }) statusUrlBase = '/cicd/deployments';
  @property({ attribute: 'suggested-version' }) suggested = '';
  @property({ attribute: 'host-ids' }) hostIdsAttr = '[]';
  @property({ attribute: 'components' }) componentsAttr = '[]';

  /** A dev kit always targets dev; cutting a release is what unlocks other envs. */
  private readonly env = 'dev';
  @state() private channels = { app: true, warehouse: false, manual: false };
  @state() private allHosts = true;
  @state() private hosts: string[] = [];
  @state() private versions: Record<string, string> = {};
  @state() private kitVersion = '';
  @state() private preview: Preview | null = null;
  @state() private loading = false;
  @state() private error = '';
  @state() private previewOpen = false;
  @state() private submitting = false;
  /** Set once the release is accepted (202); drives the live progress panel. */
  @state() private started: { environment: string; kit_version: string; host_count: number; deployments: { channel: string; deployment_id: string }[] } | null = null;
  /** Latest polled status per deployment id. */
  @state() private statuses: Record<string, { status: string; progress: number | null; note: string | null }> = {};
  @state() private submitError = '';

  private static readonly TERMINAL = ['succeeded', 'failed', 'cancelled', 'denied'];

  protected createRenderRoot(): HTMLElement { return this; }

  private get hostIds(): string[] { try { return JSON.parse(this.hostIdsAttr); } catch { return []; } }
  private get components(): Comp[] { try { return JSON.parse(this.componentsAttr); } catch { return []; } }

  connectedCallback(): void {
    super.connectedCallback();
    this.kitVersion = this.suggested;
    this.hosts = [...this.hostIds];
    // Default each component to its newest built version.
    for (const c of this.components) if (c.versions[0]) this.versions[c.name] = c.versions[0];
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const res = await fetch(this.previewUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ versions: this.versions, hostIds: this.allHosts ? undefined : this.hosts }),
      });
      if (!res.ok) throw new Error(`Preview failed (${res.status})`);
      this.preview = (await res.json()) as Preview;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Preview failed';
      this.preview = null;
    } finally {
      this.loading = false;
    }
  }

  private get selectedChannels(): ('app' | 'manual' | 'warehouse')[] {
    return (['app', 'manual', 'warehouse'] as const).filter((c) => this.channels[c]);
  }

  private get canSubmit(): boolean {
    return !this.submitting && !this.started
      && !!this.kitVersion.trim()
      && this.selectedChannels.length > 0
      && !(this.preview?.missing?.length)
      && (this.allHosts || this.hosts.length > 0);
  }

  private get allTerminal(): boolean {
    const ds = this.started?.deployments ?? [];
    return ds.length > 0 && ds.every((d) => GzKitRelease.TERMINAL.includes(this.statuses[d.deployment_id]?.status ?? ''));
  }

  private async submit(): Promise<void> {
    const chans = this.selectedChannels;
    const warns = chans.includes('warehouse');
    const msg = `Deploy dev kit ${this.kitVersion} to ${chans.join(', ')} in ‘dev’?`
      + (warns ? `\n\n⚠ The ‘warehouse’ channel triggers automatic updates to devices in factory mode in ‘dev’.` : '');
    if (!window.confirm(msg)) return;
    this.submitting = true;
    this.submitError = '';
    try {
      const res = await fetch(this.submitUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          versions: this.versions,
          hostIds: this.allHosts ? undefined : this.hosts,
          channels: chans,
          environment: this.env,
          kit_version: this.kitVersion.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string; environment: string; kit_version: string; host_count: number;
        deployments: { channel: string; deployment_id: string }[];
      };
      if (!res.ok) throw new Error(data.error || `Release failed (${res.status})`);
      this.started = { environment: data.environment, kit_version: data.kit_version, host_count: data.host_count, deployments: data.deployments ?? [] };
      // Seed each channel as queued, then poll to completion.
      this.statuses = Object.fromEntries(this.started.deployments.map((d) => [d.deployment_id, { status: 'in_progress', progress: 0, note: 'Queued…' }]));
      void this.pollStatuses();
    } catch (e) {
      this.submitError = e instanceof Error ? e.message : 'Release failed';
    } finally {
      this.submitting = false;
    }
  }

  /** Poll each deployment's status until all reach a terminal state. */
  private async pollStatuses(): Promise<void> {
    const ids = (this.started?.deployments ?? []).map((d) => d.deployment_id);
    for (let tick = 0; tick < 150 && !this.allTerminal; tick++) {
      await new Promise((r) => setTimeout(r, 2500));
      await Promise.all(ids.map(async (id) => {
        try {
          const res = await fetch(`${this.statusUrlBase}/${encodeURIComponent(id)}/status`);
          if (!res.ok) return;
          const s = (await res.json()) as { status: string; progress: number | null; note: string | null };
          this.statuses = { ...this.statuses, [id]: { status: s.status, progress: s.progress, note: s.note } };
        } catch { /* transient — keep polling */ }
      }));
    }
  }

  private card(title: string, body: TemplateResult, accent = false): TemplateResult {
    return html`<div class="card"><div class="card-head">${accent ? html`<span class="accent-bar"></span>` : nothing}<h2>${title}</h2></div><div class="card-body">${body}</div></div>`;
  }

  private sub(text: string): TemplateResult {
    return html`<div class="small faint" style="margin:-2px 0 10px;">${text}</div>`;
  }

  /** What each channel does, with the selected env substituted; warehouse warns. */
  private channelDesc(ch: 'app' | 'warehouse' | 'manual'): { text: string; warn: boolean } {
    const env = this.env;
    if (ch === 'app') return { text: `Releasing to ‘app’ publishes the release to users of the ‘${env}’ mobile app.`, warn: false };
    if (ch === 'manual') return { text: `Releasing to ‘manual’ publishes the release to be installed when a user holds the PAIR button for 10s.`, warn: false };
    return { text: `Releasing to ‘warehouse’ will lead to automatic updates being installed to devices in ‘factory mode’ in the ‘${env}’ environment.`, warn: true };
  }

  private toggleChip(on: boolean, label: string, onClick: () => void): TemplateResult {
    return html`<button type="button" class="chip ${on ? 'chip-on' : ''}" @click=${onClick}>${on ? '✓ ' : ''}${label}</button>`;
  }

  private renderSetup(): TemplateResult {
    const chans: ('app' | 'warehouse' | 'manual')[] = ['app', 'warehouse', 'manual'];
    return this.card('Dev kit', html`
      <div class="dc-sub" style="margin-bottom:12px;">
        ${this.sub('A dev kit always deploys to ‘dev’. Cut a release from it (in Kits & Releases) to deploy beyond dev.')}
      </div>
      <div class="dc-sub">
        <label class="label-caps">Kit version</label>
        ${this.sub('Version of the dev kit.')}
        <input class="dc-in mono" .value=${this.kitVersion} @input=${(e: Event) => { this.kitVersion = (e.target as HTMLInputElement).value; }} />
        ${this.suggested ? html`<span class="small faint">suggested ${this.suggested}</span>` : nothing}
      </div>
      <div class="dc-sub" style="margin-top:12px;">
        <label class="label-caps">Channels</label>
        ${this.sub('Channels to release to.')}
        <div class="chips">
          ${this.toggleChip(this.channels.app, 'app', () => { this.channels = { ...this.channels, app: !this.channels.app }; })}
          ${this.toggleChip(this.channels.warehouse, 'warehouse', () => { this.channels = { ...this.channels, warehouse: !this.channels.warehouse }; })}
          ${this.toggleChip(this.channels.manual, 'manual', () => { this.channels = { ...this.channels, manual: !this.channels.manual }; })}
        </div>
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px;">
          ${chans.filter((c) => this.channels[c]).map((c) => {
            const d = this.channelDesc(c);
            return html`<div class="small" style="color:${d.warn ? 'var(--orange,#ff9b3d)' : 'var(--text-secondary,#9aa39a)'};">${d.warn ? '⚠ ' : ''}${d.text}</div>`;
          })}
        </div>
      </div>
    `, true);
  }

  private renderHosts(): TemplateResult {
    return this.card('Hosts', html`
      ${this.sub('Choose which Host IDs (hardware revisions / models) will be able to install this release.')}
      <div class="chips">
        ${this.toggleChip(this.allHosts, `all hosts (${this.hostIds.length})`, () => { this.allHosts = !this.allHosts; void this.refresh(); })}
      </div>
      ${this.allHosts ? nothing : html`<div class="chips" style="margin-top:8px;">
        ${this.hostIds.map((h) => this.toggleChip(this.hosts.includes(h), h, () => {
          this.hosts = this.hosts.includes(h) ? this.hosts.filter((x) => x !== h) : [...this.hosts, h];
          void this.refresh();
        }))}
      </div>`}
    `);
  }

  private renderComponents(): TemplateResult {
    return this.card('Components', html`
      ${this.sub('Pick a built version per component (newest first). Only versions that exist as artifacts are listed.')}
      ${this.components.map((c) => html`
        <div class="dc-row">
          <span style="min-width:110px;">${c.name} <span class="chip ${c.set === 'xNode' ? '' : 'chip-on'}" style="font-size:10px;">${c.set}</span></span>
          <span class="mono small faint" style="min-width:240px;">${c.project || '—'}</span>
          ${c.versions.length ? html`
            <select class="dc-in mono" @change=${(e: Event) => { this.versions = { ...this.versions, [c.name]: (e.target as HTMLSelectElement).value }; void this.refresh(); }}>
              ${c.versions.map((v) => html`<option value=${v} ?selected=${this.versions[c.name] === v}>${v}</option>`)}
            </select>` : html`<span class="small" style="color:var(--orange,#ff9b3d);">no built artifacts</span>`}
        </div>`)}
    `);
  }

  private renderPreview(): TemplateResult {
    const p = this.preview;
    return this.card('Preview', html`
      ${this.sub('The per-host manifests this release would publish. Updates automatically as you change versions or hosts.')}
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
        ${this.loading ? html`<span class="small faint">updating…</span>` : nothing}
        ${p && !this.loading ? html`<span class="small faint">${p.host_count} host manifest${p.host_count === 1 ? '' : 's'}</span>` : nothing}
        ${p?.missing?.length ? html`<span class="small" style="color:var(--orange,#ff9b3d);">missing version: ${p.missing.join(', ')}</span>` : nothing}
      </div>
      ${this.error ? html`<div class="callout callout-error">${this.error}</div>` : nothing}
      ${p && p.manifests.length ? html`
        <details @toggle=${(e: Event) => { this.previewOpen = (e.target as HTMLDetailsElement).open; }}>
          <summary class="btn sm" style="display:inline-block;cursor:pointer;">${this.previewOpen ? 'Hide' : 'View'} preview (${p.host_count} hosts)</summary>
          <div style="margin-top:8px;">
            ${p.manifests.map((m) => html`
              <details class="dc-card" style="margin-bottom:6px;padding:8px 12px;">
                <summary class="mono" style="cursor:pointer;font-weight:600;">${m.hostId}</summary>
                <table class="tbl" style="margin-top:6px;"><tbody>
                  ${Object.entries(m.iNodes).map(([s, v]) => html`<tr><td class="mono">${s}</td><td class="mono">${v}</td></tr>`)}
                  ${Object.entries(m.xNodes ?? {}).map(([s, v]) => html`<tr><td class="mono">${s} <span class="small faint">(xNode)</span></td><td class="mono">${v}</td></tr>`)}
                </tbody></table>
              </details>`)}
          </div>
        </details>` : nothing}
    `, true);
  }

  /** Live progress panel: one row per channel, polled to completion. */
  private renderProgress(): TemplateResult {
    const r = this.started!;
    const done = this.allTerminal;
    const anyFailed = r.deployments.some((d) => ['failed', 'denied'].includes(this.statuses[d.deployment_id]?.status ?? ''));
    const badge = (s: string): TemplateResult => {
      const cls = s === 'succeeded' ? 'ok' : ['failed', 'denied'].includes(s) ? 'err' : s === 'cancelled' ? 'idle' : 'info';
      const label = s === 'in_progress' ? 'In progress' : s.charAt(0).toUpperCase() + s.slice(1);
      return html`<span class="badge ${cls}">${label}</span>`;
    };
    const title = done
      ? (anyFailed ? 'Release finished with errors' : 'Release published')
      : 'Release in progress…';
    return this.card(title, html`
      <div class="small">${done ? '' : html`<span class="badge info">started</span> `}<span class="mono">${r.kit_version}</span> → <span class="mono">${r.environment}</span> · ${r.host_count} host${r.host_count === 1 ? '' : 's'} · ${r.deployments.length} channel${r.deployments.length === 1 ? '' : 's'}</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px;">
        ${r.deployments.map((d) => {
          const st = this.statuses[d.deployment_id] ?? { status: 'in_progress', progress: 0, note: 'Queued…' };
          const pct = st.status === 'succeeded' ? 100 : Math.max(2, st.progress ?? 0);
          const barColor = ['failed', 'denied'].includes(st.status) ? 'var(--red,#ff6b6b)' : st.status === 'succeeded' ? 'var(--gz-green,#bfd22b)' : 'var(--gz-green,#bfd22b)';
          return html`<div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span class="mono" style="min-width:130px;">${d.channel}</span>${badge(st.status)}
              <span class="grow"></span>
              <a class="small faint mono" href="${this.statusUrlBase}/${encodeURIComponent(d.deployment_id)}" target="_blank" rel="noopener">details ↗</a>
            </div>
            <div style="height:8px;border-radius:4px;background:var(--bg-input,#1f2126);overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:${barColor};transition:width .4s ease;"></div>
            </div>
            <div class="small faint" style="margin-top:4px;">${st.note ?? ''}</div>
          </div>`;
        })}
      </div>
      ${done ? html`<div style="margin-top:14px;"><a class="btn btn-primary" href=${this.cancelUrl}>Back to project</a></div>`
             : this.sub('You can leave this page — the release continues. Progress updates here every few seconds.')}
    `, true);
  }

  render(): TemplateResult {
    if (this.started) {
      return html`${this.renderProgress()}`;
    }
    const chans = this.selectedChannels;
    return html`
      ${this.renderSetup()}
      ${this.renderHosts()}
      ${this.renderComponents()}
      ${this.renderPreview()}
      <div class="dc-savebar">
        ${this.submitError ? html`<span class="small" style="color:var(--red,#ff6b6b);">${this.submitError}</span>` : html`<span class="small faint">${chans.length ? `Will deploy the dev kit to ${chans.join(', ')} in ‘dev’.` : 'Select at least one channel.'}</span>`}
        <span class="grow"></span>
        <a class="btn btn-ghost" href=${this.cancelUrl}>Back</a>
        <button type="button" class="btn btn-primary" ?disabled=${!this.canSubmit} @click=${() => void this.submit()}>
          ${this.submitting ? 'Deploying…' : 'Deploy dev kit'}
        </button>
      </div>`;
  }
}
