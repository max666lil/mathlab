/**
 * Functions of random variables (Devore ch. 4.7, 5.3–5.5, 6; STA237 "expectation and variance,
 * sampling distributions, the law of large numbers"):
 *
 *   Y ~ 2X + 3          an affine transform (closed form where the family is closed under it)
 *   S ~ X1 + X2         sums / linear combinations of independent variables (normal, Poisson,
 *                       binomial, gamma … stay in their family; discrete ones are convolved exactly)
 *   M ~ max(D1, D2)     any function of discrete variables: exact enumeration
 *   Y ~ X^2, ln(X)      one continuous variable: the transformation theorem when g is monotone
 *   Xbar ~ mean(X, n)   the sampling distribution of the mean (sum(X, n) for the total)
 *   E(X^2), Var(2X - Y), P(X + Y > 3), P(X > 3 | X > 1), lln(X)
 *
 * Every result says how it was obtained; Monte Carlo (seeded) is only the last resort and is labelled.
 */
import { Expr, freeSymbols } from '../../math-core/ast';
import { Builtin, EvalContext, EvalError, expectNumber } from '../../math-core/builtins';
import { MathValue, scalar } from '../../math-core/values';
import { numberLatex, toLatex, toText } from '../../math-core/symbolic/print';
import * as D from '../../math-core/distributions';
import { integrateNumeric } from '../../math-core/numeric/quad';
import { visual } from '../../visualization/scene-model';
import { DistributionValue, asDistribution, makeDistribution, seeded, cdfStrict } from './random';

type Certainty = 'exact' | 'numeric' | 'heuristic';
const worst = (...cs: Certainty[]): Certainty => (cs.includes('heuristic') ? 'heuristic' : cs.includes('numeric') ? 'numeric' : 'exact');
const MC = 200000;
const fmt = (x: number) => String(+x.toPrecision(6));

// ------------------------------------------------------------------ building blocks

/** A finite discrete distribution from a value → probability map (values need not be integers). */
export function finiteDist(map: Map<number, number>, name = 'pmf'): D.Dist {
  const xs = [...map.keys()].filter((x) => map.get(x)! > 0).sort((a, b) => a - b);
  const ps = xs.map((x) => map.get(x)!);
  const cum: number[] = [];
  ps.reduce((s, p, i) => (cum[i] = s + p), 0);
  const mean = xs.reduce((s, x, i) => s + x * ps[i], 0);
  const variance = xs.reduce((s, x, i) => s + (x - mean) ** 2 * ps[i], 0);
  const tol = (x: number) => 1e-9 * Math.max(1, Math.abs(x));
  const find = (x: number) => {
    let lo = 0, hi = xs.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (Math.abs(xs[m] - x) < tol(x)) return m;
      if (xs[m] < x) lo = m + 1;
      else hi = m - 1;
    }
    return -1;
  };
  // index of the last value ≤ x
  const upto = (x: number) => {
    let lo = 0, hi = xs.length - 1, r = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (xs[m] <= x + tol(x)) {
        r = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    return r;
  };
  return {
    name, discrete: true, lo: xs[0], hi: xs[xs.length - 1], mean, variance, support: xs,
    pdf: (x) => {
      const i = find(x);
      return i < 0 ? 0 : ps[i];
    },
    cdf: (x) => {
      const i = upto(x);
      return i < 0 ? 0 : Math.min(1, cum[i]);
    },
    quantile: (p) => {
      const i = cum.findIndex((c) => c >= p - 1e-12);
      return xs[i < 0 ? xs.length - 1 : i];
    },
    sample: (u) => {
      const r = u();
      let lo = 0, hi = xs.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (cum[m] > r) hi = m;
        else lo = m + 1;
      }
      return xs[lo];
    },
  };
}

/** Values and probabilities of a discrete distribution (tails below 1e-13 dropped); undefined if too many. */
function supportOf(d: D.Dist, limit = 20000): { xs: number[]; ps: number[]; truncated: boolean } | undefined {
  if (!d.discrete) return undefined;
  if (d.support) return { xs: d.support, ps: d.support.map((x) => d.pdf(x)), truncated: false };
  const lo = Math.ceil(Number.isFinite(d.lo) ? d.lo : D.quantileOf(d, 1e-13));
  const truncated = !Number.isFinite(d.hi);
  const hi = Math.floor(truncated ? D.quantileOf(d, 1 - 1e-13) : d.hi);
  if (!(hi - lo < limit)) return undefined;
  const xs: number[] = [];
  const ps: number[] = [];
  for (let k = lo; k <= hi; k++) {
    const p = d.pdf(k);
    if (p > 0) {
      xs.push(k);
      ps.push(p);
    }
  }
  return { xs, ps, truncated };
}

/** A continuous distribution from sorted sample points: interpolated cdf / quantile, smoothed density. */
function empiricalDist(sorted: Float64Array, mean?: number, variance?: number): D.Dist {
  const n = sorted.length;
  const m = mean ?? sorted.reduce((a, b) => a + b, 0) / n;
  const v = variance ?? sorted.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
  const q = (p: number) => {
    const t = Math.min(n - 1, Math.max(0, p * n - 0.5));
    const i = Math.floor(t);
    return i + 1 < n ? sorted[i] + (t - i) * (sorted[i + 1] - sorted[i]) : sorted[n - 1];
  };
  const cdf = (x: number) => {
    if (x < sorted[0]) return 0;
    if (x >= sorted[n - 1]) return 1;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= x) lo = mid;
      else hi = mid;
    }
    const f = sorted[hi] > sorted[lo] ? (x - sorted[lo]) / (sorted[hi] - sorted[lo]) : 0;
    return Math.min(1, (lo + 0.5 + f) / n);
  };
  // kernel density on a grid (Silverman's bandwidth)
  const iqr = q(0.75) - q(0.25);
  const h = 0.9 * Math.min(Math.sqrt(v), iqr / 1.34 || Math.sqrt(v)) * n ** -0.2 || 1e-3;
  const a = sorted[0] - 3 * h, b = sorted[n - 1] + 3 * h;
  const G = 512;
  const dx = (b - a) / (G - 1);
  const hist = new Float64Array(G);
  for (const x of sorted) hist[Math.min(G - 1, Math.max(0, Math.round((x - a) / dx)))] += 1;
  const dens = new Float64Array(G);
  const w = Math.ceil((4 * h) / dx);
  const kern = Array.from({ length: 2 * w + 1 }, (_, i) => Math.exp(-0.5 * (((i - w) * dx) / h) ** 2));
  for (let i = 0; i < G; i++) {
    if (!hist[i]) continue;
    for (let j = -w; j <= w; j++) if (i + j >= 0 && i + j < G) dens[i + j] += hist[i] * kern[j + w];
  }
  const norm = n * h * Math.sqrt(2 * Math.PI);
  for (let i = 0; i < G; i++) dens[i] /= norm;
  return {
    name: 'empirical', discrete: false, lo: sorted[0], hi: sorted[n - 1], mean: m, variance: v,
    pdf: (x) => {
      const t = (x - a) / dx;
      if (t < 0 || t > G - 1) return 0;
      const i = Math.floor(t);
      return i + 1 < G ? dens[i] + (t - i) * (dens[i + 1] - dens[i]) : dens[G - 1];
    },
    cdf, quantile: q,
    sample: (u) => q(u()),
  };
}

