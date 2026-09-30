/** Drawers for curves: the moving point (velocity, acceleration) and the osculating circle; 3-D motion. */
import * as THREE from 'three';
import { registerDrawer2D } from '../../visualization/2d/registry2d';
import { registerVisual3D, Visual3D, Ctx3D, disposeObject, Arrow3D, Label3D } from '../../visualization/3d/registry3d';
import type { SceneItem } from '../../visualization/scene-model';
import type { FunctionValue } from '../../math-core/values';
import { drawArrow, drawLabel } from '../core-calculus/draw-util';
import { withAlpha } from '../../visualization/colormap';

const V = '#4cc9f0';
const A = '#ff6b6b';
const P = '#ffd166';

interface MotionProps {
  fn: FunctionValue;
  d1: FunctionValue;
  d2: FunctionValue;
  range: [number, number];
  timeline: string;
  n: number;
}

const ev = (f: FunctionValue, t: number) => (f.eval as (t: number) => number[])(t);
const paramAt = (p: MotionProps, cycles: number) => p.range[0] + (cycles - Math.floor(cycles)) * (p.range[1] - p.range[0]);

registerDrawer2D('motion', {
  layer: 7,
  draw(a) {
    const p = a.item.visual.props as unknown as MotionProps;
    if (p.n !== 2) return;
    const t = paramAt(p, a.timeline(p.timeline, 0));
    const r = ev(p.fn, t);
    const v = ev(p.d1, t);
    const w = ev(p.d2, t);
    const { ctx, view, theme } = a;
    const [x, y] = [view.sx(r[0]), view.sy(r[1])];
    drawArrow(ctx, x, y, view.sx(r[0] + v[0]), view.sy(r[1] + v[1]), V, 2.6, 10);
    drawArrow(ctx, x, y, view.sx(r[0] + w[0]), view.sy(r[1] + w[1]), withAlpha(A, 0.9), 2, 9);
    ctx.fillStyle = P;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    drawLabel(ctx, `t = ${t.toFixed(2)}`, x + 10, y - 10, P, theme, 13);
    drawLabel(ctx, "r′", view.sx(r[0] + v[0]) + 6, view.sy(r[1] + v[1]) - 6, V, theme, 13);
    drawLabel(ctx, "r″", view.sx(r[0] + w[0]) + 6, view.sy(r[1] + w[1]) + 12, A, theme, 13);
  },
});

registerDrawer2D('osccircle', {
  layer: 6,
  draw(a) {
    const { center, radius } = a.item.visual.props as { center: number[]; radius: number };
    const { ctx, view } = a;
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = withAlpha(a.item.color, 0.9);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(view.sx(center[0]), view.sy(center[1]), Math.abs(view.sx(center[0] + radius) - view.sx(center[0])), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = a.item.color;
    ctx.beginPath();
    ctx.arc(view.sx(center[0]), view.sy(center[1]), 3, 0, Math.PI * 2);
    ctx.fill();
  },
});

class Motion3D implements Visual3D {
  object = new THREE.Group();
  private dot: THREE.Mesh;
  private v = new Arrow3D(V);
  private w = new Arrow3D(A);
  private label = new Label3D(0.024);
  constructor() {
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: P }));
    this.object.add(this.dot, this.v.group, this.w.group, this.label.sprite);
  }
  update(item: SceneItem, ctx: Ctx3D) {
    const p = item.visual.props as unknown as MotionProps;
    this.object.visible = p.n === 3;
    if (p.n !== 3) return;
    const t = paramAt(p, ctx.timeline(p.timeline, 0));
    const m = ctx.map;
    const r = ev(p.fn, t);
    const v = ev(p.d1, t);
    const w = ev(p.d2, t);
    const R = m.v(r[0], r[1], r[2]);
    this.dot.position.copy(R);
    this.dot.scale.setScalar(m.size * 0.012);
    this.v.set(R, m.v(r[0] + v[0], r[1] + v[1], r[2] + v[2]), m.size * 0.005);
    this.w.set(R, m.v(r[0] + w[0], r[1] + w[1], r[2] + w[2]), m.size * 0.004);
    this.label.set(`t = ${t.toFixed(2)}`, P, false);
    this.label.sprite.position.copy(R).add(new THREE.Vector3(0, 0, m.size * 0.05));
  }
  dispose() {
    this.v.dispose();
    this.w.dispose();
    this.label.dispose();
    disposeObject(this.object);
  }
}
registerVisual3D('motion', () => new Motion3D());