/** Multiple integrals and coordinate systems (Phase 3b) — math side. */
import { definePlugin } from '../plugin-api';
import { visual } from '../../visualization/scene-model';
import { multivariableBuiltins, wrapExisting, BoundsValue } from './builtins';
import type { RegionValue } from './region';
import { visualBuiltins } from './visuals';
import { coordGrid, detOfFunctions } from './coordmaps';
import { getBuiltin } from '../../math-core/builtins';

const SYS: Record<string, string> = { cartesian: '', polar: 'polar ', cylindrical: 'cylindrical ', spherical: 'spherical ' };

export const multivariableMath = definePlugin({
  name: 'multivariable',
  install(api) {
    multivariableBuiltins.forEach((b) => api.registerBuiltin(b));
    visualBuiltins.forEach((b) => api.registerBuiltin(b));
    api.registerBuiltin(coordGrid);
    const det = getBuiltin('det');
    if (det) api.registerBuiltin(detOfFunctions(det));
    wrapExisting((b) => api.registerBuiltin(b));
    api.registerValueKind({
      kind: 'region',
      latex: (v) => (v as unknown as RegionValue).latex,
      typeLabel: (v) => {
        const r = v as unknown as RegionValue;
        return `${SYS[r.system]}region in ℝ${r.dim === 2 ? '²' : '³'}`;
      },
    });
    api.registerValueKind({
      kind: 'bounds',
      latex: (v) => (v as unknown as BoundsValue).latex,
      typeLabel: () => 'iterated bounds',
    });
    api.registerDefaultVisual('region', (v, ctx) => {
      const r = v as unknown as RegionValue;
      return r.dim === 2
        ? [visual('region', { fn: r.test, rel: '<=', box: r.bounded ? r.box : undefined }, ctx.name, 'region')]
        : [visual('solid', { test: r.test, box: r.box, key: r.key }, ctx.name, 'solid')];
    });
  },
});