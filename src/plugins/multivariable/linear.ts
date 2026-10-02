/**
 * Linear functions and planes (Hughes-Hallett §12.4, §13.3–13.4, §14.4): ax + by + cz is the dot
 * product (a, b, c)·(x, y, z). As a function f(x, y, z) = ax + by + cz + k it has the constant
 * gradient (a, b, c) and its level surfaces are parallel planes; as an equation ax + by + cz = d it is
 * one plane with normal n = (a, b, c). For two variables, the graph z = ax + by + k is the plane
 * ax + by − z = −k with normal (a, b, −1), and the level curves are parallel lines.
 */
import { Builtin, EvalError } from '../../math-core/builtins';
import { FunctionValue, MathValue } from '../../math-core/values';
import { numberLatex, symbolLatex } from '../../math-core/symbolic/print';
import { visual } from '../../visualization/scene-model';

/** Coefficients of a function that is a + Σ aᵢxᵢ (checked at several points), else undefined. */
export function linearCoeffs(fn: FunctionValue | undefined): { a: number[]; k: number } | undefined {
  if (!fn || fn.kind !== 'function' || fn.out !== 'scalar') return undefined;
  const n = fn.params.length;
  if (n < 2 || n > 3) return undefined;
  const G = fn.eval as (...p: number[]) => number;
  const zero = new Array(n).fill(0);
  const k = G(...zero);
  if (!Number.isFinite(k)) return undefined;
  const a = zero.map((_, i) => G(...zero.map((_z, j) => (j === i ? 1 : 0))) - k);
  if (!a.every(Number.isFinite) || a.every((c) => Math.abs(c) < 1e-14)) return undefined;
  for (const p of [[0.7, -1.3, 2.1], [-2.4, 0.9, 1.7], [3.1, 2.2, -0.6]]) {
    const x = p.slice(0, n);
    const lin = k + a.reduce((s, c, i) => s + c * x[i], 0);
    const v = G(...x);
    if (!(Math.abs(v - lin) <= 1e-9 * Math.max(1, Math.abs(v), Math.abs(lin)))) return undefined;
  }
  const clean = (v: number) => (Math.abs(v - Math.round(v)) < 1e-11 ? Math.round(v) : +v.toPrecision(12));
  return { a: a.map(clean), k: clean(k) };
}

export interface LinearFormValue {
  kind: 'linearform';
  latex: string;
  normal: number[];
  [k: string]: unknown;
}

const N = (x: number) => numberLatex(x, 5, true);
const vec = (v: number[]) => `\\left(${v.map(N).join(', ')}\\right)`;
const norm2 = (v: number[]) => v.reduce((s, c) => s + c * c, 0);
/** ‖v‖ as √n when n is a whole number that is not a square. */
const normLatex = (v: number[]) => {
  const s = norm2(v);
  const r = Math.sqrt(s);
  return Math.abs(r - Math.round(r)) < 1e-12 ? N(Math.round(r)) : Number.isInteger(s) ? `\\sqrt{${s}}` : N(r);
};
const rows = (lines: string[]) => `\\begin{aligned} ${lines.map((l) => `& ${l}`).join(' \\\\ ')} \\end{aligned}`;

/** A plane ax + by + cz = d: normal, point-normal reading, distance from the origin, intercepts. */
function planeForm(a: number[], d: number, name: string): LinearFormValue {
  const vars = ['x', 'y', 'z'];
  const s = norm2(a);
  const foot = a.map((c) => (c * d) / s);
  const dist = Math.abs(d) / Math.sqrt(s);
  const cuts = a.map((c, i) => (Math.abs(c) > 1e-14 ? `${vars[i]} = ${N(d / c)}` : '')).filter(Boolean);
  const latex = rows([
    `\\mathbf n = ${vec(a)} \\quad \\text{(the coefficients)}`,
    `\\mathbf n \\cdot (x, y, z) = ${N(d)}`,
    `\\text{distance from } O = \\frac{|d|}{\\|\\mathbf n\\|} = \\frac{${N(Math.abs(d))}}{${normLatex(a)}} \\approx ${numberLatex(dist, 4)}`,
    ...(Math.abs(d) > 1e-14 && cuts.length ? [`\\text{intercepts: } ${cuts.join(',\\ ')}`] : [`\\text{passes through the origin}`]),
  ]);
  return {
    kind: 'linearform', latex, normal: a, certainty: 'exact',
    evidence: `${name}: the coefficients of x, y, z are the normal vector; the nearest point to O is ${foot.map((c) => +c.toPrecision(4)).join(', ')}`,
    visuals: [visual('arrow', { anchor: foot, vec: a }, 'n', 'gradient')],
  };
}

export const linearform: Builtin = {
  name: 'linearform', command: true, minArgs: 1, maxArgs: 1, argModes: ['value'], category: 'multivariable',
  signature: 'linearform S · linearform f', doc: 'A plane ax + by + cz = d or a linear function: normal / gradient (a, b, c), the dot-product form, distance from the origin.',
  apply: ([v], _ctx, raw) => {
    const name = raw[0]?.type === 'sym' ? raw[0].name : 'f';
    if (v?.kind === 'implicitsurface') {
      const c = linearCoeffs((v as unknown as { fn: FunctionValue }).fn);
      if (!c) throw new EvalError('this surface is not a plane (its equation is not linear in x, y, z)');
      return planeForm(c.a, -c.k, name) as unknown as MathValue;
    }
    const f = v as FunctionValue | undefined;
    const c = linearCoeffs(f);
    if (!f || !c) throw new EvalError('not a linear function a·x + b·y (+ c·z) + k');
    const f0 = symbolLatex(name);
    const args = f.params.map(symbolLatex).join(', ');
    const tail = c.k ? ` ${c.k < 0 ? '-' : '+'} ${N(Math.abs(c.k))}` : '';
    if (f.params.length === 3) {
      return {
        kind: 'linearform', normal: c.a, certainty: 'exact',
        latex: rows([
          `${f0} = ${vec(c.a)} \\cdot (${args})${tail}`,
          `\\nabla ${f0} = ${vec(c.a)} \\quad \\text{(constant)}`,
          `\\text{level surfaces } ${f0} = c:\\ \\text{parallel planes}`,
          `\\text{with normal } \\mathbf n = \\nabla ${f0} = ${vec(c.a)}`,
        ]),
        evidence: 'a linear function is a dot product with its coefficient vector; that vector is the gradient everywhere',
        visuals: [visual('arrow', { anchor: [0, 0, 0], vec: c.a }, `∇${name}`, 'gradient')],
      } as unknown as MathValue;
    }
    const n3 = [...c.a, -1];
    return {
      kind: 'linearform', normal: n3, certainty: 'exact',
      latex: rows([
        `${f0} = ${vec(c.a)} \\cdot (${args})${tail}`,
        `\\nabla ${f0} = ${vec(c.a)} \\quad \\text{(constant)}`,
        `\\text{level curves: parallel lines} \\perp \\nabla ${f0}`,
        `\\text{graph } z = ${f0} \\text{ is the plane}`,
        `${vec(n3)} \\cdot (x, y, z) = ${N(-c.k)}`,
        `\\text{normal } \\mathbf n = ${vec(n3)}`,
      ]),
      evidence: 'z = ax + by + k rearranged to ax + by − z = −k: a plane whose normal is (a, b, −1)',
      visuals: [visual('arrow', { anchor: [0, 0], vec: c.a }, `∇${name}`, 'gradient')],
    } as unknown as MathValue;
  },
};