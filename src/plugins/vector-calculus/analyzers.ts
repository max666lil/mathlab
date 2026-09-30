/**
 * Vector fields F: ℝⁿ → ℝⁿ written with angle brackets (F(x,y) = <-y, x>) or obtained as gradients.
 * The canvas shows the arrows; flow (particles, streamlines), the local picture at P (flux box,
 * paddle wheel), the potential and the equilibria compute and draw only when their section opens.
 */
import { registerAnalyzer, AnalysisPlan, FactSpec, SectionSpec } from '../../runtime/analysis';
import type { Workspace } from '../../runtime/workspace';
import type { FunctionValue, PointValue } from '../../math-core/values';
import { valueLatex } from '../../math-core/values';
import { symbolLatex } from '../../math-core/symbolic/print';
import { registerRelation } from '../../visualization/presentation';
import { freshName } from '../core-calculus/analyzers';
import { isField } from './math';


registerRelation('role:flux', ['role:field']);
registerRelation('role:paddle', ['role:field']);

function firstPoint(ws: Workspace, dim: number): string | undefined {
  const pts = ws.statements().filter((s) => s.name && ws.value(s.id)?.kind === 'point' && (ws.value(s.id) as PointValue).coords.length === dim);
  return (pts.find((s) => s.input?.kind === 'point') ?? pts[0])?.name;
}

registerAnalyzer({
  id: 'vector-field',
  focusOnEdit: true,
  // angle brackets mean vectors attached to points; T(x, y) = (…) is a point map (linear maps: Phase 2)
  recognizes: (v) => isField(v) && (v as FunctionValue).expr!.type === 'vec',
  plan(F, value, ws): AnalysisPlan {
    const f = value as FunctionValue;
    const n = f.params.length;
    const P = firstPoint(ws, n);
    const pName = freshName(ws, 'P');
    const sections: SectionSpec[] = [
      { id: 'overview', title: 'Summary', summary: true, why: 'divcurl' },
      { id: 'flow', title: 'Flow' },
    ];
    const facts: FactSpec[] = [
      { id: 'field', title: 'Field', expr: `field(${F})`, tier: 0, section: 'overview', visual: 'always', hidden: true },
      { id: 'div', title: 'div F', expr: `div(${F})`, tier: 0, section: 'overview', pinName: 'divF' },
      { id: 'curl', title: 'curl F', expr: `curl(${F})`, tier: 0, section: 'overview', pinName: 'curlF' },
      { id: 'conservative', title: 'Conservative', expr: `conservative(${F})`, tier: 0, section: 'overview' },
      { id: 'particles', title: 'Particles', expr: `particles(${F})`, tier: 1, section: 'flow', visual: 'auto' },
      { id: 'streamlines', title: 'Streamlines', expr: `streamlines(${F})`, tier: 1, section: 'flow', visual: 'auto' },
    ];
    if (P) {
      sections.push({ id: 'at', title: `At ${P}`, why: 'divcurl' });
      facts.push(
        { id: 'value', title: `${F}(${P})`, expr: `${F}(${P})`, tier: 1, section: 'at', pinName: 'FP' },
        { id: 'divP', title: `div ${F}(${P})`, expr: `div(${F}) at ${P}`, tier: 1, section: 'at' },
        { id: 'curlP', title: `curl ${F}(${P})`, expr: `curl(${F}) at ${P}`, tier: 1, section: 'at' },
        ...(n === 2 ? [{ id: 'fluxbox', title: 'Flux through a small box', expr: `fluxbox(${F}, ${P})`, tier: 1 as const, section: 'at', visual: 'auto' as const }] : []),
        { id: 'paddle', title: 'Paddle wheel', expr: `paddlewheel(${F}, ${P})`, tier: 1, section: 'at', visual: 'auto' },
        { id: 'jacobianP', title: `J(${P})`, expr: `jacobian(${F}) at ${P}`, tier: 1, section: 'at', pinName: 'JP' },
      );
    } else {
      sections.push({ id: 'at', title: 'At a point', actions: [{ label: `＋ Add a point ${pName}`, rows: [`${pName} = point(${n === 2 ? '1, 0.5' : '1, 0.5, 0.5'}) draggable`] }] });
    }
    sections.push({ id: 'potential', title: 'Potential' }, { id: 'equilibria', title: 'Equilibria' });
    facts.push(
      { id: 'potential', title: 'φ with ∇φ = F', expr: `potential(${F})`, tier: 1, section: 'potential', pinName: 'φ' },
      { id: 'jacobian', title: 'Jacobian', expr: `jacobian(${F})`, tier: 1, section: 'equilibria', pinName: 'J' },
      { id: 'equilibria', title: 'Equilibria (F = 0)', expr: `equilibria(${F})`, tier: 1, section: 'equilibria', pinName: 'Eq', visual: 'auto' },
    );
    return {
      object: F,
      typeLabel: `vector field ℝ${n === 2 ? '²' : '³'} → ℝ${n === 2 ? '²' : '³'}`,
      layout:
        n === 2
          ? { canvasTitle: `Vector field ${F}`, views: [{ id: 'plane', label: '2D', renderer: 'plane' }], defaultView: 'plane' }
          : { canvasTitle: `Vector field ${F}`, views: [{ id: 'space', label: '3D', renderer: 'scene' }], defaultView: 'space' },
      title: f.label && !f.label.startsWith('\\nabla') ? valueLatex(value) : `${symbolLatex(F)} = ${valueLatex(value)}`,
      sections,
      facts,
      relations: [],
      diagnostics: [],
    };
  },
});