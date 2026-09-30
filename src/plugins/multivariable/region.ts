/**
 * Regions of the plane and of space, given by inequalities in Cartesian, polar, cylindrical or spherical
 * coordinates, and their iterated descriptions ("type I / type II", Hughes-Hallett §16.2–16.5):
 *
 *   R = x^2 + y^2 <= 1                   D = 0 <= x <= 1 and x^2 <= y <= x
 *   E = x^2 + y^2 + z^2 <= 4, z >= 0     S = 1 <= r <= 2 and 0 <= θ <= π/4
 *
 * A description lists pieces; in each piece the outermost variable has constant bounds and every inner
 * variable is bounded by expressions in the outer ones. Bounds come from isolating the variable in each
 * inequality (linear, or quadratic with a constant-sign leading coefficient); where several bounds
 * compete, the outer range is split at the points where the active bound changes.
 */
import { Expr, Relation, num, sym, freeSymbols, dependsOn } from '../../math-core/ast';
import { EvalContext, EvalError, getBuiltin } from '../../math-core/builtins';
import { getScalarFunction } from '../../math-core/scalar-functions';
import { FunctionValue, MathValue } from '../../math-core/values';
import { simplify, addList, mulList, powS } from '../../math-core/symbolic/simplify';
import { polyCoeffsExpr } from '../../math-core/symbolic/expand';
import { toLatex, toText } from '../../math-core/symbolic/print';
import { compileScalar } from '../../math-core/compile';
import { roots1D } from '../../math-core/numeric/roots';
import { bindEnv } from '../core-calculus/analysis-builtins';
import type { RelationValue } from '../core-calculus/graphing';
import { CoordSystem, SYSTEM_VARS, POSITIVE, IMPLICIT_RANGE, fromCartesian, fromCartesianNumeric } from './coords';

/** g rel 0 */
export interface Constraint {
  g: Expr;
  rel: Relation;
}

export interface RegionValue {
  kind: 'region';
  system: CoordSystem;
  /** coordinates of the system (x, y[, z] / r, θ / r, θ, z / ρ, φ, θ) */
  vars: string[];
  dim: 2 | 3;
  cons: Constraint[];
  latex: string;
  key: string;
  /** G(x, y[, z]) ≤ 0 exactly on the region (Cartesian), for drawing and sampling */
  test: FunctionValue;
  /** Cartesian bounding box [lo, hi] per axis (sampled) */
  box: [number, number][];
  /** false when the region reaches the edge of the sampled window (y < x², x > 0 …) */
  bounded: boolean;
  certainty?: 'exact';
  [k: string]: unknown;
}

const COORD_NAMES = new Set(['x', 'y', 'z', 'r', 'θ', 'ρ', 'φ']);

const upper = (r: Relation) => r === '<' || r === '<=';

/** Split chains a ≤ b ≤ c into binary inequalities. */
function binaries(e: Expr): Extract<Expr, { type: 'eq' }>[] {
  if (e.type !== 'eq') throw new EvalError('Expected an inequality');
  if (!e.rel) throw new EvalError('A region is described by inequalities (<, ≤, >, ≥)');
  if (e.left.type === 'eq') {
    const prev = binaries(e.left);
    return [...prev, { type: 'eq', left: prev[prev.length - 1].right, right: e.right, rel: e.rel }];
  }
  return [e];
}

function coordNamesIn(e: Expr, ctx: EvalContext): Set<string> {
  const out = new Set<string>();
  for (const n of freeSymbols(e)) {
    if (ctx.lookup(n) || getBuiltin(n) || getScalarFunction(n)) continue;
    if (COORD_NAMES.has(n)) out.add(n);
    else for (const c of n) if (COORD_NAMES.has(c) && !ctx.lookup(c)) out.add(c);
  }
  return out;
}

