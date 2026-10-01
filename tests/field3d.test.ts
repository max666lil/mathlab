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
const best = (o: any, label: string) => o.candidates.find((c: any) => c.label === label);

describe('3-D scalar fields (3a)', () => {
  it('Earth temperature: critical point, Laplacian, gradient, tangent plane to the level sphere', () => {
    const cells = ['T(x,y,z) = 6000 - 5700 (x^2 + y^2 + z^2)', 'P = point(0.3, 0.4, 0.5)'];
    const C = last(...cells, 'critical T').value;
    expect(C.points.map((p: any) => [p.coords, p.type])).toEqual([[[0, 0, 0], 'local max']]);
    expect(C.certainty).toBe('exact');
    expect(toText(last(...cells, 'laplacian(T)').value.expr)).toBe('-34200');
    expect(last(...cells, 'grad T at P').value.comps).toEqual([-3420, -4560, -5700]);
    expect(last(...cells, 'tangent T at P').value.latex).toBe('-3420 x - 4560 y - 5700 z + 5700 = 0');
  });
  it('saddle of x² + y² − z²; implicit surfaces; the field analyzer', () => {
    expect(last('f(x,y,z) = x^2 + y^2 - z^2', 'critical f').value.points[0].type).toBe('saddle');
    const S = last('S = x^2 + y^2 + z^2 = 4').value;
    expect(S.kind).toBe('implicitsurface');
    expect(S.box[0][1]).toBeGreaterThan(1.9);
    const ws = new Workspace(['T(x,y,z) = x^2 + 2y^2 + 3z^2']);
    const an = new AnalysisService(ws);
    const plan = an.plan()!;
    expect(plan.typeLabel).toBe('function ℝ³ → ℝ');
    expect(ws.sceneItems().some((i) => i.visual.vtype === 'isosurface' && i.visible)).toBe(true);
  });
});

describe('Lagrange multipliers (3a, Hughes-Hallett §15.3)', () => {
  it('flagship: max / min of 4 − x² − 2y² on the unit circle', () => {
    const o = last('f(x,y) = 4 - x^2 - 2y^2', 'maximize f subject to x^2 + y^2 = 1').value;
    expect(o.kind).toBe('optimum');
    expect(o.bounded).toBe(true);
    const mx = best(o, 'maximum');
    expect(mx.value).toBeCloseTo(3, 9);
    expect(Math.abs(mx.coords[0])).toBeCloseTo(1, 9);
    expect(mx.lambdas[0]).toBeCloseTo(-1, 9);
    const mn = best(o, 'minimum');
    expect(mn.value).toBeCloseTo(2, 9);
    expect(mn.lambdas[0]).toBeCloseTo(-2, 9);
    expect(o.candidates.length).toBe(4);
  });
  it('x + y on x² + y² = 4: ±2√2', () => {
    const o = last('minimize x + y subject to x^2 + y^2 = 4').value;
    expect(best(o, 'maximum').value).toBeCloseTo(2 * Math.SQRT2, 9);
    expect(best(o, 'minimum').value).toBeCloseTo(-2 * Math.SQRT2, 9);
  });
  it('production x^(2/3) y^(1/3) on the budget x + y = 3.78 (x, y ≥ 0): (2.52, 1.26), λ ≈ 0.53', () => {
    const o = last('P(x,y) = x^(2/3) y^(1/3)', 'maximize P subject to x + y = 3.78 and x >= 0 and y >= 0').value;
    const mx = best(o, 'maximum');
    expect(mx.coords[0]).toBeCloseTo(2.52, 6);
    expect(mx.coords[1]).toBeCloseTo(1.26, 6);
    expect(mx.value).toBeCloseTo(2, 2);
    expect(mx.lambdas[0]).toBeCloseTo(0.53, 2);
  });
  it('an inequality constraint: (x−1)² + (y−2)² on x² + y² ≤ 45 → min 0 inside, max 80 on the boundary', () => {
    const o = last('maximize (x - 1)^2 + (y - 2)^2 subject to x^2 + y^2 <= 45').value;
    expect(best(o, 'minimum').value).toBeCloseTo(0, 9);
    expect(best(o, 'minimum').where).toBe('interior');
    const mx = best(o, 'maximum');
    expect(mx.value).toBeCloseTo(80, 8);
    expect(mx.coords[0]).toBeCloseTo(-3, 8);
    expect(mx.coords[1]).toBeCloseTo(-6, 8);
  });
  it('three variables: x + y + z on the unit sphere → √3', () => {
    const o = last('maximize x + y + z subject to x^2 + y^2 + z^2 = 1').value;
    expect(best(o, 'maximum').value).toBeCloseTo(Math.sqrt(3), 8);
  });
  it('unbounded feasible sets carry no global labels; the analyzer shows the contour picture', () => {
    const o = last('maximize x y subject to x + y = 2').value;
    expect(o.bounded).toBe(false);
    expect(o.candidates[0].coords.map((x: number) => +x.toFixed(9))).toEqual([1, 1]);
    const ws = new Workspace(['f(x,y) = 4 - x^2 - 2y^2', 'L = maximize f subject to x^2 + y^2 = 1']);
    ws.setFocus('L');
    const plan = new AnalysisService(ws).plan()!;
    expect(plan.object).toBe('L');
    expect(ws.sceneItems().some((i) => i.visual.vtype === 'levelsweep')).toBe(true);
    void toText;
  });
});