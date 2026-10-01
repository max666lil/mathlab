/**
 * Script functions for the course books:
 *  · Devore, Berk & Carlton (STA237): every R distribution function the book uses, spelled as in the
 *    book (pnorm(x, μ, σ), pgamma(x, α, rate), dhyper(x, m, n, k), dnbinom counting failures …), the
 *    same distributions under MATLAB's names and conventions (expcdf takes the mean, gamcdf the scale,
 *    wblpdf(x, scale, shape) …), sampling, and the book's descriptive tools (hinges / fivenum, trimmed
 *    means, boxplots with mild / extreme outliers, normal probability plots, stem-and-leaf, tables).
 *  · Hughes-Hallett: left / right / midpoint / trapezoid / Simpson sums, Euler and ode45, Newton and
 *    bisection, partial sums, Fourier coefficients, slope fields, minimisation, double integrals.
 */
import { Arr, SV, ScriptError, isArr, isFn, toArr, num, simplifyValue } from './values';
import type { Interpreter, Series } from './interp';
import * as D from '../../math-core/distributions';
import { integrateNumeric } from '../../math-core/numeric/quad';

type LibFn = (args: SV[], nout: number, it: Interpreter) => SV[];
const one = (f: (args: SV[], it: Interpreter) => SV): LibFn => (args, _n, it) => [f(args, it)];

const mapv = (x: SV, f: (t: number) => number): SV => {
  if (typeof x === 'number') return f(x);
  const A = toArr(x);
  return simplifyValue(new Arr(A.r, A.c, A.d.map(f)));
};

/** Positional and R-style named arguments (`scale = 2.5` arrives as 'scale', 2.5). */
function params(args: SV[], names: string[], defaults: (number | undefined)[]): number[] {
  const pos: SV[] = [];
  const named: Record<string, number> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a === 'string' && i + 1 < args.length) {
      named[a] = num(args[++i]);
      continue;
    }
    pos.push(a);
  }
  return names.map((n, i) => {
    if (n in named) return named[n];
    if (i < pos.length) return num(pos[i], n);
    const d = defaults[i];
    if (d === undefined) throw new ScriptError(`missing argument '${n}'`);
    return d;
  });
}

function sizeOf(args: SV[]): [number, number] {
  if (!args.length) return [1, 1];
  if (args.length === 1) {
    const a = toArr(args[0]);
    if (a.n === 2) return [a.d[0], a.d[1]];
    const n = num(args[0]);
    return [n, n];
  }
  return [num(args[0]), num(args[1])];
}

function draws(d: D.Dist, r: number, c: number, it: Interpreter): SV {
  if (!(r * c >= 0) || r * c > 2e7) throw new ScriptError('sample size out of range');
  it.usedRandom = true;
  const u = () => it.rng.next();
  const z = () => it.rng.normal();
  const a = Arr.zeros(r, c);
  for (let i = 0; i < a.n; i++) a.d[i] = d.sample(u, z);
  return simplifyValue(a);
}

// ------------------------------------------------------------------ R spellings (Devore)

interface Family {
  names: string[];
  defaults: (number | undefined)[];
  make: (p: number[], named: string[]) => D.Dist;
}

