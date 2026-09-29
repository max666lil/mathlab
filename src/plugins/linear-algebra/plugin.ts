/** Linear algebra plugin (math side): operations, value kinds and the linear-system overload of solve. */
import { definePlugin } from '../plugin-api';
import { getBuiltin, Builtin, EvalError } from '../../math-core/builtins';
import { linearAlgebraBuiltins, expectMx, solveOf, vectorsOf } from './builtins';
import './values';
import { registerCommandLatex, toLatex } from '../../math-core/symbolic/print';
import { transformationBuiltin, eigenVisual, subspaceVisual, affineVisual } from './visual-builtins';

export const linearAlgebraMath = definePlugin({
  name: 'linear-algebra',
  install(api) {
    linearAlgebraBuiltins.forEach((b) => api.registerBuiltin(b));
    api.registerBuiltin(transformationBuiltin);
    api.registerDefaultVisual('eigen', (v, ctx) => eigenVisual(v, ctx.name));
    api.registerDefaultVisual('subspace', (v, ctx) => subspaceVisual(v, ctx.name));
    api.registerDefaultVisual('affine', (v, ctx) => affineVisual(v, ctx.name));
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