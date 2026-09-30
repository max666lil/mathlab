/**
 * Multiple integrals (Phase 3b): regions, `integrate f over R [in polar] [order dx dy]`, area, volume,
 * average value, mass, centroid and iterated bounds. Results are ordinary scalars / points with
 * certainty (exact when every inner integral is symbolic) and the iterated integral as derivation.
 */
import { Expr, num, sym, freeSymbols } from '../../math-core/ast';
import { Builtin, EvalContext, EvalError, KwArgs, getBuiltin } from '../../math-core/builtins';
import { FunctionValue, MathValue, scalar, point } from '../../math-core/values';
import { simplify, mulList } from '../../math-core/symbolic/simplify';
import { toLatex } from '../../math-core/symbolic/print';
import { bindEnv } from '../core-calculus/analysis-builtins';
import { CoordSystem, SYSTEM_VARS, fromCartesian, jacobianFactor, substitute } from './coords';
import { RegionValue, Description, asRegion, expectRegion, buildRegion, describe, naturalOrders, roundness, descriptionLatex, boundsLatex, varLatex } from './region';
import { integrateDescription, IteratedResult, NumericIntegralError } from './iterated';

const V = 'value' as const;
const RAW = 'raw' as const;
const FN = 'function' as const;

export interface BoundsValue {
  kind: 'bounds';
  description: Description;
  latex: string;
  certainty: 'exact';
  [k: string]: unknown;
}

const SYSTEMS: Record<string, CoordSystem> = { polar: 'polar', cylindrical: 'cylindrical', spherical: 'spherical', cartesian: 'cartesian', rectangular: 'cartesian' };

function systemOf(raw: Expr | undefined): CoordSystem | undefined {
  if (!raw) return undefined;
  const s = raw.type === 'sym' ? SYSTEMS[raw.name] : undefined;
  if (!s) throw new EvalError('coordinates: polar, cylindrical, spherical or cartesian');
  return s;
}

/** `order dy dx` (innermost first, as written) → outer → inner. */
function orderOf(raw: Expr | undefined): string[] | undefined {
  if (!raw) return undefined;
  const names: string[] = [];
  const walk = (e: Expr) => {
    if (e.type === 'sym') names.push(e.name);
    else if (e.type === 'bin' && (e.op === '*' || e.op === '·')) {
      walk(e.left);
      walk(e.right);
    } else throw new EvalError('write the order like: order dy dx');
  };
  walk(raw);
  const vars = [...names.join('').matchAll(/d(θ|φ|ρ|[a-z])/g)].map((m) => m[1]);
  if (!vars.length) throw new EvalError('write the order like: order dy dx');
  return vars.reverse();
}

/** The integrand in the system's coordinates, times the Jacobian factor. */
function integrandIn(f: FunctionValue | number, region: RegionValue, system: CoordSystem): Expr {
  let e: Expr;
  if (typeof f === 'number') e = num(f);
  else {
    if (!f.expr) throw new EvalError('the integrand needs a symbolic form');
    if (f.out !== 'scalar') throw new EvalError('integrate … over R needs a scalar function');
    e = bindEnv(f.expr, f.env);
    const sysVars = SYSTEM_VARS[system].slice(0, region.dim);
    const already = region.system !== 'cartesian' && f.params.length === sysVars.length && f.params.every((p, i) => p === SYSTEM_VARS[region.system][i]);
    if (already) {
      if (system !== region.system) throw new EvalError(`the integrand is written in ${region.system} coordinates`);
    } else {
      if (f.params.length !== region.dim) throw new EvalError(`the integrand has ${f.params.length} variable${f.params.length === 1 ? '' : 's'} but the region is ${region.dim}-dimensional`);
      const cart = SYSTEM_VARS.cartesian;
      e = substitute(e, Object.fromEntries(f.params.map((p, i) => [p, sym(cart[i])])));
      e = fromCartesian(e, system);
    }
  }
  return simplify(mulList([e, jacobianFactor(system)]));
}

export interface RegionIntegral extends IteratedResult {
  description: Description;
  integrand: Expr;
}

