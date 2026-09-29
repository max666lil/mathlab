/**
 * Plugin API. A plugin contributes mathematical primitives (builtins, scalar functions, value
 * kinds, syntax, derivative rules) and visual mappings; renderers pick up visual vtypes through
 * their own registries. Plugins never reach into the UI framework.
 *
 *   export default definePlugin({
 *     name: 'markov-chains',
 *     install(api) { api.registerBuiltin({...}); api.registerValueKind({...}); }
 *   });
 */
import { registerBuiltin, Builtin } from '../math-core/builtins';
import { registerScalarFunction, ScalarFunction } from '../math-core/scalar-functions';
import { registerValueKind, ValueKindSpec, MathValue, VisualValue } from '../math-core/values';
import { registerStatementRule, StatementRule } from '../parser/parser';
import { registerDerivativeRule } from '../math-core/symbolic/diff';
import { registerLatexFunctionName } from '../math-core/symbolic/print';
import { registerDefaultVisual, VisualContext } from '../visualization/scene-model';
import { Expr } from '../math-core/ast';

export interface PluginAPI {
  registerBuiltin(b: Builtin): void;
  registerScalarFunction(f: ScalarFunction): void;
  registerValueKind(k: ValueKindSpec): void;
  registerStatementRule(r: StatementRule): void;
  registerDerivativeRule(name: string, rule: (u: Expr) => Expr): void;
  registerLatexFunctionName(name: string, latex: string): void;
  registerDefaultVisual(kind: string, rule: (v: MathValue, ctx: VisualContext) => VisualValue[] | undefined): void;
}

export interface MathLabPlugin {
  name: string;
  install(api: PluginAPI): void;
}

export const definePlugin = (p: MathLabPlugin) => p;

const api: PluginAPI = {
  registerBuiltin,
  registerScalarFunction,
  registerValueKind,
  registerStatementRule,
  registerDerivativeRule,
  registerLatexFunctionName,
  registerDefaultVisual,
};

const installed = new Set<string>();
export function installPlugin(p: MathLabPlugin) {
  if (installed.has(p.name)) return;
  installed.add(p.name);
  p.install(api);
}
export function installedPlugins(): string[] {
  return [...installed];
}
