/**
 * Typed mathematical values flowing through the reactive graph.
 *
 * The union below covers the core kinds. The set is open: plugins register additional kinds
 * (e.g. 'distribution', 'random-variable', 'dataset') with `registerValueKind`, which supplies
 * how the value prints and how it is described in the inspector.
 */
import { Expr } from './ast';
import { NumericEnv } from './compile';
import { toLatex, formatNumber, numberLatex, symbolLatex } from './symbolic/print';

interface Base {
  /** Semantic role used for styling / explanations, e.g. 'gradient', 'direction'. */
  role?: string;
  /** Optional LaTeX describing how the value was obtained, e.g. '\nabla f(P)'. */
  derivation?: string;
}

export interface ScalarValue extends Base {
  kind: 'scalar';
  value: number;
  slider?: { min: number; max: number; step?: number };
}
export interface PointValue extends Base {
  kind: 'point';
  coords: number[];
}
export interface VectorValue extends Base {
  kind: 'vector';
  comps: number[];
  /** Base point for a bound vector (e.g. ∇f drawn at P). */
  anchor?: number[];
}
export interface MatrixValue extends Base {
  kind: 'matrix';
  rows: number[][];
}
export interface FunctionValue extends Base {
  kind: 'function';
  params: string[];
  /** Symbolic body (scalar, <vector> or [[matrix]]) — absent for purely numeric functions. */
  expr?: Expr;
  /** Numeric values of free symbols used by `expr` (parameters such as a, or P for P.x). */
  env: NumericEnv;
  eval: (...args: number[]) => number | number[] | number[][];
  out: 'scalar' | 'vector' | 'matrix';
  /** LaTeX name used when printing, e.g. 'f' or '\nabla f'. */
  label?: string;
  /** Canonical identity (expression + environment) for caches in renderers. */
  key: string;
  /** For derived functions (∇f, Hf): the scalar field they came from. */
  base?: FunctionValue;
}
export interface PlaneValue extends Base {
  kind: 'plane';
  point: number[];
  normal: number[];
  /** z = a + b(x - x0) + c(y - y0) representation when the plane is a graph */
  latex?: string;
}
export interface SliceValue extends Base {
  kind: 'slice';
  fn: FunctionValue;
  /** Line in the domain: origin + t·dir (dir unit length) */
  origin: number[];
  dir: number[];
  /** Index of the coordinate axis the slice runs along (for axis-aligned slices) */
  axis?: number;
  /** Parameter t of a marked point on the slice (e.g. P), if any */
  marker?: number;
  label: string;
}
export interface ListValue extends Base {
  kind: 'list';
  items: MathValue[];
}
export interface BoolValue extends Base {
  kind: 'bool';
  value: boolean;
}
/** A visual primitive (surface, contours, arrow...). Props are interpreted by renderers. */
export interface VisualValue extends Base {
  kind: 'visual';
  vtype: string;
  props: Record<string, unknown>;
  label?: string;
}
export interface ShowValue extends Base {
  kind: 'show';
  items: MathValue[];
  /** Name of each item when it is a bare reference (show P) */
  sources?: (string | undefined)[];
}
export interface AnimationValue extends Base {
  kind: 'animation';
  target: string;
  from: number;
  to: number;
  duration: number;
}
/** Extension point for plugin-defined kinds. */
export interface OpaqueValue extends Base {
  kind: string;
  [key: string]: unknown;
}

export type CoreValue =
  | ScalarValue
  | PointValue
  | VectorValue
  | MatrixValue
  | FunctionValue
  | PlaneValue
  | SliceValue
  | ListValue
  | BoolValue
  | VisualValue
  | ShowValue
  | AnimationValue;

export type MathValue = CoreValue | OpaqueValue;

export const scalar = (value: number, extra: Partial<ScalarValue> = {}): ScalarValue => ({ kind: 'scalar', value, ...extra });
export const point = (coords: number[]): PointValue => ({ kind: 'point', coords });
export const vector = (comps: number[], anchor?: number[], extra: Partial<VectorValue> = {}): VectorValue => ({ kind: 'vector', comps, anchor, ...extra });
export const matrixV = (rows: number[][], extra: Partial<MatrixValue> = {}): MatrixValue => ({ kind: 'matrix', rows, ...extra });

export function isKind<K extends CoreValue['kind']>(v: MathValue | undefined, kind: K): v is Extract<CoreValue, { kind: K }> {
  return !!v && v.kind === kind;
}

// ------------------------------------------------------------------ kind registry

export interface ValueKindSpec {
  kind: string;
  latex(v: MathValue): string;
  typeLabel(v: MathValue): string;
  member?(v: MathValue, prop: string): MathValue | undefined;
}

const kinds = new Map<string, ValueKindSpec>();
export function registerValueKind(spec: ValueKindSpec) {
  kinds.set(spec.kind, spec);
}

const nums = (xs: number[], d = 4) => xs.map((x) => numberLatex(x, d)).join(', ');

export function functionSignatureLatex(f: FunctionValue): string {
  return `${f.label ?? 'f'}(${f.params.map(symbolLatex).join(', ')})`;
}

const SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const sup = (n: number) => (n === 1 ? '' : (SUP[n] ?? `^${n}`));

registerValueKind({
  kind: 'scalar',
  latex: (v) => numberLatex((v as ScalarValue).value),
  typeLabel: (v) => ((v as ScalarValue).slider ? 'slider ∈ ℝ' : 'scalar ∈ ℝ'),
});
registerValueKind({
  kind: 'point',
  latex: (v) => `\left(${nums((v as PointValue).coords)}\right)`,
  typeLabel: (v) => `point in ℝ${sup((v as PointValue).coords.length)}`,
  member: (v, prop) => memberOf((v as PointValue).coords, prop),
});
registerValueKind({
  kind: 'vector',
  latex: (v) => `\left\langle ${nums((v as VectorValue).comps)}\right\rangle`,
  typeLabel: (v) => `vector in ℝ${sup((v as VectorValue).comps.length)}${(v as VectorValue).anchor ? ' (bound)' : ''}`,
  member: (v, prop) => memberOf((v as VectorValue).comps, prop),
});
registerValueKind({
  kind: 'matrix',
  latex: (v) => `\begin{pmatrix}${(v as MatrixValue).rows.map((r) => r.map((x) => numberLatex(x)).join(' & ')).join(' \\ ')}\end{pmatrix}`,
  typeLabel: (v) => `${(v as MatrixValue).rows.length}×${(v as MatrixValue).rows[0]?.length ?? 0} matrix`,
});
registerValueKind({
  kind: 'function',
  latex: (v) => {
    const f = v as FunctionValue;
    return f.expr ? `${functionSignatureLatex(f)} = ${toLatex(f.expr)}` : functionSignatureLatex(f);
  },
  typeLabel: (v) => {
    const f = v as FunctionValue;
    const out = f.out === 'scalar' ? 'ℝ' : f.out === 'vector' ? `ℝ${sup(outDim(f))}` : 'matrices';
    return `function ℝ${sup(f.params.length)} → ${out}`;
  },
});
registerValueKind({
  kind: 'plane',
  latex: (v) => (v as PlaneValue).latex ?? `\text{plane through } (${nums((v as PlaneValue).point)})`,
  typeLabel: () => 'plane in ℝ³',
});
registerValueKind({ kind: 'slice', latex: (v) => (v as SliceValue).label, typeLabel: () => 'cross-section curve' });
registerValueKind({
  kind: 'list',
  latex: (v) => `\left[${(v as ListValue).items.map(valueLatex).join(', ')}\right]`,
  typeLabel: (v) => `list of ${(v as ListValue).items.length}`,
});
registerValueKind({ kind: 'bool', latex: (v) => ((v as BoolValue).value ? '\text{true}' : '\text{false}'), typeLabel: () => 'boolean' });
registerValueKind({
  kind: 'visual',
  latex: (v) => `\text{${(v as VisualValue).label ?? (v as VisualValue).vtype}}`,
  typeLabel: (v) => `visual: ${(v as VisualValue).vtype}`,
});
registerValueKind({
  kind: 'show',
  latex: (v) => (v as ShowValue).items.map((it) => (it.kind === 'visual' ? valueLatex(it) : `\text{${typeLabel(it)}}`)).join(',\;'),
  typeLabel: () => 'shown in views',
});
registerValueKind({
  kind: 'animation',
  latex: (v) => {
    const a = v as AnimationValue;
    return `${symbolLatex(a.target)}: ${numberLatex(a.from)} \to ${numberLatex(a.to)}`;
  },
  typeLabel: () => 'animation',
});

export function outDim(f: FunctionValue): number {
  if (f.expr && (f.expr.type === 'vec' || f.expr.type === 'tuple')) return f.expr.items.length;
  const probe = f.eval(...f.params.map(() => 0.1));
  return Array.isArray(probe) ? probe.length : 1;
}

function memberOf(xs: number[], prop: string): MathValue | undefined {
  const named: Record<string, number> = { x: 0, y: 1, z: 2, w: 3 };
  const idx = prop in named ? named[prop] : /^\d+$/.test(prop) ? Number(prop) - 1 : undefined;
  if (idx === undefined || idx >= xs.length) return undefined;
  return scalar(xs[idx]);
}

export function valueMember(v: MathValue, prop: string): MathValue | undefined {
  return kinds.get(v.kind)?.member?.(v, prop);
}

export function valueLatex(v: MathValue): string {
  const spec = kinds.get(v.kind);
  return spec ? spec.latex(v) : `\text{${v.kind}}`;
}

export function typeLabel(v: MathValue): string {
  return kinds.get(v.kind)?.typeLabel(v) ?? v.kind;
}

/** Short plain-text rendering (inspector, tooltips). */
export function valueText(v: MathValue): string {
  switch (v.kind) {
    case 'scalar':
      return formatNumber((v as ScalarValue).value);
    case 'point':
      return `(${(v as PointValue).coords.map((x) => formatNumber(x)).join(', ')})`;
    case 'vector':
      return `⟨${(v as VectorValue).comps.map((x) => formatNumber(x)).join(', ')}⟩`;
    default:
      return typeLabel(v);
  }
}
