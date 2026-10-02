/**
 * Random variables (Phase 5, Devore, Berk & Carlton ch. 3–6): X ~ Normal(0, 1) is a typed object with its
 * pmf / pdf, cdf, moments and quantiles; P(a < X ≤ b), E(X), Var(X), quantile(X, p), pdf X, cdf X,
 * sample(X, n) and the CLT picture are ordinary builtins. Parameterizations follow the book:
 * Normal(μ, σ) (σ the sd), Exponential(λ) (rate), Gamma(α, β) (β a scale), NegBinomial(r, p) and
 * Geometric(p) count trials, Hypergeometric(n, M, N), Weibull(α shape, β scale), Lognormal(μ, σ of ln X).
 */
import { Expr, num, sym } from '../../math-core/ast';
import { Builtin, EvalContext, EvalError, expectNumber } from '../../math-core/builtins';
import { FunctionValue, MathValue, scalar } from '../../math-core/values';
import { numberLatex, symbolLatex, toLatex, toText } from '../../math-core/symbolic/print';
import { compileScalar } from '../../math-core/compile';
import { parseExpression } from '../../parser/parser';
import * as D from '../../math-core/distributions';
import { visual } from '../../visualization/scene-model';
import { isEventQuery, eventProbability } from './events';
import { rvProbability, momentOf } from './derived';

/** How a P(…) argument reads in a plot legend: P(X + Y > 3) → "X + Y". */
function rvLabel(e: Expr): string {
  let x = e;
  while (x.type === 'call' && x.callee.type === 'sym' && ['given', 'and', 'or', 'not'].includes(x.callee.name)) x = x.args[0];
  while (x.type === 'eq' && x.left.type === 'eq') x = x.left;
  if (x.type === 'eq') return toText(x.left.type === 'num' ? x.right : x.left);
  return 'X';
}

export interface DistributionValue {
  kind: 'distribution';
  family: string;
  params: number[];
  latex: string;
  discrete: boolean;
  dist: D.Dist;
  /** symbolic density (x as the variable) when the family has a closed form */
  pdfSrc?: string;
  key: string;
  certainty: 'exact' | 'numeric' | 'heuristic';
  /** how a derived variable's distribution was obtained (Y ~ 2X + 3, S ~ X1 + X2) */
  evidence?: string;
  [k: string]: unknown;
}

/** Shift a distribution by an integer (failures → trials). */
function shifted(d: D.Dist, k: number, name: string): D.Dist {
  return {
    ...d, name, lo: d.lo + k, hi: d.hi + k, mean: d.mean + k,
    pdf: (x) => d.pdf(x - k), cdf: (x) => d.cdf(x - k),
    quantile: (p) => D.quantileOf(d, p) + k,
    sample: (u, z) => d.sample(u, z) + k,
  };
}

/** A finite pmf from values and probabilities. */
function finite(xs: number[], ps: number[]): D.Dist {
  if (xs.length !== ps.length || !xs.length) throw new EvalError('pmf(values, probabilities): two lists of the same length');
  const total = ps.reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 1e-9) throw new EvalError(`the probabilities add up to ${+total.toPrecision(6)}, not 1`);
  if (ps.some((p) => p < 0)) throw new EvalError('probabilities cannot be negative');
  const order = xs.map((x, i) => [x, ps[i]]).sort((a, b) => a[0] - b[0]);
  const mean = order.reduce((s, [x, p]) => s + x * p, 0);
  const variance = order.reduce((s, [x, p]) => s + (x - mean) ** 2 * p, 0);
  return {
    name: 'pmf', discrete: true, lo: order[0][0], hi: order[order.length - 1][0], mean, variance,
    pdf: (x) => order.find(([v]) => Math.abs(v - x) < 1e-12)?.[1] ?? 0,
    cdf: (x) => order.filter(([v]) => v <= x + 1e-12).reduce((s, [, p]) => s + p, 0),
    quantile: (p) => {
      let s = 0;
      for (const [v, q] of order) {
        s += q;
        if (s >= p - 1e-12) return v;
      }
      return order[order.length - 1][0];
    },
    sample: (u) => {
      let r = u();
      for (const [v, q] of order) {
        if (r < q) return v;
        r -= q;
      }
      return order[order.length - 1][0];
    },
  };
}

interface Family {
  name: string;
  tex: string;
  args: number;
  optional?: number;
  make: (p: number[]) => D.Dist;
  check?: (p: number[]) => string | undefined;
  pdf?: (p: number[]) => string;
}

