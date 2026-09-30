import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';
import { AnalysisService } from '../src/runtime/analysis';

beforeAll(() => installMathLab());

function last(...cells: string[]) {
  const ws = new Workspace(cells);
  const sts = ws.statements();
  const n = ws.node(sts[sts.length - 1].id)!;
  return { value: n.value as any, error: n.error?.message, ws };
}

describe('curves (3d.1)', () => {
  it('parameter ranges in the language', () => {
    const c = last('C(t) = (cos t, sin t) for t in [0, π]').value;
    expect(c.ranges).toEqual({ t: [0, Math.PI] });
    expect(last('a = 2', 'C(t) = (t, t^2) for t in [0, a]').value.ranges.t).toEqual([0, 2]);
    expect(last('C(t) = (t, t) for s in [0, 1]').error).toMatch(/not a parameter/);
  });
  it('length: unit circle 2π (exact), helix, parabola', () => {
    const circle = last('C(t) = (cos t, sin t)', 'length C').value;
    expect(circle.value).toBeCloseTo(2 * Math.PI, 12);
    expect(circle.certainty).toBe('exact');
    expect(last('H(t) = (cos t, sin t, t) for t in [0, 2π]', 'length H').value.value).toBeCloseTo(2 * Math.PI * Math.SQRT2, 9);
    expect(last('P(t) = (t, t^2) for t in [0, 1]', 'length P').value.value).toBeCloseTo(1.4789428575445975, 8);
  });
  it('closed, orientation, enclosed area', () => {
    expect(last('C(t) = (cos t, sin t)', 'closed C').value.reason).toContain('counter-clockwise');
    expect(last('C(t) = (cos t, -sin t)', 'closed C').value.reason).toContain('clockwise');
    expect(last('C(t) = (t, t^2) for t in [0, 1]', 'closed C').value.value).toBe(false);
    expect(last('E(t) = (3cos t, 2sin t)', 'area E').value.value).toBeCloseTo(6 * Math.PI, 10);
  });
  it('tangent and curvature', () => {
    const T = last('C(t) = (cos t, sin t)', 'tangent C at 0').value;
    expect(T.comps.map((x: number) => +x.toFixed(12) + 0)).toEqual([0, 1]);
    expect(T.anchor).toEqual([1, 0]);
    expect(last('C(t) = (2cos t, 2sin t)', 'curvature C at 1').value.value).toBeCloseTo(0.5, 12);
    expect(last('H(t) = (cos t, sin t, t)', 'curvature H at 0').value.value).toBeCloseTo(0.5, 12);
  });
  it('curve analyzer: layout by dimension, motion on demand', () => {
    const ws = new Workspace(['C(t) = (cos t, sin 2t)']);
    const an = new AnalysisService(ws);
    const plan = an.plan()!;
    expect(plan.typeLabel).toContain('curve in ℝ²');
    expect(ws.sceneItems().filter((i) => i.visible).map((i) => i.visual.vtype)).toEqual(['curve']);
    an.setSectionOpen(plan, 'motion', true);
    an.flushNow();
    expect(ws.sceneItems().filter((i) => i.visible).map((i) => i.visual.vtype).sort()).toEqual(['curve', 'motion']);
    const h = new AnalysisService(new Workspace(['H(t) = (cos t, sin t, t/3)'])).plan()!;
    expect(h.layout.views[0].renderer).toBe('scene');
  });
});

describe('line integrals (3d.2)', () => {
  it('circulation of the rotation field around the unit circle: 2π exact, −2π clockwise', () => {
    const r = last('F(x,y) = <-y, x>', 'C(t) = (cos t, sin t)', 'circulation F around C').value;
    expect(r.value).toBeCloseTo(2 * Math.PI, 12);
    expect(r.certainty).toBe('exact');
    expect(last('F(x,y) = <-y, x>', 'C(t) = (cos t, -sin t)', 'circulation F around C').value.value).toBeCloseTo(-2 * Math.PI, 12);
    expect(last('F(x,y) = <-y, x>', 'C(t) = (t, t^2) for t in [0, 1]', 'circulation F around C').error).toMatch(/not closed/);
  });
  it('gradient fields are path independent', () => {
    const a = last('f(x,y) = x^2 y', 'G = gradient f', 'C(t) = (t, t) for t in [0, 1]', 'work G along C').value.value;
    const b = last('f(x,y) = x^2 y', 'G = gradient f', 'C(t) = (t^3, t) for t in [0, 1]', 'work G along C').value.value;
    expect(a).toBeCloseTo(1, 10);
    expect(b).toBeCloseTo(1, 8);
  });
  it('flux across a curve, scalar line integrals, integrate … along', () => {
    expect(last('F(x,y) = <x, y>', 'C(t) = (cos t, sin t)', 'flux F across C').value.value).toBeCloseTo(2 * Math.PI, 10);
    expect(last('C(t) = (cos t, sin t) for t in [0, π]', 'integrate x^2 + y^2 along C').value.value).toBeCloseTo(Math.PI, 10);
    expect(last('F(x,y,z) = <-y, x, 1>', 'H(t) = (cos t, sin t, t) for t in [0, 2π]', 'integrate F along H').value.value).toBeCloseTo(4 * Math.PI, 9);
  });
  it('field × curve sections and their visual', () => {
    const ws = new Workspace(['F(x,y) = <-y, x>', 'C(t) = (cos t, sin t)']);
    const an = new AnalysisService(ws);
    const plan = an.plan()!;
    expect(plan.object).toBe('C');
    an.setSectionOpen(plan, 'field', true);
    an.flushNow();
    expect(ws.sceneItems().some((i) => i.visible && i.visual.vtype === 'lineintegral')).toBe(true);
    ws.setFocus('F');
    const pf = an.plan()!;
    expect(pf.sections.some((s) => s.id === 'around')).toBe(true);
  });
});
