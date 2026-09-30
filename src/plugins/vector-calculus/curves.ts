/**
 * Parametric curves r(t) = (x(t), y(t)[, z(t)]): velocity, length, closedness and orientation, tangent,
 * curvature, osculating circle, area inside, and the moving-point picture. Integrals go through the
 * `integrate` builtin, so they are exact when an antiderivative exists and numeric otherwise.
 */
import { Builtin, EvalContext, EvalError, getBuiltin, expectNumber } from '../../math-core/builtins';
import { Expr } from '../../math-core/ast';
import { diff } from '../../math-core/symbolic/diff';
import { simplify } from '../../math-core/symbolic/simplify';
import { FunctionValue, MathValue, BoolValue, ScalarValue, scalar, vector } from '../../math-core/values';
import { curveRange } from '../../math-core/ranges';
import { visual } from '../../visualization/scene-model';

export function isCurveFn(v: MathValue | undefined): v is FunctionValue {
  const f = v as FunctionValue;
  return v?.kind === 'function' && f.params.length === 1 && f.out === 'vector' && !!f.expr && (f.expr.type === 'vec' || f.expr.type === 'tuple') && f.expr.items.length >= 2 && f.expr.items.length <= 3;
}

export function expectCurve(v: MathValue | undefined): FunctionValue {
  if (!isCurveFn(v)) throw new EvalError('Expected a curve C(t) = (x(t), y(t)[, z(t)])');
  return v;
}

const items = (f: FunctionValue) => (f.expr as Extract<Expr, { type: 'vec' }>).items;
const add = (a: Expr, b: Expr): Expr => ({ type: 'bin', op: '+', left: a, right: b });
const mul = (a: Expr, b: Expr): Expr => ({ type: 'bin', op: '*', left: a, right: b });
const sub = (a: Expr, b: Expr): Expr => ({ type: 'bin', op: '-', left: a, right: b });

/** r′(t) as expressions. */
export function velocityExprs(f: FunctionValue): Expr[] {
  return items(f).map((c) => simplify(diff(c, f.params[0])));
}

/** A scalar function of t built from an expression in the curve's parameter (env of the curve). */
export const inT = (ctx: EvalContext, f: FunctionValue, e: Expr, label?: string) => ctx.makeFunction(simplify(e), f.params, { env: f.env, label });

/** ∫ₐᵇ g(t) dt through the `integrate` builtin (exact via FTC when possible, numeric otherwise). */
export function integrateT(ctx: EvalContext, g: FunctionValue, a: number, b: number): ScalarValue {
  const integ = getBuiltin('integrate')!;
  return integ.apply([g, scalar(a), scalar(b)], ctx, [], { values: {}, raw: {} }) as ScalarValue;
}

export function lengthOf(ctx: EvalContext, f: FunctionValue): ScalarValue {
  const v = velocityExprs(f);
  const speed: Expr = { type: 'call', callee: { type: 'sym', name: 'sqrt' }, args: [v.map((c) => mul(c, c)).reduce(add)] };
  const [a, b] = curveRange(f);
  return integrateT(ctx, inT(ctx, f, speed), a, b);
}

function at(f: FunctionValue, t: number): number[] {
  return (f.eval as (t: number) => number[])(t);
}

/** Signed area ½∮ (x y′ − y x′) dt of a plane curve (positive = counter-clockwise). */
export function signedArea(ctx: EvalContext, f: FunctionValue): ScalarValue {
  const [x, y] = items(f);
  const [dx, dy] = velocityExprs(f);
  const [a, b] = curveRange(f);
  const r = integrateT(ctx, inT(ctx, f, mul({ type: 'num', value: 0.5 }, sub(mul(x, dy), mul(y, dx)))), a, b);
  return r;
}

export function closedOf(f: FunctionValue): boolean {
  const [a, b] = curveRange(f);
  const p = at(f, a);
  const q = at(f, b);
  const scale = Math.max(1, ...p.map(Math.abs));
  return p.every((c, i) => Math.abs(c - q[i]) < 1e-9 * scale);
}

