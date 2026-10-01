/**
 * Probability distributions (Devore, Berk & Carlton ch. 3–6): pmf / pdf, cdf, quantile and random
 * samplers, plus the special functions they need (log Γ, regularized incomplete gamma and beta,
 * the normal cdf and its inverse). Parameterizations here are the mathematical ones; the R and
 * MATLAB spellings (rate vs mean, scale vs rate, failures vs trials) are adapted by their callers.
 */

// ------------------------------------------------------------------ special functions

const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

export function lgamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - lgamma(1 - z);
  z -= 1;
  let a = LANCZOS[0];
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

export function lchoose(n: number, k: number): number {
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}

/** Regularized lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 1000; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
    }
    return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - lgamma(a)));
  }
  // continued fraction for Q(a, x) (Lentz)
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const ratio = d * c;
    h *= ratio;
    if (Math.abs(ratio - 1) < 1e-16) break;
  }
  return Math.max(0, 1 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * h);
}

function betacf(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-300) d = 1e-300;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const ratio = d * c;
    h *= ratio;
    if (Math.abs(ratio - 1) < 1e-16) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function betaI(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Φ(z) to ~1e-15 (erfc through the incomplete gamma, a series near 0). */
export function normCdf(z: number): number {
  if (z < -38) return 0;
  if (z > 38) return 1;
  const x = Math.abs(z) / Math.SQRT2;
  const erfc = x < 0.5 ? 1 - erfSeries(x) : 1 - gammaP(0.5, x * x);
  return z < 0 ? erfc / 2 : 1 - erfc / 2;
}

function erfSeries(x: number): number {
  let sum = x;
  let term = x;
  for (let n = 1; n < 100; n++) {
    term *= (-x * x) / n;
    const t = term / (2 * n + 1);
    sum += t;
    if (Math.abs(t) < 1e-17) break;
  }
  return (2 / Math.sqrt(Math.PI)) * sum;
}

/** Φ⁻¹(p): Acklam's rational approximation refined by Newton (Halley) steps. */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let x: number;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  for (let i = 0; i < 2; i++) {
    const e = normCdf(x) - p;
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
    x -= u / (1 + (x * u) / 2);
  }
  return x;
}

// ------------------------------------------------------------------ distributions

export interface Dist {
  name: string;
  discrete: boolean;
  /** support bounds (for quantile search) */
  lo: number;
  hi: number;
  pdf(x: number): number;
  cdf(x: number): number;
  quantile?(p: number): number;
  mean: number;
  variance: number;
  /** a draw given uniform(0,1) and standard-normal sources */
  sample(u: () => number, z: () => number): number;
}

/** Quantile of a continuous distribution: bracket + bisection on the cdf. */
function continuousQuantile(d: Dist, p: number): number {
  if (p <= 0) return d.lo;
  if (p >= 1) return d.hi;
  // heavy tails (F(1, 2), t(1)) have no finite mean / variance: start from a finite guess and expand
  const base = Number.isFinite(d.mean) ? d.mean : Number.isFinite(d.lo) ? d.lo + 1 : 0;
  const spread = Number.isFinite(d.variance) && d.variance > 0 ? Math.sqrt(d.variance) : 1;
  let lo = Number.isFinite(d.lo) ? d.lo : base - 10 * spread;
  let hi = Number.isFinite(d.hi) ? d.hi : base + 10 * spread;
  while (d.cdf(lo) > p) lo -= Math.max(1, Math.abs(lo));
  while (d.cdf(hi) < p) hi += Math.max(1, Math.abs(hi));
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2;
    if (d.cdf(m) < p) lo = m;
    else hi = m;
    if (hi - lo < 1e-14 * Math.max(1, Math.abs(m))) break;
  }
  return (lo + hi) / 2;
}

/** Smallest integer x with F(x) ≥ p. */
function discreteQuantile(d: Dist, p: number): number {
  let x = Number.isFinite(d.lo) ? d.lo : Math.floor(d.mean - 10 * Math.sqrt(d.variance + 1));
  let F = d.cdf(x);
  const top = Number.isFinite(d.hi) ? d.hi : Infinity;
  while (F < p - 1e-12 && x < top) {
    x++;
    F = d.cdf(x);
  }
  return x;
}

export function quantileOf(d: Dist, p: number): number {
  if (d.quantile) return d.quantile(p);
  return d.discrete ? discreteQuantile(d, p) : continuousQuantile(d, p);
}