/** Y = aX + b for any X. */
function affineDist(d: D.Dist, a: number, b: number): D.Dist {
  const inv = (y: number) => (y - b) / a;
  return {
    name: 'affine', discrete: d.discrete,
    lo: a > 0 ? a * d.lo + b : a * d.hi + b, hi: a > 0 ? a * d.hi + b : a * d.lo + b,
    mean: a * d.mean + b, variance: a * a * d.variance,
    support: d.support?.map((x) => a * x + b).sort((p, q) => p - q),
    pdf: (y) => (d.discrete ? d.pdf(inv(y)) : d.pdf(inv(y)) / Math.abs(a)),
    cdf: (y) => (a > 0 ? d.cdf(inv(y)) : 1 - cdfStrict(d, inv(y), true)),
    quantile: (p) => a * D.quantileOf(d, a > 0 ? p : 1 - p) + b,
    sample: (u, z) => a * d.sample(u, z) + b,
  };
}

const famOf = (X: DistributionValue) => (X.family === 'Bernoulli' ? 'Binomial' : X.family);
const parOf = (X: DistributionValue) => (X.family === 'Bernoulli' ? [1, X.params[0]] : X.params);
const same = (xs: number[]) => xs.every((x) => Math.abs(x - xs[0]) < 1e-12);

function derivedValue(dist: D.Dist, latex: string, key: string, certainty: Certainty, evidence: string): DistributionValue {
  return { kind: 'distribution', family: 'derived', params: [], latex, discrete: dist.discrete, dist, key, certainty, evidence };
}
// ------------------------------------------------------------------ the variables of an expression

interface Bound {
  /** expression with sampling-distribution calls replaced by named variables */
  expr: Expr;
  names: string[];
  rvs: DistributionValue[];
  /** a context that also knows those variables */
  ctx: EvalContext;
}

/** A context that resolves extra (local) random variables first. */
function withLocals(ctx: EvalContext, locals: Map<string, DistributionValue>): EvalContext {
  if (!locals.size) return ctx;
  return {
    evaluate: (e) => ctx.evaluate(e),
    toFunction: (e) => ctx.toFunction(e),
    makeFunction: (e, p, o) => ctx.makeFunction(e, p, o),
    evaluateOrLift: (e) => ctx.evaluateOrLift(e),
    lookup: (n) => (locals.get(n) as unknown as MathValue | undefined) ?? ctx.lookup(n),
    names: () => ctx.names?.() ?? [],
  };
}

/** Collect the random variables of an expression; mean(X, n) / sum(X, n) become named variables. */
function bind(expr: Expr, ctx0: EvalContext): Bound {
  const locals = new Map<string, DistributionValue>();
  const rewrite = (e: Expr): Expr => {
    if (e.type === 'call' && e.callee.type === 'sym' && (e.callee.name === 'mean' || e.callee.name === 'sum') && e.args.length === 2 && e.args[0].type === 'sym') {
      const X = asDistribution(ctx0.lookup(e.args[0].name));
      if (X) {
        const n = Math.round(expectNumber(ctx0.evaluate(e.args[1])));
        // a name determined by the content: the same expression always gives the same variable (and seeds)
        const name = `__${e.callee.name}_${n}_${e.args[0].name}`;
        locals.set(name, iidDistribution(X, n, e.callee.name, e.args[0].name));
        return { type: 'sym', name };
      }
    }
    if (e.type === 'call') return { ...e, args: e.args.map(rewrite) };
    if (e.type === 'bin') return { ...e, left: rewrite(e.left), right: rewrite(e.right) };
    if (e.type === 'neg') return { ...e, arg: rewrite(e.arg) };
    if (e.type === 'eq') return { ...e, left: rewrite(e.left), right: rewrite(e.right) };
    return e;
  };
  const out = rewrite(expr);
  const ctx = withLocals(ctx0, locals);
  const names = [...freeSymbols(out)].filter((n) => asDistribution(ctx.lookup(n)));
  return { expr: out, names, rvs: names.map((n) => asDistribution(ctx.lookup(n))!), ctx };
}

/** Does the expression involve a random variable? */
export function hasRV(e: Expr, ctx: EvalContext): boolean {
  return [...freeSymbols(e)].some((n) => asDistribution(ctx.lookup(n)));
}

/** Affine coefficients g(x) = b + Σ cᵢ xᵢ when g is affine (checked at several points), else undefined. */
function affine(g: (...x: number[]) => number, rvs: DistributionValue[]): { b: number; c: number[] } | undefined {
  const mu = rvs.map((X) => (Number.isFinite(X.dist.mean) ? X.dist.mean : D.quantileOf(X.dist, 0.5)));
  const s = rvs.map((X) => Math.sqrt(X.dist.variance) || 1);
  const g0 = g(...mu);
  if (!Number.isFinite(g0)) return undefined;
  const c = mu.map((_, i) => (g(...mu.map((m, j) => (j === i ? m + s[i] : m))) - g0) / s[i]);
  if (!c.every(Number.isFinite)) return undefined;
  for (const t of [[0.7, -1.3, 0.4], [-0.45, 0.9, 1.7]]) {
    const x = mu.map((m, i) => m + t[i % 3] * s[i] * (1 + 0.1 * i));
    const lin = g0 + c.reduce((acc, ci, i) => acc + ci * (x[i] - mu[i]), 0);
    const val = g(...x);
    if (!(Math.abs(val - lin) <= 1e-9 * Math.max(1, Math.abs(val), Math.abs(g0)))) return undefined;
  }
  const clean = (v: number) => (Math.abs(v - Math.round(v)) < 1e-10 ? Math.round(v) : +v.toPrecision(13));
  return { b: clean(g0 - c.reduce((acc, ci, i) => acc + ci * mu[i], 0)), c: c.map(clean) };
}

