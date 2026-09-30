/** Vector calculus plugin (math side). */
import { definePlugin } from '../plugin-api';
import { vectorCalculusBuiltins } from './math';
import { curveBuiltins, curveTangent } from './curves';
import { lineIntegralBuiltins, integrateAlong } from './integrals';
import { greenBuiltins, TheoremValue } from './green';
import { surfaceBuiltins, fluxThroughBuiltin, areaOfSurface } from './surfaces';
import { theoremBuiltins } from './theorems';
import { numberLatex } from '../../math-core/symbolic/print';
import { getBuiltin } from '../../math-core/builtins';

export const vectorCalculusMath = definePlugin({
  name: 'vector-calculus',
  install(api) {
    vectorCalculusBuiltins.forEach((b) => api.registerBuiltin(b));
    curveBuiltins.forEach((b) => api.registerBuiltin(b));
    const tangent = getBuiltin('tangent');
    if (tangent) api.registerBuiltin(curveTangent(tangent));
    lineIntegralBuiltins.forEach((b) => api.registerBuiltin(b));
    greenBuiltins.forEach((b) => api.registerBuiltin(b));
    surfaceBuiltins.forEach((b) => api.registerBuiltin(b));
    theoremBuiltins.forEach((b) => api.registerBuiltin(b));
    api.registerBuiltin({ ...theoremBuiltins[1], name: 'divergencetheorem', signature: 'divergencetheorem F on S' });
    api.registerBuiltin(fluxThroughBuiltin(getBuiltin('flux')!));
    api.registerBuiltin(areaOfSurface(getBuiltin('area')!));
    // a theorem check shows both sides and whether they agree
    api.registerValueKind({
      kind: 'theorem',
      latex: (v) => {
        const t = v as unknown as TheoremValue;
        return `\\begin{array}{l} ${t.lhsLatex} = ${numberLatex(t.lhs, 5)} \\\\ ${t.rhsLatex} = ${numberLatex(t.rhs, 5)} \\\\ \\text{${t.holds ? '✓ equal' : '✗ not equal'}} \\end{array}`;
      },
      typeLabel: (v) => `${(v as unknown as TheoremValue).name} check`,
    });
    const integ = getBuiltin('integrate');
    if (integ) api.registerBuiltin(integrateAlong(integ));
    api.registerLatexFunctionName('div', '\\nabla\\cdot');
    api.registerLatexFunctionName('curl', '\\nabla\\times');
    api.registerLatexFunctionName('laplacian', '\\nabla^{2}');
  },
});