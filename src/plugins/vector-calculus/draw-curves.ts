/** Drawers for curves: the moving point (velocity, acceleration) and the osculating circle; 3-D motion. */
import * as THREE from 'three';
import { registerDrawer2D } from '../../visualization/2d/registry2d';
import { registerVisual3D, Visual3D, Ctx3D, disposeObject, Arrow3D, Label3D } from '../../visualization/3d/registry3d';
import type { SceneItem } from '../../visualization/scene-model';
import type { FunctionValue } from '../../math-core/values';
import { drawArrow, drawLabel } from '../core-calculus/draw-util';
import { withAlpha } from '../../visualization/colormap';
import { polygonOf } from './green';

const V = '#4cc9f0';
const A = '#ff6b6b';
const P = '#ffd166';

interface MotionProps {
  fn: FunctionValue;
  d1: FunctionValue;
  d2: FunctionValue;
  range: [number, number];
  timeline: string;
  n: number;
}

const ev = (f: FunctionValue, t: number) => (f.eval as (t: number) => number[])(t);
const paramAt = (p: MotionProps, cycles: number) => p.range[0] + (cycles - Math.floor(cycles)) * (p.range[1] - p.range[0]);

registerDrawer2D('motion', {
  layer: 7,
  draw(a) {
    const p = a.item.visual.props as unknown as MotionProps;
    if (p.n !== 2) return;
    const t = paramAt(p, a.timeline(p.timeline, 0));
    const r = ev(p.fn, t);
    const v = ev(p.d1, t);
    const w = ev(p.d2, t);
    const { ctx, view, theme } = a;
    const [x, y] = [view.sx(r[0]), view.sy(r[1])];
    drawArrow(ctx, x, y, view.sx(r[0] + v[0]), view.sy(r[1] + v[1]), V, 2.6, 10);
    drawArrow(ctx, x, y, view.sx(r[0] + w[0]), view.sy(r[1] + w[1]), withAlpha(A, 0.9), 2, 9);
    ctx.fillStyle = P;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    drawLabel(ctx, `t = ${t.toFixed(2)}`, x + 10, y - 10, P, theme, 13);
    drawLabel(ctx, "r′", view.sx(r[0] + v[0]) + 6, view.sy(r[1] + v[1]) - 6, V, theme, 13);
    drawLabel(ctx, "r″", view.sx(r[0] + w[0]) + 6, view.sy(r[1] + w[1]) + 12, A, theme, 13);
  },
});

registerDrawer2D('osccircle', {
  layer: 6,
  draw(a) {
    const { center, radius } = a.item.visual.props as { center: number[]; radius: number };
    const { ctx, view } = a;
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = withAlpha(a.item.color, 0.9);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(view.sx(center[0]), view.sy(center[1]), Math.abs(view.sx(center[0] + radius) - view.sx(center[0])), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = a.item.color;
    ctx.beginPath();
    ctx.arc(view.sx(center[0]), view.sy(center[1]), 3, 0, Math.PI * 2);
    ctx.fill();
  },
});

class Motion3D implements Visual3D {
  object = new THREE.Group();
  private dot: THREE.Mesh;
  private v = new Arrow3D(V);
  private w = new Arrow3D(A);
  private label = new Label3D(0.024);
  constructor() {
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: P }));
    this.object.add(this.dot, this.v.group, this.w.group, this.label.sprite);
  }
  update(item: SceneItem, ctx: Ctx3D) {
    const p = item.visual.props as unknown as MotionProps;
    this.object.visible = p.n === 3;
    if (p.n !== 3) return;
    const t = paramAt(p, ctx.timeline(p.timeline, 0));
    const m = ctx.map;
    const r = ev(p.fn, t);
    const v = ev(p.d1, t);
    const w = ev(p.d2, t);
    const R = m.v(r[0], r[1], r[2]);
    this.dot.position.copy(R);
    this.dot.scale.setScalar(m.size * 0.012);
    this.v.set(R, m.v(r[0] + v[0], r[1] + v[1], r[2] + v[2]), m.size * 0.005);
    this.w.set(R, m.v(r[0] + w[0], r[1] + w[1], r[2] + w[2]), m.size * 0.004);
    this.label.set(`t = ${t.toFixed(2)}`, P, false);
    this.label.sprite.position.copy(R).add(new THREE.Vector3(0, 0, m.size * 0.05));
  }
  dispose() {
    this.v.dispose();
    this.w.dispose();
    this.label.dispose();
    disposeObject(this.object);
  }
}
registerVisual3D('motion', () => new Motion3D());

// ---------------------------------------------------------------- line integrals: accumulation along the curve

interface LineProps {
  field: FunctionValue;
  curve: FunctionValue;
  g: FunctionValue;
  range: [number, number];
  kind: 'work' | 'flux' | 'scalar';
  total: number;
  timeline: string;
  n: number;
}

