import { html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

/**
 * Create Release composer for a firmware-kit (phase 3b — PREVIEW ONLY).
 *
 * You pick one built version per component, an environment, channels, and a host
 * scope; the widget calls the read-only preview endpoint and renders the per-host
 * manifests the release WOULD write. No artifacts are copied and no manifests are
 * published — the CD worker (submit) lands in phase 3c.
 *
 *   <gz-kit-release project-id="…" envs="dev,test,…" suggested-version="1.8.8"
 *      host-ids='[...]' components='[{name,set,slots,project,versions[]}]'
 *      preview-url="/cicd/projects/ID/release/preview" cancel-url="…">
 */
interface Comp { name: string; set: 'iNode' | 'xNode'; slots: string[]; project: string; versions: string[] }
interface HostManifest { hostId: string; iNodes: Record<string, string>; xNodes?: Record<string, string> }
interface Preview { manifests: HostManifest[]; missing: string[]; host_count: number }

@customElement('gz-kit-release')
export class GzKitRelease extends LitElement {
  @property({ attribute: 'project-id' }) projectId = '';
  @property({ attribute: 'preview-url' }) previewUrl = '';
  @property({ attribute: 'cancel-url' }) cancelUrl = '';
  @property({ attribute: 'suggested-version' }) suggested = '';
  @property({ attribute: 'envs' }) envsAttr = 'dev,test,alpha,beta,stage,prod';
  @property({ attribute: 'host-ids' }) hostIdsAttr = '[]';
  @property({ attribute: 'components' }) componentsAttr = '[]';

  @state() private env = 'dev';
  @state() private channels = { app: true, warehouse: false, manual: false };
  @state() private allHosts = true;
  @state() private hosts: string[] = [];
  @state() private versions: Record<string, string> = {};
  @state() private kitVersion = '';
  @state() private preview: Preview | null = null;
  @state() private loading = false;
  @state() private error = '';

  protected createRenderRoot(): HTMLElement { return this; }

  private get allEnvs(): string[] { return this.envsAttr.split(',').map((s) => s.trim()).filter(Boolean); }
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
    return this.card('Release', html`
      <div class="dc-row" style="align-items:flex-start;">
        <div style="flex:1;">
          <label class="label-caps">Environment</label>
          ${this.sub('The environment to release to.')}
          <select class="dc-in" @change=${(e: Event) => { this.env = (e.target as HTMLSelectElement).value; }}>
            ${this.allEnvs.map((x) => html`<option value=${x} ?selected=${x === this.env}>${x}</option>`)}
          </select>
        </div>
        <div style="flex:1;">
          <label class="label-caps">Kit version</label>
          ${this.sub('Version of the release.')}
          <input class="dc-in mono" .value=${this.kitVersion} @input=${(e: Event) => { this.kitVersion = (e.target as HTMLInputElement).value; }} />
          ${this.suggested ? html`<span class="small faint">suggested ${this.suggested}</span>` : nothing}
        </div>
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
        <details>
          <summary class="btn sm" style="display:inline-block;cursor:pointer;">View preview (${p.host_count} hosts)</summary>
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

  render(): TemplateResult {
    return html`
      ${this.renderSetup()}
      ${this.renderHosts()}
      ${this.renderComponents()}
      ${this.renderPreview()}
      <div class="dc-savebar">
        <span class="small faint">Preview only — creating the release (artifact copy + manifest publish) lands next.</span>
        <span class="grow"></span>
        <a class="btn btn-ghost" href=${this.cancelUrl}>Back</a>
        <button type="button" class="btn btn-primary" disabled title="CD worker coming in the next phase">Create release</button>
      </div>`;
  }
}
