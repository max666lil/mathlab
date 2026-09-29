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

  get size() {
    return Math.max(this.xr[1] - this.xr[0], this.yr[1] - this.yr[0]);
  }
  get boxH() {
    return this.size * 0.62;
  }
  get floorZ() {
    return -this.boxH / 2;
  }
  get topZ() {
    return this.floorZ + this.boxH * Math.max(this.flatten, 0.001);
  }
  get center(): [number, number] {
    return [(this.xr[0] + this.xr[1]) / 2, (this.yr[0] + this.yr[1]) / 2];
  }
  /** world units per math unit of height */
  get zScale() {
    return (this.boxH / (this.zHi - this.zLo || 1)) * this.flatten;
  }
  z(zm: number) {
    return this.floorZ + (zm - this.zLo) * this.zScale;
  }
  mathZ(zw: number) {
    return this.zLo + (zw - this.floorZ) / (this.zScale || 1e-9);
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
  }
  key() {
    return `${this.xr}|${this.yr}|${this.zLo}|${this.zHi}|${this.flatten}`;
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
}

export interface Handle3D {
  object: THREE.Object3D;
  nodeId: string;
  /** called with the picked domain point while dragging */
  drag(x: number, y: number): void;
}

export interface Visual3D {
  object: THREE.Object3D;
  update(item: SceneItem, ctx: Ctx3D, selected: boolean): void;
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

/** Camera-facing text label rendered to a canvas texture. */
export class Label3D {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private text = '';
  private color = '';
  constructor(private heightWorld = 0.28) {
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true });
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
    this.canvas.width = w;
    this.canvas.height = px + 24;
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(10,12,18,0.75)';
    ctx.strokeText(text, 12, this.canvas.height / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, 12, this.canvas.height / 2);
    this.tex.needsUpdate = true;
    this.sprite.scale.set((this.heightWorld * w) / this.canvas.height, this.heightWorld, 1);
  }
  dispose() {
    this.tex.dispose();
    (this.sprite.material as THREE.Material).dispose();
  }
}