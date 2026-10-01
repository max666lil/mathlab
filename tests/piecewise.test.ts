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
const CLASSIC = 'f(x,y) = {(x,y) != (0,0): x y (x^2 - y^2)/(x^2 + y^2), 0}';

describe('piecewise functions', () => {
  it('parse, print and evaluate (Desmos syntax)', () => {
    const f = last(CLASSIC).value;
    expect(toText(f.expr)).toBe('{(x, y) != (0, 0): x*y*(x^2 - y^2)/(x^2 + y^2), 0}');
    expect(last(CLASSIC, 'f(0,0)').value.value).toBe(0);
    expect(last(CLASSIC, 'f(1,2)').value.value).toBeCloseTo(-1.2, 12);
    expect(last('g(x) = {x < 0: -x, x <= 2: x^2, 4}', 'g(-3) + g(1) + g(5)').value.value).toBe(3 + 1 + 4);
    expect(last('h(x) = {x > 0 and x < 1: 1, 0}', 'h(0.5) + h(2)').value.value).toBe(1);
    expect(last('k(x) = {x ≠ 0: sin(x)/x, 1}', 'k(0)').value.value).toBe(1);
  });
  it('domain: the point branch fills the hole', () => {
    expect(last(CLASSIC, 'domain(f)').value.conditions).toEqual([]);
  });
  it('mixed partials at the origin: f_xy(0,0) = −1 ≠ f_yx(0,0) = 1 (limit definition)', () => {
    const H = last(CLASSIC, 'hessian f at (0,0)').value;
    expect(H.rows).toEqual([[0, -1], [1, 0]]);
    const g = last(CLASSIC, 'grad f at (0,0)').value;
    expect(g.comps.map((x: number) => x + 0)).toEqual([0, 0]);
    // away from the origin the branch formula is used
    expect(last(CLASSIC, 'hessian f at (1,1)').value.rows[0][1]).toBeCloseTo(last(CLASSIC, 'hessian f at (1,1)').value.rows[1][0], 9);
  });
  it('smoothness f at (0,0): continuous, differentiable, Clairaut fails', () => {
    const s = last(CLASSIC, 'smoothness f at (0,0)').value;
    expect(s.kind).toBe('smoothness');
    expect(s.continuous).toBe(true);
    expect(s.differentiable).toBe(true);
    expect(s.clairaut).toBe(false);
    expect(s.rows.join(' ')).toMatch(/Clairaut/);
  });
  it('xy/(x²+y²) has no limit at the origin; x²y/(x⁴+y²) fails only along parabolas', () => {
    const a = last('f(x,y) = {(x,y) != (0,0): x y/(x^2 + y^2), 0}', 'smoothness f at (0,0)').value;
    expect(a.continuous).toBe(false);
    expect(a.rows.join(' ')).toMatch(/no limit/);
    const b = last('f(x,y) = {(x,y) != (0,0): x^2 y/(x^4 + y^2), 0}', 'smoothness f at (0,0)').value;
    expect(b.continuous).toBe(false);
  });
  it('one variable: corners and jumps', () => {
    const abs = last('g(x) = {x < 0: -x, x}', 'smoothness g at 0').value;
    expect(abs.continuous).toBe(true);
    expect(abs.differentiable).toBe(false);
    const jump = last('g(x) = {x < 1: x, x + 2}', 'smoothness g at 1').value;
    expect(jump.continuous).toBe(false);
    const smooth = last('g(x) = {x < 0: x^2, x^3}', 'smoothness g at 0').value;
    expect(smooth.differentiable).toBe(true);
  });
  it('the analyzer opens a section at the special point', () => {
    const ws = new Workspace([CLASSIC]);
    const plan = new AnalysisService(ws).plan()!;
    expect(plan.sections.some((s) => s.title === 'At the special point (0, 0)')).toBe(true);
  });
});