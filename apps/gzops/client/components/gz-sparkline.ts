import { css, html, LitElement, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * Example Lit component: a dependency-free SVG sparkline with hover state.
 * This is the template's demonstration of where Lit fits in the default
 * stack — client-side state that HTMX fragments can't express cleanly.
 *
 *   <gz-sparkline points="3,7,4,9" width="220" height="48"></gz-sparkline>
 */
@customElement('gz-sparkline')
export class GzSparkline extends LitElement {
  @property({ type: String }) points = '';
  @property({ type: Number }) width = 200;
  @property({ type: Number }) height = 40;

  @property({ attribute: false }) private hoverIndex: number | null = null;

  static styles = css`
    :host {
      display: inline-block;
    }
    svg {
      overflow: visible;
    }
    .line {
      fill: none;
      stroke: var(--gz-green, #bfd22b);
      stroke-width: 2;
    }
    .dot {
      fill: var(--gz-green, #bfd22b);
    }
    .value {
      fill: rgba(255, 255, 255, 0.92);
      font: 11px monospace;
    }
  `;

  private get values(): number[] {
    return this.points
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => !Number.isNaN(v));
  }

  render() {
    const values = this.values;
    if (values.length < 2) return html`<slot></slot>`;

    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const stepX = this.width / (values.length - 1);
    const coords = values.map((v, i) => ({
      x: i * stepX,
      y: this.height - ((v - min) / range) * this.height,
      v,
    }));
    const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ');
    const hover = this.hoverIndex !== null ? coords[this.hoverIndex] : null;

    return html`
      <svg
        width=${this.width}
        height=${this.height}
        @mousemove=${(e: MouseEvent) => {
          this.hoverIndex = Math.min(values.length - 1, Math.max(0, Math.round(e.offsetX / stepX)));
        }}
        @mouseleave=${() => (this.hoverIndex = null)}
      >
        ${svg`<path class="line" d=${path}></path>`}
        ${hover
          ? svg`
            <circle class="dot" cx=${hover.x} cy=${hover.y} r="3"></circle>
            <text class="value" x=${hover.x} y=${hover.y - 8} text-anchor="middle">${hover.v}</text>
          `
          : null}
      </svg>
    `;
  }
}
