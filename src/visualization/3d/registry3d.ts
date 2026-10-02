/**
 * 3D visual registry and the shared context handed to 3D visuals. The WorldMap is the single
 * math → world transform (z is rescaled to fit the box and can be "flattened" to the floor),
 * applied identically to surfaces, planes, curves and arrows so that geometry stays consistent.
 */
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { SceneItem } from '../scene-model';
import type { SceneFrame } from '../sampling';
import type { Theme } from '../theme';
import type { Workspace } from '../../runtime/workspace';

export class WorldMap {
  xr: [number, number] = [-3, 3];
  yr: [number, number] = [-3, 3];
  zLo = -1;
  zHi = 1;
  /** 1 = true heights (rescaled), 0 = everything pressed onto the floor */
  flatten = 1;
  /** true geometry: z is not rescaled (linear maps, subspaces, fields in ℝ³) */
  euclid = false;

  get size() {
    return Math.max(this.xr[1] - this.xr[0], this.yr[1] - this.yr[0]);
  }
  get boxH() {
    return this.euclid ? this.zHi - this.zLo : this.size * 0.62;
  }
  get floorZ() {
    return this.euclid ? this.zLo : -this.boxH / 2;
  }
  get topZ() {
    return this.floorZ + this.boxH * Math.max(this.flatten, 0.001);
  }
  get center(): [number, number] {
    return [(this.xr[0] + this.xr[1]) / 2, (this.yr[0] + this.yr[1]) / 2];
  }
  /** empty space between the floor (projections) and the lowest point of the surface */
  get gap() {
    return this.euclid ? 0 : this.boxH * 0.14;
  }
  /** a tiny lift (against z-fighting) that scales with the scene: 0.001 at the default 6-unit box */
  get eps() {
    return this.size / 6000;
  }
  /** world units per math unit of height */
  get zScale() {
    return this.euclid ? this.flatten : ((this.boxH - this.gap) / (this.zHi - this.zLo || 1)) * this.flatten;
  }
  z(zm: number) {
    return this.floorZ + this.gap * this.flatten + (zm - this.zLo) * this.zScale;
  }
  mathZ(zw: number) {
    return this.zLo + (zw - this.floorZ - this.gap * this.flatten) / (this.zScale || 1e-9);
  }
  v(x: number, y: number, zm: number, out = new THREE.Vector3()) {
    return out.set(x, y, this.z(zm));
  }
  floor(x: number, y: number, out = new THREE.Vector3()) {
    return out.set(x, y, this.floorZ);
  }
  update(frame: SceneFrame) {
    this.xr = frame.xr;
    this.yr = frame.yr;
    this.zLo = frame.zLo;
    this.zHi = frame.zHi;
    this.euclid = !!frame.euclid;
  }
  key() {
    return `${this.xr}|${this.yr}|${this.zLo}|${this.zHi}|${this.flatten}|${this.euclid}`;
  }
}

export interface Ctx3D {
  map: WorldMap;
  frame: SceneFrame;
  theme: Theme;
  ws: Workspace;
  /** clipping planes of the display box */
  clip: THREE.Plane[];
  /** fat-line material factory (keeps resolution in sync) */
  lineMaterial(color: string, width: number, opts?: { dashed?: boolean; opacity?: number; depthTest?: boolean }): LineMaterial;
  /** height of the primary surface (math units), if any */
  surfaceZ(x: number, y: number): number | undefined;
  /** current value of a presentation timeline (animated morphs) */
  timeline(key: string, fallback?: number): number;
}

export interface Handle3D {
  object: THREE.Object3D;
  nodeId: string;
  /** called with the picked domain point while dragging */
  drag(x: number, y: number): void;
  /** points of space: called with the cursor ray and the viewing direction instead of a domain point */
  drag3?(ray: THREE.Ray, view: THREE.Vector3): void;
}

export interface Visual3D {
  object: THREE.Object3D;
  /** selected = highlighted; grow ∈ [0,1] animates appearance (arrows grow from their base) */
  update(item: SceneItem, ctx: Ctx3D, selected: boolean, grow: number): void;
  dispose(): void;
  handles?: Handle3D[];
  /** mesh to raycast when dragging points onto this surface */
  pickTarget?: THREE.Object3D;
}

const factories = new Map<string, () => Visual3D>();
export function registerVisual3D(vtype: string, factory: () => Visual3D) {
  factories.set(vtype, factory);
}
export function createVisual3D(vtype: string): Visual3D | undefined {
  return factories.get(vtype)?.();
}

// ------------------------------------------------------------------ helpers for visuals

/** Set a material's intended opacity; the presentation layer multiplies it by the item's alpha. */
export function setOpacity(m: THREE.Material, opacity: number) {
  m.userData.baseOpacity = opacity;
  m.opacity = opacity;
}

