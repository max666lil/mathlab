/**
 * Parametric surfaces S(u, v) = (x, y, z): partial derivatives, normal S_u × S_v, area, closedness,
 * flux of a field through S. Surface integrals use a 2-D Gauss–Legendre rule on the parameter
 * rectangle (numeric, error estimated from two resolutions).
 */
import { Builtin, EvalContext, EvalError } from '../../math-core/builtins';
import { Expr, mapExpr } from '../../math-core/ast';
import { diff } from '../../math-core/symbolic/diff';
import { simplify } from '../../math-core/symbolic/simplify';
import { FunctionValue, MathValue, BoolValue, ScalarValue, vector } from '../../math-core/values';
import { surfaceRanges } from '../../math-core/ranges';
import { visual } from '../../visualization/scene-model';
import { isField, comps } from './math';

export function isSurfaceFn(v: MathValue | undefined): v is FunctionValue {
  const f = v as FunctionValue;
  return v?.kind === 'function' && f.params.length === 2 && f.out === 'vector' && !!f.expr && (f.expr.type === 'vec' || f.expr.type === 'tuple') && f.expr.items.length === 3;
}
export function expectSurface(v: MathValue | undefined): FunctionValue {
  if (!isSurfaceFn(v)) throw new EvalError('Expected a surface S(u, v) = (x, y, z)');
  return v;
}

const items = (f: FunctionValue) => (f.expr as Extract<Expr, { type: 'vec' }>).items;
const mul = (a: Expr, b: Expr): Expr => ({ type: 'bin', op: '*', left: a, right: b });
const sub = (a: Expr, b: Expr): Expr => ({ type: 'bin', op: '-', left: a, right: b });

/** S_u × S_v as expressions (the unnormalised normal, orientation from the parametrisation). */
export function normalExprs(S: FunctionValue): Expr[] {
  const [u, v] = S.params;
  const Su = items(S).map((c) => simplify(diff(c, u)));
  const Sv = items(S).map((c) => simplify(diff(c, v)));
  return [sub(mul(Su[1], Sv[2]), mul(Su[2], Sv[1])), sub(mul(Su[2], Sv[0]), mul(Su[0], Sv[2])), sub(mul(Su[0], Sv[1]), mul(Su[1], Sv[0]))].map(simplify);
}

const GL8 = { x: [-0.9602898564975363, -0.7966664774136267, -0.525532409916329, -0.1834346424956498, 0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363], w: [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362, 0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763] };

/** ∬ g du dv over a rectangle with panels × panels Gauss–Legendre (8×8 nodes each). */
export function rectIntegral(g: (u: number, v: number) => number, [u0, u1]: [number, number], [v0, v1]: [number, number], panels: number): number {
  const hu = (u1 - u0) / panels;
  const hv = (v1 - v0) / panels;
  let total = 0;
  for (let a = 0; a < panels; a++)
    for (let b = 0; b < panels; b++) {
      const cu = u0 + (a + 0.5) * hu;
      const cv = v0 + (b + 0.5) * hv;
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 8; j++) {
          const val = g(cu + (GL8.x[i] * hu) / 2, cv + (GL8.x[j] * hv) / 2);
          if (Number.isFinite(val)) total += (GL8.w[i] * GL8.w[j] * val * hu * hv) / 4;
        }
    }
  return total;
}

export function surfaceIntegral(g: (u: number, v: number) => number, S: FunctionValue): { value: number; error: number } {
  const [ur, vr] = surfaceRanges(S);
  const coarse = rectIntegral(g, ur, vr, 8);
  const fine = rectIntegral(g, ur, vr, 16);
  return { value: fine, error: Math.abs(fine - coarse) };
}

const numeric = (r: { value: number; error: number }, what: string, extra: Partial<ScalarValue> = {}): ScalarValue => ({
  kind: 'scalar', value: Math.abs(r.value) < 1e-10 ? 0 : r.value, certainty: 'numeric', evidence: `${what}: 2-D Gauss–Legendre on the parameter rectangle (±${r.error.toExponential(1)})`, ...extra,
});

