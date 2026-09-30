/** Numeric differentiation fallbacks (central differences). */
import { Vec, Mat } from './linalg';

type F = (...x: number[]) => number;

export function numericGradient(f: F, p: Vec): Vec {
  return p.map((_, i) => {
    const h = 1e-5 * (1 + Math.abs(p[i]));
    const a = p.slice();
    const b = p.slice();
    a[i] += h;
    b[i] -= h;
    return (f(...a) - f(...b)) / (2 * h);
  });
}

export function numericHessian(f: F, p: Vec): Mat {
  const n = p.length;
  const H: Mat = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = i; j < n; j++) {
      const hi = 1e-4 * (1 + Math.abs(p[i]));
      const hj = 1e-4 * (1 + Math.abs(p[j]));
      const at = (di: number, dj: number) => {
        const q = p.slice();
        q[i] += di;
        q[j] += dj;
        return f(...q);
      };
      H[i][j] = H[j][i] = (at(hi, hj) - at(hi, -hj) - at(-hi, hj) + at(-hi, -hj)) / (4 * hi * hj);
    }
  return H;
}
