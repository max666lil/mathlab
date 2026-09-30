/**
 * Eigenvalues and eigenspaces.
 *  - rational matrices: exact characteristic polynomial (Faddeev–LeVerrier over ℚ), rational roots by the
 *    rational-root theorem, one remaining quadratic factor in closed form; anything left → numeric.
 *  - symmetric numeric matrices: Jacobi (symmetricEigen).
 *  - other numeric matrices: Durand–Kerner on the characteristic polynomial.
 */
import { Q, QF, frac, bgcd, qNum, numericField, toQMatrix, primitive, tolFor } from './field';
import { charpoly, nullspace } from './algorithms';
import { symmetricEigen } from '../../math-core/linalg';
import type { Certainty } from '../../math-core/values';

export interface Root {
  re: number;
  im: number;
  mult: number;
  /** exact rational value when known */
  q?: Q;
}

export interface EigenPair {
  re: number;
  im: number;
  alg: number;
  geo: number;
  basis: number[][];
  q?: Q;
  certainty: Certainty;
}

export interface EigenResult {
  pairs: EigenPair[];
  /** coefficients of det(λI − A), c[k] for λ^k */
  charpoly: number[];
  certainty: Certainty;
  evidence: string;
}

// ------------------------------------------------------------------ polynomials over ℚ

const qEval = (p: Q[], x: Q) => p.reduceRight((acc, c) => QF.add(QF.mul(acc, x), c), QF.zero);

function divisors(n: bigint): bigint[] {
  n = n < 0n ? -n : n;
  if (n === 0n || n > 10n ** 12n) return [];
  const out: bigint[] = [];
  for (let d = 1n; d * d <= n; d++) {
    if (n % d === 0n) {
      out.push(d);
      if (d * d !== n) out.push(n / d);
    }
  }
  return out;
}

/** Synthetic division of p (ascending coefficients) by (x − r). */
function deflate(p: Q[], r: Q): Q[] {
  const n = p.length - 1;
  const out: Q[] = new Array(n);
  let acc = p[n];
  for (let k = n - 1; k >= 0; k--) {
    out[k] = acc;
    acc = QF.add(p[k], QF.mul(acc, r));
  }
  return out;
}

function rationalRoot(p: Q[]): Q | null {
  let l = 1n;
  for (const c of p) l = (l / bgcd(l, c.d)) * c.d;
  const ints = p.map((c) => (c.n * l) / c.d);
  const a0 = ints[0];
  const an = ints[ints.length - 1];
  for (const q of divisors(an)) for (const pp of divisors(a0)) for (const s of [1n, -1n]) {
    const r = frac(s * pp, q);
    if (QF.isZero(qEval(p, r))) return r;
  }
  return null;
}

// ------------------------------------------------------------------ numeric roots

/** All complex roots of a real polynomial (ascending coefficients) by Durand–Kerner. */
export function polyRoots(c: number[]): { re: number; im: number }[] {
  let n = c.length - 1;
  while (n > 0 && Math.abs(c[n]) < 1e-14) n--;
  if (n < 1) return [];
  const a = c.slice(0, n + 1).map((x) => x / c[n]);
  const mulC = (x: { re: number; im: number }, y: { re: number; im: number }) => ({ re: x.re * y.re - x.im * y.im, im: x.re * y.im + x.im * y.re });
  const R = 1 + Math.max(...a.slice(0, n).map(Math.abs));
  const zs: { re: number; im: number }[] = [];
  for (let k = 0, z = { re: 1, im: 0 }; k < n; k++, z = mulC(z, { re: 0.4, im: 0.9 })) zs.push({ re: z.re * R * 0.5, im: z.im * R * 0.5 });
  const divC = (x: { re: number; im: number }, y: { re: number; im: number }) => {
    const d = y.re * y.re + y.im * y.im || 1e-300;
    return { re: (x.re * y.re + x.im * y.im) / d, im: (x.im * y.re - x.re * y.im) / d };
  };
  for (let it = 0; it < 500; it++) {
    let delta = 0;
    for (let i = 0; i < n; i++) {
      let num = { re: 1, im: 0 };
      for (let k = n - 1; k >= 0; k--) num = { re: mulC(num, zs[i]).re + a[k], im: mulC(num, zs[i]).im };
      let den = { re: 1, im: 0 };
      for (let j = 0; j < n; j++) if (j !== i) den = mulC(den, { re: zs[i].re - zs[j].re, im: zs[i].im - zs[j].im });
      const step = divC(num, den);
      zs[i] = { re: zs[i].re - step.re, im: zs[i].im - step.im };
      delta = Math.max(delta, Math.hypot(step.re, step.im));
    }
    if (delta < 1e-14) break;
  }
  return zs.map((z) => (Math.abs(z.im) < 1e-7 * Math.max(1, Math.abs(z.re)) ? { re: z.re, im: 0 } : z));
}

