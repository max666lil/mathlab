import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';
import { AnalysisService } from '../src/runtime/analysis';
import { searchCounter } from '../src/plugins/core-calculus/analysis-builtins';

beforeAll(() => installMathLab());

function setup(...cells: string[]) {
  const ws = new Workspace(cells);
  const an = new AnalysisService(ws);
  return { ws, an };
}

describe('analysis engine', () => {
  it('recognises the object without a mode selector', () => {
    expect(setup('f(x) = x^3 - 3x').an.plan()!.typeLabel).toBe('function ℝ → ℝ');
    expect(setup('f(x,y) = x^2 + y^2').an.plan()!.typeLabel).toBe('function ℝ² → ℝ');
    expect(setup('f(x) = x^2', 'C = critical f', 'analyze C').an.plan()!.object).toBe('C');
  });

  it('is lazy: tier-1 facts wait for their section', () => {
    const { ws, an } = setup('f(x,y) = x^3 - 3x + y^2 + 0.1x*y');
    const before = searchCounter.critical ?? 0;
    ws.sceneItems();
    an.flushNow();
    expect(searchCounter.critical ?? 0).toBe(before);
    const plan = an.plan()!;
    const crit = plan.facts.find((f) => f.id === 'critical')!;
    expect(an.fact(plan, crit).status).toBe('idle');
    an.setSectionOpen(plan, 'critical', true);
    expect(an.fact(plan, crit).status).toBe('pending');
    an.flushNow();
    const st = an.fact(plan, crit);
    expect(st.status).toBe('ready');
    expect(st.value!.certainty).toBe('numeric');
    an.fact(plan, crit);
    ws.sceneItems();
    expect(searchCounter.critical).toBe(before + 1);
  });

  it('facts are the same objects the builtins return', () => {
    const { ws, an } = setup('f(x) = x^3 - 3x', 'C = critical f');
    const plan = an.plan()!;
    an.setSectionOpen(plan, 'critical', true);
    an.flushNow();
    const fact = an.fact(plan, plan.facts.find((f) => f.id === 'critical')!).value as any;
    expect(fact.points).toEqual((ws.value('C') as any).points);
    const d = an.fact(plan, plan.facts.find((f) => f.id === 'derivative')!).value!;
    expect(d.certainty).toBe('exact');
    const dom = an.fact(plan, plan.facts.find((f) => f.id === 'domain')!).value!;
    expect(dom.certainty).toBe('exact');
  });

  it('analysis visuals appear without show, and hide removes them', () => {
    const a = setup('f(x,y) = x^2 + 2y^2', 'P = point(1, 1) draggable');
    a.an.flushNow();
    const kinds = a.ws.sceneItems().filter((i) => i.visible).map((i) => i.visual.vtype);
    expect(kinds).toContain('surface');
    expect(kinds).toContain('contours');
    expect(kinds).toContain('arrow');
    const b = setup('f(x,y) = x^2 + 2y^2', 'hide contours');
    expect(b.ws.sceneItems().map((i) => i.visual.vtype)).not.toContain('contours');
    expect(b.ws.sceneItems().map((i) => i.visual.vtype)).toContain('surface');
  });

  it('the analyzer decides the workspace layout (no 3D for f(x))', () => {
    const one = setup('f(x) = sin(x) + x/3', 'a = slider(-5, 5, -2.744)').an.plan()!;
    expect(one.layout.canvasTitle).toBe('Graph');
    expect(one.layout.views.map((v) => v.renderer)).toEqual(['plane']);
    expect(one.sections.find((s) => s.id === 'at')!.why).toBe('tangent-1d');
    const two = setup('f(x,y) = x^2 - y^2').an.plan()!;
    expect(two.layout.views.map((v) => v.renderer)).toEqual(['scene', 'plane']);
    expect(two.layout.combos!.map((c) => c.id)).toEqual(['both']);
    // editing f(x,y) into f(x) switches the workspace
    const { ws, an } = setup('f(x,y) = x^2 - y^2');
    ws.setCellSource(ws.cells[0].id, 'f(x) = x^2', true);
    ws.flush();
    expect(an.plan()!.layout.canvasTitle).toBe('Graph');
    expect(an.plan()!.typeLabel).toBe('function ℝ → ℝ');
  });

  it('1-D facts at a are live objects', () => {
    const { ws, an } = setup('f(x) = sin(x) + x/3', 'a = slider(-5, 5, -2.744)');
    const plan = an.plan()!;
    an.flushNow();
    const slope = an.fact(plan, plan.facts.find((x) => x.id === 'slope-at')!).value as any;
    expect(slope.value).toBeCloseTo(Math.cos(-2.744) + 1 / 3, 10);
    ws.setSlider('a', 0);
    an.flushNow();
    expect((an.fact(an.plan()!, plan.facts.find((x) => x.id === 'slope-at')!).value as any).value).toBeCloseTo(4 / 3, 10);
  });

  it('focus follows the last edited definition', () => {

    const { ws, an } = setup('f(x) = x^2', 'g(x,y) = x*y');
    expect(ws.focus).toBe('g');
    ws.setCellSource(ws.cells[0].id, 'f(x) = x^3', true);
    ws.flush();
    expect(ws.focus).toBe('f');
    expect(an.plan()!.object).toBe('f');
  });
});