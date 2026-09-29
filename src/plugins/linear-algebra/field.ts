/**
 * Number fields for linear algebra. Every algorithm in algorithms.ts is written once against
 * `Field<T>` and runs either exactly (rational numbers as BigInt fractions) or numerically
 * (doubles with a zero tolerance). Exactness is decided by the input, never guessed afterwards.
 */
import { Q, frac, toFrac, qNum, bgcd } from '../../math-core/rational';

export { frac, toFrac, qNum, bgcd };
export type { Q };

export interface Field<T> {
  exact: boolean;
  zero: T;
  one: T;
  of(x: number): T;
  add(a: T, b: T): T;
  sub(a: T, b: T): T;
  mul(a: T, b: T): T;
  div(a: T, b: T): T;
  neg(a: T): T;
  isZero(a: T): boolean;
  num(a: T): number;
  /** pivot preference: larger is better (numeric: |a|; exact: any non-zero) */
  score(a: T): number;
}

export const QF: Field<Q> = {
  exact: true,
  zero: { n: 0n, d: 1n },
  one: { n: 1n, d: 1n },
  of(x) {
    const q = toFrac(x);
    if (!q) throw new Error(`${x} is not rational`);
    return q;
  },
  add: (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d),
  sub: (a, b) => frac(a.n * b.d - b.n * a.d, a.d * b.d),
  mul: (a, b) => frac(a.n * b.n, a.d * b.d),
  div: (a, b) => frac(a.n * b.d, a.d * b.n),
  neg: (a) => ({ n: -a.n, d: a.d }),
  isZero: (a) => a.n === 0n,
  num: qNum,
  score: (a) => (a.n === 0n ? 0 : 1),
};

// ------------------------------------------------------------------ doubles

export function numericField(tol: number): Field<number> {
  return {
    exact: false,
    zero: 0,
    one: 1,
    of: (x) => x,
    add: (a, b) => a + b,
    sub: (a, b) => a - b,
    mul: (a, b) => a * b,
    div: (a, b) => a / b,
    neg: (a) => -a,
    isZero: (a) => Math.abs(a) <= tol,
    num: (a) => a,
    score: (a) => Math.abs(a),
  };
}

/** Tolerance scaled to the size of the entries. */
export function tolFor(rows: number[][]): number {
  let m = 0;
  for (const r of rows) for (const x of r) m = Math.max(m, Math.abs(x));
  return 1e-9 * Math.max(1, m) * Math.max(1, rows.length);
}

/** Rational matrix, or null when some entry is not a (small-denominator) rational. */
export function toQMatrix(rows: number[][]): Q[][] | null {
  const out: Q[][] = [];
  for (const r of rows) {
    const qr: Q[] = [];
    for (const x of r) {
      const q = toFrac(x);
      if (!q) return null;
      qr.push(q);
    }
    out.push(qr);
  }
  return out;
}

/** Scale a rational vector by a positive factor so its entries are coprime integers. */
export function primitive(v: Q[]): Q[] {
  let l = 1n;
  for (const q of v) l = (l / bgcd(l, q.d)) * q.d;
  const ints = v.map((q) => (q.n * l) / q.d);
  let g = 0n;
  for (const x of ints) g = bgcd(g, x);
  if (g === 0n) return v;
  return ints.map((x) => ({ n: x / g, d: 1n }));
}