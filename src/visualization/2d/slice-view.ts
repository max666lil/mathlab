/**
 * Cross-section view: graph of t ↦ f(origin + t·dir) for one slice item, with the marked point
 * and its tangent line whose slope is the partial / directional derivative. Dragging the marker
 * moves the underlying point along the slice line.
 */
import type { Workspace } from '../../runtime/workspace';
import type { SliceValue } from '../../math-core/values';
import { frameFromItems, lineBoxInterval, sliceSamples } from '../sampling';
import { getTheme, onThemeChange, MATH_FONT, UI_FONT } from '../theme';
import { niceStep } from './view2d';
import { formatNumber } from '../../math-core/symbolic/print';
import { withAlpha } from '../colormap';

export class SliceView {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private w = 1;
  private h = 1;
  private raf = 0;
  private unsubs: (() => void)[] = [];
  private ro: ResizeObserver;
  private map = { t0: -3, t1: 3, z0: -1, z1: 1, s0: 0 };
  private dragging = false;
  private markerPx: [number, number] | null = null;

  constructor(
    private host: HTMLElement,
    private ws: Workspace,
    private itemId: string,
    readonly id = `slice:${itemId}`,
  ) {
    this.canvas.className = 'mathlab-canvas';
    host.appendChild(this.canvas);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    for (const t of ['values', 'view', 'hover', 'selection'] as const) this.unsubs.push(ws.on(t, () => this.invalidate()));
    this.unsubs.push(onThemeChange(() => this.invalidate()));
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointerleave', () => !this.dragging && this.ws.hover?.source === this.id && this.ws.setHover(null));
    this.resize();
  }

  setItem(itemId: string) {
    this.itemId = itemId;
    this.invalidate();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.unsubs.forEach((u) => u());
    this.canvas.remove();
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.invalidate();
  }

