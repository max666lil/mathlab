/**
 * Scalar fields of three variables (Phase 3a, Hughes-Hallett §12.5, §14.5): critical points in ℝ³
 * classified by the Hessian's eigenvalues, level surfaces f = c (marching tetrahedra), slice planes,
 * the tangent plane to a level surface (∇f(P)·(r − P) = 0) and implicit surfaces G(x, y, z) = 0.
 */
import { Expr, num, sym, mapExpr } from '../../math-core/ast';
import { Builtin, EvalContext, EvalError, expectFunction, expectCoords, expectNumber } from '../../math-core/builtins';
import { FunctionValue, MathValue, Certainty } from '../../math-core/values';
import { simplify, addList, mulList } from '../../math-core/symbolic/simplify';
import { toLatex } from '../../math-core/symbolic/print';
import { newtonSystem, gridSeeds } from '../../math-core/numeric/roots';
import { symmetricEigen } from '../../math-core/linalg';
import { PointSetValue, SetPoint, DomainValue } from '../../math-core/result-values';
import { domainConditions } from '../../math-core/domain';
import { visual } from '../../visualization/scene-model';
import { gradOf, hessianOf, asScalarField } from '../core-calculus/math';
import { bindEnv } from '../core-calculus/analysis-builtins';

export type Box3 = [number, number][];
export const DEFAULT_BOX: Box3 = [[-2.5, 2.5], [-2.5, 2.5], [-2.5, 2.5]];

export function isField3(v: MathValue | undefined): v is FunctionValue {
  const f = v as FunctionValue;
  return v?.kind === 'function' && f.out === 'scalar' && f.params.length === 3 && !!f.expr;
}

/** The box a field is shown in: its parameter ranges when given, else the default. */
export function boxOf(f: FunctionValue): Box3 {
  return f.params.map((p, i) => f.ranges?.[p] ?? DEFAULT_BOX[i]) as Box3;
}

/** Critical points of f(x, y, z) by Newton's method from a grid of seeds (exact for a constant Hessian). */
export function critical3D(ctx: EvalContext, f: FunctionValue): PointSetValue {
  asScalarField(f);
  const G = gradOf(ctx, f).eval as (...p: number[]) => number[];
  const HH = hessianOf(ctx, f).eval as (...p: number[]) => number[][];
  const F = f.eval as (...p: number[]) => number;
  const hExpr = hessianOf(ctx, f).expr;
  const constH = hExpr?.type === 'matrix' && hExpr.rows.flat().every((c) => !f.params.some((p) => JSON.stringify(bindEnv(c, f.env)).includes(`"name":"${p}"`)));
  let sols: number[][] = [];
  let certainty: Certainty = 'numeric';
  let evidence: string;
  if (constH) {
    const h = HH(0, 0, 0);
    const g0 = G(0, 0, 0);
    const s = solve3(h, g0.map((v) => -v));
    if (s) {
      sols = [s];
      certainty = 'exact';
      evidence = '∇f is affine (constant Hessian): unique solution of a linear system';
    } else evidence = 'constant singular Hessian: the critical set is a line, a plane or empty (not enumerated)';
  } else {
    const seeds = [...gridSeeds([[-1.5, 1.5], [-1.5, 1.5], [-1.5, 1.5]], 4), ...gridSeeds([[-5, 5], [-5, 5], [-5, 5]], 4)];
    const r = newtonSystem((p) => G(p[0], p[1], p[2]), seeds, (p) => HH(p[0], p[1], p[2]));
    sols = r.solutions.filter((p) => p.every((c) => Math.abs(c) <= 20));
    evidence = `Newton's method from ${r.seeds} starting points in [−5, 5]³; each point has ‖∇f‖ < 10⁻⁹. Points outside the search box may be missed.`;
  }
  sols.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  const points: SetPoint[] = sols.map((p) => {
    const hm = HH(p[0], p[1], p[2]);
    const ev = symmetricEigen(hm).map((e) => e.value);
    const tol = 1e-9;
    const type = ev.every((l) => l > tol) ? 'local min' : ev.every((l) => l < -tol) ? 'local max' : ev.some((l) => l > tol) && ev.some((l) => l < -tol) ? 'saddle' : 'degenerate';
    return { coords: p.map((c) => (Math.abs(c) < 1e-12 ? 0 : c)), value: F(p[0], p[1], p[2]), type, hessian: hm };
  });
  return {
    kind: 'pointset', what: 'critical points', dim: 3, points, certainty, evidence,
    visuals: points.map((p) => visual('point', { coords: p.coords }, p.type, 'critical')),
  } as unknown as PointSetValue;
}