// ------------------------------------------------------------------ distributions of functions

/** The distribution of the mean / sum of n iid copies (sampling distributions). */
function iidDistribution(X: DistributionValue, n: number, what: 'mean' | 'sum', name: string): DistributionValue {
  if (!(n >= 1 && n <= 100000)) throw new EvalError('n between 1 and 100000');
  const latex = what === 'mean' ? `\\bar{${name}}_{${n}}` : `S_{${n}}`;
  const key = `iid|${what}|${n}|${X.key}`;
  const total = linearDistribution(Array(n).fill(1), 0, Array(n).fill(X), Array.from({ length: n }, (_, i) => `${name}_${i + 1}`), latex, key);
  if (what === 'sum') return { ...total, key };
  const m = linearDistribution([1 / n], 0, [total], ['S'], latex, key);
  return { ...m, key, evidence: `${total.evidence}; X̄ = S/n: mean μ = ${fmt(X.dist.mean)}, sd σ/√n = ${fmt(Math.sqrt(X.dist.variance / n))}` };
}

/** b + Σ cᵢ Xᵢ for independent Xᵢ. */
function linearDistribution(c: number[], b: number, rvs: DistributionValue[], names: string[], latex: string, key: string): DistributionValue {
  const mean = b + c.reduce((s, ci, i) => s + ci * rvs[i].dist.mean, 0);
  const variance = c.reduce((s, ci, i) => s + ci * ci * rvs[i].dist.variance, 0);
  const cert = worst(...rvs.map((X) => X.certainty));
  const fams = rvs.map(famOf);
  const ok = (fam: string, params: number[], why: string): DistributionValue => ({ ...makeDistribution(fam, params), key, certainty: cert, evidence: why });
  if (fams.every((f) => f === 'Normal') && variance > 0) return ok('Normal', [mean, Math.sqrt(variance)], 'a linear combination of independent normal variables is normal');
  const unit = b === 0 && c.every((ci) => ci === 1);
  if (unit && rvs.length > 1 && fams.every((f) => f === fams[0])) {
    const P = rvs.map(parOf);
    const total = (k: number) => P.reduce((s, p) => s + p[k], 0);
    switch (fams[0]) {
      case 'Poisson':
        return ok('Poisson', [total(0)], 'a sum of independent Poisson variables is Poisson (the means add)');
      case 'Binomial':
        if (same(P.map((p) => p[1]))) return ok(total(0) === 1 ? 'Bernoulli' : 'Binomial', total(0) === 1 ? [P[0][1]] : [total(0), P[0][1]], 'a sum of independent binomials with the same p is binomial (the n add)');
        break;
      case 'Exponential':
        if (same(P.map((p) => p[0]))) return ok('Gamma', [rvs.length, 1 / P[0][0]], 'a sum of n independent Exp(λ) variables is Gamma(n, 1/λ)');
        break;
      case 'Gamma':
        if (same(P.map((p) => p[1]))) return ok('Gamma', [total(0), P[0][1]], 'independent gammas with the same scale add their shapes');
        break;
      case 'ChiSquared':
        return ok('ChiSquared', [total(0)], 'independent χ² variables add their degrees of freedom');
      case 'Geometric':
        if (same(P.map((p) => p[0]))) return ok('NegBinomial', [rvs.length, P[0][0]], 'the number of trials to the r-th success is a sum of r geometric variables');
        break;
      case 'NegBinomial':
        if (same(P.map((p) => p[1]))) return ok('NegBinomial', [total(0), P[0][1]], 'negative binomials with the same p add their r');
        break;
    }
  }
  if (rvs.length === 1) {
    const [X] = rvs;
    const a = c[0];
    if (a === 0) throw new EvalError('the expression does not depend on the random variable');
    const P = X.params;
    if (X.family === 'Uniform') return ok('Uniform', [Math.min(a * P[0] + b, a * P[1] + b), Math.max(a * P[0] + b, a * P[1] + b)], 'an affine image of a uniform variable is uniform');
    if (X.family === 'Exponential' && b === 0 && a > 0) return ok('Exponential', [P[0] / a], 'aX ~ Exp(λ/a) for a > 0');
    if (X.family === 'Gamma' && b === 0 && a > 0) return ok('Gamma', [P[0], a * P[1]], 'a gamma variable times a > 0 scales β');
    return derivedValue(affineDist(X.dist, a, b), latex, key, cert, `Y = aX + b with a = ${fmt(a)}, b = ${fmt(b)}: F_Y(y) = F_X((y − b)/a), E = aE(X) + b, V = a²V(X)`);
  }
  // discrete variables: exact convolution
  if (rvs.every((X) => X.discrete)) {
    const conv = convolve(c, b, rvs);
    if (conv) return derivedValue(conv.dist, latex, key, conv.truncated ? worst(cert, 'numeric') : cert, `pmf by exact convolution (${conv.dist.support!.length} values)`);
  }
  // two continuous variables: F(t) = ∫ f_Y(y) F_X((t − b − c_Y y)/c_X) dy — one numerical integral
  if (rvs.length === 2 && rvs.every((X) => !X.discrete)) {
    return derivedValue(convolve2(c, b, rvs[0].dist, rvs[1].dist, mean, variance), latex, key, worst(cert, 'numeric'), `F(t) = ∫ f_Y(y) F_X((t − ${fmt(b)} − ${fmt(c[1])}y)/${fmt(c[0])}) dy (independence), E and V exact`);
  }
  // continuous variables: simulation for the shape, exact moments
  const sim = simulate((...x) => b + c.reduce((s, ci, i) => s + ci * x[i], 0), rvs, key);
  void names;
  return derivedValue(empiricalDist(sim, mean, variance), latex, key, 'heuristic', `E = ${fmt(mean)} and V = ${fmt(variance)} exactly (linearity, independence); the shape from ${MC.toLocaleString()} simulated values`);
}

