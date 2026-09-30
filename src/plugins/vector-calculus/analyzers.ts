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
import { isCurveFn, closedOf } from './curves';
import { curveRange } from '../../math-core/ranges';


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
    // a closed curve in the worksheet: circulation and flux around it
    const Cc = curveOfDim(ws, n, true);
    if (Cc) {
      sections.push({ id: 'around', title: `Around ${Cc}`, why: 'lineintegral' });
      facts.push({ id: 'circulation', title: `∮ ${F}·dr`, expr: `circulation ${F} around ${Cc}`, tier: 1, section: 'around', pinName: 'Γ', visual: 'auto' });
      if (n === 2) facts.push({ id: 'fluxAround', title: `∮ ${F}·n ds`, expr: `flux ${F} across ${Cc}`, tier: 1, section: 'around', pinName: 'Φ' });
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

// ------------------------------------------------------------------ curves r(t)

/** First named vector field / curve of a given dimension (for field × curve sections). */
function firstNamed(ws: Workspace, test: (v: FunctionValue) => boolean): string | undefined {
  return ws.statements().find((s) => s.name && ws.value(s.id) && test(ws.value(s.id) as FunctionValue))?.name;
}
const fieldOfDim = (ws: Workspace, n: number) => firstNamed(ws, (v) => isField(v) && v.expr!.type === 'vec' && v.params.length === n);
const curveOfDim = (ws: Workspace, n: number, closedOnly = false) =>
  firstNamed(ws, (v) => isCurveFn(v) && (v.expr as { items: unknown[] }).items.length === n && (!closedOnly || closedOf(v)));

/** A slider meant as a parameter value on the curve (t0, t₀, s0, τ). */
function paramSlider(ws: Workspace): string | undefined {
  return ws.statements().find((s) => s.name && s.input?.kind === 'slider' && /^(t0|t_0|s0|τ|a)$/.test(s.name))?.name;
}

registerAnalyzer({
  id: 'curve',
  focusOnEdit: true,
  recognizes: (v) => isCurveFn(v),
  plan(C, value, ws): AnalysisPlan {
    const f = value as FunctionValue;
    const n = (f.expr as { items: unknown[] }).items.length;
    const [a, b] = curveRange(f);
    const t = f.params[0];
    const t0 = paramSlider(ws);
    const fmt = (x: number) => (Math.abs(x - 2 * Math.PI) < 1e-9 ? '2π' : Math.abs(x - Math.PI) < 1e-9 ? 'π' : String(+x.toFixed(4)));
    const sections: SectionSpec[] = [
      { id: 'overview', title: 'Summary', summary: true },
      { id: 'motion', title: 'Motion along the curve' },
      t0
        ? { id: 'at', title: `At ${t} = ${t0}` }
        : { id: 'at', title: 'At a parameter value', actions: [{ label: `＋ Add a parameter value t0`, rows: [`t0 = slider(${fmt(a)}, ${fmt(b)}, ${fmt((a + b) / 2)})`] }] },
    ];
    const facts: FactSpec[] = [
      { id: 'self', title: C, expr: C, tier: 0, section: 'overview', visual: 'always', hidden: true },
      { id: 'closed', title: 'Closed', expr: `closed(${C})`, tier: 0, section: 'overview' },
      { id: 'length', title: 'Length', expr: `length(${C})`, tier: 0, section: 'overview', pinName: 'L' },
      { id: 'velocity', title: "Velocity r′(t)", expr: `velocity(${C})`, tier: 1, section: 'motion', pinName: 'v' },
      { id: 'motion', title: 'Moving point', expr: `motion(${C})`, tier: 1, section: 'motion', visual: 'auto' },
    ];
    if (t0)
      facts.push(
        { id: 'point', title: `${C}(${t0})`, expr: `${C}(${t0})`, tier: 1, section: 'at', pinName: 'Pt' },
        { id: 'tangent', title: 'Unit tangent', expr: `tangent ${C} at ${t0}`, tier: 1, section: 'at', pinName: 'T', visual: 'auto' },
        { id: 'curvature', title: 'Curvature κ', expr: `curvature ${C} at ${t0}`, tier: 1, section: 'at', pinName: 'κ', visual: 'auto' },
      );
    if (n === 2) {
      sections.push({ id: 'area', title: 'Area inside' });
      facts.push({ id: 'area', title: 'Enclosed area', expr: `area(${C})`, tier: 1, section: 'area', pinName: 'A' });
    }
    // a vector field in the worksheet: the work it does along this curve (and flux across it)
    const F = fieldOfDim(ws, n);
    if (F) {
      const closed = closedOf(f);
      sections.push({ id: 'field', title: `Along the field ${F}`, why: 'lineintegral' });
      facts.push({ id: 'work', title: closed ? `∮ ${F}·dr` : `∫ ${F}·dr`, expr: `work ${F} along ${C}`, tier: 1, section: 'field', pinName: 'W', visual: 'auto' });
      if (closed && n === 2) facts.push({ id: 'fluxC', title: `∮ ${F}·n ds`, expr: `flux ${F} across ${C}`, tier: 1, section: 'field', pinName: 'Φ' });
    }
    return {
      object: C,
      typeLabel: `curve in ℝ${n === 2 ? '²' : '³'} · ${t} ∈ [${fmt(a)}, ${fmt(b)}]`,
      layout:
        n === 2
          ? { canvasTitle: `Curve ${C}`, views: [{ id: 'plane', label: '2D', renderer: 'plane' }], defaultView: 'plane' }
          : { canvasTitle: `Curve ${C}`, views: [{ id: 'space', label: '3D', renderer: 'scene' }], defaultView: 'space' },
      title: valueLatex(value),
      sections,
      facts,
      relations: [],
      diagnostics: [],
    };
  },
});