/** Build a region from inequality expressions (chains allowed). */
export function buildRegion(ctx: EvalContext, exprs: Expr[]): RegionValue {
  const bins = exprs.flatMap(binaries);
  const used = new Set<string>();
  for (const b of bins) for (const n of coordNamesIn({ type: 'bin', op: '-', left: b.left, right: b.right }, ctx)) used.add(n);
  const has = (...ns: string[]) => ns.some((n) => used.has(n));
  let system: CoordSystem;
  if (has('ρ', 'φ')) {
    if (has('x', 'y', 'r')) throw new EvalError('mixed coordinates: use ρ, φ, θ (spherical) or x, y, z — not both');
    system = 'spherical';
  } else if (has('r', 'θ')) {
    if (has('x', 'y')) throw new EvalError('mixed coordinates: use r, θ (polar) or x, y — not both');
    system = has('z') ? 'cylindrical' : 'polar';
  } else {
    if (!has('x', 'y', 'z')) throw new EvalError('a region needs coordinates (x, y[, z] or r, θ or ρ, φ, θ)');
    system = 'cartesian';
  }
  const dim: 2 | 3 = system === 'polar' || (system === 'cartesian' && !has('z')) ? 2 : 3;
  const vars = system === 'cartesian' ? SYSTEM_VARS.cartesian.slice(0, dim) : SYSTEM_VARS[system];
  const cons: Constraint[] = bins.map((b) => {
    const fn = ctx.makeFunction({ type: 'bin', op: '-', left: b.left, right: b.right }, vars);
    return { g: simplify(bindEnv(fn.expr!, fn.env)), rel: b.rel! };
  });
  const latex = exprs.map((e) => toLatex(e)).join(',\\;\\; ');
  return makeRegion(system, vars, dim, cons, latex);
}

/** A single inequality in x, y (the graphing layer's relation) as a region. */
export function regionOfRelation(r: RelationValue): RegionValue {
  if (r.rel === '=') throw new EvalError('an implicit curve is not a region — use an inequality');
  return makeRegion('cartesian', ['x', 'y'], 2, [{ g: simplify(bindEnv(r.fn.expr!, r.fn.env)), rel: r.rel }], r.latex);
}

const fromRelation = new Map<string, RegionValue>();
export function asRegion(v: MathValue | undefined): RegionValue | undefined {
  if (v?.kind === 'region') return v as unknown as RegionValue;
  if (v?.kind === 'relation' && (v as unknown as RelationValue).rel !== '=') {
    const rv = v as unknown as RelationValue;
    let r = fromRelation.get(rv.key);
    if (!r) {
      r = regionOfRelation(rv);
      fromRelation.set(rv.key, r);
      if (fromRelation.size > 64) fromRelation.delete(fromRelation.keys().next().value!);
    }
    return r;
  }
  return undefined;
}

export function expectRegion(v: MathValue | undefined): RegionValue {
  const r = asRegion(v);
  if (!r) throw new EvalError('Expected a region, e.g. R = x^2 + y^2 <= 1 or D = 0 <= x <= 1 and x^2 <= y <= x');
  return r;
}

function makeRegion(system: CoordSystem, vars: string[], dim: 2 | 3, cons: Constraint[], latex: string): RegionValue {
  const fs = cons.map((c) => ({ f: compileScalar(c.g, vars), s: upper(c.rel) ? 1 : -1 }));
  const toSys = fromCartesianNumeric(system);
  // G ≤ 0 inside; for angular coordinates try θ ± 2π so ranges like −π/2 ≤ θ ≤ π/2 work
  const G = (...p: number[]): number => {
    const c = toSys(p);
    const ti = vars.indexOf('θ');
    const shifts = ti >= 0 ? [0, -2 * Math.PI, 2 * Math.PI] : [0];
    let best = Infinity;
    for (const s of shifts) {
      const q = c.slice();
      if (ti >= 0) q[ti] += s;
      let m = -Infinity;
      for (const { f, s: sg } of fs) {
        const v = sg * f(...q);
        m = Math.max(m, Number.isNaN(v) ? Infinity : v);
      }
      best = Math.min(best, m);
    }
    return best;
  };
  const cvars = SYSTEM_VARS.cartesian.slice(0, dim);
  const key = `region|${system}|${cons.map((c) => `${toText(c.g, true)}${c.rel}`).join(';')}`;
  const test: FunctionValue = { kind: 'function', params: cvars, eval: G as FunctionValue['eval'], out: 'scalar', key, env: {} } as FunctionValue;
  const { box, bounded } = boundingBox(G, dim);
  return { kind: 'region', system, vars, dim, cons, latex, key, test, box, bounded, certainty: 'exact' };
}

