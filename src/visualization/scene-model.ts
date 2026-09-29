/**
 * Scene model: maps mathematical values to declarative visual items consumed by every view.
 * Framework-free and renderer-free. A `show` statement or a visible named object yields items;
 * the 2D and 3D renderers each draw the vtypes they understand.
 */
import { MathValue, VisualValue, VectorValue, PointValue, FunctionValue, ListValue, ShowValue } from '../math-core/values';

export interface SceneItem {
  /** `${nodeId}#${index}` — stable across recomputation */
  id: string;
  nodeId: string;
  visual: VisualValue;
  color: string;
  visible: boolean;
}

export interface VisualContext {
  nodeId: string;
  /** Name of the defining statement, if any */
  name?: string;
  /** Node id that accepts direct manipulation (draggable point / input) */
  inputId?: string;
}

type DefaultVisualRule = (v: MathValue, ctx: VisualContext) => VisualValue[] | undefined;
const rules = new Map<string, DefaultVisualRule>();

export function registerDefaultVisual(kind: string, rule: DefaultVisualRule) {
  rules.set(kind, rule);
}

export const visual = (vtype: string, props: Record<string, unknown>, label?: string, role?: string): VisualValue => ({ kind: 'visual', vtype, props, label, role });

export function toVisuals(v: MathValue, ctx: VisualContext): VisualValue[] {
  if (v.kind === 'visual') return [v as VisualValue];
  if (v.kind === 'show') return (v as ShowValue).items.flatMap((it) => toVisuals(it, ctx));
  if (v.kind === 'list') return (v as ListValue).items.flatMap((it) => toVisuals(it, ctx));
  return rules.get(v.kind)?.(v, ctx) ?? [];
}

registerDefaultVisual('point', (v, ctx) => [visual('point', { coords: (v as PointValue).coords, inputId: ctx.inputId }, ctx.name, v.role)]);
registerDefaultVisual('vector', (v, ctx) => {
  const vec = v as VectorValue;
  const anchor = vec.anchor ?? vec.comps.map(() => 0);
  return [visual('arrow', { anchor, vec: vec.comps, sourceId: ctx.nodeId }, ctx.name, v.role)];
});
registerDefaultVisual('function', (v, ctx) => {
  const f = v as FunctionValue;
  if (f.out === 'scalar' && f.params.length === 2)
    return [visual('surface', { fn: f }, ctx.name, v.role), visual('contours', { fn: f }, ctx.name, v.role)];
  if (f.out === 'scalar' && f.params.length === 1) return [visual('graph1d', { fn: f }, ctx.name, v.role)];
  if (f.out === 'vector' && f.params.length === 2) return [visual('field2', { fn: f }, ctx.name, v.role)];
  return undefined;
});
registerDefaultVisual('plane', (v, ctx) => [visual('plane', { plane: v }, ctx.name, v.role ?? 'tangent')]);
registerDefaultVisual('slice', (v, ctx) => [visual('slice', { slice: v }, ctx.name, v.role)]);

// ------------------------------------------------------------------ colours

/** Semantic colours: the same object has the same colour in every view. */
export const ROLE_COLORS: Record<string, string> = {
  gradient: '#ff6b6b',
  direction: '#4cc9f0',
  point: '#ffd166',
  tangent: '#5b8cff',
  'slice-x': '#f4a261',
  'slice-y': '#52d69b',
  'slice-dir': '#c77dff',
  level: '#ffd166',
  path: '#ff8fab',
  hessian: '#b388ff',
  quadratic: '#80deea',
  surface: '#8ab4f8',
};
const PALETTE = ['#4cc9f0', '#f4a261', '#52d69b', '#c77dff', '#ff8fab', '#ffd166', '#80deea', '#e9c46a'];

export function colorFor(v: VisualValue, index: number): string {
  if (typeof v.props.color === 'string') return v.props.color;
  if (v.role && ROLE_COLORS[v.role]) return ROLE_COLORS[v.role];
  if (v.vtype === 'point') return ROLE_COLORS.point;
  if (v.vtype === 'plane') return ROLE_COLORS.tangent;
  return PALETTE[index % PALETTE.length];
}
