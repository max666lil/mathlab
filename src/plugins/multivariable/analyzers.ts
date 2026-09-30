/**
 * Regions of the plane and of space (Phase 3b): iterated bounds in both orders (with the strip sweep),
 * area / volume and centroid, the polar / cylindrical / spherical description of round regions, and
 * Riemann sums that fill the region with squares.
 */
import { registerAnalyzer, AnalysisPlan, FactSpec, SectionSpec } from '../../runtime/analysis';
import { symbolLatex } from '../../math-core/symbolic/print';
import { asRegion, roundness } from './region';

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
        facts: [{ id: 'region', title: R, expr: R, tier: 0, section: 'overview', visual: 'always', hidden: true }],
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
      { id: 'region', title: R, expr: R, tier: 0, section: 'overview', visual: 'always', hidden: true },
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