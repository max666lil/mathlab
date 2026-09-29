/**
 * Analyzers of the calculus plugin: recognise functions of one and two variables (and point sets)
 * and plan their analysis as facts — ordinary MLL expressions over the analysis builtins.
 */
import { registerAnalyzer, AnalysisPlan, FactSpec, SectionSpec, WorkspaceLayout } from '../../runtime/analysis';

/** f: ℝ → ℝ — one large graph. */
const GRAPH_LAYOUT: WorkspaceLayout = { canvasTitle: 'Graph', views: [{ id: 'graph', label: 'Graph', renderer: 'plane' }], defaultView: 'graph' };

/** f: ℝ² → ℝ — the surface, its contour map, or both side by side. */
const SURFACE_LAYOUT: WorkspaceLayout = {
  canvasTitle: 'Surface & contours',
  views: [
    { id: '3d', label: '3D', renderer: 'scene' },
    { id: 'contour', label: 'Contour', renderer: 'plane' },
  ],
  combos: [{ id: 'both', label: 'Both', views: ['3d', 'contour'] }],
  defaultView: '3d',
};
import type { Workspace } from '../../runtime/workspace';
import type { FunctionValue, MathValue, PointValue, VectorValue } from '../../math-core/values';
import { valueLatex } from '../../math-core/values';
import { symbolLatex } from '../../math-core/symbolic/print';
import { registerRelation } from '../../visualization/presentation';

// emphasising one object brings out the objects that explain it
registerRelation('role:gradient', ['role:level']);
registerRelation('role:direction', ['role:slice-dir', 'annot:angle']);
registerRelation('role:hessian', ['role:quadratic']);

/** A name not used in the document (for rows inserted by actions / pins). */
export function freshName(ws: Workspace, base: string): string {
  if (!ws.value(base) && !ws.statement(base)) return base;
  for (let i = 2; ; i++) if (!ws.value(`${base}${i}`) && !ws.statement(`${base}${i}`)) return `${base}${i}`;
}

function firstPoint(ws: Workspace, dim: number): string | undefined {
  const pts = ws.statements().filter((s) => s.name && ws.value(s.id)?.kind === 'point' && (ws.value(s.id) as PointValue).coords.length === dim);
  return (pts.find((s) => s.input?.kind === 'point') ?? pts[0])?.name;
}

function firstDirection(ws: Workspace): string | undefined {
  return ws.statements().find((s) => s.name && ws.value(s.id)?.kind === 'vector' && (ws.value(s.id) as VectorValue).comps.length === 2 && !(ws.value(s.id) as VectorValue).anchor)?.name;
}

/** A slider meant as a point on the x-axis (a, b, c, x0 …) — angles such as θ are not used. */
function firstSlider(ws: Workspace): string | undefined {
  const sliders = ws.statements().filter((s) => s.name && s.input?.kind === 'slider').map((s) => s.name!);
  return sliders.find((n) => /^(a|b|c|x0|x_0|p)$/.test(n));
}

const isFn = (v: MathValue, n: number) => v.kind === 'function' && (v as FunctionValue).out === 'scalar' && (v as FunctionValue).params.length === n && !!(v as FunctionValue).expr;

// ------------------------------------------------------------------ f(x)

