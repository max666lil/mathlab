/** Linear algebra plugin (math side): operations, value kinds and the linear-system overload of solve. */
import { definePlugin } from '../plugin-api';
import { getBuiltin, Builtin, EvalError } from '../../math-core/builtins';
import { linearAlgebraBuiltins, expectMx, solveOf, vectorsOf, mxOf } from './builtins';
import { Expr, freeSymbols } from '../../math-core/ast';
import { diff } from '../../math-core/symbolic/diff';
import { simplify } from '../../math-core/symbolic/simplify';
import { EvalContext } from '../../math-core/builtins';
import { toFrac } from '../../math-core/rational';

/** A · vars = b when every equation is linear with rational coefficients in the free variables x, y, z. */
function linearSystemOf(eqs: Extract<Expr, { type: 'eq' }>[], ctx: EvalContext): { A: number[][]; b: number[]; vars: string[] } | null {
  const exprs = eqs.map((e): Expr => ({ type: 'bin', op: '-', left: e.left, right: e.right }));
  const vars = ['x', 'y', 'z'].filter((v) => exprs.some((e) => freeSymbols(e).has(v)) && !ctx.lookup(v));
  if (!vars.length || vars.length > 3) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (const e of exprs) {
    const row: number[] = [];
    for (const v of vars) {
      const d = simplify(diff(e, v));
      if (d.type !== 'num') return null;
      row.push(d.value);
    }
    const f = ctx.makeFunction(e, vars);
    const c = (f.eval as (...a: number[]) => number)(...vars.map(() => 0));
    if (![...row, c].every((x) => Number.isFinite(x) && toFrac(x))) return null;
    A.push(row);
    b.push(-c);
  }
  return { A, b, vars };
}
import './values';
import { registerCommandLatex, toLatex } from '../../math-core/symbolic/print';
import { transformationBuiltin, eigenVisual, subspaceVisual, affineVisual, factorizationVisual } from './visual-builtins';

export const linearAlgebraMath = definePlugin({
  name: 'linear-algebra',
  install(api) {
    linearAlgebraBuiltins.forEach((b) => api.registerBuiltin(b));
    api.registerBuiltin(transformationBuiltin);
    api.registerDefaultVisual('eigen', (v, ctx) => eigenVisual(v, ctx.name));
    api.registerDefaultVisual('subspace', (v, ctx) => subspaceVisual(v, ctx.name));
    api.registerDefaultVisual('affine', (v, ctx) => affineVisual(v, ctx.name));
    api.registerDefaultVisual('factorization', (v, ctx) => factorizationVisual(v, ctx.name));
    // solve(A, b): linear systems; every other form goes to the equation solver
    const eqSolve = getBuiltin('solve');
    if (eqSolve) {
      const solve: Builtin = {
        ...eqSolve,
        signature: `${eqSolve.signature}  |  solve(A, b)`,
        doc: `${eqSolve.doc} With a matrix A and a vector b: the solution set of A x = b.`,
        apply: (args, ctx, raw, kw) => {
          if (raw.length === 2 && raw[0].type !== 'eq' && raw[1].type !== 'eq') {
            let a;
            try {
              a = ctx.evaluate(raw[0]);
            } catch {
              a = undefined;
            }
            if (a?.kind === 'matrix') {
              const b = ctx.evaluate(raw[1]);
              if (b.kind !== 'vector' && b.kind !== 'point') throw new EvalError('solve(A, b): b must be a vector');
              return solveOf(expectMx(a), vectorsOf([b]).vs[0], b.certainty);
            }
          }
          // a linear system of equations (x + y = 3, 2x + 2y = 6): exact solution set, including lines and planes
          if (raw.length >= 2 && raw.every((e) => e.type === 'eq')) {
            const lin = linearSystemOf(raw as Extract<Expr, { type: 'eq' }>[], ctx);
            if (lin) {
              const s = solveOf(mxOf(lin.A, 'exact'), lin.b, 'exact');
              // a unique solution stays a point set (first(S), S[1]); lines / planes / no solution are solution sets
              if (s.consistent && !s.directions.length)
                return { kind: 'pointset', what: 'solutions', dim: lin.vars.length, points: [{ coords: s.particular! }], certainty: 'exact', evidence: 'linear system solved exactly (row reduction)' };
              return { ...s, variables: lin.vars };
            }
          }
          return eqSolve.apply(args, ctx, raw, kw);
        },
      };
      api.registerBuiltin(solve);
    }
    registerCommandLatex('project', (a, kw, raw) => `\\operatorname{proj}_{${kw.onto ?? (raw.args[1] ? toLatex(raw.args[1]) : 'W')}}\\,${a}`);
    registerCommandLatex('coords', (a, kw, raw) => `\\left[${a}\\right]_{${kw.in ?? (raw.args[1] ? toLatex(raw.args[1]) : 'B')}}`);
    api.registerLatexFunctionName('det', '\\det');
    api.registerLatexFunctionName('rank', '\\operatorname{rank}');
    api.registerLatexFunctionName('trace', '\\operatorname{tr}');
    api.registerLatexFunctionName('nullspace', '\\operatorname{Nul}');
    api.registerLatexFunctionName('columnspace', '\\operatorname{Col}');
    api.registerLatexFunctionName('rowspace', '\\operatorname{Row}');
    api.registerLatexFunctionName('span', '\\operatorname{span}');
    api.registerLatexFunctionName('dim', '\\dim');
  },
});