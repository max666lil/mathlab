/** Vector calculus plugin (math side). */
import { definePlugin } from '../plugin-api';
import { vectorCalculusBuiltins } from './math';

export const vectorCalculusMath = definePlugin({
  name: 'vector-calculus',
  install(api) {
    vectorCalculusBuiltins.forEach((b) => api.registerBuiltin(b));
    api.registerLatexFunctionName('div', '\\nabla\\cdot');
    api.registerLatexFunctionName('curl', '\\nabla\\times');
    api.registerLatexFunctionName('laplacian', '\\nabla^{2}');
  },
});