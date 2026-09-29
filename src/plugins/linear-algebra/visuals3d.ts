/**
 * 3-D visuals of linear algebra (Euclidean frame: math coordinates = world coordinates).
 * The lattice and the unit cube are static geometry under a group matrix M(t), so the whole
 * space deforms continuously — 3Blue1Brown style. Arrows are rebuilt so they keep their thickness.
 */
import * as THREE from 'three';
import { registerVisual3D, Visual3D, Ctx3D, disposeObject, setOpacity, FatSegments, FatLine, Arrow3D, Label3D } from '../../visualization/3d/registry3d';
import type { SceneItem } from '../../visualization/scene-model';
import { formatNumber } from '../../math-core/symbolic/print';
import { LinTransProps, matrixAt, apply } from './lintrans';
import type { EigenValue, SubspaceValue } from './values';
import { LA_COLORS } from './draw2d';

const V3 = (v: number[]) => new THREE.Vector3(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
const O = new THREE.Vector3();

function mat4(M: number[][]): THREE.Matrix4 {
  const g = (i: number, j: number) => M[i]?.[j] ?? 0;
  return new THREE.Matrix4().set(g(0, 0), g(0, 1), g(0, 2), 0, g(1, 0), g(1, 1), g(1, 2), 0, g(2, 0), g(2, 1), g(2, 2), 0, 0, 0, 0, 1);
}

const det3 = (M: number[][]) =>
  M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);

class LinTrans3D implements Visual3D {
  object = new THREE.Group();
  private morph = new THREE.Group();
  private lattice: FatSegments | null = null;
  private axes: FatSegments | null = null;
  private cube: THREE.Mesh;
  private cubeEdges: THREE.LineSegments;
  private basis = [new Arrow3D(LA_COLORS.i), new Arrow3D(LA_COLORS.j), new Arrow3D(LA_COLORS.k)];
  private basisLabels = [new Label3D(0.03), new Label3D(0.03), new Label3D(0.03)];
  private vecs: { arrow: Arrow3D; label: Label3D }[] = [];
  private detLabel = new Label3D(0.024);
  private latticeKey = '';

  constructor() {
    this.morph.matrixAutoUpdate = false;
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
    const mat = new THREE.MeshBasicMaterial({ color: LA_COLORS.cell, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    setOpacity(mat, 0.22);
    this.cube = new THREE.Mesh(box, mat);
    this.cubeEdges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: LA_COLORS.cell, transparent: true, opacity: 0.9 }));
    this.morph.add(this.cube, this.cubeEdges);
    this.object.add(this.morph, ...this.basis.map((b) => b.group), ...this.basisLabels.map((l) => l.sprite), this.detLabel.sprite);
  }

  private buildLattice(ctx: Ctx3D, k: number) {
    const key = `${k}|${ctx.theme.name}`;
    if (key === this.latticeKey) return;
    this.latticeKey = key;
    if (this.lattice) this.morph.remove(this.lattice.lines);
    if (this.axes) this.morph.remove(this.axes.lines);
    const pts: number[] = [];
    const ax: number[] = [];
    for (let a = -k; a <= k; a++)
      for (let b = -k; b <= k; b++) {
        const seg = (p: number[], q: number[]) => (a === 0 && b === 0 ? ax : pts).push(...p, ...q);
        seg([-k, a, b], [k, a, b]);
        seg([a, -k, b], [a, k, b]);
        seg([a, b, -k], [a, b, k]);
      }
    this.lattice = new FatSegments(ctx.lineMaterial(LA_COLORS.grid, 1, { opacity: 0.32 }));
    this.lattice.set(pts);
    this.axes = new FatSegments(ctx.lineMaterial(LA_COLORS.axis, 2, { opacity: 0.9 }));
    this.axes.set(ax);
    this.morph.add(this.lattice.lines, this.axes.lines);
  }

  update(item: SceneItem, ctx: Ctx3D) {
    const p = item.visual.props as unknown as LinTransProps;
    if (p.n !== 3) {
      this.object.visible = false;
      return;
    }
    this.object.visible = true;
    this.buildLattice(ctx, 1);
    const end = p.stages.length;
    const t = ctx.timeline(p.timeline, end);
    const M = matrixAt(p, t);
    this.morph.matrix.copy(mat4(M));
    this.morph.matrixWorldNeedsUpdate = true;
    const r = ctx.map.size * 0.006;
    const names = ['î', 'ĵ', 'k̂'];
    const colors = [LA_COLORS.i, LA_COLORS.j, LA_COLORS.k];
    for (let c = 0; c < 3; c++) {
      const tip = V3(M.map((row) => row[c]));
      this.basis[c].set(O, tip, r);
      this.basisLabels[c].set(names[c], colors[c]);
      this.basisLabels[c].sprite.position.copy(tip).multiplyScalar(1.12);
    }
    const d = det3(M);
    this.detLabel.set(`volume × ${Math.abs(d) < 5e-4 ? '0' : formatNumber(Math.abs(d), 3)}${d < -5e-4 ? ' (flipped)' : ''}`, LA_COLORS.cell, false);
    this.detLabel.sprite.position.copy(V3(apply(M, [0.5, 0.5, 0.5])));
    while (this.vecs.length < p.vectors.length) {
      const v = { arrow: new Arrow3D(LA_COLORS.vector), label: new Label3D(0.028) };
      this.vecs.push(v);
      this.object.add(v.arrow.group, v.label.sprite);
    }
    this.vecs.forEach((v, i) => {
      const tv = p.vectors[i];
      v.arrow.group.visible = !!tv;
      v.label.sprite.visible = !!tv;
      if (!tv) return;
      const w = V3(apply(M, tv.comps));
      v.arrow.set(O, w, r * 0.9);
      v.label.set(t < end / 2 ? tv.label : `${p.name}${tv.label}`, LA_COLORS.vector);
      v.label.sprite.position.copy(w).multiplyScalar(1.1);
    });
  }
  dispose() {
    this.basis.forEach((b) => b.dispose());
    this.basisLabels.forEach((l) => l.dispose());
    this.vecs.forEach((v) => (v.arrow.dispose(), v.label.dispose()));
    this.detLabel.dispose();
    disposeObject(this.object);
  }
}
registerVisual3D('lintrans', () => new LinTrans3D());

