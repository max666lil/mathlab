/**
 * Mathematical camera: named shots and smooth, eased transitions between them. Positions are
 * interpolated in spherical coordinates around a moving target, so the camera sweeps around the
 * object like a hand-held animation instead of cutting through it.
 */
import * as THREE from 'three';

export interface Pose {
  target: THREE.Vector3;
  position: THREE.Vector3;
  fov: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraRig {
  private tween: { from: Pose; to: Pose; start: number; dur: number } | null = null;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private target: THREE.Vector3,
  ) {}

  get active() {
    return !!this.tween;
  }

  current(): Pose {
    return { target: this.target.clone(), position: this.camera.position.clone(), fov: this.camera.fov };
  }

  goTo(to: Pose, seconds = 1.2) {
    this.tween = { from: this.current(), to, start: performance.now(), dur: seconds * 1000 };
  }

  jump(to: Pose) {
    this.tween = null;
    this.apply(to);
  }

  cancel() {
    this.tween = null;
  }

  private apply(p: Pose) {
    this.target.copy(p.target);
    this.camera.position.copy(p.position);
    this.camera.fov = p.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.target);
  }

  /** Advance the transition; returns true while animating. */
  update(now = performance.now()): boolean {
    if (!this.tween) return false;
    const { from, to, start, dur } = this.tween;
    const k = ease(Math.min(1, (now - start) / dur));
    const target = from.target.clone().lerp(to.target, k);
    const a = new THREE.Spherical().setFromVector3(from.position.clone().sub(from.target).applyQuaternion(Z_TO_Y));
    const b = new THREE.Spherical().setFromVector3(to.position.clone().sub(to.target).applyQuaternion(Z_TO_Y));
    let dTheta = b.theta - a.theta;
    if (dTheta > Math.PI) dTheta -= 2 * Math.PI;
    if (dTheta < -Math.PI) dTheta += 2 * Math.PI;
    const s = new THREE.Spherical(
      Math.exp(Math.log(a.radius) * (1 - k) + Math.log(b.radius) * k),
      a.phi + (b.phi - a.phi) * k,
      a.theta + dTheta * k,
    );
    const offset = new THREE.Vector3().setFromSpherical(s).applyQuaternion(Y_TO_Z);
    this.apply({ target, position: target.clone().add(offset), fov: from.fov + (to.fov - from.fov) * k });
    if (k >= 1) this.tween = null;
    return true;
  }
}

// THREE.Spherical assumes y-up; our world is z-up.
const Z_TO_Y = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
const Y_TO_Z = Z_TO_Y.clone().invert();

/** Position from spherical angles in a z-up world (polar measured from +z). */
export function orbitPosition(target: THREE.Vector3, radius: number, polarDeg: number, azimuthDeg: number): THREE.Vector3 {
  const p = THREE.MathUtils.degToRad(polarDeg);
  const a = THREE.MathUtils.degToRad(azimuthDeg);
  return target.clone().add(new THREE.Vector3(radius * Math.sin(p) * Math.cos(a), radius * Math.sin(p) * Math.sin(a), radius * Math.cos(p)));
}

export type ShotName = 'orbit' | 'top' | 'tangent' | 'zoom' | 'front' | 'side';

export const SHOTS: { name: ShotName; label: string; hint: string }[] = [
  { name: 'orbit', label: '3D', hint: 'Default 3D view of the surface' },
  { name: 'top', label: 'Top', hint: 'Look straight down: the surface becomes its contour map' },
  { name: 'tangent', label: 'Edge-on', hint: 'Look along the level curve at P: the tangent plane is seen edge-on' },
  { name: 'zoom', label: 'Zoom P', hint: 'Zoom into P: the surface looks flat — local linearity' },
  { name: 'front', label: 'x–z', hint: 'Look along the y-axis (see x-slices)' },
  { name: 'side', label: 'y–z', hint: 'Look along the x-axis (see y-slices)' },
];