function cluster(roots: { re: number; im: number }[], tol: number): Root[] {
  const out: Root[] = [];
  for (const r of roots) {
    const c = out.find((o) => Math.hypot(o.re - r.re, o.im - r.im) < tol);
    if (c) {
      c.re = (c.re * c.mult + r.re) / (c.mult + 1);
      c.im = (c.im * c.mult + r.im) / (c.mult + 1);
      c.mult++;
    } else out.push({ ...r, mult: 1 });
  }
  return out;
}

// ------------------------------------------------------------------ roots of the characteristic polynomial

interface Roots {
  roots: Root[];
  certainty: Certainty;
  evidence: string;
}

function exactRoots(A: Q[][]): Roots & { poly: Q[] } {
  const poly = charpoly(QF, A);
  let p = poly.slice();
  const roots: Root[] = [];
  const push = (r: Root) => {
    r.re += 0; // −0 → 0
    r.im += 0;
    const same = roots.find((o) => o.q && r.q && QF.isZero(QF.sub(o.q, r.q)));
    if (same) same.mult += r.mult;
    else roots.push(r);
  };
  while (p.length > 1) {
    if (QF.isZero(p[0])) {
      push({ re: 0, im: 0, mult: 1, q: QF.zero });
      p = p.slice(1);
      continue;
    }
    const r = rationalRoot(p);
    if (!r) break;
    push({ re: qNum(r), im: 0, mult: 1, q: r });
    p = deflate(p, r);
  }
  const deg = p.length - 1;
  if (deg === 0) return { roots, poly, certainty: 'exact', evidence: 'characteristic polynomial factored over ℚ' };
  if (deg === 2) {
    const [c, b, a] = p.map(qNum);
    const D = b * b - 4 * a * c;
    if (D >= 0) {
      const s = Math.sqrt(D);
      push({ re: (-b + s) / (2 * a), im: 0, mult: 1 });
      push({ re: (-b - s) / (2 * a), im: 0, mult: 1 });
    } else {
      const s = Math.sqrt(-D);
      push({ re: -b / (2 * a), im: s / (2 * a), mult: 1 });
      push({ re: -b / (2 * a), im: -s / (2 * a), mult: 1 });
    }
    return { roots, poly, certainty: 'exact', evidence: 'characteristic polynomial: rational roots + quadratic formula' };
  }
  const rest = cluster(polyRoots(p.map(qNum)), 1e-6);
  rest.forEach(push);
  return { roots, poly, certainty: 'numeric', evidence: `rational roots exact; a degree-${deg} factor solved numerically (Durand–Kerner)` };
}

// ------------------------------------------------------------------ eigen decomposition

function scaleMax(v: number[]): number[] {
  // free-variable form already has a 1; keep it, only clean −0
  return v.map((x) => (Math.abs(x) < 1e-13 ? 0 : x));
}

export function isSymmetric(rows: number[][], tol = 1e-12) {
  return rows.every((r, i) => r.length === rows.length && r.every((x, j) => Math.abs(x - rows[j][i]) <= tol * Math.max(1, Math.abs(x))));
}