function solve3(A: number[][], b: number[]): number[] | null {
  const M = A.map((r, i) => [...r, b[i]]);
  const n = 3;
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (Math.abs(M[p][k]) < 1e-12) return null;
    [M[k], M[p]] = [M[p], M[k]];
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const fct = M[i][k] / M[k][k];
      for (let j = k; j <= n; j++) M[i][j] -= fct * M[k][j];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

export function domain3D(f: FunctionValue): DomainValue {
  const conds = f.expr ? domainConditions(bindEnv(f.expr, f.env), f.params) : [];
  return { kind: 'domain', vars: f.params, conditions: conds.map((c) => c.latex), certainty: 'exact', evidence: conds.length ? 'conditions read from the formula' : 'no restricting operations' } as DomainValue;
}

/** Nice levels for nested level surfaces: quantiles of f over the box. */
export function levelsOf(f: FunctionValue, box: Box3, k = 4): number[] {
  const F = f.eval as (...p: number[]) => number;
  const vals: number[] = [];
  const n = 14;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++)
      for (let l = 0; l <= n; l++) {
        const v = F(...box.map(([a, b], d) => a + ((b - a) * [i, j, l][d]) / n));
        if (Number.isFinite(v)) vals.push(v);
      }
  if (!vals.length) return [];
  vals.sort((a, b) => a - b);
  const nice = (x: number) => {
    const s = Math.pow(10, Math.floor(Math.log10(Math.abs(x) || 1)) - 1);
    return Math.round(x / s) * s;
  };
  const out = [...new Set(Array.from({ length: k }, (_, i) => nice(vals[Math.floor(((i + 1) / (k + 1)) * (vals.length - 1))])))];
  return out;
}

const fn = (raw: Expr | undefined, fb = 'f') => (raw?.type === 'sym' ? raw.name : fb);

/** levelsurface(f, c) — one level surface; levelsurfaces(f) — nested ones at nice levels. */
const levelsurface: Builtin = {
  name: 'levelsurface', minArgs: 2, maxArgs: 2, argModes: ['function', 'value'], category: 'multivariable',
  signature: 'levelsurface(f, c)', doc: 'The level surface f(x, y, z) = c.',
  apply: ([fv, cv], _ctx, raw) => {
    const f = expectFunction(fv);
    if (f.params.length !== 3) throw new EvalError('levelsurface: a function of x, y, z');
    const c = cv?.kind === 'point' ? (f.eval as (...p: number[]) => number)(...expectCoords(cv)) : expectNumber(cv);
    return visual('isosurface', { fn: f, levels: [c], box: boxOf(f) }, `${fn(raw[0])} = ${+c.toPrecision(5)}`, 'level');
  },
};

const levelsurfaces: Builtin = {
  name: 'levelsurfaces', minArgs: 1, maxArgs: 2, argModes: ['function', 'value'], category: 'multivariable',
  signature: 'levelsurfaces(f [, [c1, c2, …]])', doc: 'Nested level surfaces of f(x, y, z).',
  apply: ([fv, lv], _ctx, raw) => {
    const f = expectFunction(fv);
    if (f.params.length !== 3) throw new EvalError('levelsurfaces: a function of x, y, z');
    const levels = lv?.kind === 'list' ? (lv as { items: MathValue[] }).items.map((i) => expectNumber(i)) : levelsOf(f, boxOf(f));
    return visual('isosurface', { fn: f, levels, box: boxOf(f) }, `level surfaces of ${fn(raw[0])}`, 'levels');
  },
};

/** sliceplane(f, 'z', c): f on a coordinate plane as a heat map inside the box. */
const sliceplane: Builtin = {
  name: 'sliceplane', minArgs: 3, maxArgs: 3, argModes: ['function', 'raw', 'value'], category: 'multivariable',
  signature: 'sliceplane(f, z, c)', doc: 'The values of f(x, y, z) on the plane x = c, y = c or z = c.',
  apply: ([fv, , cv], _ctx, raw) => {
    const f = expectFunction(fv);
    const ax = raw[1]?.type === 'sym' ? raw[1].name : '';
    const axis = f.params.indexOf(ax);
    if (f.params.length !== 3 || axis < 0) throw new EvalError(`sliceplane(f, ${f.params[2] ?? 'z'}, c): an axis of f`);
    return visual('sliceplane', { fn: f, axis, at: expectNumber(cv), box: boxOf(f) }, `${fn(raw[0])} on ${ax} = ${+expectNumber(cv).toPrecision(4)}`, 'slice');
  },
};

