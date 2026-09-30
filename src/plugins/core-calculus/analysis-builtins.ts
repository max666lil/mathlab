/**
 * Analysis builtins — the single source of truth for automatic analysis. The Analysis panel calls
 * exactly these (`critical(f)`, `domain(f)`, …); users can type the same commands and keep the
 * results as named objects. Every result carries a certainty label and evidence.
 */
import { Expr, num, sym, mapExpr, freeSymbols, children } from '../../math-core/ast';
import { Builtin, EvalContext, EvalError, expectCoords, expectFunction, expectNumber, expectVector } from '../../math-core/builtins';
import { FunctionValue, MathValue, scalar, Certainty } from '../../math-core/values';
import { diff } from '../../math-core/symbolic/diff';
import { simplify } from '../../math-core/symbolic/simplify';
import { expand, polyCoeffs, quadraticRoots } from '../../math-core/symbolic/expand';
import { antiderivative } from '../../math-core/symbolic/integrate';
import { symbolLatex, toLatex } from '../../math-core/symbolic/print';
import { compileScalar, NumericEnv } from '../../math-core/compile';
import { roots1D, newtonSystem, gridSeeds } from '../../math-core/numeric/roots';
import { limitAt, limitInf, NumericLimit } from '../../math-core/numeric/limits';
import { integrateNumeric } from '../../math-core/numeric/quad';
import { domainConditions, scanDomain1D, DomainCondition } from '../../math-core/domain';
import { symmetricEigen, dot, normalize, norm } from '../../math-core/linalg';
import {
  PointSetValue, SetPoint, IntervalsValue, Interval, DomainValue, LimitValue, AsymptotesValue, FocusValue, itemOf, rn,
} from '../../math-core/result-values';
import { gradOf, hessianOf, localData, taylorExpr, asScalarField } from './math';
import { visual } from '../../visualization/scene-model';
import { getBuiltin } from '../../math-core/builtins';
import { definePlugin } from '../plugin-api';

/** Search window for 1-D scans (reported as evidence). */
export const WINDOW_1D: [number, number] = [-20, 20];
const W1 = `[${WINDOW_1D[0]}, ${WINDOW_1D[1]}]`;

type F1 = (x: number) => number;

// ------------------------------------------------------------------ helpers

/** Substitute the numeric environment (parameters, P.x …) into an expression. */
export function bindEnv(e: Expr, env: NumericEnv): Expr {
  return mapExpr(e, (n) => {
    if (n.type === 'sym' && typeof env[n.name] === 'number') return num(env[n.name] as number);
    if (n.type === 'member' && n.object.type === 'sym' && Array.isArray(env[n.object.name])) {
      const i = ({ x: 0, y: 1, z: 2 } as Record<string, number>)[n.prop];
      const arr = env[n.object.name] as number[];
      if (i !== undefined && i < arr.length) return num(arr[i]);
    }
    return n;
  });
}

export function oneVar(f: FunctionValue, what = 'this'): { f: FunctionValue; x: string; e: Expr } {
  asScalarField(f);
  if (f.params.length !== 1) throw new EvalError(`${what} needs a function of one variable`);
  if (!f.expr) throw new EvalError(`${f.label ?? 'f'} has no symbolic form`);
  return { f, x: f.params[0], e: bindEnv(f.expr, f.env) };
}

const cache = new Map<string, unknown>();
function memo<T>(key: string, make: () => T): T {
  if (cache.has(key)) return cache.get(key) as T;
  const v = make();
  if (cache.size > 400) cache.delete(cache.keys().next().value!);
  cache.set(key, v);
  return v;
}
/** Test hook: how many times each expensive search really ran. */
export const searchCounter: Record<string, number> = {};
const counted = <T>(name: string, fn: () => T): T => {
  searchCounter[name] = (searchCounter[name] ?? 0) + 1;
  return fn();
};

/** Real roots of a 1-D expression: exact for polynomials of degree ≤ 2, else scanned. */
function rootsOf(e: Expr, x: string): { roots: number[]; certainty: Certainty; evidence: string } {
  const c = polyCoeffs(e, x);
  if (c) {
    if (c.length === 1) return { roots: [], certainty: 'exact', evidence: c[0] === 0 ? 'identically zero' : 'non-zero constant' };
    const q = quadraticRoots(c)?.map((r) => (r === 0 ? 0 : r));
    if (q) return { roots: q, certainty: 'exact', evidence: c.length === 2 ? 'linear equation' : 'quadratic formula' };
  }
  const g = compileScalar(e, [x]);
  const scan = roots1D(g, WINDOW_1D[0], WINDOW_1D[1], 8000);
  return { roots: scan.roots, certainty: 'numeric', evidence: `sign-change scan on ${W1} refined by Brent's method; roots outside the window are not searched` };
}

function signAt(g: F1, x: number): number {
  const v = g(x);
  return !Number.isFinite(v) || Math.abs(v) < 1e-12 ? 0 : Math.sign(v);
}

const dfn = (e: Expr, x: string) => simplify(diff(e, x));

// ------------------------------------------------------------------ 1-D analysis

