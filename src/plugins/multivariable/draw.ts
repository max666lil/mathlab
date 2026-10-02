/** Renderers of Phase 3b: solids, Riemann boxes / cells, the strip sweep and the polar grid. */
import * as THREE from 'three';
import { registerDrawer2D } from '../../visualization/2d/registry2d';
import { registerVisual3D, Visual3D, Ctx3D, disposeObject, setOpacity, FatSegments } from '../../visualization/3d/registry3d';
import type { SceneItem } from '../../visualization/scene-model';
import type { FunctionValue } from '../../math-core/values';
import { registerFrameHint, sampleGrid, cachedLevelSet } from '../../visualization/sampling';
import { withAlpha, colormap } from '../../visualization/colormap';
import { isosurfaceCached } from '../../visualization/marching';
import { compileScalar } from '../../math-core/compile';
import { parseExpression } from '../../parser/parser';
import { drawLabel, drawArrow } from '../core-calculus/draw-util';
import type { StripData } from './visuals';

type G2 = (x: number, y: number) => number;
type G3 = (x: number, y: number, z: number) => number;
type Box = [number, number][];

const extent = (box: Box | undefined) => (box ? Math.max(...box.flat().map(Math.abs)) : 0);
registerFrameHint('solid', (p) => ({ r: Math.min(60, Math.max(1.5, Math.ceil(extent(p.box as Box) * 1.25 * 2) / 2)), dim: 3 }));
registerFrameHint('region', (p) => (p.box ? { r: Math.min(60, Math.max(1.5, Math.ceil(extent(p.box as Box) * 1.25 * 2) / 2)), dim: 2, box: p.box as Box } : undefined));

// ------------------------------------------------------------------ 3-D solid

class Solid3D implements Visual3D {
  object = new THREE.Group();
  private mesh: THREE.Mesh;
  private edges: FatSegments | null = null;
  private key = '';
  constructor() {
    const mat = new THREE.MeshStandardMaterial({ color: '#5b8cff', side: THREE.FrontSide, roughness: 0.6, metalness: 0.05, transparent: true, opacity: 0.6 });
    setOpacity(mat, 0.6);
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.object.add(this.mesh);
  }
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const { test, box } = item.visual.props as { test: FunctionValue; box: Box };
    const key = `${test.key}|${ctx.map.key()}|${item.color}|${selected}`;
    if (key === this.key) return;
    this.key = key;
    const G = test.eval as G3;
    // pad the box so faces on its boundary close
    const pb: Box = box.map(([l, h]) => {
      const d = (h - l) * 0.04 + 1e-3;
      return [l - d, h + d] as [number, number];
    });
    const iso = isosurfaceCached(`solid|${test.key}`, G, pb, 44);
    const m = ctx.map;
    const pos = new Float32Array(iso.positions.length);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.length; i += 3) {
      m.v(iso.positions[i], iso.positions[i + 1], iso.positions[i + 2], v);
      pos[i] = v.x;
      pos[i + 1] = v.y;
      pos[i + 2] = v.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(iso.normals, 3));
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    mat.color.set(item.color);
    setOpacity(mat, selected ? 0.75 : 0.6);
    mat.clippingPlanes = ctx.clip;
    // its shadow on the floor (the region the outer integrals run over): min over z of G ≤ 0
    const [[x0, x1], [y0, y1], [z0, z1]] = pb;
    const shadow = (x: number, y: number) => {
      let best = Infinity;
      for (let k = 0; k <= 40; k++) best = Math.min(best, G(x, y, z0 + ((z1 - z0) * k) / 40));
      return best;
    };
    const sfn = { kind: 'function', params: ['x', 'y'], eval: shadow, out: 'scalar', key: `shadow|${test.key}`, env: {} } as unknown as FunctionValue;
    const segs = cachedLevelSet(sampleGrid(sfn, [x0, x1], [y0, y1], 90), 0);
    const fz = m.floorZ + m.eps * 2;
    const seg: number[] = [];
    for (let k = 0; k + 3 < segs.length; k += 4) seg.push(segs[k], segs[k + 1], fz, segs[k + 2], segs[k + 3], fz);
    if (this.edges) this.object.remove(this.edges.lines);
    this.edges = new FatSegments(ctx.lineMaterial(item.color, 1.6, { opacity: 0.8 }));
    this.edges.set(seg);
    this.object.add(this.edges.lines);
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('solid', () => new Solid3D());

