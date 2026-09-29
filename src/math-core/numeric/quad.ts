/** Adaptive Gauss–Kronrod (7/15) quadrature, with maps for infinite bounds. */

type F1 = (x: number) => number;

const XGK = [0.991455371120813, 0.949107912342759, 0.864864423359769, 0.741531185599394, 0.58608723546769, 0.405845151377397, 0.207784955007898, 0];
const WGK = [0.022935322010529, 0.063092092629979, 0.104790010322250, 0.140653259715525, 0.169004726639267, 0.190350578064785, 0.204432940075298, 0.209482141084728];
const WG = [0.129484966168870, 0.279705391489277, 0.381830050505119, 0.417959183673469];

function gk(f: F1, a: number, b: number): [number, number] {
  const c = (a + b) / 2;
  const h = (b - a) / 2;
  let k = WGK[7] * f(c);
  let g = WG[3] * f(c);
  for (let i = 0; i < 7; i++) {
    const dx = h * XGK[i];
    const s = f(c - dx) + f(c + dx);
    k += WGK[i] * s;
    if (i % 2 === 1) g += WG[(i - 1) / 2] * s;
  }
  return [k * h, Math.abs((k - g) * h)];
}

export interface Quadrature {
  value: number;
  error: number;
  ok: boolean;
}

export function integrateNumeric(f: F1, a: number, b: number, tol = 1e-10): Quadrature {
  if (a === b) return { value: 0, error: 0, ok: true };
  if (a > b) {
    const r = integrateNumeric(f, b, a, tol);
    return { ...r, value: -r.value };
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    // x = t / (1 - t²) maps (-1, 1) → ℝ
    const g = (t: number) => {
      const x = t / (1 - t * t);
      const dx = (1 + t * t) / ((1 - t * t) * (1 - t * t));
      const v = f(x) * dx;
      return Number.isFinite(v) ? v : 0;
    };
    const ta = Number.isFinite(a) ? (Math.abs(a) < 1e-15 ? 0 : (-1 + Math.sqrt(1 + 4 * a * a)) / (2 * a)) : -1;
    const tb = Number.isFinite(b) ? (Math.abs(b) < 1e-15 ? 0 : (-1 + Math.sqrt(1 + 4 * b * b)) / (2 * b)) : 1;
    return integrateNumeric(g, ta, tb, tol);
  }
  let total = 0;
  let err = 0;
  let ok = true;
  const stack: [number, number, number][] = [[a, b, 0]];
  while (stack.length) {
    const [x0, x1, depth] = stack.pop()!;
    const [v, e] = gk(f, x0, x1);
    if (!Number.isFinite(v)) {
      ok = false;
      if (depth > 40) continue;
    }
    if (Number.isFinite(v) && (e <= Math.max(tol * Math.abs(v), tol * (x1 - x0) / (b - a)) || depth > 40)) {
      total += v;
      err += e;
      if (depth > 40 && e > 1e-6) ok = false;
    } else {
      const m = (x0 + x1) / 2;
      stack.push([x0, m, depth + 1], [m, x1, depth + 1]);
    }
  }
  return { value: total, error: err, ok: ok && Number.isFinite(total) };
}