/** Closed: every edge of the parameter rectangle is either collapsed (a pole) or glued to the opposite edge. */
export function closedSurface(S: FunctionValue): boolean {
  const [[u0, u1], [v0, v1]] = surfaceRanges(S);
  const f = S.eval as (u: number, v: number) => number[];
  const same = (p: number[], q: number[]) => p.every((c, i) => Math.abs(c - q[i]) < 1e-7 * (1 + Math.abs(c)));
  const edge = (fix: 'u' | 'v', val: number) => Array.from({ length: 9 }, (_, k) => (fix === 'u' ? f(val, v0 + ((v1 - v0) * k) / 8) : f(u0 + ((u1 - u0) * k) / 8, val)));
  const collapsed = (e: number[][]) => e.every((p) => same(p, e[0]));
  const glued = (a: number[][], b: number[][]) => a.every((p, i) => same(p, b[i]));
  const eu0 = edge('u', u0), eu1 = edge('u', u1), ev0 = edge('v', v0), ev1 = edge('v', v1);
  const uOk = glued(eu0, eu1) || (collapsed(eu0) && collapsed(eu1));
  const vOk = glued(ev0, ev1) || (collapsed(ev0) && collapsed(ev1));
  return uOk && vOk;
}

const nameOf = (e: Expr | undefined, fb: string) => (e?.type === 'sym' ? e.name : fb);

/**
 * +1 or −1: closed surfaces are oriented outward (the convention of the divergence theorem); open
 * surfaces keep the orientation of their parametrisation (S_u × S_v).
 */
export function orientation(ctx: EvalContext, S: FunctionValue): 1 | -1 {
  if (!closedSurface(S)) return 1;
  const raw = ctx.makeFunction({ type: 'vec', items: normalExprs(S) }, S.params, { env: S.env }).eval as (u: number, v: number) => number[];
  const f = S.eval as (u: number, v: number) => number[];
  const [[u0, u1], [v0, v1]] = surfaceRanges(S);
  const pts: { p: number[]; n: number[] }[] = [];
  for (let i = 0; i < 9; i++)
    for (let j = 0; j < 9; j++) {
      const u = u0 + ((u1 - u0) * (i + 0.5)) / 9;
      const v = v0 + ((v1 - v0) * (j + 0.5)) / 9;
      pts.push({ p: f(u, v), n: raw(u, v) });
    }
  const c = [0, 1, 2].map((k) => pts.reduce((s, q) => s + q.p[k], 0) / pts.length);
  const s = pts.reduce((acc, q) => acc + q.n.reduce((t, x, k) => t + x * (q.p[k] - c[k]), 0), 0);
  return s < 0 ? -1 : 1;
}

export function normalFn(ctx: EvalContext, S: FunctionValue): FunctionValue {
  const sign = orientation(ctx, S);
  const n = normalExprs(S).map((e): Expr => (sign < 0 ? { type: 'neg', arg: e } : e));
  return ctx.makeFunction({ type: 'vec', items: n }, S.params, { env: S.env, label: `N_{${S.label ?? 'S'}}` });
}

export function surfaceArea(ctx: EvalContext, S: FunctionValue): ScalarValue {
  const N = normalFn(ctx, S).eval as (u: number, v: number) => number[];
  return numeric(surfaceIntegral((u, v) => Math.hypot(...N(u, v)), S), 'area ∬|S_u × S_v| du dv');
}

/** ∬_S F·dS = ∬ F(S(u,v))·(S_u × S_v) du dv. */
export function fluxThrough(ctx: EvalContext, F: FunctionValue, S: FunctionValue, names: { F: string; S: string }): ScalarValue {
  if (!isField(F) || F.params.length !== 3) throw new EvalError(`${names.F} must be a vector field F(x, y, z)`);
  const sub3 = new Map(F.params.map((p, i) => [p, items(S)[i]]));
  const pulled = comps(F).map((c) => mapExpr(c, (n) => (n.type === 'sym' && sub3.has(n.name) ? sub3.get(n.name)! : n)));
  const Fc = ctx.makeFunction({ type: 'vec', items: pulled }, S.params, { env: { ...F.env, ...S.env } }).eval as (u: number, v: number) => number[];
  const N = normalFn(ctx, S).eval as (u: number, v: number) => number[];
  const r = surfaceIntegral((u, v) => {
    const a = Fc(u, v);
    const n = N(u, v);
    return a[0] * n[0] + a[1] * n[1] + a[2] * n[2];
  }, S);
  return numeric(r, closedSurface(S) ? 'flux through the closed surface, oriented outward' : 'flux ∬ F·(S_u × S_v) du dv (orientation of the parametrisation)', {
    derivation: `\\iint_{${names.S}} ${names.F}\\cdot d\\mathbf{S}`,
    visuals: [visual('fluxarrows', { F, S, sign: orientation(ctx, S) }, 'flux', 'flux') as MathValue as never],
  });
}

