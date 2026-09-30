/** Regressions found by the engine audit (integrals, critical points, limits, solve, domains, linear algebra, parser). */
import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';
import { AnalysisService } from '../src/runtime/analysis';
import { valueLatex } from '../src/math-core/values';

beforeAll(() => installMathLab());

function last(...cells: string[]) {
  const ws = new Workspace(cells);
  const sts = ws.statements();
  const n = ws.node(sts[sts.length - 1].id)!;
  return { value: n.value as any, error: n.error?.message, ws };
}

describe('integrals', () => {
  it('never freeze on overflowing or divergent integrands', () => {
    const t0 = Date.now();
    expect(last('integrate exp(x) from 0 to 1000').error ?? '').toMatch(/diverges|not converge/);
    last('integrate x from 0 to 1e308');
    last('integrate sin(x) from 0 to ∞');
    expect(Date.now() - t0).toBeLessThan(4000);
  });
  it('detect singularities instead of applying the FTC across a pole', () => {
    expect(last('integrate 1/x^2 from -1 to 2').error).toMatch(/diverges/);
    expect(last('integrate 1/(x-1) from 0 to 3').error).toMatch(/diverges/);
    expect(last('f(x) = 1/x', 'integrate f from -1 to 2').error).toMatch(/diverges/);
    expect(last('integrate tan(x) from 0 to 3').error).toMatch(/diverges/);
    const ok = last('integrate 1/sqrt(x) from 0 to 1').value;
    expect(ok.value).toBeCloseTo(2, 6);
    expect(last('integrate x^2 from 0 to 1').value.certainty).toBe('exact');
  });
});

describe('critical points', () => {
  const crit = (f: string) => last(`f(x,y) = ${f}`, 'critical f').value.points as { coords: number[]; type: string }[];
  it('no spurious points where the gradient underflows', () => {
    expect(crit('exp(-(x^2+y^2))').map((p) => p.coords)).toEqual([[0, 0]]);
    expect(crit('x*y*exp(-x^2-y^2)').length).toBe(5);
  });
  it('degenerate points merge and round-off is cleaned', () => {
    expect(crit('x^4 + y^4').map((p) => p.coords)).toEqual([[0, 0]]);
    expect(crit('x^3 - 3x*y^2').map((p) => p.coords)).toEqual([[0, 0]]);
  });
});

describe('limits', () => {
  const lim = (e: string) => {
    const v = last(e).value;
    return v.result === 'finite' ? v.value : v.result;
  };
  it('cancellation near a point', () => {
    expect(lim('limit (1 - cos(x))/x^2 as x -> 0')).toBeCloseTo(0.5, 6);
    expect(lim('limit sin(x)/x as x -> 0')).toBe(1);
  });
  it('slow growth and decay at infinity', () => {
    expect(lim('limit ln(x) as x -> ∞')).toBe('+inf');
    expect(lim('limit sqrt(x) as x -> ∞')).toBe('+inf');
    expect(lim('limit ln(ln(x)) as x -> ∞')).toBe('+inf');
    expect(lim('limit 1/ln(x) as x -> ∞')).toBe(0);
    expect(lim('limit 1/x as x -> ∞')).toBe(0);
    expect(lim('limit ln(x) as x -> 0+')).toBe('-inf');
    expect(lim('limit (1 + 1/x)^x as x -> ∞')).toBeCloseTo(Math.E, 5);
    expect(lim('limit exp(-x) as x -> ∞')).toBe(0);
    expect(lim('limit x^2 as x -> -∞')).toBe('+inf');
  });
  it('no "0√30" for tiny values', () => {
    const v = last('limit sin(x)/x as x -> ∞').value;
    expect(valueLatex(v)).not.toMatch(/sqrt/);
  });
});

describe('solve and domains', () => {
  it('identities and dependent linear systems', () => {
    expect(valueLatex(last('solve x = x').value)).toBe('\\mathbb{R}');
    const line = last('solve(x + y = 3, 2x + 2y = 6)').value;
    expect(line.kind).toBe('affine');
    expect(line.directions.length).toBe(1);
    expect(last('solve(x + y = 3, x + y = 4)').value.consistent).toBe(false);
  });
  it('odd roots are real; variable exponents need a positive base; ends open/closed correctly', () => {
    expect(last('f(x) = x^(1/3)', 'f(-8)').value.value).toBeCloseTo(-2, 12);
    expect(last('f(x) = x^(2/3)', 'f(-8)').value.value).toBeCloseTo(4, 12);
    expect(valueLatex(last('f(x) = x^(1/3)', 'domain f').value)).toBe('\\mathbb{R}');
    expect(valueLatex(last('f(x) = x^x', 'domain f').value)).toContain('(0');
    const d = valueLatex(last('f(x) = exp(1/x)', 'domain f').value);
    expect(d).toContain('0)');
    expect(d).not.toContain('0.001');
    const ls = valueLatex(last('f(x) = ln(sin(x))', 'domain f').value);
    expect(ls).not.toContain('[');
    expect(valueLatex(last('f(x) = sqrt(4 - x^2)', 'domain f').value)).toBe('[-2, 2]');
  });
  it('zeros at the edge of the domain', () => {
    expect(last('f(x) = sqrt(1 - x^2)', 'zeros f').value.points.map((p: any) => p.coords[0])).toEqual([-1, 1]);
    expect(last('f(x) = sqrt(x - 0.3)', 'zeros f').value.points.map((p: any) => +p.coords[0].toFixed(9))).toEqual([0.3]);
  });
});

