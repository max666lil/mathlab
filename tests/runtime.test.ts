import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';
import { Graph } from '../src/runtime/graph';
import { flagship, examples } from '../src/examples';

beforeAll(() => installMathLab());

const vals = (ws: Workspace, id: string) => ws.value(id) as any;

describe('graph', () => {
  it('recomputes only descendants', () => {
    const g = new Graph<number>();
    let bCount = 0;
    g.define([
      { id: 'a', deps: [], compute: () => 1, input: true },
      { id: 'b', deps: [], compute: () => (bCount++, 10) },
      { id: 'c', deps: ['a', 'b'], compute: (get) => get('a') + get('b') },
    ]);
    expect(g.value('c')).toBe(11);
    g.setInput('a', 5);
    expect(g.value('c')).toBe(15);
    expect(bCount).toBe(1);
  });
  it('redefinition reuses unchanged nodes and recomputes changed ones and their dependents', () => {
    const g = new Graph<number>();
    const count: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    const defs = (aVal: number) => [
      { id: 'a', deps: [], sig: `a=${aVal}`, compute: () => (count.a++, aVal) },
      { id: 'b', deps: [], sig: 'b=10', compute: () => (count.b++, 10) },
      { id: 'c', deps: ['a'], sig: 'c=a+1', compute: (get: (id: string) => number) => (count.c++, get('a') + 1) },
      { id: 'd', deps: ['b'], sig: 'd=b*2', volatile: true, compute: (get: (id: string) => number) => (count.d++, get('b') * 2) },
    ];
    g.define(defs(1));
    g.define(defs(1));
    expect(count).toEqual({ a: 1, b: 1, c: 1, d: 2 });
    g.define(defs(5));
    expect(count).toEqual({ a: 2, b: 1, c: 2, d: 3 });
    expect(g.value('c')).toBe(6);
  });
  it('reports cycles', () => {
    const g = new Graph<number>();
    g.define([
      { id: 'a', deps: ['b'], compute: (get) => get('b') },
      { id: 'b', deps: ['a'], compute: (get) => get('a') },
    ]);
    expect(g.get('a')!.error!.message).toMatch(/Circular/);
  });
});

describe('flagship scene', () => {
  it('evaluates the gradient lab', () => {
    const ws = new Workspace(flagship.cells);
    for (const s of ws.statements()) expect(ws.node(s.id)?.error?.message ?? null, s.id).toBeNull();
    expect(vals(ws, 'g').comps).toEqual([2, 4]);
    expect(vals(ws, 'g').anchor).toEqual([1, 1]);
    expect(vals(ws, 'H').rows).toEqual([[2, 0], [0, 4]]);
    expect(vals(ws, 'D').value).toBeCloseTo(2 * Math.cos(0.6) + 4 * Math.sin(0.6));
    const kinds = ws.sceneItems().map((i) => i.visual.vtype);
    for (const k of ['surface', 'contours', 'point', 'arrow', 'plane', 'level', 'slice', 'hessian_axes', 'path', 'quadratic']) expect(kinds).toContain(k);
    expect(ws.sceneItems().find((i) => i.visual.vtype === 'quadratic')!.visible).toBe(false);
  });

  it('dragging P updates dependents and rewrites the source', () => {
    const ws = new Workspace(flagship.cells);
    const surfaceFn = ws.sceneItems().find((i) => i.visual.vtype === 'surface')!.visual.props.fn;
    ws.setPoint('P', [2, -0.5]);
    expect(vals(ws, 'g').comps).toEqual([4, -2]);
    const plane = ws.sceneItems().find((i) => i.visual.vtype === 'plane')!.visual.props.plane as any;
    expect(plane.point).toEqual([2, -0.5, 4.5]);
    expect(ws.sceneItems().find((i) => i.visual.vtype === 'surface')!.visual.props.fn).toBe(surfaceFn);
    ws.flushRewrites();
    expect(ws.cells[1].source).toContain('P = point(2, -0.5) draggable');
    ws.setCellSource(ws.cells[1].id, 'P = point(0, 1) draggable', true);
    ws.flush();
    expect(vals(ws, 'g').comps).toEqual([0, 4]);
  });

  it('editing f updates everything', () => {
    const ws = new Workspace(flagship.cells);
    ws.setCellSource(ws.cells[0].id, 'f(x,y) = x^2 - y^2');
    ws.flush();
    expect(vals(ws, 'g').comps).toEqual([2, -2]);
    expect(vals(ws, 'H').rows).toEqual([[2, 0], [0, -2]]);
  });

  it('solves θ when the tip of u is dragged', () => {
    const ws = new Workspace(flagship.cells);
    ws.solveFor('u', [0, 1], (v: any) => v.comps);
    expect(vals(ws, 'θ').value).toBeCloseTo(Math.PI / 2, 3);
    ws.flushRewrites();
    expect(ws.cells[2].source).toMatch(/θ = slider\(0, 2π, 1\.57\d\)/);
  });

  it('slider changes propagate', () => {
    const ws = new Workspace(flagship.cells);
    ws.setSlider('θ', 0);
    expect(vals(ws, 'D').value).toBeCloseTo(2);
  });
});

describe('language', () => {
  const run = (cells: string[]) => new Workspace(cells);
  it('parameters, lifting, derivative notation', () => {
    const ws = run(['a = slider(-2, 2, 1.5)', 'f(x,y) = a x^2 + y', 'g(x) = sin(x)', "m = g'(0)", 'k = f_x(1, 0)', 'h = x^2 + y^2', 'q = h(1,2)']);
    expect(vals(ws, 'm').value).toBeCloseTo(1);
    expect(vals(ws, 'k').value).toBeCloseTo(3);
    expect(vals(ws, 'q').value).toBe(5);
  });
  it('reports errors with spans', () => {
    const ws = run(['f(x,y) = x + w']);
    const d = ws.diagnostics(ws.cells[0].id);
    expect(d[0].message).toMatch(/Unknown name 'w'/);
    expect(d[0].from).toBe(13);
  });
  it('vector algebra', () => {
    const ws = run(['v = <3, 4>', 'n = norm(v)', 'w = normalize(v)', 'A = [[2,1],[0,1]]', 'Av = A*v', 'd = det(A)']);
    expect(vals(ws, 'n').value).toBe(5);
    expect(vals(ws, 'Av').comps).toEqual([10, 4]);
    expect(vals(ws, 'd').value).toBe(2);
  });
  it('all examples evaluate without errors', () => {
    for (const ex of examples) {
      const ws = run(ex.cells);
      // R blocks run in webR, in the browser only: here they are still waiting for R
      for (const s of ws.statements()) {
        const msg = ws.node(s.id)?.error?.message ?? null;
        expect(msg && /waiting for R|^R:/.test(msg) ? null : msg, `${ex.id}:${s.id}`).toBeNull();
      }
    }
  });
});