function discrete(name: string, lo: number, hi: number, pmf: (k: number) => number, mean: number, variance: number): Dist {
  const isInt = (x: number) => Math.abs(x - Math.round(x)) < 1e-9;
  const cache = new Map<number, number>();
  const cdf = (x: number) => {
    if (x < lo) return 0;
    if (x >= hi) return 1;
    const k = Math.floor(x + 1e-9);
    if (cache.has(k)) return cache.get(k)!;
    let s = 0;
    for (let j = Math.max(lo, Math.floor(mean - 40 * Math.sqrt(variance + 1)) - 1); j <= k; j++) s += pmf(j);
    const v = Math.min(1, s);
    if (cache.size < 10000) cache.set(k, v);
    return v;
  };
  return {
    name, discrete: true, lo, hi, mean, variance,
    pdf: (x) => (isInt(x) && x >= lo && x <= hi ? pmf(Math.round(x)) : 0),
    cdf,
    sample: (u) => {
      // inversion by sequential search from the lower end of the support
      const p = u();
      let k = Math.max(lo, 0);
      let s = 0;
      for (let guard = 0; guard < 1e6; guard++, k++) {
        s += pmf(k);
        if (s >= p || k >= hi) return k;
      }
      return k;
    },
  };
}

export function binomial(n: number, p: number): Dist {
  return discrete(`Bin(${n}, ${p})`, 0, n, (k) => (k < 0 || k > n ? 0 : Math.exp(lchoose(n, k) + (p === 0 ? (k === 0 ? 0 : -Infinity) : k * Math.log(p)) + (p === 1 ? (k === n ? 0 : -Infinity) : (n - k) * Math.log(1 - p)))), n * p, n * p * (1 - p));
}

export function poisson(mu: number): Dist {
  return discrete(`Poisson(${mu})`, 0, Infinity, (k) => (k < 0 ? 0 : Math.exp(k * Math.log(mu) - mu - lgamma(k + 1))), mu, mu);
}

/** n draws from a population of N with M successes (Devore's h(x; n, M, N)). */
export function hypergeometric(n: number, M: number, N: number): Dist {
  const lo = Math.max(0, n - N + M);
  const hi = Math.min(n, M);
  const pN = M / N;
  return discrete(`Hyp(${n}, ${M}, ${N})`, lo, hi, (k) => (k < lo || k > hi ? 0 : Math.exp(lchoose(M, k) + lchoose(N - M, n - k) - lchoose(N, n))), n * pN, ((N - n) / (N - 1)) * n * pN * (1 - pN));
}

/** Number of failures before the r-th success (R's dnbinom, MATLAB's nbinpdf). */
export function negbinFailures(r: number, p: number): Dist {
  return discrete(`NB(${r}, ${p})`, 0, Infinity, (k) => (k < 0 ? 0 : Math.exp(lgamma(k + r) - lgamma(r) - lgamma(k + 1) + r * Math.log(p) + k * Math.log(1 - p))), (r * (1 - p)) / p, (r * (1 - p)) / (p * p));
}

/** Number of failures before the first success (R's dgeom, MATLAB's geopdf). */
export function geometricFailures(p: number): Dist {
  return discrete(`Geom(${p})`, 0, Infinity, (k) => (k < 0 ? 0 : p * Math.pow(1 - p, k)), (1 - p) / p, (1 - p) / (p * p));
}

export function normal(mu: number, sigma: number): Dist {
  return {
    name: `N(${mu}, ${sigma})`, discrete: false, lo: -Infinity, hi: Infinity, mean: mu, variance: sigma * sigma,
    pdf: (x) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI)),
    cdf: (x) => normCdf((x - mu) / sigma),
    quantile: (p) => mu + sigma * normInv(p),
    sample: (_u, z) => mu + sigma * z(),
  };
}

export function uniform(a: number, b: number): Dist {
  return {
    name: `Unif(${a}, ${b})`, discrete: false, lo: a, hi: b, mean: (a + b) / 2, variance: (b - a) ** 2 / 12,
    pdf: (x) => (x >= a && x <= b ? 1 / (b - a) : 0),
    cdf: (x) => (x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a)),
    quantile: (p) => a + p * (b - a),
    sample: (u) => a + (b - a) * u(),
  };
}

export function exponential(rate: number): Dist {
  return {
    name: `Exp(${rate})`, discrete: false, lo: 0, hi: Infinity, mean: 1 / rate, variance: 1 / (rate * rate),
    pdf: (x) => (x < 0 ? 0 : rate * Math.exp(-rate * x)),
    cdf: (x) => (x <= 0 ? 0 : 1 - Math.exp(-rate * x)),
    quantile: (p) => -Math.log(1 - p) / rate,
    sample: (u) => -Math.log(1 - u()) / rate,
  };
}

