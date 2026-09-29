import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import '../src/plugins/core-calculus/modes';
import { Workspace } from '../src/runtime/workspace';
import { Presentation } from '../src/visualization/presentation';
import { flagship } from '../src/examples';

beforeAll(() => installMathLab());

let clock = 0;
function settle(p: Presentation) {
  for (let i = 0; i < 200; i++) p.tick((clock += 16));
}

function alphaOf(ws: Workspace, p: Presentation, pred: (vtype: string, role?: string) => boolean) {
  const it = ws.sceneItems().find((i) => pred(i.visual.vtype, i.visual.role));
  return it ? p.style(it.id).alpha : undefined;
}

describe('presentation', () => {
  it('modes reuse the same objects and only change visibility', () => {
    const ws = new Workspace(flagship.cells);
    const p = new Presentation(ws);
    const count = ws.sceneItems().length;
    for (const [mode, visible, hidden] of [
      ['surface', ['surface', 'contours', 'point'], ['arrow', 'plane', 'slice', 'hessian_axes']],
      ['gradient', ['surface', 'point', 'level'], ['plane', 'slice', 'quadratic']],
      ['directional', ['point'], ['level', 'hessian_axes']],
      ['local', ['plane', 'quadratic', 'hessian_axes'], ['contours', 'level']],
    ] as const) {
      ws.setMode(mode);
      settle(p);
      expect(ws.sceneItems().length).toBe(count);
      for (const v of visible) expect(alphaOf(ws, p, (t) => t === v), `${mode}:${v}`).toBeGreaterThan(0.2);
      for (const h of hidden) expect(alphaOf(ws, p, (t) => t === h), `${mode}:${h}`).toBe(0);
    }
  });

  it('directional mode focuses u and its slice, keeps the gradient as context', () => {
    const ws = new Workspace(flagship.cells);
    const p = new Presentation(ws);
    ws.setMode('directional');
    settle(p);
    expect(alphaOf(ws, p, (t, r) => t === 'arrow' && r === 'direction')).toBe(1);
    expect(alphaOf(ws, p, (t, r) => t === 'slice' && r === 'slice-dir')).toBe(1);
    expect(alphaOf(ws, p, (t, r) => t === 'arrow' && r === 'gradient')).toBeCloseTo(0.3);
    expect(p.annotation('angle')).toBe(1);
  });

  it('emphasis highlights every representation of an object and dims the rest', () => {
    const ws = new Workspace(flagship.cells);
    const p = new Presentation(ws);
    ws.setMode('all');
    ws.setEmphasis({ keys: ['u'], source: 'test' });
    settle(p);
    const u = ws.sceneItems().find((i) => i.visual.vtype === 'arrow' && i.visual.role === 'direction')!;
    const uSlice = ws.sceneItems().find((i) => i.visual.role === 'slice-dir')!;
    const level = ws.sceneItems().find((i) => i.visual.vtype === 'level')!;
    expect(p.style(u.id).highlight).toBe(true);
    expect(p.style(uSlice.id).highlight).toBe(true);
    expect(p.style(level.id).alpha).toBeLessThan(0.5);
    // gradient emphasis brings out the level curve it is perpendicular to
    ws.setEmphasis({ keys: ['role:gradient'], isolate: true, source: 'test' });
    settle(p);
    expect(p.style(level.id).highlight).toBe(true);
    expect(p.style(uSlice.id).alpha).toBeLessThan(0.1);
  });

  it('selecting a point does not dim the scene', () => {
    const ws = new Workspace(flagship.cells);
    const p = new Presentation(ws);
    ws.select('P');
    settle(p);
    expect(alphaOf(ws, p, (t, r) => t === 'arrow' && r === 'gradient')).toBe(1);
  });
});