/** Does the sampled plane curve cross itself (ignoring neighbouring segments and the closing point)? */
export function selfIntersecting(f: FunctionValue, n = 400): boolean {
  const [a, b] = curveRange(f);
  const P: number[][] = [];
  for (let i = 0; i <= n; i++) P.push(at(f, a + ((b - a) * i) / n));
  const cross = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [p1, p2, q1, q2] = [P[i], P[i + 1], P[j], P[j + 1]];
      const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2), d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2);
      if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
  return false;
}

function derivFns(ctx: EvalContext, f: FunctionValue) {
  const d1 = velocityExprs(f);
  const d2 = d1.map((c) => simplify(diff(c, f.params[0])));
  const vec = (es: Expr[]): Expr => ({ type: 'vec', items: es });
  return { d1: inT(ctx, f, vec(d1), `${f.label ?? 'r'}'`), d2: inT(ctx, f, vec(d2), `${f.label ?? 'r'}''`) };
}

export function curvatureAt(ctx: EvalContext, f: FunctionValue, t: number): { kappa: number; center?: number[]; signed?: number } {
  const { d1, d2 } = derivFns(ctx, f);
  const v = at(d1, t);
  const w = at(d2, t);
  const s = Math.hypot(...v);
  if (s < 1e-12) throw new EvalError('the curve stops at this parameter (r′ = 0): curvature undefined');
  if (v.length === 2) {
    const cr = v[0] * w[1] - v[1] * w[0];
    const k = cr / s ** 3;
    const p = at(f, t);
    const n = [-v[1] / s, v[0] / s];
    return { kappa: Math.abs(k), signed: k, center: Math.abs(k) > 1e-12 ? [p[0] + n[0] / k, p[1] + n[1] / k] : undefined };
  }
  const c = [v[1] * w[2] - v[2] * w[1], v[2] * w[0] - v[0] * w[2], v[0] * w[1] - v[1] * w[0]];
  return { kappa: Math.hypot(...c) / s ** 3 };
}

const nameOf = (raw: Expr[], k = 0, fb = 'C') => (raw[k]?.type === 'sym' ? (raw[k] as { name: string }).name : fb);

