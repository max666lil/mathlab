/**
 * Core calculus plugin (math side): differential operators on scalar fields and the visual
 * constructors of the gradient/tangent-plane laboratory. Every operator here works for any
 * differentiable scalar field — nothing is specific to a particular example.
 */
import { Expr, num, sym, add, sub, mul } from '../../math-core/ast';
import { Builtin, EvalContext, EvalError, expectCoords, expectFunction, expectNumber, expectVector } from '../../math-core/builtins';
import { diff, gradient, hessian, NotDifferentiableError } from '../../math-core/symbolic/diff';
import { simplify } from '../../math-core/symbolic/simplify';
import { numericGradient, numericHessian } from '../../math-core/numeric';
import { dot, normalize, norm, symmetricEigen } from '../../math-core/linalg';
import { numberLatex, symbolLatex } from '../../math-core/symbolic/print';
import { FunctionValue, MathValue, PlaneValue, SliceValue, scalar } from '../../math-core/values';
import { visual } from '../../visualization/scene-model';
import { definePlugin } from '../plugin-api';

type Scalar = (...x: number[]) => number;

const L = (x: number) => numberLatex(x, 3);

export function asScalarField(f: FunctionValue, what = 'a scalar field'): FunctionValue {
  if (f.out !== 'scalar') throw new EvalError(`Expected ${what} (a real-valued function)`);
  return f;
}

// ------------------------------------------------------------------ derived-function caches

const cache = new Map<string, FunctionValue>();
function cached(key: string, make: () => FunctionValue): FunctionValue {
  let v = cache.get(key);
  if (!v) {
    v = make();
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    cache.set(key, v);
  }
  return v;
}

export function gradOf(ctx: EvalContext, f: FunctionValue): FunctionValue {
  asScalarField(f);
  return cached(`grad|${f.key}`, () => {
    const label = `\nabla ${f.label ?? 'f'}`;
    if (f.expr) {
      try {
        return ctx.makeFunction(gradient(f.expr, f.params), f.params, { label, role: 'gradient', base: f, env: f.env });
      } catch (e) {
        if (!(e instanceof NotDifferentiableError)) throw e;
      }
    }
    const fn = f.eval as Scalar;
    return { kind: 'function', params: f.params, env: f.env, out: 'vector', eval: (...p: number[]) => numericGradient(fn, p), label, role: 'gradient', base: f, key: `ngrad|${f.key}` };
  });
}

export function hessianOf(ctx: EvalContext, f: FunctionValue): FunctionValue {
  asScalarField(f);
  return cached(`hess|${f.key}`, () => {
    const label = `H_{${f.label ?? 'f'}}`;
    if (f.expr) {
      try {
        return ctx.makeFunction(hessian(f.expr, f.params), f.params, { label, role: 'hessian', base: f, env: f.env });
      } catch (e) {
        if (!(e instanceof NotDifferentiableError)) throw e;
      }
    }
    const fn = f.eval as Scalar;
    return { kind: 'function', params: f.params, env: f.env, out: 'matrix', eval: (...p: number[]) => numericHessian(fn, p), label, role: 'hessian', base: f, key: `nhess|${f.key}` };
  });
}

/** f(p), ∇f(p), H(p) at a point — the numbers behind every local visual. */
export interface LocalData {
  p: number[];
  f0: number;
  g: number[];
  H: number[][];
}
export function localData(ctx: EvalContext, f: FunctionValue, p: number[]): LocalData {
  if (p.length !== f.params.length) throw new EvalError(`${f.label ?? 'f'} takes ${f.params.length} inputs, the point has ${p.length}`);
  return {
    p,
    f0: (f.eval as Scalar)(...p),
    g: gradOf(ctx, f).eval(...p) as number[],
    H: hessianOf(ctx, f).eval(...p) as number[][],
  };
}

/** Second-order Taylor polynomial of f at p as a symbolic function of f's variables. */
export function taylorExpr(d: LocalData, params: string[], order: 1 | 2): Expr {
  const delta = params.map((v, i) => sub(sym(v), num(d.p[i])));
  let e: Expr = num(d.f0);
  params.forEach((_, i) => (e = add(e, mul(num(d.g[i]), delta[i]))));
  if (order === 2)
    params.forEach((_, i) =>
      params.forEach((__, j) => {
        if (j < i) return;
        const c = (i === j ? 0.5 : 1) * d.H[i][j];
        e = add(e, mul(num(c), mul(delta[i], delta[j])));
      }),
    );
  return simplify(e);
}

