/**
 * Line integrals: work ∫ F·dr, circulation ∮ F·dr, flux across a plane curve ∮ F·n ds and ∫ f ds.
 * Everything is pulled back to the curve's parameter and integrated with the `integrate` builtin
 * (exact when an antiderivative exists, numeric otherwise). Results carry the accumulation picture.
 */
import { Builtin, EvalContext, EvalError, getBuiltin } from '../../math-core/builtins';
import { Expr, mapExpr } from '../../math-core/ast';
import { FunctionValue, ScalarValue } from '../../math-core/values';
import { curveRange } from '../../math-core/ranges';
import { visual } from '../../visualization/scene-model';
import { isField, comps } from './math';
import { isCurveFn, expectCurve, velocityExprs, integrateT, closedOf } from './curves';

const add = (a: Expr, b: Expr): Expr => ({ type: 'bin', op: '+', left: a, right: b });
const mul = (a: Expr, b: Expr): Expr => ({ type: 'bin', op: '*', left: a, right: b });
const sub = (a: Expr, b: Expr): Expr => ({ type: 'bin', op: '-', left: a, right: b });

const curveItems = (C: FunctionValue) => (C.expr as Extract<Expr, { type: 'vec' }>).items;

/** Substitute the curve into an expression in the field's variables: g(x, y) → g(x(t), y(t)). */
function pull(e: Expr, vars: string[], C: FunctionValue): Expr {
  const s = new Map(vars.map((v, i) => [v, curveItems(C)[i]]));
  return mapExpr(e, (n) => (n.type === 'sym' && s.has(n.name) ? s.get(n.name)! : n));
}

export type LineKind = 'work' | 'flux' | 'scalar';

/** The integrand in t and the integral, plus the accumulation visual. */
export function lineIntegral(ctx: EvalContext, what: FunctionValue, C: FunctionValue, kind: LineKind, names: { F: string; C: string }): ScalarValue {
  const n = curveItems(C).length;
  const dr = velocityExprs(C);
  let integrand: Expr;
  if (kind === 'scalar') {
    if (what.out !== 'scalar' || what.params.length !== n) throw new EvalError(`∫ f ds needs f with ${n} variables`);
    const speed: Expr = { type: 'call', callee: { type: 'sym', name: 'sqrt' }, args: [dr.map((c) => mul(c, c)).reduce(add)] };
    integrand = mul(pull(what.expr!, what.params, C), speed);
  } else {
    if (!isField(what) || what.params.length !== n) throw new EvalError(`${names.F} must be a vector field in ${n} variables, like the curve`);
    const Fc = comps(what).map((c) => pull(c, what.params, C));
    if (kind === 'work') integrand = Fc.map((c, i) => mul(c, dr[i])).reduce(add);
    else {
      if (n !== 2) throw new EvalError('flux across a curve is for plane curves (use flux F through S for surfaces)');
      integrand = sub(mul(Fc[0], dr[1]), mul(Fc[1], dr[0])); // F · n ds with n = (y′, −x′)
    }
  }
  const g = ctx.makeFunction(integrand, C.params, { env: { ...what.env, ...C.env } });
  const [a, b] = curveRange(C);
  const r = integrateT(ctx, g, a, b);
  const label = kind === 'work' ? (closedOf(C) ? `\\oint_{${names.C}} ${names.F}\\cdot d\\mathbf{r}` : `\\int_{${names.C}} ${names.F}\\cdot d\\mathbf{r}`) : kind === 'flux' ? `\\oint_{${names.C}} ${names.F}\\cdot\\mathbf{n}\\,ds` : `\\int_{${names.C}} ${names.F}\\,ds`;
  return {
    ...r,
    derivation: label,
    role: 'lineintegral',
    visuals: [visual('lineintegral', { field: what, curve: C, g, range: [a, b], kind, total: r.value, timeline: `flow:${names.C}`, stops: [], loop: true, n }, 'line integral', 'lineintegral')],
  };
}

const nameOf = (e: Expr | undefined, fb: string) => (e?.type === 'sym' ? e.name : fb);
const V = 'value' as const;

function lineBuiltin(name: string, kind: LineKind, key: 'toward' | 'around' | 'across', signature: string, doc: string, needClosed = false): Builtin {
  return {
    name, command: true, minArgs: 1, maxArgs: 2, argModes: ['function', V], keywords: { [key]: V }, category: 'vector calculus', signature, doc,
    apply: ([F, c], ctx, raw, kw) => {
      const C = expectCurve(kw.values[key] ?? c);
      if (needClosed && !closedOf(C)) throw new EvalError(`${nameOf(kw.raw[key] ?? raw[1], 'C')} is not closed — use work F along C`);
      return lineIntegral(ctx, F as FunctionValue, C, kind, { F: nameOf(raw[0], 'F'), C: nameOf(kw.raw[key] ?? raw[1], 'C') });
    },
  };
}

export const lineIntegralBuiltins: Builtin[] = [
  lineBuiltin('work', 'work', 'toward', 'work F along C', 'Work ∫_C F·dr along a curve (exact when possible).'),
  lineBuiltin('circulation', 'work', 'around', 'circulation F around C', 'Circulation ∮_C F·dr around a closed curve.', true),
  lineBuiltin('flux', 'flux', 'across', 'flux F across C', 'Outward flux ∮_C F·n ds across a closed plane curve (counter-clockwise).'),
];

/** integrate F along C / integrate f along C; everything else is the ordinary integrate. */
export function integrateAlong(base: Builtin): Builtin {
  return {
    ...base,
    keywords: { ...(base.keywords ?? {}), toward: V, inside: V },
    signature: `${base.signature}  ·  integrate F along C  ·  integrate f inside C`,
    apply: (args, ctx, raw, kw) => {
      if (kw.values.inside) return getBuiltin('integrateinside')!.apply([args[0], kw.values.inside], ctx, raw, kw);
      const c = kw.values.toward;
      if (!c) return base.apply(args, ctx, raw, kw);
      if (!isCurveFn(c)) throw new EvalError('integrate … along C needs a curve C(t) = (…)');
      const f = args[0] as FunctionValue;
      return lineIntegral(ctx, f, c, isField(f) ? 'work' : 'scalar', { F: nameOf(raw[0], 'f'), C: nameOf(kw.raw.toward, 'C') });
    },
  };
}