/** Sampled bounding box of {G ≤ 0}: a coarse scan of [−24, 24]^d, then a refinement. */
function boundingBox(G: (...p: number[]) => number, dim: number): { box: [number, number][]; bounded: boolean } {
  const scan = (lo: number[], hi: number[], n: number): [number, number][] | null => {
    const mins = Array(dim).fill(Infinity);
    const maxs = Array(dim).fill(-Infinity);
    const idx = Array(dim).fill(0);
    let found = false;
    const total = (n + 1) ** dim;
    for (let k = 0; k < total; k++) {
      let r = k;
      for (let d = 0; d < dim; d++) {
        idx[d] = r % (n + 1);
        r = Math.floor(r / (n + 1));
      }
      const p = idx.map((i, d) => lo[d] + ((hi[d] - lo[d]) * i) / n);
      if (G(...p) <= 0) {
        found = true;
        p.forEach((x, d) => {
          mins[d] = Math.min(mins[d], x);
          maxs[d] = Math.max(maxs[d], x);
        });
      }
    }
    return found ? mins.map((m, d) => [m, maxs[d]] as [number, number]) : null;
  };
  const n1 = dim === 2 ? 96 : 32;
  let b = scan(Array(dim).fill(-24), Array(dim).fill(24), n1) ?? scan(Array(dim).fill(-3), Array(dim).fill(3), n1);
  if (!b) return { box: Array(dim).fill([-1, 1]), bounded: true };
  const bounded = b.every(([l, h]) => l > -23.9 && h < 23.9);
  const step = (w: number) => w / n1 + 1e-9;
  const n2 = dim === 2 ? 120 : 36;
  const lo0 = b.map(([l]) => l - step(48));
  const hi0 = b.map(([, h]) => h + step(48));
  b = scan(lo0, hi0, n2) ?? b;
  // thin corners can fall between grid points: pad by a grid step on top of 2%
  return {
    box: b.map(([l, h], d) => {
      const pad = (h - l) * 0.02 + 1.5 * ((hi0[d] - lo0[d]) / n2) + 1e-6;
      return [l - pad, h + pad] as [number, number];
    }),
    bounded,
  };
}

/** The region's inequalities rewritten in another coordinate system. */
export function inSystem(region: RegionValue, system: CoordSystem): Constraint[] {
  if (system === region.system) return region.cons;
  if (region.system !== 'cartesian') throw new EvalError(`this region is written in ${region.system} coordinates`);
  if ((system === 'polar') !== (region.dim === 2)) throw new EvalError(region.dim === 2 ? 'a plane region uses polar coordinates' : 'a solid uses cylindrical or spherical coordinates');
  return region.cons.map((c) => ({ g: fromCartesian(c.g, system), rel: c.rel }));
}

// ------------------------------------------------------------------ iterated descriptions

export interface Level {
  v: string;
  lo: Expr;
  hi: Expr;
}
export interface Piece {
  levels: Level[];
  /** bounds were chosen by sampling (competing bounds kept as max / min) */
  approx?: boolean;
}
export interface Description {
  system: CoordSystem;
  /** outer → inner */
  order: string[];
  pieces: Piece[];
}

interface Bound {
  e: Expr;
  /** bounds from the same quadratic share a tag (their pairing needs no extra constraint) */
  tag?: number;
}

let tagCounter = 0;

/** Points of the region in system coordinates (for sign checks of symbolic coefficients). */
export function regionSamples(region: RegionValue, system: CoordSystem, n = 400): number[][] {
  const toSys = fromCartesianNumeric(system);
  const out: number[][] = [];
  const dim = region.dim;
  const per = dim === 2 ? 28 : 10;
  const G = region.test.eval as (...p: number[]) => number;
  const idx = Array(dim).fill(0);
  const total = (per + 1) ** dim;
  for (let k = 0; k < total && out.length < n; k++) {
    let r = k;
    for (let d = 0; d < dim; d++) {
      idx[d] = r % (per + 1);
      r = Math.floor(r / (per + 1));
    }
    // a slightly irregular grid avoids landing exactly on symmetry lines
    const p = idx.map((i, d) => region.box[d][0] + ((region.box[d][1] - region.box[d][0]) * (i + 0.37 + 0.2 * Math.sin(7 * i + d))) / (per + 1));
    if (G(...p) <= 0) out.push(toSys(p));
  }
  return out;
}

/** Sign of a symbolic expression over sample points: +1, −1, or 0 when it changes / vanishes. */
function signOver(e: Expr, vars: string[], samples: number[][]): number {
  if (e.type === 'num') return Math.sign(e.value);
  const f = compileScalar(e, vars);
  let s = 0;
  for (const p of samples) {
    const v = f(...p);
    if (!Number.isFinite(v)) continue;
    const sv = Math.abs(v) < 1e-12 ? 0 : Math.sign(v);
    if (sv === 0) continue;
    if (s === 0) s = sv;
    else if (s !== sv) return 0;
  }
  return s;
}

const isZero = (e: Expr) => e.type === 'num' && e.value === 0;
const neg = (e: Expr) => simplify(mulList([num(-1), e]));
const sqrtE = (e: Expr): Expr => ({ type: 'call', callee: sym('sqrt'), args: [e] });

