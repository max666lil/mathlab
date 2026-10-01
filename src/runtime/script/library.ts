/**
 * Built-in functions of the script language (MATLAB names and conventions): constructors, element-wise
 * math, reductions (column-wise on matrices), numerical calculus, random numbers, text output and plots.
 */
import { Arr, SV, Fn, ScriptError, isArr, isFn, toArr, num, simplifyValue } from './values';
import type { Interpreter, Series } from './interp';
import { integrateNumeric } from '../../math-core/numeric/quad';
import { brent } from '../../math-core/numeric/roots';
import { BOOK_LIBRARY } from './library-books';

type LibFn = (args: SV[], nout: number, it: Interpreter) => SV[];

const one = (f: (args: SV[], it: Interpreter) => SV): LibFn => (args, _n, it) => [f(args, it)];

function map1(f: (x: number) => number): LibFn {
  return one(([a]) => {
    if (a === undefined) throw new ScriptError('missing argument');
    if (typeof a === 'number') return f(a);
    const A = toArr(a);
    const out = new Arr(A.r, A.c, A.d.map(f));
    return simplifyValue(out);
  });
}

function map2(f: (x: number, y: number) => number): LibFn {
  return one(([a, b]) => {
    if (a === undefined || b === undefined) throw new ScriptError('two arguments expected');
    if (typeof a === 'number' && typeof b === 'number') return f(a, b);
    const A = toArr(a);
    const B = toArr(b);
    const r = Math.max(A.r, B.r);
    const c = Math.max(A.c, B.c);
    const out = Arr.zeros(r, c);
    for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) out.d[i + j * r] = f(A.n === 1 ? A.d[0] : A.d[i + j * A.r], B.n === 1 ? B.d[0] : B.d[i + j * B.r]);
    return simplifyValue(out);
  });
}

/** size arguments: (n) → n×n, (m, n) → m×n, ([m n]) → m×n; none → 1×1 */
function dims(args: SV[]): [number, number] {
  if (!args.length) return [1, 1];
  if (args.length === 1) {
    const a = toArr(args[0]);
    if (a.n === 2) return [a.d[0], a.d[1]];
    const n = num(args[0]);
    return [n, n];
  }
  return [num(args[0]), num(args[1])];
}

function filled(args: SV[], f: () => number): SV {
  const [r, c] = dims(args);
  if (!(r >= 0 && c >= 0) || r * c > 2e7) throw new ScriptError('array size out of range');
  const a = Arr.zeros(r, c);
  for (let i = 0; i < a.n; i++) a.d[i] = f();
  return simplifyValue(a);
}

/** Reduction along columns (vectors reduce to a number); dim 2 reduces rows. */
function reduce(f: (xs: number[]) => number): LibFn {
  return one(([a, d]) => {
    const A = toArr(a ?? Arr.zeros(0, 0));
    const dim = d === undefined ? (A.r === 1 ? 2 : 1) : num(d);
    if (dim === 2) {
      const out = Arr.zeros(A.r, 1);
      for (let i = 0; i < A.r; i++) out.d[i] = f(Array.from({ length: A.c }, (_, j) => A.d[i + j * A.r]));
      return simplifyValue(out);
    }
    const out = Arr.zeros(1, A.c);
    for (let j = 0; j < A.c; j++) out.d[j] = f(Array.from(A.d.subarray(j * A.r, (j + 1) * A.r)));
    return simplifyValue(out);
  });
}

/** Cumulative operation along the vector (or down the columns). */
function cumulative(f: (acc: number, x: number) => number): LibFn {
  return one(([a]) => {
    const A = toArr(a);
    const out = new Arr(A.r, A.c, new Float64Array(A.n));
    if (A.r === 1 || A.c === 1) {
      let s = NaN;
      for (let i = 0; i < A.n; i++) out.d[i] = s = i === 0 ? A.d[0] : f(s, A.d[i]);
    } else
      for (let j = 0; j < A.c; j++) {
        let s = NaN;
        for (let i = 0; i < A.r; i++) out.d[i + j * A.r] = s = i === 0 ? A.d[j * A.r] : f(s, A.d[i + j * A.r]);
      }
    return out;
  });
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const variance = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** MATLAB's quantile: linear interpolation on (i − 0.5)/n. */
function quantile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const t = n * p - 0.5;
  if (t <= 0) return s[0];
  if (t >= n - 1) return s[n - 1];
  const k = Math.floor(t);
  return s[k] + (t - k) * (s[k + 1] - s[k]);
}

