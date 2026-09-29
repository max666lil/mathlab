/**
 * Registry of value-level operators (grad, normalize, slider, surface, ...). Scalar functions
 * such as sin/cos live in scalar-functions.ts; these builtins operate on typed MathValues.
 * Core registers a few here; the calculus plugin registers the rest through the plugin API.
 */
import { Expr } from './ast';
import { FunctionValue, MathValue } from './values';

export type ArgMode = 'value' | 'function' | 'raw';

export interface EvalContext {
  evaluate(e: Expr): MathValue;
  /** Named function, or an expression in x, y, z, t lifted to an anonymous function. */
  toFunction(e: Expr): FunctionValue;
  makeFunction(expr: Expr, params: string[], opts?: { label?: string; role?: string; base?: FunctionValue; env?: Record<string, number | number[]> }): FunctionValue;
  /** evaluate, lifting expressions in x, y, z, t to anonymous functions */
  evaluateOrLift(e: Expr): MathValue;
  lookup(name: string): MathValue | undefined;
}

/** Keyword clause values (command syntax), e.g. limit f as x -> 0 → { wrt: x, approach: 0 }. */
export interface KwArgs {
  values: Record<string, MathValue | undefined>;
  raw: Record<string, Expr>;
}

export interface Builtin {
  name: string;
  /** may be written without parentheses: critical f, limit f as x -> 0 */
  command?: boolean;
  /** keyword clauses accepted in command syntax and how their values are evaluated */
  keywords?: Record<string, ArgMode>;
  minArgs: number;
  maxArgs: number;
  /** Per-argument evaluation mode (default 'value'); the last entry repeats. */
  argModes?: ArgMode[];
  /** May be applied without parentheses: `grad f`. */
  prefix?: boolean;
  signature: string;
  doc: string;
  category: string;
  apply(args: (MathValue | undefined)[], ctx: EvalContext, raw: Expr[], kw: KwArgs): MathValue;
}

const builtins = new Map<string, Builtin>();

export function registerBuiltin(b: Builtin) {
  builtins.set(b.name, b);
}
export function getBuiltin(name: string): Builtin | undefined {
  return builtins.get(name);
}
export function allBuiltins(): Builtin[] {
  return [...builtins.values()];
}

export class EvalError extends Error {
  constructor(
    message: string,
    public span?: { from: number; to: number },
  ) {
    super(message);
  }
}

export function argMode(b: Builtin, i: number): ArgMode {
  const m = b.argModes;
  if (!m || m.length === 0) return 'value';
  return m[Math.min(i, m.length - 1)];
}

/** Helpers for builtin implementations. */
export function expectCoords(v: MathValue | undefined, what = 'a point'): number[] {
  if (v?.kind === 'point') return (v as { coords: number[] }).coords;
  if (v?.kind === 'vector') return (v as { comps: number[] }).comps;
  throw new EvalError(`Expected ${what}`);
}
export function expectVector(v: MathValue | undefined, what = 'a vector'): number[] {
  if (v?.kind === 'vector') return (v as { comps: number[] }).comps;
  if (v?.kind === 'point') return (v as { coords: number[] }).coords;
  throw new EvalError(`Expected ${what}`);
}
export function expectNumber(v: MathValue | undefined, what = 'a number'): number {
  if (v?.kind === 'scalar') return (v as { value: number }).value;
  throw new EvalError(`Expected ${what}`);
}
export function expectMatrix(v: MathValue | undefined): number[][] {
  if (v?.kind === 'matrix') return (v as { rows: number[][] }).rows;
  throw new EvalError('Expected a matrix');
}
export function expectFunction(v: MathValue | undefined): FunctionValue {
  if (v?.kind === 'function') return v as FunctionValue;
  throw new EvalError('Expected a function');
}