/** b + c₀X + c₁Y for independent continuous X, Y by numerical integration over y. */
function convolve2(c: number[], b: number, dx: D.Dist, dy: D.Dist, mean: number, variance: number): D.Dist {
  const [a, k] = c;
  const ylo = Number.isFinite(dy.lo) ? dy.lo : D.quantileOf(dy, 1e-12);
  const yhi = Number.isFinite(dy.hi) ? dy.hi : D.quantileOf(dy, 1 - 1e-12);
  const cuts = [ylo, D.quantileOf(dy, 0.25), D.quantileOf(dy, 0.5), D.quantileOf(dy, 0.75), yhi];
  const integral = (h: (y: number) => number) => {
    let s = 0;
    for (let i = 0; i + 1 < cuts.length; i++) if (cuts[i + 1] > cuts[i]) s += integrateNumeric(h, cuts[i], cuts[i + 1], 1e-10).value;
    return s;
  };
  const Fx = (x: number) => (a > 0 ? dx.cdf(x) : 1 - dx.cdf(x));
  // support: finite only when both supports are
  const ends = (d: D.Dist, m: number) => [m * d.lo, m * d.hi].map((v) => (Number.isNaN(v) ? 0 : v));
  const ex = ends(dx, a), ey = ends(dy, k);
  const lo = b + Math.min(...ex) + Math.min(...ey), hi = b + Math.max(...ex) + Math.max(...ey);
  return {
    name: 'convolution', discrete: false, lo, hi, mean, variance,
    cdf: (t) => Math.min(1, Math.max(0, integral((y) => dy.pdf(y) * Fx((t - b - k * y) / a)))),
    pdf: (t) => integral((y) => dy.pdf(y) * dx.pdf((t - b - k * y) / a)) / Math.abs(a),
    sample: (u, z) => b + a * dx.sample(u, z) + k * dy.sample(u, z),
  };
}

function convolve(c: number[], b: number, rvs: DistributionValue[]): { dist: D.Dist; truncated: boolean } | undefined {
  let acc = new Map<number, number>([[b, 1]]);
  let truncated = false;
  const key = (x: number) => +x.toPrecision(12);
  for (let i = 0; i < rvs.length; i++) {
    const s = supportOf(rvs[i].dist);
    if (!s) return undefined;
    truncated = truncated || s.truncated;
    const next = new Map<number, number>();
    for (const [v, p] of acc)
      for (let k = 0; k < s.xs.length; k++) {
        const y = key(v + c[i] * s.xs[k]);
        next.set(y, (next.get(y) ?? 0) + p * s.ps[k]);
      }
    if (next.size > 200000) return undefined;
    acc = next;
  }
  return { dist: finiteDist(acc), truncated };
}

/** Exact enumeration of g over the product of discrete supports. */
function enumerate(g: (...x: number[]) => number, rvs: DistributionValue[]): { dist: D.Dist; truncated: boolean } | undefined {
  const sup = rvs.map((X) => supportOf(X.dist, 5000));
  if (sup.some((s) => !s)) return undefined;
  const total = sup.reduce((n, s) => n * s!.xs.length, 1);
  if (total > 400000) return undefined;
  const map = new Map<number, number>();
  const x = new Array(rvs.length).fill(0);
  const rec = (i: number, p: number) => {
    if (i === rvs.length) {
      const y = g(...x);
      if (!Number.isFinite(y)) throw new EvalError('the function is undefined for some values of the variables');
      const k = +y.toPrecision(12);
      map.set(k, (map.get(k) ?? 0) + p);
      return;
    }
    const s = sup[i]!;
    for (let k = 0; k < s.xs.length; k++) {
      x[i] = s.xs[k];
      rec(i + 1, p * s.ps[k]);
    }
  };
  rec(0, 1);
  return { dist: finiteDist(map), truncated: sup.some((s) => s!.truncated) };
}

function simulate(g: (...x: number[]) => number, rvs: DistributionValue[], key: string, n = MC): Float64Array {
  const srcs = rvs.map((X, i) => seeded(`${key}|${X.key}|${i}`));
  const out = new Float64Array(n);
  let k = 0;
  const x = new Array(rvs.length).fill(0);
  for (let t = 0; t < n; t++) {
    for (let i = 0; i < rvs.length; i++) x[i] = rvs[i].dist.sample(srcs[i].u, srcs[i].z);
    const y = g(...x);
    if (Number.isFinite(y)) out[k++] = y;
  }
  if (k < n * 0.99) throw new EvalError('the function is undefined for too many values of the variables');
  return out.slice(0, k).sort();
}
/** Y = g(X) for one continuous X: the transformation theorem when g is monotone, else a quantile grid. */
function transform(g: (x: number) => number, X: DistributionValue, latex: string, key: string): DistributionValue {
  const d = X.dist;
  const N = 4096;
  const xs = Array.from({ length: N }, (_, i) => D.quantileOf(d, (i + 0.5) / N));
  const ys = xs.map(g);
  if (!ys.every(Number.isFinite)) throw new EvalError('the function is undefined for some values of the variable');
  const inc = ys.every((y, i) => i === 0 || y > ys[i - 1]);
  const dec = ys.every((y, i) => i === 0 || y < ys[i - 1]);
  const cert = worst(X.certainty, 'numeric');
  const mean = expectation1(g, X).value;
  const m2 = expectation1((x) => g(x) ** 2, X).value;
  const variance = Math.max(0, m2 - mean * mean);
  if (inc || dec) {
    const lo = Number.isFinite(d.lo) ? d.lo : D.quantileOf(d, 1e-12);
    const hi = Number.isFinite(d.hi) ? d.hi : D.quantileOf(d, 1 - 1e-12);
    // x with g(x) = y, by bisection
    const ginv = (y: number) => {
      let a = lo, b = hi;
      for (let k = 0; k < 80; k++) {
        const m = (a + b) / 2;
        if ((g(m) < y) === inc) a = m;
        else b = m;
      }
      return (a + b) / 2;
    };
    const glo = g(lo), ghi = g(hi);
    const ymin = Math.min(glo, ghi), ymax = Math.max(glo, ghi);
    const dist: D.Dist = {
      name: 'transform', discrete: false, lo: ymin, hi: ymax, mean, variance,
      cdf: (y) => {
        if (y <= ymin) return 0;
        if (y >= ymax) return 1;
        const F = d.cdf(ginv(y));
        return inc ? F : 1 - F;
      },
      pdf: (y) => {
        if (y <= ymin || y >= ymax) return 0;
        const x = ginv(y);
        const h = 1e-5 * (1 + Math.abs(x));
        const dg = (g(x + h) - g(x - h)) / (2 * h);
        return d.pdf(x) / Math.abs(dg);
      },
      quantile: (p) => g(D.quantileOf(d, inc ? p : 1 - p)),
      sample: (u, z) => g(d.sample(u, z)),
    };
    return derivedValue(dist, latex, key, cert, `g is ${inc ? 'increasing' : 'decreasing'}: f_Y(y) = f_X(g⁻¹(y))·|dg⁻¹/dy| (transformation theorem)`);
  }
  return derivedValue(empiricalDist(Float64Array.from(ys).sort(), mean, variance), latex, key, cert, `g is not monotone: F_Y(y) = P(g(X) ≤ y) from ${N} quantiles of X`);
}