/**
 * Bounds on v from g rel 0: lows / highs (expressions in the other variables) and constraints left for
 * the outer variables; null when v cannot be isolated into one interval.
 */
function isolate(c: Constraint, v: string, vars: string[], samples: number[][]): { lows: Bound[]; highs: Bound[]; rest: Constraint[] } | null {
  const cs = polyCoeffsExpr(c.g, v);
  if (!cs) {
    const sq = unSqrt(c, vars, samples);
    if (sq === 'true') return { lows: [], highs: [], rest: [] };
    return sq && dependsOn(sq.g, v) ? isolate(sq, v, vars, samples) : sq ? { lows: [], highs: [], rest: [sq] } : null;
  }
  const up = upper(c.rel);
  if (cs.length === 2) {
    const [b, a] = cs;
    // a·v ≷ 0 with v ≥ 0: a condition on the outer variables only (e.g. r sin θ ≥ 0 → sin θ ≥ 0)
    if (POSITIVE.has(v) && isZero(b)) return { lows: [], highs: [], rest: [{ g: a, rel: c.rel }] };
    const sa = signOver(a, vars, samples);
    if (sa === 0) return null;
    const bound = simplify(mulList([num(-1), b, powS(a, num(-1))]));
    const high = up === sa > 0;
    return high ? { lows: [], highs: [{ e: bound }], rest: [] } : { lows: [{ e: bound }], highs: [], rest: [] };
  }
  if (cs.length === 3) {
    let [c0, b, a] = cs;
    let inside = up;
    const sa = signOver(a, vars, samples);
    if (sa === 0) return null;
    if (sa < 0) {
      [c0, b, a] = [neg(c0), neg(b), neg(a)];
      inside = !inside;
    }
    // roots (−b ∓ √D) / 2a, written ∓√(−c/a) when b = 0
    let r1: Expr, r2: Expr, disc: Expr;
    if (isZero(b)) {
      disc = simplify(mulList([num(-1), c0, powS(a, num(-1))]));
      r2 = simplify(sqrtE(disc));
      r1 = neg(r2);
    } else {
      disc = simplify(addList([powS(b, num(2)), mulList([num(-4), a, c0])]));
      const half = powS(mulList([num(2), a]), num(-1));
      r1 = simplify(mulList([addList([neg(b), neg(sqrtE(disc))]), half]));
      r2 = simplify(mulList([addList([neg(b), sqrtE(disc)]), half]));
    }
    const discRest: Constraint[] = disc.type === 'num' ? (disc.value < 0 ? [{ g: num(1), rel: '<=' }] : []) : [{ g: disc, rel: '>=' }];
    if (inside) {
      const tag = ++tagCounter;
      return { lows: [{ e: r1, tag }], highs: [{ e: r2, tag }], rest: discRest };
    }
    // outside the roots: one interval only for v ≥ 0 when the smaller root is ≤ 0 (c/a ≤ 0)
    if (POSITIVE.has(v) && signOver(simplify(mulList([c0, powS(a, num(-1))])), vars, samples) <= 0) return { lows: [{ e: r2 }], highs: [], rest: [] };
    return null;
  }
  return null;
}

/** Range of a coordinate for sampling / scanning: angles by definition, lengths and x, y, z from the box. */
function coordRange(v: string, region: RegionValue): [number, number] {
  if (v === 'θ') return [0, 2 * Math.PI];
  if (v === 'φ') return [0, Math.PI];
  const R = Math.max(...region.box.flat().map(Math.abs));
  if (v === 'r' || v === 'ρ') return [0, R * 1.8];
  const i = ['x', 'y', 'z'].indexOf(v);
  const b = region.box[i];
  // generous: a condition is only dropped when it holds well beyond the sampled extent too
  return b ? [b[0] - (b[1] - b[0]) * 0.25 - 0.1, b[1] + (b[1] - b[0]) * 0.25 + 0.1] : [-R, R];
}

/**
 * A condition on v alone that is not polynomial (cos φ ≥ 0, sin θ ≥ 0): constant bounds from the
 * sign changes of g on v's range, when the solution set is one interval.
 */
