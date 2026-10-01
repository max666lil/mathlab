import { describe, it, expect } from 'vitest';
import { parseScript } from '../src/runtime/script/parser';
import { Interpreter } from '../src/runtime/script/interp';
import { Arr, SV } from '../src/runtime/script/values';

function run(src: string) {
  const it = new Interpreter({ lookup: () => undefined });
  it.run(parseScript(src));
  return it;
}
const v = (src: string): number => {
  const it = run(`ans_ = ${src};`);
  return it.vars.get('ans_') as number;
};
const arr = (x: SV | undefined) => (x instanceof Arr ? Array.from(x.d) : x);

describe('Devore — R distribution functions as written in the book', () => {
  it('binomial, Poisson, hypergeometric, negative binomial (ch. 3)', () => {
    expect(v('pbinom(8, 15, .2)')).toBeCloseTo(0.9992, 4);
    expect(v('dbinom(8, 15, .2)')).toBeCloseTo(0.0035, 4);
    expect(v('ppois(3, 2)')).toBeCloseTo(0.857, 3);
    expect(v('dhyper(2, 5, 20, 10)')).toBeCloseTo(0.385, 3);
    expect(v('phyper(2, 5, 20, 10)')).toBeCloseTo(0.699, 3);
    expect(v('dnbinom(15 - 4, 4, .2)')).toBeCloseTo(0.05, 3);
  });
  it('normal, gamma (rate!), Weibull, χ², t, F (ch. 4, 6)', () => {
    expect(v('pnorm(1.25)')).toBeCloseTo(0.8944, 4);
    expect(v('pnorm(1.25) - pnorm(-.38)')).toBeCloseTo(0.5424, 4);
    expect(v('qnorm(.99)')).toBeCloseTo(2.326, 3);
    expect(v('qnorm(.995, 64, .78)')).toBeCloseTo(66.009, 3);
    expect(v('pgamma(5, 2) - pgamma(3, 2)')).toBeCloseTo(0.159, 3);
    expect(v('pgamma(10, 2, 1/2.5) - pgamma(5, 2, 1/2.5)')).toBeCloseTo(0.3144, 4);
    expect(v('1 - pgamma(15, 2, 1/2.5)')).toBeCloseTo(0.0174, 4);
    expect(v('1 - pgamma(15, 2, scale = 2.5)')).toBeCloseTo(0.0174, 4);
    expect(v('pweibull(3, 10, 3.5)')).toBeCloseTo(0.193, 3);
    expect(v('qf(.9, 1, 2)')).toBeCloseTo(8.53, 2);
    expect(v('qt(.975, 10)')).toBeCloseTo(2.228, 3);
    expect(v('qchisq(.95, 5)')).toBeCloseTo(11.07, 2);
    expect(v('pexp(1, 2)')).toBeCloseTo(1 - Math.exp(-2), 12);
  });
  it('MATLAB names keep MATLAB conventions', () => {
    expect(v('hygepdf(2, 25, 5, 10)')).toBeCloseTo(0.385, 3);
    expect(v('expcdf(1, 2)')).toBeCloseTo(1 - Math.exp(-0.5), 12); // mean 2
    expect(v('gamcdf(15, 2, 2.5)')).toBeCloseTo(1 - 0.0174, 4); // scale
    expect(v('wblcdf(3, 3.5, 10)')).toBeCloseTo(0.193, 3); // scale, shape
    expect(v('norminv(.975)')).toBeCloseTo(1.959964, 6);
    expect(v('binoinv(.5, 10, .5)')).toBe(5);
  });
  it('random variates match their distributions (seeded)', () => {
    const it = run('rng(3); x = rexp(20000, 0.01); m = mean(x); g = rgamma(20000, 2, 1/2.5); mg = mean(g); b = rbinom(5000, 20, .3); mb = mean(b);');
    expect(it.vars.get('m') as number).toBeCloseTo(100, -1);
    expect(it.vars.get('mg') as number).toBeCloseTo(5, 0);
    expect(it.vars.get('mb') as number).toBeCloseTo(6, 0);
  });
  it('sample with probabilities and without replacement', () => {
    const it = run('rng(1); s = sample(c(10, 15, 20, 25, 30), 4000, TRUE, c(.05, .10, .35, .40, .10)); m = mean(s); w = sample(25, 6);');
    expect(it.vars.get('m') as number).toBeCloseTo(10 * 0.05 + 15 * 0.1 + 20 * 0.35 + 25 * 0.4 + 30 * 0.1, 0);
    const w = arr(it.vars.get('w')) as number[];
    expect(new Set(w).size).toBe(6);
  });
});

