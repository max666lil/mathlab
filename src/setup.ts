/** Installs the core math runtime and bundled plugins (math side only — no rendering). */
import { installCoreBuiltins } from './math-core/core-builtins';
import { installPlugin } from './plugins/plugin-api';
import { coreCalculusMath } from './plugins/core-calculus/math';
import { coreAnalysisMath } from './plugins/core-calculus/analysis-builtins';
import { linearAlgebraMath } from './plugins/linear-algebra/plugin';
import { vectorCalculusMath } from './plugins/vector-calculus/plugin';
import { graphingMath } from './plugins/core-calculus/graphing';
import { multivariableMath } from './plugins/multivariable/plugin';
import { scriptingMath } from './plugins/scripting/plugin';
import { statisticsMath } from './plugins/statistics/plugin';
import './plugins/core-calculus/analyzers';
import './plugins/linear-algebra/analyzers';
import './plugins/vector-calculus/analyzers';
import './plugins/multivariable/analyzers';
import './plugins/scripting/analyzers';
import './plugins/statistics/analyzers';

export function installMathLab() {
  installCoreBuiltins();
  installPlugin(coreCalculusMath);
  installPlugin(coreAnalysisMath);
  installPlugin(graphingMath);
  installPlugin(linearAlgebraMath);
  installPlugin(vectorCalculusMath);
  installPlugin(multivariableMath);
  installPlugin(scriptingMath);
  installPlugin(statisticsMath);
}