// ------------------------------------------------------------------ Riemann sums

interface RiemannProps {
  fn: FunctionValue;
  test: FunctionValue;
  box: Box;
  ns: number[];
  timeline: string;
}

function riemannCells(p: RiemannProps, level: number) {
  const n = p.ns[Math.max(0, Math.min(p.ns.length - 1, level))];
  const [[x0, x1], [y0, y1]] = p.box;
  const hx = (x1 - x0) / n, hy = (y1 - y0) / n;
  const G = p.test.eval as G2;
  const f = p.fn.eval as G2;
  const cells: { x: number; y: number; hx: number; hy: number; v: number }[] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const cx = x0 + (i + 0.5) * hx, cy = y0 + (j + 0.5) * hy;
      if (G(cx, cy) > 0) continue;
      const v = f(cx, cy);
      cells.push({ x: x0 + i * hx, y: y0 + j * hy, hx, hy, v: Number.isFinite(v) ? v : 0 });
    }
  return cells;
}

registerDrawer2D('riemann', {
  layer: 1,
  draw(a) {
    const p = a.item.visual.props as unknown as RiemannProps;
    const level = Math.round(a.timeline(p.timeline, p.ns.length - 1));
    const cells = riemannCells(p, level);
    const { ctx, view } = a;
    const maxV = Math.max(1e-12, ...cells.map((c) => Math.abs(c.v)));
    for (const c of cells) {
      const X = view.sx(c.x), Y = view.sy(c.y + c.hy);
      const W = view.sx(c.x + c.hx) - X, H = view.sy(c.y) - Y;
      ctx.fillStyle = withAlpha(c.v >= 0 ? a.item.color : '#ff6b6b', 0.12 + (0.4 * Math.abs(c.v)) / maxV);
      ctx.fillRect(X, Y, W, H);
      ctx.strokeStyle = withAlpha(a.item.color, 0.55);
      ctx.lineWidth = 1;
      ctx.strokeRect(X, Y, W, H);
    }
  },
});

class Riemann3D implements Visual3D {
  object = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private key = '';
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const p = item.visual.props as unknown as RiemannProps;
    const level = Math.round(ctx.timeline(p.timeline, p.ns.length - 1));
    const key = `${p.fn.key}|${p.test.key}|${level}|${ctx.map.key()}|${selected}`;
    if (key === this.key) return;
    this.key = key;
    const cells = riemannCells(p, level);
    if (this.mesh) {
      this.object.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
    }
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0.05, transparent: true, opacity: 0.8 });
    setOpacity(mat, selected ? 0.92 : 0.8);
    mat.clippingPlanes = ctx.clip;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, Math.max(1, cells.length));
    const m = ctx.map;
    const M = new THREE.Matrix4();
    const base = m.z(0);
    const col = new THREE.Color();
    cells.forEach((c, i) => {
      const top = m.z(c.v);
      const h = Math.max(1e-6, Math.abs(top - base));
      M.makeScale(c.hx * 0.96, c.hy * 0.96, h);
      M.setPosition(c.x + c.hx / 2, c.y + c.hy / 2, (top + base) / 2);
      mesh.setMatrixAt(i, M);
      mesh.setColorAt(i, col.set(c.v >= 0 ? item.color : '#ff6b6b'));
    });
    mesh.count = cells.length;
    this.mesh = mesh;
    this.object.add(mesh);
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('riemann', () => new Riemann3D());

// ------------------------------------------------------------------ strip sweep

const compiled = new Map<string, (t: number) => number>();
function fn1(src: string, v: string): (t: number) => number {
  const k = `${v}|${src}`;
  let f = compiled.get(k);
  if (!f) {
    try {
      f = compileScalar(parseExpression(src), [v]) as (t: number) => number;
    } catch {
      f = () => NaN;
    }
    compiled.set(k, f);
  }
  return f;
}

const pretty = (s: string) => s.replace(/\*/g, '').replace(/sqrt/g, '√').replace(/\^2/g, '²').replace(/\^3/g, '³');

