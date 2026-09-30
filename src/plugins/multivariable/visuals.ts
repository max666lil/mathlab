/**
 * Visual operations of Phase 3b (math side): the strip sweep of an iterated description, Riemann sums
 * over a region (boxes under a surface / squares filling a region) and the polar grid.
 */
import { Expr } from '../../math-core/ast';
import { Builtin, EvalError } from '../../math-core/builtins';
import { FunctionValue, MathValue, scalar } from '../../math-core/values';
import { compileScalar } from '../../math-core/compile';
import { toText } from '../../math-core/symbolic/print';
import { visual } from '../../visualization/scene-model';
import { bindEnv } from '../core-calculus/analysis-builtins';
import { CoordSystem, SYSTEM_VARS, substitute } from './coords';
import { RegionValue, Description, expectRegion, describe, naturalOrders } from './region';
import { sym } from '../../math-core/ast';

const V = 'value' as const;
const RAW = 'raw' as const;

const SYSTEMS: Record<string, CoordSystem> = { polar: 'polar', cylindrical: 'cylindrical', spherical: 'spherical', cartesian: 'cartesian' };

function orderOf(raw: Expr | undefined): string[] | undefined {
  if (!raw) return undefined;
  const names: string[] = [];
  const walk = (e: Expr) => {
    if (e.type === 'sym') names.push(e.name);
    else if (e.type === 'bin') {
      walk(e.left);
      walk(e.right);
    }
  };
  walk(raw);
  const vars = [...names.join('').matchAll(/d(θ|φ|ρ|[a-z])/g)].map((m) => m[1]);
  return vars.length ? vars.reverse() : undefined;
}

const nameOf = (raw: Expr | undefined, fb: string) => (raw?.type === 'sym' ? raw.name : fb);

/** A description as plain data for drawers: bounds as text + compiled on demand. */
export interface StripData {
  system: CoordSystem;
  order: string[];
  pieces: { a: number; b: number; lo: string; hi: string; loTex: string; hiTex: string }[];
}

function stripData(d: Description): StripData {
  return {
    system: d.system,
    order: d.order,
    pieces: d.pieces.map((p) => ({
      a: compileScalar(p.levels[0].lo, [])(),
      b: compileScalar(p.levels[0].hi, [])(),
      lo: toText(p.levels[1].lo, true),
      hi: toText(p.levels[1].hi, true),
      loTex: toText(p.levels[1].lo),
      hiTex: toText(p.levels[1].hi),
    })),
  };
}

const strips: Builtin = {
  name: 'strips', command: true, minArgs: 1, maxArgs: 1, argModes: [V], keywords: { in: RAW, order: RAW }, category: 'multivariable',
  signature: 'strips R [in polar] [order dx dy]', doc: 'Animated strip sweeping across a plane region: the inner bounds of its iterated description.',
  apply: ([rv], _ctx, raw, kw) => {
    const region = expectRegion(rv);
    if (region.dim !== 2) throw new EvalError('strips: a plane region');
    const sysRaw = kw.raw.in;
    const system = sysRaw?.type === 'sym' && SYSTEMS[sysRaw.name] ? SYSTEMS[sysRaw.name] : region.system;
    const ord = orderOf(kw.raw.order);
    for (const o of ord ? [ord] : naturalOrders(system, 2)) {
      const d = describe(region, system, o);
      if (!d) continue;
      const name = nameOf(raw[0], 'R');
      return visual('strips', { data: stripData(d), test: region.test, timeline: `strip:${name}:${system}:${o.join('')}`, stops: [], loop: true, loopLabel: 'sweep' }, `strips of ${name}`, 'strips');
    }
    throw new EvalError('this region has no iterated description in that order');
  },
};

/** The region's extent from its iterated descriptions (exact for rectangles), else the sampled box. */
export function gridBox(region: RegionValue): [number, number][] {
  const ext = (order: string[]): [number, number] | null => {
    const d = region.system === 'cartesian' ? describe(region, 'cartesian', order) : null;
    if (!d) return null;
    const vals = d.pieces.flatMap((p) => [compileScalar(p.levels[0].lo, [])(), compileScalar(p.levels[0].hi, [])()]);
    return [Math.min(...vals), Math.max(...vals)];
  };
  return [ext(['x', 'y']) ?? region.box[0], ext(['y', 'x']) ?? region.box[1]];
}