/** ∬ f dA / ∭ f dV: exact in the first system / order that integrates symbolically, else numeric. */
export function integrateOver(f: FunctionValue | number, region: RegionValue, opts: { system?: CoordSystem; order?: string[] } = {}): RegionIntegral {
  if (!region.bounded) throw new EvalError('the region is unbounded — integrals over unbounded regions are not supported yet');
  const cartF = typeof f === 'number' || !f.expr ? [] : [bindEnv(f.expr, f.env)];
  const systems: CoordSystem[] = opts.system
    ? [opts.system]
    : [region.system, ...(region.system === 'cartesian' ? roundness([...region.cons.map((c) => c.g), ...cartF], region.dim) : [])];
  const attempts: { d: Description; h: Expr }[] = [];
  for (const s of systems) {
    const orders = opts.order ? [opts.order] : naturalOrders(s, region.dim);
    for (const o of orders) {
      let d: Description | null = null;
      try {
        d = describe(region, s, o);
      } catch {
        d = null;
      }
      if (!d) continue;
      const h = integrandIn(f, region, s);
      attempts.push({ d, h });
      const r = integrateDescription(d, h, true);
      if (r) return { ...r, description: d, integrand: h };
    }
  }
  if (!attempts.length) {
    if (opts.order) throw new EvalError(`the region cannot be described in the order ${opts.order.map((v) => `d${v}`).reverse().join(' ')} — try another order`);
    throw new EvalError('could not describe the region by iterated bounds (each variable between two expressions)');
  }
  const { d, h } = attempts[0];
  try {
    const r = integrateDescription(d, h)!;
    return { ...r, description: d, integrand: h };
  } catch (e) {
    if (e instanceof NumericIntegralError) throw new EvalError(e.message);
    throw e;
  }
}

function sysPhrase(s: CoordSystem) {
  return s === 'cartesian' ? 'Cartesian coordinates' : `${s} coordinates`;
}

function regionName(raw: Expr | undefined, fallback: string) {
  return raw?.type === 'sym' ? raw.name : fallback;
}

function resultOf(r: RegionIntegral, region: RegionValue, head: string, scale = 1): MathValue {
  const d = r.description;
  const derivation = `${head} = ${descriptionLatex(d, toLatex(r.integrand))}`;
  const where = `iterated integral in ${sysPhrase(d.system)}, order ${[...d.order].reverse().map((v) => `d${v}`).join(' ')}`;
  const value = r.value * scale;
  return r.exact
    ? scalar(value, { certainty: 'exact', evidence: `${where}; every inner integral symbolic (antiderivatives verified), outer by the fundamental theorem`, derivation })
    : scalar(value, { certainty: 'numeric', evidence: `${where}; nested adaptive Gauss–Kronrod quadrature, error estimate ${r.error.toExponential(1)}`, derivation });
}

const integralHead = (region: RegionValue, f: string, R: string) => (region.dim === 2 ? `\\iint_{${R}} ${f}\\,dA` : `\\iiint_{${R}} ${f}\\,dV`);

function fnLatex(f: FunctionValue | number, raw: Expr | undefined): string {
  if (typeof f === 'number') return String(f);
  if (raw?.type === 'sym') return `${f.label ?? raw.name}`;
  return f.expr ? toLatex(f.expr) : 'f';
}

/**
 * The integrand: a named function keeps its parameters; an expression is a function of the region's
 * coordinates (x, y[, z] — or r, θ … when it is written in the region's own coordinates).
 */
function integrandArg(v: MathValue | undefined, ctx: EvalContext, raw: Expr | undefined, region: RegionValue): FunctionValue | number {
  if (v?.kind === 'scalar') return (v as { value: number }).value;
  if (raw?.type === 'sym') {
    const named = ctx.lookup(raw.name);
    if (named?.kind === 'function') return named as FunctionValue;
    if (named?.kind === 'scalar') return (named as { value: number }).value;
  }
  if (raw?.type === 'num') return raw.value;
  if (raw && !(raw.type === 'sym' && v?.kind === 'function')) {
    const inSys = liftInRegion(raw, region, ctx);
    if (inSys) return inSys;
    const w = ctx.makeFunction(raw, SYSTEM_VARS.cartesian.slice(0, region.dim));
    return w;
  }
  if (v?.kind === 'function') return v as FunctionValue;
  throw new EvalError('Expected a function or an expression to integrate');
}

