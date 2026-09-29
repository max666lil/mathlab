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

const pointLatex = (p: SetPoint) => (p.coords.length === 1 ? rn(p.coords[0]) : `\\left(${p.coords.map(rn).join(', ')}\\right)`);

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
    const items = s.points.map((p) => `${s.dim === 1 && s.what !== 'solutions' ? 'x = ' : ''}${pointLatex(p)}${p.type ? `\\ \\text{(${p.type})}` : ''}`);
    return s.dim === 1 ? items.join(',\\quad ') : `\\left\\{ ${items.join(',\\; ')} \\right\\}`;
  },
  typeLabel: (v) => `${(v as unknown as PointSetValue).points.length} ${(v as unknown as PointSetValue).what}`,
});

registerValueKind({
  kind: 'intervals',
  latex: (v) => {
    const s = v as unknown as IntervalsValue;
    const labels = [...new Set(s.intervals.map((i) => i.label ?? ''))];
    if (labels.length === 1 && !labels[0]) return unionLatex(s.intervals);
    return labels.map((l) => `\\text{${l} on } ${unionLatex(s.intervals.filter((i) => (i.label ?? '') === l))}`).join(';\\quad ');
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
      ...a.oblique.map((o) => `y = ${rn(o.m)}x ${o.b < 0 ? '-' : '+'} ${rn(Math.abs(o.b))}\\ (x \\to ${o.side > 0 ? '+' : '-'}\\infty)`),
    ];
    return parts.length ? parts.join(',\\quad ') : '\\text{none}';
  },
  typeLabel: () => 'asymptotes',
});

registerValueKind({ kind: 'focus', latex: (v) => `\\text{analyzing } ${(v as unknown as FocusValue).target}`, typeLabel: () => 'analysis request' });

/** first(S), S[k]: one element of a point set / list. */
export function itemOf(v: MathValue, k: number): MathValue | undefined {
  if (v.kind === 'pointset') {
    const s = v as unknown as PointSetValue;
    const p = s.points[k];
    if (!p) return undefined;
    return p.coords.length === 1 ? scalar(p.coords[0], { certainty: s.certainty }) : { ...point(p.coords), certainty: s.certainty };
  }
  if (v.kind === 'list') return (v as unknown as { items: MathValue[] }).items[k];
  return undefined;
}