export function critical1D(f: FunctionValue): PointSetValue {
  const { x, e } = oneVar(f, 'critical');
  return memo(`crit1|${f.key}`, () =>
    counted('critical', () => {
      const d1 = dfn(e, x);
      const d2 = dfn(d1, x);
      const r = rootsOf(d1, x);
      const F = compileScalar(e, [x]);
      const D1 = compileScalar(d1, [x]);
      const D2 = compileScalar(d2, [x]);
      const points: SetPoint[] = r.roots
        .filter((c) => Number.isFinite(F(c)))
        .map((c) => {
          const s2 = signAt(D2, c);
          let type = s2 > 0 ? 'local min' : s2 < 0 ? 'local max' : '';
          if (!type) {
            const h = 1e-4 * (1 + Math.abs(c));
            const l = signAt(D1, c - h);
            const rr = signAt(D1, c + h);
            type = l > 0 && rr < 0 ? 'local max' : l < 0 && rr > 0 ? 'local min' : 'no extremum';
          }
          return { coords: [c], value: F(c), type };
        });
      return { kind: 'pointset', what: 'critical points', dim: 1, points, certainty: r.certainty, evidence: `f′(x) = 0 — ${r.evidence}` } as PointSetValue;
    }),
  );
}

export function zeros1D(f: FunctionValue): PointSetValue {
  const { x, e } = oneVar(f, 'zeros');
  return memo(`zeros1|${f.key}`, () => {
    const r = rootsOf(e, x);
    return { kind: 'pointset', what: 'zeros', dim: 1, points: r.roots.map((c) => ({ coords: [c], value: 0 })), certainty: r.certainty, evidence: r.evidence } as PointSetValue;
  });
}

export function inflections1D(f: FunctionValue): PointSetValue {
  const { x, e } = oneVar(f, 'inflections');
  return memo(`infl1|${f.key}`, () => {
    const d2 = dfn(dfn(e, x), x);
    const r = rootsOf(d2, x);
    const F = compileScalar(e, [x]);
    const D2 = compileScalar(d2, [x]);
    const points = r.roots
      .filter((c) => {
        const h = 1e-4 * (1 + Math.abs(c));
        return Number.isFinite(F(c)) && signAt(D2, c - h) * signAt(D2, c + h) < 0;
      })
      .map((c) => ({ coords: [c], value: F(c), type: 'inflection' }));
    return { kind: 'pointset', what: 'inflection points', dim: 1, points, certainty: r.certainty === 'exact' ? 'exact' : 'numeric', evidence: `f″ changes sign — ${r.evidence}` } as PointSetValue;
  });
}

export function domain1D(f: FunctionValue): DomainValue {
  const { x, e } = oneVar(f, 'domain');
  return memo(`dom1|${f.key}`, () =>
    counted('domain', () => {
      const conds = domainConditions(e, [x]);
      if (!conds.length) return { kind: 'domain', vars: [x], conditions: [], intervals: [{ a: -Infinity, b: Infinity, closedA: false, closedB: false }], certainty: 'exact', evidence: 'no restricting operations (no division, logarithm, root, …)' } as DomainValue;
      const scan = scanDomain1D(compileScalar(e, [x]), conds, x);
      return {
        kind: 'domain', vars: [x], conditions: conds.map((c) => c.latex), intervals: scan.intervals, certainty: 'heuristic',
        evidence: `conditions are exact; the intervals come from a scan of [${scan.window[0]}, ${scan.window[1]}] (ends reaching the window are reported as ±∞)`,
      } as DomainValue;
    }),
  );
}

function signIntervals(f: FunctionValue, d: Expr, breaks: number[], labels: [string, string], what: string): IntervalsValue {
  const { x } = oneVar(f);
  const dom = domain1D(f).intervals ?? [];
  const D = compileScalar(d, [x]);
  const out: Interval[] = [];
  // points inside the domain where the derivative itself is undefined (x^(1/3) at 0) also split intervals
  const undefinedAt: number[] = [];
  for (const c of domainConditions(d, [x])) {
    if (c.rel !== '≠' && c.rel !== '>') continue;
    try {
      undefinedAt.push(...roots1D(compileScalar(c.expr, [x]), WINDOW_1D[0], WINDOW_1D[1], 4000).roots);
    } catch {
      /* ignore */
    }
  }
  const allBreaks = [...breaks, ...undefinedAt];
  const constant = [-3.7, -1.3, 0.4, 1.9, 5.2].every((t) => !Number.isFinite(D(t)) || Math.abs(D(t)) < 1e-12) && [-3.7, -1.3, 0.4, 1.9, 5.2].some((t) => Number.isFinite(D(t)));
  for (const iv of dom) {
    const cuts = [iv.a, ...allBreaks.filter((b) => b > iv.a && b < iv.b).sort((p, q) => p - q), iv.b];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i];
      const b = cuts[i + 1];
      if (constant) {
        out.push({ a, b, closedA: false, closedB: false, label: what === 'monotonicity' ? 'constant' : 'linear (no concavity)' });
        continue;
      }
      // majority sign over a few interior samples (a single midpoint can land on a point where the derivative is undefined)
      const probes = Number.isFinite(a) && Number.isFinite(b) ? [0.21, 0.5, 0.79].map((u) => a + (b - a) * u) : Number.isFinite(a) ? [1, 3.3, 11].map((u) => a + u * Math.max(1, Math.abs(a))) : Number.isFinite(b) ? [1, 3.3, 11].map((u) => b - u * Math.max(1, Math.abs(b))) : [-2.3, -0.7, 0.9, 2.6];
      const sum = probes.reduce((acc, t) => acc + signAt(D, t), 0);
      const s = Math.sign(sum);
      if (!s) continue;
      const label = s > 0 ? labels[0] : labels[1];
      const prev = out[out.length - 1];
      if (prev && prev.label === label && prev.b === a && a > iv.a) prev.b = b;
      else out.push({ a, b, closedA: false, closedB: false, label });
    }
  }
  return { kind: 'intervals', what, intervals: out, certainty: 'heuristic', evidence: `sign of the derivative sampled between consecutive critical points on the domain` } as IntervalsValue;
}

