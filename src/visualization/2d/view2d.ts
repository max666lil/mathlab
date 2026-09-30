/** World ↔ screen transform for 2D views (y up). Equal aspect for the domain view, free for graphs. */
export class View2D {
  cx = 0;
  cy = 0;
  /** pixels per unit (x) */
  scale = 60;
  /** pixels per unit (y); equals `scale` when `equal` */
  scaleY = 60;
  equal = true;
  width = 1;
  height = 1;

  sx(x: number) {
    return this.width / 2 + (x - this.cx) * this.scale;
  }
  sy(y: number) {
    return this.height / 2 - (y - this.cy) * (this.equal ? this.scale : this.scaleY);
  }
  wx(px: number) {
    return this.cx + (px - this.width / 2) / this.scale;
  }
  wy(py: number) {
    return this.cy - (py - this.height / 2) / (this.equal ? this.scale : this.scaleY);
  }
  get ys() {
    return this.equal ? this.scale : this.scaleY;
  }
  get xRange(): [number, number] {
    return [this.wx(0), this.wx(this.width)];
  }
  get yRange(): [number, number] {
    return [this.wy(this.height), this.wy(0)];
  }
  fit(xr: [number, number], yr: [number, number], margin = 0.08) {
    this.cx = (xr[0] + xr[1]) / 2;
    this.cy = (yr[0] + yr[1]) / 2;
    const sx = this.width / ((xr[1] - xr[0]) * (1 + 2 * margin));
    const sy = this.height / ((yr[1] - yr[0]) * (1 + 2 * margin));
    if (this.equal) this.scale = this.scaleY = Math.max(1e-6, Math.min(sx, sy));
    else {
      this.scale = Math.max(1e-6, sx);
      this.scaleY = Math.max(1e-6, sy);
    }
  }
  zoom(k: number) {
    this.scale = Math.min(1e5, Math.max(1e-3, this.scale * k));
    this.scaleY = Math.min(1e5, Math.max(1e-3, this.scaleY * k));
  }
  /** Stable key describing the current view (for layer caches). */
  key() {
    return `${this.cx.toFixed(5)},${this.cy.toFixed(5)},${this.scale.toFixed(5)},${this.ys.toFixed(5)},${this.width},${this.height}`;
  }
}

/** A "nice" grid spacing ≥ minimum world distance. */
export function niceStep(minWorld: number): number {
  const mag = 10 ** Math.floor(Math.log10(minWorld));
  for (const m of [1, 2, 5, 10]) if (m * mag >= minWorld) return m * mag;
  return 10 * mag;
}