/** Points / arrows along a direction, carried by M(t). */
class EigenLines3D implements Visual3D {
  object = new THREE.Group();
  private lines: FatLine[] = [];
  private arrows: Arrow3D[] = [];
  private labels: Label3D[] = [];
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const { e, timeline } = item.visual.props as { e: EigenValue; timeline?: string };
    if (e.n !== 3 || !e.matrix) {
      this.object.visible = false;
      return;
    }
    this.object.visible = true;
    const M = matrixAt({ stages: [e.matrix], n: 3 } as unknown as LinTransProps, timeline ? ctx.timeline(timeline, 1) : 1);
    const R = ctx.map.size;
    const dirs = e.pairs.filter((p) => p.im === 0).flatMap((p) => p.basis.map((b) => ({ b, l: p.re })));
    let li = 0;
    let ai = 0;
    dirs.forEach(({ b, l }) => {
      const u = V3(b).normalize();
      if (!this.lines[li]) {
        this.lines[li] = new FatLine(ctx.lineMaterial(item.color, 1.6, { dashed: true, opacity: 0.9 }));
        this.object.add(this.lines[li].line);
        this.labels[li] = new Label3D(0.024);
        this.object.add(this.labels[li].sprite);
      }
      this.lines[li].material.linewidth = selected ? 2.4 : 1.6;
      this.lines[li].set([-u.x * R, -u.y * R, -u.z * R, u.x * R, u.y * R, u.z * R]);
      for (const s of [-1.5, 1.5]) {
        if (!this.arrows[ai]) {
          this.arrows[ai] = new Arrow3D(item.color);
          this.object.add(this.arrows[ai].group);
        }
        this.arrows[ai].setColor(item.color);
        this.arrows[ai].set(O, V3(apply(M, [u.x * s, u.y * s, u.z * s])), ctx.map.size * 0.004);
        ai++;
      }
      this.labels[li].set(`λ = ${formatNumber(l, 3)}`, item.color, false);
      this.labels[li].sprite.position.copy(V3(apply(M, [u.x * 1.5, u.y * 1.5, u.z * 1.5]))).multiplyScalar(1.12);
      li++;
    });
    this.lines.forEach((x, i) => (x.line.visible = i < li));
    this.labels.forEach((x, i) => (x.sprite.visible = i < li));
    this.arrows.forEach((x, i) => (x.group.visible = i < ai));
  }
  dispose() {
    this.arrows.forEach((a) => a.dispose());
    this.labels.forEach((l) => l.dispose());
    disposeObject(this.object);
  }
}
registerVisual3D('eigenlines', () => new EigenLines3D());

