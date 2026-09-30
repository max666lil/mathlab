/** 3-D visuals of vector calculus (Euclidean frame): arrows, streamlines, particles, paddle wheel. */
import * as THREE from 'three';
import { registerVisual3D, Visual3D, Ctx3D, disposeObject, FatSegments, Label3D } from '../../visualization/3d/registry3d';
import type { SceneItem } from '../../visualization/scene-model';
import type { FunctionValue } from '../../math-core/values';
import { formatNumber } from '../../math-core/symbolic/print';
import { streamlines3, particleTracks, trackIndex, flowScale, FIELD_RANGE } from './flow';
import { VC_COLORS } from './draw2d';

class Field3 implements Visual3D {
  object = new THREE.Group();
  private shafts: FatSegments | null = null;
  private heads: THREE.InstancedMesh | null = null;
  private key = '';
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const fn = item.visual.props.fn as FunctionValue;
    const key = `${fn.key}|${item.color}|${selected}`;
    if (key === this.key) return;
    this.key = key;
    disposeObject(this.object);
    this.object.clear();
    const F = fn.eval as (x: number, y: number, z: number) => number[];
    const m = 5;
    const r = FIELD_RANGE * 0.8;
    const cell = (2 * r) / (m - 1);
    const pts: { p: number[]; v: number[]; n: number }[] = [];
    let maxN = 1e-12;
    for (let a = 0; a < m; a++)
      for (let b = 0; b < m; b++)
        for (let c = 0; c < m; c++) {
          const p = [-r + a * cell, -r + b * cell, -r + c * cell];
          const v = F(p[0], p[1], p[2]);
          if (!v.every(Number.isFinite)) continue;
          const n = Math.hypot(...v);
          maxN = Math.max(maxN, n);
          pts.push({ p, v, n });
        }
    const seg: number[] = [];
    this.heads = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 10), new THREE.MeshBasicMaterial({ color: item.color }), pts.length);
    let count = 0;
    for (const { p, v, n } of pts) {
      if (n < 1e-12) continue;
      const len = cell * 0.75 * Math.sqrt(n / maxN);
      const u = new THREE.Vector3(v[0], v[1], v[2]).normalize();
      const a0 = new THREE.Vector3(p[0], p[1], p[2]).addScaledVector(u, -len / 2);
      const a1 = a0.clone().addScaledVector(u, len * 0.72);
      seg.push(a0.x, a0.y, a0.z, a1.x, a1.y, a1.z);
      const head = len * 0.28;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), u);
      const pos = a1.clone().addScaledVector(u, head / 2);
      this.heads.setMatrixAt(count++, new THREE.Matrix4().compose(pos, q, new THREE.Vector3(head * 0.35, head, head * 0.35)));
    }
    this.heads.count = count;
    this.shafts = new FatSegments(ctx.lineMaterial(item.color, selected ? 2.4 : 1.6, { opacity: 0.85 }));
    this.shafts.set(seg);
    this.object.add(this.shafts.lines, this.heads);
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('field3', () => new Field3());

class Streamlines3 implements Visual3D {
  object = new THREE.Group();
  private key = '';
  update(item: SceneItem, ctx: Ctx3D) {
    const { fn, n } = item.visual.props as { fn: FunctionValue; n: number };
    this.object.visible = n === 3;
    if (n !== 3 || fn.key === this.key) return;
    this.key = fn.key;
    disposeObject(this.object);
    this.object.clear();
    const seg: number[] = [];
    for (const l of streamlines3(fn)) for (let i = 0; i + 5 < l.length; i += 3) seg.push(l[i], l[i + 1], l[i + 2], l[i + 3], l[i + 4], l[i + 5]);
    const s = new FatSegments(ctx.lineMaterial(item.color, 1.3, { opacity: 0.7 }));
    s.set(seg);
    this.object.add(s.lines);
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('streamlines', () => new Streamlines3());

class Particles3 implements Visual3D {
  object = new THREE.Group();
  private dots: THREE.InstancedMesh | null = null;
  update(item: SceneItem, ctx: Ctx3D) {
    const { fn, n, timeline } = item.visual.props as { fn: FunctionValue; n: number; timeline: string };
    this.object.visible = n === 3;
    if (n !== 3) return;
    const tr = particleTracks(fn, 260);
    if (!this.dots) {
      this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: VC_COLORS.particle }), tr.paths.length);
      this.object.add(this.dots);
    }
    const t = ctx.timeline(timeline, 0);
    const s = ctx.map.size * 0.006;
    let c = 0;
    const m = new THREE.Matrix4();
    for (let i = 0; i < tr.paths.length; i++) {
      const k = trackIndex(tr, i, t);
      const p = tr.paths[i];
      if (!Number.isFinite(p[k * 3])) continue;
      m.makeScale(s, s, s).setPosition(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
      this.dots.setMatrixAt(c++, m);
    }
    this.dots.count = c;
    this.dots.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('particles', () => new Particles3());

/** A paddle wheel whose axle is the curl direction, spinning at |curl|/2. */
class Paddle3 implements Visual3D {
  object = new THREE.Group();
  private wheel = new THREE.Group();
  private label = new Label3D(0.024);
  constructor() {
    const mat = new THREE.MeshBasicMaterial({ color: VC_COLORS.paddle, side: THREE.DoubleSide });
    for (let k = 0; k < 4; k++) {
      const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.14), mat);
      blade.position.set(0.21 * Math.cos((k * Math.PI) / 2), 0.21 * Math.sin((k * Math.PI) / 2), 0);
      blade.rotation.z = (k * Math.PI) / 2;
      blade.rotateX(Math.PI / 2);
      this.wheel.add(blade);
    }
    this.wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8).rotateX(Math.PI / 2), mat));
    this.object.add(this.wheel, this.label.sprite);
  }
  update(item: SceneItem, ctx: Ctx3D) {
    const { fn, curl, at, n, timeline } = item.visual.props as { fn: FunctionValue; curl: FunctionValue; at: number[]; n: number; timeline: string };
    this.object.visible = n === 3;
    if (n !== 3) return;
    const c = (curl.eval as (...p: number[]) => number[])(...at);
    const len = Math.hypot(...c);
    const axis = len > 1e-9 ? new THREE.Vector3(c[0], c[1], c[2]).normalize() : new THREE.Vector3(0, 0, 1);
    const spin = (len / 2) * flowScale(fn) * ctx.timeline(timeline, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spin));
    this.wheel.quaternion.copy(q);
    this.wheel.position.set(at[0], at[1], at[2]);
    this.label.set(`|curl F| = ${formatNumber(len, 3)}`, VC_COLORS.paddle, false);
    this.label.sprite.position.set(at[0], at[1], at[2] + 0.5);
  }
  dispose() {
    this.label.dispose();
    disposeObject(this.object);
  }
}
registerVisual3D('paddle', () => new Paddle3());