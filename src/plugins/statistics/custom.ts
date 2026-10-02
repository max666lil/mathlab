/**
 * Random variables given by their own formula (Devore §4.1–4.2; the typical exam question):
 *
 *   X ~ density(3x^2, 0, 1)            a pdf on [a, b]  (it must integrate to 1 — otherwise the
 *                                      missing constant is reported: "find k")
 *   X ~ density({0 <= x <= 1: x, 1 < x <= 2: 2 - x, 0})   piecewise, support found automatically
 *   X ~ fromcdf(1 - exp(-2x), 0, ∞)    a cdf F with F(a) = 0, F(b) = 1; the density is F′
 *
 * and the normal approximation of a discrete variable with the continuity correction (§4.3):
 *
 *   normalapprox(X)                    N(μ, σ) with the same mean and sd
 *   normalapprox(X <= 55), normalapprox(45 <= X <= 55), normalapprox(X = 50)
 */
import { Expr, freeSymbols, mapExpr, sym } from '../../math-core/ast';
import { Builtin, EvalContext, EvalError, expectNumber, getBuiltin } from '../../math-core/builtins';
import { MathValue, FunctionValue, scalar } from '../../math-core/values';
import { CONSTANTS, getScalarFunction } from '../../math-core/scalar-functions';
import { numberLatex, toLatex, toText } from '../../math-core/symbolic/print';
import { antiderivative } from '../../math-core/symbolic/integrate';
import { diff } from '../../math-core/symbolic/diff';
import { simplify } from '../../math-core/symbolic/simplify';
import { compileScalar } from '../../math-core/compile';
import { integrateNumeric } from '../../math-core/numeric/quad';
import * as D from '../../math-core/distributions';
import { visual } from '../../visualization/scene-model';
import { DistributionValue, asDistribution, makeDistribution, readCondition, probability } from './random';

const fmt = (x: number) => String(+x.toPrecision(6));
const inf = (x: number) => (x === Infinity ? '\\infty' : x === -Infinity ? '-\\infty' : numberLatex(x, 6));

/** The variable of a formula: its one free name that is not defined, a constant or a function. */
function variableOf(e: Expr, ctx: EvalContext): string {
  // names used as functions (piecewise, and) are not variables
  const callees = new Set<string>();
  mapExpr(e, (n) => {
    if (n.type === 'call' && n.callee.type === 'sym') callees.add(n.callee.name);
    return n;
  });
  const free = [...freeSymbols(e)].filter((n) => !callees.has(n) && !ctx.lookup(n) && !(n in CONSTANTS) && !getBuiltin(n) && !getScalarFunction(n));
  if (free.length !== 1) throw new EvalError(free.length ? `the formula has several unknown names (${free.join(', ')}): one variable, e.g. density(3x^2, 0, 1)` : 'the formula needs a variable, e.g. density(3x^2, 0, 1)');
  return free[0];
}

/** Where a function is positive on a wide grid (support of a piecewise density given without bounds). */
function supportOf(f: (x: number) => number): [number, number] {
  const N = 8000, L = 200;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= N; i++) {
    const x = -L + (2 * L * i) / N;
    const v = f(x);
    if (v > 0 && Number.isFinite(v)) {
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
  }
  if (!Number.isFinite(lo)) throw new EvalError('the density is 0 everywhere on [−200, 200]: give its interval, density(f, a, b)');
  const step = (2 * L) / N;
  return [lo <= -L + step ? -Infinity : lo - step, hi >= L - step ? Infinity : hi + step];
}

/** ∫ g over [a, b], split at a few interior points so piecewise and peaked functions integrate well. */
function integral(g: (x: number) => number, a: number, b: number): number {
  const fa = Number.isFinite(a), fb = Number.isFinite(b);
  if (!fa || !fb) {
    const mid = fa ? a + 1 : fb ? b - 1 : 0;
    return (fa || !fb ? integrateNumeric(g, fa ? a : -Infinity, mid, 1e-11).value : integrateNumeric(g, -Infinity, mid, 1e-11).value) + integrateNumeric(g, mid, fb ? b : Infinity, 1e-11).value;
  }
  let s = 0;
  const K = 16;
  for (let k = 0; k < K; k++) s += integrateNumeric(g, a + ((b - a) * k) / K, a + ((b - a) * (k + 1)) / K, 1e-12).value;
  return s;
}