// ------------------------------------------------------------------ builtins

const F = 'function' as const;
const V = 'value' as const;
const RAW = 'raw' as const;

function pointArg(v: MathValue | undefined, f: FunctionValue): number[] {
  const p = expectCoords(v, 'a point');
  if (p.length !== f.params.length) throw new EvalError(`Point has ${p.length} coordinates but ${f.label ?? 'f'} has ${f.params.length} variables`);
  return p;
}

function sgn(x: number) {
  return x < 0 ? '-' : '+';
}

function rangeArg(v: MathValue | undefined): [number, number] | undefined {
  if (!v) return undefined;
  if (v.kind === 'list') {
    const items = (v as { items: MathValue[] }).items.map((it) => expectNumber(it));
    if (items.length === 2 && items[0] < items[1]) return [items[0], items[1]];
  }
  throw new EvalError('Expected an interval [a, b]');
}

const calculus: Builtin[] = [
  {
    name: 'grad', minArgs: 1, maxArgs: 1, argModes: [F], prefix: true, category: 'calculus',
    signature: 'grad(f)', doc: 'Gradient ∇f — a vector field. Evaluate with `grad(f) at P`.',
    apply: ([f], ctx) => gradOf(ctx, expectFunction(f)),
  },
  {
    name: 'hessian', minArgs: 1, maxArgs: 1, argModes: [F], prefix: true, category: 'calculus',
    signature: 'hessian(f)', doc: 'Hessian matrix of second partial derivatives. Evaluate with `hessian(f) at P`.',
    apply: ([f], ctx) => hessianOf(ctx, expectFunction(f)),
  },
  {
    name: 'partial', minArgs: 2, maxArgs: 2, argModes: [F, RAW], category: 'calculus',
    signature: 'partial(f, x)', doc: 'Partial derivative ∂f/∂x.',
    apply: ([fv], ctx, raw) => {
      const f = asScalarField(expectFunction(fv));
      const v = raw[1];
      if (v.type !== 'sym' || !f.params.includes(v.name)) throw new EvalError(`Second argument must be one of ${f.params.join(', ')}`);
      if (!f.expr) throw new EvalError('No symbolic form to differentiate');
      return ctx.makeFunction(diff(f.expr, v.name), f.params, { label: `\partial_{${symbolLatex(v.name)}} ${f.label ?? 'f'}`, base: f, env: f.env });
    },
  },
  {
    name: 'dirderiv', minArgs: 3, maxArgs: 3, argModes: [F, V, V], category: 'calculus',
    signature: 'dirderiv(f, P, u)', doc: 'Directional derivative D_û f(P) = ∇f(P) · û.',
    apply: ([fv, P, u], ctx) => {
      const f = asScalarField(expectFunction(fv));
      const d = localData(ctx, f, pointArg(P, f));
      return scalar(dot(d.g, normalize(expectVector(u))), { derivation: `D_{\hat u} ${f.label ?? 'f'}` });
    },
  },
  {
    name: 'tangent_plane', minArgs: 2, maxArgs: 2, argModes: [F, V], category: 'calculus',
    signature: 'tangent_plane(f, P)', doc: 'Tangent plane to z = f(x, y) at P.',
    apply: ([fv, P], ctx) => {
      const f = asScalarField(expectFunction(fv));
      if (f.params.length !== 2) throw new EvalError('tangent_plane needs a function of two variables');
      const d = localData(ctx, f, pointArg(P, f));
      const [x0, y0] = d.p;
      const plane: PlaneValue = {
        kind: 'plane',
        point: [x0, y0, d.f0],
        normal: [-d.g[0], -d.g[1], 1],
        role: 'tangent',
        latex: `z = ${L(d.f0)} ${sgn(d.g[0])} ${L(Math.abs(d.g[0]))}(x ${sgn(-x0)} ${L(Math.abs(x0))}) ${sgn(d.g[1])} ${L(Math.abs(d.g[1]))}(y ${sgn(-y0)} ${L(Math.abs(y0))})`,
      };
      return plane;
    },
  },
  {
    name: 'linearization', minArgs: 2, maxArgs: 2, argModes: [F, V], category: 'calculus',
    signature: 'linearization(f, P)', doc: 'First-order Taylor polynomial L(x) = f(P) + ∇f(P)·(x − P).',
    apply: ([fv, P], ctx) => {
      const f = asScalarField(expectFunction(fv));
      const d = localData(ctx, f, pointArg(P, f));
      return ctx.makeFunction(taylorExpr(d, f.params, 1), f.params, { label: `L_{${f.label ?? 'f'}}` });
    },
  },
  {
    name: 'taylor2', minArgs: 2, maxArgs: 2, argModes: [F, V], category: 'calculus',
    signature: 'taylor2(f, P)', doc: 'Second-order Taylor polynomial f(P) + ∇f·Δ + ½ Δᵀ H Δ.',
    apply: ([fv, P], ctx) => {
      const f = asScalarField(expectFunction(fv));
      const d = localData(ctx, f, pointArg(P, f));
      return ctx.makeFunction(taylorExpr(d, f.params, 2), f.params, { label: `Q_{${f.label ?? 'f'}}` });
    },
  },
  {
    name: 'slice', minArgs: 2, maxArgs: 3, argModes: [F, RAW, V], category: 'calculus',
    signature: 'slice(f, x = a) | slice(f, P, u)', doc: 'Cross-section of z = f(x, y) by a vertical plane.',
    apply: (args, ctx, raw) => makeSlice(asScalarField(expectFunction(args[0])), raw[1], args[2], ctx),
  },
];

