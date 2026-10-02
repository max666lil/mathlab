/**
 * Regions of the plane and of space (Phase 3b): iterated bounds in both orders (with the strip sweep),
 * area / volume and centroid, the polar / cylindrical / spherical description of round regions, and
 * Riemann sums that fill the region with squares.
 */
import { registerAnalyzer, AnalysisPlan, FactSpec, SectionSpec } from '../../runtime/analysis';
import { symbolLatex } from '../../math-core/symbolic/print';
import { asRegion, roundness } from './region';
import { isCoordMap } from './coordmaps';
import { isField3 } from './field3d';
import { linearCoeffs } from './linear';
import { freshName } from '../core-calculus/analyzers';
import { valueLatex } from '../../math-core/values';
import type { PointValue } from '../../math-core/values';

registerAnalyzer({
  id: 'region',
  focusOnEdit: true,
  recognizes: (v) => !!asRegion(v),
  plan(R, value): AnalysisPlan {
    const r = asRegion(value)!;
    const plane = r.dim === 2;
    const round = r.system === 'cartesian' ? roundness(r.cons.map((c) => c.g), r.dim) : [];
    const measure = plane ? 'Area' : 'Volume';
    const layout: AnalysisPlan['layout'] = plane
      ? { canvasTitle: `Region ${R}`, views: [{ id: 'plane', label: '2D', renderer: 'plane' }], defaultView: 'plane' }
      : { canvasTitle: `Solid ${R}`, views: [{ id: 'space', label: '3D', renderer: 'scene' }], defaultView: 'space' };
    const typeLabel = `${r.system === 'cartesian' ? '' : r.system + ' '}region in ℝ${plane ? '²' : '³'}`;
    const title = `${symbolLatex(R)}:\\; ${r.latex}`;
    // unbounded regions (y < x²): drawn, but there is nothing to integrate
    if (!r.bounded)
      return {
        object: R, typeLabel: `unbounded ${typeLabel}`, layout, title,
        sections: [{ id: 'overview', title: 'Summary', summary: true }],
        facts: [],
        relations: [],
        diagnostics: ['The region is unbounded, so it has no finite area and no iterated bounds.'],
      };
    const sections: SectionSpec[] = [
      { id: 'overview', title: 'Summary', summary: true },
      { id: 'measure', title: measure, defaultOpen: true },
      { id: 'bounds', title: 'Iterated bounds', why: 'iterated' },
    ];
    const other = r.system === 'cartesian' ? (plane ? 'dx dy' : 'dx dy dz') : undefined;
    const facts: FactSpec[] = [
      { id: 'bounds', title: 'Bounds', expr: `bounds ${R}`, tier: 0, section: 'overview', pinName: 'B' },
      { id: 'measure', title: measure, expr: plane ? `area ${R}` : `volume ${R}`, tier: 1, section: 'measure', pinName: plane ? 'A' : 'V' },
      { id: 'centroid', title: 'Centroid', expr: `centroid ${R}`, tier: 1, section: 'measure', pinName: 'G', visual: 'auto' },
      ...(plane ? [{ id: 'strips', title: 'Strip sweep', expr: `strips ${R}`, tier: 1 as const, section: 'bounds', visual: 'auto' as const }] : []),
      ...(other ? [{ id: 'bounds2', title: `Order ${other}`, expr: `bounds ${R} order ${other}`, tier: 1 as const, section: 'bounds', pinName: 'B2' }] : []),
      ...(plane && other ? [{ id: 'strips2', title: `Strips (${other})`, expr: `strips ${R} order ${other}`, tier: 1 as const, section: 'bounds', visual: 'toggle' as const }] : []),
    ];
    if (round.length) {
      const sys = round[0];
      sections.push({ id: 'polar', title: `In ${sys} coordinates`, why: 'polar' });
      facts.push(
        { id: 'polarBounds', title: 'Bounds', expr: `bounds ${R} in ${sys}`, tier: 1, section: 'polar', pinName: 'Bp' },
        { id: 'polarMeasure', title: `${measure} (${sys})`, expr: `${plane ? 'area' : 'volume'} ${R} in ${sys}`, tier: 1, section: 'polar' },
        ...(plane
          ? [
              { id: 'polarGrid', title: 'Polar grid', expr: `polargrid ${R}`, tier: 1 as const, section: 'polar', visual: 'auto' as const },
              { id: 'polarStrips', title: 'Wedges', expr: `strips ${R} in polar`, tier: 1 as const, section: 'polar', visual: 'toggle' as const },
            ]
          : []),
      );
    }
    if (plane) {
      sections.push({ id: 'riemann', title: 'Riemann sums' });
      facts.push({ id: 'riemann', title: `${measure} by squares`, expr: `riemann 1 over ${R}`, tier: 1, section: 'riemann', visual: 'auto' });
    }
    return {
      object: R,
      typeLabel,
      layout,
      title,
      sections,
      facts,
      relations: [],
      diagnostics: [],
    };
  },
});

// ------------------------------------------------------------------ coordinate maps T(u, v) = (x, y)