/** Cumulative integral of g over the range (trapezoid on a fine grid) for the running total. */
const cumCache = new Map<string, { ts: number[]; cum: number[] }>();
function cumulative(p: LineProps) {
  const key = `${p.g.key}|${p.range}`;
  let c = cumCache.get(key);
  if (!c) {
    const N = 600;
    const ts: number[] = [];
    const cum: number[] = [0];
    const G = p.g.eval as (t: number) => number;
    for (let i = 0; i <= N; i++) ts.push(p.range[0] + ((p.range[1] - p.range[0]) * i) / N);
    for (let i = 1; i <= N; i++) {
      const a = G(ts[i - 1]);
      const b = G(ts[i]);
      cum.push(cum[i - 1] + (Number.isFinite(a + b) ? ((a + b) / 2) * (ts[i] - ts[i - 1]) : 0));
    }
    // scale to the exact total so the counter ends exactly at the value in the analysis
    const k = Math.abs(cum[N]) > 1e-12 ? p.total / cum[N] : 1;
    c = { ts, cum: cum.map((x) => x * k) };
    if (cumCache.size > 30) cumCache.clear();
    cumCache.set(key, c);
  }
  return c;
}

registerDrawer2D('lineintegral', {
  layer: 7,
  draw(a) {
    const p = a.item.visual.props as unknown as LineProps;
    if (p.n !== 2) return;
    const { ctx, view, theme } = a;
    const C = p.curve.eval as (t: number) => number[];
    const F = p.field.eval as (...x: number[]) => number | number[];
    const [t0, t1] = p.range;
    // field along the curve: arrows coloured by whether they help (F·T > 0) or oppose the motion
    const m = 18;
    for (let k = 0; k < m; k++) {
      const t = t0 + ((t1 - t0) * (k + 0.5)) / m;
      const r = C(t);
      const h = 1e-5 * (t1 - t0);
      const r2 = C(t + h);
      const T = [(r2[0] - r[0]) / h, (r2[1] - r[1]) / h];
      const Tl = Math.hypot(T[0], T[1]) || 1;
      const f = F(r[0], r[1]);
      if (!Array.isArray(f)) continue;
      const along = (f[0] * T[0] + f[1] * T[1]) / Tl;
      const across = (f[0] * T[1] - f[1] * T[0]) / Tl;
      const good = p.kind === 'flux' ? across > 0 : along > 0;
      const s = 0.35 / Math.max(1e-9, Math.hypot(f[0], f[1])) * Math.min(1, Math.hypot(f[0], f[1]));
      drawArrow(ctx, view.sx(r[0]), view.sy(r[1]), view.sx(r[0] + f[0] * s * 1.2), view.sy(r[1] + f[1] * s * 1.2), withAlpha(good ? '#52d69b' : '#ff6b6b', 0.9), 1.8, 7);
    }
    // the particle and the running total
    const { ts, cum } = cumulative(p);
    const u = a.timeline(p.timeline, 0);
    const i = Math.min(ts.length - 1, Math.floor((u - Math.floor(u)) * (ts.length - 1)));
    const r = C(ts[i]);
    ctx.fillStyle = P;
    ctx.beginPath();
    ctx.arc(view.sx(r[0]), view.sy(r[1]), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(P, 0.9);
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    for (let j = 0; j <= i; j += 3) {
      const q = C(ts[j]);
      if (j === 0) ctx.moveTo(view.sx(q[0]), view.sy(q[1]));
      else ctx.lineTo(view.sx(q[0]), view.sy(q[1]));
    }
    ctx.stroke();
    const name = p.kind === 'flux' ? 'flux so far' : p.kind === 'work' ? 'work so far' : '∫ f ds so far';
    drawLabel(ctx, `${name}: ${cum[i].toFixed(3)}  (total ${p.total.toFixed(3)})`, view.sx(r[0]) + 12, view.sy(r[1]) - 12, P, theme, 13);
  },
});

class LineIntegral3D implements Visual3D {
  object = new THREE.Group();
  private dot: THREE.Mesh;
  private label = new Label3D(0.024);
  constructor() {
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: P }));
    this.object.add(this.dot, this.label.sprite);
  }
  update(item: SceneItem, ctx: Ctx3D) {
    const p = item.visual.props as unknown as LineProps;
    this.object.visible = p.n === 3;
    if (p.n !== 3) return;
    const { ts, cum } = cumulative(p);
    const u = ctx.timeline(p.timeline, 0);
    const i = Math.min(ts.length - 1, Math.floor((u - Math.floor(u)) * (ts.length - 1)));
    const r = (p.curve.eval as (t: number) => number[])(ts[i]);
    const m = ctx.map;
    this.dot.position.copy(m.v(r[0], r[1], r[2]));
    this.dot.scale.setScalar(m.size * 0.012);
    this.label.set(`${p.kind === 'work' ? 'work' : '∫'} so far: ${cum[i].toFixed(3)} / ${p.total.toFixed(3)}`, P, false);
    this.label.sprite.position.copy(this.dot.position).add(new THREE.Vector3(0, 0, m.size * 0.06));
  }
  dispose() {
    this.label.dispose();
    disposeObject(this.object);
  }
}
registerVisual3D('lineintegral', () => new LineIntegral3D());

