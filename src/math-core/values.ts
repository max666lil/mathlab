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
import { recognize } from './recognize';
import { toFrac } from './rational';

/**
 * How trustworthy a result is:
 *  exact     — derived symbolically (or verified symbolically), e.g. derivatives, verified antiderivatives
 *  numeric   — iterative numerical method with a residual check, e.g. a critical point found by Newton
 *  heuristic — sampled / scanned evidence, e.g. a domain scan on a window, a numeric limit
 */
export type Certainty = 'exact' | 'numeric' | 'heuristic';

interface Base {
  /** Semantic role used for styling / explanations, e.g. 'gradient', 'direction'. */
  role?: string;
  /** Optional LaTeX describing how the value was obtained, e.g. '\\nabla f(P)'. */
  derivation?: string;
  certainty?: Certainty;
  /** plain-text justification of the certainty (method, window, residual…) */
  evidence?: string;
  /** geometric interpretation carried by a result (e.g. a directional derivative carries u and its slice) */
  visuals?: VisualValue[];
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
  /** LaTeX name used when printing, e.g. 'f' or '\\nabla f'. */
  label?: string;
  /** Canonical identity (expression + environment) for caches in renderers. */
  key: string;
  /** For derived functions (∇f, Hf): the scalar field they came from. */
  base?: FunctionValue;
  /** parameter ranges of curves / surfaces: `for t in [0, 2π]` */
  ranges?: Record<string, [number, number]>;
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
  /** Name of the marked point node (dragging along the slice moves it) */
  markerId?: string;
  label: string;
}
export interface ListValue extends Base {
  kind: 'list';
  items: MathValue[];
}
export interface BoolValue extends Base {
  kind: 'bool';
  value: boolean;
  /** LaTeX justification, e.g. '\\det A = 3 \\neq 0' */
  reason?: string;
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

/** An entry of an exact vector / matrix: its closed form (1/3, √2/2) when recognised. */
export function entryLatex(x: number, exact: boolean | undefined): string {
  if (Object.is(x, -0) || Math.abs(x) < 1e-13) return '0';
  if (!exact || Number.isInteger(x)) return numberLatex(x);
  return recognize(x)?.latex ?? fracOrDecimal(x);
}

/** Exact rationals with larger denominators (−7/120, 17/72) still print as fractions. */
function fracOrDecimal(x: number): string {
  const q = toFrac(x);
  if (!q || q.d > 100000n) return numberLatex(x);
  const n = q.n < 0n ? -q.n : q.n;
  return `${q.n < 0n ? '-' : ''}\\frac{${n}}{${q.d}}`;
}

export function matrixLatex(rows: number[][], exact?: boolean): string {
  return `\\begin{pmatrix}${rows.map((r) => r.map((x) => entryLatex(x, exact)).join(' & ')).join(' \\\\ ')}\\end{pmatrix}`;
}

export function vectorLatex(comps: number[], exact?: boolean): string {
  return `\\left\\langle ${comps.map((x) => entryLatex(x, exact)).join(', ')}\\right\\rangle`;
}

export function functionSignatureLatex(f: FunctionValue): string {
  return `${f.label ?? 'f'}(${f.params.map(symbolLatex).join(', ')})`;
}

const SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const sup = (n: number) => (n === 1 ? '' : (SUP[n] ?? `^${n}`));

registerValueKind({
  kind: 'scalar',
  // exact results show their closed form (1/3, √2); numeric ones stay decimal
  latex: (v) => {
    const x = (v as ScalarValue).value;
    if (Number.isNaN(x)) return '\\text{undefined}';
    if (v.certainty === 'exact' && !Number.isInteger(x)) return entryLatex(x, true);
    // a numeric value that matches a closed form: "4.712 ≈ 3π/2" (it stays numeric)
    if (v.certainty === 'numeric' && !Number.isInteger(x) && Math.abs(x) > 1e-9) {
      const r = recognize(x);
      if (r && !/^-?\d+$/.test(r.text)) return `${numberLatex(x)} \\approx ${r.latex}`;
    }
    return numberLatex(x);
  },
  typeLabel: (v) => ((v as ScalarValue).slider ? 'slider ∈ ℝ' : 'scalar ∈ ℝ'),
});
registerValueKind({
  kind: 'point',
  latex: (v) => `\\left(${nums((v as PointValue).coords)}\\right)`,
  typeLabel: (v) => `point in ℝ${sup((v as PointValue).coords.length)}`,
  member: (v, prop) => memberOf((v as PointValue).coords, prop),
});
registerValueKind({
  kind: 'vector',
  latex: (v) => vectorLatex((v as VectorValue).comps, v.certainty === 'exact'),
  typeLabel: (v) => `vector in ℝ${sup((v as VectorValue).comps.length)}${(v as VectorValue).anchor ? ' (bound)' : ''}`,
  member: (v, prop) => memberOf((v as VectorValue).comps, prop),
});
registerValueKind({
  kind: 'matrix',
  latex: (v) => matrixLatex((v as MatrixValue).rows, v.certainty === 'exact'),
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
  latex: (v) => (v as PlaneValue).latex ?? `\\text{plane through } (${nums((v as PlaneValue).point)})`,
  typeLabel: () => 'plane in ℝ³',
});
registerValueKind({ kind: 'slice', latex: (v) => (v as SliceValue).label, typeLabel: () => 'cross-section curve' });
registerValueKind({
  kind: 'list',
  // long lists (simulated data) show their first entries and their size
  latex: (v) => {
    const items = (v as ListValue).items;
    if (items.length <= 12) return `\\left[${items.map(valueLatex).join(', ')}\\right]`;
    return `\\left[${items.slice(0, 6).map(valueLatex).join(', ')}, \\ldots\\right]_{${items.length}}`;
  },
  typeLabel: (v) => `list of ${(v as ListValue).items.length}`,
});
registerValueKind({
  kind: 'bool',
  latex: (v) => {
    const b = v as BoolValue;
    if (!b.reason) return b.value ? '\\text{true}' : '\\text{false}';
    return `\\begin{array}{l} \\text{${b.value ? 'yes' : 'no'}} \\\\ \\scriptstyle ${b.reason} \\end{array}`;
  },
  typeLabel: () => 'boolean',
});
registerValueKind({
  kind: 'visual',
  latex: (v) => `\\text{${(v as VisualValue).label ?? (v as VisualValue).vtype}}`,
  typeLabel: (v) => `visual: ${(v as VisualValue).vtype}`,
});
registerValueKind({
  kind: 'show',
  latex: (v) => (v as ShowValue).items.map((it) => (it.kind === 'visual' ? valueLatex(it) : `\\text{${typeLabel(it)}}`)).join(',\\;'),
  typeLabel: () => 'shown in views',
});
registerValueKind({
  kind: 'animation',
  latex: (v) => {
    const a = v as AnimationValue;
    return `${symbolLatex(a.target)}: ${numberLatex(a.from)} \\to ${numberLatex(a.to)}`;
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
  return spec ? spec.latex(v) : `\\text{${v.kind}}`;
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