export function monotonicity1D(f: FunctionValue): IntervalsValue {
  const { x, e } = oneVar(f, 'monotonicity');
  return memo(`mono1|${f.key}`, () => signIntervals(f, dfn(e, x), critical1D(f).points.map((p) => p.coords[0]), ['increasing', 'decreasing'], 'monotonicity'));
}

export function concavity1D(f: FunctionValue): IntervalsValue {
  const { x, e } = oneVar(f, 'concavity');
  return memo(`conc1|${f.key}`, () => {
    const d2 = dfn(dfn(e, x), x);
    return signIntervals(f, d2, rootsOf(d2, x).roots, ['concave up', 'concave down'], 'concavity');
  });
}

export function asymptotes1D(f: FunctionValue): AsymptotesValue {
  const { x, e } = oneVar(f, 'asymptotes');
  return memo(`asym1|${f.key}`, () => {
    const F = compileScalar(e, [x]);
    const dom = domain1D(f).intervals ?? [];
    const vertical: number[] = [];
    for (const iv of dom)
      for (const [end, side] of [[iv.a, 'right'], [iv.b, 'left']] as const) {
        if (!Number.isFinite(end) || vertical.some((v) => Math.abs(v - end) < 1e-9)) continue;
        const l = limitAt(F, end, side);
        if (l.kind === '+inf' || l.kind === '-inf') vertical.push(end);
      }
    const horizontal: AsymptotesValue['horizontal'] = [];
    const oblique: AsymptotesValue['oblique'] = [];
    for (const dir of [1, -1] as const) {
      const reach = dom.some((iv) => (dir > 0 ? iv.b === Infinity : iv.a === -Infinity));
      if (!reach) continue;
      const L = limitInf(F, dir);
      if (L.kind === 'finite') horizontal.push({ side: dir, value: L.value! });
      else if (L.kind === '+inf' || L.kind === '-inf') {
        const m = limitInf((t) => F(t) / t, dir);
        if (m.kind === 'finite' && Math.abs(m.value!) > 1e-9) {
          // the slope limit carries ~1e-9 error; snap it to a nearby simple rational before b = lim f − m x
          const snapped = [1, 2, 3, 4, 5, 6, 8, 10, 12].map((q) => Math.round(m.value! * q) / q).find((r) => Math.abs(r - m.value!) < 1e-6) ?? m.value!;
          const b = limitInf((t) => F(t) - snapped * t, dir);
          if (b.kind === 'finite') oblique.push({ side: dir, m: snapped, b: b.value! });
        }
      }
    }
    const round = (v: number) => (Math.abs(v - Math.round(v)) < 1e-6 ? Math.round(v) + 0 : v);
    return {
      kind: 'asymptotes', vertical: vertical.map(round), horizontal: horizontal.map((h) => ({ ...h, value: round(h.value) })),
      oblique: oblique.map((o) => ({ ...o, m: round(o.m), b: round(o.b) })), certainty: 'heuristic',
      evidence: 'numeric limits at the domain boundary and at ±∞ (evidence, not proof)',
      visuals: [visual('lines', { vertical, horizontal, oblique }, 'asymptotes', 'asymptote')],
    } as AsymptotesValue;
  });
}
// ------------------------------------------------------------------ 2-D analysis

