/** Linear algebra plugin (math side): operations, value kinds and the linear-system overload of solve. */
import { definePlugin } from '../plugin-api';
import { getBuiltin, Builtin, EvalError } from '../../math-core/builtins';
import { linearAlgebraBuiltins, expectMx, solveOf, vectorsOf } from './builtins';
import './values';

export const linearAlgebraMath = definePlugin({
  name: 'linear-algebra',
  install(api) {
    linearAlgebraBuiltins.forEach((b) => api.registerBuiltin(b));
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