/** The distribution of an expression in random variables. */
export function deriveRV(expr: Expr, ctx0: EvalContext): DistributionValue {
  const B = bind(expr, ctx0);
  if (!B.names.length) throw new EvalError('no random variable in this expression (define one with X ~ Normal(0, 1))');
  if (B.expr.type === 'sym') return B.rvs[0];
  const latex = toLatex(expr);
  const key = `rv|${toText(B.expr)}|${B.rvs.map((X) => X.key)}`;
  const g = B.ctx.makeFunction(B.expr, B.names).eval as (...x: number[]) => number;
  const lin = affine(g, B.rvs);
  if (lin) return linearDistribution(lin.c, lin.b, B.rvs, B.names, latex, key);
  const cert = worst(...B.rvs.map((X) => X.certainty));
  if (B.rvs.every((X) => X.discrete)) {
    const en = enumerate(g, B.rvs);
    if (en) return derivedValue(en.dist, latex, key, en.truncated ? worst(cert, 'numeric') : cert, `exact: every combination of values (${en.dist.support!.length} values of the result)`);
  }
  if (B.rvs.length === 1 && !B.rvs[0].discrete) return transform((x) => g(x), B.rvs[0], latex, key);
  const sim = simulate(g, B.rvs, key);
  return derivedValue(empiricalDist(sim), latex, key, 'heuristic', `${MC.toLocaleString()} simulated values (seeded)`);
}

// ------------------------------------------------------------------ expectations

/** E[g(X)] for one variable: a sum over the pmf or ∫ g f dx. */
function expectation1(g: (x: number) => number, X: DistributionValue): { value: number; certainty: Certainty } {
  const d = X.dist;
  if (d.discrete) {
    const s = supportOf(d, 200000);
    if (!s) throw new EvalError('too many values to sum');
    let v = 0;
    for (let k = 0; k < s.xs.length; k++) v += g(s.xs[k]) * s.ps[k];
    return { value: v, certainty: s.truncated ? 'numeric' : X.certainty };
  }
  const lo = Number.isFinite(d.lo) ? d.lo : -Infinity;
  const hi = Number.isFinite(d.hi) ? d.hi : Infinity;
  // split at the quartiles so peaked densities are integrated well
  const cuts = [lo, D.quantileOf(d, 0.25), D.quantileOf(d, 0.5), D.quantileOf(d, 0.75), hi];
  let v = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    if (!(cuts[i + 1] > cuts[i])) continue;
    v += integrateNumeric((x) => {
      const f = d.pdf(x);
      return f > 0 ? g(x) * f : 0;
    }, cuts[i], cuts[i + 1], 1e-11).value;
  }
  return { value: v, certainty: worst(X.certainty, 'numeric') };
}

export interface Moment {
  value: number;
  certainty: Certainty;
  evidence: string;
  derivation?: string;
}

function coefTex(c: number, first: boolean): string {
  const sign = c < 0 ? '-' : first ? '' : '+';
  const a = Math.abs(c);
  return `${sign}${a === 1 ? '' : numberLatex(a, 6)}`;
}