export function critical2D(ctx: EvalContext, f: FunctionValue): PointSetValue {
  asScalarField(f);
  if (f.params.length !== 2) throw new EvalError('critical points: function of two variables expected');
  return memo(`crit2|${f.key}`, () =>
    counted('critical', () => {
      const g = gradOf(ctx, f);
      const H = hessianOf(ctx, f);
      const G = g.eval as (x: number, y: number) => number[];
      const HH = H.eval as (x: number, y: number) => number[][];
      const F = f.eval as (x: number, y: number) => number;
      // a constant Hessian means ∇f is affine: the critical point solves a linear system exactly
      const constH = H.expr?.type === 'matrix' && H.expr.rows.every((r) => r.every((c) => freeSymbols(bindEnv(c, f.env)).size === 0 || !f.params.some((p) => freeSymbols(bindEnv(c, f.env)).has(p))));
      let sols: number[][];
      let certainty: Certainty = 'numeric';
      let evidence: string;
      if (constH) {
        const h = HH(0, 0);
        const g0 = G(0, 0);
        const det = h[0][0] * h[1][1] - h[0][1] * h[1][0];
        if (Math.abs(det) > 1e-12) {
          sols = [[(-g0[0] * h[1][1] + g0[1] * h[0][1]) / det, (-g0[1] * h[0][0] + g0[0] * h[1][0]) / det]];
          certainty = 'exact';
          evidence = '∇f is affine (constant Hessian): unique solution of a linear system';
        } else {
          sols = [];
          evidence = 'constant singular Hessian: critical set is a line or empty (not enumerated)';
        }
      } else {
        const seeds = [...gridSeeds([[-1.5, 1.5], [-1.5, 1.5]], 7), ...gridSeeds([[-4, 4], [-4, 4]], 8), ...gridSeeds([[-12, 12], [-12, 12]], 6)];
        const r = newtonSystem((p) => G(p[0], p[1]), seeds, (p) => HH(p[0], p[1]));
        sols = r.solutions.filter((p) => p.every((c) => Math.abs(c) <= 20));
        evidence = `Newton's method from ${r.seeds} starting points in [−12, 12]²; each point has ‖∇f‖ < 10⁻⁹. Points outside the search box may be missed.`;
      }
      sols.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      const points: SetPoint[] = sols.map((p) => {
        const hm = HH(p[0], p[1]);
        const ev = symmetricEigen(hm).map((e) => e.value);
        const tol = 1e-9;
        const type = ev.every((l) => l > tol) ? 'local min' : ev.every((l) => l < -tol) ? 'local max' : ev.some((l) => l > tol) && ev.some((l) => l < -tol) ? 'saddle' : 'degenerate';
        return { coords: p.map((c) => (Math.abs(c) < 1e-12 ? 0 : c)), value: F(p[0], p[1]), type, hessian: hm };
      });
      return { kind: 'pointset', what: 'critical points', dim: 2, points, certainty, evidence } as PointSetValue;
    }),
  );
}

export function domain2D(f: FunctionValue): DomainValue {
  asScalarField(f);
  const conds = f.expr ? domainConditions(bindEnv(f.expr, f.env), f.params) : [];
  return { kind: 'domain', vars: f.params, conditions: conds.map((c: DomainCondition) => c.latex), certainty: 'exact', evidence: conds.length ? 'conditions read from the formula' : 'no restricting operations' } as DomainValue;
}

// ------------------------------------------------------------------ builtins

const FN = 'function' as const;
const V = 'value' as const;
const RAW = 'raw' as const;

function toLimit(n: NumericLimit): LimitValue {
  const side = (s?: NumericLimit) => (s ? { result: s.kind, value: s.value } : undefined);
  return { kind: 'limit', result: n.kind, value: n.value, left: side(n.left), right: side(n.right), certainty: 'heuristic', evidence: `numeric evidence: ${n.evidence}` } as LimitValue;
}

/** c₀ + Σ cᵢ(vᵢ − aᵢ) typeset without "+ 1(x − 1)", "+ 0(y − 2)" or "(x − 0)". */
export function affineLatex(c0: number, terms: [number, string, number][]): string {
  const parts: string[] = [];
  if (Math.abs(c0) > 1e-12 || terms.every(([c]) => Math.abs(c) < 1e-12)) parts.push(rn(c0));
  for (const [c, v, a] of terms) {
    if (Math.abs(c) < 1e-12) continue;
    const factor = Math.abs(a) < 1e-12 ? v : `(${v} ${a < 0 ? '+' : '-'} ${rn(Math.abs(a))})`;
    const mag = Math.abs(Math.abs(c) - 1) < 1e-12 ? '' : rn(Math.abs(c));
    parts.push(`${parts.length ? (c < 0 ? '- ' : '+ ') : c < 0 ? '-' : ''}${mag}${factor}`);
  }
  return parts.join(' ');
}

/** How an (anonymous) function is named in a derivation: its label, or its formula — never a made-up "f". */
function fnTex(f: FunctionValue): string {
  if (f.label) return f.label;
  return f.expr ? `\\left(${toLatex(f.expr)}\\right)` : 'f';
}
function pointArg(v: MathValue | undefined, what: string): number[] {
  if (!v) throw new EvalError(`${what}: say where, e.g. "at P"`);
  if (v.kind === 'scalar') return [expectNumber(v)];
  return expectCoords(v, 'a point');
}

const derivative: Builtin = {
  name: 'derivative', command: true, minArgs: 1, maxArgs: 2, argModes: [FN, RAW], keywords: { wrt: RAW, order: V },
  category: 'calculus', signature: 'derivative f [wrt x] [order n]', doc: 'Derivative (symbolic, exact).',
  apply: ([fv], ctx, raw, kw) => {
    const f = asScalarField(expectFunction(fv));
    const w = kw.raw.wrt ?? raw[1];
    const v = w?.type === 'sym' ? w.name : f.params[0];
    if (!f.params.includes(v)) throw new EvalError(`${v} is not a variable of ${f.label ?? 'f'}`);
    if (f.params.length > 1 && !w) throw new EvalError('several variables: say which, e.g. derivative f wrt x');
    if (!f.expr) throw new EvalError('no symbolic form');
    const n = kw.values.order ? expectNumber(kw.values.order) : 1;
    if (!Number.isInteger(n) || n < 1 || n > 12) throw new EvalError('order must be an integer between 1 and 12');
    let e = f.expr;
    for (let i = 0; i < n; i++) e = diff(e, v);
    const name = f.label ?? 'f';
    const label = f.params.length === 1 ? (n > 3 ? `${name}^{(${n})}` : `${name}${"'".repeat(n)}`) : `\\partial_{${symbolLatex(v)}}${n > 1 ? `^{${n}}` : ''} ${name}`;
    return { ...ctx.makeFunction(e, f.params, { label, base: f, env: f.env }), certainty: 'exact', evidence: 'symbolic differentiation' };
  },
};