/** An integrand written in r, θ (or ρ, φ, θ) next to a region in those coordinates. */
function liftInRegion(raw: Expr, region: RegionValue, ctx: EvalContext): FunctionValue | undefined {
  if (region.system === 'cartesian') return undefined;
  const vars = SYSTEM_VARS[region.system];
  const free = [...freeSymbols(raw)].filter((n) => !ctx.lookup(n));
  if (!free.some((n) => vars.includes(n) && !['x', 'y', 'z'].includes(n))) return undefined;
  return ctx.makeFunction(raw, vars);
}

function opts(kw: KwArgs) {
  return { system: systemOf(kw.raw.in), order: orderOf(kw.raw.order) };
}

export const regionBuiltin: Builtin = {
  name: 'region', minArgs: 1, maxArgs: 16, argModes: [RAW], category: 'multivariable',
  signature: 'region(ineq, …)  ·  R = 0 <= x <= 1 and x^2 <= y <= x', doc: 'A region of the plane or of space given by inequalities (Cartesian, polar r θ, cylindrical r θ z, spherical ρ φ θ).',
  apply: (_args, ctx, raw) => buildRegion(ctx, raw) as unknown as MathValue,
};

/** integrate f over R: wraps the existing integrate (antiderivatives, definite, along curves). */
export function integrateOverBuiltin(base: Builtin): Builtin {
  return {
    ...base,
    argModes: [FN, V, V],
    keywords: { ...(base.keywords ?? {}), over: V, in: RAW, order: RAW },
    signature: `${base.signature}  ·  integrate f over R [in polar] [order dy dx]`,
    apply: (args, ctx, raw, kw) => {
      const R = kw.values.over;
      if (!R) return base.apply(args, ctx, raw, kw);
      const region = expectRegion(R);
      const f = integrandArg(args[0], ctx, raw[0], region);
      const r = integrateOver(f, region, opts(kw));
      return resultOf(r, region, integralHead(region, fnLatex(f, raw[0]), regionName(kw.raw.over, 'R')));
    },
  };
}

export function areaOverBuiltin(base: Builtin): Builtin {
  return {
    ...base,
    command: true,
    argModes: [V],
    keywords: { ...(base.keywords ?? {}), in: RAW, order: RAW },
    signature: `${base.signature}  ·  area R`,
    apply: (args, ctx, raw, kw) => {
      const region = asRegion(args[0]);
      if (!region) return base.apply(args, ctx, raw, kw);
      if (region.dim !== 2) throw new EvalError('area needs a plane region — use volume for a solid');
      return resultOf(integrateOver(1, region, opts(kw)), region, `\\text{area}(${regionName(raw[0], 'R')})`);
    },
  };
}

export const volumeBuiltin: Builtin = {
  name: 'volume', command: true, minArgs: 1, maxArgs: 1, argModes: [RAW], keywords: { over: V, in: RAW, order: RAW }, category: 'multivariable',
  signature: 'volume E  ·  volume f over R', doc: 'Volume of a solid, or of the solid under the graph of f over a plane region.',
  apply: ([a], ctx, raw, kw) => {
    if (kw.values.over) {
      const region = expectRegion(kw.values.over);
      const f = integrandArg(a, ctx, raw[0], region);
      return resultOf(integrateOver(f, region, opts(kw)), region, `\\text{volume} = \\iint_{${regionName(kw.raw.over, 'R')}} ${fnLatex(f, raw[0])}\\,dA`);
    }
    const region = expectRegion(ctx.evaluate(raw[0]));
    if (region.dim !== 3) throw new EvalError('volume needs a solid (x, y, z) — or: volume f over R');
    return resultOf(integrateOver(1, region, opts(kw)), region, `\\text{volume}(${regionName(raw[0], 'E')})`);
  },
};

export const averageBuiltin: Builtin = {
  name: 'average', command: true, minArgs: 1, maxArgs: 1, argModes: [RAW], keywords: { over: V, in: RAW, order: RAW }, category: 'multivariable',
  signature: 'average f over R', doc: 'Average value of f over a region: ∬ f dA / area.',
  apply: ([a], ctx, raw, kw) => {
    if (!kw.values.over) throw new EvalError('say where: average f over R');
    const region = expectRegion(kw.values.over);
    const f = integrandArg(a, ctx, raw[0], region);
    const o = opts(kw);
    const I = integrateOver(f, region, o);
    const A = integrateOver(1, region, o);
    const R = regionName(kw.raw.over, 'R');
    const head = `\\bar{f} = \\frac{1}{\\text{${region.dim === 2 ? 'area' : 'volume'}}(${R})}${integralHead(region, fnLatex(f, raw[0]), R)}`;
    const exact = I.exact && A.exact;
    return scalar(I.value / A.value, {
      certainty: exact ? 'exact' : 'numeric',
      evidence: `${exact ? 'both integrals exact' : 'numeric quadrature'} (${region.dim === 2 ? 'area' : 'volume'} = ${+A.value.toPrecision(8)})`,
      derivation: head,
    });
  },
};

