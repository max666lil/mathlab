import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';
import { AnalysisService } from '../src/runtime/analysis';
import { toText } from '../src/math-core/symbolic/print';
import { normCdf } from '../src/math-core/distributions';

beforeAll(() => installMathLab());

function last(...cells: string[]) {
  const ws = new Workspace(cells);
  const sts = ws.statements();
  const n = ws.node(sts[sts.length - 1].id)!;
  return { value: n.value as any, error: n.error?.message, ws };
}
const p = (...cells: string[]) => last(...cells).value.value as number;

describe('random variables (Phase 5, Devore ch. 3–4)', () => {
  it('X ~ Family(…) is a distribution object', () => {
    const X = last('X ~ Normal(0, 1)').value;
    expect(X.kind).toBe('distribution');
    expect(X.latex).toBe('N\\left(0, 1\\right)');
    expect(last('X ~ Normal(0, -1)').error).toMatch(/positive/);
  });
  it('probabilities as written in the book', () => {
    expect(p('X ~ Binomial(15, .2)', 'P(X <= 8)')).toBeCloseTo(0.9992, 4);
    expect(p('X ~ Binomial(15, .2)', 'P(X < 8)')).toBeCloseTo(0.9958, 4);
    expect(p('Z ~ Normal(0, 1)', 'P(-0.38 <= Z <= 1.25)')).toBeCloseTo(0.5424, 4);
    expect(p('G ~ Gamma(2, 2.5)', 'P(G > 15)')).toBeCloseTo(0.0174, 4);
    expect(p('H ~ Hypergeometric(10, 5, 25)', 'P(H = 2)')).toBeCloseTo(0.385, 3);
    expect(p('N ~ NegBinomial(4, .2)', 'P(N = 15)')).toBeCloseTo(0.05, 3);
    expect(p('W ~ Weibull(10, 3.5)', 'P(W <= 3)')).toBeCloseTo(0.193, 3);
    expect(p('X ~ Poisson(2)', 'P(X <= 3)')).toBeCloseTo(0.857, 3);
    expect(p('X ~ Exponential(2)', 'P(X > 1)')).toBeCloseTo(Math.exp(-2), 12);
    expect(p('X ~ Normal(0, 1)', 'P(X = 0)')).toBe(0);
  });
  it('moments and percentiles (Devore parameterizations)', () => {
    expect(p('N ~ NegBinomial(4, .2)', 'E(N)')).toBeCloseTo(20, 12);
    expect(p('N ~ NegBinomial(4, .2)', 'Var(N)')).toBeCloseTo(80, 12);
    expect(p('G ~ Gamma(2, 2.5)', 'E(G)')).toBeCloseTo(5, 12);
    expect(p('X ~ Normal(64, 0.78)', 'quantile(X, 0.995)')).toBeCloseTo(66.009, 3);
    expect(p('X ~ Geometric(0.25)', 'E(X)')).toBeCloseTo(4, 12);
    expect(p('X ~ Normal(10, 2)', 'mean X')).toBe(10);
  });
  it('a finite pmf: the Apgar score (Ex 3.16): E = 7.15, V = 1.5815', () => {
    const cells = ['A = pmf([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [.002, .001, .002, .005, .02, .04, .18, .37, .25, .12, .01])'];
    expect(p(...cells, 'E(A)')).toBeCloseTo(7.15, 10);
    expect(p(...cells, 'Var(A)')).toBeCloseTo(1.5815, 10);
    expect(p(...cells, 'P(A >= 7)')).toBeCloseTo(0.75, 10);
    expect(last('B = pmf([1, 2], [0.5, 0.6])').error).toMatch(/add up/);
  });
  it('pdf X is a function the rest of MathLab can analyse', () => {
    const f = last('X ~ Normal(0, 1)', 'f = pdf X').value;
    expect(f.kind).toBe('function');
    expect(p('X ~ Normal(0, 1)', 'f = pdf X', 'integrate f from -1 to 1')).toBeCloseTo(0.682689492, 8);
    expect(p('X ~ Exponential(0.5)', 'f = pdf X', 'integrate f from 0 to 2')).toBeCloseTo(1 - Math.exp(-1), 8);
  });
  it('sample(X, n) is seeded and simulated; the analyzer offers simulation and the CLT', () => {
    const a = last('X ~ Exponential(0.01)', 'sample(X, 5000)').value;
    const b = last('X ~ Exponential(0.01)', 'sample(X, 5000)').value;
    expect(a.items[17].value).toBe(b.items[17].value);
    expect(a.certainty).toBe('heuristic');
    const m = a.items.reduce((s: number, i: any) => s + i.value, 0) / 5000;
    expect(m).toBeGreaterThan(90);
    expect(m).toBeLessThan(110);
    const ws = new Workspace(['X ~ Poisson(3)']);
    const plan = new AnalysisService(ws).plan()!;
    expect(plan.sections.map((s) => s.id)).toEqual(['overview', 'prob', 'cdf', 'sim', 'clt', 'napprox']);
    expect(ws.sceneItems().some((i) => i.visual.vtype === 'distplot' && i.visible)).toBe(true);
  });
});