const R_FAMILIES: Record<string, Family> = {
  binom: { names: ['size', 'prob'], defaults: [undefined, undefined], make: ([n, p]) => D.binomial(n, p) },
  pois: { names: ['lambda'], defaults: [undefined], make: ([l]) => D.poisson(l) },
  // dhyper(x, m, n, k): m successes, n failures, k drawn
  hyper: { names: ['m', 'n', 'k'], defaults: [undefined, undefined, undefined], make: ([m, n, k]) => D.hypergeometric(k, m, m + n) },
  nbinom: { names: ['size', 'prob'], defaults: [undefined, undefined], make: ([r, p]) => D.negbinFailures(r, p) },
  geom: { names: ['prob'], defaults: [undefined], make: ([p]) => D.geometricFailures(p) },
  norm: { names: ['mean', 'sd'], defaults: [0, 1], make: ([m, s]) => D.normal(m, s) },
  exp: { names: ['rate'], defaults: [1], make: ([r]) => D.exponential(r) },
  // pgamma(x, shape, rate) — the third positional argument is the rate; scale = … also accepted
  gamma: { names: ['shape', 'rate', 'scale'], defaults: [undefined, 1, NaN], make: ([a, r, s]) => D.gamma(a, Number.isNaN(s) ? 1 / r : s) },
  weibull: { names: ['shape', 'scale'], defaults: [undefined, 1], make: ([a, b]) => D.weibull(a, b) },
  lnorm: { names: ['meanlog', 'sdlog'], defaults: [0, 1], make: ([m, s]) => D.lognormal(m, s) },
  beta: { names: ['shape1', 'shape2'], defaults: [undefined, undefined], make: ([a, b]) => D.betaDist(a, b) },
  unif: { names: ['min', 'max'], defaults: [0, 1], make: ([a, b]) => D.uniform(a, b) },
  chisq: { names: ['df'], defaults: [undefined], make: ([v]) => D.chiSquared(v) },
  t: { names: ['df'], defaults: [undefined], make: ([v]) => D.studentT(v) },
  f: { names: ['df1', 'df2'], defaults: [undefined, undefined], make: ([a, b]) => D.fDist(a, b) },
};

// ------------------------------------------------------------------ MATLAB spellings

const M_FAMILIES: Record<string, Family> = {
  bino: { names: ['n', 'p'], defaults: [undefined, undefined], make: ([n, p]) => D.binomial(n, p) },
  poiss: { names: ['lambda'], defaults: [undefined], make: ([l]) => D.poisson(l) },
  // hygepdf(x, M, K, N): population M, K successes, N drawn
  hyge: { names: ['M', 'K', 'N'], defaults: [undefined, undefined, undefined], make: ([M, K, N]) => D.hypergeometric(N, K, M) },
  nbin: { names: ['R', 'P'], defaults: [undefined, undefined], make: ([r, p]) => D.negbinFailures(r, p) },
  geo: { names: ['P'], defaults: [undefined], make: ([p]) => D.geometricFailures(p) },
  norm: { names: ['mu', 'sigma'], defaults: [0, 1], make: ([m, s]) => D.normal(m, s) },
  // MATLAB's exponential takes the mean
  exp: { names: ['mu'], defaults: [1], make: ([m]) => D.exponential(1 / m) },
  gam: { names: ['a', 'b'], defaults: [undefined, 1], make: ([a, b]) => D.gamma(a, b) },
  // wblpdf(x, a, b): a is the scale, b the shape
  wbl: { names: ['a', 'b'], defaults: [1, 1], make: ([a, b]) => D.weibull(b, a) },
  logn: { names: ['mu', 'sigma'], defaults: [0, 1], make: ([m, s]) => D.lognormal(m, s) },
  beta: { names: ['a', 'b'], defaults: [undefined, undefined], make: ([a, b]) => D.betaDist(a, b) },
  unif: { names: ['a', 'b'], defaults: [0, 1], make: ([a, b]) => D.uniform(a, b) },
  chi2: { names: ['v'], defaults: [undefined], make: ([v]) => D.chiSquared(v) },
  t: { names: ['v'], defaults: [undefined], make: ([v]) => D.studentT(v) },
  f: { names: ['v1', 'v2'], defaults: [undefined, undefined], make: ([a, b]) => D.fDist(a, b) },
};

function familyFns(): Record<string, LibFn> {
  const out: Record<string, LibFn> = {};
  for (const [k, fam] of Object.entries(R_FAMILIES)) {
    const dist = (args: SV[]) => fam.make(params(args, fam.names, fam.defaults), []);
    out[`d${k}`] = one(([x, ...p]) => {
      const d = dist(p);
      return mapv(x, (t) => d.pdf(t));
    });
    out[`p${k}`] = one(([x, ...p]) => {
      const d = dist(p);
      return mapv(x, (t) => d.cdf(t));
    });
    out[`q${k}`] = one(([x, ...p]) => {
      const d = dist(p);
      return mapv(x, (t) => D.quantileOf(d, t));
    });
    out[`r${k}`] = (args, _n, it) => [draws(dist(args.slice(1)), 1, Math.round(num(args[0], 'a sample size')), it)];
  }
  for (const [k, fam] of Object.entries(M_FAMILIES)) {
    const np = fam.names.length;
    const dist = (args: SV[]) => fam.make(params(args.slice(0, np), fam.names, fam.defaults), []);
    out[`${k}pdf`] = one(([x, ...p]) => {
      const d = dist(p);
      return mapv(x, (t) => d.pdf(t));
    });
    out[`${k}cdf`] = one(([x, ...p]) => {
      const d = dist(p);
      return mapv(x, (t) => d.cdf(t));
    });
    out[`${k}inv`] = one(([x, ...p]) => {
      const d = dist(p);
      return mapv(x, (t) => D.quantileOf(d, t));
    });
    out[`${k}rnd`] = (args, _n, it) => {
      const [r, c] = sizeOf(args.slice(np));
      return [draws(dist(args), r, c, it)];
    };
  }
  return out;
}

