/**
 * Polar coordinates and the gradient (Hughes-Hallett §16.4, §14.5): a function of (r, θ) is a scalar
 * field on the plane, so its gradient is written in the moving basis
 *
 *   e_r = (cos θ, sin θ)   (outward),   e_θ = (−sin θ, cos θ)   (around the circle),
 *   ∇f = f_r e_r + (1/r) f_θ e_θ,
 *
 * where 1/r appears because turning by dθ at radius r covers the distance ds = r dθ. The same
 * gradient in Cartesian components is f_r e_r + (1/r) f_θ e_θ expanded with e_r, e_θ above, and for
 * f(x, y) the polar form comes from x = r cos θ, y = r sin θ (x² + y² → r²). Nothing here is a second
 * formula set: polar values carry their Cartesian twin, and pictures are drawn in the xy-plane.
 */
import { Expr, num, sym, bin, mapExpr } from '../../math-core/ast';
import { Builtin, EvalContext, EvalError, expectCoords, expectFunction } from '../../math-core/builtins';
import { diff } from '../../math-core/symbolic/diff';
import { simplify, trigSimplify } from '../../math-core/symbolic/simplify';
import { toLatex, toText } from '../../math-core/symbolic/print';
import { FunctionValue, MathValue } from '../../math-core/values';
import { visual } from '../../visualization/scene-model';
import { fromCartesian } from '../multivariable/coords';
import { bindEnv } from './analysis-builtins';

const call = (name: string, ...args: Expr[]): Expr => ({ type: 'call', callee: sym(name), args });
const R = sym('r'), TH = sym('θ');

/** A scalar function of (r, θ): a field on the plane written in polar coordinates. */
export function isPolarField(v: MathValue | undefined): boolean {
  const f = v as FunctionValue;
  return v?.kind === 'function' && f.out === 'scalar' && f.params.length === 2 && f.params[0] === 'r' && f.params[1] === 'θ' && f.role !== 'polar';
}

const tidy = (e: Expr) => {
  const s = trigSimplify(simplify(e));
  return toText(s).length <= toText(simplify(e)).length ? s : simplify(e);
};

/** f(x, y) in polar coordinates (x² + y² → r², sin² + cos² = 1). */
export function polarForm(ctx: EvalContext, f: FunctionValue): FunctionValue {
  if (isPolarField(f)) return f;
  if (f.out !== 'scalar' || f.params.length !== 2 || !f.expr) throw new EvalError('polar form: a function f(x, y) given by a formula');
  const [x, y] = f.params;
  const e = mapExpr(bindEnv(f.expr, f.env), (n) => (n.type === 'sym' && n.name === x ? sym('x') : n.type === 'sym' && n.name === y ? sym('y') : n));
  const g = tidy(fromCartesian(e, 'polar'));
  return { ...ctx.makeFunction(g, ['r', 'θ'], { label: f.label }), certainty: 'exact', evidence: 'x = r cos θ, y = r sin θ substituted and simplified (x² + y² = r²)' } as FunctionValue;
}

