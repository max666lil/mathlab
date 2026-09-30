/**
 * Numeric limits. These produce *evidence*, not proofs: results are labelled heuristic by callers
 * unless a symbolic argument (continuity) applies.
 */

type F1 = (x: number) => number;

export type LimitKind = 'finite' | '+inf' | '-inf' | 'dne';

export interface NumericLimit {
  kind: LimitKind;
  value?: number;
  /** one-sided results when approaching a finite point */
  left?: NumericLimit;
  right?: NumericLimit;
  evidence: string;
}

const fmt = (x: number) => (Math.abs(x) >= 1e6 || (Math.abs(x) < 1e-4 && x !== 0) ? x.toExponential(3) : String(+x.toPrecision(6)));

/** Aitken's Δ² extrapolation of three consecutive terms (falls back to the last term). */
function aitken(v0: number, v1: number, v2: number): number {
  const den = v2 - 2 * v1 + v0;
  if (!Number.isFinite(den) || Math.abs(den) < 1e-300) return v2;
  const a = v2 - ((v2 - v1) * (v2 - v1)) / den;
  return Number.isFinite(a) && Math.abs(a - v2) <= 10 * Math.abs(v2 - v1) + 1e-15 ? a : v2;
}

const snap = (x: number, scale: number) => (Math.abs(x) < 1e-10 * Math.max(1, scale) ? 0 : x);

/**
 * Settled value of a sequence that converges until floating-point noise takes over: the stretch with
 * the smallest consecutive differences, refined by Aitken extrapolation.
 */
function settle(vals: number[]): number | undefined {
  const v = vals.filter(Number.isFinite);
  if (v.length < 4 || v.length < vals.length - 1) return undefined;
  const diffs = v.slice(1).map((x, i) => Math.abs(x - v[i]));
  // follow the differences while they shrink; the first increase is where round-off noise begins
  let k = 0;
  while (k + 1 < diffs.length && diffs[k + 1] <= diffs[k] && diffs[k] > 0) k++;
  const at = v[k + 1];
  const scale = Math.max(...v.map(Math.abs));
  if (diffs[k] > 1e-6 * (1 + Math.abs(at))) return undefined;
  // the differences must actually be shrinking into this stretch (not a flat plateau by coincidence)
  const ext = k >= 1 ? aitken(v[k - 1], v[k], v[k + 1]) : at;
  return snap(Math.abs(ext - at) < 1e-6 * (1 + Math.abs(at)) ? ext : at, scale);
}

/**
 * Divergence to ±∞ or convergence of a far-out sequence sampled at doubling exponents (x = 10¹⁶, 10³², …):
 * growth that does not slow down (ln x, √x, ln ln x) diverges; geometrically shrinking steps converge.
 */
function farOut(vals: number[]): NumericLimit | undefined {
  const v = vals.filter(Number.isFinite);
  const tail = vals.slice(-3);
  if (tail.every((x) => x === Infinity)) return { kind: '+inf', evidence: 'values overflow to +∞' };
  if (tail.every((x) => x === -Infinity)) return { kind: '-inf', evidence: 'values overflow to −∞' };
  if (v.length < 4) return undefined;
  const d = v.slice(1).map((x, i) => x - v[i]);
  const same = d.every((x) => x > 0) || d.every((x) => x < 0);
  const ratios = d.slice(1).map((x, i) => Math.abs(x) / (Math.abs(d[i]) || 1e-300));
  if (same && ratios.every((r) => r > 0.85)) return { kind: d[0] > 0 ? '+inf' : '-inf', evidence: `values keep ${d[0] > 0 ? 'growing' : 'decreasing'} without slowing down (… ${fmt(v[v.length - 1])})` };
  if (ratios.every((r) => r < 0.7)) {
    const lim = snap(aitken(v[v.length - 3], v[v.length - 2], v[v.length - 1]), Math.max(...v.map(Math.abs)));
    return { kind: 'finite', value: lim, evidence: `values converge (extrapolated from … ${fmt(v[v.length - 1])})` };
  }
  return undefined;
}

/** Classify a sequence of values f(x_k) with x_k → target. */
function classify(vals: number[], far?: number[]): NumericLimit {
  const finite = vals.filter(Number.isFinite);
  if (finite.length < vals.length - 2) {
    const tail = vals.slice(-3);
    if (tail.every((v) => v === Infinity)) return { kind: '+inf', evidence: 'values are +∞' };
    if (tail.every((v) => v === -Infinity)) return { kind: '-inf', evidence: 'values are −∞' };
    return { kind: 'dne', evidence: 'function undefined near the point' };
  }
  const tail = vals.slice(-4);
  const big = tail.every((v) => Math.abs(v) > 1e4) && Math.abs(tail[tail.length - 1]) > 1e6;
  const growing = tail.every((v, i) => i === 0 || Math.abs(v) >= Math.abs(tail[i - 1]) * 1.5);
  if (big && growing) {
    if (tail.every((v) => v > 0)) return { kind: '+inf', evidence: `values grow without bound (… ${fmt(tail[tail.length - 1])})` };
    if (tail.every((v) => v < 0)) return { kind: '-inf', evidence: `values decrease without bound (… ${fmt(tail[tail.length - 1])})` };
    return { kind: 'dne', evidence: 'values blow up with alternating sign' };
  }
  const s = settle(vals);
  if (s !== undefined) return { kind: 'finite', value: s, evidence: `values settle at ${fmt(s)}` };
  if (far) {
    const r = farOut(far);
    if (r) return r;
  }
  return { kind: 'dne', evidence: 'values do not settle (oscillation)' };
}

/** lim_{x→a} f(x) (both sides, or one side). */
export function limitAt(f: F1, a: number, side: 'both' | 'left' | 'right' = 'both'): NumericLimit {
  const seq = (s: 1 | -1) => {
    const vals: number[] = [];
    for (let k = 1; k <= 12; k++) vals.push(f(a + s * Math.pow(10, -k) * Math.max(1, Math.abs(a))));
    // at 0 we can go much closer (10⁻¹⁶ … 10⁻²⁵⁶) to see slow blow-ups such as ln x
    const far: number[] = [];
    if (a === 0) for (let j = 4; j <= 8; j++) far.push(f(s * Math.pow(10, -Math.pow(2, j))));
    return classify(vals, a === 0 ? far : undefined);
  };
  if (side === 'left') return seq(-1);
  if (side === 'right') return seq(1);
  const left = seq(-1);
  const right = seq(1);
  if (left.kind === right.kind && left.kind !== 'dne') {
    if (left.kind !== 'finite') return { ...right, left, right, evidence: `both one-sided limits are ${right.kind === '+inf' ? '+∞' : '−∞'}` };
    if (Math.abs(left.value! - right.value!) < 1e-5 * (1 + Math.abs(right.value!)))
      return { kind: 'finite', value: (left.value! + right.value!) / 2, left, right, evidence: `left and right values agree (${fmt(right.value!)})` };
  }
  return { kind: 'dne', left, right, evidence: 'one-sided limits differ' };
}

/** lim_{x→±∞} f(x). */
export function limitInf(f: F1, dir: 1 | -1): NumericLimit {
  const vals: number[] = [];
  for (let k = 1; k <= 14; k++) vals.push(f(dir * Math.pow(10, k)));
  const far: number[] = [];
  for (let j = 4; j <= 8; j++) far.push(f(dir * Math.pow(10, Math.pow(2, j))));
  return classify(vals, far);
}
