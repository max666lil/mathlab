/**
 * Numerical sampling shared by all renderers: function grids (cached by function identity),
 * marching-squares level sets, cross-section samples and steepest-ascent paths.
 */
import { FunctionValue } from '../math-core/values';

export type Range = [number, number];

export interface Grid {
  key: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  n: number;
  /** (n+1)×(n+1) samples, row-major: z[j*(n+1)+i] = f(x_i, y_j) */
  z: Float64Array;
  min: number;
  max: number;
  /** robust display range (tails of blow-ups trimmed) */
  lo: number;
  hi: number;
}

const gridCache = new Map<string, Grid>();

export function sampleGrid(fn: FunctionValue, xr: Range, yr: Range, n: number): Grid {
  const key = `${fn.key}|${xr}|${yr}|${n}`;
  const hit = gridCache.get(key);
  if (hit) return hit;
  const f = fn.eval as (x: number, y: number) => number;
  const z = new Float64Array((n + 1) * (n + 1));
  const vals: number[] = [];
  for (let j = 0; j <= n; j++) {
    const y = yr[0] + ((yr[1] - yr[0]) * j) / n;
    for (let i = 0; i <= n; i++) {
      const x = xr[0] + ((xr[1] - xr[0]) * i) / n;
      let v = f(x, y);
      if (!Number.isFinite(v)) v = NaN;
      z[j * (n + 1) + i] = v;
      if (!Number.isNaN(v)) vals.push(v);
    }
  }
  vals.sort((a, b) => a - b);
  const min = vals.length ? vals[0] : 0;
  const max = vals.length ? vals[vals.length - 1] : 1;
  const q = (p: number) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)))] : 0);
  const p1 = q(0.01);
  const p99 = q(0.99);
  const core = Math.max(p99 - p1, 1e-9);
  let lo = min - p1 < -2 * core ? p1 - 0.05 * core : min;
  let hi = max - p99 > 2 * core ? p99 + 0.05 * core : max;
  if (hi - lo < 1e-9) {
    lo -= 0.5;
    hi += 0.5;
  }
  const g: Grid = { key, x0: xr[0], x1: xr[1], y0: yr[0], y1: yr[1], n, z, min, max, lo, hi };
  if (gridCache.size > 24) gridCache.delete(gridCache.keys().next().value!);
  gridCache.set(key, g);
  return g;
}

/** Evenly spaced "nice" contour levels strictly inside (lo, hi). */
export function niceLevels(lo: number, hi: number, count = 14): number[] {
  const raw = (hi - lo) / count;
  if (!(raw > 0)) return [];
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v < hi - 1e-12 && out.length < 200; v += step) if (v > lo + 1e-12) out.push(+v.toPrecision(12));
  return out;
}

/** Level set f = level as line segments [x1, y1, x2, y2, ...] (marching squares). */
export function marchingSquares(g: Grid, level: number): Float32Array {
  const { n, z } = g;
  const dx = (g.x1 - g.x0) / n;
  const dy = (g.y1 - g.y0) / n;
  const out: number[] = [];
  const W = n + 1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = z[j * W + i] - level; // (i, j)
      const b = z[j * W + i + 1] - level; // (i+1, j)
      const c = z[(j + 1) * W + i + 1] - level; // (i+1, j+1)
      const d = z[(j + 1) * W + i] - level; // (i, j+1)
      if (Number.isNaN(a + b + c + d)) continue;
      const idx = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const x = g.x0 + i * dx;
      const y = g.y0 + j * dy;
      // edge interpolation points
      const e0 = () => [x + (dx * a) / (a - b), y]; // bottom a-b
      const e1 = () => [x + dx, y + (dy * b) / (b - c)]; // right b-c
      const e2 = () => [x + (dx * d) / (d - c), y + dy]; // top d-c
      const e3 = () => [x, y + (dy * a) / (a - d)]; // left a-d
      const seg = (p: number[], q: number[]) => out.push(p[0], p[1], q[0], q[1]);
      switch (idx) {
        case 1: case 14: seg(e0(), e3()); break;
        case 2: case 13: seg(e0(), e1()); break;
        case 3: case 12: seg(e1(), e3()); break;
        case 4: case 11: seg(e1(), e2()); break;
        case 6: case 9: seg(e0(), e2()); break;
        case 7: case 8: seg(e2(), e3()); break;
        case 5: case 10: {
          const center = (a + b + c + d) / 4 > 0;
          if ((idx === 5) === center) {
            seg(e0(), e1());
            seg(e2(), e3());
          } else {
            seg(e0(), e3());
            seg(e1(), e2());
          }
          break;
        }
      }
    }
  }
  return new Float32Array(out);
}

