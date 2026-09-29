/**
 * Core 3D visuals for the calculus plugin. Every visual maps math coordinates through the shared
 * WorldMap, so surface, planes, curves and vectors stay geometrically consistent (including
 * during the flatten morph).
 */
import * as THREE from 'three';
import { registerVisual3D, Visual3D, Ctx3D, disposeObject, FatLine, FatSegments, Arrow3D, Label3D, Handle3D } from '../../visualization/3d/registry3d';
import type { SceneItem } from '../../visualization/scene-model';
import { sampleGrid, niceLevels, cachedLevelSet, steepestPath, lineBoxInterval, sliceSamples, Range } from '../../visualization/sampling';
import { colormap, hexToRgb } from '../../visualization/colormap';
import type { FunctionValue, PlaneValue, SliceValue } from '../../math-core/values';
import { formatNumber } from '../../math-core/symbolic/print';
import type { EigenPair } from '../../math-core/linalg';
import { plainLabel } from './draw-util';

type F2 = (x: number, y: number) => number;
const tmpColor = new THREE.Color();

function srgb(r: number, g: number, b: number) {
  return tmpColor.setRGB(r, g, b, THREE.SRGBColorSpace);
}

/** Numerical gradient of the primary surface (generic for any scalar field). */
function surfaceGrad(ctx: Ctx3D, x: number, y: number): [number, number] | undefined {
  const f = ctx.frame.surface?.eval as F2 | undefined;
  if (!f) return undefined;
  const h = 1e-4 * (1 + Math.abs(x) + Math.abs(y));
  const gx = (f(x + h, y) - f(x - h, y)) / (2 * h);
  const gy = (f(x, y + h) - f(x, y - h)) / (2 * h);
  return Number.isFinite(gx + gy) ? [gx, gy] : undefined;
}

// ---------------------------------------------------------------- surface

class SurfaceVisual implements Visual3D {
  object = new THREE.Group();
  private mesh: THREE.Mesh;
  private wire: THREE.LineSegments;
  private mat: THREE.MeshStandardMaterial;
  private key = '';
  pickTarget: THREE.Object3D;

  constructor() {
    this.mat = new THREE.MeshStandardMaterial({
      vertexColors: true, side: THREE.DoubleSide, roughness: 0.62, metalness: 0.02,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.wire = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.16 }));
    this.object.add(this.mesh, this.wire);
    this.pickTarget = this.mesh;
  }

  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const fn = item.visual.props.fn as FunctionValue;
    const xr = (item.visual.props.xRange as Range | undefined) ?? ctx.frame.xr;
    const yr = (item.visual.props.yRange as Range | undefined) ?? ctx.frame.yr;
    this.mat.emissive.set(selected ? 0x222233 : 0x000000);
    this.mat.clippingPlanes = ctx.clip;
    (this.wire.material as THREE.LineBasicMaterial).clippingPlanes = ctx.clip;
    const key = `${fn.key}|${xr}|${yr}|${ctx.map.key()}|${ctx.theme.name}`;
    if (key === this.key) return;
    this.key = key;
    const n = 140;
    const g = sampleGrid(fn, xr, yr, n);
    const W = n + 1;
    const pos = new Float32Array(W * W * 3);
    const col = new Float32Array(W * W * 3);
    const m = ctx.map;
    const rgb: [number, number, number] = [0, 0, 0];
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const k = j * W + i;
        const z = g.z[k];
        const x = xr[0] + ((xr[1] - xr[0]) * i) / n;
        const y = yr[0] + ((yr[1] - yr[0]) * j) / n;
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = Number.isNaN(z) ? m.floorZ : m.z(z);
        colormap((z - m.zLo) / (m.zHi - m.zLo), rgb);
        srgb(rgb[0], rgb[1], rgb[2]);
        col[k * 3] = tmpColor.r;
        col[k * 3 + 1] = tmpColor.g;
        col[k * 3 + 2] = tmpColor.b;
      }
    const idx: number[] = [];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = j * W + i;
        const b = a + 1;
        const c = a + W + 1;
        const d = a + W;
        if (Number.isNaN(g.z[a] + g.z[b] + g.z[c] + g.z[d])) continue;
        idx.push(a, b, c, a, c, d);
      }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geom.setIndex(idx);
    geom.computeVertexNormals();
    this.mesh.geometry.dispose();
    this.mesh.geometry = geom;
    // mesh lines every 10 cells
    const wl: number[] = [];
    const every = 10;
    for (let j = 0; j <= n; j += every)
      for (let i = 0; i < n; i++) {
        const a = j * W + i;
        if (Number.isNaN(g.z[a] + g.z[a + 1])) continue;
        wl.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2] + 0.002, pos[a * 3 + 3], pos[a * 3 + 4], pos[a * 3 + 5] + 0.002);
      }
    for (let i = 0; i <= n; i += every)
      for (let j = 0; j < n; j++) {
        const a = j * W + i;
        const b = a + W;
        if (Number.isNaN(g.z[a] + g.z[b])) continue;
        wl.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2] + 0.002, pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2] + 0.002);
      }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wl, 3));
    this.wire.geometry.dispose();
    this.wire.geometry = wg;
    (this.wire.material as THREE.LineBasicMaterial).color.set(ctx.theme.name === 'dark' ? 0x000000 : 0x000000);
  }

  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('surface', () => new SurfaceVisual());