describe('linear algebra tolerances and checks', () => {
  it('scale-relative tolerances and tiny exact entries', () => {
    expect(last('A = [[1e-10, 0], [0, 1e-10]]', 'rank A').value.value).toBe(2);
    const inv = last('A = [[1000000, 2], [3, 4000000]]', 'inverse A').value.rows;
    expect(inv[0][1]).toBeLessThan(0);
    expect(last('A = [[1000000, 2], [3, 4000000]]', 'diagonalizable A').value.value).toBe(true);
    const e = last('A = [[1000000, 2], [3, 4000000]]', 'eigen A').value;
    for (const p of e.pairs) {
      const v = p.basis[0];
      const Av = [1e6 * v[0] + 2 * v[1], 3 * v[0] + 4e6 * v[1]];
      expect(Math.hypot(Av[0] - p.re * v[0], Av[1] - p.re * v[1])).toBeLessThan(1e-3 * Math.hypot(...Av));
    }
  });
  it('dimension mismatches are errors, not NaN', () => {
    expect(last('W = span(<1,0,0>)', 'project <1,2> onto W').error).toMatch(/dimension/);
    expect(last('leastsquares([[1,1],[1,2]], <1,2,3>)').error).toMatch(/entries/);
    expect(last('B = [[1,2],[2,4]]', 'B^-1').error).not.toMatch(/A is/);
  });
  it('negation keeps exactness', () => {
    expect(last('A = [[1,2],[3,4]]', '-A').value.certainty).toBe('exact');
  });
});

describe('language and analysis details', () => {
  it('arity, implicit products, prefix literals', () => {
    expect(last('log(8, 2)').error).toMatch(/argument/);
    expect(last('f(x) = x(x + 1)', 'f(2)').value.value).toBe(6);
    expect(last('a = 2', 'b = 3', 'c = ab').value.value).toBe(6);
    expect(last('r = 2', 'A = π r^2').value.value).toBeCloseTo(4 * Math.PI, 12);
    expect(last('det [[1,2],[3,4]]').value.value).toBe(-2);
    expect(last('rank <1, 2>').error ?? '').not.toMatch(/Unexpected/);
  });
  it('corners and points outside the domain', () => {
    expect(last('f(x) = abs(x)', 'tangent f at 0').error).toMatch(/not differentiable/);
    expect(last('f(x,y) = sqrt(1 - x^2 - y^2)', 'P = point(1, 1)', 'tangent f at P').error).toMatch(/outside the domain/);
    expect(valueLatex(last('f(x) = sin(x)/x', 'f(0)').value)).toBe('\\text{undefined}');
  });
  it('analyze on a plain number does not blank the workspace', () => {
    const ws = new Workspace(['f(x) = x^2', 'a = 3', 'analyze a']);
    expect(ws.focus).toBe('f');
  });
  it('monotonicity without critical points; constant and linear functions', () => {
    const m = (e: string) => valueLatex(last(`f(x) = ${e}`, 'monotonicity f').value);
    expect(m('x^(1/3)')).toContain('increasing');
    expect(m('5')).toContain('constant');
    expect(m('x')).toContain('increasing');
  });
  it('Taylor centre avoids points outside the domain; readable labels', () => {
    const ws = new Workspace(['f(x) = ln(x)']);
    const an = new AnalysisService(ws);
    expect(an.plan()!.facts.find((f) => f.id === 'taylor')!.expr).toContain('at 1');
    expect(last('f(x,y) = x y', 'P = point(1, 1)', 'tangent f at P').value.latex).toBe('z = 1 + (x - 1) + (y - 1)');
    expect(last('f(x) = x^5', 'derivative f order 4').value.label).toBe('f^{(4)}');
    expect(last('derivative exp(x)').value.expr.type).not.toBe('bin');
  });
});
