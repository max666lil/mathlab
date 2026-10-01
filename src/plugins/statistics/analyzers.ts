/** Random variables and datasets: their analyses (moments, probabilities, simulation, the CLT; summaries and plots). */
import { registerAnalyzer, AnalysisPlan, FactSpec, SectionSpec } from '../../runtime/analysis';
import { symbolLatex } from '../../math-core/symbolic/print';
import { valueLatex } from '../../math-core/values';
import { asDistribution } from './random';
import { isDataset } from './data';
import { quantileOf } from '../../math-core/distributions';

const PLOT = (title: string): AnalysisPlan['layout'] => ({ canvasTitle: title, views: [{ id: 'plot', label: 'Plot', renderer: 'plane' }], defaultView: 'plot' });

registerAnalyzer({
  id: 'distribution',
  focusOnEdit: true,
  recognizes: (v) => !!asDistribution(v),
  plan(X, value, ws): AnalysisPlan {
    const d = asDistribution(value)!;
    const sliders = ws.statements().filter((s) => s.name && s.input?.kind === 'slider').map((s) => s.name!);
    const a = sliders.find((n) => n === 'a');
    const b = sliders.find((n) => n === 'b');
    const fmt = (x: number) => +x.toPrecision(3);
    const sections: SectionSpec[] = [
      { id: 'overview', title: 'Summary', summary: true },
      { id: 'prob', title: 'Probability', defaultOpen: true },
      { id: 'cdf', title: 'Cumulative distribution' },
      { id: 'sim', title: 'Simulation' },
      { id: 'clt', title: 'Sampling distribution of the mean (CLT)' },
    ];
    const facts: FactSpec[] = [
      { id: 'mean', title: `E(${X})`, expr: `E(${X})`, tier: 0, section: 'overview', pinName: 'mu' },
      { id: 'var', title: `V(${X})`, expr: `Var(${X})`, tier: 0, section: 'overview' },
      { id: 'sd', title: `σ`, expr: `SD(${X})`, tier: 0, section: 'overview', pinName: 'sigma' },
      { id: 'median', title: 'median', expr: `median(${X})`, tier: 0, section: 'overview' },
      { id: 'cdf', title: `F(x) = P(${X} ≤ x)`, expr: `cdf ${X}`, tier: 1, section: 'cdf', visual: 'auto', pinName: 'F' },
      { id: 'q95', title: '95th percentile', expr: `quantile(${X}, 0.95)`, tier: 1, section: 'cdf' },
      { id: 'sample', title: 'Simulated sample', expr: `sample(${X}, 2000)`, tier: 1, section: 'sim', visual: 'auto' },
      { id: 'clt', title: 'X̄ for n = 1 … 30', expr: `clt(${X})`, tier: 1, section: 'clt', visual: 'auto' },
    ];
    if (a && b) facts.push({ id: 'pab', title: `P(${a} < ${X} ≤ ${b})`, expr: `P(${a} < ${X} <= ${b})`, tier: 0, section: 'prob', visual: 'auto' });
    else {
      const lo = quantileOf(d.dist, 0.25);
      const hi = quantileOf(d.dist, 0.75);
      const r0 = quantileOf(d.dist, 0.01);
      const r1 = quantileOf(d.dist, 0.99);
      sections[1] = { ...sections[1], actions: [{ label: `＋ Add P(a < ${X} ≤ b) with sliders`, rows: [`a = slider(${fmt(r0)}, ${fmt(r1)}, ${fmt(lo)})`, `b = slider(${fmt(r0)}, ${fmt(r1)}, ${fmt(hi)})`] }] };
    }
    return {
      object: X,
      typeLabel: `${d.discrete ? 'discrete' : 'continuous'} random variable`,
      layout: PLOT(`${X} ~ ${d.family === 'pmf' ? 'pmf' : d.family}`),
      title: `${symbolLatex(X)} \\sim ${valueLatex(value)}`,
      sections, facts, relations: [], diagnostics: [],
    };
  },
});

registerAnalyzer({
  id: 'dataset',
  focusOnEdit: true,
  recognizes: (v, name) => isDataset(v) && !!name,
  plan(D): AnalysisPlan {
    return {
      object: D,
      typeLabel: 'data (sample)',
      layout: PLOT(`Data ${D}`),
      title: symbolLatex(D),
      sections: [
        { id: 'overview', title: 'Summary', summary: true },
        { id: 'hist', title: 'Histogram', defaultOpen: true },
        { id: 'box', title: 'Boxplot' },
        { id: 'qq', title: 'Normal probability plot' },
      ],
      facts: [
        { id: 'summary', title: 'Summary', expr: `summary ${D}`, tier: 0, section: 'overview' },
        { id: 'hist', title: 'Histogram (density)', expr: `histogram ${D}`, tier: 1, section: 'hist', visual: 'auto' },
        { id: 'box', title: 'Boxplot', expr: `boxplot ${D}`, tier: 1, section: 'box', visual: 'auto' },
        { id: 'qq', title: 'Normal plot', expr: `normplot ${D}`, tier: 1, section: 'qq', visual: 'auto' },
      ],
      relations: [], diagnostics: [],
    };
  },
});