/** Midpoint / lower / upper Riemann sums on an n×n grid of the region's box (cells with centre in R). */
export function riemannSums(f: (x: number, y: number) => number, region: RegionValue, n: number, box = gridBox(region)) {
  const [[x0, x1], [y0, y1]] = box;
  const G = region.test.eval as (x: number, y: number) => number;
  const hx = (x1 - x0) / n;
  const hy = (y1 - y0) / n;
  let mid = 0;
  let lo = 0;
  let hi = 0;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const cx = x0 + (i + 0.5) * hx;
      const cy = y0 + (j + 0.5) * hy;
      if (G(cx, cy) > 0) continue;
      const vals: number[] = [];
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [0.5, 0], [0, 0.5], [1, 0.5], [0.5, 1]]) {
        const w = f(x0 + (i + u) * hx, y0 + (j + v) * hy);
        if (Number.isFinite(w)) vals.push(w);
      }
      const m = f(cx, cy);
      mid += (Number.isFinite(m) ? m : 0) * hx * hy;
      if (vals.length) {
        lo += Math.min(...vals) * hx * hy;
        hi += Math.max(...vals) * hx * hy;
      }
    }
  return { mid, lo, hi };
}

const NS = [2, 4, 8, 16, 32];

const riemann: Builtin = {
  name: 'riemann', command: true, minArgs: 1, maxArgs: 3, argModes: [RAW, V, V], keywords: { over: V }, category: 'multivariable',
  signature: 'riemann f over R  ·  riemann(f, R, n)', doc: 'Riemann sums of f over a plane region on n×n grids (midpoint, lower, upper), refining 2 → 32.',
  apply: ([, rArg, nArg], ctx, raw, kw) => {
    const region = expectRegion(kw.values.over ?? rArg);
    if (region.dim !== 2) throw new EvalError('riemann: a plane region (x, y)');
    const r0 = raw[0];
    let fn: FunctionValue;
    const named = r0?.type === 'sym' ? ctx.lookup(r0.name) : undefined;
    if (named?.kind === 'function') fn = named as FunctionValue;
    else fn = ctx.makeFunction(r0, ['x', 'y']);
    if (fn.params.length !== 2 || !fn.expr) throw new EvalError('riemann: a function of x and y');
    const e = substitute(bindEnv(fn.expr, fn.env), { [fn.params[0]]: sym('x'), [fn.params[1]]: sym('y') });
    const f = compileScalar(e, ['x', 'y']) as (x: number, y: number) => number;
    const n = nArg ? Math.round((nArg as { value: number }).value) : 8;
    if (!(n >= 1 && n <= 400)) throw new EvalError('n between 1 and 400');
    const box = gridBox(region);
    const sums = NS.map((k) => riemannSums(f, region, k, box));
    const s = riemannSums(f, region, n, box);
    const fmt = (x: number) => String(+x.toPrecision(5));
    const captions = NS.slice(1).map((k, i) => {
      const q = sums[i + 1];
      return `n = ${k}: lower ${fmt(q.lo)} · midpoint ${fmt(q.mid)} · upper ${fmt(q.hi)}`;
    });
    const fName = nameOf(r0, 'f');
    const R = nameOf(kw.raw.over ?? raw[1], 'R');
    const cfn: FunctionValue = { ...fn, params: ['x', 'y'], expr: e, eval: f as FunctionValue['eval'] };
    return scalar(s.mid, {
      certainty: 'numeric',
      evidence: `midpoint Riemann sum on a ${n}×${n} grid of the box around ${R} (cells whose centre lies in ${R}); lower ${fmt(s.lo)}, upper ${fmt(s.hi)} from the smallest / largest sampled value in each cell`,
      derivation: `\\sum_{i,j} ${fName}(x_i^{*}, y_j^{*})\\,\\Delta x\\,\\Delta y`,
      visuals: [visual('riemann', { fn: cfn, test: region.test, box, frameBox: box, seeThrough: true, ns: NS, timeline: `riemann:${fName}:${R}`, stops: NS.map((k) => `${k}×${k}`), captions }, `Riemann sum of ${fName}`, 'riemann')],
    }) as MathValue;
  },
};

const polargrid: Builtin = {
  name: 'polargrid', command: true, minArgs: 1, maxArgs: 1, argModes: [V], category: 'multivariable',
  signature: 'polargrid R', doc: 'The polar grid over a plane region, with one cell r Δr Δθ highlighted.',
  apply: ([rv], _ctx, raw) => {
    const region = expectRegion(rv);
    if (region.dim !== 2) throw new EvalError('polargrid: a plane region');
    return visual('polargrid', { test: region.test, box: region.box }, `polar grid of ${nameOf(raw[0], 'R')}`, 'polargrid');
  },
};

export const visualBuiltins: Builtin[] = [strips, riemann, polargrid];
export { SYSTEM_VARS };