function scanIsolate(c: Constraint, v: string, region: RegionValue, system: CoordSystem): { lows: Bound[]; highs: Bound[]; rest: Constraint[] } | null {
  const others = [...freeSymbols(c.g)].filter((n) => n !== v && SYSTEM_VARS[system].includes(n));
  if (others.length) return null;
  const [a, b] = coordRange(v, region);
  const g = compileScalar(c.g, [v]);
  const ok = (t: number) => (upper(c.rel) ? g(t) <= 1e-12 : g(t) >= -1e-12);
  const cuts = [a, ...roots1D(g, a, b, 2000).roots.filter((r) => r > a + 1e-12 && r < b - 1e-12), b];
  const ivs: [number, number][] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    if (!ok((cuts[k] + cuts[k + 1]) / 2)) continue;
    const last = ivs[ivs.length - 1];
    if (last && Math.abs(last[1] - cuts[k]) < 1e-12) last[1] = cuts[k + 1];
    else ivs.push([cuts[k], cuts[k + 1]]);
  }
  if (ivs.length !== 1) return null;
  return { lows: [{ e: num(ivs[0][0]) }], highs: [{ e: num(ivs[0][1]) }], rest: [] };
}

/**
 * Drop feasibility conditions (low ≤ high) that already hold wherever the other conditions hold,
 * checked on random points of the outer variables' box — e.g. −√(4 − x² − y²) ≤ 0 given 4 − x² − y² ≥ 0.
 */
function dropImplied(rest: Constraint[], pairs: Set<Constraint>, outer: string[], region: RegionValue): Constraint[] {
  if (!pairs.size || !outer.length) return rest;
  const ranges = outer.map((v) => coordRange(v, region));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pts: number[][] = [];
  for (let k = 0; k < 1500; k++) pts.push(ranges.map(([a, b]) => a + (b - a) * rnd()));
  const f = rest.map((c) => {
    try {
      return compileScalar(c.g, outer);
    } catch {
      return null;
    }
  });
  const holds = (i: number, p: number[]) => {
    const v = f[i]?.(...p);
    if (v === undefined || Number.isNaN(v)) return false;
    return upper(rest[i].rel) ? v <= 1e-9 : v >= -1e-9;
  };
  const keep = rest.map(() => true);
  rest.forEach((c, i) => {
    if (!pairs.has(c) || !f[i]) return;
    let tested = 0;
    for (const p of pts) {
      if (!rest.every((_, j) => j === i || !keep[j] || holds(j, p))) continue;
      tested++;
      const v = f[i]!(...p);
      if (Number.isNaN(v) || !holds(i, p)) return;
    }
    if (tested >= 30) keep[i] = false;
  });
  return rest.filter((_, i) => keep[i]);
}

/** A numerically found break point snapped to a nearby simple value (integer, p/q, pπ/q). */
function snap(x: number): number {
  const tol = 1e-9 * Math.max(1, Math.abs(x));
  for (let q = 1; q <= 12; q++) {
    const p = Math.round(x * q);
    if (Math.abs(x - p / q) < tol) return p / q;
    const pp = Math.round((x * q) / Math.PI);
    if (pp !== 0 && Math.abs(x - (pp * Math.PI) / q) < tol) return (pp * Math.PI) / q;
  }
  return +x.toPrecision(14);
}

/**
 * a·√u + k ≤ 0 (or ≥) without v elsewhere under the root: square both sides where that is valid —
 * √(x² + y²) ≤ 3 → x² + y² ≤ 9. 'true' when the condition always holds.
 */
function unSqrt(c: Constraint, vars: string[], samples: number[][]): Constraint | 'true' | null {
  const g = upper(c.rel) ? simplify(c.g) : neg(c.g);
  const terms: Expr[] = [];
  const flat = (e: Expr): void => {
    if (e.type === 'bin' && e.op === '+') {
      flat(e.left);
      flat(e.right);
    } else terms.push(e);
  };
  flat(g);
  const rootOf = (t: Expr): { a: number; u: Expr } | null => {
    const fs: Expr[] = [];
    const ff = (e: Expr): void => {
      if (e.type === 'bin' && e.op === '*') {
        ff(e.left);
        ff(e.right);
      } else fs.push(e);
    };
    ff(t);
    let a = 1;
    let u: Expr | null = null;
    for (const f of fs) {
      if (f.type === 'num') a *= f.value;
      else if (!u && f.type === 'call' && f.callee.type === 'sym' && f.callee.name === 'sqrt' && f.args.length === 1) u = f.args[0];
      else if (!u && f.type === 'bin' && f.op === '^' && f.right.type === 'num' && f.right.value === 0.5) u = f.left;
      else return null;
    }
    return u ? { a, u } : null;
  };
  const idx = terms.findIndex((t) => rootOf(t));
  if (idx < 0) return null;
  const { a, u } = rootOf(terms[idx])!;
  const k = terms.length > 1 ? addList(terms.filter((_, i) => i !== idx)) : num(0);
  // √u ≤ m (a > 0, m = −k/a) or √u ≥ m (a < 0, m = k/|a|)
  const m = simplify(mulList([num(a > 0 ? -1 / a : 1 / -a), k]));
  const sm = signOver(m, vars, samples);
  const sq = simplify(addList([u, neg(powS(m, num(2)))]));
  if (a > 0) {
    if (m.type === 'num' ? m.value < 0 : sm < 0) return null;
    return { g: sq, rel: '<=' };
  }
  if (m.type === 'num' ? m.value <= 0 : sm < 0) return 'true';
  if (m.type !== 'num' && sm === 0) return null;
  return { g: sq, rel: '>=' };
}

