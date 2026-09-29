/** Root finding: 1-D sign-change scan + Brent, and multi-start Newton for small systems. */

type F1 = (x: number) => number;

/** Brent's method on a bracket [a, b] with f(a)·f(b) ≤ 0. */
export function brent(f: F1, a: number, b: number, tol = 1e-14, maxIter = 200): number {
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let i = 0; i < maxIter; i++) {
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = e = b - a;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const t = 2 * Number.EPSILON * Math.abs(b) + tol / 2;
    const m = (c - b) / 2;
    if (Math.abs(m) <= t || fb === 0) return b;
    if (Math.abs(e) >= t && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * m * s;
        q = 1 - s;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        p = s * (2 * m * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      else p = -p;
      if (2 * p < Math.min(3 * m * q - Math.abs(t * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = m;
        e = d;
      }
    } else {
      d = m;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > t ? d : m > 0 ? t : -t;
    fb = f(b);
  }
  return b;
}

/** Golden-section minimisation of g on [a, b]. */
function goldenMin(g: F1, a: number, b: number, iters = 80): number {
  const r = (Math.sqrt(5) - 1) / 2;
  let c = b - r * (b - a);
  let d = a + r * (b - a);
  for (let i = 0; i < iters; i++) {
    if (g(c) < g(d)) b = d;
    else a = c;
    c = b - r * (b - a);
    d = a + r * (b - a);
  }
  return (a + b) / 2;
}

export interface RootScan {
  roots: number[];
  /** how the search was done (for certainty/evidence) */
  window: [number, number];
  samples: number;
}

/**
 * Zeros of f on [a, b]: sign changes refined by Brent (poles are rejected) plus tangential zeros found as
 * near-zero minima of |f|.
 */
export function roots1D(f: F1, a: number, b: number, samples = 4000): RootScan {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = a + ((b - a) * i) / samples;
    xs.push(x);
    ys.push(f(x));
  }
  const found: number[] = [];
  const add = (r: number) => {
    const v = f(r);
    if (!Number.isFinite(v)) return;
    const scale = 1 + Math.abs(r);
    if (Math.abs(v) > 1e-7) return;
    if (!found.some((q) => Math.abs(q - r) < 1e-7 * scale)) found.push(Math.abs(r) < 1e-12 ? 0 : r);
  };
  for (let i = 0; i < samples; i++) {
    const y0 = ys[i];
    const y1 = ys[i + 1];
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
    if (y0 === 0) add(xs[i]);
    else if (y0 * y1 < 0) add(brent(f, xs[i], xs[i + 1]));
    else if (i > 0 && Number.isFinite(ys[i - 1])) {
      // tangential zero: local minimum of |f| close to 0
      const a0 = Math.abs(ys[i - 1]);
      const a1 = Math.abs(y0);
      const a2 = Math.abs(y1);
      if (a1 <= a0 && a1 <= a2 && a1 < 1e-3 * (1 + Math.max(a0, a2))) {
        const m = goldenMin((x) => Math.abs(f(x)), xs[i - 1], xs[i + 1]);
        if (Math.abs(f(m)) < 1e-10) add(m);
      }
    }
  }
  if (Number.isFinite(ys[samples]) && ys[samples] === 0) add(xs[samples]);
  found.sort((p, q) => p - q);
  return { roots: found, window: [a, b], samples };
}

export interface SystemRoots {
  solutions: number[][];
  residuals: number[];
  seeds: number;
}

/** Multi-start damped Newton for F: ℝⁿ → ℝⁿ (numeric Jacobian when J is not given). */
export function newtonSystem(F: (p: number[]) => number[], seeds: number[][], J?: (p: number[]) => number[][]): SystemRoots {
  const solutions: number[][] = [];
  const residuals: number[] = [];
  const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  const jac = (p: number[]): number[][] => {
    if (J) return J(p);
    const n = p.length;
    const cols = p.map((_, j) => {
      const h = 1e-6 * (1 + Math.abs(p[j]));
      const a = p.slice();
      const b = p.slice();
      a[j] += h;
      b[j] -= h;
      const fa = F(a);
      const fb = F(b);
      return fa.map((v, i) => (v - fb[i]) / (2 * h));
    });
    return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]));
  };
  for (const seed of seeds) {
    let p = seed.slice();
    let r = F(p);
    let ok = false;
    for (let it = 0; it < 60; it++) {
      if (!r.every(Number.isFinite)) break;
      if (norm(r) < 1e-12) {
        ok = true;
        break;
      }
      const d = solve(jac(p), r.map((v) => -v));
      if (!d) break;
      let step = 1;
      let improved = false;
      for (let k = 0; k < 20; k++, step /= 2) {
        const q = p.map((x, i) => x + step * d[i]);
        const rq = F(q);
        if (rq.every(Number.isFinite) && norm(rq) < norm(r)) {
          p = q;
          r = rq;
          improved = true;
          break;
        }
      }
      if (!improved) break;
    }
    if (!ok && norm(r) < 1e-9) ok = true;
    if (!ok) continue;
    p = p.map((x) => (Math.abs(x) < 1e-12 ? 0 : x));
    if (!solutions.some((s) => s.every((x, i) => Math.abs(x - p[i]) < 1e-6 * (1 + Math.abs(x))))) {
      solutions.push(p);
      residuals.push(norm(r));
    }
  }
  return { solutions, residuals, seeds: seeds.length };
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    if (Math.abs(M[p][i]) < 1e-14) return null;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** Seeds on a grid over a box (for multi-start searches). */
export function gridSeeds(ranges: [number, number][], perAxis: number): number[][] {
  let out: number[][] = [[]];
  for (const [a, b] of ranges) {
    const next: number[][] = [];
    for (const p of out) for (let i = 0; i < perAxis; i++) next.push([...p, a + ((b - a) * (i + 0.5)) / perAxis]);
    out = next;
  }
  return out;
}