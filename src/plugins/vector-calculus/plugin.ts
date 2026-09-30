/** Vector calculus plugin (math side). */
import { definePlugin } from '../plugin-api';
import { vectorCalculusBuiltins } from './math';
import { curveBuiltins, curveTangent } from './curves';
import { lineIntegralBuiltins, integrateAlong } from './integrals';
import { getBuiltin } from '../../math-core/builtins';

export const vectorCalculusMath = definePlugin({
  name: 'vector-calculus',
  install(api) {
    vectorCalculusBuiltins.forEach((b) => api.registerBuiltin(b));
    curveBuiltins.forEach((b) => api.registerBuiltin(b));
    const tangent = getBuiltin('tangent');
    if (tangent) api.registerBuiltin(curveTangent(tangent));
    lineIntegralBuiltins.forEach((b) => api.registerBuiltin(b));
    const integ = getBuiltin('integrate');
    if (integ) api.registerBuiltin(integrateAlong(integ));
    api.registerLatexFunctionName('div', '\\nabla\\cdot');
    api.registerLatexFunctionName('curl', '\\nabla\\times');
    api.registerLatexFunctionName('laplacian', '\\nabla^{2}');
  },
});