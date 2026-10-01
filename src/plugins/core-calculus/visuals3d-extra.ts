/**
 * 3-D renderers for plane visuals that analyses switch on while the 3-D view is shown: the gradient
 * field (arrows on the floor), the mean-value circle of the Laplacian (on the surface), the Lagrange
 * level-curve sweep (on the floor and at its height on the surface).
 */
import * as THREE from 'three';
import { registerVisual3D, Visual3D, Ctx3D, disposeObject, FatSegments, FatLine } from '../../visualization/3d/registry3d';
import type { SceneItem } from '../../visualization/scene-model';
import type { FunctionValue } from '../../math-core/values';
import { sampleGrid, cachedLevelSet } from '../../visualization/sampling';

class Field2On3D implements Visual3D {
  object = new THREE.Group();
  private segs: FatSegments | null = null;
  private key = '';
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const fn = item.visual.props.fn as FunctionValue;
    const m = ctx.map;
    const key = `${fn.key}|${m.key()}|${item.color}|${selected}`;
    if (key === this.key) return;
    this.key = key;
    const F = fn.eval as (x: number, y: number) => number[];
    const n = 15;
    const cell = (m.xr[1] - m.xr[0]) / n;
    const z = m.floorZ + 5 * m.eps;
    const vals: [number, number, number[]][] = [];
    let maxN = 0;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = m.xr[0] + (i + 0.5) * cell;
        const y = m.yr[0] + (j + 0.5) * ((m.yr[1] - m.yr[0]) / n);
        const v = F(x, y);
        if (!Array.isArray(v) || !v.every(Number.isFinite)) continue;
        maxN = Math.max(maxN, Math.hypot(v[0], v[1]));
        vals.push([x, y, v]);
      }
    const pts: number[] = [];
    for (const [x, y, v] of vals) {
      const len = Math.hypot(v[0], v[1]);
      if (len < 1e-12) continue;
      const L = cell * 0.8 * Math.sqrt(len / (maxN || 1));
      const ux = v[0] / len;
      const uy = v[1] / len;
      const x0 = x - (ux * L) / 2, y0 = y - (uy * L) / 2, x1 = x + (ux * L) / 2, y1 = y + (uy * L) / 2;
      const h = Math.min(L * 0.35, cell * 0.25);
      pts.push(x0, y0, z, x1, y1, z);
      for (const s of [0.45, -0.45]) {
        const a = Math.atan2(uy, ux) + Math.PI + s;
        pts.push(x1, y1, z, x1 + h * Math.cos(a), y1 + h * Math.sin(a), z);
      }
    }
    if (this.segs) this.object.remove(this.segs.lines);
    this.segs = new FatSegments(ctx.lineMaterial(item.color, selected ? 2.2 : 1.6, { opacity: 0.9 }));
    this.segs.set(pts);
    this.object.add(this.segs.lines);
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('field2', () => new Field2On3D());

class MeanCircle3D implements Visual3D {
  object = new THREE.Group();
  private onSurface: FatLine | null = null;
  private onFloor: FatLine | null = null;
  private key = '';
  update(item: SceneItem, ctx: Ctx3D) {
    const { fn, at } = item.visual.props as { fn: FunctionValue; at: number[] };
    const m = ctx.map;
    const key = `${fn.key}|${at}|${m.key()}`;
    if (key === this.key) return;
    this.key = key;
    const f = fn.eval as (x: number, y: number) => number;
    const r = 0.5;
    const up: number[] = [];
    const down: number[] = [];
    const v = new THREE.Vector3();
    for (let k = 0; k <= 96; k++) {
      const x = at[0] + r * Math.cos((2 * Math.PI * k) / 96);
      const y = at[1] + r * Math.sin((2 * Math.PI * k) / 96);
      m.v(x, y, f(x, y), v);
      up.push(v.x, v.y, v.z + 2 * m.eps);
      down.push(x, y, m.floorZ + 5 * m.eps);
    }
    if (!this.onSurface) {
      this.onSurface = new FatLine(ctx.lineMaterial('#c792ea', 2.6));
      this.onFloor = new FatLine(ctx.lineMaterial('#c792ea', 1.4, { dashed: true, opacity: 0.7 }));
      this.object.add(this.onSurface.line, this.onFloor!.line);
    }
    this.onSurface.set(up);
    this.onFloor!.set(down);
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('meancircle', () => new MeanCircle3D());

class LevelSweep3D implements Visual3D {
  object = new THREE.Group();
  private floor: FatSegments | null = null;
  private lifted: FatSegments | null = null;
  private key = '';
  update(item: SceneItem, ctx: Ctx3D) {
    const { fn, from, to, timeline } = item.visual.props as { fn: FunctionValue; from: number; to: number; timeline: string };
    const t = Math.max(0, Math.min(1, ctx.timeline(timeline, 1)));
    const c = from + (to - from) * t;
    const m = ctx.map;
    const key = `${fn.key}|${c.toPrecision(6)}|${m.key()}`;
    if (key === this.key) return;
    this.key = key;
    const s = cachedLevelSet(sampleGrid(fn, m.xr, m.yr, 160), c);
    const f: number[] = [];
    const l: number[] = [];
    const zc = m.z(c) + 2 * m.eps;
    for (let k = 0; k + 3 < s.length; k += 4) {
      f.push(s[k], s[k + 1], m.floorZ + 5 * m.eps, s[k + 2], s[k + 3], m.floorZ + 5 * m.eps);
      l.push(s[k], s[k + 1], zc, s[k + 2], s[k + 3], zc);
    }
    for (const o of [this.floor, this.lifted]) if (o) this.object.remove(o.lines);
    this.floor = new FatSegments(ctx.lineMaterial('#ffd166', 2.2));
    this.lifted = new FatSegments(ctx.lineMaterial('#ffd166', 3));
    this.floor.set(f);
    this.lifted.set(l);
    this.object.add(this.floor.lines, this.lifted.lines);
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('levelsweep', () => new LevelSweep3D());