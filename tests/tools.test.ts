import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';
import { valueLatex } from '../src/math-core/values';

beforeAll(() => installMathLab());

function last(...cells: string[]) {
  const ws = new Workspace(cells);
  const sts = ws.statements();
  const n = ws.node(sts[sts.length - 1].id)!;
  return { value: n.value as any, error: n.error?.message, ws };
}

describe('implicit differentiation', () => {
  it('dy/dx = −F_x / F_y, the slope and the tangent at a point', () => {
    const r = last('implicit x^2 + y^2 = 25 at (3, 4)');
    expect(r.error).toBeUndefined();
    expect(r.value.slope).toBeCloseTo(-0.75, 12);
    expect(r.value.derivative.eval(3, 4)).toBeCloseTo(-0.75, 12);
    expect(r.value.latex).toMatch(/\\frac\{dy\}\{dx\} = -\\frac\{F_\{x\}\}\{F_\{y\}\}/);
    expect(r.value.visuals.map((v: any) => v.vtype)).toEqual(['implicit', 'implicit', 'point']);
    // the folium of Descartes at (3, 3)
    expect(last('implicit x^3 + y^3 = 6 x y at (3, 3)').value.slope).toBeCloseTo(-1, 12);
    expect(last('implicit x^2 + y^2 = 25 at (1, 1)').value.latex).toMatch(/not on it/);
    expect(last('implicit x^2 + y^2 = 25 at (5, 0)').value.slope).toBe(Infinity);
  });
  it('three variables: ∂z/∂x and ∂z/∂y', () => {
    const r = last('implicit x^2 + y^2 + z^2 = 9 at (1, 2, 2)').value;
    expect(r.slope).toEqual([-0.5, -1]);
    expect(r.latex).toMatch(/\\frac\{\\partial z\}\{\\partial x\}/);
    expect(last('implicit x^2 + 1 = 5').error).toMatch(/equation in x, y/);
  });
});

describe('the chain rule written out', () => {
  const f = 'f(x, y) = x^2 y';
  const num = (g: (t: number) => number, t: number) => (g(t + 1e-6) - g(t - 1e-6)) / 2e-6;
  it('one variable: dz/dt = f_x x′ + f_y y′', () => {
    const r = last(f, 'chain(f, cos(t), sin(t))').value;
    expect(r.derivative.eval(0.3)).toBeCloseTo(num((t) => Math.cos(t) ** 2 * Math.sin(t), 0.3), 6);
    expect(r.latex).toMatch(/\\frac\{\\partial f\}\{\\partial x\}\\frac\{dx\}\{dt\}/);
    expect(last(f, 'C(t) = (cos t, sin t)', 'chain f along C').value.derivative.eval(0.3)).toBeCloseTo(r.derivative.eval(0.3), 12);
    expect(last(f, 'u(t) = t^2', 'v(t) = 3t', 'chain(f, u, v)').value.derivative.eval(2)).toBeCloseTo(num((t) => t ** 4 * 3 * t, 2), 4);
  });
  it('two variables: both partial derivatives', () => {
    const r = last(f, 'chain(f, s + t, s t)').value;
    const z = (s: number, t: number) => (s + t) ** 2 * s * t;
    expect(r.derivative).toHaveLength(2);
    expect(r.derivative[0].eval(1, 2)).toBeCloseTo(num((s) => z(s, 2), 1), 5);
    expect(r.derivative[1].eval(1, 2)).toBeCloseTo(num((t) => z(1, t), 2), 5);
    expect(last(f, 'chain(f, cos(t))').error).toMatch(/give 2 inner functions/);
  });
});

describe('the total differential', () => {
  it('df = f_x dx + f_y dy; the estimate beside the true change', () => {
    expect(last('f(x, y) = x^2 y', 'differential f').value.latex).toMatch(/df = f_\{x\}\\,dx \+ f_\{y\}\\,dy/);
    expect(last('f(x, y) = x^2 y', 'differential f at (1, 2)').value.coefficients).toEqual([4, 1]);
    const r = last('f(x, y) = x^2 y', 'differential(f, (1, 2), (0.1, -0.05))').value;
    expect(r.df).toBeCloseTo(0.35, 12);
    expect(r.actual).toBeCloseTo(1.1 ** 2 * 1.95 - 2, 12);
    expect(last('f(x, y, z) = x y z', 'differential f at (1, 2, 3)').value.coefficients).toEqual([6, 3, 2]);
  });
});

describe('planes, distances, angles', () => {
  it('a plane through three points, or a point with a normal', () => {
    const S = last('S = plane((1, 0, 0), (0, 1, 0), (0, 0, 1))').value;
    expect(S.kind).toBe('implicitsurface');
    expect(S.latex).toBe('x + y + z = 1');
    expect(last('S = plane((1, 0, 0), (0, 1, 0), (0, 0, 1))', 'linearform S').value.normal).toEqual([1, 1, 1]);
    expect(last('S = plane((1, 2, 3), <2, -1, 4>)').value.latex).toBe('2 x - y + 4 z = 12');
    expect(last('S = plane((0, 0, 0), (1, 1, 1), (2, 2, 2))').error).toMatch(/one line/);
    expect(last('S = plane((0, 0, 0), (1, 1, 1))').error).toMatch(/normal vector/);
  });
  it('distances: point–point, point–plane, point–line', () => {
    expect(last('distance((0, 0), (3, 4))').value.value).toBe(5);
    const d = last('S = x + y + z = 1', 'distance((2, 2, 2), S)').value;
    expect(d.value).toBeCloseTo(5 / Math.sqrt(3), 12);
    expect(d.visuals[1].props.vec.map((c: number) => +c.toFixed(9))).toEqual([-5 / 3, -5 / 3, -5 / 3].map((c) => +c.toFixed(9)));
    expect(last('L(t) = (t, 0, 0)', 'distance((1, 2, 2), L)').value.value).toBeCloseTo(Math.sqrt(8), 12);
    expect(last('L(t) = (1 + t, 2 - t)', 'distance((0, 0), L)').value.value).toBeCloseTo(3 / Math.SQRT2, 12);
  });
  it('angles between vectors and between planes', () => {
    const a = last('angle(<1, 0>, <1, 1>)').value;
    expect(a.value).toBeCloseTo(Math.PI / 4, 12);
    expect(a.derivation).toMatch(/45\^\{\\circ\}/);
    expect(last('angle(<1, 0, 0>, <-1, 0, 0>)').value.value).toBeCloseTo(Math.PI, 12);
    expect(last('A = plane((0, 0, 0), <1, 0, 0>)', 'B = plane((0, 0, 0), <-1, -1, 0>)', 'angle(A, B)').value.value).toBeCloseTo(Math.PI / 4, 12);
    expect(valueLatex(last('angle(<1, 0>, <0, 2>)').value)).toMatch(/\\pi/);
  });
});