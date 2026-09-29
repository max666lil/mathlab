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

/** Classify a sequence of values f(x_k) with x_k → target. */
function classify(vals: number[]): NumericLimit {
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
  const last = tail[tail.length - 1];
  const spread = Math.max(...tail) - Math.min(...tail);
  const diffs = tail.slice(1).map((v, i) => Math.abs(v - tail[i]));
  const shrinking = diffs.every((d, i) => i === 0 || d <= diffs[i - 1] * 1.01 + 1e-15);
  if (spread < 1e-6 * (1 + Math.abs(last)) || (shrinking && diffs[diffs.length - 1] < 1e-7 * (1 + Math.abs(last)))) {
    return { kind: 'finite', value: last, evidence: `values settle at ${fmt(last)}` };
  }
  return { kind: 'dne', evidence: 'values do not settle (oscillation)' };
}

const fmt = (x: number) => (Math.abs(x) >= 1e6 || (Math.abs(x) < 1e-4 && x !== 0) ? x.toExponential(3) : String(+x.toPrecision(6)));

/** lim_{x→a} f(x) (both sides, or one side). */
export function limitAt(f: F1, a: number, side: 'both' | 'left' | 'right' = 'both'): NumericLimit {
  const seq = (s: 1 | -1) => {
    const vals: number[] = [];
    for (let k = 2; k <= 9; k++) {
      const h = Math.pow(10, -k) * Math.max(1, Math.abs(a));
      vals.push(f(a + s * h));
    }
    return classify(vals);
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
  for (let k = 1; k <= 9; k++) vals.push(f(dir * Math.pow(10, k)));
  return classify(vals);
}