// ---------------------------------------------------------------- Green's theorem: cells whose interior edges cancel

const polyCache = new Map<string, number[][]>();
function polygon(C: FunctionValue): number[][] {
  let P = polyCache.get(C.key);
  if (!P) {
    P = polygonOf(C, 900);
    if (polyCache.size > 20) polyCache.clear();
    polyCache.set(C.key, P);
  }
  return P;
}
function insidePoly(P: number[][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i];
    const [xj, yj] = P[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

registerDrawer2D('greencells', {
  layer: 2,
  draw(a) {
    const { curl, curve, timeline, stops, total, orient } = a.item.visual.props as { curl: FunctionValue; curve: FunctionValue; timeline: string; stops: string[]; total: number; orient: number };
    const { ctx, view, theme } = a;
    const P = polygon(curve);
    const xs = P.map((p) => p[0]);
    const ys = P.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const side = Math.max(x1 - x0, y1 - y0) * 1.02;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const level = Math.max(0, Math.min(stops.length - 1, Math.round(a.timeline(timeline, stops.length - 1))));
    const N = 2 ** level;
    const h = side / N;
    const bx = cx - side / 2, by = cy - side / 2;
    const cf = curl.eval as (x: number, y: number) => number;
    const inside: boolean[] = [];
    let maxC = 1e-12;
    const vals: number[] = [];
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const mx = bx + (i + 0.5) * h, my = by + (j + 0.5) * h;
        const ins = insidePoly(P, mx, my);
        inside.push(ins);
        const c = ins ? cf(mx, my) : 0;
        vals.push(c);
        if (ins && Number.isFinite(c)) maxC = Math.max(maxC, Math.abs(c));
      }
    let sum = 0;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        if (!inside[k]) continue;
        const c = vals[k];
        if (Number.isFinite(c)) sum += c * h * h;
        const X = view.sx(bx + i * h), Y = view.sy(by + (j + 1) * h);
        const W = view.sx(bx + (i + 1) * h) - X, H = view.sy(by + j * h) - Y;
        ctx.fillStyle = withAlpha(c >= 0 ? '#52d69b' : '#ff6b6b', 0.12 + 0.35 * Math.min(1, Math.abs(c) / maxC));
        ctx.fillRect(X, Y, W, H);
        // each cell's own circulation (counter-clockwise when curl > 0); drawn while cells are big enough to read
        if (N <= 8 && Math.abs(c) > 1e-9) {
          const r = Math.min(W, H) * 0.28;
          const mx = X + W / 2, my = Y + H / 2;
          ctx.strokeStyle = withAlpha(c >= 0 ? '#52d69b' : '#ff6b6b', 0.95);
          ctx.lineWidth = 1.6;
          // canvas angles grow clockwise on screen, so a counter-clockwise turn decreases the angle
          const dir = c > 0 ? -1 : 1;
          ctx.beginPath();
          for (let s = 0; s <= 24; s++) {
            const ang = dir * (0.3 + (s / 24) * 1.4 * Math.PI);
            const px = mx + r * Math.cos(ang), py = my + r * Math.sin(ang);
            if (s === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
          const endA = dir * (0.3 + 1.4 * Math.PI);
          ctx.beginPath();
          ctx.arc(mx + r * Math.cos(endA), my + r * Math.sin(endA), 2.4, 0, Math.PI * 2);
          ctx.fillStyle = ctx.strokeStyle as string;
          ctx.fill();
        }
      }
    // edges: shared (interior) edges cancel — faint; edges on the outside of the cell union — bright
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        if (!inside[k]) continue;
        const edges: [number, number, number, number, boolean][] = [
          [i, j, i + 1, j, j === 0 || !inside[k - N]],
          [i, j + 1, i + 1, j + 1, j === N - 1 || !inside[k + N]],
          [i, j, i, j + 1, i === 0 || !inside[k - 1]],
          [i + 1, j, i + 1, j + 1, i === N - 1 || !inside[k + 1]],
        ];
        for (const [ia, ja, ib, jb, outer] of edges) {
          ctx.strokeStyle = outer ? withAlpha('#ffd166', 0.9) : withAlpha(theme.name === 'dark' ? '#ffffff' : '#1b1e28', 0.12);
          ctx.lineWidth = outer ? 1.6 : 1;
          ctx.setLineDash(outer ? [] : [3, 3]);
          ctx.beginPath();
          ctx.moveTo(view.sx(bx + ia * h), view.sy(by + ja * h));
          ctx.lineTo(view.sx(bx + ib * h), view.sy(by + jb * h));
          ctx.stroke();
        }
      }
    ctx.setLineDash([]);
    const txt = `${N}×${N} cells: Σ (curl F)·ΔA = ${(orient * sum).toFixed(3)}   →   ∮ F·dr = ${total.toFixed(3)}`;
    drawLabel(ctx, txt, view.sx(bx), view.sy(by + side) - 10, theme.name === 'dark' ? '#e6e8ef' : '#1b1e28', theme, 13);
  },
});
