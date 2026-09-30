/**
 * Exact rational numbers (BigInt fractions). Used to decide and carry exactness of matrices and
 * vectors: a double is treated as rational only if it is, to 1e-12, a fraction with denominator ≤ 10⁶.
 */

export interface Q {
  n: bigint;
  d: bigint;
}

const babs = (a: bigint) => (a < 0n ? -a : a);
export function bgcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export function frac(n: bigint, d: bigint = 1n): Q {
  if (d === 0n) throw new Error('division by zero');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = bgcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

/** Exact rational value of a double when it is (to 1e-12) a fraction with denominator ≤ 10⁶. */
export function toFrac(x: number): Q | null {
  if (!Number.isFinite(x)) return null;
  if (Number.isInteger(x)) return { n: BigInt(x), d: 1n };
  let h0 = 0, h1 = 1, k0 = 1, k1 = 0;
  let y = x;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(y);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > 1e6 || !Number.isSafeInteger(h2)) break;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    if (Math.abs(x - h1 / k1) <= 1e-12 * Math.max(1, Math.abs(x))) return frac(BigInt(h1), BigInt(k1));
    const f = y - a;
    if (f < 1e-15) break;
    y = 1 / f;
  }
  return null;
}

export const qNum = (q: Q) => Number(q.n) / Number(q.d);


/** Whether x is (to 1e-12) a fraction with denominator ≤ 10⁶. */
export const isRational = (x: number) => toFrac(x) !== null;
