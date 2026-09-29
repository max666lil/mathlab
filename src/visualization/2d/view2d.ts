/** World ↔ screen transform for 2D views (y up, equal aspect). */
export class View2D {
  cx = 0;
  cy = 0;
  /** pixels per unit */
  scale = 60;
  width = 1;
  height = 1;

  sx(x: number) {
    return this.width / 2 + (x - this.cx) * this.scale;
  }
  sy(y: number) {
    return this.height / 2 - (y - this.cy) * this.scale;
  }
  wx(px: number) {
    return this.cx + (px - this.width / 2) / this.scale;
  }
  wy(py: number) {
    return this.cy - (py - this.height / 2) / this.scale;
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
    this.scale = Math.max(1e-6, Math.min(sx, sy));
  }
  /** Stable key describing the current view (for layer caches). */
  key() {
    return `${this.cx.toFixed(5)},${this.cy.toFixed(5)},${this.scale.toFixed(5)},${this.width},${this.height}`;
  }
}

/** A "nice" grid spacing ≥ minimum world distance. */
export function niceStep(minWorld: number): number {
  const mag = 10 ** Math.floor(Math.log10(minWorld));
  for (const m of [1, 2, 5, 10]) if (m * mag >= minWorld) return m * mag;
  return 10 * mag;
}
