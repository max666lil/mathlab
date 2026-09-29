/**
 * Framework-free model of the animated linear transformation (shared by the 2-D drawer and the 3-D
 * visual). A transformation is a chain of stages C₀ = I, C₁, …, C_k (cumulative products); the
 * timeline value t ∈ [0, k] interpolates linearly between consecutive stages, the way 3Blue1Brown
 * animates grids.
 */
import { registerFrameHint } from '../../visualization/sampling';

export interface TrackedVector {
  comps: number[];
  label: string;
  sourceId?: string;
}

export interface LinTransProps {
  /** cumulative stage matrices (square, n×n); the last one is the full map */
  stages: number[][][];
  /** stop labels shown on the transport bar, e.g. ['I', 'A'] or ['I', 'B', 'AB'] */
  stops: string[];
  /** timeline key, e.g. 'lin:A' */
  timeline: string;
  /** name of the matrix (for labels) */
  name: string;
  /** node that owns the matrix entries (dragging î / ĵ solves for its inputs) */
  sourceId?: string;
  /** dimension of the drawing (2 or 3); non-square maps are embedded */
  n: number;
  vectors: TrackedVector[];
  /** det of the full map (area / volume factor) */
  det: number;
}

export const identity = (n: number) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

/** Matrix at timeline value t. */
export function matrixAt(p: LinTransProps, t: number): number[][] {
  const chain = [identity(p.n), ...p.stages];
  const k = chain.length - 1;
  const tt = Math.max(0, Math.min(k, t));
  const i = Math.min(k - 1, Math.floor(tt));
  const u = tt - i;
  const A = chain[i];
  const B = chain[i + 1];
  return A.map((r, a) => r.map((x, b) => x + (B[a][b] - x) * u));
}

export const apply = (M: number[][], v: number[]) => M.map((r) => r.reduce((s, x, j) => s + x * (v[j] ?? 0), 0));

export function det2(M: number[][]) {
  return M[0][0] * M[1][1] - M[0][1] * M[1][0];
}

/** Embed an m×n matrix (m, n ≤ 3) into a square matrix of size max(m, n) by zero padding. */
export function embed(rows: number[][]): number[][] {
  const n = Math.max(rows.length, rows[0].length);
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => rows[i]?.[j] ?? 0));
}

/** Symmetric frame radius that contains the unit cell, the columns and the tracked vectors at every stage. */
function extent(p: LinTransProps): number {
  let m = 1;
  const chain = [identity(p.n), ...p.stages];
  for (const M of chain) {
    for (let j = 0; j < p.n; j++) m = Math.max(m, ...M.map((r) => Math.abs(r[j])));
    if (p.n === 2) m = Math.max(m, ...apply(M, [1, 1]).map(Math.abs));
    // 3-D: the drawn lattice spans [−1, 1]³; keep most of its image in view
    else m = Math.max(m, 0.7 * Math.max(...M.map((r) => r.reduce((s, x) => s + Math.abs(x), 0))));
    for (const v of p.vectors) m = Math.max(m, ...apply(M, v.comps).map(Math.abs));
  }
  return m;
}

registerFrameHint('lintrans', (props) => {
  const p = props as unknown as LinTransProps;
  const r = Math.max(p.n === 3 ? 2.5 : 3, Math.ceil(extent(p) * (p.n === 3 ? 1.2 : 1.1)));
  return { r, dim: p.n };
});