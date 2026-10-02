/**
 * Linear functions and planes (Hughes-Hallett §12.4, §13.3–13.4, §14.4): ax + by + cz is the dot
 * product (a, b, c)·(x, y, z). As a function f(x, y, z) = ax + by + cz + k it has the constant
 * gradient (a, b, c) and its level surfaces are parallel planes; as an equation ax + by + cz = d it is
 * one plane with normal n = (a, b, c). For two variables, the graph z = ax + by + k is the plane
 * ax + by − z = −k with normal (a, b, −1), and the level curves are parallel lines.
 */
import { Builtin, EvalContext, EvalError, expectCoords } from '../../math-core/builtins';
import { FunctionValue, MathValue, scalar } from '../../math-core/values';
import { num, sym } from '../../math-core/ast';
import { simplify, addList, mulList } from '../../math-core/symbolic/simplify';
import { implicitBox } from './field3d';
import { numberLatex, symbolLatex, toLatex } from '../../math-core/symbolic/print';
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
// ------------------------------------------------------------------ planes, distances, angles (§13.3–13.4)

const cross3 = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const dotN = (u: number[], v: number[]) => u.reduce((s, c, i) => s + c * v[i], 0);
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));

/** The plane n·(x, y, z) = d as a surface object (analysed like an equation typed by hand). */
function planeSurface(ctx: EvalContext, n: number[], d: number): MathValue {
  // whole-number normals are reduced: (2, 4, -2)·r = 6 → (1, 2, -1)·r = 3
  if ([...n, d].every((c) => Number.isInteger(c))) {
    const g = [...n, d].reduce((a, c) => gcd(a, c), 0) || 1;
    const sign = (n.find((c) => c !== 0) ?? 1) < 0 ? -1 : 1;
    n = n.map((c) => (c / g) * sign);
    d = (d / g) * sign;
  }
  const vars = ['x', 'y', 'z'];
  const left = simplify(addList(n.map((c, i) => mulList([num(c), sym(vars[i])]))));
  const fn = ctx.makeFunction({ type: 'bin', op: '-', left, right: num(d) }, vars);
  return {
    kind: 'implicitsurface', fn, latex: `${toLatex(left)} = ${N(d)}`, box: implicitBox(fn.eval as (...p: number[]) => number), key: `isurf|${fn.key}`, certainty: 'exact',
    evidence: 'the normal is the cross product of two directions in the plane; d = n·P',
  } as unknown as MathValue;
}

const point3 = (v: MathValue | undefined, what: string) => {
  const p = expectCoords(v, what);
  if (p.length !== 3) throw new EvalError(`${what}: three coordinates`);
  return p;
};

/** A line L(t) = A + t v given as a parametric function: its point and direction, else undefined. */
function lineOf(v: MathValue | undefined): { A: number[]; dir: number[] } | undefined {
  const f = v as FunctionValue | undefined;
  if (f?.kind !== 'function' || f.params.length !== 1 || f.out !== 'vector') return undefined;
  const L = f.eval as (t: number) => number[];
  const A = L(0), B = L(1), C = L(2.5);
  const dir = B.map((c, i) => c - A[i]);
  if (!A.every(Number.isFinite) || dir.every((c) => Math.abs(c) < 1e-14)) return undefined;
  return C.every((c, i) => Math.abs(c - (A[i] + 2.5 * dir[i])) < 1e-9 * (1 + Math.abs(c))) ? { A, dir } : undefined;
}

const planeOf = (v: MathValue | undefined) => (v?.kind === 'implicitsurface' ? linearCoeffs((v as unknown as { fn: FunctionValue }).fn) : undefined);
const deg = (rad: number) => `${numberLatex((rad * 180) / Math.PI, 5)}^{\\circ}`;