const contourCache = new Map<string, Float32Array>();
export function cachedLevelSet(g: Grid, level: number): Float32Array {
  const key = `${g.key}|${level}`;
  let s = contourCache.get(key);
  if (!s) {
    s = marchingSquares(g, level);
    if (contourCache.size > 400) contourCache.delete(contourCache.keys().next().value!);
    contourCache.set(key, s);
  }
  return s;
}

/** Samples of t ↦ f(origin + t·dir) for t ∈ [t0, t1]. */
export function sliceSamples(fn: FunctionValue, origin: number[], dir: number[], t0: number, t1: number, n = 200) {
  const f = fn.eval as (...a: number[]) => number;
  const t = new Float64Array(n + 1);
  const z = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    const tk = t0 + ((t1 - t0) * k) / n;
    t[k] = tk;
    const v = f(...origin.map((o, i) => o + tk * dir[i]));
    z[k] = Number.isFinite(v) ? v : NaN;
  }
  return { t, z };
}

/** Parameter interval of the line origin + t·dir inside the box [x0,x1]×[y0,y1]. */
export function lineBoxInterval(origin: number[], dir: number[], xr: Range, yr: Range): Range | null {
  let lo = -Infinity;
  let hi = Infinity;
  const clip = (o: number, d: number, a: number, b: number) => {
    if (Math.abs(d) < 1e-12) {
      if (o < a || o > b) lo = Infinity;
      return;
    }
    const t1 = (a - o) / d;
    const t2 = (b - o) / d;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
  };
  clip(origin[0], dir[0], xr[0], xr[1]);
  clip(origin[1], dir[1], yr[0], yr[1]);
  return lo < hi ? [lo, hi] : null;
}

/**
 * Steepest ascent (sign = +1) or descent (−1) path from p along the normalised gradient,
 * integrated with RK4 in arc length. Stops at critical points, domain edges, or when f stops
 * improving.
 */
export function steepestPath(fn: FunctionValue, grad: FunctionValue, from: number[], sign: 1 | -1, xr: Range, yr: Range): number[][] {
  const f = fn.eval as (x: number, y: number) => number;
  const g = grad.eval as (x: number, y: number) => number[];
  const size = Math.max(xr[1] - xr[0], yr[1] - yr[0]);
  const h = size / 300;
  const dirAt = (x: number, y: number): number[] | null => {
    const v = g(x, y);
    const n = Math.hypot(v[0], v[1]);
    if (!(n > 1e-9)) return null;
    return [(sign * v[0]) / n, (sign * v[1]) / n];
  };
  const pts: number[][] = [from.slice(0, 2)];
  let [x, y] = from;
  let fv = f(x, y);
  for (let k = 0; k < 900; k++) {
    const k1 = dirAt(x, y);
    if (!k1) break;
    const k2 = dirAt(x + (h / 2) * k1[0], y + (h / 2) * k1[1]);
    if (!k2) break;
    const k3 = dirAt(x + (h / 2) * k2[0], y + (h / 2) * k2[1]);
    if (!k3) break;
    const k4 = dirAt(x + h * k3[0], y + h * k3[1]);
    if (!k4) break;
    const nx = x + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    const ny = y + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    const nf = f(nx, ny);
    if (!Number.isFinite(nf) || sign * (nf - fv) <= 1e-12) break;
    if (nx < xr[0] || nx > xr[1] || ny < yr[0] || ny > yr[1]) break;
    x = nx;
    y = ny;
    fv = nf;
    pts.push([x, y]);
  }
  return pts;
}

