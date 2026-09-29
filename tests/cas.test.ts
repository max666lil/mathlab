import { describe, it, expect } from 'vitest';
import { parseExpression } from '../src/parser/parser';
import { antiderivative } from '../src/math-core/symbolic/integrate';
import { expand, polyCoeffs, quadraticRoots } from '../src/math-core/symbolic/expand';
import { toText } from '../src/math-core/symbolic/print';
import { recognize } from '../src/math-core/recognize';
import { roots1D, newtonSystem, gridSeeds } from '../src/math-core/numeric/roots';
import { limitAt, limitInf } from '../src/math-core/numeric/limits';
import { integrateNumeric } from '../src/math-core/numeric/quad';
import { domainConditions, scanDomain1D } from '../src/math-core/domain';
import { compileScalar } from '../src/math-core/compile';

const P = (s: string) => parseExpression(s);

describe('CAS core', () => {
  it('antiderivatives are verified', () => {
    for (const s of ['(x^2 + 1)/(x - 1)', '(2x^3 - x)/(2x + 4)', 'x^2', '3x^2 + 2x + 1', 'sin(x)', 'exp(2x)', '1/x', 'cos(3x + 1)', 'x*exp(x^2)', '1/(1 + x^2)', '2x/(x^2 + 1)', 'sin(x)*cos(x)', '(2x + 1)^5']) {
      expect(antiderivative(P(s), 'x'), s).not.toBeNull();
    }
    expect(toText(antiderivative(P('x^2'), 'x')!)).toBe('x^3/3');
    expect(antiderivative(P('exp(-x^2)'), 'x')).toBeNull();
  });
  it('expand and polynomial coefficients', () => {
    expect(toText(expand(P('(x + 1)^2')))).toBe('x^2 + 2x + 1');
    expect(polyCoeffs(P('3x^2 - 3'), 'x')).toEqual([-3, 0, 3]);
    expect(quadraticRoots([-3, 0, 3])).toEqual([-1, 1]);
    expect(polyCoeffs(P('sin(x)'), 'x')).toBeNull();
  });
  it('recognizes closed forms', () => {
    expect(recognize(1 / 3)!.text).toBe('1/3');
    expect(recognize(Math.sqrt(2))!.text).toBe('√2');
    expect(recognize(-Math.sqrt(3) / 2)!.text).toBe('-√3/2');
    expect(recognize(Math.PI / 4)!.text).toBe('π/4');
    expect(recognize(1.2345678)).toBeNull();
  });
  it('roots', () => {
    expect(roots1D((x) => x * x - 2, -10, 10).roots.map((r) => +r.toFixed(9))).toEqual([-1.414213562, 1.414213562]);
    expect(roots1D((x) => 1 / (x - 1), -10, 10).roots).toEqual([]);
    expect(roots1D((x) => (x - 2) ** 2, -10, 10).roots.map((r) => +r.toFixed(5))).toEqual([2]);
    const sys = newtonSystem(([x, y]) => [3 * x * x - 3, 2 * y], gridSeeds([[-3, 3], [-3, 3]], 6));
    expect(sys.solutions.map((p) => p.map((v) => +v.toFixed(6))).sort()).toEqual([[-1, 0], [1, 0]]);
  });
  it('limits', () => {
    const l = limitAt((x) => Math.sin(x) / x, 0);
    expect(l.kind).toBe('finite');
    expect(l.value).toBeCloseTo(1, 8);
    expect(limitAt((x) => 1 / x, 0).kind).toBe('dne');
    expect(limitAt((x) => 1 / (x * x), 0).kind).toBe('+inf');
    expect(limitInf((x) => (2 * x + 1) / (x - 3), 1).value).toBeCloseTo(2, 5);
    expect(limitAt((x) => Math.sin(1 / x), 0).kind).toBe('dne');
  });
  it('numeric integration', () => {
    expect(integrateNumeric((x) => x * x, 0, 1).value).toBeCloseTo(1 / 3, 12);
    expect(integrateNumeric((x) => Math.exp(-x * x), -Infinity, Infinity).value).toBeCloseTo(Math.sqrt(Math.PI), 8);
  });
  it('domains', () => {
    const e = P('ln(x^2 - 1)');
    const c = domainConditions(e, ['x']);
    expect(c.map((d) => d.latex)).toEqual(['x^{2} - 1 > 0']);
    const d = scanDomain1D(compileScalar(e, ['x']), c, 'x');
    expect(d.intervals.map((i) => [i.a, i.b])).toEqual([[-Infinity, -1], [1, Infinity]]);
    const r = P('1/(x - 1)');
    const d2 = scanDomain1D(compileScalar(r, ['x']), domainConditions(r, ['x']), 'x');
    expect(d2.intervals.map((i) => [i.a, i.b])).toEqual([[-Infinity, 1], [1, Infinity]]);
    expect(d2.intervals.map((i) => [i.closedA, i.closedB])).toEqual([[false, false], [false, false]]);
    const q = P('(x^2 + 1)/(x - 1)');
    const d4 = scanDomain1D(compileScalar(q, ['x']), domainConditions(q, ['x']), 'x');
    expect(d4.intervals.map((i) => [i.closedA, i.closedB])).toEqual([[false, false], [false, false]]);
    const s = P('sqrt(x)');
    const d3 = scanDomain1D(compileScalar(s, ['x']), domainConditions(s, ['x']), 'x');
    expect(d3.intervals).toEqual([{ a: 0, b: Infinity, closedA: true, closedB: false }]);
  });
});