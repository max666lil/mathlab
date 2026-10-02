/** Probability and statistics (Phase 5) — math side. */
import { definePlugin } from '../plugin-api';
import { getBuiltin } from '../../math-core/builtins';
import { visual } from '../../visualization/scene-model';
import { statisticsBuiltins, distAware, DistributionValue } from './random';
import { datasetBuiltins, summaryLatex, SummaryValue } from './data';
import { evaluateFact, ProbFactValue } from './events';
import { rvBuiltin, llnBuiltin, covBuiltins } from './derived';
import { densityBuiltin, fromCdfBuiltin, normalApproxBuiltin } from './custom';
import type { Expr } from '../../math-core/ast';
import { MathSyntaxError } from '../../parser/lexer';

export const statisticsMath = definePlugin({
  name: 'statistics',
  install(api) {
    statisticsBuiltins.forEach((b) => api.registerBuiltin(b));
    api.registerBuiltin(rvBuiltin);
    api.registerBuiltin(llnBuiltin);
    [densityBuiltin, fromCdfBuiltin, normalApproxBuiltin, ...covBuiltins].forEach((b) => api.registerBuiltin(b));
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
    // probability spaces of events: P(B | A) = 0.95, independent A, B, disjoint A, C
    api.registerCustomStatement('probfact', evaluateFact);
    api.registerValueKind({ kind: 'probfact', latex: (v) => (v as unknown as ProbFactValue).latex, typeLabel: () => 'probability fact' });
    api.registerStatementRule({
      name: 'event-relation',
      match: (t) => t.length >= 4 && t[0].kind === 'ident' && ['independent', 'disjoint', 'exclusive'].includes(t[0].text) && t[1].kind === 'ident',
      parse: (p, toks, span) => {
        const kind = toks[0].text === 'independent' ? 'independent' : 'disjoint';
        p.next();
        const events: Expr[] = [];
        for (;;) {
          const t = p.expectIdent();
          events.push({ type: 'sym', name: t.text, span: { from: t.from, to: t.to } });
          if (p.isOp(',') || p.isIdent('and')) {
            p.next();
            continue;
          }
          break;
        }
        p.expectEnd();
        if (events.length < 2) throw new MathSyntaxError(`${kind}: name at least two events`, span.from, span.to);
        return { kind: 'custom', rule: 'probfact', data: { kind, events }, span, modifiers: [] };
      },
    });
    api.registerDefaultVisual('distribution', (v, ctx) => [visual('distplot', { dist: v, sname: ctx.name ?? 'X' }, ctx.name, 'distribution')]);
  },
});