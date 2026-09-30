/** 3-D visuals of parametric surfaces: the mesh with its u/v grid, normals, and flux arrows. */
import * as THREE from 'three';
import { registerVisual3D, Visual3D, Ctx3D, disposeObject, FatSegments, setOpacity, Arrow3D } from '../../visualization/3d/registry3d';
import type { SceneItem } from '../../visualization/scene-model';
import type { FunctionValue } from '../../math-core/values';
import { registerFrameHint } from '../../visualization/sampling';
import { surfaceRanges } from '../../math-core/ranges';

type S2 = (u: number, v: number) => number[];

function samples(S: FunctionValue, n: number) {
  const [[u0, u1], [v0, v1]] = surfaceRanges(S);
  const f = S.eval as S2;
  const pts: number[][][] = [];
  for (let i = 0; i <= n; i++) {
    const row: number[][] = [];
    for (let j = 0; j <= n; j++) row.push(f(u0 + ((u1 - u0) * i) / n, v0 + ((v1 - v0) * j) / n));
    pts.push(row);
  }
  return { pts, u: [u0, u1], v: [v0, v1] };
}

registerFrameHint('psurface', (props) => {
  const S = props.S as FunctionValue;
  let m = 1;
  for (const row of samples(S, 12).pts) for (const p of row) for (const c of p) if (Number.isFinite(c)) m = Math.max(m, Math.abs(c));
  return { r: Math.min(60, Math.max(1.5, Math.ceil(m * 1.3 * 2) / 2)), dim: 3 };
});

class ParamSurface implements Visual3D {
  object = new THREE.Group();
  private mesh: THREE.Mesh;
  private grid: FatSegments | null = null;
  private key = '';
  constructor() {
    const mat = new THREE.MeshStandardMaterial({ color: '#5b8cff', side: THREE.DoubleSide, roughness: 0.55, metalness: 0.05, transparent: true, opacity: 0.82, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    setOpacity(mat, 0.82);
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.object.add(this.mesh);
  }
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const S = item.visual.props.S as FunctionValue;
    const key = `${S.key}|${ctx.map.key()}|${selected}`;
    if (key === this.key) return;
    this.key = key;
    const n = 64;
    const { pts } = samples(S, n);
    const m = ctx.map;
    const pos = new Float32Array((n + 1) * (n + 1) * 3);
    const col = new Float32Array((n + 1) * (n + 1) * 3);
    const c = new THREE.Color();
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) {
        const k = i * (n + 1) + j;
        const p = pts[i][j];
        const w = m.v(p[0], p[1], p[2]);
        pos.set([w.x, w.y, w.z], k * 3);
        // colour by the parameters so the u/v directions are visible
        c.setHSL(0.58 + 0.12 * (i / n), 0.55, 0.42 + 0.18 * (j / n));
        col.set([c.r, c.g, c.b], k * 3);
      }
    const idx: number[] = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const a = i * (n + 1) + j;
        const ok = [a, a + 1, a + n + 1, a + n + 2].every((q) => Number.isFinite(pos[q * 3] + pos[q * 3 + 1] + pos[q * 3 + 2]));
        if (ok) idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    (this.mesh.material as THREE.MeshStandardMaterial).vertexColors = true;
    (this.mesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
    // u/v grid lines
    const seg: number[] = [];
    const every = 8;
    for (let i = 0; i <= n; i += every)
      for (let j = 0; j < n; j++) seg.push(...pos.subarray((i * (n + 1) + j) * 3, (i * (n + 1) + j) * 3 + 3), ...pos.subarray((i * (n + 1) + j + 1) * 3, (i * (n + 1) + j + 1) * 3 + 3));
    for (let j = 0; j <= n; j += every)
      for (let i = 0; i < n; i++) seg.push(...pos.subarray((i * (n + 1) + j) * 3, (i * (n + 1) + j) * 3 + 3), ...pos.subarray(((i + 1) * (n + 1) + j) * 3, ((i + 1) * (n + 1) + j) * 3 + 3));
    if (this.grid) this.object.remove(this.grid.lines);
    this.grid = new FatSegments(ctx.lineMaterial(ctx.theme.name === 'dark' ? '#e6e8ef' : '#1b1e28', selected ? 1.4 : 1, { opacity: 0.35 }));
    this.grid.set(seg);
    this.object.add(this.grid.lines);
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('psurface', () => new ParamSurface());

/** Arrows on a grid of the surface: normals (orientation) or the field coloured by F·n (flux). */
class SurfaceArrows implements Visual3D {
  object = new THREE.Group();
  private arrows: Arrow3D[] = [];
  update(item: SceneItem, ctx: Ctx3D) {
    const props = item.visual.props as { S: FunctionValue; N?: FunctionValue; F?: FunctionValue; sign?: number };
    const S = props.S;
    const f = S.eval as S2;
    const [[u0, u1], [v0, v1]] = surfaceRanges(S);
    const m = ctx.map;
    const k = 7;
    let idx = 0;
    const h = 1e-5;
    for (let i = 0; i < k; i++)
      for (let j = 0; j < k; j++) {
        const u = u0 + ((u1 - u0) * (i + 0.5)) / k;
        const v = v0 + ((v1 - v0) * (j + 0.5)) / k;
        const p = f(u, v);
        const pu = f(u + h, v).map((c, q) => (c - p[q]) / h);
        const pv = f(u, v + h).map((c, q) => (c - p[q]) / h);
        const sg = props.sign ?? 1;
        const n = [pu[1] * pv[2] - pu[2] * pv[1], pu[2] * pv[0] - pu[0] * pv[2], pu[0] * pv[1] - pu[1] * pv[0]].map((c) => c * sg);
        const nl = Math.hypot(...n) || 1;
        let vec: number[];
        let color: string;
        if (props.F) {
          const F = (props.F.eval as (...a: number[]) => number[])(p[0], p[1], p[2]);
          const dot = (F[0] * n[0] + F[1] * n[1] + F[2] * n[2]) / nl;
          const fl = Math.hypot(...F) || 1;
          vec = F.map((c) => (c / fl) * m.size * 0.08);
          color = dot >= 0 ? '#52d69b' : '#ff6b6b';
        } else {
          vec = n.map((c) => (c / nl) * m.size * 0.08);
          color = '#ffd166';
        }
        if (!this.arrows[idx]) {
          this.arrows[idx] = new Arrow3D(color);
          this.object.add(this.arrows[idx].group);
        }
        const A = this.arrows[idx++];
        A.setColor(color);
        A.set(m.v(p[0], p[1], p[2]), m.v(p[0] + vec[0], p[1] + vec[1], p[2] + vec[2]), m.size * 0.0035);
        A.group.visible = true;
      }
    for (let q = idx; q < this.arrows.length; q++) this.arrows[q].group.visible = false;
  }
  dispose() {
    this.arrows.forEach((a) => a.dispose());
    disposeObject(this.object);
  }
}
registerVisual3D('normals', () => new SurfaceArrows());
registerVisual3D('fluxarrows', () => new SurfaceArrows());