/** A subspace through the origin: point, line or translucent plane; the null space collapses with M(t). */
class Subspace3D implements Visual3D {
  object = new THREE.Group();
  private line: FatLine | null = null;
  private plane: THREE.Mesh | null = null;
  private dots: THREE.InstancedMesh | null = null;
  private label = new Label3D(0.024);
  constructor() {
    this.object.add(this.label.sprite);
  }
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const { s, timeline } = item.visual.props as { s: SubspaceValue; timeline?: string };
    if (s.ambient !== 3 || s.basis.length >= 3) {
      this.object.visible = false;
      return;
    }
    this.object.visible = true;
    const R = ctx.map.size * 0.36;
    const color = item.color;
    const carried = s.role === 'nullspace' && s.matrix && timeline;
    const M = carried ? matrixAt({ stages: [s.matrix!], n: 3 } as unknown as LinTransProps, ctx.timeline(timeline!, 1)) : null;
    const gen = s.basis.map((b) => V3(b));
    // orthonormal spanning vectors for drawing
    const u = gen[0]?.clone().normalize();
    const w = gen[1] ? gen[1].clone().sub(u!.clone().multiplyScalar(gen[1].dot(u!))).normalize() : undefined;
    if (!this.dots) {
      this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color }), 200);
      this.object.add(this.dots);
    }
    (this.dots.material as THREE.MeshBasicMaterial).color.set(color);
    let count = 0;
    const put = (v: number[]) => {
      if (count >= 200) return;
      const m = new THREE.Matrix4().makeScale(ctx.map.size * 0.008, ctx.map.size * 0.008, ctx.map.size * 0.008).setPosition(V3(M ? apply(M, v) : v));
      this.dots!.setMatrixAt(count++, m);
    };
    if (!u) put([0, 0, 0]);
    if (u && !w) {
      if (!this.line) {
        this.line = new FatLine(ctx.lineMaterial(color, 2.2, { opacity: 0.9 }));
        this.object.add(this.line.line);
      }
      this.line.material.color.set(color);
      this.line.material.linewidth = selected ? 3 : 2.2;
      const a = M ? V3(apply(M, [u.x * R, u.y * R, u.z * R])) : u.clone().multiplyScalar(R);
      this.line.set([-a.x, -a.y, -a.z, a.x, a.y, a.z]);
      this.line.line.visible = true;
      if (M) for (let k = -8; k <= 8; k++) put([(u.x * k * R) / 8, (u.y * k * R) / 8, (u.z * k * R) / 8]);
    } else if (this.line) this.line.line.visible = false;
    if (u && w) {
      if (!this.plane) {
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false });
        setOpacity(mat, 0.13);
        this.plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
        this.plane.matrixAutoUpdate = false;
        this.object.add(this.plane);
      }
      (this.plane.material as THREE.MeshBasicMaterial).color.set(color);
      const n = u.clone().cross(w);
      const basis = new THREE.Matrix4().makeBasis(u.clone().multiplyScalar(R), w.clone().multiplyScalar(R), n);
      this.plane.matrix.copy(M ? mat4(M).multiply(basis) : basis);
      this.plane.visible = true;
      if (M) for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) put([(u.x * a + w.x * b) * R / 3, (u.y * a + w.y * b) * R / 3, (u.z * a + w.z * b) * R / 3]);
    } else if (this.plane) this.plane.visible = false;
    this.dots.count = count;
    this.dots.instanceMatrix.needsUpdate = true;
    const tag = s.role === 'nullspace' ? 'null space' : s.role === 'colspace' ? 'column space' : s.what;
    this.label.set(tag, color, false);
    const at = u ? (M ? V3(apply(M, [u.x * R, u.y * R, u.z * R])) : u.clone().multiplyScalar(R)) : new THREE.Vector3();
    this.label.sprite.position.copy(at.lengthSq() > 1e-6 ? at.multiplyScalar(1.05) : new THREE.Vector3(0, 0, ctx.map.size * 0.05));
  }
  dispose() {
    this.label.dispose();
    disposeObject(this.object);
  }
}
registerVisual3D('subspace', () => new Subspace3D());

// ---------------------------------------------------------------- projections, coordinates, solution sets