registerAnalyzer({
  id: 'coordinate-map',
  focusOnEdit: true,
  // linear maps are recognised first by the linear-algebra plugin; curves and surfaces have other shapes
  // J = jacobian T is analysed as the map it comes from (its grid and its det)
  recognizes: (v) => isCoordMap(v) || (v.role === 'jacobian' && isCoordMap((v as unknown as import('../../math-core/values').FunctionValue).base)),
  plan(name, value0, ws): AnalysisPlan {
    const isJ = value0.role === 'jacobian';
    const value = isJ ? ((value0 as unknown as import('../../math-core/values').FunctionValue).base as import('../../math-core/values').MathValue) : value0;
    const T = isJ ? (ws.statements().find((s) => s.name && (ws.value(s.id) as { key?: string } | undefined)?.key === (value as { key: string }).key)?.name ?? name) : name;
    const f = value as import('../../math-core/values').FunctionValue;
    const n = f.params.length;
    const P = ws
      .statements()
      .find((s) => s.name && ws.value(s.id)?.kind === 'point' && (ws.value(s.id) as PointValue).coords.length === n)?.name;
    const sections: SectionSpec[] = [
      { id: 'overview', title: 'Summary', summary: true, why: 'polar' },
      { id: 'grid', title: n === 2 ? 'Grid picture: cells × |det J|' : 'Grid picture: cells × |det J| (cut away)', defaultOpen: true },
    ];
    const facts: FactSpec[] = [
      { id: 'jacobian', title: 'Jacobian', expr: `jacobian ${T}`, tier: 0, section: 'overview', pinName: 'J' },
      { id: 'det', title: n === 2 ? 'Area scale det J' : 'Volume scale det J', expr: `det(jacobian ${T})`, tier: 0, section: 'overview', pinName: 'detJ' },
      { id: 'grid', title: 'Grid', expr: `coordgrid ${T}`, tier: 1 as const, section: 'grid', visual: 'auto' as const },
    ];
    if (P) {
      sections.push({ id: 'at', title: `At ${P}` });
      facts.push(
        { id: 'JP', title: `J(${P})`, expr: `jacobian ${T} at ${P}`, tier: 1, section: 'at', pinName: 'JP' },
        { id: 'detP', title: `det J(${P})`, expr: `det(jacobian ${T} at ${P})`, tier: 1, section: 'at' },
      );
    }
    return {
      object: T,
      typeLabel: `coordinate map ℝ${n === 2 ? '²' : '³'} → ℝ${n === 2 ? '²' : '³'}`,
      layout:
        n === 2
          ? { canvasTitle: `Map ${T}`, views: [{ id: 'plane', label: '2D', renderer: 'plane' }], defaultView: 'plane' }
          : { canvasTitle: `Map ${T}`, views: [{ id: 'space', label: '3D', renderer: 'scene' }], defaultView: 'space' },
      title: `${symbolLatex(T)}(${f.params.map(symbolLatex).join(', ')}) = ${valueLatex(value).split(' = ').pop()}`,
      sections,
      facts,
      relations: [],
      diagnostics: [],
    };
  },
});

// ------------------------------------------------------------------ scalar fields T(x, y, z)

const SPACE_LAYOUT = (title: string): AnalysisPlan['layout'] => ({ canvasTitle: title, views: [{ id: 'space', label: '3D', renderer: 'scene' }], defaultView: 'space', menu: { shots: true } });