registerDrawer2D('strips', {
  layer: 4,
  draw(a) {
    const { data, timeline } = a.item.visual.props as { data: StripData; timeline: string };
    const { ctx, view, theme } = a;
    const [outer, inner] = data.order;
    const polar = data.system === 'polar';
    // point in the plane from (outer value, inner value)
    const P = (o: number, i: number): [number, number] => {
      if (!polar) return outer === 'x' ? [o, i] : [i, o];
      const [r, t] = outer === 'r' ? [o, i] : [i, o];
      return [r * Math.cos(t), r * Math.sin(t)];
    };
    const S = (q: [number, number]): [number, number] => [view.sx(q[0]), view.sy(q[1])];
    const total = data.pieces.reduce((s, p) => s + (p.b - p.a), 0);
    const u = (((a.timeline(timeline, 0) * 0.18) % 1) + 1) % 1;
    // boundary curves of each piece: inner low and inner high
    ctx.lineWidth = 2.2;
    for (const [k, p] of data.pieces.entries()) {
      const lo = fn1(p.lo, outer), hi = fn1(p.hi, outer);
      for (const [g, col] of [[lo, '#4cc9f0'], [hi, '#f4a261']] as const) {
        ctx.strokeStyle = col;
        ctx.beginPath();
        for (let s = 0; s <= 120; s++) {
          const o = p.a + ((p.b - p.a) * s) / 120;
          const [X, Y] = S(P(o, g(o)));
          if (s === 0) ctx.moveTo(X, Y);
          else ctx.lineTo(X, Y);
        }
        ctx.stroke();
      }
      const om = (p.a + p.b) / 2;
      const [lx, ly] = S(P(om, lo(om)));
      const [hx, hy] = S(P(om, hi(om)));
      drawLabel(ctx, `${inner} = ${pretty(p.loTex)}`, lx + 6, ly + 14, '#4cc9f0', theme, 13);
      drawLabel(ctx, `${inner} = ${pretty(p.hiTex)}`, hx + 6, hy - 14, '#f4a261', theme, 13);
      if (k === 0 || data.pieces[k - 1].b !== p.a) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = withAlpha(theme.text, 0.5);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        const [X0, Y0] = S(P(p.a, lo(p.a)));
        const [X1, Y1] = S(P(p.a, hi(p.a)));
        ctx.moveTo(X0, Y0);
        ctx.lineTo(X1, Y1);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 2.2;
      }
    }
    // the moving strip
    let pos = u * total;
    const piece =
      data.pieces.find((p) => {
        if (pos <= p.b - p.a) return true;
        pos -= p.b - p.a;
        return false;
      }) ?? data.pieces[data.pieces.length - 1];
    const o = piece.a + Math.min(pos, piece.b - piece.a);
    const w = total / 36;
    const lo = fn1(piece.lo, outer), hi = fn1(piece.hi, outer);
    ctx.fillStyle = withAlpha(a.item.color, 0.55);
    ctx.beginPath();
    const o0 = Math.max(piece.a, o - w / 2), o1 = Math.min(piece.b, o + w / 2);
    for (let s = 0; s <= 12; s++) {
      const oo = o0 + ((o1 - o0) * s) / 12;
      const q = S(P(oo, lo(oo)));
      if (s === 0) ctx.moveTo(q[0], q[1]);
      else ctx.lineTo(q[0], q[1]);
    }
    for (let s = 12; s >= 0; s--) {
      const oo = o0 + ((o1 - o0) * s) / 12;
      const q = S(P(oo, hi(oo)));
      ctx.lineTo(q[0], q[1]);
    }
    ctx.closePath();
    ctx.fill();
    const [tx, ty] = S(P(o, hi(o)));
    drawLabel(ctx, `${outer} = ${+o.toFixed(2)}:  ${pretty(piece.loTex)} ≤ ${inner} ≤ ${pretty(piece.hiTex)}`, tx + 8, ty - 30, theme.text, theme, 13);
  },
});

// ------------------------------------------------------------------ polar grid