const pos = (x: number) => x > 0;
const prob = (p: number) => p >= 0 && p <= 1;

const FAMILIES: Family[] = [
  { name: 'Normal', tex: 'N', args: 2, make: ([m, s]) => D.normal(m, s), check: ([, s]) => (pos(s) ? undefined : 'σ must be positive (Normal(μ, σ) takes the standard deviation)'), pdf: ([m, s]) => `exp(-(x - (${m}))^2/(2*(${s})^2))/((${s})*sqrt(2*pi))` },
  { name: 'Uniform', tex: '\\operatorname{Unif}', args: 2, make: ([a, b]) => D.uniform(a, b), check: ([a, b]) => (b > a ? undefined : 'Uniform(A, B) needs A < B'), pdf: ([a, b]) => `{x >= ${a} and x <= ${b}: 1/(${b - a}), 0}` },
  { name: 'Exponential', tex: '\\operatorname{Exp}', args: 1, make: ([l]) => D.exponential(l), check: ([l]) => (pos(l) ? undefined : 'λ must be positive (Exponential(λ) takes the rate)'), pdf: ([l]) => `{x >= 0: (${l})*exp(-(${l})*x), 0}` },
  { name: 'Gamma', tex: '\\operatorname{Gamma}', args: 2, make: ([a, b]) => D.gamma(a, b), check: ([a, b]) => (pos(a) && pos(b) ? undefined : 'Gamma(α, β) needs α, β > 0 (β is a scale)'), pdf: ([a, b]) => `{x > 0: x^(${a - 1})*exp(-x/(${b}))/(${Math.exp(D.lgamma(a) + a * Math.log(b))}), 0}` },
  { name: 'Weibull', tex: '\\operatorname{Weibull}', args: 2, make: ([a, b]) => D.weibull(a, b), check: ([a, b]) => (pos(a) && pos(b) ? undefined : 'Weibull(α, β) needs α, β > 0'), pdf: ([a, b]) => `{x > 0: (${a}/${b})*(x/(${b}))^(${a - 1})*exp(-(x/(${b}))^(${a})), 0}` },
  { name: 'Lognormal', tex: '\\operatorname{LN}', args: 2, make: ([m, s]) => D.lognormal(m, s), check: ([, s]) => (pos(s) ? undefined : 'σ must be positive'), pdf: ([m, s]) => `{x > 0: exp(-(ln(x) - (${m}))^2/(2*(${s})^2))/(x*(${s})*sqrt(2*pi)), 0}` },
  { name: 'Beta', tex: '\\operatorname{Beta}', args: 2, optional: 2, make: ([a, b, A = 0, B = 1]) => D.betaDist(a, b, A, B), check: ([a, b]) => (pos(a) && pos(b) ? undefined : 'Beta(α, β) needs α, β > 0') },
  { name: 'ChiSquared', tex: '\\chi^2', args: 1, make: ([v]) => D.chiSquared(v), check: ([v]) => (pos(v) ? undefined : 'ν must be positive') },
  { name: 'StudentT', tex: 't', args: 1, make: ([v]) => D.studentT(v), check: ([v]) => (pos(v) ? undefined : 'ν must be positive') },
  { name: 'FDist', tex: 'F', args: 2, make: ([a, b]) => D.fDist(a, b), check: ([a, b]) => (pos(a) && pos(b) ? undefined : 'ν₁, ν₂ must be positive') },
  { name: 'Binomial', tex: '\\operatorname{Bin}', args: 2, make: ([n, p]) => D.binomial(n, p), check: ([n, p]) => (Number.isInteger(n) && n >= 0 && prob(p) ? undefined : 'Binomial(n, p): n a whole number, 0 ≤ p ≤ 1') },
  { name: 'DiscreteUniform', tex: '\\operatorname{DU}', args: 2, make: ([a, b]) => finite(Array.from({ length: b - a + 1 }, (_, i) => a + i), Array(b - a + 1).fill(1 / (b - a + 1))), check: ([a, b]) => (Number.isInteger(a) && Number.isInteger(b) && a <= b && b - a < 1e5 ? undefined : 'DiscreteUniform(a, b): whole numbers a ≤ b (a fair die is DiscreteUniform(1, 6))') },
  { name: 'Bernoulli', tex: '\\operatorname{Bernoulli}', args: 1, make: ([p]) => D.binomial(1, p), check: ([p]) => (prob(p) ? undefined : '0 ≤ p ≤ 1') },
  { name: 'Poisson', tex: '\\operatorname{Poisson}', args: 1, make: ([m]) => D.poisson(m), check: ([m]) => (pos(m) ? undefined : 'μ must be positive') },
  { name: 'Geometric', tex: '\\operatorname{Geom}', args: 1, make: ([p]) => shifted(D.geometricFailures(p), 1, 'Geom'), check: ([p]) => (p > 0 && p <= 1 ? undefined : '0 < p ≤ 1 (X counts trials up to the first success)') },
  { name: 'NegBinomial', tex: '\\operatorname{NB}', args: 2, make: ([r, p]) => shifted(D.negbinFailures(r, p), r, 'NB'), check: ([r, p]) => (Number.isInteger(r) && r > 0 && p > 0 && p <= 1 ? undefined : 'NegBinomial(r, p): X counts trials up to the r-th success') },
  { name: 'Hypergeometric', tex: '\\operatorname{Hyp}', args: 3, make: ([n, M, N]) => D.hypergeometric(n, M, N), check: ([n, M, N]) => (Number.isInteger(n) && Number.isInteger(M) && Number.isInteger(N) && n <= N && M <= N ? undefined : 'Hypergeometric(n, M, N): n drawn from N with M successes') },
];
const ALIASES: Record<string, string> = { Unid: 'DiscreteUniform', Unif: 'Uniform', Exp: 'Exponential', Bin: 'Binomial', Geom: 'Geometric', NB: 'NegBinomial', Hyp: 'Hypergeometric', ChiSq: 'ChiSquared', Chi2: 'ChiSquared' };

