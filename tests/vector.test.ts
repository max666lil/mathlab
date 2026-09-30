import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';
import { AnalysisService } from '../src/runtime/analysis';
import { Presentation } from '../src/visualization/presentation';
import { toText } from '../src/math-core/symbolic/print';
import '../src/plugins/vector-calculus/flow';

beforeAll(() => installMathLab());

function run(...cells: string[]) {
  const ws = new Workspace(cells);
  const sts = ws.statements();
  const node = ws.node(sts[sts.length - 1].id)!;
  if (node.error) throw new Error(node.error.message);
  return node.value as any;
}

describe('vector calculus operators', () => {
  it('div, curl, laplacian (and ∇ notation)', () => {
    expect(toText(run('F(x,y) = <-y, x>', 'div F').expr)).toBe('0');
    expect(toText(run('F(x,y) = <-y, x>', 'curl F').expr)).toBe('2');
    expect(toText(run('F(x,y) = <x^2 y, x y>', '∇·F').expr)).toBe(toText(run('F(x,y) = <x^2 y, x y>', 'div F').expr));
    expect(run('F(x,y,z) = <-y, x, 0>', '∇×F').expr.type).toBe('vec');
    expect(toText(run('F(x,y,z) = <-y, x, 0>', 'curl F').expr)).toBe('<0, 0, 2>');
    expect(toText(run('f(x,y) = x^2 + y^2', '∇²f').expr)).toBe('4');
    expect(toText(run('f(x,y) = x^2 - y^2', 'laplacian f').expr)).toBe('0');
    expect(run('F(x,y) = <x y, y>', 'P = point(1, 2)', 'jacobian(F) at P').rows).toEqual([[2, 1], [0, 1]]);
  });
  it('potential of a gradient field', () => {
    const phi = run('F(x,y) = <2x, -2y>', 'potential F');
    expect(phi.eval(3, 1)).toBeCloseTo(8, 9);
    expect(phi.certainty).toBe('exact');
    const phi3 = run('F(x,y,z) = <y z, x z, x y>', 'potential F');
    expect(phi3.eval(1, 2, 3)).toBeCloseTo(6, 9);
    expect(() => run('F(x,y) = <-y, x>', 'potential F')).toThrow(/not conservative/);
  });
  it('conservative: rotation no (exact), gradient yes (exact), vortex no (evidence)', () => {
    const rot = run('F(x,y) = <-y, x>', 'conservative F');
    expect([rot.value, rot.certainty]).toEqual([false, 'exact']);
    const grad = run('f(x,y) = x^2 - y^2', 'G = gradient f', 'conservative G');
    expect([grad.value, grad.certainty]).toEqual([true, 'exact']);
    const vortex = run('F(x,y) = <-y/(x^2 + y^2), x/(x^2 + y^2)>', 'conservative F');
    expect([vortex.value, vortex.certainty]).toEqual([false, 'heuristic']);
    expect(vortex.reason).toContain('6.283');
  });
  it('equilibria are classified by the Jacobian', () => {
    const s = run('F(x,y) = <y, -x - y>', 'equilibria F');
    expect(s.points.map((p: any) => [p.coords, p.type])).toEqual([[[0, 0], 'stable spiral']]);
    expect(run('F(x,y) = <x, -y>', 'equilibria F').points[0].type).toBe('saddle');
    expect(run('F(x,y) = <-y, x>', 'equilibria F').points[0].type).toBe('center');
    expect(run('F(x,y) = <x, y>', 'equilibria F').points[0].type).toBe('unstable node');
  });
});

describe('vector field analysis', () => {
  const setup = (...cells: string[]) => {
    const ws = new Workspace(cells);
    return { ws, an: new AnalysisService(ws) };
  };
  it('angle brackets → vector field; parentheses → linear map', () => {
    expect(setup('F(x,y) = <-y, x>').an.plan()!.typeLabel).toBe('vector field ℝ² → ℝ²');
    expect(setup('T(x,y) = (-y, x)').an.plan()!.typeLabel).toBe('linear map ℝ² → ℝ²');
    expect(setup('F(x,y,z) = <-y, x, z>').an.plan()!.layout.views[0].renderer).toBe('scene');
    const g = setup('f(x,y) = x^2 - y^2', 'G = gradient f', 'analyze G').an;
    expect(g.plan()!.typeLabel).toBe('vector field ℝ² → ℝ²');
  });
  it('arrows by default; flow and local pictures only when opened', () => {
    const { ws, an } = setup('F(x,y) = <-y, x>', 'P = point(1, 0.5) draggable');
    ws.setFocus('F');
    const plan = an.plan()!;
    const vis = () => ws.sceneItems().filter((i) => i.visible).map((i) => i.visual.vtype).sort();
    expect(vis()).toEqual(['field2', 'point']);
    an.setSectionOpen(plan, 'flow', true);
    an.setSectionOpen(plan, 'at', true);
    an.flushNow();
    expect(vis()).toEqual(['field2', 'fluxbox', 'paddle', 'particles', 'point', 'streamlines']);
    const curlP = plan.facts.find((f) => f.id === 'curlP')!;
    expect((an.fact(plan, curlP).value as any).value).toBe(2);
  });
  it('scalar fields show the Laplacian', () => {
    const { an } = setup('f(x,y) = x^2 + 3y^2');
    const plan = an.plan()!;
    const L = plan.facts.find((f) => f.id === 'laplacian')!;
    expect(toText((an.fact(plan, L).value as any).expr)).toBe('8');
  });
  it('loop timelines keep counting while playing', () => {
    const ws = new Workspace(['F(x,y) = <-y, x>']);
    const pres = new Presentation(ws);
    pres.playLoop('flow:F', 2);
    pres.tick(1000);
    pres.tick(1000 + 5000);
    expect(pres.timeline('flow:F', 0)).toBeCloseTo(2.5, 6);
    pres.pauseTimeline('flow:F');
    pres.tick(9000);
    expect(pres.timeline('flow:F', 0)).toBeCloseTo(2.5, 6);
  });
});