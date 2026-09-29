/**
 * The 3D scene view. Framework-free: mount into an element; it mirrors the workspace's scene
 * items into Three.js objects through the visual registry, handles orbiting, point dragging on
 * the surface, linked hover, camera shots and the "flatten to contour map" morph.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { Workspace } from '../../runtime/workspace';
import { frameFromItems, SceneFrame } from '../sampling';
import { getTheme, onThemeChange } from '../theme';
import { WorldMap, Ctx3D, Visual3D, createVisual3D, disposeObject, Label3D, Handle3D } from './registry3d';
import { CameraRig, orbitPosition, ShotName, Pose } from './camera';
import { formatNumber } from '../../math-core/symbolic/print';

import { niceStep } from '../2d/view2d';

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 500);
  readonly controls: OrbitControls;
  readonly rig: CameraRig;
  readonly map = new WorldMap();
  private root = new THREE.Group();
  private staticGroup = new THREE.Group();
  private staticKey = '';
  private visuals = new Map<string, { vtype: string; v: Visual3D }>();
  private lineMats = new Set<LineMaterial>();
  private frame!: SceneFrame;
  private clip: THREE.Plane[] = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)];
  private needsSync = true;
  private needsRender = true;
  private raf = 0;
  private ro: ResizeObserver;
  private unsubs: (() => void)[] = [];
  private raycaster = new THREE.Raycaster();
  private drag: Handle3D | null = null;
  private hoverMarker: THREE.Group;
  private flattenTween: { from: number; to: number; start: number } | null = null;
  private initialShot = false;
  private width = 1;
  private height = 1;
  readonly id = '3d';

  constructor(
    private host: HTMLElement,
    private ws: Workspace,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.className = 'mathlab-canvas';
    host.appendChild(this.renderer.domElement);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(6, -7, 5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.8;
    this.controls.addEventListener('start', () => this.rig.cancel());
    this.rig = new CameraRig(this.camera, this.controls.target);
    this.scene.add(this.root, this.staticGroup);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404060, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, -6, 10);
    const fill = new THREE.DirectionalLight(0x99aaff, 0.5);
    fill.position.set(-6, 5, 3);
    this.scene.add(key, fill);
    this.hoverMarker = this.makeHoverMarker();
    this.scene.add(this.hoverMarker);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    for (const t of ['values', 'view', 'selection'] as const) this.unsubs.push(ws.on(t, () => (this.needsSync = true)));
    this.unsubs.push(ws.on('hover', () => (this.needsRender = true)));
    this.unsubs.push(onThemeChange(() => {
      this.staticKey = '';
      this.needsSync = true;
    }));
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown, true);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointerleave', () => !this.drag && this.ws.hover?.source === this.id && this.ws.setHover(null));
    el.addEventListener('dblclick', () => this.shot('orbit'));
    this.resize();
    this.loop();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.unsubs.forEach((u) => u());
    for (const { v } of this.visuals.values()) v.dispose();
    disposeObject(this.staticGroup);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.domElement.style.width = `${this.width}px`;
    this.renderer.domElement.style.height = `${this.height}px`;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    for (const m of this.lineMats) m.resolution.set(this.width, this.height);
    this.needsRender = true;
  }

  private lineMaterial = (color: string, width: number, opts: { dashed?: boolean; opacity?: number; depthTest?: boolean } = {}) => {
    const m = new LineMaterial({
      color: new THREE.Color(color).getHex(),
      linewidth: width,
      dashed: !!opts.dashed,
      dashSize: 0.12,
      gapSize: 0.08,
      transparent: opts.opacity !== undefined && opts.opacity < 1,
      opacity: opts.opacity ?? 1,
      depthTest: opts.depthTest ?? true,
      clippingPlanes: this.clip,
    });
    m.resolution.set(this.width, this.height);
    this.lineMats.add(m);
    m.addEventListener('dispose', () => this.lineMats.delete(m));
    return m;
  };

  private ctx(): Ctx3D {
    const surf = this.frame.surface?.eval as ((x: number, y: number) => number) | undefined;
    return {
      map: this.map,
      frame: this.frame,
      theme: getTheme(),
      ws: this.ws,
      clip: this.clip,
      lineMaterial: this.lineMaterial,
      surfaceZ: (x, y) => {
        if (!surf) return undefined;
        const z = surf(x, y);
        return Number.isFinite(z) ? z : undefined;
      },
    };
  }
  // ---------------------------------------------------------------- scene synchronisation

  private sync() {
    this.needsSync = false;
    const items = this.ws.sceneItems();
    this.frame = frameFromItems(items);
    this.map.update(this.frame);
    const pad = 1e-3;
    this.clip[0].constant = this.map.topZ + pad + (this.map.flatten < 1 ? 0 : this.map.boxH * 0.02);
    this.clip[1].constant = -(this.map.floorZ - pad);
    const theme = getTheme();
    this.scene.background = new THREE.Color(theme.bg);
    const sk = `${this.map.key()}|${theme.name}`;
    if (sk !== this.staticKey) {
      this.staticKey = sk;
      this.buildStatic();
    }
    const ctx = this.ctx();
    const alive = new Set<string>();
    for (const item of items) {
      if (!item.visible) continue;
      let entry = this.visuals.get(item.id);
      if (entry && entry.vtype !== item.visual.vtype) {
        this.root.remove(entry.v.object);
        entry.v.dispose();
        entry = undefined;
      }
      if (!entry) {
        const v = createVisual3D(item.visual.vtype);
        if (!v) continue;
        entry = { vtype: item.visual.vtype, v };
        this.visuals.set(item.id, entry);
        this.root.add(v.object);
      }
      alive.add(item.id);
      try {
        entry.v.update(item, ctx, this.ws.selection === item.nodeId);
      } catch (e) {
        console.warn(`3D visual ${item.visual.vtype} failed`, e);
      }
    }
    for (const [id, { v }] of this.visuals) {
      if (!alive.has(id)) {
        this.root.remove(v.object);
        v.dispose();
        this.visuals.delete(id);
      }
    }
    if (!this.initialShot) {
      this.initialShot = true;
      this.rig.jump(this.pose('orbit'));
    }
    this.needsRender = true;
  }

  /** Box, floor grid and axis labels (rebuilt when the frame changes). */
  private buildStatic() {
    disposeObject(this.staticGroup);
    this.staticGroup.clear();
    const theme = getTheme();
    const m = this.map;
    const [x0, x1] = m.xr;
    const [y0, y1] = m.yr;
    const fz = m.floorZ - 0.002;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0, y1 - y0),
      new THREE.MeshBasicMaterial({ color: theme.floor, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    floor.position.set((x0 + x1) / 2, (y0 + y1) / 2, fz - 0.002);
    floor.renderOrder = -2;
    this.staticGroup.add(floor);
    const step = niceStep((x1 - x0) / 12);
    const grid: number[] = [];
    for (let x = Math.ceil(x0 / step) * step; x <= x1 + 1e-9; x += step) grid.push(x, y0, fz, x, y1, fz);
    for (let y = Math.ceil(y0 / step) * step; y <= y1 + 1e-9; y += step) grid.push(x0, y, fz, x1, y, fz);
    const gridGeom = new THREE.BufferGeometry();
    gridGeom.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
    const gridColor = theme.name === 'dark' ? 0x2a3040 : 0xd5d9e3;
    this.staticGroup.add(new THREE.LineSegments(gridGeom, new THREE.LineBasicMaterial({ color: gridColor, transparent: true, opacity: 0.8 })));
    // axes through the origin on the floor, if inside the domain
    const axes: number[] = [];
    if (y0 <= 0 && y1 >= 0) axes.push(x0, 0, fz + 0.001, x1, 0, fz + 0.001);
    if (x0 <= 0 && x1 >= 0) axes.push(0, y0, fz + 0.001, 0, y1, fz + 0.001);
    const axGeom = new THREE.BufferGeometry();
    axGeom.setAttribute('position', new THREE.Float32BufferAttribute(axes, 3));
    this.staticGroup.add(new THREE.LineSegments(axGeom, new THREE.LineBasicMaterial({ color: theme.name === 'dark' ? 0x6b7390 : 0x8a90a6 })));
    // box edges
    const top = m.floorZ + m.boxH;
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(x1 - x0, y1 - y0, top - m.floorZ)),
      new THREE.LineBasicMaterial({ color: theme.name === 'dark' ? 0xffffff : 0x1b1e28, transparent: true, opacity: 0.1 }),
    );
    box.position.set((x0 + x1) / 2, (y0 + y1) / 2, (top + m.floorZ) / 2);
    this.staticGroup.add(box);
    const label = (text: string, pos: THREE.Vector3, size = 0.3, italic = true) => {
      const l = new Label3D(size * (m.size / 6));
      l.set(text, theme.name === 'dark' ? '#c9cede' : '#3a3f52', italic);
      l.sprite.position.copy(pos);
      this.staticGroup.add(l.sprite);
    };
    const off = m.size * 0.06;
    label('x', new THREE.Vector3(x1 + off, (y0 + y1) / 2, fz));
    label('y', new THREE.Vector3((x0 + x1) / 2, y1 + off, fz));
    label('z', new THREE.Vector3(x0 - off * 0.6, y1 + off * 0.6, top + off * 0.4));
    label(formatNumber(m.zHi, 3), new THREE.Vector3(x0 - off, y1, top), 0.2, false);
    label(formatNumber(m.zLo, 3), new THREE.Vector3(x0 - off, y1, m.floorZ), 0.2, false);
    for (let x = Math.ceil(x0 / (step * 2)) * step * 2; x <= x1 + 1e-9; x += step * 2) label(formatNumber(x, 3), new THREE.Vector3(x, y0 - off, fz), 0.18, false);
    for (let y = Math.ceil(y0 / (step * 2)) * step * 2; y <= y1 + 1e-9; y += step * 2) label(formatNumber(y, 3), new THREE.Vector3(x1 + off, y, fz), 0.18, false);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (this.flattenTween) {
      const k = Math.min(1, (now - this.flattenTween.start) / 1100);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.map.flatten = this.flattenTween.from + (this.flattenTween.to - this.flattenTween.from) * e;
      if (k >= 1) this.flattenTween = null;
      this.staticKey = '';
      this.needsSync = true;
    }
    if (this.needsSync) this.sync();
    const tweening = this.rig.update(now);
    const moved = this.controls.update();
    if (tweening || moved || this.needsRender) {
      this.needsRender = false;
      this.updateHoverMarker();
      this.renderer.render(this.scene, this.camera);
    }
  };

  // ---------------------------------------------------------------- camera shots

  private focus(): { p: number[]; g: number[] } | null {
    const pointItem = this.ws.sceneItems().find((i) => i.visible && i.visual.vtype === 'point' && i.visual.props.inputId);
    if (!pointItem) return null;
    const p = (pointItem.visual.props.coords as number[]).slice(0, 2);
    const gItem = this.ws.sceneItems().find((i) => i.visual.vtype === 'arrow' && i.visual.role === 'gradient');
    const g = gItem ? (gItem.visual.props.vec as number[]) : [1, 0];
    return { p, g };
  }

  pose(name: ShotName): Pose {
    const m = this.map;
    const [cx, cy] = m.center;
    const mid = new THREE.Vector3(cx, cy, (m.floorZ + m.topZ) / 2);
    const R = m.size * 2.05;
    const fz = this.focus();
    const pz = fz ? (this.ctx().surfaceZ(fz.p[0], fz.p[1]) ?? m.zLo) : 0;
    const P = fz ? m.v(fz.p[0], fz.p[1], pz) : mid.clone();
    switch (name) {
      case 'top':
        return { target: new THREE.Vector3(cx, cy, m.floorZ), position: new THREE.Vector3(cx, cy - 1e-3, m.floorZ + R * 1.25), fov: 34 };
      case 'front':
        return { target: mid, position: orbitPosition(mid, R, 88, -90), fov: 34 };
      case 'side':
        return { target: mid, position: orbitPosition(mid, R, 88, 0), fov: 34 };
      case 'tangent': {
        if (!fz) return this.pose('orbit');
        const gn = Math.hypot(fz.g[0], fz.g[1]);
        const t = gn > 1e-9 ? new THREE.Vector3(-fz.g[1] / gn, fz.g[0] / gn, 0) : new THREE.Vector3(1, 0, 0);
        // choose the side facing the current camera
        if (t.dot(this.camera.position.clone().sub(P)) < 0) t.negate();
        return { target: P, position: P.clone().addScaledVector(t, m.size * 1.1).add(new THREE.Vector3(0, 0, m.size * 0.04)), fov: 30 };
      }
      case 'zoom': {
        const dir = this.camera.position.clone().sub(this.controls.target).normalize();
        return { target: P, position: P.clone().addScaledVector(dir, m.size * 0.3), fov: 34 };
      }
      default:
        return { target: mid, position: orbitPosition(mid, R, 57, -118), fov: 38 };
    }
  }

  shot(name: ShotName) {
    this.rig.goTo(this.pose(name));
  }

  /** Morph the surface flat onto the floor (contour map) and back. */
  setFlatten(flat: boolean) {
    this.flattenTween = { from: this.map.flatten, to: flat ? 0.0001 : 1, start: performance.now() };
  }

  get flattened() {
    return (this.flattenTween?.to ?? this.map.flatten) < 0.5;
  }
  // ---------------------------------------------------------------- interaction

  private ndc(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  /** Domain point under the cursor: primary surface first, then the floor plane. */
  private pickDomain(e: PointerEvent): [number, number] | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const targets: THREE.Object3D[] = [];
    for (const { v } of this.visuals.values()) if (v.pickTarget) targets.push(v.pickTarget);
    const hits = this.raycaster.intersectObjects(targets, false);
    const m = this.map;
    for (const h of hits) {
      const { x, y, z } = h.point;
      if (x >= m.xr[0] && x <= m.xr[1] && y >= m.yr[0] && y <= m.yr[1] && z <= m.topZ + 1e-3 && z >= m.floorZ - 1e-3) return [x, y];
    }
    const floor = new THREE.Plane(new THREE.Vector3(0, 0, 1), -m.floorZ);
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(floor, p) && p.x >= m.xr[0] && p.x <= m.xr[1] && p.y >= m.yr[0] && p.y <= m.yr[1]) return [p.x, p.y];
    return null;
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const handles: Handle3D[] = [];
    for (const { v } of this.visuals.values()) if (v.handles) handles.push(...v.handles.filter((h) => h.object.visible));
    const hits = this.raycaster.intersectObjects(handles.map((h) => h.object), true);
    if (!hits.length) return;
    const hitObj = hits[0].object;
    const h = handles.find((hd) => hd.object === hitObj || hd.object.getObjectById(hitObj.id));
    if (!h) return;
    e.stopPropagation();
    this.drag = h;
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.ws.select(h.nodeId);
  };

  private onMove = (e: PointerEvent) => {
    const d = this.pickDomain(e);
    if (this.drag) {
      if (d) {
        this.drag.drag(d[0], d[1]);
        this.ws.setHover({ x: d[0], y: d[1], source: this.id });
      }
      return;
    }
    if (e.buttons) return;
    if (d) this.ws.setHover({ x: d[0], y: d[1], source: this.id });
    else if (this.ws.hover?.source === this.id) this.ws.setHover(null);
    // cursor feedback over handles
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const objs: THREE.Object3D[] = [];
    for (const { v } of this.visuals.values()) v.handles?.forEach((h) => objs.push(h.object));
    this.renderer.domElement.style.cursor = this.raycaster.intersectObjects(objs, true).length ? 'move' : 'grab';
  };

  private onUp = () => {
    if (this.drag) {
      this.ws.flushRewrites();
      this.drag = null;
      this.controls.enabled = true;
    }
  };

  // ---------------------------------------------------------------- linked hover marker

  private makeHoverMarker() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.18, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
    ring.renderOrder = 20;
    const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0.6 }));
    g.add(ring, stem);
    g.visible = false;
    return g;
  }

  private updateHoverMarker() {
    const h = this.ws.hover;
    const g = this.hoverMarker;
    if (!h || h.source === this.id || !this.frame) {
      g.visible = false;
      return;
    }
    const z = this.ctx().surfaceZ(h.x, h.y);
    const m = this.map;
    const zw = z === undefined ? m.floorZ : Math.min(m.topZ, Math.max(m.floorZ, m.z(z)));
    g.visible = true;
    g.position.set(h.x, h.y, zw);
    const ring = g.children[0] as THREE.Mesh;
    ring.scale.setScalar(m.size * 0.012);
    const color = getTheme().name === 'dark' ? 0xffffff : 0x1b1e28;
    (ring.material as THREE.MeshBasicMaterial).color.setHex(color);
    const stem = g.children[1] as THREE.Line;
    stem.geometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, m.floorZ - zw)]);
    stem.computeLineDistances();
    (stem.material as THREE.LineDashedMaterial).color.setHex(color);
  }
}