export function makeDistribution(family: string, params: number[]): DistributionValue {
  const fam = FAMILIES.find((f) => f.name === family)!;
  const err = fam.check?.(params);
  if (err) throw new EvalError(err);
  const dist = fam.make(params);
  const latex = `${fam.tex}\\left(${params.map((p) => numberLatex(p, 6)).join(', ')}\\right)`;
  return { kind: 'distribution', family, params, latex, discrete: dist.discrete, dist, pdfSrc: fam.pdf?.(params), key: `dist|${family}|${params}`, certainty: 'exact' };
}

export function asDistribution(v: MathValue | undefined): DistributionValue | undefined {
  return v?.kind === 'distribution' ? (v as unknown as DistributionValue) : undefined;
}
function expectDist(v: MathValue | undefined): DistributionValue {
  const d = asDistribution(v);
  if (!d) throw new EvalError('Expected a random variable, e.g. X ~ Normal(0, 1)');
  return d;
}

const nums = (v: MathValue | undefined) => {
  if (v?.kind === 'list') return (v as { items: MathValue[] }).items.map((i) => expectNumber(i));
  throw new EvalError('Expected a list of numbers');
};

const ctorBuiltins: Builtin[] = [
  ...FAMILIES.map((f) => ({
    name: f.name, minArgs: f.args, maxArgs: f.args + (f.optional ?? 0), category: 'statistics',
    signature: `${f.name}(${['a', 'b', 'c', 'd'].slice(0, f.args).join(', ')})`, doc: `The ${f.name} distribution (Devore's parameterization).`,
    apply: (args: (MathValue | undefined)[]) => makeDistribution(f.name, args.map((a) => expectNumber(a))) as unknown as MathValue,
  })),
  ...Object.entries(ALIASES).map(([a, n]) => ({
    name: a, minArgs: FAMILIES.find((f) => f.name === n)!.args, maxArgs: FAMILIES.find((f) => f.name === n)!.args + (FAMILIES.find((f) => f.name === n)!.optional ?? 0), category: 'statistics',
    signature: `${a}(…)`, doc: `= ${n}`,
    apply: (args: (MathValue | undefined)[]) => makeDistribution(n, args.map((x) => expectNumber(x))) as unknown as MathValue,
  })),
  {
    name: 'pmf', minArgs: 2, maxArgs: 2, category: 'statistics', signature: 'pmf([x₁, x₂, …], [p₁, p₂, …])', doc: 'A discrete distribution given by a table of values and probabilities.',
    apply: ([xs, ps]) => {
      const X = nums(xs);
      const P = nums(ps);
      const dist = finite(X, P);
      return { kind: 'distribution', family: 'pmf', params: [...X, ...P], latex: `\\begin{array}{c|${'c'.repeat(X.length)}} x & ${X.map((x) => numberLatex(x, 6)).join(' & ')} \\\\ \\hline p(x) & ${P.map((p) => numberLatex(p, 6)).join(' & ')} \\end{array}`, discrete: true, dist, key: `dist|pmf|${X}|${P}`, certainty: 'exact' } as unknown as MathValue;
    },
  },
];