/** f(r, θ) as a function of (x, y): r = √(x² + y²), θ = atan2(y, x). */
export function cartesianForm(ctx: EvalContext, f: FunctionValue): FunctionValue {
  if (!isPolarField(f) || !f.expr) throw new EvalError('cartesian: a function f(r, θ) given by a formula');
  // top-down, so sin θ / cos θ and even powers of r become plain x, y before r, θ are replaced
  const r2 = bin('+', bin('^', sym('x'), num(2)), bin('^', sym('y'), num(2)));
  const rr = call('sqrt', r2);
  const rewrite = (n: Expr): Expr => {
    if (n.type === 'call' && n.callee.type === 'sym' && n.args.length === 1 && n.args[0].type === 'sym' && n.args[0].name === 'θ') {
      if (n.callee.name === 'sin') return bin('/', sym('y'), rr);
      if (n.callee.name === 'cos') return bin('/', sym('x'), rr);
      if (n.callee.name === 'tan') return bin('/', sym('y'), sym('x'));
    }
    if (n.type === 'bin' && n.op === '^' && n.left.type === 'sym' && n.left.name === 'r' && n.right.type === 'num' && Number.isInteger(n.right.value) && n.right.value % 2 === 0)
      return n.right.value === 2 ? r2 : bin('^', r2, num(n.right.value / 2));
    if (n.type === 'sym') return n.name === 'r' ? rr : n.name === 'θ' ? call('atan2', sym('y'), sym('x')) : n;
    if (n.type === 'bin') return { ...n, left: rewrite(n.left), right: rewrite(n.right) };
    if (n.type === 'neg') return { ...n, arg: rewrite(n.arg) };
    if (n.type === 'call') return { ...n, args: n.args.map(rewrite) };
    return n;
  };
  const body = tidy(rewrite(bindEnv(f.expr, f.env)));
  return { ...ctx.makeFunction(body, ['x', 'y'], { label: f.label }), certainty: 'exact', evidence: 'r = √(x² + y²), cos θ = x/r, sin θ = y/r' } as FunctionValue;
}

export interface PolarGradient extends FunctionValue {
  /** components along e_r and e_θ */
  polar: { er: Expr; eth: Expr; fr: Expr; fth: Expr; radial: boolean };
  /** the same field in the xy-plane (for pictures and for comparison) */
  cartesianField: FunctionValue;
}

/** ∇f = f_r e_r + (1/r) f_θ e_θ for f(r, θ), with its Cartesian components. */
export function polarGradient(ctx: EvalContext, f: FunctionValue): PolarGradient {
  if (!isPolarField(f) || !f.expr) throw new EvalError('the polar gradient needs f(r, θ) given by a formula');
  const e = bindEnv(f.expr, f.env);
  const fr = tidy(diff(e, 'r'));
  const fth = tidy(diff(e, 'θ'));
  const eth = tidy(bin('/', fth, R));
  const radial = fth.type === 'num' && fth.value === 0;
  // Cartesian components: f_r (cos θ, sin θ) + (f_θ / r) (−sin θ, cos θ)
  const cx = tidy(bin('-', bin('*', fr, call('cos', TH)), bin('*', eth, call('sin', TH))));
  const cy = tidy(bin('+', bin('*', fr, call('sin', TH)), bin('*', eth, call('cos', TH))));
  const label = `\\nabla ${f.label ?? 'f'}`;
  const base = ctx.makeFunction({ type: 'vec', items: [fr, eth] }, ['r', 'θ'], { label, role: 'polar-gradient', base: f });
  const cxy = ctx.makeFunction({ type: 'vec', items: [cx, cy] }, ['r', 'θ']);
  const C = cxy.eval as (r: number, t: number) => number[];
  const cartesianField = {
    kind: 'function', params: ['x', 'y'], out: 'vector', env: {}, label, role: 'gradient', key: `pgradxy|${base.key}`,
    eval: (x: number, y: number) => C(Math.hypot(x, y), Math.atan2(y, x)),
  } as unknown as FunctionValue;
  const term = (c: Expr, v: string) => (c.type === 'num' && c.value === 0 ? '' : `${c.type === 'bin' && (c.op === '+' || c.op === '-') ? `\\left(${toLatex(c)}\\right)` : toLatex(c)}\\,\\mathbf{e}_{${v}}`);
  const polarTex = [term(fr, 'r'), term(eth, '\\theta')].filter(Boolean).join(' + ').replace(/\+ -/g, '- ') || '0';
  const display = `${label} = ${polarTex} = \\left\\langle ${toLatex(cx)},\\ ${toLatex(cy)} \\right\\rangle_{xy}`;
  return {
    ...base, display, certainty: 'exact',
    evidence: radial
      ? 'f depends on r only: ∇f = f′(r) e_r points straight out, perpendicular to the circular contours r = const'
      : '∇f = f_r e_r + (1/r) f_θ e_θ — turning by dθ at radius r covers ds = r dθ, so the rate per unit distance is f_θ / r',
    polar: { er: fr, eth, fr, fth, radial },
    cartesianField,
  } as PolarGradient;
}