const constValue = (e: Expr): number => {
  try {
    return compileScalar(e, [])();
  } catch {
    return NaN;
  }
};

/**
 * Iterated description of the region with the given order of integration (outer → inner), or null
 * when the region cannot be described that way.
 */
export function describe(region: RegionValue, system: CoordSystem, order: string[]): Description | null {
  const vars = SYSTEM_VARS[system].slice(0, region.dim);
  if (order.length !== vars.length || !order.every((v) => vars.includes(v))) return null;
  let cons = inSystem(region, system);
  const samples = regionSamples(region, system);
  if (!samples.length) return null;
  // samples ordered like `vars`; bounds are compiled in `order`
  const perm = order.map((v) => vars.indexOf(v));
  const ordered = samples.map((p) => perm.map((i) => p[i]));
  const levels: { v: string; lows: Bound[]; highs: Bound[] }[] = [];
  for (let i = order.length - 1; i >= 0; i--) {
    const v = order[i];
    const lows: Bound[] = [];
    const highs: Bound[] = [];
    const rest: Constraint[] = [];
    for (const c of cons) {
      if (!dependsOn(c.g, v)) {
        rest.push(c);
        continue;
      }
      const iso = isolate(c, v, order, ordered) ?? scanIsolate(c, v, region, system);
      if (!iso) {
        // the outermost variable may keep non-isolable conditions (sin θ ≥ 0): they are scanned
        if (i === 0 && [...freeSymbols(c.g)].every((n) => n === v || !vars.includes(n))) {
          rest.push(c);
          continue;
        }
        return null;
      }
      lows.push(...iso.lows);
      highs.push(...iso.highs);
      rest.push(...iso.rest);
    }
    const imp = IMPLICIT_RANGE[v];
    if (imp && system !== 'cartesian') {
      if (POSITIVE.has(v) || !lows.length) lows.push({ e: num(imp[0]) });
      if (Number.isFinite(imp[1]) && !highs.length) highs.push({ e: num(imp[1]) });
    }
    let next = rest;
    if (i > 0) {
      if (!lows.length || !highs.length) return null;
      // feasibility (low ≤ high) becomes a condition on the outer variables
      const pairs = new Set<Constraint>();
      for (const L of lows)
        for (const U of highs) {
          if (L.tag && L.tag === U.tag) continue;
          const g = simplify(addList([L.e, neg(U.e)]));
          if (g.type === 'num') {
            if (g.value > 1e-12) return null;
            continue;
          }
          const c = { g, rel: '<=' as Relation };
          pairs.add(c);
          rest.push(c);
        }
      next = dropImplied(rest, pairs, order.slice(0, i), region);
    }
    levels.unshift({ v, lows, highs });
    cons = next;
  }
  // outermost variable: constant bounds from isolated bounds, conditions checked by scanning
  const outer = levels[0];
  const scanned = cons.filter((c) => dependsOn(c.g, outer.v));
  const lowVals = outer.lows.map((b) => constValue(b.e)).filter((x) => !Number.isNaN(x));
  const highVals = outer.highs.map((b) => constValue(b.e)).filter((x) => !Number.isNaN(x));
  const A = Math.max(...lowVals);
  const B = Math.min(...highVals);
  if (!Number.isFinite(A) || !Number.isFinite(B) || !(B > A)) return null;
  return piecesOf(system, order, levels, scanned, A, B);
}