// ------------------------------------------------------------------ probabilities

/** P(X ≤ b), P(X < b), P(X = b) for discrete or continuous X. */
export function cdfStrict(d: D.Dist, b: number, strict: boolean): number {
  const F = d.cdf(b);
  if (!strict || !d.discrete) return F;
  return F - d.pdf(b);
}

export interface Bound {
  value: number;
  strict: boolean;
}

/** Read P(…) conditions: X > a, a < X ≤ b, X = c (nested eq chains). */
export function readCondition(e: Expr, ctx: EvalContext): { X: string; lo?: Bound; hi?: Bound; eq?: number; ne?: number } {
  const isX = (x: Expr) => x.type === 'sym' && asDistribution(ctx.lookup(x.name));
  const val = (x: Expr) => expectNumber(ctx.evaluate(x));
  if (e.type === 'eq' && e.left.type === 'eq') {
    // a < X ≤ b
    const inner = e.left;
    if (!isX(inner.right)) throw new EvalError('write P(a < X ≤ b) with the random variable in the middle');
    const name = (inner.right as { name: string }).name;
    const lo = { value: val(inner.left), strict: inner.rel === '<' || inner.rel === '>' };
    const hi = { value: val(e.right), strict: e.rel === '<' || e.rel === '>' };
    if (inner.rel === '>' || inner.rel === '>=') return { X: name, lo: hi, hi: lo };
    return { X: name, lo, hi };
  }
  if (e.type !== 'eq') throw new EvalError('P(…) needs a condition, e.g. P(X > 1) or P(1 < X ≤ 2)');
  let { left, right, rel } = e;
  if (!isX(left) && isX(right)) {
    [left, right] = [right, left];
    rel = rel === '<' ? '>' : rel === '>' ? '<' : rel === '<=' ? '>=' : rel === '>=' ? '<=' : rel;
  }
  if (!isX(left)) throw new EvalError('P(…): one side must be a random variable');
  const name = (left as { name: string }).name;
  const c = val(right);
  switch (rel) {
    case undefined:
      return { X: name, eq: c };
    case '!=':
      return { X: name, ne: c };
    case '<':
      return { X: name, hi: { value: c, strict: true } };
    case '<=':
      return { X: name, hi: { value: c, strict: false } };
    case '>':
      return { X: name, lo: { value: c, strict: true } };
    default:
      return { X: name, lo: { value: c, strict: false } };
  }
}

export function probability(d: D.Dist, c: { lo?: Bound; hi?: Bound; eq?: number; ne?: number }): number {
  if (c.eq !== undefined) return d.discrete ? d.pdf(c.eq) : 0;
  if (c.ne !== undefined) return 1 - (d.discrete ? d.pdf(c.ne) : 0);
  const upper = c.hi ? cdfStrict(d, c.hi.value, c.hi.strict) : 1;
  // P(X > a) = 1 − P(X ≤ a); P(X ≥ a) = 1 − P(X < a)
  const lower = c.lo ? cdfStrict(d, c.lo.value, !c.lo.strict) : 0;
  return Math.max(0, upper - lower);
}

const P: Builtin = {
  name: 'P', minArgs: 1, maxArgs: 1, argModes: ['raw'], category: 'statistics', signature: 'P(X > a) · P(a < X ≤ b) · P(X = k)',
  doc: 'Probability of an event about a random variable.',
  apply: (_a, ctx, raw) => {
    // events of a probability space: P(A ∩ B), P(B | A) — names that are not random variables
    if (isEventQuery(raw[0], ctx)) return eventProbability(raw[0], ctx);
    // anything beyond "X compared with constants" (sums, conditions, and / or): the general engine
    let c: ReturnType<typeof readCondition>;
    try {
      c = readCondition(raw[0], ctx);
      expectDist(ctx.lookup(c.X));
    } catch (e) {
      if (!(e instanceof EvalError)) throw e;
      return rvProbability(raw[0], ctx, rvLabel(raw[0]));
    }
    const X = expectDist(ctx.lookup(c.X));
    const p = probability(X.dist, c);
    const shade = c.eq === undefined && c.ne === undefined ? [c.lo?.value ?? -Infinity, c.hi?.value ?? Infinity] : [c.eq ?? c.ne!, c.eq ?? c.ne!];
    return scalar(p, {
      certainty: X.family === 'pmf' || X.family === 'DiscreteUniform' ? 'exact' : X.family === 'derived' ? X.certainty : 'numeric',
      evidence: X.discrete ? 'sum of the pmf over the event' : 'difference of cdf values (F(b) − F(a))',
      derivation: `P\\left(${toLatex(raw[0])}\\right)`,
      visuals: [visual('distplot', { dist: X, shade, sname: c.X }, `P(${c.X})`, 'probability')],
    }) as MathValue;
  },
};