// ---------------------------------------------------------------- contours (on the surface and on the floor)

class ContoursVisual implements Visual3D {
  object = new THREE.Group();
  private onSurface = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 }));
  private onFloor = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
  private key = '';
  constructor() {
    this.object.add(this.onSurface, this.onFloor);
  }
  update(item: SceneItem, ctx: Ctx3D) {
    const fn = item.visual.props.fn as FunctionValue;
    const count = (item.visual.props.count as number | undefined) ?? 14;
    const m = ctx.map;
    const key = `${fn.key}|${count}|${m.key()}|${ctx.theme.name}`;
    (this.onSurface.material as THREE.Material).clippingPlanes = ctx.clip;
    if (key === this.key) return;
    this.key = key;
    const g = sampleGrid(fn, ctx.frame.xr, ctx.frame.yr, 140);
    const sameAsSurface = ctx.frame.surface?.key === fn.key;
    const [lo, hi] = sameAsSurface ? [m.zLo, m.zHi] : [g.lo, g.hi];
    const s: number[] = [];
    const f: number[] = [];
    const fc: number[] = [];
    const rgb: [number, number, number] = [0, 0, 0];
    const fz = m.floorZ + 0.003;
    for (const level of niceLevels(lo, hi, count)) {
      const seg = cachedLevelSet(g, level);
      const zw = m.z(level) + 0.004;
      colormap((level - lo) / (hi - lo), rgb);
      srgb(Math.min(1, rgb[0] * 1.15), Math.min(1, rgb[1] * 1.15), Math.min(1, rgb[2] * 1.15));
      for (let k = 0; k < seg.length; k += 4) {
        if (sameAsSurface) s.push(seg[k], seg[k + 1], zw, seg[k + 2], seg[k + 3], zw);
        f.push(seg[k], seg[k + 1], fz, seg[k + 2], seg[k + 3], fz);
        fc.push(tmpColor.r, tmpColor.g, tmpColor.b, tmpColor.r, tmpColor.g, tmpColor.b);
      }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(s, 3));
    this.onSurface.geometry.dispose();
    this.onSurface.geometry = sg;
    (this.onSurface.material as THREE.LineBasicMaterial).color.set(ctx.theme.name === 'dark' ? 0xffffff : 0x1b1e28);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(f, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
    this.onFloor.geometry.dispose();
    this.onFloor.geometry = fg;
    this.onFloor.visible = m.flatten > 0.02;
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('contours', () => new ContoursVisual());
// ---------------------------------------------------------------- points (draggable on the surface)

class PointVisual implements Visual3D {
  object = new THREE.Group();
  private sphere: THREE.Mesh;
  private floorDot: THREE.Mesh;
  private stem: THREE.Line;
  private label = new Label3D(0.3);
  private halo: THREE.Mesh;
  handles: Handle3D[] = [];
  constructor() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.3, emissive: 0xffd166, emissiveIntensity: 0.35 });
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
    this.halo = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.18, depthWrite: false }));
    this.floorDot = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.8 }));
    this.stem = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffd166, dashSize: 0.07, gapSize: 0.05, transparent: true, opacity: 0.8 }));
    this.object.add(this.sphere, this.halo, this.floorDot, this.stem, this.label.sprite);
  }
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const { coords, inputId } = item.visual.props as { coords: number[]; inputId?: string };
    const m = ctx.map;
    const [x, y] = coords;
    const zm = coords.length > 2 ? coords[2] : ctx.surfaceZ(x, y);
    const top = zm === undefined ? m.floorZ : Math.min(m.topZ, Math.max(m.floorZ, m.z(zm)));
    const r = m.size * 0.017;
    const color = item.color;
    (this.sphere.material as THREE.MeshStandardMaterial).color.set(color);
    (this.sphere.material as THREE.MeshStandardMaterial).emissive.set(color);
    this.sphere.position.set(x, y, top);
    this.sphere.scale.setScalar(r);
    this.halo.position.copy(this.sphere.position);
    this.halo.scale.setScalar(r * (selected ? 2.6 : 1.9));
    this.floorDot.position.set(x, y, m.floorZ + 0.004);
    this.floorDot.scale.setScalar(r * 0.7);
    this.stem.geometry.setFromPoints([new THREE.Vector3(x, y, top), new THREE.Vector3(x, y, m.floorZ)]);
    this.stem.computeLineDistances();
    this.stem.visible = top - m.floorZ > 1e-3;
    this.label.set(plainLabel(item.visual.label), ctx.theme.name === 'dark' ? '#ffffff' : '#1b1e28');
    this.label.sprite.position.set(x, y, top + r * 3.2);
    this.handles = inputId ? [{ object: this.sphere, nodeId: inputId, drag: (px, py) => ctx.ws.setPoint(inputId, [px, py]) }] : [];
  }
  dispose() {
    this.label.dispose();
    disposeObject(this.object);
  }
}
registerVisual3D('point', () => new PointVisual());