class Projection3D implements Visual3D {
  object = new THREE.Group();
  private v = new Arrow3D(LA_COLORS.axis);
  private residual: FatLine | null = null;
  private label = new Label3D(0.026);
  constructor() {
    this.object.add(this.v.group, this.label.sprite);
  }
  update(item: SceneItem, ctx: Ctx3D) {
    const { v, p } = item.visual.props as { v: number[]; p: number[] };
    this.object.visible = v.length === 3;
    if (v.length !== 3) return;
    this.v.set(O, V3(v), ctx.map.size * 0.007);
    if (!this.residual) {
      this.residual = new FatLine(ctx.lineMaterial(LA_COLORS.nullspace, 1.8, { dashed: true }));
      this.object.add(this.residual.line);
    }
    this.residual.set([...p, ...v]);
    this.label.set('v', LA_COLORS.axis);
    this.label.sprite.position.copy(V3(v).multiplyScalar(1.08));
  }
  dispose() {
    this.v.dispose();
    this.label.dispose();
    disposeObject(this.object);
  }
}
registerVisual3D('projection', () => new Projection3D());

class Coords3D implements Visual3D {
  object = new THREE.Group();
  private legs = [new Arrow3D(LA_COLORS.i), new Arrow3D(LA_COLORS.j), new Arrow3D(LA_COLORS.k)];
  constructor() {
    this.object.add(...this.legs.map((l) => l.group));
  }
  update(item: SceneItem, ctx: Ctx3D) {
    const { c, basis } = item.visual.props as { c: number[]; basis: number[][] };
    this.object.visible = basis[0]?.length === 3;
    if (!this.object.visible) return;
    let at = new THREE.Vector3();
    this.legs.forEach((leg, i) => {
      leg.group.visible = i < basis.length;
      if (i >= basis.length) return;
      const next = at.clone().add(V3(basis[i]).multiplyScalar(c[i]));
      leg.set(at, next, ctx.map.size * 0.004);
      at = next;
    });
  }
  dispose() {
    this.legs.forEach((l) => l.dispose());
    disposeObject(this.object);
  }
}
registerVisual3D('coords', () => new Coords3D());

/** Row picture of a 3-variable system: one translucent plane per equation, the solution set highlighted. */
class Affine3D implements Visual3D {
  object = new THREE.Group();
  private planes: THREE.Mesh[] = [];
  private dot: THREE.Mesh;
  private line: FatLine | null = null;
  constructor() {
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: '#ff8fab' }));
    this.object.add(this.dot);
  }
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const s = item.visual.props.a as import('./values').AffineValue;
    this.object.visible = s.ambient === 3;
    if (!this.object.visible) return;
    const R = ctx.map.size * 0.5;
    const COLORS = ['#4cc9f0', '#f4a261', '#52d69b', '#c77dff'];
    const rows = s.system?.A ?? [];
    rows.forEach((row, i) => {
      if (!this.planes[i]) {
        const mat = new THREE.MeshBasicMaterial({ color: COLORS[i % 4], transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
        setOpacity(mat, 0.16);
        this.planes[i] = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, 2 * R), mat);
        this.object.add(this.planes[i]);
      }
      const n = V3(row);
      const len = n.length();
      const pl = this.planes[i];
      pl.visible = len > 1e-9;
      if (!pl.visible) return;
      n.divideScalar(len);
      pl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      pl.position.copy(n.clone().multiplyScalar(s.system!.b[i] / len));
    });
    this.planes.forEach((p, i) => (p.visible = p.visible && i < rows.length));
    const ok = s.consistent && s.particular;
    this.dot.visible = !!ok && s.directions.length === 0;
    if (ok && s.directions.length === 0) {
      this.dot.position.copy(V3(s.particular!));
      this.dot.scale.setScalar(ctx.map.size * (selected ? 0.014 : 0.011));
    }
    if (ok && s.directions.length === 1) {
      if (!this.line) {
        this.line = new FatLine(ctx.lineMaterial(item.color, 3));
        this.object.add(this.line.line);
      }
      const d = V3(s.directions[0]).normalize().multiplyScalar(R * 2);
      const p = V3(s.particular!);
      this.line.set([p.x - d.x, p.y - d.y, p.z - d.z, p.x + d.x, p.y + d.y, p.z + d.z]);
      this.line.line.visible = true;
    } else if (this.line) this.line.line.visible = false;
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('affine', () => new Affine3D());