describe('datasets (Devore ch. 1)', () => {
  it('summary of the fuel data (Ex 1.14/1.16): x̄ 28.9, fourths 25.4 / 31.0, s 5.04', () => {
    const s = last('D = [31.0, 27.8, 38.3, 27.0, 23.4, 30.0, 30.1, 21.5, 25.4, 34.5]', 'summary D').value;
    const row = (k: string) => s.rows.find((r: [string, number]) => r[0] === k)[1];
    expect(row('\\bar{x}')).toBeCloseTo(28.9, 10);
    expect(row('\\text{lower fourth}')).toBe(25.4);
    expect(row('\\text{upper fourth}')).toBe(31.0);
    expect(row('s')).toBeCloseTo(5.04, 2);
    const ws = new Workspace(['D = [31.0, 27.8, 38.3, 27.0, 23.4, 30.0, 30.1, 21.5, 25.4, 34.5]']);
    expect(new AnalysisService(ws).plan()!.typeLabel).toBe('data (sample)');
    void toText;
  });
});
describe('probability spaces of events (STA237: conditional probability, Bayes, independence)', () => {
  const facts = ['P(D) = 0.001', 'P(T | D) = 0.99', 'P(T | not D) = 0.02'];
  it('Bayes and total probability from stated facts', () => {
    const r = last(...facts, 'P(D | T)');
    expect(r.error).toBeUndefined();
    expect(r.value.value).toBeCloseTo(0.00099 / (0.00099 + 0.01998), 10);
    expect(r.value.certainty).toBe('exact');
    expect(p(...facts, 'P(T)')).toBeCloseTo(0.02097, 10);
    expect(last(...facts, 'P(T)').value.derivation).toMatch(/P\(T \\mid D\)P\(D\)/);
    expect(p(...facts, "P(D' and T)")).toBeCloseTo(0.01998, 10);
    expect(p(...facts, 'P(D ∪ T)')).toBeCloseTo(0.001 + 0.01998, 10);
    expect(p(...facts, 'P(not D | not T)')).toBeCloseTo(0.999 * 0.98 / (1 - 0.02097), 10);
  });
  it('facts are statements, not function definitions', () => {
    const f = last('P(A) = 0.3').value;
    expect(f.kind).toBe('probfact');
    expect(f.latex).toBe('P\\left(A\\right) = 0.3');
    expect(last('P(x) = x^2 + 1').value.kind).toBe('function');
    expect(last('P(x, y) = x^(2/3) y^(1/3)').value.kind).toBe('function');
    expect(last('P(B | A) = 1.2').error).toMatch(/between 0 and 1/);
  });
  it('independence, complements, unions; undetermined and contradictory facts are reported', () => {
    expect(p('P(A) = 0.3', 'P(B) = 0.4', 'independent A, B', 'P(A or B)')).toBeCloseTo(0.58, 12);
    expect(p('P(A) = 0.3', 'P(A ∪ B) = 0.58', 'independent A, B', 'P(B)')).toBeCloseTo(0.4, 12);
    expect(p('P(A) = 0.3', 'P(B) = 0.4', 'disjoint A, B', 'P(A or B)')).toBeCloseTo(0.7, 12);
    expect(p('P(A) = 0.5', 'P(B) = 0.5', 'P(C) = 0.5', 'independent A, B, C', 'P(A and B and C)')).toBeCloseTo(0.125, 12);
    expect(last('P(A) = 0.3', 'P(B) = 0.4', 'P(A and B)').error).toMatch(/not determined/);
    expect(last('P(A) = 0.3', 'P(A and B) = 0.5', 'P(B)').error).toMatch(/contradict|impossible|not determined/);
    expect(last('P(A) = 0.3', 'P(A) = 0.4', 'P(B)').error).toMatch(/contradict/);
    expect(last('P(Q)').error).toMatch(/no probabilities are given/);
  });
  it('a tree-diagram visual comes with the answer; sliders drive facts', () => {
    const r = last('a = slider(0, 1, 0.2)', 'P(A) = a', 'P(B | A) = 0.5', 'P(B | not A) = 0.25', 'P(A | B)');
    expect(r.value.value).toBeCloseTo(0.1 / (0.1 + 0.2), 12);
    expect(r.value.visuals[0].vtype).toBe('probtree');
  });
});
describe('functions of random variables (STA237: E[g(X)], sums, sampling distributions, LLN)', () => {
  const N = normCdf;
  it('affine transforms and sums stay in their family', () => {
    const Y = last('X ~ Normal(10, 2)', 'Y ~ 2X + 3').value;
    expect([Y.family, ...Y.params]).toEqual(['Normal', 23, 4]);
    expect(last('X1 ~ Poisson(2)', 'X2 ~ Poisson(3)', 'S ~ X1 + X2').value.latex).toMatch(/Poisson/);
    expect(last('X1 ~ Poisson(2)', 'X2 ~ Poisson(3)', 'S ~ X1 + X2').value.params).toEqual([5]);
    const S = last('B ~ Bernoulli(0.3)', 'S ~ sum(B, 10)').value;
    expect([S.family, ...S.params]).toEqual(['Binomial', 10, 0.3]);
    const T = last('X ~ Exponential(2)', 'T ~ sum(X, 3)').value;
    expect([T.family, ...T.params]).toEqual(['Gamma', 3, 0.5]);
    const M = last('X ~ Normal(4, 1)', 'M ~ mean(X, 25)').value;
    expect([M.family, ...M.params.map((x: number) => +x.toFixed(12))]).toEqual(['Normal', 4, 0.2]);
  });
  it('dice: exact convolution and enumeration', () => {
    const dice = ['D1 ~ DiscreteUniform(1, 6)', 'D2 ~ DiscreteUniform(1, 6)'];
    expect(p(...dice, 'S ~ D1 + D2', 'P(S = 7)')).toBeCloseTo(1 / 6, 12);
    expect(last(...dice, 'S ~ D1 + D2', 'P(S = 7)').value.certainty).toBe('exact');
    expect(p(...dice, 'M ~ max(D1, D2)', 'P(M = 6)')).toBeCloseTo(11 / 36, 12);
    expect(p(...dice, 'E(D1 * D2)')).toBeCloseTo(12.25, 12);
    expect(p(...dice, 'P(D1 + D2 >= 10)')).toBeCloseTo(6 / 36, 12);
  });
  it('E[g(X)] and variances of combinations', () => {
    expect(p('X ~ Normal(0, 1)', 'E(X^2)')).toBeCloseTo(1, 8);
    expect(p('X ~ Normal(0, 1)', 'Var(X^2)')).toBeCloseTo(2, 6);
    const e = last('X ~ Normal(1, 1)', 'Y ~ Exponential(2)', 'E(2X - Y)').value;
    expect(e.value).toBeCloseTo(1.5, 12);
    expect(e.certainty).toBe('exact');
    expect(e.derivation).toMatch(/2E\(X\) -E\(Y\)|2E\(X\) - ?E\(Y\)/);
    expect(p('X ~ Normal(1, 1)', 'Y ~ Exponential(2)', 'Var(2X - Y)')).toBeCloseTo(4.25, 12);
    expect(p('X ~ Binomial(10, 0.5)', 'E(X^2)')).toBeCloseTo(27.5, 10);
    expect(p('X ~ Exponential(1)', 'E(exp(-X))')).toBeCloseTo(0.5, 8);
  });
  it('events: conditional, unions, comparisons between variables', () => {
    expect(p('X ~ Exponential(0.5)', 'P(X > 3 | X > 1)')).toBeCloseTo(Math.exp(-1), 10);
    expect(p('X ~ Normal(2, 1)', 'P(X < 1 or X > 3)')).toBeCloseTo(2 * (1 - N(1)), 8);
    expect(p('X ~ Normal(1, 1)', 'Y ~ Normal(1, 1)', 'P(X + Y > 3)')).toBeCloseTo(1 - N(1 / Math.SQRT2), 8);
    expect(p('X ~ Normal(0, 1)', 'Y ~ Normal(1, 1)', 'P(X > Y)')).toBeCloseTo(1 - N(1 / Math.SQRT2), 8);
    expect(p('X ~ Normal(1, 1)', 'Y ~ Normal(1, 1)', 'P(X > 1 and Y > 1)')).toBeCloseTo(0.25, 10);
    const mc = last('X ~ Normal(1, 1)', 'Y ~ Normal(1, 1)', 'P(X > 1 or Y > 1)').value;
    expect(mc.value).toBeCloseTo(0.75, 2);
    expect(mc.certainty).toBe('heuristic');
    expect(p('X ~ Normal(4, 1)', 'P(3.8 < mean(X, 25) < 4.2)')).toBeCloseTo(2 * N(1) - 1, 8);
    // two continuous variables of different families: one numerical integral, not simulation
    const xy = last('X ~ Normal(5, 1)', 'Y ~ Exponential(0.25)', 'P(X > Y)').value;
    expect(xy.value).toBeCloseTo(1 - Math.exp(-1.25 + 0.03125), 5);
    expect(xy.certainty).toBe('numeric');
  });
  it('transformations of one continuous variable', () => {
    expect(p('X ~ Exponential(1)', 'Y ~ X^2', 'P(Y <= 1)')).toBeCloseTo(1 - Math.exp(-1), 8);
    // the inverse-cdf method: −ln U is exponential
    expect(p('U ~ Uniform(0, 1)', 'Y ~ -ln(U)', 'P(Y > 1)')).toBeCloseTo(Math.exp(-1), 6);
    expect(p('U ~ Uniform(0, 1)', 'Y ~ -ln(U)', 'E(Y)')).toBeCloseTo(1, 6);
    const Z = last('Z ~ Normal(0, 1)', 'W ~ Z^2').value;
    expect(Z.dist.cdf(1)).toBeCloseTo(2 * N(1) - 1, 3);
  });
  it('the law of large numbers', () => {
    const v = last('X ~ Exponential(0.5)', 'lln(X, 5000)').value;
    expect(v.visuals[0].vtype).toBe('llnplot');
    expect(v.visuals[0].props.means.at(-1)).toBeCloseTo(2, 0);
  });
});


