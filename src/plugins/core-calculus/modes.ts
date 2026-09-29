/**
 * The four concept modes of the gradient lab. They reuse the same objects and only decide what
 * is in focus, what stays as context, the camera and the annotations.
 */
import { registerMode, registerRelation, Level } from '../../visualization/presentation';
import type { SceneItem } from '../../visualization/scene-model';

const kind = (it: SceneItem) => (it.visual.vtype === 'arrow' ? `arrow:${it.visual.role ?? 'direction'}` : it.visual.vtype === 'slice' ? (it.visual.role ?? 'slice') : it.visual.vtype);

function table(t: Record<string, Level>) {
  return (it: SceneItem): Level | undefined => t[kind(it)];
}

registerMode({
  id: 'surface',
  title: 'Surface',
  hint: 'z = f(x, y) and its contour map are the same object seen two ways',
  shot: 'orbit',
  slice: 'slice-x',
  level: table({ surface: 'focus', contours: 'focus', point: 'focus' }),
});

registerMode({
  id: 'gradient',
  title: 'Gradient',
  hint: '∇f points across the contours, perpendicular to the level curve through P',
  shot: 'high',
  slice: 'slice-x',
  level: table({ surface: 'focus', contours: 'focus', point: 'focus', 'arrow:gradient': 'focus', level: 'focus' }),
});

registerMode({
  id: 'directional',
  title: 'Directional derivative',
  hint: 'Rotate u: the slope D_u f = ∇f · u goes from negative through 0 to its maximum ‖∇f‖',
  shot: 'orbit',
  slice: 'slice-dir',
  annotations: ['angle'],
  level: table({
    surface: 'focus', contours: 'context', point: 'focus', 'arrow:gradient': 'context', 'arrow:direction': 'focus',
    'slice-dir': 'focus', plane: 'context',
  }),
});

registerMode({
  id: 'local',
  title: 'Local geometry',
  hint: 'Near P the surface is its tangent plane, then its quadratic approximation',
  shot: 'zoom',
  slice: 'slice-x',
  level: table({
    surface: 'context', point: 'focus', plane: 'focus', quadratic: 'focus', hessian_axes: 'focus',
    'slice-x': 'context', 'slice-y': 'context', 'arrow:gradient': 'context',
  }),
});

// emphasising the gradient brings out the level curve it is perpendicular to, etc.
registerRelation('role:gradient', ['role:level']);
registerRelation('role:direction', ['role:slice-dir', 'annot:angle']);
registerRelation('role:hessian', ['role:quadratic']);