function minmax(which: 'min' | 'max'): LibFn {
  const better = which === 'max' ? (x: number, y: number) => x > y : (x: number, y: number) => x < y;
  return (args, nout) => {
    if (args.length >= 2 && !(isArr(args[1]) && (args[1] as Arr).n === 0)) return [map2((x, y) => (better(x, y) ? x : y))([args[0], args[1]], 1, undefined as unknown as Interpreter)[0]];
    const A = toArr(args[0]);
    const cols = A.r === 1 || A.c === 1 ? [Array.from(A.d)] : Array.from({ length: A.c }, (_, j) => Array.from(A.d.subarray(j * A.r, (j + 1) * A.r)));
    const vals: number[] = [];
    const idx: number[] = [];
    for (const col of cols) {
      let bi = 0;
      for (let i = 1; i < col.length; i++) if (better(col[i], col[bi]) || Number.isNaN(col[bi])) bi = i;
      vals.push(col[bi]);
      idx.push(bi + 1);
    }
    const out = [simplifyValue(Arr.row(vals)), simplifyValue(Arr.row(idx))];
    return out.slice(0, Math.max(1, nout));
  };
}

function callFn(f: SV, x: number | Arr): SV {
  if (!isFn(f)) throw new ScriptError('expected a function handle, e.g. @(x) x.^2');
  return f.call([x], 1)[0];
}
const scalarFn = (f: SV) => (x: number) => num(callFn(f, x), 'a number from the function');

// ------------------------------------------------------------------ text

function formatf(fmt: string, args: SV[]): string {
  const vals: (number | string)[] = [];
  for (const a of args) {
    if (typeof a === 'string') vals.push(a);
    else if (typeof a === 'number') vals.push(a);
    else if (isArr(a)) vals.push(...Array.from(a.d));
  }
  const esc = fmt.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  let out = '';
  let k = 0;
  do {
    out += esc.replace(/%([-+ 0]*)(\d*)(?:\.(\d+))?([dfgesi%])/g, (_m, flags: string, w: string, p: string | undefined, c: string) => {
      if (c === '%') return '%';
      const v = vals[k++];
      if (v === undefined) return '';
      let s: string;
      if (c === 's') s = String(v);
      else {
        const x = typeof v === 'string' ? Number(v) : v;
        if (c === 'd' || c === 'i') s = Number.isInteger(x) ? String(x) : String(+x.toPrecision(6));
        else if (c === 'f') s = x.toFixed(p ? +p : 6);
        else if (c === 'e') s = x.toExponential(p ? +p : 6);
        else s = String(+x.toPrecision(p ? +p : 5));
        if (flags.includes('+') && x >= 0) s = '+' + s;
      }
      const width = w ? +w : 0;
      return flags.includes('-') ? s.padEnd(width) : s.padStart(width, flags.includes('0') ? '0' : ' ');
    });
  } while (k < vals.length && k > 0 && /%[^%]/.test(esc));
  return out;
}

function numText(x: SV, digits?: number): string {
  if (typeof x === 'string') return x;
  const f = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toPrecision(digits ?? 5)));
  if (typeof x === 'number') return f(x);
  if (isArr(x)) return x.rows().map((r) => r.map(f).join('  ')).join('\n');
  return String(x);
}

// ------------------------------------------------------------------ plots

function styleOf(s: SV | undefined): { scatter: boolean; style?: string } {
  if (typeof s !== 'string') return { scatter: false };
  return { scatter: /[o.*x+sd^v]/.test(s) && !/-/.test(s), style: s };
}

function plot(args: SV[], it: Interpreter, type: 'line' | 'scatter' | 'stairs' = 'line') {
  const fig = it.figure();
  if (!it.holdOn) fig.series = [];
  const rest = [...args];
  while (rest.length) {
    let x: number[];
    let y: number[];
    const a = rest.shift()!;
    if (!rest.length || typeof rest[0] === 'string') {
      y = Array.from(toArr(a).d);
      x = y.map((_, i) => i + 1);
    } else {
      x = Array.from(toArr(a).d);
      y = Array.from(toArr(rest.shift()!).d);
    }
    if (x.length !== y.length) throw new ScriptError(`plot: x has ${x.length} values, y has ${y.length}`);
    const st = typeof rest[0] === 'string' ? styleOf(rest.shift()) : { scatter: false };
    fig.series.push({ type: st.scatter ? 'scatter' : type, x, y, style: st.style });
  }
}

