/**
 * Isosurfaces {G = 0} of a function on a box by marching tetrahedra (each grid cube is split into six
 * tetrahedra; no case tables needed). Used for solids given by inequalities (G = max of the
 * constraints) and, later, level surfaces of f(x, y, z).
 */

export interface IsoMesh {
  /** triangle soup: x, y, z per vertex, three vertices per triangle */
  positions: Float32Array;
  /** outward normals (direction of increasing G) per vertex */
  normals: Float32Array;
}

// the six tetrahedra of a cube, by corner index (corner i = bits x, y, z)
const TETS = [
  [0, 5, 1, 7], [0, 1, 3, 7], [0, 3, 2, 7],
  [0, 2, 6, 7], [0, 6, 4, 7], [0, 4, 5, 7],
];

export function isosurface(G: (x: number, y: number, z: number) => number, box: [number, number][], n: number): IsoMesh {
  const [[x0, x1], [y0, y1], [z0, z1]] = box;
  const hx = (x1 - x0) / n, hy = (y1 - y0) / n, hz = (z1 - z0) / n;
  const N = n + 1;
  const vals = new Float64Array(N * N * N);
  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const v = G(x0 + i * hx, y0 + j * hy, z0 + k * hz);
        vals[(k * N + j) * N + i] = Number.isFinite(v) ? v : 1;
      }
  const at = (i: number, j: number, k: number) => vals[(k * N + j) * N + i];
  const pos: number[] = [];
  const cx = new Float64Array(8), cy = new Float64Array(8), cz = new Float64Array(8), cv = new Float64Array(8);
  const edge = (a: number, b: number, out: number[]) => {
    const t = cv[a] / (cv[a] - cv[b]);
    out.push(cx[a] + t * (cx[b] - cx[a]), cy[a] + t * (cy[b] - cy[a]), cz[a] + t * (cz[b] - cz[a]));
  };
  for (let k = 0; k < n; k++)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        let neg = 0;
        for (let c = 0; c < 8; c++) {
          const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1;
          cv[c] = at(i + di, j + dj, k + dk);
          if (cv[c] <= 0) neg++;
          cx[c] = x0 + (i + di) * hx;
          cy[c] = y0 + (j + dj) * hy;
          cz[c] = z0 + (k + dk) * hz;
        }
        if (neg === 0 || neg === 8) continue;
        for (const tet of TETS) {
          const ins = tet.filter((c) => cv[c] <= 0);
          const outs = tet.filter((c) => cv[c] > 0);
          if (ins.length === 0 || ins.length === 4) continue;
          const tri: number[] = [];
          if (ins.length === 1 || ins.length === 3) {
            const [lone, others] = ins.length === 1 ? [ins[0], outs] : [outs[0], ins];
            for (const o of others) edge(lone, o, tri);
            pos.push(...tri);
          } else {
            const [a, b] = ins;
            const [c, d] = outs;
            const q: number[] = [];
            edge(a, c, q);
            edge(a, d, q);
            edge(b, d, q);
            edge(b, c, q);
            pos.push(...q.slice(0, 9), ...q.slice(0, 3), ...q.slice(6, 12));
          }
        }
      }
  const positions = new Float32Array(pos);
  // normals from the gradient of G (orientation independent of the triangle winding)
  const normals = new Float32Array(positions.length);
  const e = Math.max(hx, hy, hz) * 0.5;
  for (let v = 0; v < positions.length; v += 3) {
    const [x, y, z] = [positions[v], positions[v + 1], positions[v + 2]];
    let gx = G(x + e, y, z) - G(x - e, y, z);
    let gy = G(x, y + e, z) - G(x, y - e, z);
    let gz = G(x, y, z + e) - G(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    [gx, gy, gz] = [gx / l, gy / l, gz / l];
    normals[v] = Number.isFinite(gx) ? gx : 0;
    normals[v + 1] = Number.isFinite(gy) ? gy : 0;
    normals[v + 2] = Number.isFinite(gz) ? gz : 1;
  }
  // consistent winding: each triangle faces along the outward normal (front-face rendering works)
  for (let t = 0; t + 8 < positions.length; t += 9) {
    const ax = positions[t + 3] - positions[t], ay = positions[t + 4] - positions[t + 1], az = positions[t + 5] - positions[t + 2];
    const bx = positions[t + 6] - positions[t], by = positions[t + 7] - positions[t + 1], bz = positions[t + 8] - positions[t + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const gx = normals[t] + normals[t + 3] + normals[t + 6], gy = normals[t + 1] + normals[t + 4] + normals[t + 7], gz = normals[t + 2] + normals[t + 5] + normals[t + 8];
    if (nx * gx + ny * gy + nz * gz < 0)
      for (const k of [0, 1, 2]) {
        [positions[t + 3 + k], positions[t + 6 + k]] = [positions[t + 6 + k], positions[t + 3 + k]];
        [normals[t + 3 + k], normals[t + 6 + k]] = [normals[t + 6 + k], normals[t + 3 + k]];
      }
  }
  return { positions, normals };
}