export const curveBuiltins: Builtin[] = [
  {
    name: 'velocity', prefix: true, minArgs: 1, maxArgs: 1, argModes: ['function'], category: 'curves', signature: 'velocity C', doc: "Velocity r′(t) of a curve.",
    apply: ([c], ctx) => ({ ...derivFns(ctx, expectCurve(c)).d1, certainty: 'exact', role: 'velocity' }),
  },
  {
    name: 'length', prefix: true, minArgs: 1, maxArgs: 1, argModes: ['value'], category: 'curves', signature: 'length C  ·  length v',
    doc: 'Arc length ∫|r′(t)| dt of a curve (exact when an antiderivative exists) — or the length of a vector.',
    apply: ([c], ctx) => {
      if (isCurveFn(c)) return { ...lengthOf(ctx, c), derivation: `L(${c.label ?? 'C'})` };
      const v = c as { comps?: number[]; coords?: number[] };
      const comps = v?.comps ?? v?.coords;
      if (!comps) throw new EvalError('length of a curve or a vector');
      return scalar(Math.hypot(...comps), { certainty: c?.certainty });
    },
  },
  {
    name: 'closed', prefix: true, minArgs: 1, maxArgs: 1, argModes: ['function'], category: 'curves', signature: 'closed C', doc: 'Whether the curve ends where it starts, and its orientation.',
    apply: ([c], ctx) => {
      const f = expectCurve(c);
      const [a, b] = curveRange(f);
      if (!closedOf(f)) return { kind: 'bool', value: false, reason: `r(${+a.toFixed(3)}) \\ne r(${+b.toFixed(3)})`, certainty: 'exact' } as BoolValue;
      if (items(f).length === 2) {
        // orientation is defined for simple closed curves; a figure-eight has none (its lobes cancel)
        if (selfIntersecting(f)) return { kind: 'bool', value: true, reason: '\\text{self-intersecting}', certainty: 'heuristic', evidence: 'crossing found between sampled segments' } as BoolValue;
        const A = signedArea(ctx, f).value;
        return { kind: 'bool', value: true, reason: `r(a) = r(b),\\ \\text{${A > 0 ? 'counter-clockwise' : 'clockwise'}}`, certainty: 'exact', orientation: Math.sign(A) } as BoolValue;
      }
      return { kind: 'bool', value: true, reason: 'r(a) = r(b)', certainty: 'exact' } as BoolValue;
    },
  },
  {
    name: 'area', prefix: true, minArgs: 1, maxArgs: 1, argModes: ['function'], category: 'curves', signature: 'area C', doc: 'Area enclosed by a closed plane curve (½∮ x dy − y dx).',
    apply: ([c], ctx) => {
      const f = expectCurve(c);
      if (items(f).length !== 2 || !closedOf(f)) throw new EvalError('area C needs a closed plane curve');
      if (selfIntersecting(f)) throw new EvalError('the curve crosses itself: the enclosed area is not a single region (½∮ x dy − y dx gives the signed sum of its lobes)');
      const A = signedArea(ctx, f);
      return { ...A, value: Math.abs(A.value), evidence: `${A.evidence ?? ''}; Green: A = ½∮ x dy − y dx`, derivation: `\\text{area inside } ${f.label ?? 'C'}` };
    },
  },
  {
    name: 'curvature', command: true, minArgs: 1, maxArgs: 2, argModes: ['function', 'value'], keywords: { at: 'value' }, category: 'curves', signature: 'curvature C at t0',
    doc: 'Curvature κ = |r′ × r″| / |r′|³ at a parameter value (with the osculating circle for plane curves).',
    apply: ([c, tv], ctx, raw, kw) => {
      const f = expectCurve(c);
      const t = expectNumber(kw.values.at ?? tv);
      const k = curvatureAt(ctx, f, t);
      const visuals = k.center ? [visual('osccircle', { center: k.center, radius: 1 / k.kappa }, 'osculating circle', 'curvature')] : [];
      return scalar(k.kappa, { certainty: 'exact', evidence: `κ = |r′×r″|/|r′|³ at t = ${+t.toFixed(4)}; radius of curvature ${k.kappa > 1e-12 ? (1 / k.kappa).toPrecision(4) : '∞'}`, visuals, derivation: `\\kappa_{${nameOf(raw)}}` });
    },
  },
  {
    name: 'motion', prefix: true, minArgs: 1, maxArgs: 1, argModes: ['function'], category: 'curves', signature: 'motion C', doc: 'A point moving along the curve with its velocity and acceleration (animated).',
    apply: ([c], ctx, raw) => {
      const f = expectCurve(c);
      const { d1, d2 } = derivFns(ctx, f);
      return visual('motion', { fn: f, d1, d2, range: curveRange(f), timeline: `flow:${nameOf(raw)}`, stops: [], loop: true, n: items(f).length }, 'motion', 'motion');
    },
  },
];

/** tangent C at t0: the unit tangent at r(t0) (curves); everything else goes to the calculus tangent. */
export function curveTangent(base: Builtin): Builtin {
  return {
    ...base,
    signature: `${base.signature}  ·  tangent C at t0`,
    apply: (args, ctx, raw, kw) => {
      const [c, tv] = args;
      if (!isCurveFn(c)) return base.apply(args, ctx, raw, kw);
      const t = expectNumber(kw.values.at ?? tv);
      const { d1 } = derivFns(ctx, c);
      const v = at(d1, t);
      const s = Math.hypot(...v);
      if (s < 1e-12) throw new EvalError('r′ = 0 here: no tangent direction');
      return vector(v.map((x) => x / s), at(c, t), { certainty: 'exact', role: 'tangent', derivation: `T(${+t.toFixed(3)})` });
    },
  };
}