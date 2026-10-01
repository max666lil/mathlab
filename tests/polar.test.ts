import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';
import { toText } from '../src/math-core/symbolic/print';
import { valueLatex } from '../src/math-core/values';
import { AnalysisService } from '../src/runtime/analysis';

beforeAll(() => installMathLab());

function last(...cells: string[]) {
  const ws = new Workspace(cells);
  const sts = ws.statements();
  const n = ws.node(sts[sts.length - 1].id)!;
  return { value: n.value as any, error: n.error?.message, ws };
}

describe('polar coordinates and the gradient', () => {
  it('grad of f(r, θ) uses the moving basis: f_r e_r + (1/r) f_θ e_θ', () => {
    const g = last('f(r, θ) = r^2 sin(θ)', 'grad f').value;
    expect(g.role).toBe('polar-gradient');
    expect(toText(g.polar.er)).toBe('2r*sin(θ)');
    expect(toText(g.polar.eth)).toBe('r*cos(θ)');
    expect(valueLatex(g)).toMatch(/\\mathbf\{e\}_\{r\}/);
    expect(valueLatex(g)).toMatch(/\\mathbf\{e\}_\{\\theta\}/);
    // the same gradient in the xy-plane: f = y√(x² + y²), ∇f(1, 1) = (1/√2, √2 + 1/√2)
    const [gx, gy] = g.cartesianField.eval(1, 1);
    expect(gx).toBeCloseTo(Math.SQRT1_2, 10);
    expect(gy).toBeCloseTo(Math.SQRT2 + Math.SQRT1_2, 10);
    expect(g.certainty).toBe('exact');
  });
  it('radial functions: ∇f = f′(r) e_r, perpendicular to the circles', () => {
    const g = last('f(x, y) = x^2 + y^2', 'grad f in polar').value;
    expect(toText(g.polar.er)).toBe('2r');
    expect(g.polar.radial).toBe(true);
    expect(g.evidence).toMatch(/perpendicular to the circular contours/);
    // (2x, 2y) = 2r e_r
    expect(g.cartesianField.eval(0.6, -0.8).map((v: number) => +v.toFixed(12))).toEqual([1.2, -1.6]);
  });
  it('polar form and Cartesian form', () => {
    expect(toText(last('f(x, y) = x^2 + y^2', 'polarform f').value.expr)).toBe('r^2');
    expect(toText(last('f(x, y) = x y', 'polarform f').value.expr)).toMatch(/r\^2/);
    const c = last('f(r, θ) = r^2 sin(θ)', 'cartesian f').value;
    expect(c.params).toEqual(['x', 'y']);
    expect(c.eval(1, 1)).toBeCloseTo(Math.SQRT2, 10);
  });
  it('the picture at P: f_r and f_θ, and an error at the origin', () => {
    const v = last('f(r, θ) = r^2 sin(θ)', 'P = point(1, 1)', 'polarview f at P').value;
    expect(v.vtype).toBe('polarbasis');
    expect(v.props.fr).toBeCloseTo(2, 6);
    expect(v.props.fth).toBeCloseTo(Math.SQRT2, 6);
    expect(last('f(x, y) = x^2 + y^2', 'polarview f at (0, 0)').error).toMatch(/origin/);
  });
  it('ordinary Cartesian gradients are unchanged', () => {
    const g = last('f(x, y) = x^2 + 2y^2', 'grad f').value;
    expect(g.role).toBe('gradient');
    expect(valueLatex(g)).toMatch(/2 x/);
  });
});
describe('level curves with a slider, coordinate-map pictures', () => {
  it('f(x, y) = c after f is defined draws the level curve; level f at a number', () => {
    const r = last('f(x, y) = x^2 + y^2', 'c = slider(0, 9, 4)', 'f(x, y) = c');
    expect(r.error).toBeUndefined();
    expect(r.value.kind).toBe('relation');
    expect(r.ws.sceneItems().some((i) => i.visual.vtype === 'implicit')).toBe(true);
    expect(last('f(x, y) = x^2 + y^2', 'level f at 4').value.props.value).toBe(4);
    expect(last('f(x, y) = x^2 + y^2', 'f(x) = 3').error).toMatch(/already defined/);
  });
  it('the 2-D analysis offers the level curve f = c and the polar view', () => {
    const ws = new Workspace(['f(x, y) = x^2 + y^2', 'c = slider(0, 9, 4)']);
    ws.setFocus('f');
    const plan = new AnalysisService(ws).plan()!;
    expect(plan.sections.map((s) => s.id)).toEqual(expect.arrayContaining(['levelc', 'polar']));
    expect(plan.facts.find((x) => x.id === 'levelc')?.expr).toBe('level f = c');
  });
  it('3-D maps get a grid picture, and J = jacobian T is analysed as T', () => {
    const g = last('S(ρ, φ, θ) = (ρ sin(φ) cos(θ), ρ sin(φ) sin(θ), ρ cos(φ))', 'coordgrid S').value;
    expect(g.vtype).toBe('coordmap3');
    expect(g.props.detText).toMatch(/ρ\^2/);
    const ws = new Workspace(['T(r, θ) = (r cos(θ), r sin(θ))', 'J = jacobian T']);
    ws.setFocus('J');
    const plan = new AnalysisService(ws).plan()!;
    expect(plan.typeLabel).toMatch(/coordinate map/);
    expect(plan.facts.find((x) => x.id === 'grid')?.expr).toBe('coordgrid T');
  });
});
describe('writing polar functions the way students do', () => {
  it('theta spelled out, either parameter order, sliders stay symbolic', () => {
    expect(last('f(r, theta) = r^2 sin(theta)', 'grad f').value.role).toBe('polar-gradient');
    const g = last('f(θ, r) = r cos(θ)', 'grad f').value;
    expect(g.role).toBe('polar-gradient');
    expect(valueLatex(g)).toMatch(/\\left\\langle 1,\\ 0 \\right\\rangle_\{xy\}/);
    expect(toText(last('a = slider(0, 3, 1)', 'f(r, θ) = a r^2', 'grad f').value.polar.er)).toMatch(/a/);
    expect(last('r = slider(0, 3, 1)', 'f(r, θ) = r^2 sin(θ)', 'grad f').value.role).toBe('polar-gradient');
  });
  it('a point is a place (x, y): f(P) and grad f at P use its polar coordinates', () => {
    expect(last('f(r, θ) = r^2 sin(θ)', 'P = point(1, 1)', 'f(P)').value.value).toBeCloseTo(Math.SQRT2, 12);
    expect(last('f(r, θ) = r^2 sin(θ)', 'f(2, π/2)').value.value).toBeCloseTo(4, 12);
    const v = last('f(r, θ) = r^2 sin(θ)', 'P = point(1, 1)', 'grad f at P').value;
    expect(v.kind).toBe('vector');
    expect(v.comps[0]).toBeCloseTo(Math.SQRT1_2, 10);
    expect(v.comps[1]).toBeCloseTo(3 * Math.SQRT1_2, 10);
    expect(v.anchor).toEqual([1, 1]);
    expect(v.derivation).toMatch(/\\mathbf\{e\}_r/);
  });
  it('tidy displays: e_r alone, 1/r² as a fraction', () => {
    expect(valueLatex(last('f(r, θ) = r', 'grad f').value)).toMatch(/= \\mathbf\{e\}_\{r\}/);
    expect(valueLatex(last('f(r, θ) = 1/r', 'grad f').value)).toMatch(/-\\frac\{1\}\{r\^\{2\}\}\\,\\mathbf\{e\}_\{r\}/);
  });
});