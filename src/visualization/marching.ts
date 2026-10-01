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

// meshes are in math coordinates, so a new camera / frame only re-maps vertices: keep recent ones
const cache = new Map<string, IsoMesh>();
const CACHE_SIZE = 32;

/** `isosurface` memoised by a key that identifies G (e.g. the function's key plus the level). */
export function isosurfaceCached(key: string, G: (x: number, y: number, z: number) => number, box: [number, number][], n: number): IsoMesh {
  const k = `${key}|${box.flat().join(',')}|${n}`;
  const hit = cache.get(k);
  if (hit) {
    cache.delete(k);
    cache.set(k, hit); // most recently used last
    return hit;
  }
  const mesh = isosurface(G, box, n);
  cache.set(k, mesh);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return mesh;
}

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
  const idx = (i: number, j: number, k: number) => (k * N + j) * N + i;
  // gradient of G at the grid nodes by differences of the samples (no extra evaluations of G);
  // vertex normals interpolate it along the cut edges like the positions
  const grad = new Float32Array(N * N * N * 3);
  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const i0 = i > 0 ? i - 1 : i, i1 = i < n ? i + 1 : i;
        const j0 = j > 0 ? j - 1 : j, j1 = j < n ? j + 1 : j;
        const k0 = k > 0 ? k - 1 : k, k1 = k < n ? k + 1 : k;
        const g = 3 * idx(i, j, k);
        grad[g] = (vals[idx(i1, j, k)] - vals[idx(i0, j, k)]) / ((i1 - i0) * hx);
        grad[g + 1] = (vals[idx(i, j1, k)] - vals[idx(i, j0, k)]) / ((j1 - j0) * hy);
        grad[g + 2] = (vals[idx(i, j, k1)] - vals[idx(i, j, k0)]) / ((k1 - k0) * hz);
      }
  const pos: number[] = [];
  const nor: number[] = [];
  const cx = new Float64Array(8), cy = new Float64Array(8), cz = new Float64Array(8), cv = new Float64Array(8);
  const cg = new Int32Array(8);
  const edge = (a: number, b: number) => {
    const t = cv[a] / (cv[a] - cv[b]);
    pos.push(cx[a] + t * (cx[b] - cx[a]), cy[a] + t * (cy[b] - cy[a]), cz[a] + t * (cz[b] - cz[a]));
    const ga = cg[a], gb = cg[b];
    nor.push(grad[ga] + t * (grad[gb] - grad[ga]), grad[ga + 1] + t * (grad[gb + 1] - grad[ga + 1]), grad[ga + 2] + t * (grad[gb + 2] - grad[ga + 2]));
  };
  const ins = [0, 0, 0, 0], outs = [0, 0, 0, 0];
  for (let k = 0; k < n; k++)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        let neg = 0;
        for (let c = 0; c < 8; c++) {
          const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1;
          const id = idx(i + di, j + dj, k + dk);
          cv[c] = vals[id];
          cg[c] = 3 * id;
          if (cv[c] <= 0) neg++;
        }
        if (neg === 0 || neg === 8) continue;
        for (let c = 0; c < 8; c++) {
          cx[c] = x0 + (i + (c & 1)) * hx;
          cy[c] = y0 + (j + ((c >> 1) & 1)) * hy;
          cz[c] = z0 + (k + ((c >> 2) & 1)) * hz;
        }
        for (const tet of TETS) {
          let ni = 0, no = 0;
          for (const c of tet) if (cv[c] <= 0) ins[ni++] = c; else outs[no++] = c;
          if (ni === 0 || ni === 4) continue;
          if (ni === 1) for (let q = 0; q < 3; q++) edge(ins[0], outs[q]);
          else if (ni === 3) for (let q = 0; q < 3; q++) edge(outs[0], ins[q]);
          else {
            // quad a-c, a-d, b-d, b-c as two triangles
            const [a, b] = ins, [c, d] = outs;
            edge(a, c); edge(a, d); edge(b, d);
            edge(a, c); edge(b, d); edge(b, c);
          }
        }
      }
  const positions = new Float32Array(pos);
  const normals = new Float32Array(nor.length);
  for (let v = 0; v < nor.length; v += 3) {
    const gx = nor[v], gy = nor[v + 1], gz = nor[v + 2];
    const l = Math.hypot(gx, gy, gz);
    if (l > 0 && Number.isFinite(l)) {
      normals[v] = gx / l;
      normals[v + 1] = gy / l;
      normals[v + 2] = gz / l;
    } else normals[v + 2] = 1;
  }
  // consistent winding: each triangle faces along the outward normal (front-face rendering works)
  for (let t = 0; t + 8 < positions.length; t += 9) {
    const ax = positions[t + 3] - positions[t], ay = positions[t + 4] - positions[t + 1], az = positions[t + 5] - positions[t + 2];
    const bx = positions[t + 6] - positions[t], by = positions[t + 7] - positions[t + 1], bz = positions[t + 8] - positions[t + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const gx = normals[t] + normals[t + 3] + normals[t + 6], gy = normals[t + 1] + normals[t + 4] + normals[t + 7], gz = normals[t + 2] + normals[t + 5] + normals[t + 8];
    if (nx * gx + ny * gy + nz * gz < 0)
      for (let q = 0; q < 3; q++) {
        let tmp = positions[t + 3 + q];
        positions[t + 3 + q] = positions[t + 6 + q];
        positions[t + 6 + q] = tmp;
        tmp = normals[t + 3 + q];
        normals[t + 3 + q] = normals[t + 6 + q];
        normals[t + 6 + q] = tmp;
      }
  }
  return { positions, normals };
}