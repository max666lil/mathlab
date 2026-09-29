/**
 * The 2D domain view (xy-plane): heat map, contours, points, vectors, level curves, paths.
 * Framework-free: mount into any element; it subscribes to the workspace and redraws on demand.
 */
import type { Workspace } from '../../runtime/workspace';
import { View2D, niceStep } from './view2d';
import { getDrawer2D, Handle2D } from './registry2d';
import { frameFromItems, SceneFrame } from '../sampling';
import { getTheme, onThemeChange, MATH_FONT, UI_FONT } from '../theme';
import { formatNumber } from '../../math-core/symbolic/print';

export class PlaneView {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  readonly view = new View2D();
  private fitted = false;
  private raf = 0;
  private handles: Handle2D[] = [];
  private cache = new Map<string, unknown>();
  private drag: Handle2D | null = null;
  private pan: { px: number; py: number; cx: number; cy: number } | null = null;
  private hoverHandle: Handle2D | null = null;
  private frame!: SceneFrame;
  private unsubs: (() => void)[] = [];
  private ro: ResizeObserver;
  private lastFrameKey = '';

  constructor(
    private host: HTMLElement,
    private ws: Workspace,
    readonly id = '2d',
  ) {
    this.canvas.className = 'mathlab-canvas';
    host.appendChild(this.canvas);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    for (const t of ['values', 'view', 'selection', 'hover'] as const) this.unsubs.push(ws.on(t, () => this.invalidate()));
    let doc = ws.doc;
    this.unsubs.push(ws.on('doc', () => {
      if (ws.doc !== doc) {
        doc = ws.doc;
        this.fitted = false;
        this.invalidate();
      }
    }));
    this.unsubs.push(onThemeChange(() => this.invalidate()));
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.canvas.addEventListener('pointerleave', this.onLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('dblclick', () => this.resetView());
    this.resize();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.unsubs.forEach((u) => u());
    this.canvas.remove();
  }

  resetView() {
    this.view.fit(this.frame?.xr ?? [-3, 3], this.frame?.yr ?? [-3, 3]);
    this.invalidate();
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.view.width = Math.max(1, r.width);
    this.view.height = Math.max(1, r.height);
    this.canvas.width = Math.round(this.view.width * dpr);
    this.canvas.height = Math.round(this.view.height * dpr);
    this.canvas.style.width = `${this.view.width}px`;
    this.canvas.style.height = `${this.view.height}px`;
    if (this.fitted) this.view.fit(this.frame.xr, this.frame.yr);
    this.fitted = false;
    this.invalidate();
  }

  invalidate() {
    if (!this.raf) this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private draw() {
    const items = this.ws.sceneItems();
    this.frame = frameFromItems(items);
    const fk = `${this.frame.xr}|${this.frame.yr}`;
    if (!this.fitted || fk !== this.lastFrameKey) {
      this.view.fit(this.frame.xr, this.frame.yr);
      this.fitted = true;
      this.lastFrameKey = fk;
    }
    const theme = getTheme();
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, this.view.width, this.view.height);
    this.drawGrid();
    const handles: Handle2D[] = [];
    const ordered = items
      .filter((i) => i.visible)
      .map((item) => ({ item, d: getDrawer2D(item.visual.vtype) }))
      .filter((x) => x.d)
      .sort((a, b) => a.d!.layer - b.d!.layer);
    for (const { item, d } of ordered) {
      ctx.save();
      try {
        d!.draw({ ctx, view: this.view, item, frame: this.frame, theme, ws: this.ws, selected: this.ws.selection === item.nodeId, handles, cache: this.cache });
      } catch (e) {
        console.warn(`2D drawer ${item.visual.vtype} failed`, e);
      }
      ctx.restore();
    }
    this.handles = handles;
    this.drawAxesLabels();
    this.drawHover();
    if (this.cache.size > 64) this.cache.clear();
  }

  private drawGrid() {
    const { ctx, view } = this;
    const theme = getTheme();
    const step = niceStep(40 / view.scale);
    const [x0, x1] = view.xRange;
    const [y0, y1] = view.yRange;
    ctx.lineWidth = 1;
    for (const [strong, s] of [[false, step / 5], [true, step]] as const) {
      ctx.strokeStyle = strong ? theme.gridStrong : theme.grid;
      if (s * view.scale < 8) continue;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) {
        const px = Math.round(view.sx(x)) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, view.height);
      }
      for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) {
        const py = Math.round(view.sy(y)) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(view.width, py);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = theme.axis;
    ctx.beginPath();
    const ax = Math.round(view.sx(0)) + 0.5;
    const ay = Math.round(view.sy(0)) + 0.5;
    ctx.moveTo(ax, 0);
    ctx.lineTo(ax, view.height);
    ctx.moveTo(0, ay);
    ctx.lineTo(view.width, ay);
    ctx.stroke();
  }

