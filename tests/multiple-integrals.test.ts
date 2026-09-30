import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';
import { fromCartesian } from '../src/plugins/multivariable/coords';
import { parseExpression } from '../src/parser/parser';
import { toText } from '../src/math-core/symbolic/print';

beforeAll(() => installMathLab());

function last(...cells: string[]) {
  const ws = new Workspace(cells);
  const sts = ws.statements();
  const n = ws.node(sts[sts.length - 1].id)!;
  return { value: n.value as any, error: n.error?.message, ws };
}

describe('coordinates (3b)', () => {
  it('Cartesian → polar / spherical expressions are tidied', () => {
    const p = (s: string, sys: 'polar' | 'spherical') => toText(fromCartesian(parseExpression(s), sys));
    expect(p('x^2 + y^2', 'polar')).toBe('r^2');
    expect(p('4 - x^2 - y^2', 'polar')).toBe('-r^2 + 4');
    expect(p('exp(-(x^2 + y^2))', 'polar')).toBe('exp(-r^2)');
    expect(p('(x^2 + y^2)^(-3/2)', 'polar')).toBe('r^(-3)');
    expect(p('x^2 + y^2 + z^2', 'spherical')).toBe('ρ^2');
    expect(p('sqrt(x^2 + y^2 + z^2)', 'spherical')).toBe('ρ');
  });
});

describe('regions (3b)', () => {
  it('chains, and, commas; systems and dimensions', () => {
    const D = last('D = 0 <= x <= 1 and x^2 <= y <= x').value;
    expect(D.kind).toBe('region');
    expect(D.cons.length).toBe(4);
    expect(D.dim).toBe(2);
    const E = last('E = x^2 + y^2 + z^2 <= 4, z >= 0').value;
    expect([E.kind, E.dim, E.system]).toEqual(['region', 3, 'cartesian']);
    const S = last('S = 1 <= r <= 2 and 0 <= θ <= π/4').value;
    expect([S.system, S.dim]).toEqual(['polar', 2]);
    expect(last('B = ρ <= 2').value.system).toBe('spherical');
    expect(last('C = r <= 1 and 0 <= z <= 3').value.system).toBe('cylindrical');
    // a single inequality in x, y stays the graphing relation
    expect(last('x^2 + y^2 <= 1').value.kind).toBe('relation');
    expect(last('R = x <= 1 and r <= 2').error).toMatch(/mixed/);
  });
  it('membership test and bounding box', () => {
    const D = last('D = 0 <= x <= 1 and x^2 <= y <= x').value;
    expect(D.test.eval(0.5, 0.4)).toBeLessThanOrEqual(0);
    expect(D.test.eval(0.5, 0.1)).toBeGreaterThan(0);
    expect(D.box[0][0]).toBeCloseTo(0, 1);
    expect(D.box[0][1]).toBeCloseTo(1, 1);
    const S = last('S = -π/2 <= θ <= π/2 and r <= 1').value;
    expect(S.test.eval(0.5, -0.2)).toBeLessThanOrEqual(0);
    expect(S.test.eval(-0.5, 0.2)).toBeGreaterThan(0);
  });
  it('iterated bounds in both orders', () => {
    expect(last('D = 0 <= x <= 1 and x^2 <= y <= x', 'bounds D').value.latex).toBe('0 \\le x \\le 1,\\; x^{2} \\le y \\le x');
    const yx = last('D = 0 <= x <= 1 and x^2 <= y <= x', 'bounds D order dx dy').value.latex;
    expect(yx).toContain('0 \\le y \\le 1');
    expect(yx).toContain('\\sqrt{y}');
    expect(last('T = x >= 0 and y >= 0 and x + y <= 1', 'bounds T').value.latex).toBe('0 \\le x \\le 1,\\; 0 \\le y \\le -x + 1');
  });
});