// ------------------------------------------------------------------ descriptive statistics (Devore ch. 1)

const sorted = (x: SV) => Array.from(toArr(x).d).sort((a, b) => a - b);
const medianOf = (s: number[]) => (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);

/** Tukey hinges: medians of the lower and upper halves, the median in both halves when n is odd. */
function hingesOf(s: number[]): [number, number] {
  const n = s.length;
  const h = Math.ceil(n / 2);
  return [medianOf(s.slice(0, h)), medianOf(s.slice(n - h))];
}

/** Devore's trimmed mean x̄_tr(α): α% from each end, interpolating when nα is not whole. */
function trimmed(s: number[], eachPct: number): number {
  const n = s.length;
  const k = (n * eachPct) / 100;
  const mean = (j: number) => {
    const m = s.slice(j, n - j);
    return m.reduce((a, b) => a + b, 0) / m.length;
  };
  const lo = Math.floor(k);
  if (Math.abs(k - lo) < 1e-12) return mean(lo);
  return mean(lo) + (k - lo) * (mean(lo + 1) - mean(lo));
}

function newFigure(it: Interpreter) {
  const fig = it.figure();
  if (!it.holdOn) fig.series = [];
  return fig;
}

/** Boxplot of one sample at height y (Devore's mild / extreme outliers beyond 1.5 / 3 fourth spreads). */
function boxSeries(s: number[], y: number): Series[] {
  const [q1, q3] = hingesOf(s);
  const med = medianOf(s);
  const fs = q3 - q1;
  const inner = s.filter((x) => x >= q1 - 1.5 * fs && x <= q3 + 1.5 * fs);
  const lo = Math.min(...inner);
  const hi = Math.max(...inner);
  const h = 0.3;
  const N = NaN;
  const box: Series = {
    type: 'line',
    x: [q1, q3, q3, q1, q1, N, med, med, N, lo, q1, N, q3, hi, N, lo, lo, N, hi, hi],
    y: [y - h, y - h, y + h, y + h, y - h, N, y - h, y + h, N, y, y, N, y, y, N, y - h / 2, y + h / 2, N, y - h / 2, y + h / 2],
  };
  const mild = s.filter((x) => (x < q1 - 1.5 * fs && x >= q1 - 3 * fs) || (x > q3 + 1.5 * fs && x <= q3 + 3 * fs));
  const extreme = s.filter((x) => x < q1 - 3 * fs || x > q3 + 3 * fs);
  const out: Series[] = [box];
  if (mild.length) out.push({ type: 'scatter', x: mild, y: mild.map(() => y), label: 'mild outliers' });
  if (extreme.length) out.push({ type: 'scatter', x: extreme, y: extreme.map(() => y), style: 'r*', label: 'extreme outliers' });
  return out;
}

function stemLeaf(s: number[]): string[] {
  const range = s[s.length - 1] - s[0] || Math.abs(s[0]) || 1;
  const unit = Math.pow(10, Math.floor(Math.log10(range / 10 || 1)));
  const rows = new Map<number, number[]>();
  for (const x of s) {
    const v = Math.floor(x / unit + 1e-9);
    const stem = Math.floor(v / 10);
    const leaf = ((v % 10) + 10) % 10;
    if (!rows.has(stem)) rows.set(stem, []);
    rows.get(stem)!.push(leaf);
  }
  const stems = [...rows.keys()].sort((a, b) => a - b);
  const all: number[] = [];
  for (let k = stems[0]; k <= stems[stems.length - 1]; k++) all.push(k);
  const w = Math.max(...all.map((k) => String(k).length));
  return [...all.map((k) => `${String(k).padStart(w)} | ${(rows.get(k) ?? []).join('')}`), `stem: tens of ${unit * 10 >= 1 ? unit * 10 : (unit * 10).toPrecision(2)}, leaf: ${unit >= 1 ? unit : unit.toPrecision(2)}`];
}

