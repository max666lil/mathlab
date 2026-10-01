/** Scripts: output text, the variables they leave in the worksheet, and their figures. */
import { registerAnalyzer, AnalysisPlan, FactSpec } from '../../runtime/analysis';
import type { ScriptValue } from '../../runtime/script/bridge';

registerAnalyzer({
  id: 'script',
  focusOnEdit: true,
  recognizes: (v) => v.kind === 'script',
  plan(name, value): AnalysisPlan {
    const s = value as unknown as ScriptValue;
    const vars = Object.keys(s.vars);
    const facts: FactSpec[] = [
      ...vars.map((v) => ({ id: `var:${v}`, title: v, expr: v, tier: 0 as const, section: 'vars' })),
    ];
    return {
      object: name,
      typeLabel: s.usedRandom ? 'script (simulation)' : 'script',
      layout: { canvasTitle: s.figures[0]?.title ?? `Script ${s.name ?? ''}`.trim(), views: [{ id: 'plane', label: 'Figure', renderer: 'plane' }], defaultView: 'plane' },
      title: `\\text{script ${s.name ?? ''}}`,
      sections: [
        { id: 'overview', title: 'Summary', summary: true },
        ...(vars.length ? [{ id: 'vars', title: 'Variables', defaultOpen: true }] : []),
      ],
      facts,
      relations: [],
      diagnostics: s.output.length ? [s.output.slice(-12).join('\n')] : [],
    };
  },
});