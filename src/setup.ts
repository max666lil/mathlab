/** Installs the core math runtime and bundled plugins (math side only — no rendering). */
import { installCoreBuiltins } from './math-core/core-builtins';
import { installPlugin } from './plugins/plugin-api';
import { coreCalculusMath } from './plugins/core-calculus/math';

export function installMathLab() {
  installCoreBuiltins();
  installPlugin(coreCalculusMath);
}
