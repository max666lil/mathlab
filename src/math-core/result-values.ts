/**
 * Typed results of analysis. They are ordinary MathValues: they can be named, referenced
 * (`C = critical f`, `P = first(C)`), analysed again and visualised.
 */
import { registerValueKind, scalar, point, MathValue, Certainty, VisualValue } from './values';
import { numberLatex } from './symbolic/print';
import { recognize } from './recognize';

/** LaTeX for a number: closed form when recognised (presentation only). */
export const rn = (x: number) => (Number.isFinite(x) ? (recognize(x)?.latex ?? numberLatex(x, 4)) : x > 0 ? '\\infty' : '-\\infty');

interface ResultBase {
  /** open value kinds (see OpaqueValue) */
  [key: string]: unknown;
  role?: string;
  derivation?: string;
  certainty?: Certainty;
  evidence?: string;
  visuals?: VisualValue[];
}

export interface SetPoint {
  /** domain coordinates: [x] for f(x), [x, y] for f(x, y) */
  coords: number[];
  /** function value at the point, if it belongs to a function */
  value?: number;
  /** 'local min' | 'local max' | 'saddle' | 'degenerate' | 'inflection' | … */
  type?: string;
  hessian?: number[][];
}

export interface PointSetValue extends ResultBase {
  kind: 'pointset';
  /** what the points are: 'critical points', 'zeros', 'solutions', … */
  what: string;
  dim: number;
  points: SetPoint[];
  /** name of the function the points belong to (for plotting at the right height) */
  of?: string;
}

export interface Interval {
  a: number;
  b: number;
  closedA: boolean;
  closedB: boolean;
  label?: string;
}

export interface IntervalsValue extends ResultBase {
  kind: 'intervals';
  what: string;
  intervals: Interval[];
}

export interface DomainValue extends ResultBase {
  kind: 'domain';
  vars: string[];
  /** symbolic conditions (LaTeX), exact */
  conditions: string[];
  /** 1-D only: scanned intervals (heuristic) */
  intervals?: Interval[];
}

export interface LimitValue extends ResultBase {
  kind: 'limit';
  result: 'finite' | '+inf' | '-inf' | 'dne';
  value?: number;
  left?: { result: string; value?: number };
  right?: { result: string; value?: number };
}

export interface AsymptotesValue extends ResultBase {
  kind: 'asymptotes';
  vertical: number[];
  horizontal: { side: 1 | -1; value: number }[];
  oblique: { side: 1 | -1; m: number; b: number }[];
}

/** Request from `analyze X`: the workbench focuses X. */
export interface FocusValue extends ResultBase {
  kind: 'focus';
  target: string;
}

/** Closed forms are shown for exact results; for numeric ones only as "≈ recognised form". */
function pointLatex(p: SetPoint, exact: boolean): string {
  const body = p.coords.length === 1 ? rn(p.coords[0]) : `\\left(${p.coords.map(rn).join(', ')}\\right)`;
  const recognised = p.coords.some((c) => recognize(c) && !Number.isInteger(c));
  if (exact || !recognised) return body;
  const dec = p.coords.length === 1 ? numberLatex(p.coords[0], 4) : `\\left(${p.coords.map((c) => numberLatex(c, 4)).join(', ')}\\right)`;
  return dec === body ? body : `${dec} \\approx ${body}`;
}

const lines = (items: string[]) => (items.length <= 1 ? (items[0] ?? '') : `\\begin{array}{l} ${items.join(' \\\\ ')} \\end{array}`);

export function intervalLatex(i: Interval): string {
  const a = Number.isFinite(i.a) ? rn(i.a) : '-\\infty';
  const b = Number.isFinite(i.b) ? rn(i.b) : '\\infty';
  if (i.a === i.b) return `\\{${a}\\}`;
  return `${i.closedA && Number.isFinite(i.a) ? '[' : '('}${a}, ${b}${i.closedB && Number.isFinite(i.b) ? ']' : ')'}`;
}

export function unionLatex(ivs: Interval[]): string {
  if (!ivs.length) return '\\varnothing';
  if (ivs.length === 1 && ivs[0].a === -Infinity && ivs[0].b === Infinity) return '\\mathbb{R}';
  return ivs.map(intervalLatex).join(' \\cup ');
}