function piecesOf(system: CoordSystem, order: string[], levels: { v: string; lows: Bound[]; highs: Bound[] }[], scanned: Constraint[], A: number, B: number): Description | null {
  const v0 = order[0];
  const f0 = (e: Expr) => compileScalar(e, [v0]);
  // break points: roots of scanned conditions and where competing bounds of the second level cross
  const cuts = new Set<number>([A, B]);
  const addRoots = (g: (t: number) => number) => {
    for (const r0 of roots1D(g, A, B, 1200).roots) {
      const r = snap(r0);
      if (r > A + 1e-9 * Math.max(1, Math.abs(A)) && r < B - 1e-9 * Math.max(1, Math.abs(B))) cuts.add(r);
    }
  };
  for (const c of scanned) addRoots(f0(c.g));
  if (levels.length > 1) {
    const { lows, highs } = levels[1];
    const pairs = (bs: Bound[]) => bs.flatMap((p, i) => bs.slice(i + 1).map((q) => [p, q] as const));
    for (const [p, q] of [...pairs(lows), ...pairs(highs)]) {
      const fp = f0(p.e);
      const fq = f0(q.e);
      addRoots((t) => fp(t) - fq(t));
    }
  }
  const pts = [...cuts].sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 1e-11 * Math.max(1, Math.abs(x)));
  const pieces: Piece[] = [];
  const holds = (c: Constraint, t: number) => {
    const v = compileScalar(c.g, [v0])(t);
    return upper(c.rel) ? v <= 1e-12 : v >= -1e-12;
  };
  for (let k = 0; k + 1 < pts.length; k++) {
    const [a, b] = [pts[k], pts[k + 1]];
    // the test point: the midpoint, or a quarter point when the region pinches to nothing there
    const cands = [0.5, 0.3, 0.7].map((s) => a + (b - a) * s);
    let m = cands[0];
    if (levels.length > 1) {
      const lo1 = levels[1].lows.map((q) => f0(q.e));
      const hi1 = levels[1].highs.map((q) => f0(q.e));
      m = cands.find((t) => Math.min(...hi1.map((h) => h(t))) > Math.max(...lo1.map((l) => l(t))) + 1e-12) ?? cands[0];
    }
    if (!scanned.every((c) => holds(c, m))) continue;
    const lv: Level[] = [{ v: v0, lo: num(a), hi: num(b) }];
    let approx = false;
    let ok = true;
    // second level: the active bounds at the midpoint
    if (levels.length > 1) {
      const { v, lows, highs } = levels[1];
      const pick = (bs: Bound[], best: (x: number, y: number) => boolean) => {
        let e = bs[0].e;
        let val = f0(e)(m);
        for (const q of bs.slice(1)) {
          const w = f0(q.e)(m);
          if (Number.isNaN(val) || best(w, val)) [e, val] = [q.e, w];
        }
        return { e, val };
      };
      const lo = pick(lows, (x, y) => x > y);
      const hi = pick(highs, (x, y) => x < y);
      if (!(hi.val > lo.val + 1e-12)) ok = false;
      lv.push({ v, lo: lo.e, hi: hi.e });
      // third level: bounds in two variables; one wins everywhere on a sample, else keep max / min
      if (ok && levels.length > 2) {
        const L3 = levels[2];
        const f2 = (e: Expr) => compileScalar(e, [v0, v]);
        const pts2: [number, number][] = [];
        for (let i = 1; i <= 5; i++)
          for (let j = 1; j <= 5; j++) {
            const t = a + ((b - a) * i) / 6;
            const l = compileScalar(lo.e, [v0])(t);
            const h = compileScalar(hi.e, [v0])(t);
            pts2.push([t, l + ((h - l) * j) / 6]);
          }
        const choose = (bs: Bound[], best: (x: number, y: number) => boolean, name: 'max' | 'min'): Expr => {
          if (bs.length === 1) return bs[0].e;
          const fs = bs.map((q) => f2(q.e));
          const winners = new Set<number>();
          for (const [s, u] of pts2) {
            let w = 0;
            for (let q = 1; q < fs.length; q++) if (best(fs[q](s, u), fs[w](s, u))) w = q;
            winners.add(w);
          }
          if (winners.size === 1) return bs[[...winners][0]].e;
          approx = true;
          return { type: 'call', callee: sym(name), args: bs.map((q) => q.e) };
        };
        lv.push({ v: L3.v, lo: choose(L3.lows, (x, y) => x > y, 'max'), hi: choose(L3.highs, (x, y) => x < y, 'min') });
      }
    }
    if (!ok) continue;
    const prev = pieces[pieces.length - 1];
    const same = prev && prev.levels.slice(1).every((l, i) => toText(l.lo, true) === toText(lv[i + 1].lo, true) && toText(l.hi, true) === toText(lv[i + 1].hi, true)) && constValue(prev.levels[0].hi) === a;
    if (same) prev.levels[0] = { ...prev.levels[0], hi: num(b) };
    else pieces.push({ levels: lv, ...(approx ? { approx } : {}) });
  }
  return pieces.length ? { system, order, pieces } : null;
}