/** A continuous distribution from its density on [a, b]. */
function densityDistribution(ctx: EvalContext, raw: Expr, a: number | undefined, b: number | undefined, how: string): DistributionValue {
  const v = variableOf(raw, ctx);
  const fn = ctx.makeFunction(raw, [v]) as FunctionValue;
  const f0 = fn.eval as (x: number) => number;
  const f = (x: number) => {
    const y = f0(x);
    return Number.isFinite(y) ? y : 0;
  };
  const [lo, hi] = a !== undefined && b !== undefined ? [a, b] : supportOf(f);
  if (!(hi > lo)) throw new EvalError('density(f, a, b) needs a < b');
  // f ≥ 0 on the support
  const probe = (t: number) => (Number.isFinite(lo) && Number.isFinite(hi) ? lo + (hi - lo) * t : Number.isFinite(lo) ? lo + t / (1 - t) : Number.isFinite(hi) ? hi - t / (1 - t) : Math.tan(Math.PI * (t - 0.5)));
  for (let i = 1; i < 400; i++) if (f(probe(i / 400)) < -1e-9) throw new EvalError(`a density cannot be negative (it is ${fmt(f(probe(i / 400)))} at ${v} = ${fmt(probe(i / 400))})`);
  const pdf = (x: number) => (x < lo || x > hi ? 0 : Math.max(0, f(x)));
  const total = integral(pdf, lo, hi);
  if (!(Math.abs(total - 1) < 1e-6))
    throw new EvalError(`this density integrates to ${fmt(total)} over its interval, not 1 — multiply the formula by ${fmt(1 / total)} (that is the constant k)`);
  // closed forms where the antiderivative is found: exact cdf and moments
  const body = fn.expr ? mapExpr(fn.expr, (n) => (n.type === 'sym' && n.name in fn.env && typeof fn.env[n.name] === 'number' ? { type: 'num', value: fn.env[n.name] as number } : n)) : raw;
  const closed = (e: Expr): ((x: number) => number) | undefined => {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
    try {
      const A = antiderivative(e, v);
      if (!A) return undefined;
      const g = compileScalar(A, [v]);
      const base = g(lo);
      return Number.isFinite(base) && Number.isFinite(g(hi)) ? (x: number) => g(x) - base : undefined;
    } catch {
      return undefined;
    }
  };
  const X: Expr = sym(v);
  const F = closed(body);
  const M1 = closed({ type: 'bin', op: '*', left: X, right: body });
  const M2 = closed({ type: 'bin', op: '*', left: { type: 'bin', op: '^', left: X, right: { type: 'num', value: 2 } }, right: body });
  const exact = !!F && !!M1 && !!M2 && Math.abs(F(hi) - 1) < 1e-9;
  const mean = exact ? M1!(hi) : integral((x) => x * pdf(x), lo, hi);
  const m2 = exact ? M2!(hi) : integral((x) => x * x * pdf(x), lo, hi);
  // numeric cdf: cumulative integral on a grid, refined inside the cell
  const gl = Number.isFinite(lo) ? lo : -60, gh = Number.isFinite(hi) ? hi : 60;
  const G = 2048;
  const cum = new Float64Array(G + 1);
  if (!exact) {
    cum[0] = Number.isFinite(lo) ? 0 : integral(pdf, -Infinity, gl);
    for (let i = 0; i < G; i++) {
      const x0 = gl + ((gh - gl) * i) / G, x1 = gl + ((gh - gl) * (i + 1)) / G;
      cum[i + 1] = cum[i] + ((x1 - x0) / 6) * (pdf(x0) + 4 * pdf((x0 + x1) / 2) + pdf(x1));
    }
  }
  const cdf = (x: number) => {
    if (x <= lo) return 0;
    if (x >= hi) return 1;
    if (exact) return Math.min(1, Math.max(0, F!(x)));
    if (x <= gl) return Math.min(1, integral(pdf, -Infinity, x));
    if (x >= gh) return Math.min(1, cum[G] + integral(pdf, gh, x));
    const t = ((x - gl) / (gh - gl)) * G;
    const i = Math.min(G - 1, Math.floor(t));
    const x0 = gl + ((gh - gl) * i) / G;
    return Math.min(1, cum[i] + ((x - x0) / 6) * (pdf(x0) + 4 * pdf((x0 + x) / 2) + pdf(x)));
  };
  const quantile = (p: number) => {
    let l = Number.isFinite(lo) ? lo : -1, h = Number.isFinite(hi) ? hi : 1;
    while (!Number.isFinite(lo) && cdf(l) > p) l *= 2;
    while (!Number.isFinite(hi) && cdf(h) < p) h *= 2;
    for (let k = 0; k < 70; k++) {
      const m = (l + h) / 2;
      if (cdf(m) < p) l = m;
      else h = m;
    }
    return (l + h) / 2;
  };
  const dist: D.Dist = { name: 'density', discrete: false, lo, hi, mean, variance: Math.max(0, m2 - mean * mean), pdf, cdf, quantile, sample: (u) => quantile(u()) };
  const shown = v === 'x' ? body : mapExpr(body, (n) => (n.type === 'sym' && n.name === v ? sym('x') : n));
  const conds = [Number.isFinite(lo) ? `x >= ${lo}` : '', Number.isFinite(hi) ? `x <= ${hi}` : ''].filter(Boolean).join(' and ');
  let pdfSrc: string | undefined;
  try {
    pdfSrc = conds ? `{${conds}: ${toText(shown, true)}, 0}` : toText(shown, true);
  } catch {
    pdfSrc = undefined;
  }
  return {
    kind: 'distribution', family: 'density', params: [], discrete: false, dist, pdfSrc,
    latex: `f(${v}) = ${toLatex(raw)},\\ ${inf(lo)} \\le ${v} \\le ${inf(hi)}`,
    key: `dist|density|${toText(body, true)}|${lo}|${hi}`,
    certainty: exact ? 'exact' : 'numeric',
    evidence: `${how}; ∫ f = 1 checked; ${exact ? 'cdf and moments from the antiderivative' : 'cdf and moments by numerical integration'}`,
  };
}

