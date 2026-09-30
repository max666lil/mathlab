/**
 * Iterated integration over a region description: inner integrals symbolically (antiderivative + FTC
 * with symbolic bounds) as far as possible, the rest by nested adaptive Gauss–Kronrod quadrature.
 */
import { Expr, num } from '../../math-core/ast';
import { simplify, addList, mulList } from '../../math-core/symbolic/simplify';
import { antiderivative } from '../../math-core/symbolic/integrate';
import { compileScalar } from '../../math-core/compile';
import { integrateNumeric } from '../../math-core/numeric/quad';
import { substitute } from './coords';
import type { Description, Level, Piece } from './region';

export interface IteratedResult {
  value: number;
  exact: boolean;
  error: number;
  /** symbolic inner integrals, innermost first (for the derivation) */
  steps: Expr[][];
}

const memo = new Map<string, Expr | null>();
function anti(e: Expr, v: string): Expr | null {
  const k = `${JSON.stringify(e)}|${v}`;
  if (!memo.has(k)) {
    let F: Expr | null = null;
    try {
      F = antiderivative(e, v);
    } catch {
      F = null;
    }
    memo.set(k, F);
    if (memo.size > 500) memo.delete(memo.keys().next().value!);
  }
  return memo.get(k)!;
}

function integratePiece(p: Piece, h: Expr, exactOnly = false): { value: number; exact: boolean; error: number; steps: Expr[] } | null {
  let e = simplify(h);
  const steps: Expr[] = [];
  let i = p.levels.length - 1;
  for (; i >= 0; i--) {
    const { v, lo, hi } = p.levels[i];
    if (lo.type === 'call' || hi.type === 'call') break; // max / min bounds: numeric
    const F = anti(e, v);
    if (!F) break;
    if (i === 0) {
      const Fn = compileScalar(F, [v]);
      const a = compileScalar(lo, [])();
      const b = compileScalar(hi, [])();
      const val = Fn(b) - Fn(a);
      if (Number.isFinite(val) && !Number.isNaN(Fn((a + b) / 2))) return { value: val, exact: true, error: 0, steps };
      break;
    }
    const next = simplify(addList([substitute(F, { [v]: hi }), mulList([num(-1), substitute(F, { [v]: lo })])]));
    // an inner result that is undefined somewhere inside the region means FTC does not apply
    if (!finiteOn(next, p.levels.slice(0, i))) break;
    e = next;
    steps.push(e);
  }
  if (exactOnly) return null;
  const q = nested(p.levels.slice(0, i + 1), e);
  if (!q.ok) throw new NumericIntegralError(q.value);
  return { value: q.value, error: q.error, exact: false, steps };
}

/** Spot-check that an expression is finite at interior points of the outer levels. */
function finiteOn(e: Expr, levels: Level[]): boolean {
  const vars = levels.map((l) => l.v);
  let f: (...a: number[]) => number;
  try {
    f = compileScalar(e, vars);
  } catch {
    return false;
  }
  const pick = (k: number, vals: number[], s: number): number[] | null => {
    if (k === levels.length) return vals;
    const a = compileScalar(levels[k].lo, vars.slice(0, k))(...vals);
    const b = compileScalar(levels[k].hi, vars.slice(0, k))(...vals);
    if (!(b > a)) return null;
    return pick(k + 1, [...vals, a + (b - a) * s], s);
  };
  for (const s of [0.13, 0.5, 0.87]) {
    const pt = pick(0, [], s);
    if (pt && !Number.isFinite(f(...pt))) return false;
  }
  return true;
}

/** Nested adaptive quadrature over the given (outer → inner) levels. */
function nested(levels: Level[], e: Expr): { value: number; error: number; ok: boolean } {
  const vars = levels.map((l) => l.v);
  const f = compileScalar(e, vars);
  const los = levels.map((l, k) => compileScalar(l.lo, vars.slice(0, k)));
  const his = levels.map((l, k) => compileScalar(l.hi, vars.slice(0, k)));
  const depth = levels.length;
  const tols = depth === 1 ? [1e-11] : depth === 2 ? [1e-9, 1e-10] : [1e-7, 1e-8, 1e-8];
  let ok = true;
  const rec = (k: number, vals: number[]): number => {
    if (k === depth) {
      const v = f(...vals);
      return Number.isFinite(v) ? v : 0;
    }
    const a = los[k](...vals);
    const b = his[k](...vals);
    if (!(b > a)) return 0;
    const q = integrateNumeric((t) => rec(k + 1, [...vals, t]), a, b, tols[k]);
    if (!q.ok && k === 0) ok = false;
    return q.value;
  };
  const top = integrateNumeric((t) => rec(1, [t]), los[0](), his[0](), tols[0]);
  const value = top.value;
  return { value, error: top.error + Math.abs(value) * (depth > 1 ? tols[1] * 10 : 0), ok: ok && top.ok };
}

export class NumericIntegralError extends Error {
  constructor(public value: number) {
    super('the integral diverges or does not converge numerically');
  }
}

/** The integral over the description; with `exactOnly`, null unless every piece integrates symbolically. */
export function integrateDescription(d: Description, integrand: Expr, exactOnly = false): IteratedResult | null {
  let value = 0;
  let error = 0;
  let exact = true;
  const steps: Expr[][] = [];
  for (const p of d.pieces) {
    if (exactOnly && p.approx) return null;
    const r = integratePiece(p, integrand, exactOnly);
    if (!r) return null;
    value += r.value;
    error += r.error;
    exact = exact && r.exact && !p.approx;
    steps.push(r.steps);
  }
  return { value, exact, error, steps };
}