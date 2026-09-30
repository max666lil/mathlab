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