const integrate: Builtin = {
  name: 'integrate', command: true, minArgs: 1, maxArgs: 3, argModes: [FN, V, V], keywords: { from: V, to: V, wrt: RAW },
  category: 'calculus', signature: 'integrate f [from a to b]', doc: 'Antiderivative (exact when found) or definite integral.',
  apply: ([fv, av, bv], ctx, _raw, kw) => {
    const { f, x, e } = oneVar(expectFunction(fv), 'integrate');
    const aV = kw.values.from ?? av;
    const bV = kw.values.to ?? bv;
    const F = memo(`anti|${f.key}`, () => antiderivative(e, x));
    if (!aV || !bV) {
      if (!F) throw new EvalError('no elementary antiderivative found — give bounds for a numeric value: integrate f from a to b');
      return { ...ctx.makeFunction(F, [x], { label: `\\int ${fnTex(f)}` }), certainty: 'exact', evidence: 'antiderivative verified by differentiation (+ C)', derivation: `\\int ${fnTex(f)}\\,d${x}`, role: 'antiderivative' };
    }
    const a = expectNumber(aV);
    const b = expectNumber(bV);
    const fn = compileScalar(e, [x]);
    const derivation = `\\int_{${rn(a)}}^{${rn(b)}} ${fnTex(f)}\\,d${x}`;
    // points in [a, b] where the integrand is undefined (zeros of denominators, log arguments …)
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const singular: number[] = [];
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      for (const c of domainConditions(e, [x])) {
        if (c.rel !== '≠') continue;
        const g = compileScalar(c.expr, [x]);
        for (const r of roots1D(g, lo - 1e-9, hi + 1e-9).roots) if (r >= lo - 1e-9 && r <= hi + 1e-9) singular.push(r);
        for (const t of [lo, hi]) if (Math.abs(g(t)) < 1e-12) singular.push(t);
      }
      for (let i = 0; i <= 2000; i++) {
        const t = lo + ((hi - lo) * i) / 2000;
        if (!Number.isFinite(fn(t)) && !singular.some((s) => Math.abs(s - t) < 1e-9)) singular.push(t);
      }
    }
    const cuts = [...new Set(singular.map((s) => +s.toPrecision(12)))].sort((p, q) => p - q);
    if (F && Number.isFinite(a) && Number.isFinite(b) && !cuts.length) {
      const Fn = compileScalar(F, [x]);
      const v = Fn(b) - Fn(a);
      if (Number.isFinite(v)) return scalar(v, { certainty: 'exact', evidence: 'fundamental theorem of calculus with a verified antiderivative (integrand continuous on the interval)', derivation });
    }
    // improper integral: integrate between the singular points, each piece must converge
    const knots = [lo, ...cuts.filter((c) => c > lo && c < hi), hi];
    let total = 0;
    let error = 0;
    for (let i = 0; i + 1 < knots.length; i++) {
      const q = integrateNumeric(fn, knots[i], knots[i + 1]);
      if (!q.ok || Math.abs(q.value) > 1e12) {
        const where = cuts.length ? ` (singularity at ${symbolLatex(x)} = ${cuts.map((c) => +c.toPrecision(6)).join(', ')})` : '';
        throw new EvalError(`the integral diverges or does not converge numerically${where}`);
      }
      total += q.value;
      error += q.error;
    }
    const value = a <= b ? total : -total;
    return scalar(value, { certainty: 'numeric', evidence: `adaptive Gauss–Kronrod quadrature${cuts.length ? ' (improper: split at the singular points)' : ''}, error estimate ${error.toExponential(1)}`, derivation });
  },
};

const limit: Builtin = {
  name: 'limit', command: true, minArgs: 1, maxArgs: 2, argModes: [FN, V], keywords: { wrt: RAW, approach: V, side: RAW },
  category: 'calculus', signature: 'limit f as x -> a [±]', doc: 'Limit (exact by continuity, otherwise numeric evidence).',
  apply: ([fv, av], _ctx, _raw, kw) => {
    const { f, x, e } = oneVar(expectFunction(fv), 'limit');
    const aV = kw.values.approach ?? av;
    if (!aV) throw new EvalError('say where: limit f as x -> a');
    const a = expectNumber(aV);
    const side = kw.raw.side?.type === 'sym' ? (kw.raw.side.name as 'left' | 'right') : 'both';
    const F = compileScalar(e, [x]);
    const derivation = `\\lim_{${symbolLatex(x)} \\to ${Number.isFinite(a) ? rn(a) : a > 0 ? '\\infty' : '-\\infty'}${side === 'right' ? '^+' : side === 'left' ? '^-' : ''}} ${fnTex(f)}`;
    if (!Number.isFinite(a)) return { ...toLimit(limitInf(F, a > 0 ? 1 : -1)), derivation };
    // continuity: elementary functions are continuous on the interior of their domain
    const conds = domainConditions(e, [x]);
    const interior = conds.every((c) => {
      const v = compileScalar(c.expr, [x])(a);
      return c.rel === 'between' ? Math.abs(v) < 1 : c.rel === '≠' ? Math.abs(v) > 1e-12 : v > 1e-12;
    });
    const fa = F(a);
    if (interior && Number.isFinite(fa)) return { kind: 'limit', result: 'finite', value: fa, certainty: 'exact', evidence: `${f.label ?? 'f'} is continuous at ${rn(a)}: the limit is the value there`, derivation } as LimitValue;
    return { ...toLimit(limitAt(F, a, side)), derivation };
  },
};