export const planeBuiltins: Builtin[] = [
  {
    name: 'plane', minArgs: 2, maxArgs: 3, category: 'multivariable', signature: 'plane(P, Q, R) · plane(P, n)',
    doc: 'The plane through three points, or through a point with a normal vector.',
    apply: (args, ctx) => {
      const P = point3(args[0], 'plane: the first point');
      if (args.length === 2) {
        if (args[1]?.kind !== 'vector') throw new EvalError('plane(P, n): the second argument is a normal vector <a, b, c> (two points only give a line; use three points)');
        const n = (args[1] as unknown as { comps: number[] }).comps;
        if (n.length !== 3 || n.every((c) => c === 0)) throw new EvalError('the normal vector needs three components, not all 0');
        return planeSurface(ctx, n, dotN(n, P));
      }
      const Q = point3(args[1], 'plane: the second point'), R = point3(args[2], 'plane: the third point');
      const n = cross3(Q.map((c, i) => c - P[i]), R.map((c, i) => c - P[i]));
      if (n.every((c) => Math.abs(c) < 1e-12)) throw new EvalError('the three points lie on one line: they do not determine a plane');
      return planeSurface(ctx, n, dotN(n, P));
    },
  },
  {
    name: 'distance', minArgs: 2, maxArgs: 2, category: 'multivariable', signature: 'distance(P, Q) · distance(P, S) · distance(P, L)',
    doc: 'Distance between two points, from a point to a plane, or from a point to a line.',
    apply: ([a, b]) => {
      const pa = planeOf(a) ? undefined : a, other = pa ? b : a;
      const pt = pa ?? b;
      const pl = planeOf(other);
      if (pl) {
        const P = point3(pt, 'distance: the point');
        const s = Math.sqrt(dotN(pl.a, pl.a));
        const signed = (dotN(pl.a, P) + pl.k) / s;
        const foot = P.map((c, i) => c - (signed * pl.a[i]) / s);
        return scalar(Math.abs(signed), {
          certainty: 'exact', evidence: `the perpendicular from the point meets the plane at (${foot.map((c) => +c.toPrecision(5)).join(', ')})`,
          derivation: `\\frac{|\\mathbf n\\cdot P - d|}{\\|\\mathbf n\\|} = \\frac{${N(Math.abs(dotN(pl.a, P) + pl.k))}}{${normLatex(pl.a)}}`,
          visuals: [visual('point', { coords: P }, 'P', 'point'), visual('arrow', { anchor: P, vec: foot.map((c, i) => c - P[i]) }, 'distance', 'direction')],
        } as never) as MathValue;
      }
      const line = lineOf(b) ?? lineOf(a);
      if (line) {
        const P = expectCoords(lineOf(b) ? a : b, 'distance: the point');
        if (P.length !== line.A.length) throw new EvalError('the point and the line need the same number of coordinates');
        const w = P.map((c, i) => c - line.A[i]);
        const t = dotN(w, line.dir) / dotN(line.dir, line.dir);
        const foot = line.A.map((c, i) => c + t * line.dir[i]);
        const dist = Math.hypot(...P.map((c, i) => c - foot[i]));
        return scalar(dist, {
          certainty: 'exact', evidence: `the nearest point of the line is (${foot.map((c) => +c.toPrecision(5)).join(', ')}), at t = ${+t.toPrecision(5)}`,
          derivation: `\\left\\| (P - A) - \\operatorname{proj}_{\\mathbf v}(P - A) \\right\\|`,
          visuals: [visual('point', { coords: P }, 'P', 'point'), visual('arrow', { anchor: P, vec: foot.map((c, i) => c - P[i]) }, 'distance', 'direction')],
        } as never) as MathValue;
      }
      const P = expectCoords(a, 'distance: a point'), Q = expectCoords(b, 'distance: a point, a plane or a line L(t) = A + t v');
      if (P.length !== Q.length) throw new EvalError('the two points need the same number of coordinates');
      return scalar(Math.hypot(...P.map((c, i) => c - Q[i])), { certainty: 'exact', derivation: `\\|P - Q\\|` });
    },
  },
  {
    name: 'angle', minArgs: 2, maxArgs: 2, category: 'multivariable', signature: 'angle(u, v) · angle(S1, S2)',
    doc: 'The angle between two vectors, or between two planes (the acute angle between their normals), in radians (degrees in the derivation).',
    apply: ([a, b]) => {
      const p1 = planeOf(a), p2 = planeOf(b);
      if ((a?.kind === 'implicitsurface' && !p1) || (b?.kind === 'implicitsurface' && !p2)) throw new EvalError('angle: these surfaces are not planes');
      const u = p1 ? p1.a : expectCoords(a, 'angle: a vector or a plane');
      const v = p2 ? p2.a : expectCoords(b, 'angle: a vector or a plane');
      if (u.length !== v.length) throw new EvalError('the two vectors need the same number of components');
      const lu = Math.hypot(...u), lv = Math.hypot(...v);
      if (!(lu > 0 && lv > 0)) throw new EvalError('the zero vector has no direction');
      let c = Math.min(1, Math.max(-1, dotN(u, v) / (lu * lv)));
      // two planes: the acute angle between the normals; a vector and a plane: the complement
      if (p1 && p2) c = Math.abs(c);
      let th = Math.acos(c);
      if (!!p1 !== !!p2) th = Math.abs(Math.PI / 2 - th);
      const what = p1 && p2 ? '\\mathbf n_1, \\mathbf n_2' : '\\mathbf u, \\mathbf v';
      const [s, t] = what.split(', ');
      return scalar(th, {
        certainty: 'exact', evidence: p1 && p2 ? 'the angle between two planes is the acute angle between their normals' : !!p1 !== !!p2 ? 'the angle between a vector and a plane is 90° minus the angle to the normal' : 'cos θ = u·v / (‖u‖‖v‖)',
        derivation: `\\arccos\\frac{${p1 && p2 ? '|' : ''}${s}\\cdot ${t}${p1 && p2 ? '|' : ''}}{\\|${s}\\|\\|${t}\\|} = ${deg(th)}`,
      });
    },
  },
];