// ---------------------------------------------------------------- vectors: in the domain (floor) and lifted onto the tangent plane

class ArrowVisual implements Visual3D {
  object = new THREE.Group();
  private floor = new Arrow3D('#ffffff');
  private lifted = new Arrow3D('#ffffff');
  private rise: FatLine | null = null;
  private label = new Label3D(0.3);
  constructor() {
    this.object.add(this.floor.group, this.lifted.group, this.label.sprite);
  }
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const { anchor, vec } = item.visual.props as { anchor: number[]; vec: number[] };
    const m = ctx.map;
    const color = item.color;
    const r = m.size * (selected ? 0.0085 : 0.0065);
    this.floor.setColor(color);
    this.lifted.setColor(color);
    if (anchor.length === 3 && vec.length === 3) {
      this.floor.group.visible = false;
      this.lifted.set(m.v(anchor[0], anchor[1], anchor[2]), m.v(anchor[0] + vec[0], anchor[1] + vec[1], anchor[2] + vec[2]), r * 1.3);
      return;
    }
    if (anchor.length !== 2 || vec.length !== 2) {
      this.object.visible = false;
      return;
    }
    this.object.visible = true;
    const [x0, y0] = anchor;
    const fz = m.floorZ + 0.006;
    this.floor.set(new THREE.Vector3(x0, y0, fz), new THREE.Vector3(x0 + vec[0], y0 + vec[1], fz), r);
    // lift onto the tangent plane of the primary surface: rise = ∇f(anchor) · v
    const z0 = ctx.surfaceZ(x0, y0);
    const g = surfaceGrad(ctx, x0, y0);
    let tip: THREE.Vector3;
    if (z0 !== undefined && g && m.flatten > 0.02) {
      const from = m.v(x0, y0, z0);
      tip = m.v(x0 + vec[0], y0 + vec[1], z0 + g[0] * vec[0] + g[1] * vec[1]);
      this.lifted.set(from, tip, r * 1.25);
      this.lifted.group.visible = true;
      if (!this.rise) {
        this.rise = new FatLine(ctx.lineMaterial(color, 1.5, { dashed: true, opacity: 0.8 }));
        this.object.add(this.rise.line);
      }
      this.rise.material.color.set(color);
      this.rise.set([tip.x, tip.y, tip.z, tip.x, tip.y, from.z]);
    } else {
      this.lifted.group.visible = false;
      if (this.rise) this.rise.line.visible = false;
      tip = new THREE.Vector3(x0 + vec[0], y0 + vec[1], fz);
    }
    const text = plainLabel(item.visual.label);
    this.label.sprite.visible = !!text;
    if (text) {
      this.label.set(text, color);
      this.label.sprite.position.copy(tip).add(new THREE.Vector3(0, 0, m.size * 0.035));
    }
  }
  dispose() {
    this.floor.dispose();
    this.lifted.dispose();
    this.label.dispose();
    disposeObject(this.object);
  }
}
registerVisual3D('arrow', () => new ArrowVisual());