/** E, V or SD of an expression in random variables. */
export function momentOf(expr: Expr, what: 'mean' | 'variance' | 'sd', ctx0: EvalContext): Moment {
  const B = bind(expr, ctx0);
  if (!B.names.length) throw new EvalError('no random variable in this expression');
  const g = B.ctx.makeFunction(B.expr, B.names).eval as (...x: number[]) => number;
  const lin = affine(g, B.rvs);
  const cert = worst(...B.rvs.map((X) => X.certainty));
  const tex = toLatex(expr);
  const N = B.names.map((n, i) => (n.startsWith('__') ? B.rvs[i].latex : n));
  const sd = (m: Moment): Moment => (what === 'sd' ? { ...m, value: Math.sqrt(m.value), derivation: `\\sigma = \\sqrt{V\\left(${tex}\\right)} = \\sqrt{${numberLatex(m.value, 6)}}` } : m);
  if (lin) {
    const { b, c } = lin;
    if (what === 'mean') {
      const value = b + c.reduce((s, ci, i) => s + ci * B.rvs[i].dist.mean, 0);
      const terms = c.map((ci, i) => `${coefTex(ci, i === 0)}E(${N[i]})`).join(' ') + (b ? ` ${b < 0 ? '-' : '+'} ${numberLatex(Math.abs(b), 6)}` : '');
      return { value, certainty: cert, evidence: 'linearity of expectation', derivation: `E\\left(${tex}\\right) = ${terms}` };
    }
    const value = c.reduce((s, ci, i) => s + ci * ci * B.rvs[i].dist.variance, 0);
    const terms = c.map((ci, i) => `${ci * ci === 1 ? '' : numberLatex(ci * ci, 6)}V(${N[i]})`).join(' + ');
    return sd({ value, certainty: cert, evidence: B.names.length > 1 ? 'V(Σ cᵢXᵢ) = Σ cᵢ² V(Xᵢ) for independent variables' : 'V(aX + b) = a² V(X)', derivation: `V\\left(${tex}\\right) = ${terms}` });
  }
  const E = (h: (...x: number[]) => number): { value: number; certainty: Certainty; how: string } => {
    if (B.rvs.length === 1) return { ...expectation1((x) => h(x), B.rvs[0]), how: B.rvs[0].discrete ? 'E[h(X)] = Σ h(x) p(x)' : 'E[h(X)] = ∫ h(x) f(x) dx' };
    if (B.rvs.every((X) => X.discrete)) {
      const en = enumerate(h, B.rvs);
      if (en) return { value: en.dist.mean, certainty: en.truncated ? 'numeric' : cert, how: 'a sum over every combination of values' };
    }
    const sim = simulate(h, B.rvs, `E|${toText(B.expr)}`);
    return { value: sim.reduce((a, v) => a + v, 0) / sim.length, certainty: 'heuristic', how: `${MC.toLocaleString()} simulated values` };
  };
  // a product of factors about different (independent) variables: E(XY) = E(X)·E(Y)
  if (what === 'mean') {
    const factors: Expr[] = [];
    const flat = (e: Expr): void => {
      if (e.type === 'bin' && e.op === '*') {
        flat(e.left);
        flat(e.right);
      } else factors.push(e);
    };
    flat(B.expr);
    const sets = factors.map((f) => [...freeSymbols(f)].filter((n) => B.names.includes(n)));
    const random = sets.filter((s) => s.length > 0);
    const disjoint = random.length > 1 && new Set(random.flat()).size === random.flat().length;
    if (disjoint) {
      let value = 1;
      const certs: Certainty[] = [];
      factors.forEach((f, i) => {
        if (sets[i].length) {
          const m = momentOf(f, 'mean', B.ctx);
          value *= m.value;
          certs.push(m.certainty);
        } else value *= expectNumber(B.ctx.evaluate(f));
      });
      return { value, certainty: worst(...certs), evidence: 'independent factors: E(XY) = E(X)·E(Y)', derivation: `E\\left(${tex}\\right) = ${factors.filter((_, i) => sets[i].length).map((f) => `E\\left(${toLatex(f)}\\right)`).join('\\,')}` };
    }
  }
  const m1 = E(g);
  if (what === 'mean') return { value: m1.value, certainty: m1.certainty, evidence: m1.how };
  const m2 = E((...x) => g(...x) ** 2);
  return sd({ value: Math.max(0, m2.value - m1.value ** 2), certainty: worst(m1.certainty, m2.certainty), evidence: `V = E[h²] − (E[h])², ${m1.how}`, derivation: `V\\left(${tex}\\right) = E\\left[(${tex})^2\\right] - \\left(E\\left[${tex}\\right]\\right)^2` });
}
/** Cov(U, V) for expressions in independent random variables. */
export function covarianceOf(a: Expr, b: Expr, ctx0: EvalContext): Moment {
  const B = bind({ type: 'vec', items: [a, b] }, ctx0);
  if (!B.names.length) throw new EvalError('no random variable in these expressions');
  const [ea, eb] = (B.expr as Extract<Expr, { type: 'vec' }>).items;
  const dep = (e: Expr) => [...freeSymbols(e)].filter((n) => B.names.includes(n));
  const cert = worst(...B.rvs.map((X) => X.certainty));
  const tex = `\\operatorname{Cov}\\left(${toLatex(a)}, ${toLatex(b)}\\right)`;
  // no variable in common: independent, covariance 0
  if (!dep(ea).some((n) => dep(eb).includes(n))) return { value: 0, certainty: cert, evidence: 'the two expressions involve different independent variables, so their covariance is 0', derivation: `${tex} = 0` };
  const ga = B.ctx.makeFunction(ea, B.names).eval as (...x: number[]) => number;
  const gb = B.ctx.makeFunction(eb, B.names).eval as (...x: number[]) => number;
  const la = affine(ga, B.rvs), lb = affine(gb, B.rvs);
  if (la && lb) {
    const value = la.c.reduce((s, c, i) => s + c * lb.c[i] * B.rvs[i].dist.variance, 0);
    const terms = la.c.map((c, i) => (c * lb.c[i] ? `${numberLatex(c * lb.c[i], 6)}V(${B.names[i]})` : '')).filter(Boolean).join(' + ');
    return { value, certainty: cert, evidence: 'Cov(ΣaᵢXᵢ, ΣbᵢXᵢ) = Σ aᵢbᵢ V(Xᵢ) for independent Xᵢ', derivation: `${tex} = ${terms || '0'}` };
  }
  const prod: Expr = { type: 'bin', op: '*', left: ea, right: eb };
  const m = [momentOf(prod, 'mean', B.ctx), momentOf(ea, 'mean', B.ctx), momentOf(eb, 'mean', B.ctx)];
  return { value: m[0].value - m[1].value * m[2].value, certainty: worst(...m.map((x) => x.certainty)), evidence: 'Cov(U, V) = E(UV) − E(U)E(V)', derivation: `${tex} = E(UV) - E(U)E(V)` };
}

export const covBuiltins: Builtin[] = [
  {
    name: 'Cov', minArgs: 2, maxArgs: 2, argModes: ['raw', 'raw'], category: 'statistics', signature: 'Cov(X + Y, X - Y)',
    doc: 'Covariance of two expressions in independent random variables.',
    apply: (_a, ctx, raw) => {
      const m = covarianceOf(raw[0], raw[1], ctx);
      return scalar(m.value, { certainty: m.certainty, evidence: m.evidence, derivation: m.derivation });
    },
  },
  {
    name: 'Corr', minArgs: 2, maxArgs: 2, argModes: ['raw', 'raw'], category: 'statistics', signature: 'Corr(X, X + Y)',
    doc: 'Correlation ρ = Cov(U, V) / (σ_U σ_V).',
    apply: (_a, ctx, raw) => {
      const c = covarianceOf(raw[0], raw[1], ctx);
      const sa = momentOf(raw[0], 'variance', ctx), sb = momentOf(raw[1], 'variance', ctx);
      if (!(sa.value > 0 && sb.value > 0)) throw new EvalError('correlation needs two variables with positive variance');
      return scalar(c.value / Math.sqrt(sa.value * sb.value), { certainty: worst(c.certainty, sa.certainty, sb.certainty), evidence: 'ρ = Cov(U, V) / (σ_U σ_V)', derivation: `\\rho = \\frac{${numberLatex(c.value, 6)}}{\\sqrt{${numberLatex(sa.value, 6)} \\cdot ${numberLatex(sb.value, 6)}}}` });
    },
  },
];

// ------------------------------------------------------------------ events about random variables

