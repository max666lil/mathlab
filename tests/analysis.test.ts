import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';

beforeAll(() => installMathLab());

const run = (...cells: string[]) => {
  const ws = new Workspace(cells);
  return { ws, v: (id: string) => ws.value(id) as any, err: (id: string) => ws.node(id)?.error?.message };
};

describe('commands and results as objects', () => {
  it('limits', () => {
    const { v } = run('a = limit sin(x)/x as x -> 0', 'b = limit 1/x as x -> 0', 'c = limit (2x + 1)/(x - 3) as x -> ∞', 'd = limit x^2 as x -> 3', 'e1 = limit 1/x as x -> 0+');
    expect(v('a').result).toBe('finite');
    expect(v('a').value).toBeCloseTo(1, 8);
    expect(v('a').certainty).toBe('heuristic');
    expect(v('b').result).toBe('dne');
    expect(v('c').value).toBeCloseTo(2, 5);
    expect(v('d').value).toBe(9);
    expect(v('d').certainty).toBe('exact');
    expect(v('e1').result).toBe('+inf');
  });
  it('integrals', () => {
    const { v } = run('F = integrate x^2', 'I = integrate x^2 from 0 to 1', 'J = integrate exp(-x^2) from 0 to 1');
    expect(v('F').certainty).toBe('exact');
    expect(v('F').eval(3)).toBeCloseTo(9);
    expect(v('I').value).toBeCloseTo(1 / 3, 12);
    expect(v('I').certainty).toBe('exact');
    expect(v('J').value).toBeCloseTo(0.746824132812427, 10);
    expect(v('J').certainty).toBe('numeric');
  });
  it('solve and taylor', () => {
    const { v } = run('S = solve x^2 = 2', 'T = taylor exp(x) at 0 order 3', 'R = solve(x + y = 3, x - y = 1)');
    expect(v('S').points.map((p: any) => p.coords[0])).toEqual([-Math.SQRT2, Math.SQRT2]);
    expect(v('S').certainty).toBe('exact');
    expect(v('T').eval(1)).toBeCloseTo(1 + 1 + 0.5 + 1 / 6, 12);
    expect(v('R').points[0].coords.map((c: number) => +c.toFixed(9))).toEqual([2, 1]);
  });
  it('critical points are addressable objects', () => {
    const { v, err } = run('f(x,y) = x^3 - 3x + y^2', 'C = critical f', 'P = first(C)', 'Q = C[2]', 'H = hessian f at Q', 'L = eigenvalues H', 'analyze C');
    expect(v('C').kind).toBe('pointset');
    expect(v('C').certainty).toBe('numeric');
    expect(v('C').points.map((p: any) => [p.coords.map((c: number) => +c.toFixed(6)), p.type])).toEqual([[[-1, 0], 'saddle'], [[1, 0], 'local min']]);
    expect(v('P').coords.map((c: number) => +c.toFixed(6))).toEqual([-1, 0]);
    expect(v('H').rows.map((r: number[]) => r.map((c) => +c.toFixed(6)))).toEqual([[6, 0], [0, 2]]);
    expect(err('L')).toBeUndefined();
  });
  it('exact critical point for quadratic surfaces', () => {
    const { v } = run('f(x,y) = x^2 + 2y^2', 'C = critical f');
    expect(v('C').certainty).toBe('exact');
    expect(v('C').points[0].type).toBe('local min');
  });
  it('one-variable analysis', () => {
    const { v } = run('f(x) = x^3 - 3x', 'C = critical f', 'I = inflections f', 'M = monotonicity f', 'D = derivative f', 'g(x) = 1/(x - 1)', 'A = asymptotes g', 'h(x) = ln(x)', 'Dh = domain h');
    expect(v('C').points.map((p: any) => [p.coords[0], p.type])).toEqual([[-1, 'local max'], [1, 'local min']]);
    expect(v('C').certainty).toBe('exact');
    expect(v('I').points.map((p: any) => p.coords[0])).toEqual([0]);
    expect(v('M').intervals.map((i: any) => [i.a, i.b, i.label])).toEqual([[-Infinity, -1, 'increasing'], [-1, 1, 'decreasing'], [1, Infinity, 'increasing']]);
    expect(v('D').certainty).toBe('exact');
    expect(v('A').vertical).toEqual([1]);
    expect(v('A').horizontal.map((h: any) => h.value)).toEqual([0, 0]);
    const r = run('q(x) = (x^2 + 1)/(x - 1)', 'A = asymptotes q');
    expect(r.v('A').vertical).toEqual([1]);
    expect(r.v('A').oblique.map((o: any) => [o.m, o.b])).toEqual([[1, 1], [1, 1]]);
    expect(v('Dh').intervals.map((i: any) => [i.a, i.b])).toEqual([[0, Infinity]]);
    expect(v('Dh').certainty).toBe('heuristic');
  });
  it('geometry commands', () => {
    const { v } = run('f(x,y) = x^2 + 2y^2', 'P = point(1, 1) draggable', 'D = directional f at P toward (3,-2)', 'T = tangent f at P', 'g = gradient f');
    expect(v('D').value).toBeCloseTo((2 * 3 + 4 * -2) / Math.sqrt(13));
    expect(v('D').visuals.map((x: any) => x.vtype)).toEqual(['arrow', 'slice']);
    expect(v('T').kind).toBe('plane');
    expect(v('g').kind).toBe('function');
  });
  it('representation statements', () => {
    const { ws } = run('f(x) = sin(x)', 'show derivative f', 'compare f with taylor f at 0 order 3', 'h(x,y) = x^2 + y^2', 'show level h = 1');
    const kinds = ws.sceneItems().map((i) => `${i.visual.vtype}:${i.visual.role ?? ''}`);
    expect(kinds).toContain('graph1d:compare');
    expect(kinds).toContain('graph1d:difference');
    expect(kinds).toContain('level:level');
    expect(ws.statements().every((s) => !ws.node(s.id)?.error)).toBe(true);
  });
});