export const surfaceBuiltins: Builtin[] = [
  {
    name: 'closedsurface', prefix: true, minArgs: 1, maxArgs: 1, argModes: ['function'], category: 'surfaces', signature: 'closedsurface S',
    doc: 'Whether a parametric surface is closed (its parameter rectangle is glued up or collapsed to poles).',
    apply: ([s]) => {
      const S = expectSurface(s);
      const c = closedSurface(S);
      return { kind: 'bool', value: c, reason: c ? '\\text{the parameter rectangle closes up}' : '\\text{has a boundary}', certainty: 'heuristic', evidence: 'edges of the parameter rectangle compared at sample points' } as BoolValue;
    },
  },
  {
    name: 'normal', command: true, minArgs: 1, maxArgs: 2, argModes: ['function', 'value'], keywords: { at: 'value' }, category: 'surfaces', signature: 'normal S at (u, v)',
    doc: 'Unit normal (S_u × S_v)/|S_u × S_v| at a parameter point, anchored on the surface.',
    apply: ([s, p], ctx, _raw, kw) => {
      const S = expectSurface(s);
      const at = (kw.values.at ?? p) as { coords?: number[]; comps?: number[] } | undefined;
      const uv = at?.coords ?? at?.comps;
      if (!uv || uv.length !== 2) throw new EvalError('normal S at (u, v)');
      const n = (normalFn(ctx, S).eval as (u: number, v: number) => number[])(uv[0], uv[1]);
      const l = Math.hypot(...n);
      if (l < 1e-12) throw new EvalError('the surface is singular here (S_u × S_v = 0)');
      return vector(n.map((x) => x / l), (S.eval as (u: number, v: number) => number[])(uv[0], uv[1]), { certainty: 'exact', role: 'normal' });
    },
  },
  {
    name: 'surfacenormals', prefix: true, minArgs: 1, maxArgs: 1, argModes: ['function'], category: 'surfaces', signature: 'surfacenormals S', doc: 'Normal vectors on a grid of the surface (orientation).',
    apply: ([s], ctx) => {
      const S = expectSurface(s);
      return visual('normals', { S, N: normalFn(ctx, S), sign: orientation(ctx, S) }, 'normals', 'normal');
    },
  },
];

/** flux F through S (surfaces) next to flux F across C (curves). */
export function fluxThroughBuiltin(base: Builtin): Builtin {
  return {
    ...base,
    keywords: { ...(base.keywords ?? {}), through: 'value' },
    signature: `${base.signature}  ·  flux F through S`,
    apply: (args, ctx, raw, kw) => {
      if (!kw.values.through) return base.apply(args, ctx, raw, kw);
      return fluxThrough(ctx, args[0] as FunctionValue, expectSurface(kw.values.through), { F: nameOf(raw[0], 'F'), S: nameOf(kw.raw.through, 'S') });
    },
  };
}

/** area C (closed plane curve) and area S (surface). */
export function areaOfSurface(base: Builtin): Builtin {
  return {
    ...base,
    signature: `${base.signature}  ·  area S`,
    doc: 'Area enclosed by a closed plane curve, or the area of a parametric surface.',
    apply: (args, ctx, raw, kw) => (isSurfaceFn(args[0]) ? { ...surfaceArea(ctx, args[0]), derivation: `\\text{area}(${nameOf(raw[0], 'S')})` } : base.apply(args, ctx, raw, kw)),
  };
}