type Rel = '<' | '<=' | '>' | '>=' | '=' | '!=';
interface Atom {
  /** the event is "rv rel c" */
  rv: DistributionValue;
  rel: Rel;
  c: number;
  /** the comparison as written is "L − R orig 0" (used when simulating) */
  orig: Rel;
  diff: (...x: number[]) => number;
  bases: string[];
  /** which variable the event is about: the expression in the variables' names (X, X + Y), not the distribution */
  id: string;
}
type Ev = { t: 'atom'; i: number } | { t: 'and' | 'or'; a: Ev; b: Ev } | { t: 'not'; a: Ev };

const FLIP: Record<Rel, Rel> = { '<': '>', '>': '<', '<=': '>=', '>=': '<=', '=': '=', '!=': '!=' };
const holds = (y: number, rel: Rel, c: number) =>
  rel === '<' ? y < c : rel === '<=' ? y <= c : rel === '>' ? y > c : rel === '>=' ? y >= c : rel === '=' ? Math.abs(y - c) < 1e-12 : Math.abs(y - c) >= 1e-12;

function parseEvent(e: Expr, atoms: Atom[], top: Bound): Ev {
  if (e.type === 'call' && e.callee.type === 'sym' && (e.callee.name === 'and' || e.callee.name === 'or'))
    return { t: e.callee.name, a: parseEvent(e.args[0], atoms, top), b: parseEvent(e.args[1], atoms, top) };
  if (e.type === 'call' && e.callee.type === 'sym' && e.callee.name === 'not') return { t: 'not', a: parseEvent(e.args[0], atoms, top) };
  if (e.type === 'eq') {
    if (e.left.type === 'eq') {
      // a < X ≤ b: two comparisons joined by and
      const inner = e.left;
      const a1 = parseEvent({ type: 'eq', left: inner.left, right: inner.right, rel: inner.rel }, atoms, top);
      const a2 = parseEvent({ type: 'eq', left: inner.right, right: e.right, rel: e.rel }, atoms, top);
      return { t: 'and', a: a1, b: a2 };
    }
    atoms.push(atomOf(e.left, (e.rel ?? '=') as Rel, e.right, top));
    return { t: 'atom', i: atoms.length - 1 };
  }
  throw new EvalError('P(…) of random variables needs comparisons, e.g. P(X + Y > 3) or P(X > 3 | X > 1)');
}

function atomOf(L: Expr, rel: Rel, R: Expr, top: Bound): Atom {
  const ctx = top.ctx;
  const lr = hasRV(L, ctx), rr = hasRV(R, ctx);
  if (!lr && !rr) throw new EvalError('each comparison in P(…) must involve a random variable');
  const diffExpr: Expr = { type: 'bin', op: '-', left: L, right: R };
  const diff = ctx.makeFunction(diffExpr, top.names).eval as (...x: number[]) => number;
  const bases = [...freeSymbols(diffExpr)].filter((n) => top.names.includes(n));
  if (lr && rr) return { rv: deriveRV(diffExpr, ctx), rel, c: 0, orig: rel, diff, bases, id: toText(diffExpr) };
  const [side, other, r] = lr ? [L, R, rel] : [R, L, FLIP[rel]];
  return { rv: deriveRV(side, ctx), rel: r, c: expectNumber(ctx.evaluate(other)), orig: rel, diff, bases, id: toText(side) };
}

interface EventResult {
  p: number;
  certainty: Certainty;
  how: string;
  rv?: DistributionValue;
  shade?: [number, number];
}

/** P(event): interval algebra on one variable, products for independent variables, else simulation. */
function eventProb(e: Expr, ctx0: EvalContext): EventResult {
  const top = bind(e, ctx0);
  const atoms: Atom[] = [];
  const ev = parseEvent(top.expr, atoms, top);
  const truth = (x: Ev, val: (a: Atom, i: number) => boolean): boolean =>
    x.t === 'atom' ? val(atoms[x.i], x.i) : x.t === 'not' ? !truth(x.a, val) : x.t === 'and' ? truth(x.a, val) && truth(x.b, val) : truth(x.a, val) || truth(x.b, val);
  // one variable: the constants cut the line into points and open gaps; the event is a union of pieces
  if (atoms.every((a) => a.id === atoms[0].id)) {
    const rv = atoms[0].rv;
    const d = rv.dist;
    const cs = [...new Set(atoms.map((a) => a.c))].sort((p, q) => p - q);
    const reps: number[] = [cs[0] - 1];
    cs.forEach((c, i) => reps.push(c, i + 1 < cs.length ? (c + cs[i + 1]) / 2 : c + 1));
    const last = reps.length - 1;
    const on = reps.map((y) => truth(ev, (a) => holds(y, a.rel, a.c)));
    const gapLo = (k: number) => (k === 0 ? -Infinity : reps[k - 1]);
    const gapHi = (k: number) => (k === last ? Infinity : reps[k + 1]);
    let p = 0;
    on.forEach((yes, k) => {
      if (!yes) return;
      if (k % 2 === 1) p += d.discrete ? d.pdf(reps[k]) : 0;
      else p += Math.max(0, (gapHi(k) === Infinity ? 1 : cdfStrict(d, gapHi(k), true)) - (gapLo(k) === -Infinity ? 0 : d.cdf(gapLo(k))));
    });
    const ks = on.map((v, k) => (v ? k : -1)).filter((k) => k >= 0);
    const run = ks.length > 0 && ks[ks.length - 1] - ks[0] === ks.length - 1;
    const shade: [number, number] | undefined = run ? [ks[0] % 2 ? reps[ks[0]] : gapLo(ks[0]), ks[ks.length - 1] % 2 ? reps[ks[ks.length - 1]] : gapHi(ks[ks.length - 1])] : undefined;
    const how = rv.family === 'derived' || rv.evidence ? `the distribution of ${rv.latex.replace(/\\[a-z]+|[{}]/g, '')}: ${rv.evidence}` : rv.discrete ? 'a sum of the pmf over the event' : 'differences of cdf values';
    return { p: Math.min(1, p), certainty: rv.certainty, how, rv, shade };
  }
  // a conjunction about independent variables: multiply the probabilities
  const conj = (x: Ev): number[] | undefined => {
    if (x.t === 'atom') return [x.i];
    if (x.t !== 'and') return undefined;
    const l = conj(x.a), r = conj(x.b);
    return l && r ? [...l, ...r] : undefined;
  };
  const parts = conj(ev);
  if (parts) {
    const groups = new Map<string, Atom[]>();
    for (const i of parts) groups.set(atoms[i].id, [...(groups.get(atoms[i].id) ?? []), atoms[i]]);
    const bases = [...groups.values()].map((g) => new Set(g.flatMap((a) => a.bases)));
    const independent = bases.every((s, i) => bases.every((t, j) => j <= i || [...s].every((n) => !t.has(n))));
    if (independent) {
      let p = 1;
      for (const g of groups.values()) p *= intervalProb(g);
      return { p, certainty: worst(...[...groups.values()].map((g) => g[0].rv.certainty)), how: 'the events concern independent variables: P(A ∩ B) = P(A)·P(B)' };
    }
  }
  // otherwise simulate the variables
  const srcs = top.rvs.map((X, i) => seeded(`P|${toText(top.expr)}|${X.key}|${i}`));
  const x = new Array(top.rvs.length).fill(0);
  let hits = 0;
  for (let t = 0; t < MC; t++) {
    for (let i = 0; i < top.rvs.length; i++) x[i] = top.rvs[i].dist.sample(srcs[i].u, srcs[i].z);
    if (truth(ev, (a) => holds(a.diff(...x), a.orig, 0))) hits++;
  }
  const p = hits / MC;
  return { p, certainty: 'heuristic', how: `Monte Carlo: ${MC.toLocaleString()} seeded simulations, standard error ≈ ${fmt(Math.sqrt((p * (1 - p)) / MC))}` };
}