// ------------------------------------------------------------------ scene frame

export const DEFAULT_RANGE: Range = [-3, 3];

/** Shared domain for all views: the primary (first visible) surface decides the z-range. */
export interface SceneFrame {
  xr: Range;
  yr: Range;
  surface?: FunctionValue;
  /** set when the primary object is a function of one variable (graph view) */
  graph?: FunctionValue;
  grid?: Grid;
  zLo: number;
  zHi: number;
  /** true geometry in ℝ³: one scale on all axes (linear maps, subspaces) instead of a graph box */
  euclid?: boolean;
  /** graph frame that must keep one scale on both axes (circles stay round: implicit curves, curves) */
  equal?: boolean;
  /** a visible visual sits under the surface (Riemann boxes): surfaces become translucent */
  seeThrough?: boolean;
  /** independent x and y scales (data plots: histograms, time series) */
  free?: boolean;
  /** no coordinate grid or axes (diagrams such as probability trees) */
  bare?: boolean;
}

/** A visual that knows how much of the plane / space it needs (e.g. a transformed unit cell). */
export type FrameHint = (props: Record<string, unknown>) => { r: number; dim: number; box?: Range[]; free?: boolean; bare?: boolean; exclusive?: boolean } | undefined;
const frameHints = new Map<string, FrameHint>();
export function registerFrameHint(vtype: string, hint: FrameHint) {
  frameHints.set(vtype, hint);
}

/**
 * Plots with axes of their own (a running mean against n) cannot share the plane with densities:
 * while one is visible, the 2-D view shows only such plots.
 */
export function exclusivePlots<T extends { visible: boolean; visual: { vtype: string; props: Record<string, unknown> } }>(items: T[]): T[] {
  const ex = items.filter((i) => i.visible && frameHints.get(i.visual.vtype)?.(i.visual.props)?.exclusive);
  return ex.length ? ex : items;
}

export function sceneFrame(surface: FunctionValue | undefined, xr: Range = DEFAULT_RANGE, yr: Range = DEFAULT_RANGE): SceneFrame {
  if (!surface) return { xr, yr, zLo: -1, zHi: 1 };
  const grid = sampleGrid(surface, xr, yr, 140);
  return { xr, yr, surface, grid, zLo: grid.lo, zHi: grid.hi };
}

/** The frame for a set of scene items: the first visible surface (or contour map) is primary. */
/** Frame for the graph of a function of one variable: x window and a robust y range. */
export function graphFrame(fn: FunctionValue, xr: Range = [-6, 6]): SceneFrame {
  const f = fn.eval as (x: number) => number;
  const ys: number[] = [];
  for (let i = 0; i <= 600; i++) {
    const y = f(xr[0] + ((xr[1] - xr[0]) * i) / 600);
    if (Number.isFinite(y)) ys.push(y);
  }
  ys.sort((a, b) => a - b);
  let lo = ys.length ? ys[Math.floor(ys.length * 0.04)] : -1;
  let hi = ys.length ? ys[Math.floor(ys.length * 0.96)] : 1;
  lo = Math.min(lo, 0);
  hi = Math.max(hi, 0);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.15;
  return { xr, yr: [lo - pad, hi + pad], graph: fn, zLo: lo, zHi: hi };
}

/**
 * The frame for a set of scene items. The focused object decides: a function of one variable gives
 * a graph frame, a function of two variables its surface frame; otherwise the first visible surface.
 */
