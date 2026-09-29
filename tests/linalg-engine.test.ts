import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';
import { AnalysisService } from '../src/runtime/analysis';
import { Presentation } from '../src/visualization/presentation';

import '../src/plugins/linear-algebra/lintrans';

beforeAll(() => installMathLab());

function setup(...cells: string[]) {
  const ws = new Workspace(cells);
  const an = new AnalysisService(ws);
  return { ws, an };
}

describe('matrix analysis', () => {
  it('recognises a matrix and picks the layout by shape', () => {
    const two = setup('A = [[2,1],[1,2]]').an.plan()!;
    expect(two.typeLabel).toBe('2×2 matrix');
    expect(two.layout.views.map((v) => v.renderer)).toEqual(['plane']);
    expect(two.layout.timeline).toMatchObject({ key: 'lin:A', stops: ['I', 'A'] });
    const three = setup('B = [[1,2,3],[4,5,6],[7,8,9]]').an.plan()!;
    expect(three.layout.views.map((v) => v.renderer)).toEqual(['scene']);
    const rect = setup('C = [[1,2,3],[4,5,6]]').an.plan()!;
    expect(rect.typeLabel).toContain('ℝ³ → ℝ²');
  });
  it('summary facts are immediate; eigen is lazy', () => {
    const { an } = setup('A = [[2,1],[1,2]]');
    const plan = an.plan()!;
    const det = plan.facts.find((f) => f.id === 'det')!;
    expect((an.fact(plan, det).value as any).value).toBe(3);
    const eig = plan.facts.find((f) => f.id === 'eigen')!;
    expect(an.fact(plan, eig).status).toBe('idle');
    an.setSectionOpen(plan, 'eigen', true);
    an.flushNow();
    expect((an.fact(plan, eig).value as any).pairs.map((p: any) => p.re)).toEqual([3, 1]);
  });
  it('the transformation is always drawn; eigen-lines only when Eigen is open', () => {
    const { ws, an } = setup('A = [[2,1],[1,2]]');
    const plan = an.plan()!;
    const vis = () => ws.sceneItems().filter((i) => i.visible).map((i) => i.visual.vtype).sort();
    expect(vis()).toEqual(['lintrans']);
    an.setSectionOpen(plan, 'eigen', true);
    an.flushNow();
    expect(vis()).toEqual(['eigenlines', 'lintrans']);
  });
  it('tracks a vector and offers to add one', () => {
    const withV = setup('A = [[2,1],[1,2]]', 'v = <1, 2> draggable', 'w = A v');
    withV.ws.setFocus('A');
    const t = withV.an.plan()!.facts.find((f) => f.id === 'transformation')!;
    expect(t.expr).toBe('transformation(A, v)');
    const none = setup('A = [[2,1],[1,2]]').an.plan()!;
    expect(none.sections.find((s) => s.id === 'vectors')!.actions![0].rows).toEqual(['v = <1, 2> draggable', 'w = A v']);
  });
  it('editing a matrix takes the focus from a function', () => {
    const { ws } = setup('f(x) = x^2', 'A = [[1,0],[0,1]]');
    ws.setFocus('f');
    ws.setCellSource(ws.cells[1].id, 'A = [[3,0],[0,1]]', true);
    ws.flush();
    expect(ws.focus).toBe('A');
  });
  it('dragging î rewrites the matrix source', () => {
    const { ws } = setup('A = [[2,1],[1,2]]');
    ws.solveFor('A', [3, 0.5], (v: any) => v.rows.map((r: number[]) => r[0]));
    ws.flushRewrites();
    expect(ws.cells[0].source).toBe('A = [[3, 1], [0.5, 2]]');
  });
  it('pinned eigen objects are indexable subspaces', () => {
    const { ws } = setup('A = [[2,1],[1,2]]', 'E = eigen A', 'L = E[2]');
    expect((ws.value('L') as any).basis).toEqual([[-1, 1]]);
  });
});

describe('timelines', () => {
  it('play, scrub and autoplay with drag hold', () => {
    const ws = new Workspace(['A = [[2,1],[1,2]]']);
    const pres = new Presentation(ws);
    expect(pres.timeline('lin:A')).toBe(1);
    pres.autoplay('lin:A', 'sig1', 1);
    expect(pres.timelineState('lin:A')!.playing).toBe(true);
    pres.tick(1000);
    pres.tick(1000 + 700);
    const mid = pres.timeline('lin:A');
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    pres.tick(1000 + 5000);
    expect(pres.timeline('lin:A')).toBe(1);
    pres.setTimeline('lin:A', 0.25);
    expect(pres.timeline('lin:A')).toBe(0.25);
    pres.holdTimeline('lin:A', 1);
    pres.autoplay('lin:A', 'sig2', 1);
    expect(pres.timelineState('lin:A')!.playing).toBe(false);
    expect(pres.timeline('lin:A')).toBe(1);
  });
  it('stepped timelines ease each step', () => {
    const ws = new Workspace(['A = [[2,0],[0,1]]', 'B = [[0,-1],[1,0]]', 'transformation(A, B)']);
    const item = ws.sceneItems().find((i) => i.visual.vtype === 'lintrans')!;
    expect(item.visual.props.stops).toEqual(['I', 'B', 'AB']);
    expect(item.visual.props.stages).toEqual([[[0, -1], [1, 0]], [[0, -2], [1, 0]]]);
  });
});