/** P(lo < / ≤ Y < / ≤ hi) for a conjunction of comparisons of one variable with constants. */
function intervalProb(atoms: Atom[]): number {
  const d = atoms[0].rv.dist;
  let lo = -Infinity, hi = Infinity, loStrict = false, hiStrict = false;
  let eq: number | undefined;
  for (const a of atoms) {
    if (a.rel === '<' || a.rel === '<=') {
      if (a.c < hi || (a.c === hi && a.rel === '<')) [hi, hiStrict] = [a.c, a.rel === '<'];
    } else if (a.rel === '>' || a.rel === '>=') {
      if (a.c > lo || (a.c === lo && a.rel === '>')) [lo, loStrict] = [a.c, a.rel === '>'];
    } else if (a.rel === '=') eq = a.c;
    else return 1 - (d.discrete ? d.pdf(a.c) : 0);
  }
  if (eq !== undefined) return eq >= lo && eq <= hi && d.discrete ? d.pdf(eq) : 0;
  const up = hi === Infinity ? 1 : cdfStrict(d, hi, hiStrict);
  const down = lo === -Infinity ? 0 : cdfStrict(d, lo, !loStrict);
  return Math.max(0, up - down);
}

const isGiven = (e: Expr) => e.type === 'call' && e.callee.type === 'sym' && e.callee.name === 'given';

/** P(event) and P(E | F) for events about random variables. */
export function rvProbability(arg: Expr, ctx: EvalContext, label: string): MathValue {
  const plot = (r: EventResult, shade?: [number, number]) => (r.rv ? { visuals: [visual('distplot', { dist: r.rv, shade, sname: label }, `P(${label})`, 'probability')] } : {});
  if (isGiven(arg)) {
    const [E, F] = (arg as Extract<Expr, { type: 'call' }>).args;
    const pf = eventProb(F, ctx);
    if (!(pf.p > 0)) throw new EvalError('the condition has probability 0');
    const pef = eventProb({ type: 'call', callee: { type: 'sym', name: 'and' }, args: [E, F] }, ctx);
    return scalar(pef.p / pf.p, {
      certainty: worst(pf.certainty, pef.certainty),
      evidence: `P(E | F) = P(E ∩ F) / P(F); ${pef.how}`,
      derivation: `\\frac{P(E \\cap F)}{P(F)} = \\frac{${numberLatex(pef.p, 6)}}{${numberLatex(pf.p, 6)}}`,
      ...plot(pf, pef.shade),
    }) as MathValue;
  }
  const r = eventProb(arg, ctx);
  return scalar(r.p, { certainty: r.certainty, evidence: r.how, ...plot(r, r.shade) }) as MathValue;
}

// ------------------------------------------------------------------ builtins

/** Y ~ expression: the parser wraps the right side of ~ in rv(…). */
export const rvBuiltin: Builtin = {
  name: 'rv', minArgs: 1, maxArgs: 1, argModes: ['raw'], category: 'statistics', signature: 'Y ~ 2X + 3 · S ~ X1 + X2 · Xbar ~ mean(X, n)',
  doc: 'The distribution of a function of random variables.',
  apply: (_a, ctx, raw) => {
    const e = raw[0];
    const sampling = e.type === 'call' && e.callee.type === 'sym' && ['mean', 'sum'].includes(e.callee.name);
    if (!sampling && !hasRV(e, ctx)) {
      const v = ctx.evaluate(e);
      if (asDistribution(v)) return v;
      throw new EvalError('the right side of ~ is a distribution, e.g. X ~ Normal(0, 1), or an expression in random variables');
    }
    return deriveRV(e, ctx) as unknown as MathValue;
  },
};

/** Running mean of a seeded sample — the law of large numbers. */
export const llnBuiltin: Builtin = {
  name: 'lln', minArgs: 1, maxArgs: 2, argModes: ['raw', 'value'], category: 'statistics', signature: 'lln(X [, n])',
  doc: 'Running mean of n simulated values of X approaching E(X) — the law of large numbers.',
  apply: (args, ctx, raw) => {
    const X = deriveRV(raw[0], ctx);
    const n = args[1] ? Math.round(expectNumber(args[1])) : 2000;
    if (!(n >= 10 && n <= 200000)) throw new EvalError('n between 10 and 200000');
    const { u, z } = seeded(`lln|${X.key}|${n}`);
    const means: number[] = [];
    let s = 0;
    for (let i = 0; i < n; i++) {
      s += X.dist.sample(u, z);
      means.push(s / (i + 1));
    }
    const nm = toLatex(raw[0]);
    return {
      kind: 'text', text: `x̄ after ${n} draws = ${fmt(means[n - 1])}  →  E = ${fmt(X.dist.mean)}`, certainty: 'heuristic', evidence: 'simulation (seeded); the band is E ± 2σ/√n',
      visuals: [visual('llnplot', { means, mu: X.dist.mean, sd: Math.sqrt(X.dist.variance), sname: nm }, 'running mean', 'lln')],
    } as unknown as MathValue;
  },
};