// ------------------------------------------------------------------ numerical calculus (Hughes-Hallett)

function call1(f: SV, x: number): number {
  if (!isFn(f)) throw new ScriptError('expected a function handle, e.g. @(x) x.^2');
  return num(f.call([x], 1)[0], 'a number from the function');
}
function callV(f: SV, args: SV[]): SV {
  if (!isFn(f)) throw new ScriptError('expected a function handle');
  return f.call(args, 1)[0];
}

function sums(kind: 'left' | 'right' | 'mid' | 'trap' | 'simp'): LibFn {
  return one(([f, a, b, n]) => {
    const A = num(a);
    const B = num(b);
    const N = Math.round(num(n ?? 10));
    const h = (B - A) / N;
    const g = (x: number) => call1(f, x);
    const left = () => Array.from({ length: N }, (_, i) => g(A + i * h)).reduce((s, v) => s + v, 0) * h;
    const right = () => Array.from({ length: N }, (_, i) => g(A + (i + 1) * h)).reduce((s, v) => s + v, 0) * h;
    const mid = () => Array.from({ length: N }, (_, i) => g(A + (i + 0.5) * h)).reduce((s, v) => s + v, 0) * h;
    switch (kind) {
      case 'left':
        return left();
      case 'right':
        return right();
      case 'mid':
        return mid();
      case 'trap':
        return (left() + right()) / 2;
      default:
        return (2 * mid() + (left() + right()) / 2) / 3;
    }
  });
}

/** Column of state values for a scalar or vector ODE right-hand side f(t, y). */
function rhs(f: SV, t: number, y: number[]): number[] {
  const v = callV(f, [t, y.length === 1 ? y[0] : Arr.col(y)]);
  return Array.from(toArr(v).d);
}

function euler(f: SV, span: SV, y0: SV, hArg: SV | undefined): [number[], number[][]] {
  const [t0, t1] = Array.from(toArr(span).d);
  const h = hArg === undefined ? (t1 - t0) / 100 : num(hArg);
  const n = Math.round((t1 - t0) / h);
  const ts = [t0];
  const ys = [Array.from(toArr(y0).d)];
  for (let k = 0; k < n; k++) {
    const y = ys[k];
    const d = rhs(f, ts[k], y);
    ys.push(y.map((v, i) => v + h * d[i]));
    ts.push(t0 + (k + 1) * h);
  }
  return [ts, ys];
}

/** Dormand–Prince 5(4) with step control. */
function ode45(f: SV, span: SV, y0: SV): [number[], number[][]] {
  const [t0, t1] = Array.from(toArr(span).d);
  const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
  const A = [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729], [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]];
  const B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
  const B4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];
  let t = t0;
  let y = Array.from(toArr(y0).d);
  let h = (t1 - t0) / 100;
  const ts = [t];
  const ys = [y.slice()];
  let guard = 0;
  while ((h > 0 ? t < t1 - 1e-14 : t > t1 + 1e-14) && guard++ < 100000) {
    if ((h > 0 && t + h > t1) || (h < 0 && t + h < t1)) h = t1 - t;
    const k: number[][] = [];
    for (let s = 0; s < 7; s++) {
      const ys2 = y.map((v, i) => v + h * A[s].reduce((acc, a, j) => acc + a * k[j][i], 0));
      k.push(rhs(f, t + C[s] * h, ys2));
    }
    const y5 = y.map((v, i) => v + h * B5.reduce((acc, b, j) => acc + b * k[j][i], 0));
    const y4 = y.map((v, i) => v + h * B4.reduce((acc, b, j) => acc + b * k[j][i], 0));
    // tighter than MATLAB's defaults (RelTol 1e-3): results should agree with the exact solutions in the books
    const err = Math.max(...y5.map((v, i) => Math.abs(v - y4[i]) / (1e-10 + 1e-7 * Math.max(Math.abs(v), Math.abs(y[i])))));
    if (err <= 1 || Math.abs(h) < 1e-12) {
      t += h;
      y = y5;
      ts.push(t);
      ys.push(y.slice());
    }
    h *= Math.min(5, Math.max(0.2, 0.9 * Math.pow(Math.max(err, 1e-10), -0.2)));
  }
  return [ts, ys];
}