/** Orders of integration worth trying, most natural first. */
export function naturalOrders(system: CoordSystem, dim: number): string[][] {
  switch (system) {
    case 'polar':
      return [['θ', 'r'], ['r', 'θ']];
    case 'cylindrical':
      return [['θ', 'r', 'z'], ['z', 'θ', 'r'], ['θ', 'z', 'r']];
    case 'spherical':
      return [['θ', 'φ', 'ρ'], ['θ', 'ρ', 'φ'], ['ρ', 'θ', 'φ']];
    default:
      return dim === 2
        ? [['x', 'y'], ['y', 'x']]
        : [['x', 'y', 'z'], ['y', 'x', 'z'], ['x', 'z', 'y'], ['z', 'x', 'y'], ['y', 'z', 'x'], ['z', 'y', 'x']];
  }
}

/** Does the region (or an integrand) look round — x² + y² terms that polar coordinates simplify? */
export function roundness(exprs: Expr[], dim: number): CoordSystem[] {
  const sq = (e: Expr, v: string) => {
    const cs = polyCoeffsExpr(e, v);
    return !!cs && cs.length >= 3;
  };
  const txt = exprs.map((e) => toText(e, true)).join(' ');
  const hasXY = exprs.some((e) => sq(e, 'x') && sq(e, 'y')) || /x\^2\s*\+\s*y\^2/.test(txt);
  if (dim === 2) return hasXY ? ['polar'] : [];
  const hasXYZ = exprs.some((e) => sq(e, 'x') && sq(e, 'y') && sq(e, 'z'));
  if (hasXYZ) return ['spherical', 'cylindrical'];
  return hasXY ? ['cylindrical', 'spherical'] : [];
}

// ------------------------------------------------------------------ presentation

export function varLatex(v: string): string {
  return v === 'θ' ? '\\theta' : v === 'φ' ? '\\varphi' : v === 'ρ' ? '\\rho' : v;
}

export function boundLatex(e: Expr): string {
  if (e.type === 'num') return numLatex(e.value);
  return toLatex(simplify(e));
}

export function numLatex(x: number): string {
  if (Math.abs(x) < 1e-13) return '0';
  const pi = x / Math.PI;
  for (const q of [1, 2, 3, 4, 6, 8, 12]) {
    const p = Math.round(pi * q);
    if (p !== 0 && Math.abs(pi * q - p) < 1e-9) {
      const g = gcd(Math.abs(p), q);
      const [pp, qq] = [p / g, q / g];
      const top = `${pp < 0 ? '-' : ''}${Math.abs(pp) === 1 ? '' : Math.abs(pp)}\\pi`;
      return qq === 1 ? top : `\\frac{${top}}{${qq}}`;
    }
  }
  if (Math.abs(x - Math.round(x)) < 1e-9 * Math.max(1, Math.abs(x))) return String(Math.round(x));
  for (let q = 2; q <= 64; q++) {
    const p = Math.round(x * q);
    if (Math.abs(x * q - p) < 1e-9 && gcd(Math.abs(p), q) === 1) return `${p < 0 ? '-' : ''}\\frac{${Math.abs(p)}}{${q}}`;
  }
  const s = Math.round(x * x);
  if (Math.abs(x * x - s) < 1e-9 && s < 1000) return `${x < 0 ? '-' : ''}\\sqrt{${s}}`;
  return String(+x.toPrecision(6));
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** ∫_a^b ∫_{g₁}^{g₂} … d(inner) … d(outer) for one piece, with the integrand's LaTeX. */
export function pieceLatex(p: Piece, integrand: string): string {
  const ints = p.levels.map((l) => `\\int_{${boundLatex(l.lo)}}^{${boundLatex(l.hi)}}`).join('');
  const ds = [...p.levels].reverse().map((l) => `d${varLatex(l.v)}`).join('\\,');
  return `${ints} ${integrand}\\,${ds}`;
}

export function descriptionLatex(d: Description, integrand = '1'): string {
  return d.pieces.map((p) => pieceLatex(p, integrand)).join(' + ');
}

/** The region as inequalities in the description's order: 0 ≤ x ≤ 1, x² ≤ y ≤ x. */
export function boundsLatex(d: Description): string {
  return d.pieces
    .map((p) => p.levels.map((l) => `${boundLatex(l.lo)} \\le ${varLatex(l.v)} \\le ${boundLatex(l.hi)}`).join(',\\; '))
    .join('\\quad\\text{or}\\quad ');
}