  private drawAxesLabels() {
    const { ctx, view } = this;
    const theme = getTheme();
    const step = niceStep(70 / view.scale);
    ctx.font = `11px ${UI_FONT}`;
    ctx.fillStyle = theme.textDim;
    const ay = Math.min(view.height - 14, Math.max(4, view.sy(0) + 4));
    const ax = Math.min(view.width - 30, Math.max(4, view.sx(0) + 4));
    ctx.textBaseline = 'top';
    const [x0, x1] = view.xRange;
    const [y0, y1] = view.yRange;
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) if (Math.abs(x) > 1e-9) ctx.fillText(formatNumber(x, 3), view.sx(x) + 3, ay);
    ctx.textBaseline = 'middle';
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) if (Math.abs(y) > 1e-9) ctx.fillText(formatNumber(y, 3), ax, view.sy(y));
    ctx.font = `italic 15px ${MATH_FONT}`;
    ctx.fillStyle = theme.text;
    ctx.fillText('x', view.width - 16, Math.min(view.height - 12, Math.max(12, view.sy(0) - 12)));
    ctx.fillText('y', Math.min(view.width - 14, Math.max(8, view.sx(0) - 14)), 12);
  }

  /** Linked cursor: own hover shows a readout, hover from other views shows a marker. */
  private drawHover() {
    const h = this.ws.hover;
    if (!h) return;
    const { ctx, view } = this;
    const theme = getTheme();
    const px = view.sx(h.x);
    const py = view.sy(h.y);
    if (h.source !== this.id) {
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - 12, py);
      ctx.lineTo(px - 4, py);
      ctx.moveTo(px + 4, py);
      ctx.lineTo(px + 12, py);
      ctx.moveTo(px, py - 12);
      ctx.lineTo(px, py - 4);
      ctx.moveTo(px, py + 4);
      ctx.lineTo(px, py + 12);
      ctx.stroke();
    }
    if (this.drag || this.pan) return;
    const f = this.frame.surface?.eval as ((x: number, y: number) => number) | undefined;
    const text = `(${formatNumber(h.x, 3)}, ${formatNumber(h.y, 3)})${f ? `   z = ${formatNumber(f(h.x, h.y), 4)}` : ''}`;
    ctx.font = `12px ${UI_FONT}`;
    const w = ctx.measureText(text).width + 12;
    const bx = Math.min(view.width - w - 6, px + 14);
    const by = Math.max(6, py - 30);
    ctx.fillStyle = theme.labelBg;
    ctx.fillRect(bx, by, w, 20);
    ctx.fillStyle = theme.text;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + 6, by + 10);
  }

  // ---------------------------------------------------------------- interaction

  private local(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  }

  private hit(px: number, py: number): Handle2D | null {
    let best: Handle2D | null = null;
    let bd = Infinity;
    for (const h of this.handles) {
      const d = Math.hypot(this.view.sx(h.x) - px, this.view.sy(h.y) - py);
      if (d <= h.r && d < bd) {
        best = h;
        bd = d;
      }
    }
    return best;
  }

  private onDown = (e: PointerEvent) => {
    const [px, py] = this.local(e);
    this.canvas.setPointerCapture(e.pointerId);
    const h = this.hit(px, py);
    if (h) {
      this.drag = h;
      this.ws.select(h.nodeId);
      return;
    }
    this.pan = { px, py, cx: this.view.cx, cy: this.view.cy };
  };

  private onMove = (e: PointerEvent) => {
    const [px, py] = this.local(e);
    const wx = this.view.wx(px);
    const wy = this.view.wy(py);
    if (this.drag) {
      this.drag.drag([wx, wy], { shift: e.shiftKey });
      this.ws.setHover({ x: wx, y: wy, source: this.id });
      return;
    }
    if (this.pan) {
      this.view.cx = this.pan.cx - (px - this.pan.px) / this.view.scale;
      this.view.cy = this.pan.cy + (py - this.pan.py) / this.view.scale;
      this.invalidate();
      return;
    }
    const h = this.hit(px, py);
    if (h !== this.hoverHandle) {
      this.hoverHandle = h;
      this.canvas.style.cursor = h ? (h.cursor ?? 'grab') : 'crosshair';
    }
    this.ws.setHover({ x: wx, y: wy, source: this.id });
  };

  private onUp = (e: PointerEvent) => {
    if (this.drag) {
      this.drag.end?.();
      this.ws.flushRewrites();
    } else if (this.pan) {
      const [px, py] = this.local(e);
      if (Math.hypot(px - this.pan.px, py - this.pan.py) < 3) this.ws.select(null);
    }
    this.drag = null;
    this.pan = null;
  };

  private onLeave = () => {
    if (!this.drag && this.ws.hover?.source === this.id) this.ws.setHover(null);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const [px, py] = this.local(e);
    const wx = this.view.wx(px);
    const wy = this.view.wy(py);
    const k = Math.exp(-e.deltaY * 0.0015);
    this.view.scale = Math.min(1e5, Math.max(2, this.view.scale * k));
    this.view.cx = wx - (px - this.view.width / 2) / this.view.scale;
    this.view.cy = wy + (py - this.view.height / 2) / this.view.scale;
    this.invalidate();
  };
}