describe('random variables from their own formula; normal approximation', () => {
  it('a density on an interval: exact moments, probabilities, percentiles', () => {
    const X = last('X ~ density(3x^2, 0, 1)').value;
    expect(X.kind).toBe('distribution');
    expect(X.certainty).toBe('exact');
    expect(p('X ~ density(3x^2, 0, 1)', 'E(X)')).toBeCloseTo(0.75, 12);
    expect(p('X ~ density(3x^2, 0, 1)', 'Var(X)')).toBeCloseTo(3 / 80, 12);
    expect(p('X ~ density(3x^2, 0, 1)', 'P(X <= 0.5)')).toBeCloseTo(1 / 8, 12);
    expect(p('X ~ density(3x^2, 0, 1)', 'median X')).toBeCloseTo(0.5 ** (1 / 3), 9);
    expect(p('X ~ density(3x^2, 0, 1)', 'E(1/X)')).toBeCloseTo(1.5, 8);
    expect(p('X ~ density(3x^2, 0, 1)', 'P(X > 0.5 | X > 0.2)')).toBeCloseTo((1 - 0.125) / (1 - 0.008), 10);
  });
  it('the missing constant is reported; negative densities are refused', () => {
    expect(last('X ~ density(x^2, 0, 1)').error).toMatch(/integrates to 0\.333333.*multiply the formula by 3/);
    expect(last('X ~ density(x - 0.5, 0, 2)').error).toMatch(/cannot be negative/);
    expect(p('k = 3', 'X ~ density(k x^2, 0, 1)', 'E(X)')).toBeCloseTo(0.75, 12);
  });
  it('piecewise and unbounded densities; a variable given by its cdf', () => {
    const tri = 'X ~ density({0 <= x <= 1: x, 1 < x <= 2: 2 - x, 0})';
    expect(p(tri, 'E(X)')).toBeCloseTo(1, 6);
    expect(p(tri, 'P(X < 0.5)')).toBeCloseTo(0.125, 6);
    expect(p(tri, 'Var(X)')).toBeCloseTo(1 / 6, 6);
    expect(p('X ~ density(2 exp(-2x), 0, ∞)', 'E(X)')).toBeCloseTo(0.5, 7);
    expect(p('X ~ density(2 exp(-2x), 0, ∞)', 'P(X > 1)')).toBeCloseTo(Math.exp(-2), 7);
    expect(p('X ~ fromcdf(1 - exp(-2x), 0, ∞)', 'P(X > 1)')).toBeCloseTo(Math.exp(-2), 7);
    expect(p('X ~ fromcdf(x^2, 0, 1)', 'E(X)')).toBeCloseTo(2 / 3, 12);
    expect(last('X ~ fromcdf(x^2, 0, 2)').error).toMatch(/goes from 0 to 1/);
  });
  it('normal approximation with the continuity correction', () => {
    const b = 'X ~ Binomial(100, 0.5)';
    const N = last(b, 'normalapprox(X)').value;
    expect([N.family, ...N.params]).toEqual(['Normal', 50, 5]);
    const r = last(b, 'normalapprox(X <= 55)').value;
    expect(r.value).toBeCloseTo(normCdf(1.1), 10);
    expect(r.exact).toBeCloseTo(0.8644, 4);
    expect(r.evidence).toMatch(/continuity correction.*both ≥ 10/);
    expect(r.derivation).toMatch(/55\.5 - 50/);
    expect(p(b, 'normalapprox(X < 55)')).toBeCloseTo(normCdf(0.9), 10);
    expect(p(b, 'normalapprox(45 <= X <= 55)')).toBeCloseTo(2 * normCdf(1.1) - 1, 10);
    expect(p(b, 'normalapprox(X = 50)')).toBeCloseTo(normCdf(0.1) - normCdf(-0.1), 10);
    expect(p(b, 'normalapprox(X > 60)')).toBeCloseTo(1 - normCdf(2.1), 10);
    expect(last('X ~ Binomial(20, 0.1)', 'normalapprox(X <= 3)').value.evidence).toMatch(/rough/);
  });
});
describe('covariance of expressions in independent variables', () => {
  const xy = ['X ~ Normal(1, 2)', 'Y ~ Exponential(0.5)'];
  it('E(XY) = E(X)E(Y) exactly; Cov and Corr of linear combinations', () => {
    const e = last(...xy, 'E(X Y)').value;
    expect(e.value).toBeCloseTo(2, 12);
    expect(e.certainty).toBe('exact');
    expect(p(...xy, 'Cov(X, Y)')).toBe(0);
    expect(p(...xy, 'Cov(X, X)')).toBeCloseTo(4, 12);
    // Cov(X + Y, X − Y) = V(X) − V(Y) = 4 − 4
    expect(p(...xy, 'Cov(X + Y, X - Y)')).toBeCloseTo(0, 12);
    expect(p(...xy, 'Cov(2X + Y, X)')).toBeCloseTo(8, 12);
    expect(p(...xy, 'Corr(X, X + Y)')).toBeCloseTo(4 / Math.sqrt(4 * 8), 12);
    expect(p(...xy, 'Corr(X, -3X + 1)')).toBeCloseTo(-1, 12);
  });
});