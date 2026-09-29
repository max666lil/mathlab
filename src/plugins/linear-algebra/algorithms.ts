/**
 * Field-generic linear algebra: Gauss–Jordan elimination and everything derived from it.
 * The same code runs exactly (Field<Q>) or numerically (Field<number>).
 */
import { Field } from './field';

export type M<T> = T[][];

export const shape = <T>(A: M<T>) => [A.length, A[0]?.length ?? 0] as const;
export const copy = <T>(A: M<T>): M<T> => A.map((r) => r.slice());
export const identityOf = <T>(F: Field<T>, n: number): M<T> => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? F.one : F.zero)));
export const transposeOf = <T>(A: M<T>): M<T> => (A[0] ?? []).map((_, j) => A.map((r) => r[j]));

export function mul<T>(F: Field<T>, A: M<T>, B: M<T>): M<T> {
  const [m, k] = shape(A);
  const n = B[0]?.length ?? 0;
  return Array.from({ length: m }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let s = F.zero;
      for (let t = 0; t < k; t++) s = F.add(s, F.mul(A[i][t], B[t][j]));
      return s;
    }),
  );
}

export function mulVec<T>(F: Field<T>, A: M<T>, v: T[]): T[] {
  return A.map((r) => r.reduce((s, x, j) => F.add(s, F.mul(x, v[j])), F.zero));
}

export function dotOf<T>(F: Field<T>, a: T[], b: T[]): T {
  return a.reduce((s, x, i) => F.add(s, F.mul(x, b[i])), F.zero);
}

export interface RREF<T> {
  R: M<T>;
  pivots: number[];
}

/** Reduced row echelon form (partial pivoting when numeric). */
export function rref<T>(F: Field<T>, A: M<T>): RREF<T> {
  const R = copy(A);
  const [m, n] = shape(R);
  const pivots: number[] = [];
  let row = 0;
  for (let c = 0; c < n && row < m; c++) {
    let best = -1;
    let bs = 0;
    for (let i = row; i < m; i++) {
      if (F.isZero(R[i][c])) continue;
      const s = F.score(R[i][c]);
      if (s > bs) {
        bs = s;
        best = i;
        if (F.exact) break;
      }
    }
    if (best < 0) {
      for (let i = row; i < m; i++) R[i][c] = F.zero;
      continue;
    }
    [R[row], R[best]] = [R[best], R[row]];
    const p = R[row][c];
    R[row] = R[row].map((x) => F.div(x, p));
    R[row][c] = F.one;
    for (let i = 0; i < m; i++) {
      if (i === row) continue;
      const f = R[i][c];
      if (!F.isZero(f)) R[i] = R[i].map((x, j) => F.sub(x, F.mul(f, R[row][j])));
      R[i][c] = F.zero;
    }
    pivots.push(c);
    row++;
  }
  if (!F.exact) for (const r of R) for (let j = 0; j < n; j++) if (F.isZero(r[j])) r[j] = F.zero;
  return { R, pivots };
}

export function det<T>(F: Field<T>, A0: M<T>): T {
  const A = copy(A0);
  const n = A.length;
  let d = F.one;
  for (let c = 0; c < n; c++) {
    let best = -1;
    let bs = 0;
    for (let i = c; i < n; i++) {
      if (F.isZero(A[i][c])) continue;
      const s = F.score(A[i][c]);
      if (s > bs) {
        bs = s;
        best = i;
        if (F.exact) break;
      }
    }
    if (best < 0) return F.zero;
    if (best !== c) {
      [A[c], A[best]] = [A[best], A[c]];
      d = F.neg(d);
    }
    d = F.mul(d, A[c][c]);
    for (let i = c + 1; i < n; i++) {
      const f = F.div(A[i][c], A[c][c]);
      if (!F.isZero(f)) A[i] = A[i].map((x, j) => F.sub(x, F.mul(f, A[c][j])));
    }
  }
  return d;
}

export function inverse<T>(F: Field<T>, A: M<T>): M<T> | null {
  const n = A.length;
  const I = identityOf(F, n);
  const { R, pivots } = rref(F, A.map((r, i) => [...r, ...I[i]]));
  if (pivots.length < n || pivots[n - 1] !== n - 1) return null;
  return R.map((r) => r.slice(n));
}

/** Basis of the null space: one vector per free column (that free variable = 1). */
export function nullspace<T>(F: Field<T>, A: M<T>, rr: RREF<T> = rref(F, A)): T[][] {
  const n = A[0]?.length ?? 0;
  const free = Array.from({ length: n }, (_, j) => j).filter((j) => !rr.pivots.includes(j));
  return free.map((f) => {
    const x = Array.from({ length: n }, (_, j) => (j === f ? F.one : F.zero));
    rr.pivots.forEach((pc, row) => (x[pc] = F.neg(rr.R[row][f])));
    return x;
  });
}

export interface LinearSolution<T> {
  consistent: boolean;
  particular?: T[];
  directions: T[][];
  pivots: number[];
}

/** Solve A x = b: particular solution + null-space directions, or inconsistent. */
export function solveSystem<T>(F: Field<T>, A: M<T>, b: T[]): LinearSolution<T> {
  const n = A[0]?.length ?? 0;
  const rr = rref(F, A.map((r, i) => [...r, b[i]]));
  if (rr.pivots.includes(n)) return { consistent: false, directions: [], pivots: rr.pivots };
  const x = Array.from({ length: n }, () => F.zero);
  rr.pivots.forEach((pc, row) => (x[pc] = rr.R[row][n]));
  const Arr = { R: rr.R.map((r) => r.slice(0, n)), pivots: rr.pivots };
  return { consistent: true, particular: x, directions: nullspace(F, A, Arr), pivots: rr.pivots };
}

export const trace = <T>(F: Field<T>, A: M<T>): T => A.reduce((s, r, i) => F.add(s, r[i]), F.zero);

/** Characteristic polynomial det(λI − A) by Faddeev–LeVerrier: c[k] is the coefficient of λ^k. */
export function charpoly<T>(F: Field<T>, A: M<T>): T[] {
  const n = A.length;
  const c: T[] = new Array(n + 1).fill(F.zero);
  c[n] = F.one;
  let Mk: M<T> = A.map((r) => r.map(() => F.zero));
  for (let k = 1; k <= n; k++) {
    const AM = mul(F, A, Mk);
    Mk = AM.map((r, i) => r.map((x, j) => (i === j ? F.add(x, c[n - k + 1]) : x)));
    c[n - k] = F.neg(F.div(trace(F, mul(F, A, Mk)), F.of(k)));
  }
  return c;
}

/** Gram–Schmidt without normalisation (exact over ℚ); dependent vectors are dropped. */
export function gramSchmidt<T>(F: Field<T>, vs: T[][]): T[][] {
  const out: T[][] = [];
  for (const v of vs) {
    let u = v.slice();
    for (const w of out) {
      const c = F.div(dotOf(F, v, w), dotOf(F, w, w));
      u = u.map((x, i) => F.sub(x, F.mul(c, w[i])));
    }
    if (!u.every((x) => F.isZero(x))) out.push(u);
  }
  return out;
}

/** Orthogonal projection matrix onto the column space of B (B has independent columns). */
export function projector<T>(F: Field<T>, B: M<T>): M<T> | null {
  const Bt = transposeOf(B);
  const inv = inverse(F, mul(F, Bt, B));
  return inv ? mul(F, mul(F, B, inv), Bt) : null;
}