export const massBuiltin: Builtin = {
  name: 'mass', command: true, minArgs: 1, maxArgs: 1, argModes: [RAW], keywords: { over: V, in: RAW, order: RAW }, category: 'multivariable',
  signature: 'mass δ over R', doc: 'Total mass (or total quantity) of a density over a region.',
  apply: ([a], ctx, raw, kw) => {
    if (!kw.values.over) throw new EvalError('say where: mass δ over R');
    const region = expectRegion(kw.values.over);
    const f = integrandArg(a, ctx, raw[0], region);
    return resultOf(integrateOver(f, region, opts(kw)), region, `m = ${integralHead(region, fnLatex(f, raw[0]), regionName(kw.raw.over, 'R'))}`);
  },
};

export const centroidBuiltin: Builtin = {
  name: 'centroid', command: true, minArgs: 1, maxArgs: 1, argModes: [V], keywords: { with: FN, in: RAW, order: RAW }, category: 'multivariable',
  signature: 'centroid R [with δ]', doc: 'Centre of mass of a region (uniform density, or with density δ).',
  apply: ([a], ctx, _raw, kw) => {
    const region = expectRegion(a);
    const o = opts(kw);
    const dens = kw.values.with as FunctionValue | undefined;
    const cart = SYSTEM_VARS.cartesian.slice(0, region.dim);
    const base: Expr = dens?.expr ? substitute(bindEnv(dens.expr, dens.env), Object.fromEntries(dens.params.map((p, i) => [p, sym(cart[i])]))) : num(1);
    const make = (e: Expr) => ctx.makeFunction(e, cart);
    const M = integrateOver(make(base), region, o);
    if (Math.abs(M.value) < 1e-300) throw new EvalError('the region has zero mass');
    const moments = cart.map((c) => integrateOver(make(simplify(mulList([sym(c), base]))), region, o));
    const exact = M.exact && moments.every((m) => m.exact);
    const scale = Math.max(1e-300, ...region.box.flat().map(Math.abs));
    return { ...point(moments.map((m) => (Math.abs(m.value / M.value) < 1e-12 * scale ? 0 : m.value / M.value))), certainty: exact ? 'exact' : 'numeric', evidence: `x̄ = (1/m)∫x δ dA …; ${exact ? 'all integrals exact' : 'numeric quadrature'}` } as MathValue;
  },
};

export const boundsBuiltin: Builtin = {
  name: 'bounds', command: true, minArgs: 1, maxArgs: 1, argModes: [V], keywords: { in: RAW, order: RAW }, category: 'multivariable',
  signature: 'bounds R [in polar] [order dx dy]', doc: 'The iterated description of a region: each variable between bounds in the outer ones.',
  apply: ([a], _ctx, _raw, kw) => {
    const region = expectRegion(a);
    const o = opts(kw);
    // Cartesian first; a round region that has no Cartesian description gets its natural one
    const systems = o.system ? [o.system] : [region.system, ...(region.system === 'cartesian' ? roundness(region.cons.map((c) => c.g), region.dim) : [])];
    for (const s of systems)
      for (const ord of o.order ? [o.order] : naturalOrders(s, region.dim)) {
        const d = describe(region, s, ord);
        if (d) return { kind: 'bounds', description: d, latex: boundsLatex(d), certainty: 'exact' } as unknown as MathValue;
      }
    throw new EvalError(o.order ? `no description in the order ${o.order.map((v) => `d${varLatex(v)}`).reverse().join(' ')}` : 'could not describe the region by iterated bounds');
  },
};

export const multivariableBuiltins = [regionBuiltin, volumeBuiltin, averageBuiltin, massBuiltin, centroidBuiltin, boundsBuiltin];

export function wrapExisting(register: (b: Builtin) => void) {
  const integ = getBuiltin('integrate');
  if (integ) register(integrateOverBuiltin(integ));
  const area = getBuiltin('area');
  if (area) register(areaOverBuiltin(area));
}