function histogram(args: SV[], it: Interpreter, density: boolean): Series {
  const xs = Array.from(toArr(args[0]).d).filter(Number.isFinite);
  if (!xs.length) throw new ScriptError('hist: no data');
  let edges: number[];
  const b = args[1];
  if (b !== undefined && typeof b !== 'string' && isArr(b) && b.n > 1) edges = Array.from(b.d);
  else {
    const n = b !== undefined && typeof b !== 'string' ? Math.max(1, Math.round(num(b))) : Math.max(5, Math.min(60, Math.ceil(Math.sqrt(xs.length))));
    let lo = Math.min(...xs);
    let hi = Math.max(...xs);
    if (hi - lo < 1e-12) [lo, hi] = [lo - 0.5, hi + 0.5];
    edges = Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
  }
  const counts = new Array(edges.length - 1).fill(0);
  for (const x of xs) {
    let k = edges.findIndex((e, i) => i < edges.length - 1 && x >= e && x < edges[i + 1]);
    if (k < 0 && x === edges[edges.length - 1]) k = edges.length - 2;
    if (k >= 0) counts[k]++;
  }
  const w = edges[1] - edges[0];
  const y = density ? counts.map((c) => c / (xs.length * w)) : counts;
  const s: Series = { type: 'bar', x: edges.slice(0, -1).map((e, i) => (e + edges[i + 1]) / 2), y, width: w };
  const fig = it.figure();
  if (!it.holdOn) fig.series = [];
  fig.series.push(s);
  return s;
}

// ------------------------------------------------------------------ small linear algebra

function det(a: Arr): number {
  const n = a.r;
  if (n !== a.c) throw new ScriptError('det needs a square matrix');
  const M = a.rows();
  let d = 1;
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (Math.abs(M[p][k]) < 1e-300) return 0;
    if (p !== k) {
      [M[k], M[p]] = [M[p], M[k]];
      d = -d;
    }
    d *= M[k][k];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      for (let j = k; j < n; j++) M[i][j] -= f * M[k][j];
    }
  }
  return d;
}

function inv(a: Arr): Arr {
  const n = a.r;
  if (n !== a.c) throw new ScriptError('inv needs a square matrix');
  const M = a.rows().map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (Math.abs(M[p][k]) < 1e-14) throw new ScriptError('matrix is singular');
    [M[k], M[p]] = [M[p], M[k]];
    const piv = M[k][k];
    for (let j = 0; j < 2 * n; j++) M[k][j] /= piv;
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const f = M[i][k];
      for (let j = 0; j < 2 * n; j++) M[i][j] -= f * M[k][j];
    }
  }
  return Arr.fromRows(M.map((row) => row.slice(n)));
}

/** Least-squares polynomial fit (normal equations on a Vandermonde matrix), highest power first. */
function polyfit(x: number[], y: number[], deg: number): number[] {
  const m = deg + 1;
  const A = Array.from({ length: m }, () => new Array(m).fill(0));
  const b = new Array(m).fill(0);
  for (let k = 0; k < x.length; k++) {
    const pw = Array.from({ length: m }, (_, i) => x[k] ** (deg - i));
    for (let i = 0; i < m; i++) {
      b[i] += pw[i] * y[k];
      for (let j = 0; j < m; j++) A[i][j] += pw[i] * pw[j];
    }
  }
  const sol = inv(Arr.fromRows(A));
  return Array.from({ length: m }, (_, i) => b.reduce((s, bj, j) => s + sol.get(i, j) * bj, 0));
}

// ------------------------------------------------------------------ the library