/** Marsaglia–Tsang. */
function gammaSample(a: number, u: () => number, z: () => number): number {
  if (a < 1) return gammaSample(a + 1, u, z) * Math.pow(u(), 1 / a);
  const d = a - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = z();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const w = u();
    if (w < 1 - 0.0331 * x ** 4 || Math.log(w) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Gamma with shape α and scale β (Devore's parameterization). */
export function gamma(alpha: number, beta: number): Dist {
  return {
    name: `Gamma(${alpha}, ${beta})`, discrete: false, lo: 0, hi: Infinity, mean: alpha * beta, variance: alpha * beta * beta,
    pdf: (x) => (x < 0 ? 0 : x === 0 ? (alpha === 1 ? 1 / beta : alpha < 1 ? Infinity : 0) : Math.exp((alpha - 1) * Math.log(x) - x / beta - lgamma(alpha) - alpha * Math.log(beta))),
    cdf: (x) => gammaP(alpha, Math.max(0, x) / beta),
    sample: (u, z) => beta * gammaSample(alpha, u, z),
  };
}

/** Weibull with shape α and scale β. */
export function weibull(alpha: number, beta: number): Dist {
  return {
    name: `Weibull(${alpha}, ${beta})`, discrete: false, lo: 0, hi: Infinity,
    mean: beta * Math.exp(lgamma(1 + 1 / alpha)), variance: beta * beta * (Math.exp(lgamma(1 + 2 / alpha)) - Math.exp(2 * lgamma(1 + 1 / alpha))),
    pdf: (x) => (x < 0 ? 0 : (alpha / beta) * Math.pow(x / beta, alpha - 1) * Math.exp(-Math.pow(x / beta, alpha))),
    cdf: (x) => (x <= 0 ? 0 : 1 - Math.exp(-Math.pow(x / beta, alpha))),
    quantile: (p) => beta * Math.pow(-Math.log(1 - p), 1 / alpha),
    sample: (u) => beta * Math.pow(-Math.log(1 - u()), 1 / alpha),
  };
}

export function lognormal(mu: number, sigma: number): Dist {
  return {
    name: `LN(${mu}, ${sigma})`, discrete: false, lo: 0, hi: Infinity, mean: Math.exp(mu + (sigma * sigma) / 2), variance: Math.exp(2 * mu + sigma * sigma) * (Math.exp(sigma * sigma) - 1),
    pdf: (x) => (x <= 0 ? 0 : Math.exp(-0.5 * ((Math.log(x) - mu) / sigma) ** 2) / (x * sigma * Math.sqrt(2 * Math.PI))),
    cdf: (x) => (x <= 0 ? 0 : normCdf((Math.log(x) - mu) / sigma)),
    quantile: (p) => Math.exp(mu + sigma * normInv(p)),
    sample: (_u, z) => Math.exp(mu + sigma * z()),
  };
}

/** Beta(α, β) on [A, B] (Devore's general beta; standard when A = 0, B = 1). */
export function betaDist(a: number, b: number, A = 0, B = 1): Dist {
  const w = B - A;
  return {
    name: `Beta(${a}, ${b})`, discrete: false, lo: A, hi: B, mean: A + (w * a) / (a + b), variance: (w * w * a * b) / ((a + b) ** 2 * (a + b + 1)),
    pdf: (x) => {
      const t = (x - A) / w;
      return t < 0 || t > 1 ? 0 : Math.exp((a - 1) * Math.log(t) + (b - 1) * Math.log(1 - t) + lgamma(a + b) - lgamma(a) - lgamma(b)) / w;
    },
    cdf: (x) => betaI(a, b, (x - A) / w),
    sample: (u, z) => {
      const g1 = gammaSample(a, u, z);
      const g2 = gammaSample(b, u, z);
      return A + (w * g1) / (g1 + g2);
    },
  };
}

export function chiSquared(nu: number): Dist {
  return { ...gamma(nu / 2, 2), name: `χ²(${nu})` };
}

export function studentT(nu: number): Dist {
  return {
    name: `t(${nu})`, discrete: false, lo: -Infinity, hi: Infinity, mean: nu > 1 ? 0 : NaN, variance: nu > 2 ? nu / (nu - 2) : Infinity,
    pdf: (x) => Math.exp(lgamma((nu + 1) / 2) - lgamma(nu / 2) - 0.5 * Math.log(nu * Math.PI) - ((nu + 1) / 2) * Math.log(1 + (x * x) / nu)),
    cdf: (x) => {
      const ib = betaI(nu / 2, 0.5, nu / (nu + x * x));
      return x >= 0 ? 1 - ib / 2 : ib / 2;
    },
    sample: (u, z) => z() / Math.sqrt((2 * gammaSample(nu / 2, u, z)) / nu),
  };
}

export function fDist(d1: number, d2: number): Dist {
  return {
    name: `F(${d1}, ${d2})`, discrete: false, lo: 0, hi: Infinity, mean: d2 > 2 ? d2 / (d2 - 2) : NaN,
    variance: d2 > 4 ? (2 * d2 * d2 * (d1 + d2 - 2)) / (d1 * (d2 - 2) ** 2 * (d2 - 4)) : Infinity,
    pdf: (x) => (x <= 0 ? 0 : Math.exp(0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) - Math.log(x) - (lgamma(d1 / 2) + lgamma(d2 / 2) - lgamma((d1 + d2) / 2)))),
    cdf: (x) => (x <= 0 ? 0 : betaI(d1 / 2, d2 / 2, (d1 * x) / (d1 * x + d2))),
    sample: (u, z) => (2 * gammaSample(d1 / 2, u, z)) / d1 / ((2 * gammaSample(d2 / 2, u, z)) / d2),
  };
}