function nelderMead(f: (x: number[]) => number, x0: number[]): number[] {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? (v !== 0 ? v * 1.05 : 0.00025) : v)))];
  for (let iter = 0; iter < 200 * n * n; iter++) {
    simplex.sort((a, b) => f(a) - f(b));
    const best = simplex[0];
    const worst = simplex[n];
    if (Math.abs(f(worst) - f(best)) < 1e-12 && Math.max(...simplex.map((p) => Math.max(...p.map((v, i) => Math.abs(v - best[i]))))) < 1e-10) break;
    const cen = best.map((_, i) => simplex.slice(0, n).reduce((s, p) => s + p[i], 0) / n);
    const at = (t: number) => cen.map((c, i) => c + t * (worst[i] - c));
    const r = at(-1);
    if (f(r) < f(best)) {
      const e = at(-2);
      simplex[n] = f(e) < f(r) ? e : r;
    } else if (f(r) < f(simplex[n - 1])) simplex[n] = r;
    else {
      const c = at(0.5);
      if (f(c) < f(worst)) simplex[n] = c;
      else simplex = simplex.map((p) => p.map((v, i) => best[i] + 0.5 * (v - best[i])));
    }
  }
  simplex.sort((a, b) => f(a) - f(b));
  return simplex[0];
}