function momentBuiltin(name: string, what: 'mean' | 'variance' | 'sd' | 'median', doc: string): Builtin {
  return {
    name, minArgs: 1, maxArgs: 1, argModes: ['raw'], category: 'statistics', signature: `${name}(X) · ${name}(2X + 3) · ${name}(X^2)`, doc,
    apply: (_a, ctx, raw) => {
      // E(X^2), Var(2X - Y): expectations of functions of random variables
      if (raw[0].type !== 'sym' && what !== 'median') {
        const m = momentOf(raw[0], what, ctx);
        return scalar(m.value, { certainty: m.certainty, evidence: m.evidence, derivation: m.derivation });
      }
      const x = ctx.evaluate(raw[0]);
      const X = expectDist(x);
      const v = what === 'mean' ? X.dist.mean : what === 'variance' ? X.dist.variance : what === 'sd' ? Math.sqrt(X.dist.variance) : D.quantileOf(X.dist, 0.5);
      const nm = raw[0]?.type === 'sym' ? raw[0].name : 'X';
      const tex = what === 'mean' ? `E(${nm})` : what === 'variance' ? `V(${nm})` : what === 'sd' ? `\\sigma_{${nm}}` : `\\tilde{\\mu}_{${nm}}`;
      const own = X.family === 'density' || X.family === 'derived';
      return scalar(v, { certainty: what === 'median' && X.family !== 'pmf' ? 'numeric' : own ? X.certainty : 'exact', evidence: what === 'median' ? 'cdf inverted numerically' : own ? (X.evidence ?? 'from the distribution') : `formula for the ${X.family} distribution`, derivation: tex });
    },
  };
}

/** Wrap a list statistic so that it also takes a random variable (mean X = E(X)). */
export function distAware(base: Builtin | undefined, what: 'mean' | 'variance' | 'sd' | 'median'): Builtin | undefined {
  if (!base) return undefined;
  const m = momentBuiltin(base.name, what, base.doc);
  return { ...base, command: true, apply: (args, ctx, raw, kw) => (asDistribution(args[0]) && args.length === 1 ? m.apply(args, ctx, raw, kw) : base.apply(args, ctx, raw, kw)) };
}

const quantile: Builtin = {
  name: 'quantile', minArgs: 2, maxArgs: 2, category: 'statistics', signature: 'quantile(X, p)', doc: 'The (100p)th percentile η(p): F(η) = p.',
  apply: ([x, p], _ctx, raw) => {
    const X = expectDist(x);
    const q = expectNumber(p);
    if (!(q > 0 && q < 1)) throw new EvalError('p must be between 0 and 1');
    return scalar(D.quantileOf(X.dist, q), { certainty: 'numeric', evidence: 'cdf inverted numerically', derivation: `\\eta(${numberLatex(q, 4)})_{${raw[0]?.type === 'sym' ? symbolLatex(raw[0].name) : 'X'}}` });
  },
};

function densityFn(ctx: EvalContext, X: DistributionValue, which: 'pdf' | 'cdf', label: string): FunctionValue {
  if (which === 'pdf' && X.pdfSrc) {
    try {
      return { ...ctx.makeFunction(parseExpression(X.pdfSrc), ['x'], { label }), certainty: 'exact' } as FunctionValue;
    } catch {
      /* numeric below */
    }
  }
  const f = which === 'pdf' ? X.dist.pdf : X.dist.cdf;
  return { kind: 'function', params: ['x'], out: 'scalar', eval: ((x: number) => f(x)) as FunctionValue['eval'], label, key: `${which}|${X.key}`, env: {}, role: X.discrete && which === 'pdf' ? 'pmf' : which } as unknown as FunctionValue;
}