// ---------------------------------------------------------------- tangent plane patch

class PlaneVisual implements Visual3D {
  object = new THREE.Group();
  private mesh: THREE.Mesh;
  /** faint pass without depth test: the part hidden under the surface stays readable */
  private ghost: THREE.Mesh;
  private edge: FatLine | null = null;
  private ghostEdge: FatLine | null = null;
  private normal = new Arrow3D('#5b8cff');
  constructor() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x5b8cff, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, roughness: 0.4 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.renderOrder = 2;
    this.ghost = new THREE.Mesh(this.mesh.geometry, new THREE.MeshBasicMaterial({ color: 0x5b8cff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
    this.ghost.renderOrder = 6;
    this.object.add(this.mesh, this.ghost, this.normal.group);
  }
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const p = item.visual.props.plane as PlaneValue;
    const m = ctx.map;
    const [x0, y0, z0] = p.point;
    const [a, b, c] = p.normal;
    if (Math.abs(c) < 1e-12) {
      this.object.visible = false;
      return;
    }
    this.object.visible = m.flatten > 0.02;
    const zAt = (x: number, y: number) => z0 - (a * (x - x0) + b * (y - y0)) / c;
    const R = m.size * 0.16;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => m.v(x0 + u * R, y0 + v * R, zAt(x0 + u * R, y0 + v * R)));
    const geom = new THREE.BufferGeometry().setFromPoints([corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]]);
    geom.computeVertexNormals();
    this.mesh.geometry.dispose();
    this.mesh.geometry = geom;
    this.ghost.geometry = geom;
    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    mat.color.set(item.color);
    mat.opacity = selected ? 0.5 : 0.36;
    mat.clippingPlanes = ctx.clip;
    const gm = this.ghost.material as THREE.MeshBasicMaterial;
    gm.color.set(item.color);
    gm.clippingPlanes = ctx.clip;
    if (!this.edge) {
      this.edge = new FatLine(ctx.lineMaterial(item.color, 2.2));
      this.ghostEdge = new FatLine(ctx.lineMaterial(item.color, 1.2, { dashed: true, opacity: 0.45, depthTest: false }));
      this.ghostEdge.line.renderOrder = 6;
      this.object.add(this.edge.line, this.ghostEdge.line);
    }
    const loop = corners.concat([corners[0]]).flatMap((v) => [v.x, v.y, v.z]);
    this.edge.material.color.set(item.color);
    this.edge.set(loop);
    this.ghostEdge!.material.color.set(item.color);
    this.ghostEdge!.set(loop);
    // normal of the displayed plane (world space, respects the z-scaling)
    const s = m.zScale;
    const nw = new THREE.Vector3(-(-a / c) * s, -(-b / c) * s, 1).normalize();
    const base = m.v(x0, y0, z0);
    this.normal.setColor(item.color);
    this.normal.set(base, base.clone().addScaledVector(nw, m.size * 0.12), m.size * 0.004);
  }
  dispose() {
    this.normal.dispose();
    disposeObject(this.object);
  }
}
registerVisual3D('plane', () => new PlaneVisual());

