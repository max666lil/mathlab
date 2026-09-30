/**
 * Flow of a vector field (framework-free, shared by 2-D and 3-D renderers): RK4 integration,
 * a flow-time scale so that one animation cycle moves particles a readable distance, cached
 * particle tracks and evenly spaced streamlines.
 */
import type { FunctionValue } from '../../math-core/values';
import { registerFrameHint } from '../../visualization/sampling';

export type Vec = number[];
export type FieldFn = (p: Vec) => Vec;

export const fieldFn = (f: FunctionValue): FieldFn => {
  const g = f.eval as (...a: number[]) => number[];
  return (p) => g(...p);
};

export const FIELD_RANGE = 3;

function rk4(F: FieldFn, p: Vec, h: number, unit = false): Vec | null {
  const at = (q: Vec) => {
    const v = F(q);
    if (!v.every(Number.isFinite)) return null;
    if (!unit) return v;
    const l = Math.hypot(...v);
    return l < 1e-12 ? null : v.map((x) => x / l);
  };
  const k1 = at(p);
  if (!k1) return null;
  const k2 = at(p.map((x, i) => x + (h / 2) * k1[i]));
  if (!k2) return null;
  const k3 = at(p.map((x, i) => x + (h / 2) * k2[i]));
  if (!k3) return null;
  const k4 = at(p.map((x, i) => x + h * k3[i]));
  if (!k4) return null;
  return p.map((x, i) => x + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, unknown>();
function memo<T>(key: string, make: () => T): T {
  if (cache.has(key)) return cache.get(key) as T;
  if (cache.size > 40) cache.clear();
  const v = make();
  cache.set(key, v);
  return v;
}

/** Flow time per animation cycle: the median speed carries a particle ~0.4·r per cycle. */
export function flowScale(f: FunctionValue, r = FIELD_RANGE): number {
  return memo(`scale|${f.key}|${r}`, () => {
    const F = fieldFn(f);
    const n = f.params.length;
    const k = n === 2 ? 15 : 7;
    const speeds: number[] = [];
    const idx = Array(n).fill(0);
    for (let c = 0; c < k ** n; c++) {
      let q = c;
      for (let d = 0; d < n; d++) {
        idx[d] = q % k;
        q = Math.floor(q / k);
      }
      const v = F(idx.map((i) => -r + ((i + 0.5) * 2 * r) / k));
      if (v.every(Number.isFinite)) speeds.push(Math.hypot(...v));
    }
    speeds.sort((a, b) => a - b);
    const med = speeds[Math.floor(speeds.length / 2)] ?? 1;
    return (0.4 * r) / Math.max(med, 1e-6);
  });
}

export interface Tracks {
  n: number;
  K: number;
  /** per particle: K positions (NaN once it leaves the box or stalls) */
  paths: Float64Array[];
  phase: number[];
}

/** Particle tracks for one cycle, K frames each, started at random seeds with random phases. */
export function particleTracks(f: FunctionValue, count: number, r = FIELD_RANGE, K = 90): Tracks {
  const n = f.params.length;
  return memo(`tracks|${f.key}|${r}|${count}`, () => {
    const F = fieldFn(f);
    const T = flowScale(f, r);
    const rnd = mulberry(7);
    const h = T / K;
    const paths: Float64Array[] = [];
    const phase: number[] = [];
    for (let i = 0; i < count; i++) {
      const path = new Float64Array(K * n).fill(NaN);
      let p: Vec | null = Array.from({ length: n }, () => -r + 2 * r * rnd());
      for (let k = 0; k < K && p; k++) {
        if (p.some((x) => Math.abs(x) > r * 1.08)) break;
        for (let d = 0; d < n; d++) path[k * n + d] = p[d];
        p = rk4(F, p, h);
      }
      paths.push(path);
      phase.push(rnd());
    }
    return { n, K, paths, phase };
  });
}

/** Position index of particle i at timeline value t (cycles). */
export function trackIndex(tr: Tracks, i: number, t: number): number {
  const u = t + tr.phase[i];
  return Math.floor((u - Math.floor(u)) * tr.K);
}

/** Evenly spaced streamlines in the plane (occupancy grid, both directions), as polylines. */
export function streamlines2(f: FunctionValue, r = FIELD_RANGE): number[][] {
  return memo(`sl2|${f.key}|${r}`, () => {
    const F = fieldFn(f);
    const cells = 34;
    const occ = new Int32Array(cells * cells).fill(-1);
    const cell = (p: Vec) => {
      const i = Math.floor(((p[0] + r) / (2 * r)) * cells);
      const j = Math.floor(((p[1] + r) / (2 * r)) * cells);
      return i < 0 || j < 0 || i >= cells || j >= cells ? -2 : j * cells + i;
    };
    const h = (2 * r) / 240;
    const lines: number[][] = [];
    const seeds: Vec[] = [];
    const m = 13;
    for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) seeds.push([-r + ((a + 0.5) * 2 * r) / m + (((b * 7) % 5) - 2) * 0.03, -r + ((b + 0.5) * 2 * r) / m]);
    for (const s of seeds) {
      const c0 = cell(s);
      if (c0 < 0 || occ[c0] >= 0) continue;
      const id = lines.length;
      const trace = (dir: 1 | -1) => {
        const out: Vec[] = [];
        let p: Vec | null = s;
        for (let k = 0; k < 600 && p; k++) {
          p = rk4(F, p, dir * h, true);
          if (!p) break;
          const c = cell(p);
          if (c === -2 || (occ[c] >= 0 && occ[c] !== id)) break;
          occ[c] = id;
          out.push(p);
          if (k > 30 && Math.hypot(p[0] - s[0], p[1] - s[1]) < h * 1.5) break; // closed orbit
        }
        return out;
      };
      occ[c0] = id;
      const fwd = trace(1);
      const back = trace(-1).reverse();
      const pts = [...back, s, ...fwd];
      if (pts.length < 8) continue;
      lines.push(pts.flat());
    }
    return lines;
  });
}

/** Streamlines in space from a coarse seed grid. */
export function streamlines3(f: FunctionValue, r = FIELD_RANGE): number[][] {
  return memo(`sl3|${f.key}|${r}`, () => {
    const F = fieldFn(f);
    const h = (2 * r) / 120;
    const lines: number[][] = [];
    const m = 4;
    for (let a = 0; a < m; a++)
      for (let b = 0; b < m; b++)
        for (let c = 0; c < m; c++) {
          const s = [a, b, c].map((i) => -r * 0.8 + ((i + 0.5) * 1.6 * r) / m);
          const trace = (dir: 1 | -1) => {
            const out: Vec[] = [];
            let p: Vec | null = s;
            for (let k = 0; k < 160 && p; k++) {
              p = rk4(F, p, dir * h, true);
              if (!p || p.some((x) => Math.abs(x) > r)) break;
              out.push(p);
            }
            return out;
          };
          const pts = [...trace(-1).reverse(), s, ...trace(1)];
          if (pts.length >= 6) lines.push(pts.flat());
        }
    return lines;
  });
}

for (const vt of ['field2', 'field3', 'streamlines', 'particles'])
  registerFrameHint(vt, (props) => {
    const fn = props.fn as FunctionValue | undefined;
    const n = fn?.params.length ?? 2;
    return { r: FIELD_RANGE, dim: n };
  });