const visuals: Builtin[] = [
  {
    name: 'surface', minArgs: 1, maxArgs: 3, argModes: [F, V], category: 'visual',
    signature: 'surface(f[, [x0,x1], [y0,y1]])', doc: 'The surface z = f(x, y) (3D) with a heat map (2D).',
    apply: ([fv, xr, yr]) => {
      const f = asScalarField(expectFunction(fv));
      if (f.params.length !== 2) throw new EvalError('surface needs a function of two variables');
      return visual('surface', { fn: f, xRange: rangeArg(xr), yRange: rangeArg(yr) }, f.label, 'surface');
    },
  },
  {
    name: 'contours', minArgs: 1, maxArgs: 2, argModes: [F, V], category: 'visual',
    signature: 'contours(f[, n])', doc: 'Level curves f(x, y) = c, in 2D and projected in 3D.',
    apply: ([fv, n]) => {
      const f = asScalarField(expectFunction(fv));
      if (f.params.length !== 2) throw new EvalError('contours needs a function of two variables');
      return visual('contours', { fn: f, count: n ? expectNumber(n) : undefined }, f.label);
    },
  },
  {
    name: 'level', minArgs: 2, maxArgs: 2, argModes: [F, V], category: 'visual',
    signature: 'level(f, P)', doc: 'The level curve through P with its tangent (perpendicular to ∇f).',
    apply: ([fv, P], ctx) => {
      const f = asScalarField(expectFunction(fv));
      const d = localData(ctx, f, pointArg(P, f));
      return visual('level', { fn: f, at: d.p, value: d.f0, g: d.g }, `level ${f.label ?? 'f'} = ${L(d.f0)}`, 'level');
    },
  },
  {
    name: 'gradient_path', minArgs: 2, maxArgs: 3, argModes: [F, V, RAW], category: 'visual',
    signature: 'gradient_path(f, P[, ascent|descent|both])', doc: 'Path of steepest ascent/descent from P.',
    apply: ([fv, P], ctx, raw) => {
      const f = asScalarField(expectFunction(fv));
      const mode = raw[2]?.type === 'sym' ? raw[2].name : 'both';
      if (!['ascent', 'descent', 'both'].includes(mode)) throw new EvalError('Mode must be ascent, descent or both');
      return visual('path', { fn: f, grad: gradOf(ctx, f), from: pointArg(P, f), mode }, 'steepest path', 'path');
    },
  },
  {
    name: 'hessian_axes', minArgs: 2, maxArgs: 2, argModes: [F, V], category: 'visual',
    signature: 'hessian_axes(f, P)', doc: 'Principal curvature directions (eigenvectors of the Hessian) at P.',
    apply: ([fv, P], ctx) => {
      const f = asScalarField(expectFunction(fv));
      const d = localData(ctx, f, pointArg(P, f));
      return visual('hessian_axes', { fn: f, at: d.p, f0: d.f0, g: d.g, H: d.H, eig: symmetricEigen(d.H) }, 'principal directions', 'hessian');
    },
  },
  {
    name: 'quadratic', minArgs: 2, maxArgs: 2, argModes: [F, V], category: 'visual',
    signature: 'quadratic(f, P)', doc: 'Local second-order approximation surface near P.',
    apply: ([fv, P], ctx) => {
      const f = asScalarField(expectFunction(fv));
      const d = localData(ctx, f, pointArg(P, f));
      const q = ctx.makeFunction(taylorExpr(d, f.params, 2), f.params, { label: `Q_{${f.label ?? 'f'}}` });
      return visual('quadratic', { fn: f, q, at: d.p }, 'quadratic approximation', 'quadratic');
    },
  },
  {
    name: 'arrow', minArgs: 2, maxArgs: 2, argModes: [V, RAW], category: 'visual',
    signature: 'arrow(P, v)', doc: 'Draw vector v starting at P. Drag its tip to change v.',
    apply: ([P], ctx, raw) => {
      const anchor = expectCoords(P, 'a point');
      const v = ctx.evaluate(raw[1]);
      const comps = expectVector(v);
      const sourceId = raw[1].type === 'sym' ? raw[1].name : undefined;
      return visual('arrow', { anchor, vec: comps, sourceId }, sourceId, v.role ?? 'direction');
    },
  },
];

