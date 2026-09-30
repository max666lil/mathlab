import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';
import { AnalysisService } from '../src/runtime/analysis';
import { frameFromItems } from '../src/visualization/sampling';
import '../src/plugins/core-calculus/graphing';

beforeAll(() => installMathLab());

const value = (ws: Workspace, i: number) => {
  const n = ws.node(ws.statements()[i].id)!;
  if (n.error) throw new Error(n.error.message);
  return n.value as any;
};

describe('graphing calculator layer', () => {
  it('calculator functions', () => {
    const ws = new Workspace(['10!', '4.5!', 'nCr(5, 2)', 'nPr(5, 2)', 'gcd(12, 18)', 'lcm(4, 6)', 'mean([1, 2, 3, 10])', 'median([3, 1, 2])', 'stdev([2, 4, 4, 4, 5, 5, 7, 9])', 'mod(7, 3)']);
    expect(value(ws, 0).value).toBe(3628800);
    expect(value(ws, 1).value).toBeCloseTo(52.34277778455352, 8);
    expect([2, 3, 4, 5, 6, 7, 9].map((i) => value(ws, i).value)).toEqual([10, 20, 6, 12, 4, 2, 1]);
    expect(value(ws, 8).value).toBeCloseTo(2.138, 3);
  });
  it('implicit curves, regions and named regions', () => {
    const ws = new Workspace(['x^2 + y^2 = 9', 'y < x^2', 'R = x^2 + y^2 <= 1', '2 + 2 = 4', 'x^2 + y^2 >= 4']);
    expect(value(ws, 0).kind).toBe('relation');
    expect(value(ws, 0).rel).toBe('=');
    expect(value(ws, 1).rel).toBe('<');
    expect(value(ws, 2).rel).toBe('<=');
    expect(value(ws, 2).fn.eval(0.5, 0.5)).toBeCloseTo(-0.5, 12);
    expect(value(ws, 3)).toMatchObject({ kind: 'bool', value: true });
    expect(value(ws, 4).rel).toBe('>=');
    const types = ws.sceneItems().map((i) => i.visual.vtype).sort();
    expect(types).toEqual(['implicit', 'region', 'region', 'region']);
  });
  it('parametric and polar curves are drawn', () => {
    const ws = new Workspace(['c(t) = (cos(t), sin(2t))', 'r = 1 + cos(θ)', '(cos(t), sin(t))']);
    new AnalysisService(ws); // the focused curve c is drawn by its analysis
    expect(value(ws, 1).role).toBe('polar');
    expect(ws.sceneItems().map((i) => i.visual.vtype)).toEqual(['curve', 'curve', 'curve']);
  });
  it('all functions of one variable share the graph; intersections on demand', () => {
    const ws = new Workspace(['f(x) = x^2', 'g(x) = x + 2']);
    const an = new AnalysisService(ws);
    const plan = an.plan()!;
    expect(plan.object).toBe('g');
    expect(ws.sceneItems().filter((i) => i.visible && i.visual.vtype === 'graph1d')).toHaveLength(2);
    an.setSectionOpen(plan, 'intersections', true);
    an.flushNow();
    const meet = plan.facts.find((f) => f.id === 'meet:f')!;
    expect((an.fact(plan, meet).value as any).points.map((p: any) => p.coords[0])).toEqual([-1, 2]);
  });
  it('graph frame keeps one scale when curves are shown', () => {
    const ws = new Workspace(['f(x) = x^2', 'x^2 + y^2 = 4']);
    const frame = frameFromItems(ws.sceneItems(), ws.value('f'));
    expect(frame.equal).toBe(true);
  });
  it('3-D domain window of a surface', () => {
    const ws = new Workspace(['f(x,y) = x y']);
    ws.setWindow3d('f', { xr: [-10, 10], yr: [-5, 5] });
    const frame = frameFromItems(ws.sceneItems(), ws.value('f'), ws.window3d.get('f'));
    expect([frame.xr, frame.yr]).toEqual([[-10, 10], [-5, 5]]);
    // a new document starts with the default domain (the window must not leak into another f)
    ws.loadDocument(['f(x,y) = sin(x) cos(y)']);
    expect(ws.window3d.get('f')).toBeUndefined();
  });
});