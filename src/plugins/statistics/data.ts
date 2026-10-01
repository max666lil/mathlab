/**
 * Datasets (Devore ch. 1): a named list of numbers is a sample — summary with the book's conventions
 * (hinges as quartiles, fourth spread, mild / extreme outliers, trimmed mean), histogram on the density
 * scale, boxplot and normal probability plot as figure objects.
 */
import { Builtin, EvalError, expectNumber } from '../../math-core/builtins';
import { MathValue, scalar } from '../../math-core/values';
import { visual } from '../../visualization/scene-model';
import { normInv } from '../../math-core/distributions';
import { hingesOf, trimmed, boxSeries } from '../../runtime/script/library-books';
import type { Figure } from '../../runtime/script/interp';

export function numbersOf(v: MathValue | undefined): number[] {
  if (v?.kind === 'list') {
    const items = (v as { items: MathValue[] }).items;
    if (items.every((i) => i.kind === 'scalar')) return items.map((i) => (i as { value: number }).value);
  }
  throw new EvalError('Expected a list of numbers (data)');
}

export function isDataset(v: MathValue | undefined): boolean {
  if (v?.kind !== 'list') return false;
  const items = (v as { items: MathValue[] }).items;
  return items.length >= 4 && items.every((i) => i.kind === 'scalar');
}

export interface SummaryValue {
  kind: 'summary';
  n: number;
  rows: [string, number][];
  outliers: { mild: number[]; extreme: number[] };
  certainty: 'exact';
  [k: string]: unknown;
}

const median = (s: number[]) => (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);

export function summaryOf(xs: number[]): SummaryValue {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const sxx = s.reduce((a, b) => a + (b - mean) ** 2, 0);
  const sd = Math.sqrt(sxx / (n - 1));
  const [q1, q3] = hingesOf(s);
  const fs = q3 - q1;
  const mild = s.filter((x) => (x < q1 - 1.5 * fs && x >= q1 - 3 * fs) || (x > q3 + 1.5 * fs && x <= q3 + 3 * fs));
  const extreme = s.filter((x) => x < q1 - 3 * fs || x > q3 + 3 * fs);
  return {
    kind: 'summary', n, certainty: 'exact', outliers: { mild, extreme },
    rows: [
      ['n', n],
      ['\\bar{x}', mean],
      ['\\tilde{x}', median(s)],
      ['\\bar{x}_{tr(10)}', trimmed(s, 10)],
      ['s', sd],
      ['s^2', sd * sd],
      ['\\min', s[0]],
      ['\\text{lower fourth}', q1],
      ['\\text{upper fourth}', q3],
      ['\\max', s[n - 1]],
      ['f_s = \\text{iqr}', fs],
    ],
  };
}

function figure(series: Figure['series'], title: string, labels: Partial<Figure> = {}): Figure {
  return { series, title, ...labels };
}

/** Density-scale histogram (Devore: about √n classes). */
export function histogramFigure(xs: number[], bins?: number, title = 'histogram'): Figure {
  const s = [...xs].sort((a, b) => a - b);
  const k = bins ?? Math.max(5, Math.min(30, Math.round(Math.sqrt(s.length))));
  let lo = s[0];
  let hi = s[s.length - 1];
  if (hi - lo < 1e-12) [lo, hi] = [lo - 0.5, hi + 0.5];
  const w = (hi - lo) / k;
  const counts = new Array(k).fill(0);
  for (const x of s) counts[Math.min(k - 1, Math.floor((x - lo) / w))]++;
  return figure([{ type: 'bar', x: counts.map((_, i) => lo + (i + 0.5) * w), y: counts.map((c) => c / (s.length * w)), width: w }], title, { ylabel: 'density' });
}

export function normalPlotFigure(xs: number[]): Figure {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const z = s.map((_, i) => normInv((i + 0.5) / n));
  const i1 = Math.floor(0.25 * (n - 1));
  const i3 = Math.floor(0.75 * (n - 1));
  const m = (z[i3] - z[i1]) / (s[i3] - s[i1] || 1);
  return figure(
    [
      { type: 'scatter', x: s, y: z },
      { type: 'line', x: [s[0], s[n - 1]], y: [z[i1] + m * (s[0] - s[i1]), z[i1] + m * (s[n - 1] - s[i1])], style: 'r--' },
    ],
    'normal probability plot',
    { xlabel: 'observation', ylabel: 'z percentile ((i − .5)/n)' },
  );
}

const fig = (name: string, sig: string, doc: string, make: (xs: number[], args: (MathValue | undefined)[]) => Figure): Builtin => ({
  name, command: true, minArgs: 1, maxArgs: 2, category: 'statistics', signature: sig, doc,
  apply: (args) => {
    const xs = numbersOf(args[0]);
    const f = make(xs, args);
    return { kind: 'text', text: f.title ?? name, visuals: [visual('figure', { figure: f }, f.title ?? name, name)] } as unknown as MathValue;
  },
});

export const datasetBuiltins: Builtin[] = [
  {
    name: 'summary', command: true, minArgs: 1, maxArgs: 1, category: 'statistics', signature: 'summary D', doc: 'Numerical summary with Devore\'s conventions (fourths, outliers, trimmed mean).',
    apply: ([d]) => summaryOf(numbersOf(d)) as unknown as MathValue,
  },
  fig('histogram', 'histogram D [k]', 'Histogram on the density scale (k classes).', (xs, a) => histogramFigure(xs, a[1] ? Math.round(expectNumber(a[1])) : undefined)),
  fig('boxplot', 'boxplot D', 'Boxplot with mild (1.5 f_s) and extreme (3 f_s) outliers.', (xs) => figure(boxSeries([...xs].sort((p, q) => p - q), 1), 'boxplot')),
  fig('normplot', 'normplot D', 'Normal probability plot: (x₍ᵢ₎, z((i − .5)/n)).', (xs) => normalPlotFigure(xs)),
  {
    name: 'fourths', command: true, minArgs: 1, maxArgs: 1, category: 'statistics', signature: 'fourths D', doc: 'Lower and upper fourths (Tukey hinges).',
    apply: ([d]) => {
      const [l, u] = hingesOf([...numbersOf(d)].sort((a, b) => a - b));
      return { kind: 'list', items: [scalar(l, { certainty: 'exact' }), scalar(u, { certainty: 'exact' })] } as unknown as MathValue;
    },
  },
];

export function summaryLatex(s: SummaryValue): string {
  const f = (x: number) => (Number.isInteger(x) ? String(x) : String(+x.toPrecision(5)));
  const out = s.outliers.mild.length || s.outliers.extreme.length ? ` \\\\ \\text{outliers: mild } [${s.outliers.mild.map(f).join(', ')}],\\ \\text{extreme } [${s.outliers.extreme.map(f).join(', ')}]` : '';
  return `\\begin{array}{${'c'.repeat(s.rows.length)}} ${s.rows.map(([k]) => k).join(' & ')} \\\\ \\hline ${s.rows.map(([, v]) => f(v)).join(' & ')} \\end{array}${out}`;
}