export const BOOK_LIBRARY: Record<string, LibFn> = {
  ...familyFns(),
  // R basics used in Devore
  TRUE: one(() => 1),
  FALSE: one(() => 0),
  c: one((args) => Arr.row(args.flatMap((a) => Array.from(toArr(a).d)))),
  seq: one(([a, b, by]) => {
    const A = num(a);
    const B = num(b);
    const s = by === undefined ? 1 : num(by);
    const n = Math.floor((B - A) / s + 1e-10) + 1;
    return Arr.row(Array.from({ length: Math.max(0, n) }, (_, i) => A + i * s));
  }),
  rep: one(([x, times]) => {
    const v = Array.from(toArr(x).d);
    return Arr.row(Array.from({ length: Math.round(num(times)) }, () => v).flat());
  }),
  sd: one(([x]) => {
    const s = Array.from(toArr(x).d);
    const m = s.reduce((a, b) => a + b, 0) / s.length;
    return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / (s.length - 1));
  }),
  replicate: (args, _n, it) => {
    const n = Math.round(num(args[0]));
    const f = args[1];
    if (!isFn(f)) throw new ScriptError('replicate(n, @() expression)');
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      it.tick();
      out.push(num(f.call([], 1)[0]));
    }
    return [Arr.row(out)];
  },
  // sample(x, size, replace, prob) — R; x a number means 1:x
  sample: (args, _n, it) => {
    const [x, size, replace, prob] = args;
    const pool = typeof x === 'number' || (isArr(x) && x.n === 1) ? Array.from({ length: Math.round(num(x)) }, (_, i) => i + 1) : Array.from(toArr(x).d);
    const k = size === undefined ? pool.length : Math.round(num(size));
    return [sampleFrom(pool, k, replace !== undefined && num(replace) !== 0, prob === undefined ? undefined : Array.from(toArr(prob).d), it)];
  },
  // randsample(n | v, k, replace, w) — MATLAB
  randsample: (args, _n, it) => {
    const [x, size, replace, w] = args;
    const pool = typeof x === 'number' || (isArr(x) && x.n === 1) ? Array.from({ length: Math.round(num(x)) }, (_, i) => i + 1) : Array.from(toArr(x).d);
    return [sampleFrom(pool, Math.round(num(size)), replace !== undefined && num(replace) !== 0, w === undefined ? undefined : Array.from(toArr(w).d), it)];
  },
  unidrnd: (args, _n, it) => {
    const N = Math.round(num(args[0]));
    const [r, c] = sizeOf(args.slice(1));
    it.usedRandom = true;
    const a = Arr.zeros(r, c);
    for (let i = 0; i < a.n; i++) a.d[i] = 1 + Math.floor(it.rng.next() * N);
    return [simplifyValue(a)];
  },
  // descriptive statistics, Devore's conventions
  fivenum: one(([x]) => {
    const s = sorted(x);
    const [l, u] = hingesOf(s);
    return Arr.row([s[0], l, medianOf(s), u, s[s.length - 1]]);
  }),
  hinges: one(([x]) => Arr.row(hingesOf(sorted(x)))),
  iqr: one(([x]) => {
    const [l, u] = hingesOf(sorted(x));
    return u - l;
  }),
  // trimmean(x, pct): pct percent in total (pct/2 from each end), as in MATLAB; Devore's x̄_tr(α) = trimmean(x, 2α)
  trimmean: one(([x, pct]) => trimmed(sorted(x), num(pct) / 2)),
  boxplot: (args, _n, it) => {
    const fig = newFigure(it);
    const A = toArr(args[0]);
    const cols = A.r > 1 && A.c > 1 ? Array.from({ length: A.c }, (_, j) => Array.from(A.d.subarray(j * A.r, (j + 1) * A.r))) : [Array.from(A.d)];
    cols.forEach((col, j) => fig.series.push(...boxSeries(col.sort((a, b) => a - b), cols.length - j)));
    return [];
  },
  normplot: (args, _n, it) => normalPlot(args, it),
  qqnorm: (args, _n, it) => normalPlot(args, it),
  stem: (args, _n, it) => {
    for (const line of stemLeaf(sorted(args[0]))) it.write(line + '\n');
    return [];
  },
  tabulate: (args, _n, it) => {
    const s = sorted(args[0]);
    const vals = [...new Set(s)];
    const rows = vals.map((v) => {
      const c = s.filter((x) => x === v).length;
      return [v, c, (100 * c) / s.length];
    });
    it.write(`  Value    Count   Percent\n`);
    for (const [v, c, p] of rows) it.write(`${String(+v.toPrecision(6)).padStart(7)} ${String(c).padStart(8)} ${p.toFixed(2).padStart(8)}%\n`);
    return [Arr.fromRows(rows)];
  },
  table: (args, n, it) => BOOK_LIBRARY.tabulate(args, n, it),
  corr: one(([x, y]) => corr(Array.from(toArr(x).d), Array.from(toArr(y).d))),
  cor: one(([x, y]) => corr(Array.from(toArr(x).d), Array.from(toArr(y).d))),
  cov: one(([x, y]) => {
    const a = Array.from(toArr(x).d);
    const b = Array.from(toArr(y ?? x).d);
    const ma = a.reduce((s, v) => s + v, 0) / a.length;
    const mb = b.reduce((s, v) => s + v, 0) / b.length;
    return a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0) / (a.length - 1);
  }),
  // numerical calculus (Hughes-Hallett ch. 5, 7)
  leftsum: sums('left'),
  rightsum: sums('right'),
  midsum: sums('mid'),
  trapsum: sums('trap'),
  simpsum: sums('simp'),
  // ODEs (ch. 11): [t, y] = euler(@(t, y) …, [t0 t1], y0, h); ode45 adaptive
  euler: (args, nout) => {
    const [t, y] = euler(args[0], args[1], args[2], args[3]);
    return odeOut(t, y, nout);
  },
  ode45: (args, nout) => {
    const [t, y] = ode45(args[0], args[1], args[2]);
    return odeOut(t, y, nout);
  },
  // root finding (appendices A, C)
  newton: (args, nout) => {
    const f = args[0];
    const withDf = args.length >= 3 && isFn(args[1]);
    const df = withDf ? args[1] : undefined;
    let x = num(args[withDf ? 2 : 1]);
    const n = Math.round(num(args[withDf ? 3 : 2] ?? 20));
    const xs = [x];
    for (let k = 0; k < n; k++) {
      const fx = call1(f, x);
      const d = df ? call1(df, x) : (call1(f, x + 1e-6) - call1(f, x - 1e-6)) / 2e-6;
      if (d === 0) break;
      const nx = x - fx / d;
      xs.push(nx);
      if (Math.abs(nx - x) < 1e-15 * Math.max(1, Math.abs(nx))) break;
      x = nx;
    }
    return nout > 1 ? [xs[xs.length - 1], Arr.row(xs)] : [xs[xs.length - 1]];
  },
  bisection: (args, nout) => {
    const f = args[0];
    let a = num(args[1]);
    let b = num(args[2]);
    const tol = num(args[3] ?? 1e-10);
    if (Math.sign(call1(f, a)) === Math.sign(call1(f, b))) throw new ScriptError('bisection: f(a) and f(b) must have opposite signs');
    const rows: number[][] = [];
    while (b - a > tol && rows.length < 200) {
      const m = (a + b) / 2;
      const fm = call1(f, m);
      rows.push([a, b, m, fm]);
      if (fm === 0) break;
      if (Math.sign(fm) === Math.sign(call1(f, a))) a = m;
      else b = m;
    }
    const root = (a + b) / 2;
    return nout > 1 ? [root, Arr.fromRows(rows)] : [root];
  },
  // series (ch. 9–10)
  partialsums: one(([term, N]) => {
    let s = 0;
    return Arr.row(Array.from({ length: Math.round(num(N)) }, (_, k) => (s += call1(term, k + 1))));
  }),
  // [a0, a, b] = fourier(f, N, T): f on [−T/2, T/2] (default 2π)
  fourier: (args, nout) => {
    const f = args[0];
    const N = Math.round(num(args[1] ?? 5));
    const T = args[2] === undefined ? 2 * Math.PI : num(args[2]);
    const I = (g: (x: number) => number) => integrateNumeric(g, -T / 2, T / 2, 1e-10).value;
    const a0 = I((x) => call1(f, x)) / T;
    const a = Array.from({ length: N }, (_, k) => (2 / T) * I((x) => call1(f, x) * Math.cos((2 * Math.PI * (k + 1) * x) / T)));
    const b = Array.from({ length: N }, (_, k) => (2 / T) * I((x) => call1(f, x) * Math.sin((2 * Math.PI * (k + 1) * x) / T)));
    return [a0, Arr.row(a), Arr.row(b)].slice(0, Math.max(1, nout));
  },
  // optimisation
  fminsearch: one(([f, x0]) => {
    const x = Array.from(toArr(x0).d);
    const g = (p: number[]) => num(callV(f, [p.length === 1 ? p[0] : Arr.row(p)]));
    const best = nelderMead(g, x);
    return best.length === 1 ? best[0] : Arr.row(best);
  }),
  fminbnd: one(([f, a, b]) => {
    let lo = num(a);
    let hi = num(b);
    const r = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
      const c = hi - r * (hi - lo);
      const d = lo + r * (hi - lo);
      if (call1(f, c) < call1(f, d)) hi = d;
      else lo = c;
    }
    return (lo + hi) / 2;
  }),
  // ∬ f(x, y) over xa ≤ x ≤ xb, ya(x) ≤ y ≤ yb(x)
  integral2: one(([f, xa, xb, ya, yb]) => {
    const lim = (v: SV, x: number) => (isFn(v) ? call1(v, x) : num(v));
    const inner = (x: number) => integrateNumeric((y) => num(callV(f, [x, y])), lim(ya, x), lim(yb, x), 1e-9).value;
    return integrateNumeric(inner, num(xa), num(xb), 1e-8).value;
  }),
  meshgrid: (args, nout) => {
    const x = Array.from(toArr(args[0]).d);
    const y = Array.from(toArr(args[1] ?? args[0]).d);
    const X = Arr.fromRows(y.map(() => x.slice()));
    const Y = Arr.fromRows(y.map((v) => x.map(() => v)));
    return [X, Y].slice(0, Math.max(1, nout));
  },
  // direction fields and arrows (ch. 11, 17)
  slopefield: (args, _n, it) => {
    const f = args[0];
    const [x0, x1] = args[1] ? Array.from(toArr(args[1]).d) : [-3, 3];
    const [y0, y1] = args[2] ? Array.from(toArr(args[2]).d) : [x0, x1];
    const n = 21;
    const L = (0.35 * Math.min(x1 - x0, y1 - y0)) / n;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
        const y = y0 + ((y1 - y0) * (j + 0.5)) / n;
        const m = num(callV(f, [x, y]));
        if (!Number.isFinite(m)) continue;
        const ang = Math.atan(m);
        xs.push(x - L * Math.cos(ang), x + L * Math.cos(ang), NaN);
        ys.push(y - L * Math.sin(ang), y + L * Math.sin(ang), NaN);
      }
    newFigure(it).series.push({ type: 'line', x: xs, y: ys, style: 'k' });
    return [];
  },
  quiver: (args, _n, it) => {
    const [X, Y, U, V] = args.map((a) => Array.from(toArr(a).d));
    const big = Math.max(...U.map((u, i) => Math.hypot(u, V[i])), 1e-12);
    const span = Math.max(Math.max(...X) - Math.min(...X), Math.max(...Y) - Math.min(...Y), 1e-12);
    const s = (0.9 * span) / Math.sqrt(X.length) / big;
    const xs: number[] = [];
    const ys: number[] = [];
    X.forEach((x, i) => {
      const [u, v] = [U[i] * s, V[i] * s];
      const ex = x + u;
      const ey = Y[i] + v;
      const ang = Math.atan2(v, u);
      const hl = 0.3 * Math.hypot(u, v);
      xs.push(x, ex, NaN, ex, ex - hl * Math.cos(ang - 0.4), NaN, ex, ex - hl * Math.cos(ang + 0.4), NaN);
      ys.push(Y[i], ey, NaN, ey, ey - hl * Math.sin(ang - 0.4), NaN, ey, ey - hl * Math.sin(ang + 0.4), NaN);
    });
    newFigure(it).series.push({ type: 'line', x: xs, y: ys });
    return [];
  },
};