const pdfB: Builtin = {
  name: 'pdf', command: true, minArgs: 1, maxArgs: 1, category: 'statistics', signature: 'pdf X', doc: 'Probability density (or mass) function of X as a function.',
  apply: ([x], ctx, raw) => densityFn(ctx, expectDist(x), 'pdf', `f_{${raw[0]?.type === 'sym' ? raw[0].name : 'X'}}`) as MathValue,
};
const cdfB: Builtin = {
  name: 'cdf', command: true, minArgs: 1, maxArgs: 1, category: 'statistics', signature: 'cdf X', doc: 'Cumulative distribution function F(x) = P(X ≤ x).',
  apply: ([x], ctx, raw) => {
    const X = expectDist(x);
    return { ...densityFn(ctx, X, 'cdf', `F_{${raw[0]?.type === 'sym' ? raw[0].name : 'X'}}`), visuals: [visual('cdfplot', { dist: X }, 'cdf', 'cdf')] } as MathValue;
  },
};

/** Seeded draws: the same object always gives the same sample. */
export function seeded(key: string) {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let s = h >>> 0;
  const u = () => {
    let t = (s = (s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  const z = () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let a = 0;
    while (a === 0) a = u();
    const b = u();
    const r = Math.sqrt(-2 * Math.log(a));
    spare = r * Math.sin(2 * Math.PI * b);
    return r * Math.cos(2 * Math.PI * b);
  };
  return { u, z };
}

export function drawSample(X: DistributionValue, n: number, salt = ''): number[] {
  const { u, z } = seeded(`${X.key}|${n}|${salt}`);
  return Array.from({ length: n }, () => X.dist.sample(u, z));
}

const sampleB: Builtin = {
  name: 'sample', minArgs: 2, maxArgs: 2, category: 'statistics', signature: 'sample(X, n)', doc: 'n independent draws of X (seeded: the same every time).',
  apply: ([x, nv], _ctx, raw) => {
    const X = expectDist(x);
    const n = Math.round(expectNumber(nv));
    if (!(n >= 1 && n <= 1e6)) throw new EvalError('n between 1 and 1,000,000');
    const xs = drawSample(X, n);
    const m = xs.reduce((a, b) => a + b, 0) / n;
    const s = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
    return {
      kind: 'list', items: xs.map((v) => scalar(v)), certainty: 'heuristic',
      evidence: `${n} simulated draws (seeded); sample mean ${+m.toPrecision(5)} vs E = ${+X.dist.mean.toPrecision(5)}, sample sd ${+s.toPrecision(5)} vs σ = ${+Math.sqrt(X.dist.variance).toPrecision(5)}`,
      visuals: [visual('samplehist', { dist: X, xs, sname: raw[0]?.type === 'sym' ? raw[0].name : 'X' }, 'simulated sample', 'sample')],
    } as unknown as MathValue;
  },
};

const NS = [1, 2, 5, 10, 30];
const cltB: Builtin = {
  name: 'clt', minArgs: 1, maxArgs: 2, category: 'statistics', signature: 'clt(X [, k])', doc: 'Sampling distribution of the sample mean X̄ for n = 1, 2, 5, 10, 30 (k samples each) — the central limit theorem.',
  apply: ([x, kv], _ctx, raw) => {
    const X = expectDist(x);
    const k = kv ? Math.round(expectNumber(kv)) : 3000;
    const means = NS.map((n) => {
      const all = drawSample(X, n * k, 'clt');
      return Array.from({ length: k }, (_, i) => all.slice(i * n, (i + 1) * n).reduce((a, b) => a + b, 0) / n);
    });
    const nm = raw[0]?.type === 'sym' ? raw[0].name : 'X';
    return {
      kind: 'text', text: `sampling distribution of the mean of ${nm}: n = ${NS.join(', ')} (${k} samples each)`, certainty: 'heuristic', evidence: 'simulation (seeded)',
      visuals: [visual('cltplot', { dist: X, means, ns: NS, timeline: `clt:${X.key}`, stops: NS.map((n) => `n = ${n}`), captions: NS.slice(1).map((n) => `n = ${n}: X̄ has mean ${+X.dist.mean.toPrecision(4)} and sd σ/√n = ${+(Math.sqrt(X.dist.variance / n)).toPrecision(4)}`) }, 'CLT', 'clt')],
    } as unknown as MathValue;
  },
};

export const statisticsBuiltins: Builtin[] = [...ctorBuiltins, P, { ...P, name: 'Pr' }, quantile, pdfB, cdfB, sampleB, cltB, momentBuiltin('E', 'mean', 'Expected value E(X).'), momentBuiltin('Var', 'variance', 'Variance V(X).'), momentBuiltin('SD', 'sd', 'Standard deviation of X.')];

export function distPlotVisual(X: DistributionValue, name: string) {
  return visual('distplot', { dist: X, sname: name }, name, 'distribution');
}

export { num, sym, compileScalar };