describe('subspaces, vector lists, systems, linear maps', () => {
  it('subspace analyzer', () => {
    const { an, ws } = setup('W = span(<1,0,1>, <0,1,1>, <1,1,2>)');
    const plan = an.plan()!;
    expect(plan.typeLabel).toBe('subspace of ℝ³ · dim 2');
    expect(plan.layout.views[0].renderer).toBe('scene');
    expect(ws.sceneItems().filter((i) => i.visible).map((i) => i.visual.vtype)).toEqual(['subspace']);
  });
  it('vector list analyzer', () => {
    const { an } = setup('S = [<1,2>, <2,4>]');
    const plan = an.plan()!;
    expect(plan.typeLabel).toBe('2 vectors in ℝ²');
    const ind = plan.facts.find((f) => f.id === 'independent')!;
    expect((an.fact(plan, ind).value as any).value).toBe(false);
  });
  it('row picture of a system', () => {
    const { an, ws } = setup('X = solve([[1,1],[1,-1]], <3, 1>)', 'analyze X');
    expect(an.plan()!.typeLabel).toBe('solution set in ℝ²');
    const item = ws.sceneItems().find((i) => i.visual.vtype === 'affine')!;
    expect((item.visual.props.a as any).particular).toEqual([2, 1]);
  });
  it('projection carries its geometry', () => {
    const { ws } = setup('W = span(<1,0,1>, <0,1,1>)', 'project <1, 2, 3> onto W');
    expect(ws.sceneItems().some((i) => i.visual.vtype === 'projection')).toBe(true);
  });
  it('linear map is analysed through its matrix', () => {
    const { an } = setup('T(x,y) = (x + y, 2y)');
    const plan = an.plan()!;
    expect(plan.typeLabel).toBe('linear map ℝ² → ℝ²');
    expect(plan.layout.timeline!.key).toBe('lin:T');
    const m = plan.facts.find((f) => f.id === 'matrix')!;
    expect((an.fact(plan, m).value as any).rows).toEqual([[1, 1], [0, 2]]);
    const t = plan.facts.find((f) => f.id === 'transformation')!;
    expect((an.fact(plan, t).value as any).props.timeline).toBe('lin:T');
  });
  it('nonlinear vector functions are not linear maps', () => {
    const { an } = setup('F(x,y) = (x^2, y)');
    expect(an.plan()).toBeFalsy();
  });
});

describe('stepped decompositions', () => {
  it('diagonalization plays P⁻¹ → D → P and replaces the plain morph', () => {
    const { ws, an } = setup('A = [[2,1],[1,2]]');
    const plan = an.plan()!;
    an.setSectionOpen(plan, 'eigen', true);
    an.toggle(plan, 'diagonalize');
    an.flushNow();
    const items = ws.sceneItems().filter((i) => i.visible && i.visual.vtype === 'lintrans');
    const stepped = items.find((i) => i.visual.props.base === 'A')!;
    expect(stepped.visual.props.stops).toEqual(['I', 'P⁻¹', 'DP⁻¹', 'A']);
    const stages = stepped.visual.props.stages as number[][][];
    expect(stages[2].flat().map((x) => +x.toFixed(9))).toEqual([2, 1, 1, 2]);
  });
  it('SVD stages end at A', () => {
    const { ws, an } = setup('A = [[3,0],[4,5]]');
    const plan = an.plan()!;
    an.setSectionOpen(plan, 'decomp', true);
    an.toggle(plan, 'svd');
    an.flushNow();
    const stepped = ws.sceneItems().find((i) => i.visible && i.visual.props.base === 'A')!;
    expect(stepped.visual.props.stops).toEqual(['I', 'Vᵀ', 'ΣVᵀ', 'A']);
    const last = (stepped.visual.props.stages as number[][][])[2];
    expect(last.flat().map((x) => +x.toFixed(9) + 0)).toEqual([3, 0, 4, 5]);
  });
  it('the Hessian at a point can be analysed as a matrix', () => {
    const { ws, an } = setup('f(x,y) = x^2 - y^2 + x*y', 'P = point(1, 1) draggable', 'H = hessian f at P');
    ws.setFocus('H');
    const plan = an.plan()!;
    expect(plan.typeLabel).toBe('2×2 matrix');
    const e = plan.facts.find((x) => x.id === 'eigen')!;
    an.setSectionOpen(plan, 'eigen', true);
    an.flushNow();
    expect((an.fact(plan, e).value as any).pairs.map((p: any) => +p.re.toFixed(6))).toEqual([+Math.sqrt(5).toFixed(6), -(+Math.sqrt(5).toFixed(6))]);
  });
});