registerDrawer2D('polargrid', {
  layer: 2,
  draw(a) {
    const { test, box } = a.item.visual.props as { test: FunctionValue; box: Box };
    const { ctx, view, theme } = a;
    const G = test.eval as G2;
    const R = Math.max(...box.flat().map(Math.abs)) * 1.05;
    const dr = niceStep(R / 6);
    const dt = Math.PI / 12;
    ctx.strokeStyle = withAlpha(a.item.color, 0.7);
    ctx.lineWidth = 1.1;
    const seg = (pts: [number, number][]) => {
      let pen = false;
      ctx.beginPath();
      for (const [x, y] of pts) {
        if (G(x, y) > 1e-9) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(view.sx(x), view.sy(y));
        else ctx.moveTo(view.sx(x), view.sy(y));
        pen = true;
      }
      ctx.stroke();
    };
    for (let r = dr; r <= R; r += dr) seg(Array.from({ length: 241 }, (_, i) => [r * Math.cos((i / 240) * 2 * Math.PI), r * Math.sin((i / 240) * 2 * Math.PI)] as [number, number]));
    for (let t = 0; t < 2 * Math.PI - 1e-9; t += dt) seg(Array.from({ length: 121 }, (_, i) => [(i / 120) * R * Math.cos(t), (i / 120) * R * Math.sin(t)] as [number, number]));
    // one highlighted cell: ΔA ≈ r Δr Δθ
    let best: [number, number] | null = null;
    for (let r = dr; r < R && !best; r += dr)
      for (let t = dt; t < 2 * Math.PI; t += dt) {
        const rMid = r + dr / 2, tMid = t + dt / 2;
        if (G(rMid * Math.cos(tMid), rMid * Math.sin(tMid)) <= 0 && r > R / 3) {
          best = [r, t];
          break;
        }
      }
    if (best) {
      const [r, t] = best;
      ctx.fillStyle = withAlpha('#ffd166', 0.55);
      ctx.beginPath();
      for (let i = 0; i <= 16; i++) ctx.lineTo(view.sx(r * Math.cos(t + (dt * i) / 16)), view.sy(r * Math.sin(t + (dt * i) / 16)));
      for (let i = 16; i >= 0; i--) ctx.lineTo(view.sx((r + dr) * Math.cos(t + (dt * i) / 16)), view.sy((r + dr) * Math.sin(t + (dt * i) / 16)));
      ctx.closePath();
      ctx.fill();
      const tMid = t + dt / 2;
      drawLabel(ctx, 'ΔA ≈ r Δr Δθ', view.sx((r + dr) * Math.cos(tMid)) + 8, view.sy((r + dr) * Math.sin(tMid)) - 8, '#ffd166', theme, 13);
    }
  },
});

function niceStep(x: number): number {
  const p = 10 ** Math.floor(Math.log10(x));
  const q = x / p;
  return (q < 1.5 ? 1 : q < 3.5 ? 2 : q < 7.5 ? 5 : 10) * p;
}

// ------------------------------------------------------------------ coordinate map grid

type Map2 = (u: number, v: number) => number[];

function mapBox(fn: FunctionValue, ranges: Box): Box {
  const T = fn.eval as Map2;
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  const [[u0, u1], [v0, v1]] = ranges;
  for (let i = 0; i <= 24; i++)
    for (let j = 0; j <= 24; j++) {
      const u = u0 + ((u1 - u0) * i) / 24, v = v0 + ((v1 - v0) * j) / 24;
      for (const p of [T(u, v)]) {
        if (!p.every(Number.isFinite)) continue;
        x0 = Math.min(x0, p[0]);
        x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]);
        y1 = Math.max(y1, p[1]);
      }
    }
  return [[x0, x1], [y0, y1]];
}
registerFrameHint('coordmap', (p) => {
  const b = mapBox(p.fn as FunctionValue, p.ranges as Box);
  return { r: Math.max(1.5, extent(b)), dim: 2, box: b };
});

