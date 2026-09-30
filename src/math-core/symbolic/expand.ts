/** Expansion of products / integer powers, and polynomial coefficient extraction. */
import { Expr, num, dependsOn } from '../ast';
import { simplify, addList, mulList } from './simplify';

function terms(e: Expr): Expr[] {
  if (e.type === 'bin' && e.op === '+') return [...terms(e.left), ...terms(e.right)];
  return [e];
}
function factors(e: Expr): Expr[] {
  if (e.type === 'bin' && e.op === '*') return [...factors(e.left), ...factors(e.right)];
  return [e];
}

/** Distribute products over sums and expand small positive integer powers of sums. */
export function expand(e: Expr): Expr {
  const s = simplify(e);
  const ex = (x: Expr): Expr => {
    if (x.type === 'bin' && x.op === '+') return addList(terms(x).map(ex));
    if (x.type === 'bin' && x.op === '^' && x.right.type === 'num' && Number.isInteger(x.right.value) && x.right.value > 1 && x.right.value <= 8) {
      const base = ex(x.left);
      if (terms(base).length > 1) {
        let acc: Expr = base;
        for (let i = 1; i < x.right.value; i++) acc = mulOut(acc, base);
        return acc;
      }
      return x;
    }
    if (x.type === 'bin' && x.op === '*') {
      const fs = factors(x).map(ex);
      return fs.reduce((a, b) => mulOut(a, b));
    }
    return x;
  };
  return simplify(ex(s));
}

function mulOut(a: Expr, b: Expr): Expr {
  const ta = terms(a);
  const tb = terms(b);
  if (ta.length === 1 && tb.length === 1) return mulList([a, b]);
  return addList(ta.flatMap((x) => tb.map((y) => mulList([x, y]))));
}

/**
 * Coefficients [c0, c1, …] if e is a polynomial in v with numeric coefficients, else null.
 */
export function polyCoeffs(e: Expr, v: string): number[] | null {
  const ex = expand(e);
  const coeffs: number[] = [];
  for (const t of terms(ex)) {
    let c = 1;
    let k = 0;
    for (const f of factors(t)) {
      if (f.type === 'num') c *= f.value;
      else if (f.type === 'sym' && f.name === v) k += 1;
      else if (f.type === 'bin' && f.op === '^' && f.left.type === 'sym' && f.left.name === v && f.right.type === 'num' && Number.isInteger(f.right.value) && f.right.value >= 0) k += f.right.value;
      else if (!dependsOn(f, v)) return null; // symbolic coefficient: not handled here
      else return null;
    }
    coeffs[k] = (coeffs[k] ?? 0) + c;
  }
  for (let i = 0; i < coeffs.length; i++) coeffs[i] = coeffs[i] ?? 0;
  while (coeffs.length > 1 && Math.abs(coeffs[coeffs.length - 1]) < 1e-15) coeffs.pop();
  return coeffs.length ? coeffs : [0];
}

/**
 * Coefficients [c0, c1, …] of e as a polynomial in v whose coefficients are expressions in the other
 * symbols (a² sin²θ …), or null when v also appears in a non-polynomial position.
 */
export function polyCoeffsExpr(e: Expr, v: string): Expr[] | null {
  const buckets: Expr[][] = [];
  for (const t of terms(expand(e))) {
    let k = 0;
    const rest: Expr[] = [];
    for (const f of factors(t)) {
      if (f.type === 'sym' && f.name === v) k += 1;
      else if (f.type === 'bin' && f.op === '^' && f.left.type === 'sym' && f.left.name === v && f.right.type === 'num' && Number.isInteger(f.right.value) && f.right.value >= 0) k += f.right.value;
      else if (dependsOn(f, v)) return null;
      else rest.push(f);
    }
    (buckets[k] ??= []).push(rest.length ? mulList(rest) : num(1));
  }
  const out: Expr[] = [];
  for (let i = 0; i < buckets.length; i++) out.push(buckets[i] ? addList(buckets[i]) : num(0));
  while (out.length > 1 && out[out.length - 1].type === 'num' && (out[out.length - 1] as { value: number }).value === 0) out.pop();
  return out.length ? out : [num(0)];
}

/** Exact real roots of a polynomial of degree ≤ 2 (null for higher degree). */
export function quadraticRoots(c: number[]): number[] | null {
  if (c.length > 3) return null;
  const [c0 = 0, c1 = 0, c2 = 0] = c;
  if (c.length <= 1) return c0 === 0 ? null : [];
  if (c.length === 2 || c2 === 0) return c1 === 0 ? [] : [-c0 / c1];
  const d = c1 * c1 - 4 * c2 * c0;
  if (d < 0) return [];
  if (d === 0) return [-c1 / (2 * c2)];
  const s = Math.sqrt(d);
  return [(-c1 - s) / (2 * c2), (-c1 + s) / (2 * c2)].sort((a, b) => a - b);
}

export { num };