const bound = (v: MathValue | undefined) => (v === undefined ? undefined : expectNumber(v));

export const densityBuiltin: Builtin = {
  name: 'density', minArgs: 1, maxArgs: 3, argModes: ['raw', 'value', 'value'], category: 'statistics',
  signature: 'X ~ density(3x^2, 0, 1) · density({0 <= x <= 1: x, 1 < x <= 2: 2 - x, 0})',
  doc: 'A continuous random variable from its density on [a, b] (it must integrate to 1).',
  apply: (args, ctx, raw) => {
    if ((args[1] === undefined) !== (args[2] === undefined)) throw new EvalError('density(f, a, b): give both ends of the interval, or none for a piecewise formula');
    return densityDistribution(ctx, raw[0], bound(args[1]), bound(args[2]), 'the density as given') as unknown as MathValue;
  },
};

export const fromCdfBuiltin: Builtin = {
  name: 'fromcdf', minArgs: 3, maxArgs: 3, argModes: ['raw', 'value', 'value'], category: 'statistics',
  signature: 'X ~ fromcdf(1 - exp(-2x), 0, ∞)', doc: 'A continuous random variable from its cdf F on [a, b] (F(a) = 0, F(b) = 1); the density is F′.',
  apply: (args, ctx, raw) => {
    const a = expectNumber(args[1]), b = expectNumber(args[2]);
    const v = variableOf(raw[0], ctx);
    const F = ctx.makeFunction(raw[0], [v]).eval as (x: number) => number;
    const at = (x: number) => (Number.isFinite(x) ? F(x) : F(x > 0 ? 1e9 : -1e9));
    if (Math.abs(at(a)) > 1e-6 || Math.abs(at(b) - 1) > 1e-6) throw new EvalError(`a cdf goes from 0 to 1: here F(a) = ${fmt(at(a))} and F(b) = ${fmt(at(b))}`);
    return densityDistribution(ctx, simplify(diff(raw[0], v)), a, b, `f = F′ = ${toText(simplify(diff(raw[0], v)))}`) as unknown as MathValue;
  },
};

// ------------------------------------------------------------------ normal approximation

