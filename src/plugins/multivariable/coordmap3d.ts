/**
 * The picture of a coordinate map of space T(u, v, w) = (x, y, z) (spherical, cylindrical …): the
 * straight (u, v, w) box morphs into its curved image (a cut-away when one coordinate turns all the
 * way round, so the inside shows), one curved cell is highlighted with the three columns of the
 * Jacobian at its corner — their box has volume |det J| Δu Δv Δw, the local volume scale.
 */
import * as THREE from 'three';
import { registerVisual3D, Visual3D, Ctx3D, disposeObject, FatSegments, Arrow3D, Label3D, setOpacity } from '../../visualization/3d/registry3d';
import { registerFrameHint } from '../../visualization/sampling';
import type { SceneItem } from '../../visualization/scene-model';
import type { FunctionValue } from '../../math-core/values';

type Map3 = (u: number, v: number, w: number) => number[];
type Box = [number, number][];
const COLORS = ['#4cc9f0', '#f4a261', '#9b5de5'];

/** Drawn ranges: a coordinate that turns a full circle is cut to three quarters. */
function drawnRanges(ranges: Box): Box {
  return ranges.map(([a, b]) => (b - a >= 2 * Math.PI - 1e-9 ? [a, a + 1.5 * Math.PI] : [a, b]) as [number, number]);
}

const bboxCache = new Map<string, Box>();
function imageBox(fn: FunctionValue, ranges: Box): Box {
  const key = `${fn.key}|${ranges}`;
  const hit = bboxCache.get(key);
  if (hit) return hit;
  const T = fn.eval as Map3;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const n = 8;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++)
      for (let k = 0; k <= n; k++) {
        const q = T(...(ranges.map(([a, b], m) => a + ((b - a) * [i, j, k][m]) / n) as [number, number, number]));
        q.forEach((c, m) => {
          if (Number.isFinite(c)) {
            lo[m] = Math.min(lo[m], c);
            hi[m] = Math.max(hi[m], c);
          }
        });
      }
  const box = lo.map((l, m) => (hi[m] - l < 1e-9 ? [l - 0.5, hi[m] + 0.5] : [l, hi[m]]) as [number, number]);
  if (bboxCache.size > 50) bboxCache.clear();
  bboxCache.set(key, box);
  return box;
}

registerFrameHint('coordmap3', (p) => {
  const box = imageBox(p.fn as FunctionValue, drawnRanges(p.ranges as Box));
  const R = Math.max(...box.flat().map(Math.abs)) * 1.15;
  return { r: Math.max(1, Math.ceil(R * 2) / 2), dim: 3 };
});