function odeOut(t: number[], y: number[][], nout: number): SV[] {
  const T = Arr.col(t);
  const Y = y[0].length === 1 ? Arr.col(y.map((r) => r[0])) : Arr.fromRows(y);
  return nout > 1 ? [T, Y] : [Y];
}

function corr(a: number[], b: number[]): number {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  a.forEach((v, i) => {
    sab += (v - ma) * (b[i] - mb);
    saa += (v - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  });
  return sab / Math.sqrt(saa * sbb);
}

function sampleFrom(pool: number[], k: number, replace: boolean, prob: number[] | undefined, it: Interpreter): Arr {
  it.usedRandom = true;
  if (!replace && k > pool.length) throw new ScriptError(`cannot take ${k} values without replacement from ${pool.length}`);
  const w = prob ? prob.slice() : pool.map(() => 1);
  const out: number[] = [];
  const avail = pool.slice();
  for (let i = 0; i < k; i++) {
    const total = w.reduce((s, v) => s + v, 0);
    let u = it.rng.next() * total;
    let j = 0;
    while (j < w.length - 1 && u >= w[j]) u -= w[j++];
    out.push(avail[j]);
    if (!replace) {
      avail.splice(j, 1);
      w.splice(j, 1);
    }
  }
  return Arr.row(out);
}

/** Normal probability plot: (x₍ᵢ₎, z((i − .5)/n)) with the line through the quartile points. */
function normalPlot(args: SV[], it: Interpreter): SV[] {
  const s = sorted(args[0]);
  const n = s.length;
  const z = s.map((_, i) => D.normInv((i + 0.5) / n));
  const fig = newFigure(it);
  fig.series.push({ type: 'scatter', x: s, y: z });
  const [q1, q3] = [s[Math.floor(0.25 * (n - 1))], s[Math.floor(0.75 * (n - 1))]];
  const [z1, z3] = [z[Math.floor(0.25 * (n - 1))], z[Math.floor(0.75 * (n - 1))]];
  const m = (z3 - z1) / (q3 - q1 || 1);
  fig.series.push({ type: 'line', x: [s[0], s[n - 1]], y: [z1 + m * (s[0] - q1), z1 + m * (s[n - 1] - q1)], style: 'r--' });
  fig.xlabel = fig.xlabel ?? 'observation';
  fig.ylabel = fig.ylabel ?? 'z percentile';
  return [];
}