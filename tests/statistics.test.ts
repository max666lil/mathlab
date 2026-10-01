import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';
import { AnalysisService } from '../src/runtime/analysis';
import { toText } from '../src/math-core/symbolic/print';

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
    expect(plan.sections.map((s) => s.id)).toEqual(['overview', 'prob', 'cdf', 'sim', 'clt']);
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