registerDrawer2D('coordmap', {
  layer: 2,
  draw(a) {
    const { fn, ranges, timeline } = a.item.visual.props as { fn: FunctionValue; ranges: Box; timeline: string };
    const { ctx, view, theme } = a;
    const s = Math.max(0, Math.min(1, a.timeline(timeline, 1)));
    const T = fn.eval as Map2;
    const [[u0, u1], [v0, v1]] = ranges;
    // the straight (u, v) grid starts stretched over the image's box, so the frame fits the image
    const bkey = `mapbox|${fn.key}|${ranges}`;
    let box = a.cache.get(bkey) as Box | undefined;
    if (!box) a.cache.set(bkey, (box = mapBox(fn, ranges)));
    const [[bx0, bx1], [by0, by1]] = box;
    const P = (u: number, v: number): [number, number] => {
      const q = T(u, v);
      const pu = bx0 + ((u - u0) / (u1 - u0)) * (bx1 - bx0), pv = by0 + ((v - v0) / (v1 - v0)) * (by1 - by0);
      return [(1 - s) * pu + s * q[0], (1 - s) * pv + s * q[1]];
    };
    const N = 12;
    const line = (pts: [number, number][], color: string, w: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      let pen = false;
      for (const [x, y] of pts) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(view.sx(x), view.sy(y));
        else ctx.moveTo(view.sx(x), view.sy(y));
        pen = true;
      }
      ctx.stroke();
    };
    const [c1, c2] = ['#4cc9f0', '#f4a261'];
    for (let i = 0; i <= N; i++) {
      const u = u0 + ((u1 - u0) * i) / N;
      line(Array.from({ length: 81 }, (_, k) => P(u, v0 + ((v1 - v0) * k) / 80)), withAlpha(c1, 0.8), i === 0 || i === N ? 1.8 : 1.1);
      const v = v0 + ((v1 - v0) * i) / N;
      line(Array.from({ length: 81 }, (_, k) => P(u0 + ((u1 - u0) * k) / 80, v)), withAlpha(c2, 0.8), i === 0 || i === N ? 1.8 : 1.1);
    }
    // one cell (2 × 2 grid steps, so it is easy to see) and its image: area ≈ |det J| Δu Δv
    const du = (2 * (u1 - u0)) / N, dv = (2 * (v1 - v0)) / N;
    const ua = u0 + (du / 2) * Math.round(N * 0.66), va = v0 + (dv / 2) * Math.round(N * 0.08);
    const cell: [number, number][] = [];
    for (let k = 0; k <= 8; k++) cell.push(P(ua + (du * k) / 8, va));
    for (let k = 0; k <= 8; k++) cell.push(P(ua + du, va + (dv * k) / 8));
    for (let k = 8; k >= 0; k--) cell.push(P(ua + (du * k) / 8, va + dv));
    for (let k = 8; k >= 0; k--) cell.push(P(ua, va + (dv * k) / 8));
    ctx.fillStyle = withAlpha('#ffd166', 0.6);
    ctx.beginPath();
    cell.forEach(([x, y], k) => (k ? ctx.lineTo(view.sx(x), view.sy(y)) : ctx.moveTo(view.sx(x), view.sy(y))));
    ctx.closePath();
    ctx.fill();
    // |det J| at the cell by central differences
    const h = 1e-5;
    const Tu = [(T(ua + h, va)[0] - T(ua - h, va)[0]) / (2 * h), (T(ua + h, va)[1] - T(ua - h, va)[1]) / (2 * h)];
    const Tv = [(T(ua, va + h)[0] - T(ua, va - h)[0]) / (2 * h), (T(ua, va + h)[1] - T(ua, va - h)[1]) / (2 * h)];
    const det = Math.abs(Tu[0] * Tv[1] - Tu[1] * Tv[0]);
    const scale = (1 - s) + s * det;
    const [lx, ly] = P(ua + du, va + dv);
    const [pu, pv] = fn.params;
    const detText = (a.item.visual.props.detText as string | undefined) ?? '';
    // the linear picture: J's columns ∂T/∂u Δu and ∂T/∂v Δv span a parallelogram of area |det J| Δu Δv
    if (s > 0.98) {
      const [bx, by] = P(ua, va);
      const A = [bx + Tu[0] * du, by + Tu[1] * du];
      const B = [bx + Tv[0] * dv, by + Tv[1] * dv];
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = withAlpha(theme.text, 0.85);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(view.sx(A[0]), view.sy(A[1]));
      ctx.lineTo(view.sx(A[0] + B[0] - bx), view.sy(A[1] + B[1] - by));
      ctx.lineTo(view.sx(B[0]), view.sy(B[1]));
      ctx.stroke();
      ctx.restore();
      drawArrow(ctx, view.sx(bx), view.sy(by), view.sx(A[0]), view.sy(A[1]), c1, 2.4, 9);
      drawArrow(ctx, view.sx(bx), view.sy(by), view.sx(B[0]), view.sy(B[1]), c2, 2.4, 9);
      drawLabel(ctx, `∂T/∂${pu}·Δ${pu}`, view.sx(A[0]) + 6, view.sy(A[1]) + 12, c1, theme, 12);
      drawLabel(ctx, `∂T/∂${pv}·Δ${pv}`, view.sx(B[0]) + 6, view.sy(B[1]) - 10, c2, theme, 12);
    }
    const exact = s > 0.98 && detText ? ` = ${detText.replace(/\^2/g, '²').replace(/\*/g, '·')} Δ${pu} Δ${pv}` : '';
    void lx;
    void ly;
    drawLabel(ctx, `yellow cell: area ≈ |det J| Δ${pu} Δ${pv}${exact}`, 14, 22, '#ffd166', theme, 13);
    drawLabel(ctx, `here |det J| = ${+scale.toFixed(3)}; the dashed parallelogram of J's columns has this area`, 14, 41, theme.textDim, theme, 12);
  },
});

