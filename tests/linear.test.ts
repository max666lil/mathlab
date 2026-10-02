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

describe('bare formulas, linear functions and planes', () => {
  it('a bare formula is a named function and is analysed (x - 2y + 3 shows its plane)', () => {
    const { ws, value } = last('x - 2y + 3');
    expect(ws.statements()[0].name).toBe('f');
    expect(valueLatex(value)).toBe('f(x, y) = x - 2 y + 3');
    expect(ws.focus).toBe('f');
    const plan = new AnalysisService(ws).plan()!;
    expect(plan.typeLabel).toBe('function ℝ² → ℝ');
    expect(plan.layout.views.map((v) => v.renderer)).toContain('scene');
    expect(plan.sections.map((s) => s.id)).toContain('linear');
    // the name can be used, and explicit definitions keep their names
    expect(last('x - 2y + 3', 'grad f').error).toBeUndefined();
    const two = last('f(x) = x^2', 'x - 2y + 3');
    expect(two.ws.statements()[1].name).toBe('g');
    expect(valueLatex(two.value)).toMatch(/^g\(x, y\)/);
  });
  it('commands and numbers are not renamed', () => {
    expect(last('f(x, y) = x y', 'grad f').ws.statements()[1].name).toBeUndefined();
    expect(last('2 + 3').ws.statements()[0].name).toBeUndefined();
    expect(last('x^2 + y^2 = 9').ws.statements()[0].name).toBeUndefined();
  });
  it('a linear function of three variables: constant gradient, parallel level planes', () => {
    const v = last('2x + 3y - z', 'linearform f').value;
    expect(v.normal).toEqual([2, 3, -1]);
    expect(v.latex).toMatch(/\\nabla f = \\left\(2, 3, -1\\right\)/);
    expect(v.visuals[0].props.vec).toEqual([2, 3, -1]);
    const g = last('f(x, y) = x - 2y + 3', 'linearform f').value;
    expect(g.normal).toEqual([1, -2, -1]);
    expect(last('f(x, y) = x^2 + y', 'linearform f').error).toMatch(/not a linear function/);
  });
  it('an equation with z is a surface S; a linear one is a plane with normal (a, b, c)', () => {
    const { ws } = last('2x + 3y - z = 5');
    expect(ws.statements()[0].name).toBe('S');
    const plan = new AnalysisService(ws).plan()!;
    expect(plan.typeLabel).toBe('plane ax + by + cz = d');
    const p = last('2x + 3y - z = 5', 'linearform S').value;
    expect(p.normal).toEqual([2, 3, -1]);
    expect(p.latex).toMatch(/\\frac\{5\}\{\\sqrt\{14\}\}/);
    // the arrow starts at the point of the plane nearest to the origin: d n / |n|²
    expect(p.visuals[0].props.anchor.map((c: number) => +c.toFixed(6))).toEqual([+(10 / 14).toFixed(6), +(15 / 14).toFixed(6), +(-5 / 14).toFixed(6)]);
    expect(last('x^2 + y^2 + z^2 = 4', 'linearform S').error).toMatch(/not a plane/);
  });
  it('ax + by + cz = d with sliders: letters multiply', () => {
    const r = last('a = slider(-5, 5, 2)', 'b = slider(-5, 5, 3)', 'c = slider(-5, 5, -1)', 'd = slider(-5, 5, 5)', 'ax + by + cz = d');
    expect(r.error).toBeUndefined();
    expect(r.value.kind).toBe('implicitsurface');
    expect(r.value.latex).toBe('a x + b y + c z = d');
    expect(last('a = slider(-5, 5, 2)', 'b = slider(-5, 5, 3)', 'c = slider(-5, 5, -1)', 'd = slider(-5, 5, 5)', 'ax + by + cz = d', 'linearform S').value.normal).toEqual([2, 3, -1]);
    expect(last('ax + by + cz = d').error).toMatch(/Unknown name/);
  });
});