  invalidate() {
    if (!this.raf) this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private slice(): { s: SliceValue; color: string } | null {
    const it = this.ws.sceneItems().find((i) => i.id === this.itemId);
    if (!it || it.visual.vtype !== 'slice') return null;
    return { s: it.visual.props.slice as SliceValue, color: it.color };
  }

  private px(t: number) {
    const pad = 36;
    return pad + ((t - this.map.t0) / (this.map.t1 - this.map.t0)) * (this.w - pad - 12);
  }
  private py(z: number) {
    const top = 26;
    const bottom = 22;
    return top + (1 - (z - this.map.z0) / (this.map.z1 - this.map.z0)) * (this.h - top - bottom);
  }
  private tAt(px: number) {
    const pad = 36;
    return this.map.t0 + ((px - pad) / (this.w - pad - 12)) * (this.map.t1 - this.map.t0);
  }

  private draw() {
    const theme = getTheme();
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    const sl = this.slice();
    if (!sl) return;
    const { s, color } = sl;
    const frame = frameFromItems(this.ws.sceneItems(), this.ws.focus ? this.ws.value(this.ws.focus) : undefined);
    const iv = lineBoxInterval(s.origin, s.dir, frame.xr, frame.yr) ?? [-3, 3];
    const { t, z } = sliceSamples(s.fn, s.origin, s.dir, iv[0], iv[1], 240);
    let zmin = Infinity;
    let zmax = -Infinity;
    z.forEach((v) => {
      if (Number.isFinite(v)) {
        zmin = Math.min(zmin, v);
        zmax = Math.max(zmax, v);
      }
    });
    if (!Number.isFinite(zmin)) return;
    zmin = Math.max(zmin, frame.zLo - 0.25 * (frame.zHi - frame.zLo));
    zmax = Math.min(zmax, frame.zHi + 0.25 * (frame.zHi - frame.zLo));
    const padZ = (zmax - zmin || 1) * 0.12;
    const s0 = s.axis !== undefined ? s.origin[s.axis] : 0;
    this.map = { t0: iv[0], t1: iv[1], z0: zmin - padZ, z1: zmax + padZ, s0 };
    this.drawAxes(theme, s);
    // curve
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    let pen = false;
    for (let k = 0; k < t.length; k++) {
      if (!Number.isFinite(z[k])) {
        pen = false;
        continue;
      }
      const X = this.px(t[k]);
      const Y = this.py(z[k]);
      if (pen) ctx.lineTo(X, Y);
      else ctx.moveTo(X, Y);
      pen = true;
    }
    ctx.stroke();
    this.drawHover(theme, s);
    // marker and tangent
    this.markerPx = null;
    if (s.marker !== undefined) {
      const f = s.fn.eval as (...a: number[]) => number;
      const at = (tt: number) => f(...s.origin.map((o, i) => o + tt * s.dir[i]));
      const t0 = s.marker;
      const z0 = at(t0);
      const hh = 1e-4;
      const slope = (at(t0 + hh) - at(t0 - hh)) / (2 * hh);
      const span = (this.map.t1 - this.map.t0) * 0.22;
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(this.px(t0 - span), this.py(z0 - slope * span));
      ctx.lineTo(this.px(t0 + span), this.py(z0 + slope * span));
      ctx.stroke();
      ctx.setLineDash([]);
      const X = this.px(t0);
      const Y = this.py(z0);
      this.markerPx = [X, Y];
      ctx.fillStyle = '#ffd166';
      ctx.strokeStyle = theme.bg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X, Y, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      const name = s.axis === 0 ? '∂f/∂x' : s.axis === 1 ? '∂f/∂y' : 'D_û f';
      ctx.font = `12px ${UI_FONT}`;
      ctx.fillStyle = theme.text;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(`slope = ${name} = ${formatNumber(slope, 4)}`, this.w - 10, 6);
    }
    ctx.font = `italic 13px ${MATH_FONT}`;
    ctx.fillStyle = withAlpha(color, 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(sliceTitle(s), 10, 6);
  }

  private drawAxes(theme: ReturnType<typeof getTheme>, s: SliceValue) {
    const ctx = this.ctx;
    const { t0, t1, z0, z1, s0 } = this.map;
    ctx.lineWidth = 1;
    ctx.font = `10px ${UI_FONT}`;
    ctx.fillStyle = theme.textDim;
    const tStep = niceStep(((t1 - t0) * 60) / this.w);
    ctx.strokeStyle = theme.grid;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let v = Math.ceil((t0 + s0) / tStep) * tStep; v <= t1 + s0; v += tStep) {
      const X = this.px(v - s0);
      ctx.beginPath();
      ctx.moveTo(X, 20);
      ctx.lineTo(X, this.h - 20);
      ctx.stroke();
      ctx.fillText(formatNumber(v, 3), X, this.h - 16);
    }
    const zStep = niceStep(((z1 - z0) * 28) / this.h);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = Math.ceil(z0 / zStep) * zStep; v <= z1; v += zStep) {
      const Y = this.py(v);
      ctx.beginPath();
      ctx.moveTo(36, Y);
      ctx.lineTo(this.w - 12, Y);
      ctx.stroke();
      ctx.fillText(formatNumber(v, 3), 32, Y);
    }
    ctx.fillStyle = theme.textDim;
    ctx.font = `italic 12px ${MATH_FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(s.axis === 0 ? 'x' : s.axis === 1 ? 'y' : 't', this.w - 8, this.h - 30);
  }

  private drawHover(theme: ReturnType<typeof getTheme>, s: SliceValue) {
    const h = this.ws.hover;
    if (!h) return;
    const d = [h.x - s.origin[0], h.y - s.origin[1]];
    const tt = d[0] * s.dir[0] + d[1] * s.dir[1];
    const off = Math.abs(d[0] * s.dir[1] - d[1] * s.dir[0]);
    if (h.source !== this.id && off > 0.15) return;
    const X = this.px(tt);
    this.ctx.strokeStyle = theme.axis;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(X, 20);
    this.ctx.lineTo(X, this.h - 20);
    this.ctx.stroke();
  }

  private onDown = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const [X, Y] = [e.clientX - r.left, e.clientY - r.top];
    const sl = this.slice();
    if (this.markerPx && sl?.s.markerId && this.ws.statement(sl.s.markerId)?.input && Math.hypot(X - this.markerPx[0], Y - this.markerPx[1]) < 14) {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.ws.select(sl.s.markerId);
    }
  };

  private onMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const X = e.clientX - r.left;
    const sl = this.slice();
    if (!sl) return;
    const tt = this.tAt(X);
    const p = sl.s.origin.map((o, i) => o + tt * sl.s.dir[i]);
    if (this.dragging && sl.s.markerId) {
      this.ws.setPoint(sl.s.markerId, p);
      return;
    }
    this.canvas.style.cursor = this.markerPx && Math.hypot(X - this.markerPx[0], e.clientY - r.top - this.markerPx[1]) < 14 ? 'ew-resize' : 'crosshair';
    this.ws.setHover({ x: p[0], y: p[1], source: this.id });
  };

  private onUp = () => {
    if (this.dragging) this.ws.flushRewrites();
    this.dragging = false;
  };
}

export function sliceTitle(s: SliceValue): string {
  return s.label
    .replace(/\\hat\{u\}/g, 'û')
    .replace(/\\,/g, ' ')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '');
}