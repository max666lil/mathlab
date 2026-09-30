import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';
import { Presentation } from '../src/visualization/presentation';
import { flagship } from '../src/examples';

beforeAll(() => installMathLab());

let clock = 0;
function settle(p: Presentation) {
  for (let i = 0; i < 200; i++) p.tick((clock += 16));
}

describe('presentation', () => {
  it('emphasis highlights every representation of an object and dims the rest', () => {
    const ws = new Workspace(flagship.cells);
    const p = new Presentation(ws);
    ws.setEmphasis({ keys: ['u'], source: 'test' });
    settle(p);
    const u = ws.sceneItems().find((i) => i.visual.vtype === 'arrow' && i.visual.role === 'direction')!;
    const uSlice = ws.sceneItems().find((i) => i.visual.role === 'slice-dir')!;
    const level = ws.sceneItems().find((i) => i.visual.vtype === 'level')!;
    expect(p.style(u.id).highlight).toBe(true);
    expect(p.style(uSlice.id).highlight).toBe(true);
    expect(p.style(level.id).alpha).toBeLessThan(0.5);
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
    const g = ws.sceneItems().find((i) => i.visual.vtype === 'arrow' && i.visual.role === 'gradient')!;
    expect(p.style(g.id).alpha).toBe(1);
  });

  it('hidden notebook items stay hidden', () => {
    const ws = new Workspace(flagship.cells);
    const p = new Presentation(ws);
    settle(p);
    const q = ws.sceneItems().find((i) => i.visual.vtype === 'quadratic')!;
    expect(p.style(q.id).alpha).toBe(0);
  });
});