const taylor: Builtin = {
  name: 'taylor', command: true, minArgs: 1, maxArgs: 3, argModes: [FN, V, V], keywords: { at: V, order: V },
  category: 'calculus', signature: 'taylor f at a order n', doc: 'Taylor polynomial (symbolic).',
  apply: ([fv, av, nv], ctx, _raw, kw) => {
    const f = asScalarField(expectFunction(fv));
    const at = kw.values.at ?? av;
    const n = kw.values.order ?? nv ? expectNumber(kw.values.order ?? nv) : f.params.length === 1 ? 4 : 2;
    if (f.params.length === 2) {
      if (n > 2) throw new EvalError('for two variables, order ≤ 2');
      const p = at ? pointArg(at, 'taylor') : [0, 0];
      const d = localData(ctx, f, p);
      return { ...ctx.makeFunction(taylorExpr(d, f.params, n === 1 ? 1 : 2), f.params, { label: `T_{${n}}${fnTex(f)}` }), certainty: 'exact', evidence: 'derivatives computed symbolically', role: 'taylor' };
    }
    const { x, e } = oneVar(f, 'taylor');
    const a = at ? pointArg(at, 'taylor')[0] : 0;
    if (!Number.isInteger(n) || n < 0 || n > 12) throw new EvalError('order must be an integer between 0 and 12');
    let d = e;
    let fact = 1;
    const terms: Expr[] = [];
    for (let k = 0; k <= n; k++) {
      if (k > 0) {
        d = dfn(d, x);
        fact *= k;
      }
      const c = compileScalar(d, [x])(a) / fact;
      if (!Number.isFinite(c)) throw new EvalError(`${f.label ?? 'f'} is not differentiable ${k} times at ${rn(a)}`);
      if (Math.abs(c) < 1e-15) continue;
      const base: Expr = a === 0 ? sym(x) : { type: 'bin', op: '-', left: sym(x), right: num(a) };
      terms.push(k === 0 ? num(c) : { type: 'bin', op: '*', left: num(c), right: k === 1 ? base : { type: 'bin', op: '^', left: base, right: num(k) } });
    }
    // keep ascending powers: 1 + x + x²/2 + … (simplifying the whole sum would move the constant last)
    const poly = terms.length ? terms.map(simplify).reduce((p, q) => ({ type: 'bin', op: '+', left: p, right: q })) : num(0);
    return { ...ctx.makeFunction(poly, [x], { label: `T_{${n}}${fnTex(f)}` }), certainty: 'exact', evidence: `coefficients f⁽ᵏ⁾(${rn(a)})/k! from symbolic derivatives`, role: 'taylor' };
  },
};
const solve: Builtin = {
  name: 'solve', command: true, minArgs: 1, maxArgs: 2, argModes: [RAW, RAW],
  category: 'algebra', signature: 'solve lhs = rhs  |  solve(eq1, eq2)', doc: 'Real solutions (exact for degree ≤ 2, otherwise numeric).',
  apply: (_args, ctx, raw) => {
    const asZero = (e: Expr): Expr => (e.type === 'eq' ? { type: 'bin', op: '-', left: e.left, right: e.right } : e);
    const eqs = raw.map(asZero);
    const fns = eqs.map((e) => ctx.toFunction(e));
    const vars = [...new Set(fns.flatMap((g) => g.params))];
    if (vars.length === 1 && eqs.length === 1) {
      const g = fns[0];
      const e1 = bindEnv(g.expr!, g.env);
      const r = rootsOf(e1, g.params[0]);
      // an identity (x = x, (x+1)^2 = x^2 + 2x + 1): every real number is a solution
      const G = compileScalar(e1, g.params);
      const identity = r.evidence === 'identically zero' || [-7.3, -2.1, -0.4, 0.6, 1.7, 3.9, 11.2].every((t) => Math.abs(G(t)) < 1e-10);
      if (identity)
        return { kind: 'intervals', what: 'solutions', intervals: [{ a: -Infinity, b: Infinity, closedA: false, closedB: false }], certainty: r.evidence === 'identically zero' ? 'exact' : 'heuristic', evidence: 'the equation holds for every x' } as IntervalsValue;
      return { kind: 'pointset', what: 'solutions', dim: 1, points: r.roots.map((c) => ({ coords: [c] })), certainty: r.certainty, evidence: r.evidence } as PointSetValue;
    }
    if (vars.length === 2 && eqs.length === 2) {
      const [g1, g2] = fns.map((g) => ctx.makeFunction(g.expr!, vars, { env: g.env }));
      const G = (p: number[]) => [(g1.eval as F1 & ((...a: number[]) => number))(...p) as number, (g2.eval as (...a: number[]) => number)(...p)];
      const r = newtonSystem(G, [...gridSeeds([[-4, 4], [-4, 4]], 8), ...gridSeeds([[-12, 12], [-12, 12]], 6)]);
      return { kind: 'pointset', what: 'solutions', dim: 2, points: r.solutions.map((p) => ({ coords: p })), certainty: 'numeric', evidence: `Newton's method from ${r.seeds} starting points; residual < 10⁻⁹` } as PointSetValue;
    }
    throw new EvalError('solve: one equation in one unknown, or two equations in two unknowns');
  },
};