registerValueKind({
  kind: 'pointset',
  latex: (v) => {
    const s = v as unknown as PointSetValue;
    if (!s.points.length) return '\\varnothing';
    const items = s.points.map((p) => `${s.dim === 1 && s.what !== 'solutions' ? 'x = ' : ''}${pointLatex(p, s.certainty === 'exact')}${p.type ? `\\ \\text{(${p.type})}` : ''}`);
    return lines(items);
  },
  typeLabel: (v) => {
    const s = v as unknown as PointSetValue;
    const n = s.points.length;
    const one: Record<string, string> = { equilibria: 'equilibrium', 'critical points': 'critical point', 'inflection points': 'inflection point', 'local extrema': 'local extremum' };
    return `${n} ${n === 1 ? (one[s.what] ?? s.what.replace(/s$/, '')) : s.what}`;
  },
});

registerValueKind({
  kind: 'intervals',
  latex: (v) => {
    const s = v as unknown as IntervalsValue;
    const labels = [...new Set(s.intervals.map((i) => i.label ?? ''))];
    if (labels.length === 1 && !labels[0]) return unionLatex(s.intervals);
    return lines(labels.map((l) => `\\text{${l} on } ${unionLatex(s.intervals.filter((i) => (i.label ?? '') === l))}`));
  },
  typeLabel: (v) => `intervals (${(v as unknown as IntervalsValue).what})`,
});

registerValueKind({
  kind: 'domain',
  latex: (v) => {
    const d = v as unknown as DomainValue;
    if (d.intervals) return unionLatex(d.intervals);
    if (!d.conditions.length) return d.vars.length === 1 ? '\\mathbb{R}' : `\\mathbb{R}^{${d.vars.length}}`;
    return d.conditions.join(',\\quad ');
  },
  typeLabel: () => 'domain',
});

registerValueKind({
  kind: 'limit',
  latex: (v) => {
    const l = v as unknown as LimitValue;
    if (l.result === 'finite') return rn(l.value!);
    if (l.result === '+inf') return '+\\infty';
    if (l.result === '-inf') return '-\\infty';
    const side = (s?: { result: string; value?: number }) => (!s ? '?' : s.result === 'finite' ? rn(s.value!) : s.result === '+inf' ? '+\\infty' : s.result === '-inf' ? '-\\infty' : '\\text{DNE}');
    return l.left || l.right ? `\\text{does not exist}\\ \\left(\\text{left } ${side(l.left)},\\ \\text{right } ${side(l.right)}\\right)` : '\\text{does not exist}';
  },
  typeLabel: () => 'limit',
});

registerValueKind({
  kind: 'asymptotes',
  latex: (v) => {
    const a = v as unknown as AsymptotesValue;
    const parts = [
      ...a.vertical.map((x) => `x = ${rn(x)}`),
      ...a.horizontal.map((h) => `y = ${rn(h.value)}\\ (x \\to ${h.side > 0 ? '+' : '-'}\\infty)`),
      ...a.oblique.map((o) => {
        const m = Math.abs(o.m - 1) < 1e-12 ? '' : Math.abs(o.m + 1) < 1e-12 ? '-' : rn(o.m);
        const b = Math.abs(o.b) < 1e-12 ? '' : ` ${o.b < 0 ? '-' : '+'} ${rn(Math.abs(o.b))}`;
        return `y = ${m}x${b}\\ (x \\to ${o.side > 0 ? '+' : '-'}\\infty)`;
      }),
    ];
    return parts.length ? lines(parts) : '\\text{none found}';
  },
  typeLabel: () => 'asymptotes',
});

registerValueKind({ kind: 'focus', latex: (v) => `\\text{analyzing } ${(v as unknown as FocusValue).target}`, typeLabel: () => 'analysis request' });

const itemRules = new Map<string, (v: MathValue, k: number) => MathValue | undefined>();
/** Plugins make their kinds indexable: E[k] for eigen-decompositions, W[k] for subspace bases, … */
export function registerItems(kind: string, fn: (v: MathValue, k: number) => MathValue | undefined) {
  itemRules.set(kind, fn);
}

/** first(S), S[k]: one element of a point set / list. */
export function itemOf(v: MathValue, k: number): MathValue | undefined {
  const rule = itemRules.get(v.kind);
  if (rule) return rule(v, k);
  if (v.kind === 'pointset') {
    const s = v as unknown as PointSetValue;
    const p = s.points[k];
    if (!p) return undefined;
    return p.coords.length === 1 ? scalar(p.coords[0], { certainty: s.certainty }) : { ...point(p.coords), certainty: s.certainty };
  }
  if (v.kind === 'list') return (v as unknown as { items: MathValue[] }).items[k];
  return undefined;
}