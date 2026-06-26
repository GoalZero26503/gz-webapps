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
interface KitComp { name: string; project: string; set?: 'iNode' | 'xNode'; slots?: string[]; artifact?: string; version?: string }
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
  /** firmware-node projects available as component sources: JSON [{id,name}]. */
  @property({ attribute: 'node-projects' }) nodeProjectsAttr = '[]';

  @state() private m!: Model;
  @state() private saving = false;
  @state() private error = '';
  /** Which section descriptions are expanded (keyed by section title). */
  @state() private infoOpen = new Set<string>();
  /** Raw-JSON escape hatch: edit the whole config as text (advanced). */
  @state() private raw = false;
  @state() private rawText = '';

  // Light DOM so global app styles apply.
  protected createRenderRoot(): HTMLElement { return this; }

  /**
   * Section description: a one-line summary across the full width, with an ⓘ
   * toggle that reveals the full detail inline (keeps the form compact while
   * the detail stays one click away).
   */
  private infoDesc(key: string, short: string, full?: string | TemplateResult): TemplateResult {
    const open = this.infoOpen.has(key);
    const toggle = () => { open ? this.infoOpen.delete(key) : this.infoOpen.add(key); this.infoOpen = new Set(this.infoOpen); };
    return html`<div class="dc-desc">
      <div class="dc-desc-line"><span class="small faint">${short}</span>${full
        ? html`<button type="button" class="dc-info" title=${open ? 'Hide details' : 'More'} aria-expanded=${open} @click=${toggle}>${open ? '×' : 'ⓘ'}</button>`
        : nothing}</div>
      ${open && full ? html`<div class="small faint dc-desc-full">${full}</div>` : nothing}
    </div>`;
  }

  private get allEnvs(): string[] { return this.envsAttr.split(',').map((s) => s.trim()).filter(Boolean); }

  connectedCallback(): void {
    super.connectedCallback();
    let parsed: Partial<Model> = {};
    try { parsed = JSON.parse(this.config) as Partial<Model>; } catch { /* start blank */ }
    this.m = {
      environments: parsed.environments ?? [],
      deploy_pipelines: parsed.deploy_pipelines ?? [],
      // Normalize optional list fields the editor mutates in place — a stored artifact
      // can omit deploy_pipelines (e.g. a bundle that isn't deployed), which would crash
      // the routing toggles' .includes/.filter.
      artifacts: (parsed.artifacts ?? []).map((a) => ({ ...a, deploy_pipelines: a.deploy_pipelines ?? [], envs: a.envs ?? ['*'] })),
      kit: parsed.kit,
      health_check: parsed.health_check,
      note: '',
    };
  }

  private bump(): void { this.m = { ...this.m }; }

  /** Assemble the POST body from the structured model. */
  private body(): Model {
    return {
      environments: this.m.environments,
      deploy_pipelines: this.m.deploy_pipelines,
      artifacts: this.m.artifacts,
      ...(this.m.kit ? { kit: this.m.kit } : {}),
      ...(this.m.health_check?.url ? { health_check: this.m.health_check } : {}),
      note: this.m.note || undefined,
    };
  }

  /** Toggle the raw-JSON escape hatch, syncing model ⇄ text on each switch. */
  private toggleRaw(): void {
    if (!this.raw) {
      this.rawText = JSON.stringify(this.body(), null, 2);
      this.raw = true;
      this.error = '';
    } else {
      try {
        const p = JSON.parse(this.rawText) as Partial<Model>;
        if (!Array.isArray(p.environments) || !Array.isArray(p.deploy_pipelines)) {
          throw new Error('environments and deploy_pipelines must be arrays');
        }
        this.m = {
          environments: p.environments, deploy_pipelines: p.deploy_pipelines,
          artifacts: p.artifacts ?? [], kit: p.kit, health_check: p.health_check, note: this.m.note,
        };
        this.raw = false;
        this.error = '';
      } catch (e) {
        this.error = `Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`;
      }
    }
  }

  // ── Save ──────────────────────────────────────────────────
  private async save(): Promise<void> {
    this.saving = true;
    this.error = '';
    try {
      let body: Model;
      if (this.raw) {
        try { body = JSON.parse(this.rawText) as Model; } catch { throw new Error('Invalid JSON — fix it before saving'); }
        if (!Array.isArray(body.environments) || !Array.isArray(body.deploy_pipelines)) {
          throw new Error('environments and deploy_pipelines must be arrays');
        }
      } else {
        body = this.body();
      }
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
  private section(title: string, body: TemplateResult, accent = false, desc?: { short: string; full?: string | TemplateResult }): TemplateResult {
    return html`<div class="card"><div class="card-head">${accent ? html`<span class="accent-bar"></span>` : nothing}<h2>${title}</h2></div><div class="card-body">${desc ? this.infoDesc(title, desc.short, desc.full) : nothing}${body}</div></div>`;
  }

  /** Env toggle chips — selected show a ✓ and turn green (matches the Create Release UI). */
  private envToggles(selected: string[], onToggle: (e: string) => void): TemplateResult {
    return html`<div class="chips">${this.allEnvs.map((e) => html`
      <button type="button" class="chip ${selected.includes(e) ? 'chip-on' : ''}" @click=${() => onToggle(e)}>${selected.includes(e) ? '✓ ' : ''}${e}</button>`)}</div>`;
  }

  private renderEnvironments(): TemplateResult {
    return this.section('Environments', this.envToggles(this.m.environments, (e) => {
      this.m.environments = this.m.environments.includes(e) ? this.m.environments.filter((x) => x !== e) : [...this.m.environments, e];
      this.bump();
    }), true, {
      short: 'Which deployment environments this project targets, in promotion order (dev → test → alpha → beta → stage → prod).',
      full: 'A release can only be sent to an environment that is enabled here.',
    });
  }

  /** firmware-node: the only real input is the node IDs each image fans out to.
   *  bucket + path follow the firmware convention (inferred by the platform), so we
   *  surface just name + node IDs; "Edit raw JSON" exposes everything else. */
  private renderNodePipelines(): TemplateResult {
    return this.section('Deploy pipelines', html`
      ${this.m.deploy_pipelines.map((p, i) => {
        const nodeIds = Array.isArray(p.config?.node_ids) ? (p.config!.node_ids as string[]) : [];
        return html`
        <div class="dc-card">
          <div class="dc-row">
            <input class="dc-in" placeholder="pipeline name (e.g. firmware-s3)" .value=${p.name}
              @input=${(ev: Event) => { p.name = (ev.target as HTMLInputElement).value; }} />
            <button type="button" class="btn sm ghost" @click=${() => { this.m.deploy_pipelines.splice(i, 1); this.bump(); }}>✕</button>
          </div>
          <div class="dc-sub"><span class="label-caps">Node IDs (one per line)</span>
            <textarea class="dc-in mono wide" style="min-height:84px;" placeholder="N-37500-A10-1&#10;N-37500-A20-1" .value=${nodeIds.join('\n')}
              @change=${(ev: Event) => {
                const ids = (ev.target as HTMLTextAreaElement).value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
                // Keep only the variable bits — drop bucket/path so the platform applies
                // the firmware-node convention; preserve anything else (e.g. role_arn).
                const { bucket: _b, path_template: _p, ...rest } = (p.config ?? {}) as Record<string, unknown>;
                p.config = { ...rest, node_ids: ids };
                this.bump();
              }}></textarea>
          </div>
        </div>`;
      })}
      <button type="button" class="btn sm" @click=${() => { this.m.deploy_pipelines = [...this.m.deploy_pipelines, { name: '', plugin: 's3', config: { node_ids: [] } }]; this.bump(); }}>+ Add pipeline</button>
    `, false, {
      short: 'Where each node firmware image is published. You only set the node IDs — gzops infers the bucket (gz-{env}-firmware-images) and path ({nodeId}/{version}.{ext}).',
      full: 'Most firmware-node projects have one pipeline (all node IDs); some fan different SKU groups to separate pipelines. Need a non-standard bucket/path or a cross-account role? Use “Edit raw JSON”.',
    });
  }

  private renderPipelines(): TemplateResult {
    if (this.projectType === 'firmware-node') return this.renderNodePipelines();
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
    `, false, {
      short: 'A named delivery method (a plugin + its config) — defines HOW a built artifact or kit manifest reaches an environment.',
      full: 'e.g. firmware-kit-deploy publishes per-host manifests to an S3 channel, testflight/playstore push a mobile build, github-action dispatches a workflow. Artifact routing and kit channels reference these pipelines by name. Each row: a name, the plugin, and a JSON config blob (bucket, channel, role_arn, …).',
    });
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
    `, false, {
      short: 'Routes build outputs to deploy pipelines — connects “a build finished” to “deploy it here, this way”.',
      full: 'Each rule matches the files a build produces by filename glob (name_pattern, e.g. *.zip or pcu-*.bin), names the build pipeline that produced them, and sends matches through the chosen deploy pipeline(s) — limited to the selected environments (* = all). Firmware-kit projects publish manifests per channel and usually need no artifact rules.',
    });
  }

  // ── Kit configuration (topology + component schema) ───────
  private get nodeProjects(): { id: string; name: string }[] {
    try { const a = JSON.parse(this.nodeProjectsAttr); return Array.isArray(a) ? a : []; } catch { return []; }
  }

  private renderKit(): TemplateResult {
    const kit = this.m.kit!;
    const nodes = this.nodeProjects;
    return this.section('Kit configuration', html`
      <div class="label-caps">Host topology</div>
      <div class="small faint" style="margin-bottom:6px;">The hardware variants (Host IDs) this kit builds for.</div>
      ${kit.host_ids.map((h, i) => html`
        <div class="dc-row">
          <input class="dc-in mono wide" placeholder="H-…" .value=${h}
            @input=${(ev: Event) => { kit.host_ids[i] = (ev.target as HTMLInputElement).value.trim(); }} />
          <button type="button" class="btn sm ghost" @click=${() => { kit.host_ids.splice(i, 1); this.bump(); }}>✕</button>
        </div>`)}
      <button type="button" class="btn sm" @click=${() => { kit.host_ids = [...kit.host_ids, '']; this.bump(); }}>+ Add Host ID</button>

      <div class="label-caps" style="margin-top:16px;">Components</div>
      ${this.infoDesc('Components',
        'Each node-firmware slot in the kit and the project that supplies its binary. Versions are chosen per release, not here.',
        html`<b>Set</b> — <b>iNode</b>: a board inside the host that derives its node ID from the host (use a glob slot). <b>xNode</b>: a self-contained accessory with its own SKU (use explicit node IDs).<br/>
        <b>Slots</b> — comma-separated. For iNodes use a glob like <span class="mono">A*-1</span>: the <span class="mono">*</span> fills in the host's own board variant, so on host <span class="mono">H-37500-<b>A20</b>-…</span> the slot <span class="mono">A*-1</span> resolves to node <span class="mono">N-37500-A20-1</span> (a host without that board just skips it). For xNodes list the full node ID(s) verbatim — e.g. <span class="mono">N-23110-A2-1</span> — no wildcards; add one entry per hardware rev you want to advertise.`)}
      ${(kit.components ?? []).map((c, i) => html`
        <div class="dc-row">
          <input class="dc-in" placeholder="label (PCU)" .value=${c.name} @input=${(ev: Event) => { c.name = (ev.target as HTMLInputElement).value; }} />
          <select class="dc-in mono" @change=${(ev: Event) => { c.project = (ev.target as HTMLSelectElement).value; this.bump(); }}>
            <option value="" ?selected=${!c.project}>— node project —</option>
            ${nodes.map((n) => html`<option value=${n.id} ?selected=${c.project === n.id}>${n.name}</option>`)}
            ${c.project && !nodes.some((n) => n.id === c.project) ? html`<option value=${c.project} selected>${c.project}</option>` : ''}
          </select>
          <div class="chips" style="flex-wrap:nowrap;">
            ${(['iNode', 'xNode'] as const).map((opt) => html`
              <button type="button" class="chip ${(c.set ?? 'iNode') === opt ? 'chip-on' : ''}" title=${opt === 'iNode' ? 'Board inside the host (glob slot)' : 'Accessory with its own SKU (explicit node IDs)'}
                @click=${() => { c.set = opt; this.bump(); }}>${(c.set ?? 'iNode') === opt ? '✓ ' : ''}${opt}</button>`)}
          </div>
          <input class="dc-in mono" placeholder=${(c.set ?? 'iNode') === 'xNode' ? 'N-23110-A2-1' : 'A*-1'} .value=${(c.slots ?? []).join(', ')}
            @input=${(ev: Event) => { c.slots = (ev.target as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean); }} />
          <input class="dc-in mono" style="max-width:130px;" placeholder="artifact (opt.)" title="build_pipeline/variant token for multi-variant node projects (e.g. y300-hp). Leave blank for single-artifact projects." .value=${c.artifact ?? ''}
            @input=${(ev: Event) => { const v = (ev.target as HTMLInputElement).value.trim(); c.artifact = v || undefined; }} />
          <button type="button" class="btn sm ghost" @click=${() => { kit.components!.splice(i, 1); this.bump(); }}>✕</button>
        </div>`)}
      <button type="button" class="btn sm" @click=${() => { kit.components = [...(kit.components ?? []), { name: '', project: '', set: 'iNode', slots: [] }]; this.bump(); }}>+ Add component</button>

      <details style="margin-top:18px;">
        <summary class="label-caps" style="cursor:pointer;">Advanced — raw release manifests (${kit.releases.length})</summary>
        <div class="small faint" style="margin:6px 0;">These are managed via Create Release. Edit here only as an escape hatch.</div>
        ${kit.releases.map((r, ri) => this.renderRelease(kit, r, ri))}
        <button type="button" class="btn sm" @click=${() => { kit.releases = [...kit.releases, { version: '', build_targets: ['*'], manifest: { iNodes: {} } }]; this.bump(); }}>+ Add release</button>
      </details>
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
      <div class="dc-row" style="align-items:center;margin-bottom:10px;">
        <span class="small faint">${this.raw ? 'Raw JSON — the full deploy config' : 'Basic editor'}</span>
        <span class="grow"></span>
        <button type="button" class="btn sm ghost" @click=${() => this.toggleRaw()}>${this.raw ? '← Basic editor' : '{ } Edit raw JSON'}</button>
      </div>
      ${this.raw
        ? html`<div class="card"><div class="card-body">
            <textarea class="dc-in mono" style="width:100%;min-height:440px;" .value=${this.rawText}
              @input=${(ev: Event) => { this.rawText = (ev.target as HTMLTextAreaElement).value; }}></textarea>
          </div></div>`
        : html`
          ${this.renderEnvironments()}
          ${this.renderPipelines()}
          ${/* Artifact routing + health check don't apply to kits (they compose component
               artifacts + publish manifests per channel). */ isKit ? nothing : this.renderArtifacts()}
          ${isKit ? html`${this.m.kit ? this.renderKit() : html`<div class="card"><div class="card-body"><button type="button" class="btn sm" @click=${() => { this.m.kit = { host_ids: [], components: [], releases: [] }; this.bump(); }}>+ Add kit config</button></div></div>`}` : nothing}
          ${isKit ? nothing : this.renderHealth()}`}
      <div class="dc-savebar">
        <span class="grow"></span>
        <a class="btn btn-ghost" href=${this.cancelUrl}>Cancel</a>
        <button type="button" class="btn btn-primary" ?disabled=${this.saving} @click=${() => this.save()}>${this.saving ? 'Saving…' : 'Save'}</button>
      </div>`;
  }
}