describe('multiple integrals — Hughes-Hallett ch. 16', () => {
  it('flagship: ∬ over the unit disk of 4 − x² − y² = 7π/2, exact (polar)', () => {
    const I = last('R = x^2 + y^2 <= 1', 'f(x,y) = 4 - x^2 - y^2', 'integrate f over R').value;
    expect(I.value).toBeCloseTo(3.5 * Math.PI, 12);
    expect(I.certainty).toBe('exact');
    expect(I.evidence).toContain('polar');
    expect(I.derivation).toContain('d\\theta');
  });
  it('the same integral in Cartesian coordinates is numeric but agrees', () => {
    const I = last('R = x^2 + y^2 <= 1', 'f(x,y) = 4 - x^2 - y^2', 'integrate f over R in cartesian').value;
    expect(I.value).toBeCloseTo(3.5 * Math.PI, 7);
  });
  it('slanted roof: 1280 in both orders and as a triple integral (§16.2, §16.3)', () => {
    const cells = ['R = 0 <= x <= 8 and 0 <= y <= 16', 'h(x,y) = 12 - x/4 - y/8'];
    const a = last(...cells, 'integrate h over R').value;
    expect(a.value).toBeCloseTo(1280, 9);
    expect(a.certainty).toBe('exact');
    expect(last(...cells, 'integrate h over R order dx dy').value.value).toBeCloseTo(1280, 9);
    const V = last('E = 0 <= x <= 8 and 0 <= y <= 16 and 0 <= z <= 12 - x/4 - y/8', 'volume E').value;
    expect(V.value).toBeCloseTo(1280, 9);
    expect(V.certainty).toBe('exact');
  });
  it('plate between y = x² and y = x with density 1 + x: mass 1/4', () => {
    const m = last('D = 0 <= x <= 1 and x^2 <= y <= x', 'mass 1 + x over D').value;
    expect(m.value).toBeCloseTo(0.25, 12);
    expect(m.certainty).toBe('exact');
  });
  it('reversing the order makes ∫∫ x√(y³+1) exact: 26', () => {
    const cells = ['D = 0 <= x <= 6 and x/3 <= y <= 2', 'g(x,y) = x sqrt(y^3 + 1)'];
    const I = last(...cells, 'integrate g over D').value;
    expect(I.value).toBeCloseTo(26, 9);
    expect(I.certainty).toBe('exact');
    expect(I.evidence).toContain('dx dy');
  });
  it('e^{−(x²+y²)} over the unit square ≈ 0.5577 (numeric)', () => {
    const I = last('Q = 0 <= x <= 1 and 0 <= y <= 1', 'integrate exp(-(x^2 + y^2)) over Q').value;
    expect(I.value).toBeCloseTo(0.557746285351034, 8);
  });
  it('polar sector: ∬ (x²+y²)^(−3/2) over 1 ≤ r ≤ 2, 0 ≤ θ ≤ π/4 = π/8', () => {
    const I = last('S = 1 <= r <= 2 and 0 <= θ <= π/4', 'integrate (x^2 + y^2)^(-3/2) over S').value;
    expect(I.value).toBeCloseTo(Math.PI / 8, 12);
    expect(I.certainty).toBe('exact');
  });
  it('areas: disk, half disk, triangle, cardioid, ellipse', () => {
    expect(last('R = x^2 + y^2 <= 4', 'area R').value.value).toBeCloseTo(4 * Math.PI, 12);
    expect(last('H = x^2 + y^2 <= 1 and y >= 0', 'area H').value.value).toBeCloseTo(Math.PI / 2, 12);
    expect(last('T = x >= 0 and y >= 0 and x + y <= 1', 'area T').value.value).toBeCloseTo(0.5, 12);
    expect(last('C = r <= 1 + cos(θ)', 'area C').value.value).toBeCloseTo(1.5 * Math.PI, 12);
    expect(last('E = x^2/9 + y^2/4 <= 1', 'area E').value.value).toBeCloseTo(6 * Math.PI, 7);
  });
  it('ball and cone in spherical / cylindrical coordinates', () => {
    const B = last('B = x^2 + y^2 + z^2 <= 4', 'volume B').value;
    expect(B.value).toBeCloseTo((4 / 3) * Math.PI * 8, 10);
    expect(B.certainty).toBe('exact');
    expect(last('B = ρ <= 3', 'volume B').value.value).toBeCloseTo(36 * Math.PI, 10);
    // cone z = √(x²+y²) up to z = 3 with density z: 81π/4
    const m = last('K = sqrt(x^2 + y^2) <= z <= 3', 'mass z over K').value;
    expect(m.value).toBeCloseTo((81 * Math.PI) / 4, 8);
    // cheese wedge r ≤ 6, 0 ≤ z ≤ 4, 0 ≤ θ ≤ π/6: volume 12π
    expect(last('W = r <= 6 and 0 <= z <= 4 and 0 <= θ <= π/6', 'volume W').value.value).toBeCloseTo(12 * Math.PI, 10);
  });
  it('average value: semicircular city, distance to the coast 4/π', () => {
    const a = last('C = x^2 + y^2 <= 9 and y >= 0', 'average y over C').value;
    expect(a.value).toBeCloseTo(4 / Math.PI, 10);
  });
  it('centroid of a half disk and a triangle', () => {
    const c = last('H = x^2 + y^2 <= 1 and y >= 0', 'centroid H').value;
    expect(c.coords[0]).toBeCloseTo(0, 10);
    expect(c.coords[1]).toBeCloseTo(4 / (3 * Math.PI), 10);
    const t = last('T = x >= 0 and y >= 0 and x + y <= 1', 'centroid T').value.coords;
    expect(t[0]).toBeCloseTo(1 / 3, 12);
    expect(t[1]).toBeCloseTo(1 / 3, 12);
  });
  it('probability over a region (Devore Ex 5.3): (6/5)(x + y²) on the unit square', () => {
    const cells = ['p(x,y) = 6/5 (x + y^2)'];
    expect(last(...cells, 'Q = 0 <= x <= 1 and 0 <= y <= 1', 'integrate p over Q').value.value).toBeCloseTo(1, 12);
    expect(last(...cells, 'A = 0 <= x <= 1/4 and 0 <= y <= 1/4', 'integrate p over A').value.value).toBeCloseTo(7 / 640, 12);
  });
  it('errors are explained', () => {
    expect(last('R = x^2 + y^2 <= 1', 'f(x) = x', 'integrate f over R').error).toMatch(/1 variable/);
    expect(last('U = y >= 0', 'area U').error).toMatch(/iterated bounds|describe/);
  });
});