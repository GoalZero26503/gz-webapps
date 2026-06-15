import { html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

/**
 * Stateful editor for a project's deploy-config (Phase B). Renders into LIGHT DOM
 * so the app's global CSS (.card/.btn/.chip/.tbl/.dc-*) applies. Holds an editable
 * model, supports add/remove on every list (pipelines, artifacts, kit releases +
 * per-slot manifests), and on Save POSTs the assembled DeployConfigInput as JSON.
 *
 *   <gz-deploy-config-editor
 *      config='<json>' project-id="..." project-type="firmware-kit"
 *      save-url="/cicd/projects/ID/config" cancel-url="/cicd/projects/ID?tab=config"
 *      envs="dev,test,alpha,beta,stage,prod"></gz-deploy-config-editor>
 */

interface Pipeline { name: string; plugin: string; runner?: string; config?: Record<string, unknown> }
interface ArtifactDef { id: string; name_pattern: string; build_pipeline: string; deploy_pipelines: string[]; envs?: string[] }
interface KitComp { name: string; project: string; version?: string }
interface KitRelease { version?: string; build_targets?: string[]; manifest: { iNodes: Record<string, string>; xNodes?: Record<string, string> } }
interface Kit { host_ids: string[]; components?: KitComp[]; releases: KitRelease[] }
interface HealthCfg { url: string; environments?: string[]; overrides?: Record<string, string> }
interface Model {
  environments: string[];
  deploy_pipelines: Pipeline[];
  artifacts: ArtifactDef[];
  kit?: Kit;
  health_check?: HealthCfg;
  note?: string;
}

const PLUGINS = ['s3', 'firmware-kit-deploy', 'testflight', 'playstore', 'github-action', 'firebase'];

@customElement('gz-deploy-config-editor')
export class GzDeployConfigEditor extends LitElement {
  @property({ type: String }) config = '{}';
  @property({ attribute: 'project-id' }) projectId = '';
  @property({ attribute: 'project-type' }) projectType = '';
  @property({ attribute: 'save-url' }) saveUrl = '';
  @property({ attribute: 'cancel-url' }) cancelUrl = '';
  @property({ attribute: 'envs' }) envsAttr = 'dev,test,alpha,beta,stage,prod';

  @state() private m!: Model;
  @state() private saving = false;
  @state() private error = '';

  // Light DOM so global app styles apply.
  protected createRenderRoot(): HTMLElement { return this; }

  private get allEnvs(): string[] { return this.envsAttr.split(',').map((s) => s.trim()).filter(Boolean); }

  connectedCallback(): void {
    super.connectedCallback();
    let parsed: Partial<Model> = {};
    try { parsed = JSON.parse(this.config) as Partial<Model>; } catch { /* start blank */ }
    this.m = {
      environments: parsed.environments ?? [],
      deploy_pipelines: parsed.deploy_pipelines ?? [],
      artifacts: parsed.artifacts ?? [],
      kit: parsed.kit,
      health_check: parsed.health_check,
      note: '',
    };
  }

  private bump(): void { this.m = { ...this.m }; }

  // ── Save ──────────────────────────────────────────────────
  private async save(): Promise<void> {
    this.saving = true;
    this.error = '';
    try {
      const body: Model = {
        environments: this.m.environments,
        deploy_pipelines: this.m.deploy_pipelines,
        artifacts: this.m.artifacts,
        ...(this.m.kit ? { kit: this.m.kit } : {}),
        ...(this.m.health_check?.url ? { health_check: this.m.health_check } : {}),
        note: this.m.note || undefined,
      };
      const res = await fetch(this.saveUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      window.location.href = this.cancelUrl; // back to the read view (now the new version)
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Save failed';
      this.saving = false;
    }
  }

  // ── Section renderers ─────────────────────────────────────
  private section(title: string, body: TemplateResult, accent = false): TemplateResult {
    return html`<div class="card"><div class="card-head">${accent ? html`<span class="accent-bar"></span>` : nothing}<h2>${title}</h2></div><div class="card-body">${body}</div></div>`;
  }

  private envToggles(selected: string[], onToggle: (e: string) => void): TemplateResult {
    return html`<div class="chips">${this.allEnvs.map((e) => html`
      <button type="button" class="chip ${selected.includes(e) ? 'chip-on' : ''}" @click=${() => onToggle(e)}>${e}</button>`)}</div>`;
  }

  private renderEnvironments(): TemplateResult {
    return this.section('Environments', this.envToggles(this.m.environments, (e) => {
      this.m.environments = this.m.environments.includes(e) ? this.m.environments.filter((x) => x !== e) : [...this.m.environments, e];
      this.bump();
    }), true);
  }

  private renderPipelines(): TemplateResult {
    return this.section('Deploy pipelines', html`
      ${this.m.deploy_pipelines.map((p, i) => html`
        <div class="dc-row">
          <input class="dc-in" placeholder="name" .value=${p.name} @input=${(ev: Event) => { p.name = (ev.target as HTMLInputElement).value; }} />
          <select class="dc-in" .value=${p.plugin} @change=${(ev: Event) => { p.plugin = (ev.target as HTMLSelectElement).value; this.bump(); }}>
            ${PLUGINS.map((pl) => html`<option value=${pl} ?selected=${pl === p.plugin}>${pl}</option>`)}
          </select>
          <input class="dc-in mono" placeholder='config JSON {"bucket":"…"}' .value=${JSON.stringify(p.config ?? {})}
            @change=${(ev: Event) => { try { p.config = JSON.parse((ev.target as HTMLInputElement).value || '{}'); (ev.target as HTMLInputElement).setCustomValidity(''); } catch { (ev.target as HTMLInputElement).setCustomValidity('invalid JSON'); } }} />
          <button type="button" class="btn sm ghost" @click=${() => { this.m.deploy_pipelines.splice(i, 1); this.bump(); }}>✕</button>
        </div>`)}
      <button type="button" class="btn sm" @click=${() => { this.m.deploy_pipelines = [...this.m.deploy_pipelines, { name: '', plugin: 's3', config: {} }]; this.bump(); }}>+ Add pipeline</button>
    `);
  }

  private renderArtifacts(): TemplateResult {
    const pipeNames = this.m.deploy_pipelines.map((p) => p.name).filter(Boolean);
    return this.section('Artifact routing', html`
      ${this.m.artifacts.map((a, i) => html`
        <div class="dc-card">
          <div class="dc-row">
            <input class="dc-in" placeholder="id" .value=${a.id} @input=${(ev: Event) => { a.id = (ev.target as HTMLInputElement).value; }} />
            <input class="dc-in mono" placeholder="name_pattern (*.zip)" .value=${a.name_pattern} @input=${(ev: Event) => { a.name_pattern = (ev.target as HTMLInputElement).value; }} />
            <input class="dc-in" placeholder="build pipeline" .value=${a.build_pipeline} @input=${(ev: Event) => { a.build_pipeline = (ev.target as HTMLInputElement).value; }} />
            <button type="button" class="btn sm ghost" @click=${() => { this.m.artifacts.splice(i, 1); this.bump(); }}>✕</button>
          </div>
          <div class="dc-sub"><span class="label-caps">Deploy via</span>
            <div class="chips">${pipeNames.length ? pipeNames.map((n) => html`
              <button type="button" class="chip ${a.deploy_pipelines.includes(n) ? 'chip-on' : ''}" @click=${() => { a.deploy_pipelines = a.deploy_pipelines.includes(n) ? a.deploy_pipelines.filter((x) => x !== n) : [...a.deploy_pipelines, n]; this.bump(); }}>${n}</button>`)
              : html`<span class="small faint">define pipelines above first</span>`}</div>
          </div>
          <div class="dc-sub"><span class="label-caps">Envs</span>
            ${this.envToggles(a.envs ?? [], (e) => { a.envs = (a.envs ?? []).includes(e) ? (a.envs ?? []).filter((x) => x !== e) : [...(a.envs ?? []), e]; this.bump(); })}</div>
        </div>`)}
      <button type="button" class="btn sm" @click=${() => { this.m.artifacts = [...this.m.artifacts, { id: '', name_pattern: '', build_pipeline: '', deploy_pipelines: [], envs: ['*'] }]; this.bump(); }}>+ Add artifact</button>
    `);
  }

  // ── Kit composer (the centerpiece) ────────────────────────
  private renderKit(): TemplateResult {
    const kit = this.m.kit!;
    return this.section('Kit releases', html`
      <div class="label-caps">Host topology</div>
      <div class="dc-sub"><input class="dc-in mono wide" placeholder="comma-separated host ids (H-…)" .value=${kit.host_ids.join(', ')}
        @change=${(ev: Event) => { kit.host_ids = (ev.target as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean); this.bump(); }} /></div>

      <div class="label-caps" style="margin-top:14px;">Components</div>
      ${(kit.components ?? []).map((c, i) => html`
        <div class="dc-row">
          <input class="dc-in" placeholder="name" .value=${c.name} @input=${(ev: Event) => { c.name = (ev.target as HTMLInputElement).value; }} />
          <input class="dc-in mono" placeholder="node project id" .value=${c.project} @input=${(ev: Event) => { c.project = (ev.target as HTMLInputElement).value; }} />
          <input class="dc-in mono" placeholder="version" .value=${c.version ?? ''} @input=${(ev: Event) => { c.version = (ev.target as HTMLInputElement).value; }} />
          <button type="button" class="btn sm ghost" @click=${() => { kit.components!.splice(i, 1); this.bump(); }}>✕</button>
        </div>`)}
      <button type="button" class="btn sm" @click=${() => { kit.components = [...(kit.components ?? []), { name: '', project: '', version: '' }]; this.bump(); }}>+ Add component</button>

      <div class="label-caps" style="margin-top:16px;">Releases</div>
      ${kit.releases.map((r, ri) => this.renderRelease(kit, r, ri))}
      <button type="button" class="btn sm" @click=${() => { kit.releases = [...kit.releases, { version: '', build_targets: ['*'], manifest: { iNodes: {} } }]; this.bump(); }}>+ Add release</button>
    `, true);
  }

  private renderRelease(kit: Kit, r: KitRelease, ri: number): TemplateResult {
    const slots = Object.entries(r.manifest.iNodes ?? {});
    const xslots = Object.entries(r.manifest.xNodes ?? {});
    const targets = r.build_targets ?? ['*'];
    const slotRow = (slot: string, ver: string, map: Record<string, string>, x: boolean): TemplateResult => html`
      <div class="dc-row">
        <input class="dc-in mono" placeholder=${x ? 'xNode id (N-…)' : 'slot (A20-1)'} .value=${slot}
          @change=${(ev: Event) => { const nk = (ev.target as HTMLInputElement).value.trim(); if (nk !== slot) { map[nk] = map[slot]; delete map[slot]; } this.bump(); }} />
        <input class="dc-in mono" placeholder="version" .value=${ver}
          @input=${(ev: Event) => { map[slot] = (ev.target as HTMLInputElement).value; }} />
        <button type="button" class="btn sm ghost" @click=${() => { delete map[slot]; this.bump(); }}>✕</button>
      </div>`;
    return html`
      <div class="dc-card">
        <div class="dc-row">
          <input class="dc-in" placeholder="version (1.3.6)" .value=${r.version ?? ''} @input=${(ev: Event) => { r.version = (ev.target as HTMLInputElement).value; }} />
          <button type="button" class="btn sm ghost" @click=${() => { kit.releases.splice(ri, 1); this.bump(); }}>Remove release ✕</button>
        </div>
        <div class="dc-sub"><span class="label-caps">Applies to hosts</span>
          <div class="chips">
            <button type="button" class="chip ${targets.includes('*') ? 'chip-on' : ''}" @click=${() => { r.build_targets = ['*']; this.bump(); }}>all (*)</button>
            ${kit.host_ids.map((h) => html`<button type="button" class="chip mono ${targets.includes(h) ? 'chip-on' : ''}"
              @click=${() => { const cur = (r.build_targets ?? []).filter((t) => t !== '*'); r.build_targets = cur.includes(h) ? cur.filter((x) => x !== h) : [...cur, h]; if (!r.build_targets.length) r.build_targets = ['*']; this.bump(); }}>${h}</button>`)}
          </div>
        </div>
        <div class="dc-sub"><span class="label-caps">Node firmware (iNodes)</span>
          ${slots.map(([s, v]) => slotRow(s, v, r.manifest.iNodes, false))}
          <button type="button" class="btn sm" @click=${() => { r.manifest.iNodes[`slot-${slots.length + 1}`] = ''; this.bump(); }}>+ Add slot</button>
        </div>
        <div class="dc-sub"><span class="label-caps">Accessory nodes (xNodes)</span>
          ${xslots.map(([s, v]) => slotRow(s, v, (r.manifest.xNodes ??= {}), true))}
          <button type="button" class="btn sm" @click=${() => { (r.manifest.xNodes ??= {})[`N-`] = ''; this.bump(); }}>+ Add xNode</button>
        </div>
      </div>`;
  }

  private renderHealth(): TemplateResult {
    const h = this.m.health_check;
    return this.section('Health check', html`
      ${h ? html`
        <div class="dc-sub"><span class="label-caps">URL ({env} placeholder)</span>
          <input class="dc-in mono wide" placeholder="https://yeti-{env}.goalzeroapp.com/health" .value=${h.url}
            @input=${(ev: Event) => { h.url = (ev.target as HTMLInputElement).value; }} /></div>
        <div class="dc-sub"><span class="label-caps">Environments</span>
          ${this.envToggles(h.environments ?? this.allEnvs, (e) => { const cur = h.environments ?? [...this.allEnvs]; h.environments = cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]; this.bump(); })}</div>
        <button type="button" class="btn sm ghost" @click=${() => { this.m.health_check = undefined; this.bump(); }}>Remove health check</button>
      ` : html`<button type="button" class="btn sm" @click=${() => { this.m.health_check = { url: 'https://{env}.example.com/health', environments: [...this.allEnvs] }; this.bump(); }}>+ Add health check</button>`}
    `);
  }

  render(): TemplateResult {
    if (!this.m) return html`${nothing}`;
    const isKit = this.projectType === 'firmware-kit' || !!this.m.kit;
    return html`
      ${this.error ? html`<div class="callout callout-error">${this.error}</div>` : nothing}
      ${this.renderEnvironments()}
      ${this.renderPipelines()}
      ${this.renderArtifacts()}
      ${isKit ? html`${this.m.kit ? this.renderKit() : html`<div class="card"><div class="card-body"><button type="button" class="btn sm" @click=${() => { this.m.kit = { host_ids: [], components: [], releases: [] }; this.bump(); }}>+ Add kit config</button></div></div>`}` : nothing}
      ${this.renderHealth()}
      <div class="dc-savebar">
        <input class="dc-in wide" placeholder="change note (optional)" .value=${this.m.note ?? ''} @input=${(ev: Event) => { this.m.note = (ev.target as HTMLInputElement).value; }} />
        <span class="grow"></span>
        <a class="btn btn-ghost" href=${this.cancelUrl}>Cancel</a>
        <button type="button" class="btn btn-primary" ?disabled=${this.saving} @click=${() => this.save()}>${this.saving ? 'Saving…' : 'Save new version'}</button>
      </div>`;
  }
}