// ------------------------------------------------------------------ slices

function makeSlice(f: FunctionValue, spec: Expr, third: MathValue | undefined, ctx: EvalContext): SliceValue {
  if (f.params.length !== 2) throw new EvalError('slice needs a function of two variables');
  const name = f.label ?? 'f';
  if (spec.type === 'eq') {
    if (spec.left.type !== 'sym' || !f.params.includes(spec.left.name))
      throw new EvalError(`Write slice(${name}, ${f.params[0]} = a) or slice(${name}, P, u)`);
    const fixed = f.params.indexOf(spec.left.name);
    const free = 1 - fixed;
    const a = expectNumber(ctx.evaluate(spec.right));
    // slice(f, x = P.x) marks P on the section
    let markerCoord: number | undefined;
    if (spec.right.type === 'member' && spec.right.object.type === 'sym') {
      const P = ctx.lookup(spec.right.object.name);
      if (P?.kind === 'point') markerCoord = (P as { coords: number[] }).coords[free];
    }
    const origin = [0, 0];
    origin[fixed] = a;
    origin[free] = markerCoord ?? 0;
    const dir = [0, 0];
    dir[free] = 1;
    const args = f.params.map((p, i) => (i === fixed ? L(a) : symbolLatex(p)));
    return {
      kind: 'slice', fn: f, origin, dir, axis: free, marker: markerCoord !== undefined ? 0 : undefined,
      label: `z = ${name}(${args.join(', ')})`, role: fixed === 0 ? 'slice-x' : 'slice-y',
    };
  }
  const P = ctx.evaluate(spec);
  const p = expectCoords(P, 'a point');
  if (!third) throw new EvalError(`slice(${name}, P, u) needs a direction u`);
  const u = expectVector(third);
  if (norm(u) === 0) throw new EvalError('Direction must be non-zero');
  return {
    kind: 'slice', fn: f, origin: p, dir: normalize(u), marker: 0,
    label: `z = ${name}(${pointNameLatex(spec)} + t\,\hat{u})`, role: 'slice-dir',
  };
}

const pointNameLatex = (raw: Expr) => (raw.type === 'sym' ? symbolLatex(raw.name) : 'P');

// ------------------------------------------------------------------ plugin

export const coreCalculusMath = definePlugin({
  name: 'core-calculus',
  install(api) {
    [...calculus, ...visuals].forEach((b) => api.registerBuiltin(b));
    api.registerLatexFunctionName('grad', '\nabla');
    api.registerLatexFunctionName('hessian', 'H');
    api.registerLatexFunctionName('tangent_plane', '\operatorname{T}');
    api.registerDefaultVisual('vector', (v, ctx) => {
      const vec = v as { comps: number[]; anchor?: number[] };
      const anchor = vec.anchor ?? vec.comps.map(() => 0);
      return [visual('arrow', { anchor, vec: vec.comps, sourceId: ctx.nodeId }, ctx.name, v.role)];
    });
  },
});