describe('Devore — descriptive statistics (ch. 1)', () => {
  const fuel = '[31.0 27.8 38.3 27.0 23.4 30.0 30.1 21.5 25.4 34.5]';
  it('fivenum uses hinges: q1 25.4, q3 31.0 (Ex 1.16); iqr 5.6; sd 5.04', () => {
    const it = run(`f = fivenum(${fuel}); r = iqr(${fuel}); s = sd(${fuel});`);
    expect(arr(it.vars.get('f'))).toEqual([21.5, 25.4, 28.9, 31.0, 38.3]);
    expect(it.vars.get('r') as number).toBeCloseTo(5.6, 10);
    expect(it.vars.get('s') as number).toBeCloseTo(5.04, 2);
  });
  it('trimmed mean, boxplot and normal plot figures, stem-and-leaf text', () => {
    const it = run(`t = trimmean(1:10, 20); boxplot(${fuel}); figure; normplot(${fuel}); stem(${fuel})`);
    expect(it.vars.get('t')).toBe(5.5);
    expect(it.figures.length).toBe(2);
    expect(it.output.some((l) => l.includes('|'))).toBe(true);
  });
});

describe('Hughes-Hallett — numerical procedures', () => {
  it('Riemann sums and Simpson for ∫₁² 1/t dt (§5.1, §7.5)', () => {
    expect(v('leftsum(@(t) 1/t, 1, 2, 2)')).toBeCloseTo(0.8333, 4);
    expect(v('rightsum(@(t) 1/t, 1, 2, 2)')).toBeCloseTo(0.5833, 4);
    expect(v('midsum(@(t) 1/t, 1, 2, 2)')).toBeCloseTo(0.6857, 4);
    expect(v('trapsum(@(t) 1/t, 1, 2, 2)')).toBeCloseTo(0.7083, 4);
    expect(v('simpsum(@(t) 1/t, 1, 2, 2)') - Math.LN2).toBeCloseTo(0.000107, 6);
  });
  it("Euler's method and ode45 for y′ = y (§11.3)", () => {
    const it = run('[t, y] = euler(@(t, y) y, [0 1], 1, 0.1); last = y(end); [t2, y2] = ode45(@(t, y) y, [0 1], 1); e45 = y2(end);');
    expect((arr(it.vars.get('y')) as number[]).slice(0, 3).map((x: number) => +x.toFixed(10))).toEqual([1, 1.1, 1.21]);
    expect(it.vars.get('last') as number).toBeCloseTo(1.1 ** 10, 12);
    expect(it.vars.get('e45') as number).toBeCloseTo(Math.E, 5);
  });
  it("Newton's method for x⁵ = 23 and bisection (appendices)", () => {
    const it = run('[r, xs] = newton(@(x) x^5 - 23, @(x) 5*x^4, 2, 6); b = bisection(@(x) x^3 - 4*x - 2, 2, 3);');
    const xs = arr(it.vars.get('xs')) as number[];
    expect(xs[1]).toBeCloseTo(1.8875, 4);
    expect(xs[2]).toBeCloseTo(1.872418193, 8);
    expect(it.vars.get('r') as number).toBeCloseTo(Math.pow(23, 0.2), 12);
    expect(it.vars.get('b') as number).toBeCloseTo(2.21432, 4);
  });
  it('partial sums and Fourier coefficients of the square wave (§9, §10.5)', () => {
    const it = run('s = partialsums(@(n) 1/n^2, 1000); [a0, a, b] = fourier(@(x) x > 0, 3);');
    expect((arr(it.vars.get('s')) as number[])[999]).toBeCloseTo(1.6439, 3);
    expect(it.vars.get('a0') as number).toBeCloseTo(0.5, 6);
    const b = arr(it.vars.get('b')) as number[];
    expect(b[0]).toBeCloseTo(2 / Math.PI, 5);
    expect(b[1]).toBeCloseTo(0, 5);
    expect(b[2]).toBeCloseTo(2 / (3 * Math.PI), 5);
  });
  it('fminsearch, integral2 over a non-rectangular region, slope field figure', () => {
    const it = run('p = fminsearch(@(v) (v(1) - 1)^2 + (v(2) + 2)^2, [0 0]); I = integral2(@(x, y) 1 + x, 0, 1, @(x) x^2, @(x) x); slopefield(@(x, y) 2 - y, [-3 3], [-1 5]);');
    const p = arr(it.vars.get('p')) as number[];
    expect(p[0]).toBeCloseTo(1, 4);
    expect(p[1]).toBeCloseTo(-2, 4);
    expect(it.vars.get('I') as number).toBeCloseTo(0.25, 8);
    expect(it.figures[0].series.length).toBe(1);
  });
});