/** grad f in polar for f(x, y): the polar form, then its gradient. */
export function gradInPolar(ctx: EvalContext, f: FunctionValue): PolarGradient {
  return polarGradient(ctx, polarForm(ctx, f));
}

// ------------------------------------------------------------------ the picture at a point

/** The moving basis at P and the two parts of ∇f along it (drawn in the xy-plane). */
export function polarView(ctx: EvalContext, f: FunctionValue, at?: number[]): MathValue {
  const polar = isPolarField(f);
  if (!polar && !(f.out === 'scalar' && f.params.length === 2)) throw new EvalError('polarview: a function of (x, y) or of (r, θ)');
  const [x0, y0] = at ?? [1.5 * Math.cos(Math.PI / 3), 1.5 * Math.sin(Math.PI / 3)];
  const r0 = Math.hypot(x0, y0);
  if (r0 < 1e-9) throw new EvalError('at the origin e_r and e_θ are not defined (θ has no value there)');
  const t0 = Math.atan2(y0, x0);
  const F = polar ? (x: number, y: number) => (f.eval as (r: number, t: number) => number)(Math.hypot(x, y), Math.atan2(y, x)) : (f.eval as (x: number, y: number) => number);
  // f_r and f_θ at P: derivatives along the ray and along the circle
  const h = 1e-5 * Math.max(1, r0);
  const at2 = (r: number, t: number) => F(r * Math.cos(t), r * Math.sin(t));
  const fr = (at2(r0 + h, t0) - at2(r0 - h, t0)) / (2 * h);
  const fth = (at2(r0, t0 + h / r0) - at2(r0, t0 - h / r0)) / ((2 * h) / r0);
  if (![fr, fth].every(Number.isFinite)) throw new EvalError('f is not differentiable at this point');
  return {
    ...visual('polarbasis', { fn: polar ? undefined : f, polarFn: polar ? f : undefined, at: [x0, y0], r: r0, theta: t0, fr, fth }, 'polar basis', 'polar'),
    certainty: 'numeric',
  } as unknown as MathValue;
}

// ------------------------------------------------------------------ builtins

export const polarBuiltins: Builtin[] = [
  {
    name: 'polarform', command: true, minArgs: 1, maxArgs: 1, argModes: ['value'], category: 'calculus', signature: 'polarform f',
    doc: 'f(x, y) rewritten in polar coordinates (x = r cos θ, y = r sin θ, simplified).',
    apply: ([f], ctx) => polarForm(ctx, expectFunction(f)),
  },
  {
    name: 'cartesian', command: true, minArgs: 1, maxArgs: 1, argModes: ['value'], category: 'calculus', signature: 'cartesian f',
    doc: 'f(r, θ) as a function of (x, y); for a polar gradient, its x and y components.',
    apply: ([f], ctx) => {
      const g = expectFunction(f) as Partial<PolarGradient> & FunctionValue;
      if (g.role === 'polar-gradient' && g.cartesianField) return g.cartesianField;
      return cartesianForm(ctx, g);
    },
  },
  {
    name: 'polarview', command: true, keywords: { at: 'value' }, minArgs: 1, maxArgs: 1, argModes: ['value'], category: 'calculus', signature: 'polarview f at P',
    doc: 'e_r, e_θ at P and ∇f split into f_r e_r + (1/r) f_θ e_θ, with the arc ds = r dθ.',
    apply: ([f], ctx, _raw, kw) => polarView(ctx, expectFunction(f), kw?.values.at ? expectCoords(kw.values.at) : undefined),
  },
];