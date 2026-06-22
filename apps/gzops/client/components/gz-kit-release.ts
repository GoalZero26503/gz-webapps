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

  private renderSetup(): TemplateResult {
    return this.card('Release', html`
      <div class="dc-row">
        <label class="label-caps" style="min-width:90px;">Environment</label>
        <select class="dc-in" @change=${(e: Event) => { this.env = (e.target as HTMLSelectElement).value; }}>
          ${this.allEnvs.map((x) => html`<option value=${x} ?selected=${x === this.env}>${x}</option>`)}
        </select>
        <label class="label-caps" style="min-width:80px;">Kit version</label>
        <input class="dc-in mono" .value=${this.kitVersion} @input=${(e: Event) => { this.kitVersion = (e.target as HTMLInputElement).value; }} />
        ${this.suggested ? html`<span class="small faint">suggested ${this.suggested}</span>` : nothing}
      </div>
      <div class="dc-sub"><span class="label-caps">Channels</span>
        <label class="chip ${this.channels.app ? 'chip-on' : ''}"><input type="checkbox" .checked=${this.channels.app} @change=${(e: Event) => { this.channels = { ...this.channels, app: (e.target as HTMLInputElement).checked }; }} /> app</label>
        <label class="chip ${this.channels.warehouse ? 'chip-on' : ''}"><input type="checkbox" .checked=${this.channels.warehouse} @change=${(e: Event) => { this.channels = { ...this.channels, warehouse: (e.target as HTMLInputElement).checked }; }} /> warehouse</label>
        <label class="chip ${this.channels.manual ? 'chip-on' : ''}"><input type="checkbox" .checked=${this.channels.manual} @change=${(e: Event) => { this.channels = { ...this.channels, manual: (e.target as HTMLInputElement).checked }; }} /> manual</label>
        ${this.channels.warehouse ? html`<span class="small" style="color:var(--orange,#ff9b3d);">⚠ warehouse ships to production-line tooling — use deliberately</span>` : nothing}
      </div>
    `, true);
  }

  private renderHosts(): TemplateResult {
    return this.card('Hosts', html`
      <label class="chip ${this.allHosts ? 'chip-on' : ''}"><input type="checkbox" .checked=${this.allHosts}
        @change=${(e: Event) => { this.allHosts = (e.target as HTMLInputElement).checked; void this.refresh(); }} /> all hosts (${this.hostIds.length})</label>
      ${this.allHosts ? nothing : html`<div class="chips" style="margin-top:8px;">
        ${this.hostIds.map((h) => html`<button type="button" class="chip mono ${this.hosts.includes(h) ? 'chip-on' : ''}"
          @click=${() => { this.hosts = this.hosts.includes(h) ? this.hosts.filter((x) => x !== h) : [...this.hosts, h]; void this.refresh(); }}>${h}</button>`)}
      </div>`}
    `);
  }

  private renderComponents(): TemplateResult {
    return this.card('Components', html`
      <div class="small faint" style="margin-bottom:6px;">Pick a built version per component (newest first). Only versions that exist as artifacts are listed.</div>
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
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <button type="button" class="btn sm" @click=${() => void this.refresh()} ?disabled=${this.loading}>${this.loading ? 'Previewing…' : 'Refresh preview'}</button>
        ${p ? html`<span class="small faint">${p.host_count} host manifest${p.host_count === 1 ? '' : 's'}</span>` : nothing}
        ${p?.missing?.length ? html`<span class="small" style="color:var(--orange,#ff9b3d);">missing version: ${p.missing.join(', ')}</span>` : nothing}
      </div>
      ${this.error ? html`<div class="callout callout-error">${this.error}</div>` : nothing}
      ${p ? html`<div class="rail-scroll">${p.manifests.map((m) => html`
        <div class="dc-card" style="margin-bottom:8px;">
          <div class="mono" style="font-weight:600;margin-bottom:4px;">${m.hostId}</div>
          <table class="tbl"><tbody>
            ${Object.entries(m.iNodes).map(([s, v]) => html`<tr><td class="mono">${s}</td><td class="mono">${v}</td></tr>`)}
            ${Object.entries(m.xNodes ?? {}).map(([s, v]) => html`<tr><td class="mono">${s} <span class="small faint">(xNode)</span></td><td class="mono">${v}</td></tr>`)}
          </tbody></table>
        </div>`)}</div>` : nothing}
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