registerAnalyzer({
  id: 'scalar-field-3d',
  focusOnEdit: true,
  recognizes: (v) => isField3(v),
  plan(T, value, ws): AnalysisPlan {
    const f = value as import('../../math-core/values').FunctionValue;
    const [, , z] = f.params;
    const P = ws.statements().find((s) => s.name && ws.value(s.id)?.kind === 'point' && (ws.value(s.id) as PointValue).coords.length === 3)?.name;
    const u = ws.statements().find((s) => s.name && ws.value(s.id)?.kind === 'vector' && (ws.value(s.id) as unknown as { comps: number[] }).comps.length === 3)?.name;
    const slider = ws.statements().find((s) => s.name && s.input?.kind === 'slider' && /^(c|z0|z_0|h|a)$/.test(s.name))?.name;
    const sections: SectionSpec[] = [
      { id: 'overview', title: 'Summary', summary: true },
      { id: 'critical', title: 'Critical points' },
    ];
    const facts: FactSpec[] = [
      { id: 'levels', title: 'Level surfaces', expr: `levelsurfaces(${T})`, tier: 0, section: 'overview', visual: 'always', hidden: true },
      { id: 'domain', title: 'Domain', expr: `domain ${T}`, tier: 0, section: 'overview' },
      { id: 'gradient', title: 'Gradient', expr: `gradient ${T}`, tier: 0, section: 'overview', pinName: 'g' },
      { id: 'hessian', title: 'Hessian', expr: `hessian ${T}`, tier: 0, section: 'overview', pinName: 'H' },
      { id: 'laplacian', title: 'Laplacian ∇²', expr: `laplacian(${T})`, tier: 0, section: 'overview', pinName: 'L' },
      { id: 'critical', title: 'Critical points', expr: `critical ${T}`, tier: 1, section: 'critical', pinName: 'C', visual: 'auto' },
    ];
    if (linearCoeffs(f)) {
      sections.splice(1, 0, { id: 'linear', title: 'Linear function: a dot product', defaultOpen: true });
      facts.push({ id: 'linear', title: 'Linear form', expr: `linearform ${T}`, tier: 0, section: 'linear', visual: 'auto' });
    }
    if (slider) {
      sections.push({ id: 'slice', title: `Slice ${z} = ${slider}` });
      facts.push({ id: 'slice', title: `${T} on ${z} = ${slider}`, expr: `sliceplane(${T}, ${z}, ${slider})`, tier: 1, section: 'slice', visual: 'auto' });
    } else sections.push({ id: 'slice', title: 'Slice plane', actions: [{ label: `＋ Add a slice ${z} = c`, rows: [`c = slider(-2, 2, 0)`] }] });
    if (P) {
      sections.push({ id: 'at', title: `At ${P}`, why: 'gradient' });
      facts.push(
        { id: 'value', title: `${T}(${P})`, expr: `${T}(${P})`, tier: 1, section: 'at' },
        { id: 'gradP', title: `∇${T}(${P})`, expr: `grad ${T} at ${P}`, tier: 1, section: 'at', pinName: 'gP', visual: 'auto' },
        { id: 'levelP', title: 'Level surface through P', expr: `levelsurface(${T}, ${P})`, tier: 1, section: 'at', visual: 'auto' },
        { id: 'tangentP', title: 'Tangent plane', expr: `tangent ${T} at ${P}`, tier: 1, section: 'at', visual: 'auto' },
        ...(u ? [{ id: 'dirP', title: `D_${u}${T}(${P})`, expr: `dirderiv(${T}, ${P}, ${u})`, tier: 1 as const, section: 'at' }] : []),
      );
    } else sections.push({ id: 'at', title: 'At a point', actions: [{ label: `＋ Add a point ${freshName(ws, 'P')}`, rows: [`${freshName(ws, 'P')} = point(1, 0.5, 0.5)`] }] });
    return {
      object: T, typeLabel: 'function ℝ³ → ℝ', layout: SPACE_LAYOUT(`Level surfaces of ${T}`), title: valueLatex(value), sections, facts,
      relations: [{ kind: 'perpendicular', between: ['role:gradient', 'role:level'], text: '∇f is perpendicular to the level surface' }],
      diagnostics: [],
    };
  },
});

registerAnalyzer({
  id: 'implicit-surface',
  focusOnEdit: true,
  recognizes: (v) => v.kind === 'implicitsurface',
  plan(S, value): AnalysisPlan {
    // a linear equation is a plane: its coefficients are the normal vector
    const plane = !!linearCoeffs((value as unknown as { fn: import('../../math-core/values').FunctionValue }).fn);
    return {
      object: S, typeLabel: plane ? 'plane ax + by + cz = d' : 'surface G(x, y, z) = 0', layout: SPACE_LAYOUT(`${plane ? 'Plane' : 'Surface'} ${S}`), title: `${symbolLatex(S)}:\\; ${(value as unknown as { latex: string }).latex}`,
      sections: [{ id: 'overview', title: 'Summary', summary: true }, ...(plane ? [{ id: 'plane', title: 'Normal vector and dot-product form', defaultOpen: true }] : [])],
      facts: plane ? [{ id: 'plane', title: 'Plane', expr: `linearform ${S}`, tier: 0, section: 'plane', visual: 'auto' }] : [],
      relations: [], diagnostics: [],
    };
  },
});

// ------------------------------------------------------------------ constrained optimisation

registerAnalyzer({
  id: 'optimization',
  focusOnEdit: true,
  recognizes: (v) => v.kind === 'optimum',
  plan(O, value): AnalysisPlan {
    const o = value as unknown as { vars: string[]; candidates: unknown[]; objective: string };
    const n = o.vars.length;
    return {
      object: O,
      typeLabel: `optimization in ℝ${n === 2 ? '²' : '³'}`,
      layout: n === 2 ? { canvasTitle: `Lagrange: ${O}`, views: [{ id: 'plane', label: 'Contours', renderer: 'plane' }], defaultView: 'plane' } : SPACE_LAYOUT(`Lagrange: ${O}`),
      title: `${symbolLatex(O)}`,
      sections: [{ id: 'overview', title: 'Summary', summary: true, why: 'lagrange' }],
      // the worksheet row draws the picture (constraint, contours, candidates, ∇f ∥ ∇g)
      facts: [{ id: 'result', title: 'Candidates', expr: O, tier: 0, section: 'overview' }],
      relations: [{ kind: 'parallel', between: ['role:gradient', 'role:direction'], text: '∇f ∥ ∇g at the optimum' }],
      diagnostics: [],
    };
  },
});