// ---------------------------------------------------------------- level curve through P

class LevelVisual implements Visual3D {
  object = new THREE.Group();
  private lifted: FatSegments | null = null;
  private floor: FatSegments | null = null;
  private tangent: FatLine | null = null;
  update(item: SceneItem, ctx: Ctx3D) {
    const { fn, at, value, g } = item.visual.props as { fn: FunctionValue; at: number[]; value: number; g: number[] };
    const m = ctx.map;
    if (!this.lifted) {
      this.lifted = new FatSegments(ctx.lineMaterial(item.color, 3));
      this.floor = new FatSegments(ctx.lineMaterial(item.color, 2, { opacity: 0.85 }));
      this.tangent = new FatLine(ctx.lineMaterial(item.color, 2, { dashed: true }));
      this.object.add(this.lifted.lines, this.floor!.lines, this.tangent.line);
    }
    const grid = sampleGrid(fn, ctx.frame.xr, ctx.frame.yr, 140);
    const seg = cachedLevelSet(grid, value);
    const zw = m.z(value) + 0.005;
    const fz = m.floorZ + 0.005;
    const up = new Float32Array((seg.length / 4) * 6);
    const fl = new Float32Array((seg.length / 4) * 6);
    for (let k = 0, o = 0; k < seg.length; k += 4, o += 6) {
      up.set([seg[k], seg[k + 1], zw, seg[k + 2], seg[k + 3], zw], o);
      fl.set([seg[k], seg[k + 1], fz, seg[k + 2], seg[k + 3], fz], o);
    }
    const onSurface = ctx.frame.surface?.key === fn.key && m.flatten > 0.02;
    this.lifted.lines.visible = onSurface;
    if (onSurface) this.lifted.set(up);
    this.floor!.set(fl);
    const gn = Math.hypot(g[0], g[1]);
    if (gn > 1e-9 && onSurface) {
      const t = [-g[1] / gn, g[0] / gn];
      const L = m.size * 0.14;
      this.tangent!.set([at[0] - t[0] * L, at[1] - t[1] * L, zw, at[0] + t[0] * L, at[1] + t[1] * L, zw]);
    } else this.tangent!.line.visible = false;
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('level', () => new LevelVisual());
// ---------------------------------------------------------------- cross-sections

class SliceVisual implements Visual3D {
  object = new THREE.Group();
  private wall: THREE.Mesh;
  private curve: FatLine | null = null;
  private tangent: FatLine | null = null;
  constructor() {
    this.wall = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.wall.renderOrder = 1;
    this.object.add(this.wall);
  }
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const s = item.visual.props.slice as SliceValue;
    const m = ctx.map;
    const iv = lineBoxInterval(s.origin, s.dir, ctx.frame.xr, ctx.frame.yr);
    if (!iv) {
      this.object.visible = false;
      return;
    }
    this.object.visible = true;
    const at = (t: number) => [s.origin[0] + t * s.dir[0], s.origin[1] + t * s.dir[1]];
    const [a, b] = [at(iv[0]), at(iv[1])];
    const top = m.floorZ + m.boxH * Math.max(m.flatten, 0.02);
    const quad = [
      new THREE.Vector3(a[0], a[1], m.floorZ), new THREE.Vector3(b[0], b[1], m.floorZ), new THREE.Vector3(b[0], b[1], top),
      new THREE.Vector3(a[0], a[1], m.floorZ), new THREE.Vector3(b[0], b[1], top), new THREE.Vector3(a[0], a[1], top),
    ];
    this.wall.geometry.dispose();
    this.wall.geometry = new THREE.BufferGeometry().setFromPoints(quad);
    const wm = this.wall.material as THREE.MeshBasicMaterial;
    wm.color.set(item.color);
    wm.opacity = selected ? 0.18 : 0.09;
    if (!this.curve) {
      this.curve = new FatLine(ctx.lineMaterial(item.color, 3.2));
      this.tangent = new FatLine(ctx.lineMaterial(ctx.theme.name === 'dark' ? '#ffffff' : '#1b1e28', 2, { dashed: true }));
      this.object.add(this.curve.line, this.tangent.line);
    }
    this.curve.material.color.set(item.color);
    this.curve.material.linewidth = selected ? 4.5 : 3.2;
    const { t, z } = sliceSamples(s.fn, s.origin, s.dir, iv[0], iv[1], 220);
    const pts: number[] = [];
    for (let k = 0; k < t.length; k++) {
      if (!Number.isFinite(z[k])) continue;
      const [x, y] = at(t[k]);
      pts.push(x, y, m.z(z[k]) + 0.004);
    }
    this.curve.set(pts);
    if (s.marker !== undefined) {
      const f = s.fn.eval as (...a: number[]) => number;
      const val = (tt: number) => f(...at(tt));
      const t0 = s.marker;
      const h = 1e-4;
      const slope = (val(t0 + h) - val(t0 - h)) / (2 * h);
      const z0 = val(t0);
      const span = m.size * 0.16;
      const p0 = at(t0 - span);
      const p1 = at(t0 + span);
      this.tangent!.set([p0[0], p0[1], m.z(z0 - slope * span), p1[0], p1[1], m.z(z0 + slope * span)]);
    } else this.tangent!.line.visible = false;
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('slice', () => new SliceVisual());

// ---------------------------------------------------------------- Hessian principal directions

class HessianAxesVisual implements Visual3D {
  object = new THREE.Group();
  private curves: FatLine[] = [];
  private labels: Label3D[] = [];
  update(item: SceneItem, ctx: Ctx3D) {
    const { fn, at, eig } = item.visual.props as { fn: FunctionValue; at: number[]; eig: EigenPair[] };
    const m = ctx.map;
    const f = fn.eval as F2;
    const R = m.size * 0.16;
    eig.forEach((e, k) => {
      if (!this.curves[k]) {
        this.curves[k] = new FatLine(ctx.lineMaterial(item.color, 3, { dashed: k > 0 }));
        this.labels[k] = new Label3D(0.26);
        this.object.add(this.curves[k].line, this.labels[k].sprite);
      }
      const pts: number[] = [];
      for (let i = 0; i <= 40; i++) {
        const t = -R + (2 * R * i) / 40;
        const x = at[0] + t * e.vector[0];
        const y = at[1] + t * e.vector[1];
        pts.push(x, y, m.z(f(x, y)) + 0.006);
      }
      this.curves[k].material.color.set(item.color);
      this.curves[k].set(pts);
      this.labels[k].set(`λ${k === 0 ? '₁' : '₂'} = ${formatNumber(e.value, 3)}`, item.color, false);
      const n = pts.length - 3;
      this.labels[k].sprite.position.set(pts[n], pts[n + 1], pts[n + 2] + m.size * 0.03);
    });
  }
  dispose() {
    this.labels.forEach((l) => l.dispose());
    disposeObject(this.object);
  }
}
registerVisual3D('hessian_axes', () => new HessianAxesVisual());

// ---------------------------------------------------------------- steepest ascent / descent paths

const pathCache = new Map<string, number[][][]>();

class PathVisual implements Visual3D {
  object = new THREE.Group();
  private lines: FatLine[] = [];
  private floors: FatLine[] = [];
  update(item: SceneItem, ctx: Ctx3D) {
    const { fn, grad, from, mode } = item.visual.props as { fn: FunctionValue; grad: FunctionValue; from: number[]; mode: string };
    const key = `${fn.key}|${from}|${mode}|${ctx.frame.xr}|${ctx.frame.yr}`;
    let paths = pathCache.get(key);
    if (!paths) {
      paths = [];
      if (mode !== 'descent') paths.push(steepestPath(fn, grad, from, 1, ctx.frame.xr, ctx.frame.yr));
      if (mode !== 'ascent') paths.push(steepestPath(fn, grad, from, -1, ctx.frame.xr, ctx.frame.yr));
      if (pathCache.size > 50) pathCache.clear();
      pathCache.set(key, paths);
    }
    const m = ctx.map;
    const f = fn.eval as F2;
    paths.forEach((p, k) => {
      if (!this.lines[k]) {
        this.lines[k] = new FatLine(ctx.lineMaterial(item.color, 3, { dashed: k > 0 }));
        this.floors[k] = new FatLine(ctx.lineMaterial(item.color, 1.5, { dashed: k > 0, opacity: 0.7 }));
        this.object.add(this.lines[k].line, this.floors[k].line);
      }
      this.lines[k].set(p.flatMap(([x, y]) => [x, y, m.z(f(x, y)) + 0.008]));
      this.floors[k].set(p.flatMap(([x, y]) => [x, y, m.floorZ + 0.004]));
      this.lines[k].line.visible = m.flatten > 0.02 && p.length > 1;
    });
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('path', () => new PathVisual());

// ---------------------------------------------------------------- local quadratic approximation

class QuadraticVisual implements Visual3D {
  object = new THREE.Group();
  private mesh: THREE.Mesh;
  private wire: THREE.LineSegments;
  constructor() {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
    this.wire = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6 }));
    this.mesh.renderOrder = 3;
    this.object.add(this.mesh, this.wire);
  }
  update(item: SceneItem, ctx: Ctx3D) {
    const { q, at } = item.visual.props as { q: FunctionValue; at: number[] };
    const m = ctx.map;
    const Q = q.eval as F2;
    const R = m.size * 0.2;
    const n = 24;
    const W = n + 1;
    const pos: number[] = [];
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const x = at[0] - R + (2 * R * i) / n;
        const y = at[1] - R + (2 * R * j) / n;
        pos.push(x, y, m.z(Q(x, y)));
      }
    const idx: number[] = [];
    const wl: number[] = [];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = j * W + i;
        idx.push(a, a + 1, a + W + 1, a, a + W + 1, a + W);
      }
    for (let j = 0; j <= n; j += 4) for (let i = 0; i < n; i++) wl.push(...pos.slice((j * W + i) * 3, (j * W + i) * 3 + 6));
    for (let i = 0; i <= n; i += 4)
      for (let j = 0; j < n; j++) {
        const a = (j * W + i) * 3;
        const b = ((j + 1) * W + i) * 3;
        wl.push(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2]);
      }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.setIndex(idx);
    geom.computeVertexNormals();
    this.mesh.geometry.dispose();
    this.mesh.geometry = geom;
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wl, 3));
    this.wire.geometry.dispose();
    this.wire.geometry = wg;
    const [r, g, b] = hexToRgb(item.color);
    (this.mesh.material as THREE.MeshStandardMaterial).color.setRGB(r, g, b, THREE.SRGBColorSpace);
    (this.wire.material as THREE.LineBasicMaterial).color.setRGB(r, g, b, THREE.SRGBColorSpace);
    (this.mesh.material as THREE.Material).clippingPlanes = ctx.clip;
    (this.wire.material as THREE.Material).clippingPlanes = ctx.clip;
    this.object.visible = m.flatten > 0.02;
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('quadratic', () => new QuadraticVisual());