/**
 * Elementary real functions available inside expressions. The same table is used by the
 * compiler (numeric closures), the evaluator and constant folding in the simplifier.
 * Plugins may register more with `registerScalarFunction`.
 */

export interface ScalarFunction {
  name: string;
  arity: number | [number, number];
  fn: (...args: number[]) => number;
  latex?: string;
}

const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);

const table = new Map<string, ScalarFunction>();

export function registerScalarFunction(f: ScalarFunction) {
  table.set(f.name, f);
}
export function getScalarFunction(name: string): ScalarFunction | undefined {
  return table.get(name);
}
export function scalarFunctionNames(): string[] {
  return [...table.keys()];
}

const unary: [string, (x: number) => number, string?][] = [
  ['sin', Math.sin, '\\sin'],
  ['cos', Math.cos, '\\cos'],
  ['tan', Math.tan, '\\tan'],
  ['sec', (x) => 1 / Math.cos(x), '\\sec'],
  ['csc', (x) => 1 / Math.sin(x), '\\csc'],
  ['cot', (x) => 1 / Math.tan(x), '\\cot'],
  ['asin', Math.asin, '\\arcsin'],
  ['acos', Math.acos, '\\arccos'],
  ['atan', Math.atan, '\\arctan'],
  ['arcsin', Math.asin, '\\arcsin'],
  ['arccos', Math.acos, '\\arccos'],
  ['arctan', Math.atan, '\\arctan'],
  ['sinh', Math.sinh, '\\sinh'],
  ['cosh', Math.cosh, '\\cosh'],
  ['tanh', Math.tanh, '\\tanh'],
  ['exp', Math.exp],
  ['ln', Math.log, '\\ln'],
  ['log', Math.log, '\\log'],
  ['log10', Math.log10, '\\log_{10}'],
  ['log2', Math.log2, '\\log_{2}'],
  ['sqrt', Math.sqrt],
  ['cbrt', Math.cbrt],
  ['abs', Math.abs],
  ['sign', sign, '\\operatorname{sgn}'],
  ['floor', Math.floor],
  ['ceil', Math.ceil],
  ['round', Math.round],
];
for (const [name, fn, latex] of unary) registerScalarFunction({ name, arity: 1, fn, latex });

registerScalarFunction({ name: 'atan2', arity: 2, fn: Math.atan2, latex: '\\operatorname{atan2}' });
registerScalarFunction({ name: 'min', arity: [1, 16], fn: Math.min, latex: '\\min' });
registerScalarFunction({ name: 'max', arity: [1, 16], fn: Math.max, latex: '\\max' });
registerScalarFunction({ name: 'mod', arity: 2, fn: (a, b) => ((a % b) + b) % b, latex: '\\operatorname{mod}' });

/** Named constants. `e` and `π` may be shadowed by user definitions. */
export const CONSTANTS: Record<string, number> = {
  π: Math.PI,
  τ: 2 * Math.PI,
  e: Math.E,
};
