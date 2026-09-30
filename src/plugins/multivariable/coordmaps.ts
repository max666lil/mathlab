/**
 * Coordinate maps T(u, v) = (x, y) and T(u, v, w) = (x, y, z) (Hughes-Hallett §21.1–21.2): the
 * Jacobian matrix-valued function, its determinant (the local area / volume scale), and the picture of
 * the (u, v) grid bending into the curved (x, y) grid.
 */
import { Expr, num } from '../../math-core/ast';
import { Builtin, EvalError } from '../../math-core/builtins';
import { FunctionValue, MathValue } from '../../math-core/values';
import { simplify, addList, mulList, trigSimplify } from '../../math-core/symbolic/simplify';
import { diff } from '../../math-core/symbolic/diff';
import { visual } from '../../visualization/scene-model';
import { bindEnv } from '../core-calculus/analysis-builtins';

/** A tuple-bodied map with as many components as parameters (2 or 3). */
export function isCoordMap(v: MathValue | undefined): v is FunctionValue {
  const f = v as FunctionValue;
  return v?.kind === 'function' && f.out === 'vector' && !!f.expr && f.expr.type === 'tuple' && f.expr.items.length === f.params.length && (f.params.length === 2 || f.params.length === 3);
}

/** Symbolic determinant by cofactor expansion (small matrices). */
export function detExpr(m: Expr[][]): Expr {
  const n = m.length;
  if (n === 1) return m[0][0];
  if (n === 2) return simplify(addList([mulList([m[0][0], m[1][1]]), mulList([num(-1), m[0][1], m[1][0]])]));
  const terms: Expr[] = [];
  for (let j = 0; j < n; j++) {
    const minor = m.slice(1).map((row) => row.filter((_, k) => k !== j));
    terms.push(mulList([num(j % 2 ? -1 : 1), m[0][j], detExpr(minor)]));
  }
  return simplify(addList(terms));
}

export function jacobianRows(f: FunctionValue): Expr[][] {
  const items = (f.expr as Extract<Expr, { type: 'tuple' }>).items.map((e) => bindEnv(e, f.env));
  return items.map((e) => f.params.map((p) => simplify(diff(e, p))));
}

/** det of a matrix-valued function (J_T) as a scalar function, simplified with sin² + cos² = 1. */
export function detOfFunction(ctx: { makeFunction: (e: Expr, p: string[], o?: { label?: string; role?: string; env?: Record<string, number | number[]> }) => FunctionValue }, M: FunctionValue): FunctionValue {
  if (!M.expr || M.expr.type !== 'matrix') throw new EvalError('det needs a matrix');
  const rows = M.expr.rows.map((r) => r.map((e) => bindEnv(e, M.env)));
  if (rows.some((r) => r.length !== rows.length)) throw new EvalError('det needs a square matrix');
  const d = trigSimplify(detExpr(rows));
  return { ...ctx.makeFunction(d, M.params, { label: `\\det ${M.label ?? 'J'}`, role: 'jacobian-det' }), certainty: 'exact', evidence: 'cofactor expansion of the symbolic matrix; sin² + cos² = 1' } as FunctionValue;
}

/** Wraps det so that it also takes matrix-valued functions (det J_T = r). */
export function detOfFunctions(base: Builtin): Builtin {
  return {
    ...base,
    argModes: ['value'],
    apply: (args, ctx, raw, kw) => {
      const a = args[0] as FunctionValue | undefined;
      if (a?.kind === 'function' && a.out === 'matrix') return detOfFunction(ctx, a) as unknown as MathValue;
      return base.apply(args, ctx, raw, kw);
    },
  };
}

/** Default parameter rectangle for the grid picture. */
export function mapRanges(f: FunctionValue): [number, number][] {
  return f.params.map((p) => {
    const given = f.ranges?.[p];
    if (given) return given;
    if (p === 'r' || p === 'ρ') return [0, 2];
    if (p === 'θ') return [0, 2 * Math.PI];
    if (p === 'φ') return [0, Math.PI];
    return [-1, 1];
  });
}

export const coordGrid: Builtin = {
  name: 'coordgrid', command: true, minArgs: 1, maxArgs: 1, argModes: ['value'], category: 'multivariable',
  signature: 'coordgrid T', doc: 'The (u, v) grid morphing into its image under a plane map T, with one cell and its area |det J| Δu Δv.',
  apply: ([tv], _ctx, raw) => {
    if (!isCoordMap(tv) || tv.params.length !== 2) throw new EvalError('coordgrid needs a plane map T(u, v) = (x, y)');
    const name = raw[0]?.type === 'sym' ? raw[0].name : 'T';
    return visual('coordmap', { fn: tv, ranges: mapRanges(tv), timeline: `coordmap:${name}`, stops: [`(${tv.params.join(', ')})`, `${name}(${tv.params.join(', ')})`], stages: tv.key, captions: [`cell areas × |det J|`] }, `grid of ${name}`, 'coordmap');
  },
};