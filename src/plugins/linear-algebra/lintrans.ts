/**
 * Framework-free model of the animated linear transformation (shared by the 2-D drawer and the 3-D
 * visual). A transformation is a chain of stages C₀ = I, C₁, …, C_k (cumulative products); the
 * timeline value t ∈ [0, k] interpolates linearly between consecutive stages, the way 3Blue1Brown
 * animates grids.
 */
import { registerFrameHint } from '../../visualization/sampling';
import type { SceneItem } from '../../visualization/scene-model';

/** The plain I → A morph steps aside while a stepped version of the same map (P⁻¹ → D → P …) is shown. */
export function yieldsTo(items: SceneItem[], self: SceneItem, p: LinTransProps): boolean {
  if ((p as { base?: string }).base) return false;
  return items.some((i) => i !== self && i.visible && i.visual.vtype === 'lintrans' && i.visual.props.base === p.name);
}

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
  // a pure rotation step (B = R A, R orthogonal with det 1) turns by angle instead of shrinking through a lerp
  const R = rotationStep(A, B);
  if (R) return mulM(rotationPower(R, u), A);
  return A.map((r, a) => r.map((x, b) => x + (B[a][b] - x) * u));
}

const mulM = (A: number[][], B: number[][]) => A.map((r) => B[0].map((_, j) => r.reduce((s, x, k) => s + x * B[k][j], 0)));

function inverseSmall(A: number[][]): number[][] | null {
  const n = A.length;
  const M = A.map((r, i) => [...r, ...identity(n)[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-10) return null;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    M[c] = M[c].map((x) => x / d);
    for (let r = 0; r < n; r++) if (r !== c) M[r] = M[r].map((x, j) => x - M[r][c] * M[c][j]);
  }
  return M.map((r) => r.slice(n));
}

/** R = B A⁻¹ when it is a proper rotation (not the identity), else null. */
function rotationStep(A: number[][], B: number[][]): number[][] | null {
  const Ai = inverseSmall(A);
  if (!Ai) return null;
  const R = mulM(B, Ai);
  const n = R.length;
  const RtR = mulM(R[0].map((_, j) => R.map((r) => r[j])), R);
  const orth = RtR.every((r, i) => r.every((x, j) => Math.abs(x - (i === j ? 1 : 0)) < 1e-7));
  const d = n === 2 ? det2(R) : R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
  const isId = R.every((r, i) => r.every((x, j) => Math.abs(x - (i === j ? 1 : 0)) < 1e-9));
  return orth && Math.abs(d - 1) < 1e-7 && !isId ? R : null;
}

/** R^u for a rotation R: same axis, u times the angle. */
function rotationPower(R: number[][], u: number): number[][] {
  if (R.length === 2) {
    const th = Math.atan2(R[1][0], R[0][0]) * u;
    return [[Math.cos(th), -Math.sin(th)], [Math.sin(th), Math.cos(th)]];
  }
  const tr = R[0][0] + R[1][1] + R[2][2];
  const th = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
  let k = [R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]];
  let kn = Math.hypot(k[0], k[1], k[2]);
  if (kn < 1e-9) {
    // θ = π: axis from R + I
    const S = R.map((r, i) => r.map((x, j) => (x + (i === j ? 1 : 0)) / 2));
    const c = [0, 1, 2].reduce((best, j) => (S[j][j] > S[best][best] ? j : best), 0);
    k = S.map((r) => r[c]);
    kn = Math.hypot(k[0], k[1], k[2]) || 1;
  }
  const [x, y, z] = k.map((c) => c / kn);
  const a = th * u;
  const C = Math.cos(a), S = Math.sin(a), t = 1 - C;
  return [
    [t * x * x + C, t * x * y - S * z, t * x * z + S * y],
    [t * x * y + S * z, t * y * y + C, t * y * z - S * x],
    [t * x * z - S * y, t * y * z + S * x, t * z * z + C],
  ];
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

// frames for the other linear-algebra visuals: fit their vectors (3 units at least)
const fit = (vs: (number[] | undefined)[], dim: number) => {
  let m = 1;
  for (const v of vs) if (v) m = Math.max(m, ...v.map(Math.abs));
  return { r: Math.max(dim === 3 ? 2.5 : 3, Math.ceil(m * 1.3)), dim };
};
registerFrameHint('subspace', (props) => {
  const s = props.s as { ambient: number; basis: number[][] };
  return s.ambient <= 3 ? fit(s.basis, s.ambient) : undefined;
});
registerFrameHint('projection', (props) => {
  const v = props.v as number[];
  return v.length <= 3 ? fit([v, props.p as number[]], v.length) : undefined;
});
registerFrameHint('coords', (props) => {
  const v = props.v as number[];
  return v.length <= 3 ? fit([v, ...(props.basis as number[][])], v.length) : undefined;
});
registerFrameHint('affine', (props) => {
  const a = props.a as { ambient: number; particular?: number[] };
  return a.ambient <= 3 ? fit([a.particular], a.ambient) : undefined;
});
