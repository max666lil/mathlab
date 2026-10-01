/** Probability and statistics (Phase 5) — math side. */
import { definePlugin } from '../plugin-api';
import { getBuiltin } from '../../math-core/builtins';
import { visual } from '../../visualization/scene-model';
import { statisticsBuiltins, distAware, DistributionValue } from './random';
import { datasetBuiltins, summaryLatex, SummaryValue } from './data';

export const statisticsMath = definePlugin({
  name: 'statistics',
  install(api) {
    statisticsBuiltins.forEach((b) => api.registerBuiltin(b));
    datasetBuiltins.forEach((b) => api.registerBuiltin(b));
    // mean X, median X, var X, stdev X also work for random variables
    for (const [n, w] of [['mean', 'mean'], ['median', 'median'], ['var', 'variance'], ['stdev', 'sd']] as const) {
      const b = distAware(getBuiltin(n), w);
      if (b) api.registerBuiltin(b);
    }
    api.registerValueKind({
      kind: 'distribution',
      latex: (v) => (v as unknown as DistributionValue).latex,
      typeLabel: (v) => `${(v as unknown as DistributionValue).discrete ? 'discrete' : 'continuous'} random variable`,
    });
    api.registerValueKind({ kind: 'summary', latex: (v) => summaryLatex(v as unknown as SummaryValue), typeLabel: () => 'numerical summary' });
    api.registerDefaultVisual('distribution', (v, ctx) => [visual('distplot', { dist: v, sname: ctx.name ?? 'X' }, ctx.name, 'distribution')]);
  },
});