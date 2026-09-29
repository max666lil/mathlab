/** Numeric decompositions: orthonormalisation, QR, SVD (via the symmetric eigensolver on AᵀA). */
import { symmetricEigen, matMul, transpose, norm, dot } from '../../math-core/linalg';

const col = (A: number[][], j: number) => A.map((r) => r[j]);
const fromCols = (cols: number[][], m: number) => Array.from({ length: m }, (_, i) => cols.map((c) => c[i]));

/** Modified Gram–Schmidt; returns orthonormal vectors (dependent ones dropped). */
export function orthonormalize(vs: number[][], tol = 1e-10): number[][] {
  const out: number[][] = [];
  for (const v of vs) {
    let u = v.slice();
    for (const q of out) {
      const c = dot(u, q);
      u = u.map((x, i) => x - c * q[i]);
    }
    const l = norm(u);
    if (l > tol * Math.max(1, norm(v))) out.push(u.map((x) => x / l));
  }
  return out;
}

/** Complete an orthonormal set to a basis of ℝⁿ. */
function complete(qs: number[][], n: number): number[][] {
  const out = qs.slice();
  for (let k = 0; k < n && out.length < n; k++) {
    const e = Array.from({ length: n }, (_, i) => (i === k ? 1 : 0));
    const next = orthonormalize([...out, e]);
    if (next.length > out.length) out.push(next[next.length - 1]);
  }
  return out;
}

export interface QR {
  Q: number[][];
  R: number[][];
}

/** Thin QR of A with independent columns (Q: m×k orthonormal columns, R: k×n upper triangular). */
export function qrOf(A: number[][]): QR {
  const m = A.length;
  const n = A[0]?.length ?? 0;
  const qs = orthonormalize(Array.from({ length: n }, (_, j) => col(A, j)));
  const Q = fromCols(qs, m);
  const R = matMul(transpose(Q), A).map((r, i) => r.map((x, j) => (j < i || Math.abs(x) < 1e-12 ? 0 : x)));
  return { Q, R };
}

export interface SVD {
  U: number[][];
  S: number[][];
  V: number[][];
  sigma: number[];
}

const detSmall = (m: number[][]) =>
  m.length === 2 ? m[0][0] * m[1][1] - m[0][1] * m[1][0]
  : m.length === 3 ? m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  : 1;

/** A = U Σ Vᵀ with V a rotation (det V = +1), so the animation reads rotate → stretch → rotate. */
export function svdOf(A: number[][]): SVD {
  const m = A.length;
  const n = A[0]?.length ?? 0;
  const eig = symmetricEigen(matMul(transpose(A), A));
  const sigma = eig.map((p) => Math.sqrt(Math.max(0, p.value)));
  const vs = eig.map((p) => p.vector.slice());
  if (n <= 3 && detSmall(fromCols(vs, n)) < 0) vs[n - 1] = vs[n - 1].map((x) => -x);
  const tol = 1e-10 * Math.max(1, sigma[0] ?? 0);
  const us: number[][] = [];
  vs.forEach((v, i) => {
    if (i < m && sigma[i] > tol) us.push(A.map((r) => dot(r, v) / sigma[i]));
  });
  const U = fromCols(complete(orthonormalize(us), m), m);
  const V = fromCols(vs, n);
  const S = Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? sigma[i] ?? 0 : 0)));
  return { U, S, V, sigma: sigma.slice(0, Math.min(m, n)) };
}