function perDim(name: string, doc: string, one: (f: FunctionValue) => MathValue, two?: (ctx: EvalContext, f: FunctionValue) => MathValue): Builtin {
  return {
    name, command: true, minArgs: 1, maxArgs: 1, argModes: [FN], category: 'analysis', signature: `${name} f`, doc,
    apply: ([fv], ctx) => {
      const f = asScalarField(expectFunction(fv));
      if (f.params.length === 1) return one(f);
      if (f.params.length === 2 && two) return two(ctx, f);
      throw new EvalError(`${name}: not available for functions of ${f.params.length} variables yet`);
    },
  };
}

const extremaOf = (s: PointSetValue): PointSetValue => ({ ...s, what: 'local extrema', points: s.points.filter((p) => p.type === 'local min' || p.type === 'local max') });

const itemB = (name: string, index?: number): Builtin => ({
  name, command: index !== undefined, minArgs: 1, maxArgs: index === undefined ? 2 : 1, argModes: [V, V],
  category: 'objects', signature: index === undefined ? 'item(S, k)  or  S[k]' : `${name}(S)`, doc: 'One element of a point set or list (1-based).',
  apply: ([s, k]) => {
    if (!s) throw new EvalError('missing set');
    const i = index ?? expectNumber(k) - 1;
    const v = itemOf(s, i);
    if (!v) throw new EvalError(`no element ${i + 1}`);
    return v;
  },
});

const tangent: Builtin = {
  name: 'tangent', command: true, minArgs: 1, maxArgs: 2, argModes: [FN, V], keywords: { at: V },
  category: 'calculus', signature: 'tangent f at P', doc: 'Tangent line (one variable) or tangent plane (two variables).',
  apply: ([fv, pv], ctx, _raw, kw) => {
    const f = asScalarField(expectFunction(fv));
    const p = pointArg(kw.values.at ?? pv, 'tangent');
    if (f.params.length === 2) {
      const d = localData(ctx, f, p);
      if (!Number.isFinite(d.f0) || !d.g.every(Number.isFinite)) throw new EvalError(`${f.label ?? 'f'} is not defined / differentiable at (${p.map(rn).join(', ')}) — the point is outside the domain`);
      return {
        kind: 'plane', point: [p[0], p[1], d.f0], normal: [-d.g[0], -d.g[1], 1], role: 'tangent', certainty: 'exact', evidence: 'gradient computed symbolically',
        latex: `z = ${affineLatex(d.f0, [[d.g[0], 'x', p[0]], [d.g[1], 'y', p[1]]])}`,
      } as MathValue;
    }
    const { x, e } = oneVar(f, 'tangent');
    const a = p[0];
    const F = compileScalar(e, [x]);
    // |u| has a corner where u = 0 changes sign: the formula derivative (sgn) would wrongly give a slope there
    const kink = (n: Expr): boolean => {
      if (n.type === 'call' && n.callee.type === 'sym' && n.callee.name === 'abs' && n.args[0]) {
        const u = compileScalar(n.args[0], [x]);
        const du = compileScalar(dfn(n.args[0], x), [x]);
        if (Math.abs(u(a)) < 1e-12 && Math.abs(du(a)) > 1e-12) return true;
      }
      return children(n).some(kink);
    };
    if (kink(e)) throw new EvalError(`${f.label ?? 'f'} is not differentiable at ${rn(a)} (corner of |…|)`);
    const m = compileScalar(dfn(e, x), [x])(a);
    if (!Number.isFinite(F(a)) || !Number.isFinite(m)) throw new EvalError(`${f.label ?? 'f'} is not differentiable at ${rn(a)}`);
    const line = simplify({ type: 'bin', op: '+', left: num(F(a)), right: { type: 'bin', op: '*', left: num(m), right: { type: 'bin', op: '-', left: sym(x), right: num(a) } } });
    const L = ctx.makeFunction(line, [x], { label: 'L', role: 'tangent' });
    return {
      ...L, certainty: 'exact', evidence: 'slope f′(a) computed symbolically',
      visuals: [visual('graph1d', { fn: L }, 'tangent', 'tangent'), visual('markers', { set: { kind: 'pointset', what: 'point', dim: 1, points: [{ coords: [a], value: F(a) }] } }, undefined, 'point')],
    };
  },
};