registerAnalyzer({
  id: 'function-1d',
  recognizes: (v) => isFn(v, 1),
  plan(f, value, ws): AnalysisPlan {
    const fv = value as FunctionValue;
    const x = fv.params[0];
    const a = firstSlider(ws);
    const sections: SectionSpec[] = [
      { id: 'overview', title: 'Formula, domain & derivative', defaultOpen: true },
      { id: 'zeros', title: 'Zeros & intercepts' },
      { id: 'critical', title: 'Critical points & extrema' },
      { id: 'shape', title: 'Monotonicity & concavity' },
      { id: 'asymptotes', title: 'Asymptotes & limits at ±∞' },
      { id: 'taylor', title: 'Taylor polynomial' },
      { id: 'integral', title: 'Antiderivative' },
      a
        ? { id: 'at', title: `At ${x} = ${a}`, defaultOpen: true, why: 'tangent-1d' }
        : { id: 'at', title: 'At a point', actions: [{ label: `＋ Add a point ${freshName(ws, 'a')}`, rows: [`${freshName(ws, 'a')} = slider(-5, 5, 1)`] }] },
    ];
    const facts: FactSpec[] = [
      { id: 'graph', title: 'Graph', expr: f, tier: 0, section: 'overview', visual: 'always', hidden: true },
      { id: 'domain', title: 'Domain', expr: `domain(${f})`, tier: 0, section: 'overview', pinName: 'Dom' },
      { id: 'derivative', title: `${f}′`, expr: `derivative ${f}`, tier: 0, section: 'overview', pinName: `d${f}`, visual: 'toggle' },
      { id: 'second', title: `${f}″`, expr: `derivative ${f} order 2`, tier: 0, section: 'overview', pinName: `dd${f}`, visual: 'toggle' },
      { id: 'zeros', title: 'Zeros', expr: `zeros ${f}`, tier: 1, section: 'zeros', pinName: 'Z', visual: 'auto' },
      { id: 'yint', title: `${f}(0)`, expr: `${f}(0)`, tier: 1, section: 'zeros' },
      { id: 'critical', title: 'Critical points', expr: `critical ${f}`, tier: 1, section: 'critical', pinName: 'C', visual: 'auto' },
      { id: 'monotonicity', title: 'Monotonicity', expr: `monotonicity ${f}`, tier: 1, section: 'shape', pinName: 'M' },
      { id: 'concavity', title: 'Concavity', expr: `concavity ${f}`, tier: 1, section: 'shape', pinName: 'K' },
      { id: 'inflections', title: 'Inflection points', expr: `inflections ${f}`, tier: 1, section: 'shape', pinName: 'I', visual: 'auto' },
      { id: 'asymptotes', title: 'Asymptotes', expr: `asymptotes ${f}`, tier: 1, section: 'asymptotes', pinName: 'A', visual: 'auto' },
      { id: 'limit+', title: `${x} → +∞`, expr: `limit ${f} as ${x} -> ∞`, tier: 1, section: 'asymptotes' },
      { id: 'limit-', title: `${x} → −∞`, expr: `limit ${f} as ${x} -> -∞`, tier: 1, section: 'asymptotes' },
      { id: 'taylor', title: `T₄ at ${a ?? 0}`, expr: `taylor ${f} at ${a ?? 0} order 4`, tier: 1, section: 'taylor', pinName: 'T', visual: 'auto' },
      { id: 'integral', title: `∫ ${f} d${x}`, expr: `integrate ${f}`, tier: 1, section: 'integral', pinName: 'F' },
    ];
    if (a)
      facts.push(
        { id: 'a', title: a, expr: a, tier: 1, section: 'at', hidden: true },
        { id: 'value-at', title: `${f}(${a})`, expr: `${f}(${a})`, tier: 1, section: 'at' },
        { id: 'slope-at', title: `${f}′(${a})`, expr: `${f}'(${a})`, tier: 1, section: 'at' },
        { id: 'tangent-at', title: 'Tangent line', expr: `tangent ${f} at ${a}`, tier: 1, section: 'at', pinName: 'L', visual: 'auto' },
      );
    return {
      object: f, typeLabel: 'function ℝ → ℝ', layout: GRAPH_LAYOUT, title: valueLatex(fv), sections, facts,
      relations: [{ kind: 'derivative-of', between: [`fact:derivative`, f], text: `${f}′ is the slope of ${f}` }], diagnostics: [],
    };
  },
});

// ------------------------------------------------------------------ f(x, y)