/** Adequacy of the approximation in the words of the book. */
function adequacy(X: DistributionValue): string {
  if (X.family === 'Binomial' || X.family === 'Bernoulli') {
    const [n, p] = X.family === 'Bernoulli' ? [1, X.params[0]] : X.params;
    const ok = n * p >= 10 && n * (1 - p) >= 10;
    return `np = ${fmt(n * p)}, n(1 − p) = ${fmt(n * (1 - p))}: ${ok ? 'both ≥ 10, the approximation is adequate' : 'not both ≥ 10 — the approximation is rough'}`;
  }
  if (X.family === 'Poisson') return `μ = ${fmt(X.params[0])}: ${X.params[0] > 20 ? 'μ > 20, the approximation is adequate' : 'μ ≤ 20 — the approximation is rough'}`;
  return 'adequate when the variable is a sum of many independent terms (central limit theorem)';
}

export const normalApproxBuiltin: Builtin = {
  name: 'normalapprox', minArgs: 1, maxArgs: 1, argModes: ['raw'], category: 'statistics',
  signature: 'normalapprox(X) · normalapprox(X <= 55) · normalapprox(45 <= X <= 55)',
  doc: 'The normal distribution with the mean and sd of X; for an event, its probability with the continuity correction.',
  apply: (_a, ctx, raw) => {
    const e = raw[0];
    if (e.type === 'sym') {
      const X = asDistribution(ctx.lookup(e.name));
      if (!X) throw new EvalError('normalapprox(X): X is a random variable');
      const sd = Math.sqrt(X.dist.variance);
      if (!(sd > 0) || !Number.isFinite(sd)) throw new EvalError('the variable needs a finite, positive standard deviation');
      return { ...makeDistribution('Normal', [X.dist.mean, sd]), certainty: 'numeric', evidence: `same mean and sd as ${e.name}; ${adequacy(X)}` } as unknown as MathValue;
    }
    const c = readCondition(e, ctx);
    const X = asDistribution(ctx.lookup(c.X));
    if (!X) throw new EvalError('normalapprox(X <= 55): an event about a random variable');
    const mu = X.dist.mean, sd = Math.sqrt(X.dist.variance);
    if (!(sd > 0) || !Number.isFinite(sd)) throw new EvalError('the variable needs a finite, positive standard deviation');
    if (c.ne !== undefined) throw new EvalError('use ≤, <, ≥, >, = or a ≤ X ≤ b');
    // integer-valued X: the event as a set of whole numbers [lo, hi], widened by ½ on each side
    const cc = X.discrete ? 0.5 : 0;
    let lo = -Infinity, hi = Infinity;
    if (c.eq !== undefined) [lo, hi] = [c.eq, c.eq];
    else {
      if (c.lo) lo = X.discrete && c.lo.strict ? Math.floor(c.lo.value) + 1 : X.discrete ? Math.ceil(c.lo.value) : c.lo.value;
      if (c.hi) hi = X.discrete && c.hi.strict ? Math.ceil(c.hi.value) - 1 : X.discrete ? Math.floor(c.hi.value) : c.hi.value;
    }
    const zHi = hi === Infinity ? Infinity : (hi + cc - mu) / sd;
    const zLo = lo === -Infinity ? -Infinity : (lo - cc - mu) / sd;
    const Phi = (z: number) => (z === Infinity ? 1 : z === -Infinity ? 0 : D.normCdf(z));
    const p = Math.max(0, Phi(zHi) - Phi(zLo));
    const exact = probability(X.dist, c);
    const frac = (x: number, s: number) => `\\Phi\\left(\\frac{${numberLatex(x + s, 6)} - ${numberLatex(mu, 6)}}{${numberLatex(sd, 5)}}\\right)`;
    const terms = [hi === Infinity ? '1' : frac(hi, cc), lo === -Infinity ? '' : frac(lo, -cc)].filter(Boolean).join(' - ');
    const normal = makeDistribution('Normal', [mu, sd]);
    return scalar(p, {
      certainty: 'numeric',
      evidence: `normal approximation${X.discrete ? ' with the continuity correction (± ½)' : ''}; the exact probability is ${fmt(exact)} (difference ${fmt(Math.abs(p - exact))}); ${adequacy(X)}`,
      derivation: `P\\left(${toLatex(e)}\\right) \\approx ${terms}`,
      exact,
      visuals: [
        visual('distplot', { dist: X, shade: [lo, hi], sname: c.X }, c.X, 'probability'),
        visual('distplot', { dist: normal, shade: [lo - cc, hi + cc], sname: 'N' }, 'normal approximation', 'approximation'),
      ],
    } as never) as MathValue;
  },
};