export const LIBRARY: Record<string, LibFn> = {
  // constants
  pi: one(() => Math.PI),
  e: one(() => Math.E),
  Inf: one(() => Infinity),
  inf: one(() => Infinity),
  NaN: one(() => NaN),
  nan: one(() => NaN),
  eps: one(() => Number.EPSILON),
  true: one(() => 1),
  false: one(() => 0),
  // constructors
  zeros: one((a) => filled(a, () => 0)),
  ones: one((a) => filled(a, () => 1)),
  eye: one((a) => {
    const [r, c] = dims(a);
    const m = Arr.zeros(r, c);
    for (let i = 0; i < Math.min(r, c); i++) m.d[i + i * r] = 1;
    return simplifyValue(m);
  }),
  linspace: one(([a, b, n]) => {
    const N = n === undefined ? 100 : Math.round(num(n));
    const lo = num(a);
    const hi = num(b);
    return Arr.row(Array.from({ length: N }, (_, i) => (N === 1 ? hi : lo + ((hi - lo) * i) / (N - 1))));
  }),
  repmat: one(([a, m, n]) => {
    const A = toArr(a);
    const [R, C] = n === undefined ? dims([m]) : [num(m), num(n)];
    const out = Arr.zeros(A.r * R, A.c * C);
    for (let bj = 0; bj < C; bj++) for (let bi = 0; bi < R; bi++) for (let j = 0; j < A.c; j++) for (let i = 0; i < A.r; i++) out.d[bi * A.r + i + (bj * A.c + j) * out.r] = A.d[i + j * A.r];
    return simplifyValue(out);
  }),
  reshape: one(([a, m, n]) => {
    const A = toArr(a);
    const [R, C] = n === undefined ? dims([m]) : [num(m), num(n)];
    if (R * C !== A.n) throw new ScriptError(`reshape: ${A.n} elements cannot become ${R}×${C}`);
    return new Arr(R, C, A.d.slice());
  }),
  // sizes
  numel: one(([a]) => (typeof a === 'string' ? a.length : toArr(a).n)),
  length: one(([a]) => (typeof a === 'string' ? a.length : toArr(a).n === 0 ? 0 : Math.max(toArr(a).r, toArr(a).c))),
  size: (args, nout) => {
    const A = toArr(args[0]);
    if (args[1] !== undefined) return [num(args[1]) === 1 ? A.r : A.c];
    return nout >= 2 ? [A.r, A.c] : [Arr.row([A.r, A.c])];
  },
  isempty: one(([a]) => (typeof a === 'string' ? (a.length ? 0 : 1) : toArr(a).n === 0 ? 1 : 0)),
  isscalar: one(([a]) => (typeof a === 'number' || (isArr(a) && a.n === 1) ? 1 : 0)),
  isvector: one(([a]) => (isArr(a) && a.isVector() ? 1 : 0)),
  isnan: map1((x) => (Number.isNaN(x) ? 1 : 0)),
  isinf: map1((x) => (x === Infinity || x === -Infinity ? 1 : 0)),
  // element-wise math
  abs: map1(Math.abs),
  sqrt: map1(Math.sqrt),
  exp: map1(Math.exp),
  log: map1(Math.log),
  log2: map1(Math.log2),
  log10: map1(Math.log10),
  sin: map1(Math.sin),
  cos: map1(Math.cos),
  tan: map1(Math.tan),
  asin: map1(Math.asin),
  acos: map1(Math.acos),
  atan: map1(Math.atan),
  sinh: map1(Math.sinh),
  cosh: map1(Math.cosh),
  tanh: map1(Math.tanh),
  floor: map1(Math.floor),
  ceil: map1(Math.ceil),
  round: map1((x) => Math.sign(x) * Math.round(Math.abs(x))),
  fix: map1(Math.trunc),
  sign: map1(Math.sign),
  atan2: map2(Math.atan2),
  hypot: map2(Math.hypot),
  mod: map2((x, y) => (y === 0 ? x : x - Math.floor(x / y) * y)),
  rem: map2((x, y) => (y === 0 ? x : x - Math.trunc(x / y) * y)),
  power: map2(Math.pow),
  factorial: map1((n) => {
    if (!Number.isInteger(n) || n < 0) return NaN;
    let r = 1;
    for (let k = 2; k <= n; k++) r *= k;
    return r;
  }),
  nchoosek: map2((n, k) => {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return Math.round(r);
  }),
  gamma: map1((z) => {
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    const G = (x: number): number => {
      if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * G(1 - x));
      x -= 1;
      let a = c[0];
      for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
      const t = x + g + 0.5;
      return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
    };
    return G(z);
  }),
  // reductions
  sum: reduce((xs) => xs.reduce((s, x) => s + x, 0)),
  prod: reduce((xs) => xs.reduce((s, x) => s * x, 1)),
  mean: reduce(mean),
  median: reduce(median),
  var: reduce(variance),
  std: reduce((xs) => Math.sqrt(variance(xs))),
  mode: reduce((xs) => {
    const counts = new Map<number, number>();
    for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
    let best = NaN;
    let bc = 0;
    for (const [x, c] of [...counts].sort((a, b) => a[0] - b[0])) if (c > bc) [best, bc] = [x, c];
    return best;
  }),
  range: reduce((xs) => Math.max(...xs) - Math.min(...xs)),
  any: reduce((xs) => (xs.some((x) => x !== 0) ? 1 : 0)),
  all: reduce((xs) => (xs.every((x) => x !== 0) ? 1 : 0)),
  quantile: one(([a, p]) => {
    const xs = Array.from(toArr(a).d);
    const P = toArr(p);
    return simplifyValue(new Arr(P.r, P.c, P.d.map((q) => quantile(xs, q))));
  }),
  prctile: one(([a, p]) => {
    const xs = Array.from(toArr(a).d);
    const P = toArr(p);
    return simplifyValue(new Arr(P.r, P.c, P.d.map((q) => quantile(xs, q / 100))));
  }),
  iqr: one(([a]) => {
    const xs = Array.from(toArr(a).d);
    return quantile(xs, 0.75) - quantile(xs, 0.25);
  }),
  cumsum: cumulative((s, x) => s + x),
  cumprod: cumulative((s, x) => s * x),
  max: minmax('max'),
  min: minmax('min'),
  sort: (args, nout) => {
    const A = toArr(args[0]);
    const desc = args[1] === 'descend';
    const order = Array.from(A.d.keys()).sort((i, j) => (desc ? A.d[j] - A.d[i] : A.d[i] - A.d[j]));
    const mk = (vals: number[]) => (A.c === 1 && A.r > 1 ? Arr.col(vals) : Arr.row(vals));
    return [mk(order.map((i) => A.d[i])), mk(order.map((i) => i + 1))].slice(0, Math.max(1, nout));
  },
  find: one(([a, k]) => {
    const A = toArr(a);
    const out: number[] = [];
    for (let i = 0; i < A.n && (k === undefined || out.length < num(k)); i++) if (A.d[i] !== 0) out.push(i + 1);
    return A.c === 1 && A.r > 1 ? Arr.col(out) : Arr.row(out);
  }),
  unique: one(([a]) => Arr.row([...new Set(Array.from(toArr(a).d))].sort((x, y) => x - y))),
  fliplr: one(([a]) => {
    const A = toArr(a);
    return Arr.fromRows(A.rows().map((row) => [...row].reverse()));
  }),
  flipud: one(([a]) => Arr.fromRows([...toArr(a).rows()].reverse())),
  // numerical calculus
  diff: one(([a]) => {
    const A = toArr(a);
    const d = Array.from({ length: Math.max(0, A.n - 1) }, (_, i) => A.d[i + 1] - A.d[i]);
    return A.c === 1 && A.r > 1 ? Arr.col(d) : Arr.row(d);
  }),
  trapz: one(([a, b]) => {
    const y = Array.from(toArr(b ?? a).d);
    const x = b === undefined ? y.map((_, i) => i + 1) : Array.from(toArr(a).d);
    let s = 0;
    for (let i = 0; i + 1 < y.length; i++) s += ((x[i + 1] - x[i]) * (y[i] + y[i + 1])) / 2;
    return s;
  }),
  cumtrapz: one(([a, b]) => {
    const y = Array.from(toArr(b ?? a).d);
    const x = b === undefined ? y.map((_, i) => i + 1) : Array.from(toArr(a).d);
    const out = [0];
    for (let i = 0; i + 1 < y.length; i++) out.push(out[i] + ((x[i + 1] - x[i]) * (y[i] + y[i + 1])) / 2);
    return Arr.row(out);
  }),
  integral: one(([f, a, b]) => {
    const q = integrateNumeric(scalarFn(f), num(a), num(b), 1e-10);
    if (!q.ok) throw new ScriptError('integral did not converge');
    return q.value;
  }),
  fzero: one(([f, x0]) => {
    const g = scalarFn(f);
    const X = toArr(x0);
    let [a, b] = X.n >= 2 ? [X.d[0], X.d[1]] : [X.d[0], X.d[0]];
    if (X.n < 2) {
      // expand a bracket around the starting point
      let h = Math.max(0.1, Math.abs(a) * 0.1);
      for (let k = 0; k < 60 && Math.sign(g(a)) === Math.sign(g(b)); k++) {
        a -= h;
        b += h;
        h *= 1.6;
      }
    }
    if (Math.sign(g(a)) === Math.sign(g(b))) throw new ScriptError('fzero: no sign change found');
    return brent(g, a, b);
  }),
  polyfit: one(([x, y, n]) => Arr.row(polyfit(Array.from(toArr(x).d), Array.from(toArr(y).d), Math.round(num(n))))),
  polyval: one(([p, x]) => {
    const P = Array.from(toArr(p).d);
    const X = toArr(x);
    return simplifyValue(new Arr(X.r, X.c, X.d.map((t) => P.reduce((s, c) => s * t + c, 0))));
  }),
  interp1: one(([x, y, q]) => {
    const X = Array.from(toArr(x).d);
    const Y = Array.from(toArr(y).d);
    const Q = toArr(q);
    return simplifyValue(
      new Arr(Q.r, Q.c, Q.d.map((t) => {
        for (let i = 0; i + 1 < X.length; i++) if (t >= X[i] && t <= X[i + 1]) return Y[i] + ((Y[i + 1] - Y[i]) * (t - X[i])) / (X[i + 1] - X[i]);
        return NaN;
      })),
    );
  }),
  arrayfun: one(([f, a]) => {
    const A = toArr(a);
    return simplifyValue(new Arr(A.r, A.c, A.d.map((x) => num(callFn(f, x)))));
  }),
  feval: (args, nout) => {
    const [f, ...rest] = args;
    if (!isFn(f)) throw new ScriptError('feval needs a function handle');
    return (f as Fn).call(rest, nout);
  },
  // linear algebra
  det: one(([a]) => det(toArr(a))),
  inv: one(([a]) => inv(toArr(a))),
  trace: one(([a]) => {
    const A = toArr(a);
    let s = 0;
    for (let i = 0; i < Math.min(A.r, A.c); i++) s += A.get(i, i);
    return s;
  }),
  dot: one(([a, b]) => {
    const A = toArr(a);
    const B = toArr(b);
    if (A.n !== B.n) throw new ScriptError('dot: vectors of different lengths');
    return A.d.reduce((s, x, i) => s + x * B.d[i], 0);
  }),
  cross: one(([a, b]) => {
    const [x1, y1, z1] = toArr(a).d;
    const [x2, y2, z2] = toArr(b).d;
    const v = [y1 * z2 - z1 * y2, z1 * x2 - x1 * z2, x1 * y2 - y1 * x2];
    return toArr(a).r === 1 ? Arr.row(v) : Arr.col(v);
  }),
  norm: one(([a, p]) => {
    const A = toArr(a);
    const P = p === undefined ? 2 : p === 'inf' || p === 'Inf' ? Infinity : num(p);
    if (P === Infinity) return Math.max(...Array.from(A.d, Math.abs));
    return Math.pow(A.d.reduce((s, x) => s + Math.abs(x) ** P, 0), 1 / P);
  }),
  transpose: one(([a]) => {
    const A = toArr(a);
    const out = Arr.zeros(A.c, A.r);
    for (let i = 0; i < A.r; i++) for (let j = 0; j < A.c; j++) out.d[j + i * A.c] = A.d[i + j * A.r];
    return simplifyValue(out);
  }),
  // random numbers (seeded: re-running a script reproduces them)
  rng: one(([s], it) => {
    it.rng.seed(s === undefined || typeof s === 'string' ? 0 : num(s));
    return undefined as unknown as SV;
  }),
  rand: one((a, it) => {
    it.usedRandom = true;
    return filled(a, () => it.rng.next());
  }),
  randn: one((a, it) => {
    it.usedRandom = true;
    return filled(a, () => it.rng.normal());
  }),
  randi: one(([m, ...a], it) => {
    it.usedRandom = true;
    const M = toArr(m);
    const [lo, hi] = M.n >= 2 ? [M.d[0], M.d[1]] : [1, M.d[0]];
    return filled(a, () => lo + Math.floor(it.rng.next() * (hi - lo + 1)));
  }),
  randperm: one(([n], it) => {
    it.usedRandom = true;
    const N = Math.round(num(n));
    const p = Array.from({ length: N }, (_, i) => i + 1);
    for (let i = N - 1; i > 0; i--) {
      const j = Math.floor(it.rng.next() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    return Arr.row(p);
  }),
  // text
  disp: (args, _n, it) => {
    it.write(numText(args[0] ?? '') + '\n');
    return [];
  },
  fprintf: (args, _n, it) => {
    const [fmt, ...rest] = args;
    it.write(formatf(typeof fmt === 'string' ? fmt : numText(fmt), rest));
    return [];
  },
  sprintf: one(([fmt, ...rest]) => formatf(typeof fmt === 'string' ? fmt : numText(fmt), rest)),
  num2str: one(([x, d]) => numText(x, d === undefined ? undefined : num(d))),
  strcat: one((args) => args.map((a) => numText(a)).join('')),
  error: one(([m, ...rest]) => {
    throw new ScriptError(formatf(typeof m === 'string' ? m : 'error', rest));
  }),
  warning: (args, _n, it) => {
    it.output.push(`Warning: ${formatf(typeof args[0] === 'string' ? args[0] : '', args.slice(1))}`);
    return [];
  },
  // plots
  plot: (args, _n, it) => {
    plot(args, it);
    return [];
  },
  scatter: (args, _n, it) => {
    plot(args.slice(0, 2), it, 'scatter');
    return [];
  },
  stairs: (args, _n, it) => {
    plot(args, it, 'stairs');
    return [];
  },
  bar: (args, _n, it) => {
    const fig = it.figure();
    if (!it.holdOn) fig.series = [];
    const y = Array.from(toArr(args.length > 1 ? args[1] : args[0]).d);
    const x = args.length > 1 ? Array.from(toArr(args[0]).d) : y.map((_, i) => i + 1);
    fig.series.push({ type: 'bar', x, y, width: x.length > 1 ? (x[1] - x[0]) * 0.8 : 0.8 });
    return [];
  },
  hist: (args, nout, it) => {
    const s = histogram(args, it, false);
    return nout > 1 ? [Arr.row(s.y), Arr.row(s.x)] : [];
  },
  histogram: (args, _n, it) => {
    const i = args.findIndex((a) => typeof a === 'string' && a.toLowerCase() === 'normalization');
    const density = i >= 0 && typeof args[i + 1] === 'string' && (args[i + 1] as string).toLowerCase() === 'pdf';
    histogram(i >= 0 ? args.slice(0, i) : args, it, density);
    return [];
  },
  fplot: (args, _n, it) => {
    const [f, r] = args;
    const R = r === undefined ? [-5, 5] : Array.from(toArr(r).d);
    const xs = Array.from({ length: 400 }, (_, i) => R[0] + ((R[1] - R[0]) * i) / 399);
    const fig = it.figure();
    if (!it.holdOn) fig.series = [];
    fig.series.push({ type: 'line', x: xs, y: xs.map((x) => num(callFn(f, x))) });
    return [];
  },
  title: (args, _n, it) => {
    it.figure().title = numText(args[0] ?? '');
    return [];
  },
  xlabel: (args, _n, it) => {
    it.figure().xlabel = numText(args[0] ?? '');
    return [];
  },
  ylabel: (args, _n, it) => {
    it.figure().ylabel = numText(args[0] ?? '');
    return [];
  },
  legend: (args, _n, it) => {
    const fig = it.figure();
    args.forEach((a, i) => fig.series[i] && (fig.series[i].label = numText(a)));
    return [];
  },
  axis: () => [],
  grid: () => [],
  hold: (args, _n, it) => {
    it.holdOn = args[0] !== 'off';
    return [];
  },
};
// the course-book functions (distributions, descriptive statistics, numerical calculus); Devore's
// conventions take precedence where MATLAB and the book differ (iqr from hinges)
Object.assign(LIBRARY, BOOK_LIBRARY);