registerAnalyzer({
  id: 'function-2d',
  recognizes: (v) => isFn(v, 2),
  plan(f, value, ws): AnalysisPlan {
    const fv = value as FunctionValue;
    const P = firstPoint(ws, 2);
    const u = firstDirection(ws);
    const pName = freshName(ws, 'P');
    const sections: SectionSpec[] = [
      { id: 'overview', title: 'Domain, gradient & Hessian', defaultOpen: true },
      { id: 'critical', title: 'Critical points' },
    ];
    const facts: FactSpec[] = [
      { id: 'surface', title: 'Surface', expr: `surface(${f})`, tier: 0, section: 'overview', visual: 'always', hidden: true },
      { id: 'contours', title: 'Contours', expr: `contours(${f})`, tier: 0, section: 'overview', visual: 'always', hidden: true },
      { id: 'domain', title: 'Domain', expr: `domain(${f})`, tier: 0, section: 'overview', pinName: 'Dom' },
      { id: 'gradient', title: `∇${f}`, expr: `gradient ${f}`, tier: 0, section: 'overview', pinName: 'g' },
      { id: 'hessian', title: `H${f}`, expr: `hessian ${f}`, tier: 0, section: 'overview', pinName: 'H' },
      { id: 'critical', title: 'Critical points', expr: `critical ${f}`, tier: 1, section: 'critical', pinName: 'C', visual: 'auto' },
    ];
    if (P) {
      const Pl = symbolLatex(P);
      sections.push(
        {
          id: 'at', title: `At ${P}`, defaultOpen: true, why: 'gradient',
          actions: u ? [] : [{ label: '＋ Add a direction u', rows: [`${freshName(ws, 'θ')} = slider(0, 2π, 0.6)`, `${freshName(ws, 'u')} = <cos ${freshName(ws, 'θ')}, sin ${freshName(ws, 'θ')}>`] }],
        },
        { id: 'slices', title: `Cross-sections through ${P}` },
        { id: 'curvature', title: `Curvature at ${P}` },
        { id: 'path', title: `Steepest path from ${P}` },
      );
      facts.push(
        { id: 'value', title: `${f}(${P})`, expr: `${f}(${P})`, tier: 1, section: 'at' },
        { id: 'gradP', title: `∇${f}(${P})`, expr: `grad ${f} at ${P}`, tier: 1, section: 'at', pinName: 'gP', visual: 'auto' },
        { id: 'slope', title: `‖∇${f}(${P})‖`, expr: `norm(grad ${f} at ${P})`, tier: 1, section: 'at' },
        { id: 'level', title: 'Level curve', expr: `level ${f} at ${P}`, tier: 1, section: 'at', visual: 'auto' },
        { id: 'tangent', title: 'Tangent plane', expr: `tangent ${f} at ${P}`, tier: 1, section: 'at', pinName: 'T', visual: 'toggle' },
        ...(u ? [{ id: 'directional', title: `D_${u}${f}(${P})`, expr: `directional ${f} at ${P} toward ${u}`, tier: 1 as const, section: 'at', pinName: 'D', visual: 'auto' as const }] : []),
        { id: 'sliceX', title: `${f}(${P}.x, y)`, expr: `slice(${f}, x = ${P}.x)`, tier: 1, section: 'slices', visual: 'auto' },
        { id: 'sliceY', title: `${f}(x, ${P}.y)`, expr: `slice(${f}, y = ${P}.y)`, tier: 1, section: 'slices', visual: 'auto' },
        { id: 'hessianP', title: `H${f}(${P})`, expr: `hessian ${f} at ${P}`, tier: 1, section: 'curvature', pinName: 'HP' },
        { id: 'eigen', title: 'Principal curvatures', expr: `eigenvalues(hessian ${f} at ${P})`, tier: 1, section: 'curvature' },
        { id: 'axes', title: 'Principal directions', expr: `hessian_axes(${f}, ${P})`, tier: 1, section: 'curvature', visual: 'auto' },
        { id: 'quadratic', title: 'Quadratic approximation', expr: `quadratic(${f}, ${P})`, tier: 1, section: 'curvature', visual: 'toggle' },
        { id: 'path', title: 'Steepest ascent / descent', expr: `gradient_path(${f}, ${P})`, tier: 1, section: 'path', visual: 'auto' },
      );
      void Pl;
    } else {
      sections.push({ id: 'at', title: 'At a point', actions: [{ label: `＋ Add a point ${pName}`, rows: [`${pName} = point(1, 1) draggable`] }] });
    }
    return {
      object: f, typeLabel: 'function ℝ² → ℝ', layout: SURFACE_LAYOUT, title: valueLatex(fv), sections, facts,
      relations: [
        { kind: 'perpendicular', between: ['role:gradient', 'role:level'], text: '∇f is perpendicular to the level curve' },
        { kind: 'tangent', between: ['role:tangent', f], text: 'the tangent plane is the best linear approximation at P' },
      ],
      diagnostics: [],
    };
  },
});

// ------------------------------------------------------------------ point sets (analyze C)

registerAnalyzer({
  id: 'pointset',
  recognizes: (v) => v.kind === 'pointset',
  plan(name, value): AnalysisPlan {
    const n = (value as unknown as { points: unknown[] }).points.length;
    return {
      object: name, typeLabel: `set of ${n} point${n === 1 ? '' : 's'}`, layout: { canvasTitle: 'Points', views: [{ id: 'plane', label: 'Plane', renderer: 'plane' }], defaultView: 'plane' }, title: `${symbolLatex(name)} = ${valueLatex(value)}`,
      sections: [{ id: 'points', title: 'Points', defaultOpen: true }],
      facts: [
        { id: 'set', title: name, expr: name, tier: 0, section: 'points', visual: 'always' },
        { id: 'first', title: `first(${name})`, expr: `first(${name})`, tier: 0, section: 'points', pinName: 'P1' },
      ],
      relations: [], diagnostics: [],
    };
  },
});