export function frameFromItems(items: { visible: boolean; visual: { vtype: string; props: Record<string, unknown> } }[], focus?: { kind: string }, window?: { xr: Range; yr: Range }): SceneFrame {
  const fv = focus?.kind === 'function' ? (focus as FunctionValue) : undefined;
  if (fv && fv.out === 'scalar' && fv.params.length === 1) {
    const g = graphFrame(fv);
    // with curves or regions on the graph, keep one scale (like a graphing calculator)
    if (items.some((i) => i.visible && ['implicit', 'region', 'curve'].includes(i.visual.vtype))) {
      const cy = (g.yr[0] + g.yr[1]) / 2;
      return { ...g, xr: [-6, 6], yr: [Math.min(cy - 4, g.yr[0]), Math.max(cy + 4, g.yr[1])], equal: true };
    }
    return g;
  }
  if (fv && fv.out === 'scalar' && fv.params.length === 2) {
    const own = items.find((i) => i.visual.vtype === 'surface' && (i.visual.props.fn as FunctionValue | undefined)?.key === fv.key)?.visual.props as { xRange?: Range; yRange?: Range } | undefined;
    // a visible visual may ask for its own domain (Riemann boxes over a region)
    const box = items.find((i) => i.visible && i.visual.props.frameBox)?.visual.props.frameBox as Range[] | undefined;
    const pad = (r: Range): Range => [r[0] - (r[1] - r[0]) * 0.12, r[1] + (r[1] - r[0]) * 0.12];
    const seeThrough = items.some((i) => i.visible && i.visual.props.seeThrough);
    const f = sceneFrame(fv, window?.xr ?? (box ? pad(box[0]) : own?.xRange) ?? DEFAULT_RANGE, window?.yr ?? (box ? pad(box[1]) : own?.yRange) ?? DEFAULT_RANGE);
    // other visible surfaces share the box: the height range covers all of them
    for (const it of items) {
      const g = it.visible && it.visual.vtype === 'surface' ? (it.visual.props.fn as FunctionValue | undefined) : undefined;
      if (!g || g.key === fv.key) continue;
      const gr = sampleGrid(g, f.xr, f.yr, 60);
      if (Number.isFinite(gr.lo) && Number.isFinite(gr.hi)) {
        f.zLo = Math.min(f.zLo, gr.lo);
        f.zHi = Math.max(f.zHi, gr.hi);
      }
    }
    return seeThrough ? { ...f, seeThrough } : f;
  }
  // visuals with their own extent (linear maps, subspaces): a symmetric Euclidean frame
  let r = 0;
  let dim = 0;
  // plane visuals may give their own box (a region far from the origin is framed around itself)
  let box: Range[] | null = null;
  let allBoxes = true;
  let free = false;
  let bare = true;
  for (const i of items) {
    const h = i.visible ? frameHints.get(i.visual.vtype)?.(i.visual.props) : undefined;
    if (i.visible) bare = bare && !!h?.bare;
    if (h && h.r > 0) {
      r = Math.max(r, h.r);
      dim = Math.max(dim, h.dim);
      free = free || !!h.free;
      if (h.box) box = box ? box.map((b, k) => [Math.min(b[0], h.box![k][0]), Math.max(b[1], h.box![k][1])] as Range) : h.box.map((b) => [...b] as Range);
      else allBoxes = false;
    }
  }
  if (r > 0 && dim === 2 && box && allBoxes) {
    if (free) {
      const padF = (b: Range): Range => [b[0] - (b[1] - b[0]) * 0.08, b[1] + (b[1] - b[0]) * 0.08];
      return { xr: padF(box[0]), yr: padF(box[1]), zLo: -1, zHi: 1, free, ...(bare ? { bare } : {}) };
    }
    const pad = (b: Range): Range => [b[0] - (b[1] - b[0]) * 0.15 - 0.2, b[1] + (b[1] - b[0]) * 0.15 + 0.2];
    return { xr: pad(box[0]), yr: pad(box[1]), zLo: -1, zHi: 1 };
  }
  if (r > 0) return { xr: [-r, r], yr: [-r, r], zLo: dim === 3 ? -r : -1, zHi: dim === 3 ? r : 1, euclid: dim === 3 };
  const primary = items.find((i) => i.visible && i.visual.vtype === 'surface') ?? items.find((i) => i.visible && i.visual.vtype === 'contours');
  const p = primary?.visual.props as { fn?: FunctionValue; xRange?: Range; yRange?: Range } | undefined;
  return sceneFrame(p?.fn, p?.xRange ?? DEFAULT_RANGE, p?.yRange ?? DEFAULT_RANGE);
}