// ------------------------------------------------------------------ 3-D scalar fields: level surfaces, slices

registerFrameHint('isosurface', (p) => ({ r: Math.min(60, Math.max(1.5, Math.ceil(extent(p.box as Box) * 1.15 * 2) / 2)), dim: 3 }));
registerFrameHint('sliceplane', (p) => ({ r: Math.min(60, Math.max(1.5, Math.ceil(extent(p.box as Box) * 1.15 * 2) / 2)), dim: 3 }));

class Isosurface3D implements Visual3D {
  object = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private key = '';
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const { fn, levels, box, solid, flat } = item.visual.props as { fn: FunctionValue; levels: number[]; box: Box; solid?: boolean; flat?: boolean };
    const key = `${fn.key}|${levels}|${box}|${ctx.map.key()}|${item.color}|${selected}|${!!ctx.frame.seeThrough}`;
    if (key === this.key) return;
    this.key = key;
    for (const m of this.meshes) {
      this.object.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.meshes = [];
    const F = fn.eval as G3;
    const lo = Math.min(...levels);
    const hi = Math.max(...levels);
    const n = flat ? 12 : levels.length > 2 ? 34 : 44;
    levels.forEach((c) => {
      const iso = isosurfaceCached(`level|${fn.key}|${c}`, (x, y, z) => F(x, y, z) - c, box, n);
      if (!iso.positions.length) return;
      const m = ctx.map;
      const pos = new Float32Array(iso.positions.length);
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.length; i += 3) {
        m.v(iso.positions[i], iso.positions[i + 1], iso.positions[i + 2], v);
        pos[i] = v.x;
        pos[i + 1] = v.y;
        pos[i + 2] = v.z;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(iso.normals, 3));
      const rgb: [number, number, number] = [0, 0, 0];
      const color = solid || flat || levels.length === 1 ? new THREE.Color(item.color) : new THREE.Color().setRGB(...colormap(hi > lo ? (c - lo) / (hi - lo) : 0.5, rgb), THREE.SRGBColorSpace);
      // with a tangent patch in the scene the surfaces around it turn to glass so it can be seen
      const ghost = !!ctx.frame.seeThrough && !flat;
      const opacity = flat ? 0.88 : ghost ? (levels.length > 1 ? 0.1 : 0.3) : levels.length > 1 ? 0.38 : 0.62;
      const mat = new THREE.MeshStandardMaterial({ color: flat ? new THREE.Color('#ffd166') : color, roughness: 0.55, metalness: 0.05, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: levels.length === 1 && !flat && !ghost });
      setOpacity(mat, selected && !flat ? Math.min(0.85, opacity + 0.2) : opacity);
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = flat ? 5 : 2;
      this.meshes.push(mesh);
      this.object.add(mesh);
    });
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('isosurface', () => new Isosurface3D());

class SlicePlane3D implements Visual3D {
  object = new THREE.Group();
  private mesh: THREE.Mesh;
  private key = '';
  constructor() {
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    setOpacity(mat, 0.85);
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.object.add(this.mesh);
  }
  update(item: SceneItem, ctx: Ctx3D) {
    const { fn, axis, at, box } = item.visual.props as { fn: FunctionValue; axis: number; at: number; box: Box };
    const key = `${fn.key}|${axis}|${at}|${box}|${ctx.map.key()}`;
    if (key === this.key) return;
    this.key = key;
    const F = fn.eval as G3;
    const n = 60;
    const others = [0, 1, 2].filter((k) => k !== axis);
    const vals: number[] = [];
    const pts: number[][] = [];
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const p = [0, 0, 0];
        p[axis] = at;
        p[others[0]] = box[others[0]][0] + ((box[others[0]][1] - box[others[0]][0]) * i) / n;
        p[others[1]] = box[others[1]][0] + ((box[others[1]][1] - box[others[1]][0]) * j) / n;
        pts.push(p);
        vals.push(F(p[0], p[1], p[2]));
      }
    const finite = vals.filter(Number.isFinite).sort((a, b) => a - b);
    const lo = finite[Math.floor(finite.length * 0.02)] ?? 0;
    const hi = finite[Math.floor(finite.length * 0.98)] ?? 1;
    const pos = new Float32Array(pts.length * 3);
    const col = new Float32Array(pts.length * 3);
    const rgb: [number, number, number] = [0, 0, 0];
    const v = new THREE.Vector3();
    const tmp = new THREE.Color();
    pts.forEach((p, k) => {
      ctx.map.v(p[0], p[1], p[2], v);
      pos.set([v.x, v.y, v.z], k * 3);
      colormap(hi > lo ? Math.max(0, Math.min(1, (vals[k] - lo) / (hi - lo))) : 0.5, rgb);
      tmp.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      col.set([tmp.r, tmp.g, tmp.b], k * 3);
    });
    const idx: number[] = [];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        if ([a, a + 1, a + n + 1, a + n + 2].some((q) => !Number.isFinite(vals[q]))) continue;
        idx.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('sliceplane', () => new SlicePlane3D());

// ------------------------------------------------------------------ Lagrange: the level curve sweeps to the optimum

registerFrameHint('levelsweep', (p) => (p.box ? { r: extent(p.box as Box), dim: 2, box: p.box as Box } : undefined));

registerDrawer2D('levelsweep', {
  layer: 3,
  draw(a) {
    const { fn, from, to, timeline } = a.item.visual.props as { fn: FunctionValue; from: number; to: number; timeline: string };
    const t = Math.max(0, Math.min(1, a.timeline(timeline, 1)));
    const c = from + (to - from) * t;
    const { ctx, view, theme } = a;
    const q = (v: number) => +v.toPrecision(6);
    const grid = sampleGrid(fn, [q(view.xRange[0]), q(view.xRange[1])], [q(view.yRange[0]), q(view.yRange[1])], 200);
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = t >= 0.999 ? 3 : 2.2;
    ctx.setLineDash(t >= 0.999 ? [] : [6, 4]);
    const segs = cachedLevelSet(grid, c);
    ctx.beginPath();
    for (let k = 0; k + 3 < segs.length; k += 4) {
      ctx.moveTo(view.sx(segs[k]), view.sy(segs[k + 1]));
      ctx.lineTo(view.sx(segs[k + 2]), view.sy(segs[k + 3]));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (segs.length) drawLabel(ctx, `${fn.label ?? 'f'} = ${+c.toPrecision(4)}`, view.sx(segs[0]) + 6, view.sy(segs[1]) - 10, '#ffd166', theme, 13);
  },
});
// ------------------------------------------------------------------ steepest ascent / descent in space

class Path3D implements Visual3D {
  object = new THREE.Group();
  private lines: FatSegments[] = [];
  private key = '';
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const { ascent, descent } = item.visual.props as { ascent: number[][]; descent: number[][] };
    const m = ctx.map;
    const key = `${ascent.length}|${ascent[ascent.length - 1]}|${descent.length}|${descent[descent.length - 1]}|${ascent[0]}|${m.key()}|${selected}`;
    if (key === this.key) return;
    this.key = key;
    for (const l of this.lines) this.object.remove(l.lines);
    this.lines = [];
    const v = new THREE.Vector3();
    [ascent, descent].forEach((pts, k) => {
      const seg: number[] = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        // the descent path is dashed: every other piece is left out
        if (k === 1 && i % 4 >= 2) continue;
        m.v(pts[i][0], pts[i][1], pts[i][2], v);
        seg.push(v.x, v.y, v.z);
        m.v(pts[i + 1][0], pts[i + 1][1], pts[i + 1][2], v);
        seg.push(v.x, v.y, v.z);
      }
      const line = new FatSegments(ctx.lineMaterial(k === 0 ? '#ff6b6b' : '#4cc9f0', selected ? 4 : 3, { depthTest: false }));
      line.set(seg);
      line.lines.renderOrder = 6;
      this.lines.push(line);
      this.object.add(line.lines);
    });
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('path3', () => new Path3D());