/** Fade a whole visual: multiplies every material's intended opacity by `alpha`. */
export function applyAlpha(o: THREE.Object3D, alpha: number) {
  o.visible = alpha > 0.01;
  if (!o.visible) return;
  o.traverse((c) => {
    const mat = (c as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      const u = m.userData;
      if (u.baseOpacity === undefined) u.baseOpacity = m.opacity;
      if (u.baseTransparent === undefined) u.baseTransparent = m.transparent;
      const t = u.baseTransparent || alpha < 0.999;
      if (t !== m.transparent) {
        m.transparent = t;
        m.needsUpdate = true;
      }
      m.opacity = u.baseOpacity * alpha;
    }
  });
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose?.();
  });
}

/** A fat polyline whose points can be replaced every frame. */
export class FatLine {
  readonly line: Line2;
  private geom = new LineGeometry();
  constructor(material: LineMaterial) {
    this.line = new Line2(this.geom, material);
    this.line.frustumCulled = false;
  }
  set(points: number[]) {
    if (points.length < 6) {
      this.line.visible = false;
      return;
    }
    this.line.visible = true;
    this.geom.dispose();
    this.geom = new LineGeometry();
    this.geom.setPositions(points);
    this.line.geometry = this.geom;
    this.line.computeLineDistances();
  }
  get material() {
    return this.line.material as LineMaterial;
  }
}

/** Fat disjoint segments [x1,y1,z1,x2,y2,z2,...]. */
export class FatSegments {
  readonly lines: LineSegments2;
  private geom = new LineSegmentsGeometry();
  constructor(material: LineMaterial) {
    this.lines = new LineSegments2(this.geom, material);
    this.lines.frustumCulled = false;
  }
  set(points: Float32Array | number[]) {
    if (points.length < 6) {
      this.lines.visible = false;
      return;
    }
    this.lines.visible = true;
    this.geom.dispose();
    this.geom = new LineSegmentsGeometry();
    this.geom.setPositions(points as Float32Array);
    this.lines.geometry = this.geom;
    this.lines.computeLineDistances();
  }
}

/** Thick 3D arrow (cylinder shaft + cone head) between two world points. */
export class Arrow3D {
  readonly group = new THREE.Group();
  private shaft: THREE.Mesh;
  private head: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  constructor(color: string) {
    this.mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05, emissive: color, emissiveIntensity: 0.25 });
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 14), this.mat);
    this.head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 18), this.mat);
    this.group.add(this.shaft, this.head);
  }
  setColor(c: string) {
    this.mat.color.set(c);
    this.mat.emissive.set(c);
  }
  set(from: THREE.Vector3, to: THREE.Vector3, radius: number) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    this.group.visible = len > 1e-6;
    if (!this.group.visible) return;
    dir.normalize();
    const headLen = Math.min(len * 0.45, radius * 7);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.shaft.quaternion.copy(q);
    this.head.quaternion.copy(q);
    this.shaft.scale.set(radius, Math.max(1e-6, len - headLen), radius);
    this.shaft.position.copy(from).addScaledVector(dir, (len - headLen) / 2);
    this.head.scale.set(radius * 2.6, headLen, radius * 2.6);
    this.head.position.copy(from).addScaledVector(dir, len - headLen / 2);
  }
  dispose() {
    disposeObject(this.group);
  }
}

/** Camera-facing text label with a constant on-screen size (never looms when zoomed in). */
export class Label3D {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private text = '';
  private color = '';
  /** height is a fraction of the viewport height */
  constructor(private height = 0.028) {
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true, sizeAttenuation: false });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.renderOrder = 10;
  }
  set(text: string, color: string, italic = true) {
    if (text === this.text && color === this.color) return;
    this.text = text;
    this.color = color;
    const px = 64;
    const font = `${italic ? 'italic ' : ''}${px}px "KaTeX_Math", "Times New Roman", serif`;
    const ctx = this.canvas.getContext('2d')!;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 24;
    if (w !== this.canvas.width || px + 24 !== this.canvas.height) {
      // a resized canvas needs a fresh GPU texture
      this.canvas.width = w;
      this.canvas.height = px + 24;
      this.tex.dispose();
      this.tex = new THREE.CanvasTexture(this.canvas);
      this.tex.colorSpace = THREE.SRGBColorSpace;
      (this.sprite.material as THREE.SpriteMaterial).map = this.tex;
      (this.sprite.material as THREE.SpriteMaterial).needsUpdate = true;
    }
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(10,12,18,0.75)';
    ctx.strokeText(text, 12, this.canvas.height / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, 12, this.canvas.height / 2);
    this.tex.needsUpdate = true;
    this.sprite.scale.set((this.height * w) / this.canvas.height, this.height, 1);
  }
  dispose() {
    this.tex.dispose();
    (this.sprite.material as THREE.Material).dispose();
  }
}