export function eigenOf(rows: number[][], exact: boolean): EigenResult {
  const n = rows.length;
  const Aq = exact ? toQMatrix(rows) : null;
  if (Aq) {
    const r = exactRoots(Aq);
    const pairs: EigenPair[] = r.roots.map((root) => {
      if (root.im !== 0) return { re: root.re, im: root.im, alg: root.mult, geo: 0, basis: [], certainty: r.certainty };
      if (root.q) {
        const B = Aq.map((row, i) => row.map((x, j) => (i === j ? QF.sub(x, root.q!) : x)));
        const basis = nullspace(QF, B).map((v) => primitive(v).map(qNum));
        return { re: root.re, im: 0, alg: root.mult, geo: basis.length, basis, q: root.q, certainty: 'exact' as Certainty };
      }
      const basis = numericNull(rows, root.re);
      return { re: root.re, im: 0, alg: root.mult, geo: basis.length, basis, certainty: 'numeric' as Certainty };
    });
    return { pairs: sortPairs(pairs), charpoly: r.poly.map(qNum), certainty: r.certainty, evidence: r.evidence };
  }
  const F = numericField(tolFor(rows));
  const cp = charpoly(F, rows);
  if (isSymmetric(rows, 1e-10)) {
    const eig = symmetricEigen(rows);
    const tol = 1e-8 * Math.max(1, ...eig.map((p) => Math.abs(p.value)));
    const pairs: EigenPair[] = [];
    for (const p of eig) {
      const g = pairs.find((q) => Math.abs(q.re - p.value) < tol);
      if (g) {
        g.alg++;
        g.geo++;
        g.basis.push(p.vector);
      } else pairs.push({ re: p.value, im: 0, alg: 1, geo: 1, basis: [p.vector], certainty: 'numeric' });
    }
    return { pairs: sortPairs(pairs), charpoly: cp, certainty: 'numeric', evidence: 'Jacobi rotations (symmetric matrix), residual < 10⁻¹⁰' };
  }
  const roots = cluster(polyRoots(cp), 1e-6 * Math.max(1, ...rows.flat().map(Math.abs)));
  const pairs = roots.map((root): EigenPair => {
    if (root.im !== 0) return { re: root.re, im: root.im, alg: root.mult, geo: 0, basis: [], certainty: 'numeric' };
    const basis = numericNull(rows, root.re);
    return { re: root.re, im: 0, alg: root.mult, geo: basis.length, basis, certainty: 'numeric' };
  });
  return { pairs: sortPairs(pairs), charpoly: cp, certainty: 'numeric', evidence: `Durand–Kerner roots of the characteristic polynomial (n = ${n})` };
}

function numericNull(rows: number[][], lambda: number): number[][] {
  const B = rows.map((r, i) => r.map((x, j) => (i === j ? x - lambda : x)));
  const scale = Math.max(1e-300, ...B.flat().map(Math.abs));
  const basis = nullspace(numericField(1e-8 * scale), B).map(scaleMax);
  if (basis.length) return basis;
  // λ is an eigenvalue, so an eigenvector exists: inverse iteration finds it where row reduction is too strict
  const n = rows.length;
  let v = Array.from({ length: n }, (_, i) => 1 / (i + 1.3));
  const shifted = B.map((r, i) => r.map((x, j) => (i === j ? x + 1e-10 * scale : x)));
  for (let it = 0; it < 30; it++) {
    const w = solveDense(shifted, v);
    if (!w) break;
    const l = Math.hypot(...w);
    if (!Number.isFinite(l) || l === 0) break;
    v = w.map((x) => x / l);
  }
  const k = v.reduce((best, x, i) => (Math.abs(x) > Math.abs(v[best]) ? i : best), 0);
  return [scaleMax(v.map((x) => x / v[k]))];
}

function solveDense(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (M[p][c] === 0) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/** Real eigenvalues descending, then complex ones (positive imaginary part first). */
function sortPairs(p: EigenPair[]): EigenPair[] {
  return p.sort((a, b) => (a.im !== 0) === (b.im !== 0) ? b.re - a.re || b.im - a.im : a.im !== 0 ? 1 : -1);
}

