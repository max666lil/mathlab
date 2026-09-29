/** Installs the core math runtime and bundled plugins (math side only — no rendering). */
import { installCoreBuiltins } from './math-core/core-builtins';
import { installPlugin } from './plugins/plugin-api';
import { coreCalculusMath } from './plugins/core-calculus/math';
import { coreAnalysisMath } from './plugins/core-calculus/analysis-builtins';
import { linearAlgebraMath } from './plugins/linear-algebra/plugin';
import './plugins/core-calculus/analyzers';

export function installMathLab() {
  installCoreBuiltins();
  installPlugin(coreCalculusMath);
  installPlugin(coreAnalysisMath);
  installPlugin(linearAlgebraMath);
}