const directional: Builtin = {
  name: 'directional', command: true, minArgs: 1, maxArgs: 3, argModes: [FN, V, V], keywords: { at: V, toward: V },
  category: 'calculus', signature: 'directional f at P toward v', doc: 'Directional derivative D_û f(P) = ∇f(P)·û, with its geometry.',
  apply: ([fv, pv, uv], ctx, raw, kw) => {
    const f = asScalarField(expectFunction(fv));
    if (f.params.length !== 2) throw new EvalError('directional derivative: function of two variables');
    const p = pointArg(kw.values.at ?? pv, 'directional');
    const v = expectVector(kw.values.toward ?? uv, 'a direction (toward v)');
    if (norm(v) === 0) throw new EvalError('direction must be non-zero');
    const u = normalize(v);
    const d = localData(ctx, f, p);
    const D = dot(d.g, u);
    // name the direction after what the user wrote: toward u → û, toward (3,-2) → the unit vector of (3,−2)
    const dirExpr = kw.raw.toward ?? raw[2];
    const named = dirExpr?.type === 'sym' ? dirExpr.name : undefined;
    const unit = u.map((c) => +c.toFixed(3));
    const dirLatex = named ? `\\hat{${symbolLatex(named)}}` : `\\hat{v}`;
    const arrowLabel = named ? `${named}̂` : `dir (${v.map((c) => +c.toFixed(3)).join(', ')})`;
    return scalar(D, {
      certainty: 'exact',
      evidence: `∇f(P)·${named ? `${named}̂` : 'v̂'} with the symbolic gradient; unit direction ⟨${unit.join(', ')}⟩`,
      derivation: `D_{${dirLatex}}${f.label ?? 'f'}`,
      role: 'directional',
      visuals: [
        visual('arrow', { anchor: p, vec: u }, arrowLabel, 'direction'),
        visual('slice', { slice: { kind: 'slice', fn: f, origin: p, dir: u, marker: 0, label: `z = ${f.label ?? 'f'}(P + t\\,${dirLatex})`, role: 'slice-dir' } }, undefined, 'slice-dir'),
      ],
    });
  },
};

const rewrite = (name: string, doc: string, op: (e: Expr) => Expr): Builtin => ({
  name, command: true, minArgs: 1, maxArgs: 1, argModes: [RAW], category: 'algebra', signature: `${name} expr`, doc,
  apply: (_a, ctx, raw) => {
    const v = ctx.evaluateOrLift(raw[0]);
    if (v.kind !== 'function' || !(v as FunctionValue).expr) return v;
    const f = v as FunctionValue;
    return { ...ctx.makeFunction(op(f.expr!), f.params, { label: f.label, env: f.env }), certainty: 'exact', evidence: 'symbolic rewriting' };
  },
});

const analyze: Builtin = {
  name: 'analyze', command: true, minArgs: 1, maxArgs: 1, argModes: [RAW], category: 'analysis', signature: 'analyze X', doc: 'Show the analysis of X in the Analysis panel.',
  apply: (_a, ctx, raw) => {
    if (raw[0].type !== 'sym') throw new EvalError('analyze a named object, e.g. analyze f');
    if (!ctx.lookup(raw[0].name)) throw new EvalError(`Unknown name '${raw[0].name}'`);
    return { kind: 'focus', target: raw[0].name } as FocusValue as unknown as MathValue;
  },
};

export const analysisBuiltins: Builtin[] = [
  derivative,
  integrate,
  limit,
  taylor,
  solve,
  tangent,
  directional,
  analyze,
  perDim('critical', 'Critical points with their classification.', critical1D, critical2D),
  perDim('zeros', 'Zeros of f.', zeros1D),
  perDim('extrema', 'Local maxima and minima.', (f) => extremaOf(critical1D(f)), (ctx, f) => extremaOf(critical2D(ctx, f))),
  perDim('inflections', 'Inflection points (where f″ changes sign).', inflections1D),
  perDim('domain', 'Domain: exact conditions, scanned intervals.', domain1D, (_c, f) => domain2D(f)),
  perDim('monotonicity', 'Intervals where f increases / decreases.', monotonicity1D),
  perDim('concavity', 'Intervals where f is concave up / down.', concavity1D),
  perDim('asymptotes', 'Vertical, horizontal and oblique asymptotes.', asymptotes1D),
  itemB('first', 0),
  itemB('item'),
  rewrite('expand', 'Expand products and powers.', expand),
  rewrite('simplify', 'Simplify.', simplify),
];
/** Plugin: analysis builtins + command forms of the calculus operators. */
export const coreAnalysisMath = definePlugin({
  name: 'core-analysis',
  install(api) {
    analysisBuiltins.forEach((b) => api.registerBuiltin(b));
    const grad = getBuiltin('grad');
    if (grad) api.registerBuiltin({ ...grad, name: 'gradient', signature: 'gradient f', command: true });
    for (const n of ['grad', 'hessian', 'eigenvalues', 'eigenvectors', 'normalize', 'norm']) {
      const b = getBuiltin(n);
      if (b) api.registerBuiltin({ ...b, command: true });
    }
    api.registerLatexFunctionName('gradient', '\\nabla');
    api.registerValueKind({ kind: 'hide', latex: (v) => `\\text{hidden: ${((v as unknown as { targets: string[] }).targets ?? []).join(', ')}}`, typeLabel: () => 'representation' });
    api.registerDefaultVisual('pointset', (v, ctx) => {
      const s = v as unknown as PointSetValue;
      const role = s.what === 'zeros' ? 'zeros' : s.what === 'solutions' ? 'solutions' : 'critical';
      return [visual('markers', { set: s }, ctx.name ?? s.what, role)];
    });
  },
});
