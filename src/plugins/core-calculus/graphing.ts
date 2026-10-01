/**
 * Graphing-calculator layer (Desmos-like): implicit curves and regions, parametric and polar curves,
 * factorials, combinatorics and list statistics. Math side only; drawers live in draw-graphing.ts.
 */
import { definePlugin } from '../plugin-api';
import { Builtin, EvalError } from '../../math-core/builtins';
import { FunctionValue, MathValue, ListValue, ScalarValue, scalar } from '../../math-core/values';
import { registerScalarFunction } from '../../math-core/scalar-functions';
import { visual } from '../../visualization/scene-model';
import { registerFrameHint } from '../../visualization/sampling';
import { curveRange } from '../../math-core/ranges';
import { smoothnessBuiltin, SmoothnessValue } from './piecewise';

export interface RelationValue {
  kind: 'relation';
  rel: '=' | '<' | '>' | '<=' | '>=';
  /** lhs − rhs as a function of x, y */
  fn: FunctionValue;
  latex: string;
  key: string;
  [k: string]: unknown;
}

// ------------------------------------------------------------------ Γ, factorial, combinatorics

function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

export function factorial(n: number): number {
  if (Number.isInteger(n) && n >= 0) {
    if (n > 170) return Infinity;
    let r = 1;
    for (let k = 2; k <= n; k++) r *= k;
    return r;
  }
  return gamma(n + 1);
}

const choose = (n: number, k: number) => {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) return Number.isInteger(k) && k >= 0 && k <= n ? factorial(n) / (factorial(k) * factorial(n - k)) : 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
};
const gcd2 = (a: number, b: number): number => {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a;
};

registerScalarFunction({ name: 'factorial', arity: 1, fn: factorial, latex: '\\operatorname{fact}' });
registerScalarFunction({ name: 'gamma', arity: 1, fn: gamma, latex: '\\Gamma' });
registerScalarFunction({ name: 'nCr', arity: 2, fn: choose, latex: '\\operatorname{nCr}' });
registerScalarFunction({ name: 'nPr', arity: 2, fn: (n, k) => choose(n, k) * factorial(k), latex: '\\operatorname{nPr}' });
registerScalarFunction({ name: 'gcd', arity: [2, 16], fn: (...a) => a.reduce(gcd2), latex: '\\gcd' });
registerScalarFunction({ name: 'lcm', arity: [2, 16], fn: (...a) => a.reduce((x, y) => Math.abs(x * y) / (gcd2(x, y) || 1)), latex: '\\operatorname{lcm}' });

// ------------------------------------------------------------------ list statistics

function numbers(args: (MathValue | undefined)[]): number[] {
  const out: number[] = [];
  const add = (v: MathValue | undefined) => {
    if (!v) return;
    if (v.kind === 'scalar') out.push((v as ScalarValue).value);
    else if (v.kind === 'list') (v as ListValue).items.forEach(add);
    else throw new EvalError(`Expected numbers or a list, got ${v.kind}`);
  };
  args.forEach(add);
  if (!out.length) throw new EvalError('empty list');
  return out;
}
const stat = (name: string, doc: string, fn: (xs: number[]) => number): Builtin => ({
  name, minArgs: 1, maxArgs: 64, category: 'statistics', signature: `${name}([a, b, …])`, doc,
  apply: (args) => scalar(fn(numbers(args)), { certainty: 'exact' }),
});
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const variance = (xs: number[]) => (xs.length < 2 ? 0 : xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1));
const statBuiltins: Builtin[] = [
  stat('mean', 'Arithmetic mean.', mean),
  stat('median', 'Median.', (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }),
  stat('total', 'Sum of the entries.', (xs) => xs.reduce((s, x) => s + x, 0)),
  stat('count', 'Number of entries.', (xs) => xs.length),
  stat('var', 'Sample variance.', variance),
  stat('stdev', 'Sample standard deviation.', (xs) => Math.sqrt(variance(xs))),
];

// ------------------------------------------------------------------ curves

/** Parametric curves (x(t), y(t)[, z(t)]) and polar curves r(θ) are geometric objects. */
export function isCurve(v: MathValue): boolean {
  const f = v as FunctionValue;
  return v.kind === 'function' && f.params.length === 1 && ((f.out === 'vector' && (f.params[0] === 't' || f.params[0] === 's' || f.params[0] === 'θ')) || f.role === 'polar');
}

export const CURVE_RANGE: [number, number] = [0, 2 * Math.PI];

function curveExtent(fn: FunctionValue, polar: boolean): { r: number; dim: number } {
  const g = fn.eval as (t: number) => number | number[];
  const CURVE_RANGE = curveRange(fn);
  let m = 1;
  let dim = 2;
  for (let i = 0; i <= 200; i++) {
    const t = CURVE_RANGE[0] + ((CURVE_RANGE[1] - CURVE_RANGE[0]) * i) / 200;
    const v = g(t);
    const p = polar ? [(v as number) * Math.cos(t), (v as number) * Math.sin(t)] : (v as number[]);
    if (Array.isArray(p)) {
      dim = Math.max(dim, p.length);
      for (const c of p) if (Number.isFinite(c)) m = Math.max(m, Math.abs(c));
    }
  }
  return { r: Math.min(50, Math.max(3, Math.ceil(m * 1.2))), dim };
}
registerFrameHint('curve', (props) => curveExtent(props.fn as FunctionValue, !!props.polar));

export const graphingMath = definePlugin({
  name: 'graphing',
  install(api) {
    statBuiltins.forEach((b) => api.registerBuiltin(b));
    api.registerBuiltin(smoothnessBuiltin);
    api.registerValueKind({
      kind: 'smoothness',
      latex: (v) => `\\begin{array}{l} ${(v as unknown as SmoothnessValue).rows.join(' \\\\ ')} \\end{array}`,
      typeLabel: () => 'smoothness at a point',
    });
    api.registerValueKind({
      kind: 'relation',
      latex: (v) => (v as unknown as RelationValue).latex,
      typeLabel: (v) => ((v as unknown as RelationValue).rel === '=' ? 'implicit curve' : 'region'),
    });
    api.registerDefaultVisual('relation', (v, ctx) => {
      const r = v as unknown as RelationValue;
      return [visual(r.rel === '=' ? 'implicit' : 'region', { fn: r.fn, rel: r.rel }, ctx.name, r.rel === '=' ? 'implicit' : 'region')];
    });
  },
});