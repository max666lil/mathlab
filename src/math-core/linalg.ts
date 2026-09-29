/** Small dense linear algebra for 2D/3D geometry and Hessian analysis. */

export type Vec = number[];
export type Mat = number[][];

export const dot = (a: Vec, b: Vec) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
export const norm = (a: Vec) => Math.sqrt(dot(a, a));
export const addV = (a: Vec, b: Vec) => a.map((x, i) => x + (b[i] ?? 0));
export const subV = (a: Vec, b: Vec) => a.map((x, i) => x - (b[i] ?? 0));
export const scaleV = (a: Vec, s: number) => a.map((x) => x * s);
export function normalize(a: Vec): Vec {
  const n = norm(a);
  return n === 0 ? a.map(() => 0) : a.map((x) => x / n);
}
export function cross(a: Vec, b: Vec): Vec {
  const [a1, a2, a3 = 0] = a;
  const [b1, b2, b3 = 0] = b;
  return [a2 * b3 - a3 * b2, a3 * b1 - a1 * b3, a1 * b2 - a2 * b1];
}
export const matVec = (m: Mat, v: Vec) => m.map((r) => dot(r, v));
export const matMul = (a: Mat, b: Mat): Mat => a.map((r) => b[0].map((_, j) => r.reduce((s, x, k) => s + x * b[k][j], 0)));
export const transpose = (m: Mat): Mat => m[0].map((_, j) => m.map((r) => r[j]));
/** uᵀ M u */
export const quadForm = (m: Mat, u: Vec) => dot(u, matVec(m, u));

export function det(m: Mat): number {
  const n = m.length;
  if (n === 1) return m[0][0];
  if (n === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0];
  if (n === 3)
    return (
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    );
  // Gaussian elimination
  const a = m.map((r) => r.slice());
  let d = 1;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    if (a[p][i] === 0) return 0;
    if (p !== i) {
      [a[p], a[i]] = [a[i], a[p]];
      d = -d;
    }
    d *= a[i][i];
    for (let r = i + 1; r < n; r++) {
      const f = a[r][i] / a[i][i];
      for (let c = i; c < n; c++) a[r][c] -= f * a[i][c];
    }
  }
  return d;
}

export interface EigenPair {
  value: number;
  vector: Vec;
}

/**
 * Eigen-decomposition of a real symmetric matrix (Jacobi rotations), sorted by
 * descending eigenvalue. Eigenvectors are unit length.
 */
export function symmetricEigen(m: Mat): EigenPair[] {
  const n = m.length;
  const a = m.map((r) => r.slice());
  // symmetrise defensively
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) a[i][j] = a[j][i] = (a[i][j] + a[j][i]) / 2;
  const v: Mat = a.map((_, i) => a.map((_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const pairs = a.map((_, i) => ({ value: a[i][i], vector: normalize(v.map((r) => r[i])) }));
  // canonical sign: first significant component positive
  for (const p of pairs) {
    const k = p.vector.findIndex((x) => Math.abs(x) > 1e-9);
    if (k >= 0 && p.vector[k] < 0) p.vector = p.vector.map((x) => -x);
  }
  return pairs.sort((x, y) => y.value - x.value);
}