/** The tangent plane to the level surface through P: ∇f(P)·(r − P) = 0 (shown as a small patch). */
export function levelTangent(ctx: EvalContext, f: FunctionValue, P: number[], name: string): MathValue {
  const g = gradOf(ctx, f).eval(...P) as number[];
  if (g.every((c) => Math.abs(c) < 1e-14)) throw new EvalError(`∇${name} = 0 at the point: no tangent plane to the level surface`);
  const e = simplify(addList(f.params.map((p, i) => mulList([num(g[i]), addList([sym(p), num(-P[i])])]))));
  const plane = ctx.makeFunction(e, f.params);
  const w = 0.8;
  const box = P.map((c) => [c - w, c + w]) as Box3;
  return {
    kind: 'equation3', latex: `${toLatex(e)} = 0`, normal: g, point: P, certainty: 'exact', evidence: 'the gradient is normal to the level surface',
    visuals: [visual('isosurface', { fn: plane, levels: [0], box, flat: true }, 'tangent plane', 'tangent')],
  } as unknown as MathValue;
}

/** A Hughes-Hallett "level surface" relation G(x, y, z) = 0 as a typed object. */
export interface ImplicitSurface {
  kind: 'implicitsurface';
  fn: FunctionValue;
  latex: string;
  box: Box3;
  key: string;
  [k: string]: unknown;
}

/** Bounding box of {G = 0}: a coarse scan for sign changes in [−8, 8]³. */
export function implicitBox(G: (...p: number[]) => number): Box3 {
  const n = 28;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const at = (i: number) => -8 + (16 * i) / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++) {
        const v = [G(at(i), at(j), at(k)), G(at(i + 1), at(j), at(k)), G(at(i), at(j + 1), at(k)), G(at(i), at(j), at(k + 1))];
        if (v.some((x) => x <= 0) && v.some((x) => x > 0)) {
          [at(i), at(j), at(k)].forEach((c, d) => {
            lo[d] = Math.min(lo[d], c);
            hi[d] = Math.max(hi[d], c + 16 / n);
          });
        }
      }
  if (!Number.isFinite(lo[0])) return DEFAULT_BOX;
  return lo.map((l, d) => {
    const pad = (hi[d] - l) * 0.08 + 0.1;
    return [Math.max(-8, l - pad), Math.min(8, hi[d] + pad)] as [number, number];
  }) as Box3;
}

const implicitsurface: Builtin = {
  name: 'implicitsurface', minArgs: 1, maxArgs: 1, argModes: ['raw'], category: 'multivariable',
  signature: 'x^2 + y^2 + z^2 = 4', doc: 'A surface G(x, y, z) = 0 given by an equation.',
  apply: (_args, ctx, raw) => {
    const e = raw[0];
    if (e?.type !== 'eq') throw new EvalError('an equation in x, y, z');
    const g = ctx.makeFunction({ type: 'bin', op: '-', left: e.left, right: e.right }, ['x', 'y', 'z']);
    const G = g.eval as (...p: number[]) => number;
    // ax + by + cz = d is shown as a·x + b·y + c·z = d (letters that are defined names or variables)
    const shown = mapExpr(e, (n) => {
      if (n.type !== 'sym' || [...n.name].length < 2 || ctx.lookup(n.name)) return n;
      const letters = [...n.name];
      return letters.every((c) => 'xyz'.includes(c) || ctx.lookup(c)) ? mulList(letters.map((c) => sym(c))) : n;
    });
    return { kind: 'implicitsurface', fn: g, latex: toLatex(shown), box: implicitBox(G), key: `isurf|${g.key}`, certainty: 'exact' } as unknown as MathValue;
  },
};

/** Wrap a builtin so that functions of three variables take the 3-D path. */
function threeD(base: Builtin | undefined, three: (args: (MathValue | undefined)[], ctx: EvalContext, raw: Expr[], kw: { values: Record<string, MathValue | undefined> }) => MathValue): Builtin | undefined {
  if (!base) return undefined;
  return {
    ...base,
    apply: (args, ctx, raw, kw) => {
      const f = args[0] as FunctionValue | undefined;
      if (f?.kind === 'function' && f.params.length === 3 && f.out === 'scalar') return three(args, ctx, raw, kw);
      return base.apply(args, ctx, raw, kw);
    },
  };
}

export function field3dWrappers(get: (n: string) => Builtin | undefined): Builtin[] {
  return [
    threeD(get('critical'), ([f], ctx) => critical3D(ctx, f as FunctionValue) as unknown as MathValue),
    threeD(get('domain'), ([f]) => domain3D(f as FunctionValue) as unknown as MathValue),
    threeD(get('tangent'), ([f, p], ctx, raw, kw) => levelTangent(ctx, f as FunctionValue, expectCoords(kw.values.at ?? p, 'a point (x, y, z)'), fn(raw[0]))),
  ].filter((b): b is Builtin => !!b);
}

export const field3dBuiltins: Builtin[] = [levelsurface, levelsurfaces, sliceplane, implicitsurface];