class CoordMap3D implements Visual3D {
  object = new THREE.Group();
  private wire: FatSegments[] = [];
  private cellMesh: THREE.Mesh | null = null;
  private cellEdges: FatSegments | null = null;
  private arrows = COLORS.map((c) => new Arrow3D(c));
  private label = new Label3D(0.022);
  private key = '';
  constructor() {
    this.arrows.forEach((a) => this.object.add(a.group));
    this.object.add(this.label.sprite);
  }
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const { fn, ranges: given, timeline, detText } = item.visual.props as { fn: FunctionValue; ranges: Box; timeline: string; detText?: string };
    const s = Math.max(0, Math.min(1, ctx.timeline(timeline, 1)));
    const m = ctx.map;
    const key = `${fn.key}|${s.toFixed(3)}|${m.key()}|${selected}`;
    if (key === this.key) return;
    this.key = key;
    const ranges = drawnRanges(given);
    const box = imageBox(fn, ranges);
    const T = fn.eval as Map3;
    // the straight box (the parameter box stretched onto the image's bounding box) → the image
    const P = (u: number, v: number, w: number): number[] => {
      const q = T(u, v, w);
      const par = [u, v, w].map((t, i) => box[i][0] + ((t - ranges[i][0]) / (ranges[i][1] - ranges[i][0])) * (box[i][1] - box[i][0]));
      return q.map((c, i) => (1 - s) * par[i] + s * c);
    };
    const W = (p: number[], out = new THREE.Vector3()) => m.v(p[0], p[1], p[2], out);
    const at = (idx: number[]) => ranges.map(([a, b], i) => a + (b - a) * idx[i]);
    // coordinate curves on the six faces of the (cut) box
    for (const w of this.wire) this.object.remove(w.lines);
    this.wire = [];
    const N = 6, K = 40;
    const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
    for (let dir = 0; dir < 3; dir++) {
      const pts: number[] = [];
      const [o1, o2] = [0, 1, 2].filter((d) => d !== dir);
      for (let i = 0; i <= N; i++)
        for (let j = 0; j <= N; j++) {
          // only curves lying on the box surface
          if (i !== 0 && i !== N && j !== 0 && j !== N) continue;
          let prev: number[] | null = null;
          for (let k = 0; k <= K; k++) {
            const idx = [0, 0, 0];
            idx[dir] = k / K;
            idx[o1] = i / N;
            idx[o2] = j / N;
            const p = P(...(at(idx) as [number, number, number]));
            if (prev && p.every(Number.isFinite) && prev.every(Number.isFinite)) {
              W(prev, v1);
              W(p, v2);
              pts.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
            }
            prev = p;
          }
        }
      const seg = new FatSegments(ctx.lineMaterial(COLORS[dir], selected ? 1.8 : 1.2, { opacity: 0.75 }));
      seg.set(pts);
      this.wire.push(seg);
      this.object.add(seg.lines);
    }
    // one curved cell: corner at fractions (0.7, 0.35, 0.15) of the box, sides 1/6 of each range
    const c0 = [0.7, 0.35, 0.15], dc = 1 / N;
    const cellPt = (a: number, b: number, c: number) => P(...(at([c0[0] + a * dc, c0[1] + b * dc, c0[2] + c * dc]) as [number, number, number]));
    const pos: number[] = [];
    const G = 6;
    for (let f = 0; f < 6; f++) {
      const fixed = f >> 1, val = f & 1;
      const [a1, a2] = [0, 1, 2].filter((d) => d !== fixed);
      const grid: number[][][] = [];
      for (let i = 0; i <= G; i++) {
        grid.push([]);
        for (let j = 0; j <= G; j++) {
          const t = [0, 0, 0];
          t[fixed] = val;
          t[a1] = i / G;
          t[a2] = j / G;
          grid[i].push(cellPt(t[0], t[1], t[2]));
        }
      }
      for (let i = 0; i < G; i++)
        for (let j = 0; j < G; j++) {
          const q = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
          for (const tri of [[0, 1, 2], [0, 2, 3]]) for (const k of tri) pos.push(...W(q[k], v1).toArray());
        }
    }
    if (this.cellMesh) {
      this.object.remove(this.cellMesh);
      this.cellMesh.geometry.dispose();
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: '#ffd166', transparent: true, side: THREE.DoubleSide, roughness: 0.6, depthWrite: false });
    setOpacity(mat, 0.55);
    this.cellMesh = new THREE.Mesh(geom, mat);
    this.object.add(this.cellMesh);
    // the cell's 12 edges
    const edges: number[] = [];
    for (let dir = 0; dir < 3; dir++) {
      const [o1, o2] = [0, 1, 2].filter((d) => d !== dir);
      for (const a of [0, 1])
        for (const b of [0, 1]) {
          let prev: number[] | null = null;
          for (let k = 0; k <= 12; k++) {
            const t = [0, 0, 0];
            t[dir] = k / 12;
            t[o1] = a;
            t[o2] = b;
            const p = cellPt(t[0], t[1], t[2]);
            if (prev) edges.push(...W(prev, v1).toArray(), ...W(p, v2).toArray());
            prev = p;
          }
        }
    }
    if (this.cellEdges) this.object.remove(this.cellEdges.lines);
    this.cellEdges = new FatSegments(ctx.lineMaterial('#ffd166', 2, { opacity: 0.95 }));
    this.cellEdges.set(edges);
    this.object.add(this.cellEdges.lines);
    // J's columns at the corner, times the cell sides: their box has volume |det J| Δu Δv Δw
    const base = at(c0);
    const steps = ranges.map(([a, b]) => (b - a) * dc);
    const h = 1e-5;
    const cols = [0, 1, 2].map((i) => {
      const up = base.slice(), dn = base.slice();
      up[i] += h;
      dn[i] -= h;
      const a = T(up[0], up[1], up[2]), b = T(dn[0], dn[1], dn[2]);
      return a.map((x, k) => ((x - b[k]) / (2 * h)) * steps[i]);
    });
    const show = s > 0.98;
    const q0 = T(base[0], base[1], base[2]);
    const radius = m.size * 0.006;
    this.arrows.forEach((ar, i) => {
      ar.group.visible = show;
      if (show) ar.set(W(q0, new THREE.Vector3()), W(q0.map((x, k) => x + cols[i][k]), new THREE.Vector3()), radius);
    });
    const det = Math.abs(
      cols[0][0] * (cols[1][1] * cols[2][2] - cols[1][2] * cols[2][1]) - cols[0][1] * (cols[1][0] * cols[2][2] - cols[1][2] * cols[2][0]) + cols[0][2] * (cols[1][0] * cols[2][1] - cols[1][1] * cols[2][0]),
    ) / (steps[0] * steps[1] * steps[2]);
    const [pu, pv, pw] = fn.params;
    const vol = `Δ${pu}Δ${pv}Δ${pw}`;
    const pretty = (t: string) => t.replace(/\^2/g, '²').replace(/\^3/g, '³').replace(/\*/g, '·');
    this.label.set(show ? `ΔV ≈ ${detText ? pretty(detText) : +det.toPrecision(3)}·${vol}` : `ΔV = ${vol}`, '#ffd166', false);
    const top = cellPt(1, 1, 1);
    W(top, this.label.sprite.position);
    this.label.sprite.position.z += m.size * 0.08;
  }
  dispose() {
    this.arrows.forEach((a) => a.dispose());
    this.label.dispose();
    disposeObject(this.object);
  }
}
registerVisual3D('coordmap3', () => new CoordMap3D());