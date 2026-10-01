/**
 * Piecewise functions at their special points (the classic MAT235 counterexamples):
 *   f(x,y) = {(x,y) != (0,0): xy(x² − y²)/(x² + y²), 0}   →  f_xy(0,0) = −1 ≠ f_yx(0,0) = 1
 * smoothness f at P reports the limit (along rays and parabolas), continuity, first partials by the
 * limit definition, the mixed partials and Clairaut's theorem, and differentiability. For f(x) it reports
 * one-sided limits and one-sided derivatives at a break point.
 */
import { Expr } from '../../math-core/ast';
import { Builtin, EvalError, expectFunction, expectCoords } from '../../math-core/builtins';
import { FunctionValue, MathValue } from '../../math-core/values';
import { diff } from '../../math-core/symbolic/diff';
import { simplify } from '../../math-core/symbolic/simplify';
import { compileScalar } from '../../math-core/compile';
import { limitAt } from '../../math-core/numeric/limits';
import { numberLatex, symbolLatex } from '../../math-core/symbolic/print';
import { bindEnv } from './analysis-builtins';

export function isPiecewise(f: FunctionValue): boolean {
  return !!f.expr && f.expr.type === 'call' && f.expr.callee.type === 'sym' && f.expr.callee.name === 'piecewise';
}

const items = (x: Expr) => (x.type === 'tuple' || x.type === 'vec' ? x.items : [x]);

/** Points where a piecewise definition changes: (x, y) = P conditions, and x < c / x = c break points. */
export function specialPoints(f: FunctionValue): number[][] {
  if (!isPiecewise(f)) return [];
  const e = bindEnv(f.expr!, f.env) as Extract<Expr, { type: 'call' }>;
  const out: number[][] = [];
  const add = (p: number[]) => {
    if (!out.some((q) => q.every((x, i) => Math.abs(x - p[i]) < 1e-12))) out.push(p);
  };
  const visit = (c: Expr) => {
    if (c.type === 'call' && c.callee.type === 'sym' && c.callee.name === 'and') return c.args.forEach(visit);
    if (c.type !== 'eq') return;
    const L = items(c.left);
    const R = items(c.right).map((r) => simplify(r));
    if (L.length !== f.params.length || !L.every((l, i) => l.type === 'sym' && l.name === f.params[i])) {
      // x < c in one variable
      if (f.params.length === 1 && c.left.type === 'sym' && c.left.name === f.params[0] && R.length === 1 && R[0].type === 'num') add([R[0].value]);
      return;
    }
    if (R.every((r) => r.type === 'num')) add(R.map((r) => (r as { value: number }).value));
  };
  for (let i = 0; i + 1 < e.args.length; i += 2) visit(e.args[i]);
  return out;
}

export interface SmoothnessValue {
  kind: 'smoothness';
  point: number[];
  rows: string[];
  continuous: boolean;
  differentiable?: boolean;
  clairaut?: boolean;
  certainty: 'heuristic';
  evidence: string;
  [k: string]: unknown;
}

const N = (x: number) => (Number.isFinite(x) ? numberLatex(x, 6) : '\\text{undefined}');

function defLimit(q: (h: number) => number, side: 'both' | 'left' | 'right' = 'both'): number {
  const L = limitAt(q, 0, side);
  if (L.kind !== 'finite' || L.value === undefined) return NaN;
  for (let d = 1; d <= 12; d++) {
    const p = Math.round(L.value * d);
    if (Math.abs(L.value - p / d) < 1e-7 * Math.max(1, Math.abs(L.value))) return p / d;
  }
  return L.value;
}

function smoothness1D(f: FunctionValue, c: number, name: string): SmoothnessValue {
  const F = f.eval as (x: number) => number;
  const x = symbolLatex(f.params[0]);
  const fc = F(c);
  const left = defLimit((h) => F(c + h), 'left');
  const right = defLimit((h) => F(c + h), 'right');
  const exists = Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 1e-6 * Math.max(1, Math.abs(left));
  const continuous = exists && Number.isFinite(fc) && Math.abs(left - fc) < 1e-6 * Math.max(1, Math.abs(fc));
  const dl = Number.isFinite(fc) ? defLimit((h) => (F(c + h) - fc) / h, 'left') : NaN;
  const dr = Number.isFinite(fc) ? defLimit((h) => (F(c + h) - fc) / h, 'right') : NaN;
  const differentiable = continuous && Number.isFinite(dl) && Number.isFinite(dr) && Math.abs(dl - dr) < 1e-6 * Math.max(1, Math.abs(dl));
  const C = N(c);
  const rows = [
    `${name}(${C}) = ${N(fc)}`,
    `\\lim_{${x}\\to ${C}^-} ${name} = ${N(left)},\\quad \\lim_{${x}\\to ${C}^+} ${name} = ${N(right)}`,
    continuous ? `\\text{continuous at } ${x} = ${C}` : exists ? `\\text{not continuous: the limit } ${N(left)} \\ne ${name}(${C})` : `\\text{not continuous: the one-sided limits differ (jump)}`,
    `${name}'_-(${C}) = ${N(dl)},\\quad ${name}'_+(${C}) = ${N(dr)}`,
    differentiable ? `\\text{differentiable at } ${x} = ${C},\\ ${name}'(${C}) = ${N(dl)}` : `\\text{not differentiable at } ${x} = ${C}${continuous ? '\\ (a corner: the one-sided derivatives differ)' : ''}`,
  ];
  return { kind: 'smoothness', point: [c], rows, continuous, differentiable, certainty: 'heuristic', evidence: 'one-sided limits and difference quotients evaluated numerically (h → 0)' };
}

function smoothness2D(f: FunctionValue, P: number[], name: string): SmoothnessValue {
  const F = f.eval as (x: number, y: number) => number;
  const [a, b] = P;
  const [xs, ys] = f.params.map(symbolLatex);
  const f0 = F(a, b);
  // limit along paths into P: 16 rays and 4 parabolas
  const paths: { label: string; at: (r: number) => [number, number] }[] = [];
  for (let k = 0; k < 16; k++) {
    const t = (2 * Math.PI * k) / 16 + 0.05;
    paths.push({ label: `\\theta = ${numberLatex(t, 3)}`, at: (r) => [a + r * Math.cos(t), b + r * Math.sin(t)] });
  }
  for (const s of [1, -1]) {
    paths.push({ label: `${ys} - ${N(b)} = ${s < 0 ? '-' : ''}(${xs} - ${N(a)})^2`, at: (r) => [a + r, b + s * r * r] });
    paths.push({ label: `${xs} - ${N(a)} = ${s < 0 ? '-' : ''}(${ys} - ${N(b)})^2`, at: (r) => [a + s * r * r, b + r] });
  }
  const along = paths.map((p) => {
    const v5 = F(...p.at(1e-5));
    const v6 = F(...p.at(1e-6));
    return { label: p.label, value: Math.abs(v5 - v6) < 1e-4 * Math.max(1, Math.abs(v6)) ? v6 : NaN };
  });
  const finite = along.filter((v) => Number.isFinite(v.value));
  const L = finite.length ? finite[0].value : NaN;
  const exists = finite.length === along.length && finite.every((v) => Math.abs(v.value - L) < 1e-4 * Math.max(1, Math.abs(L)));
  const limit = exists ? Math.abs(L) < 1e-9 ? 0 : L : NaN;
  const continuous = exists && Number.isFinite(f0) && Math.abs(limit - f0) < 1e-4 * Math.max(1, Math.abs(f0));
  const PL = `(${N(a)}, ${N(b)})`;
  const rows: string[] = [`${name}${PL} = ${N(f0)}`];
  if (exists) rows.push(`\\lim_{(${xs},${ys})\\to ${PL}} ${name} = ${N(limit)}\\ \\text{(along 16 rays and 4 parabolas)}`);
  else {
    const differ = finite.slice(0, 1).concat(finite.filter((v) => Math.abs(v.value - L) > 1e-4 * Math.max(1, Math.abs(L))).slice(0, 1));
    rows.push(`\\text{no limit at } ${PL}: ${differ.map((v) => `${N(v.value)}\\ \\text{along } ${v.label}`).join(',\\ ')}`);
  }
  rows.push(continuous ? `\\text{continuous at } ${PL}` : `\\text{not continuous at } ${PL}`);
  // first partials by the limit definition; second partials from the (piecewise-aware) symbolic derivatives
  const fx = defLimit((h) => (F(a + h, b) - f0) / h);
  const fy = defLimit((h) => (F(a, b + h) - f0) / h);
  rows.push(`${name}_{${xs}}${PL} = \\lim_{h\\to0}\\frac{${name}(${N(a)}+h, ${N(b)}) - ${name}${PL}}{h} = ${N(fx)},\\quad ${name}_{${ys}}${PL} = ${N(fy)}`);
  let clairaut: boolean | undefined;
  let differentiable: boolean | undefined;
  try {
    const e = bindEnv(f.expr!, f.env);
    const [x, y] = f.params;
    const dx = diff(e, x);
    const dy = diff(e, y);
    const fxy = compileScalar(diff(dx, y), f.params)(a, b);
    const fyx = compileScalar(diff(dy, x), f.params)(a, b);
    clairaut = Number.isFinite(fxy) && Number.isFinite(fyx) && Math.abs(fxy - fyx) < 1e-6 * Math.max(1, Math.abs(fxy));
    rows.push(`${name}_{${xs}${ys}}${PL} = (${name}_{${xs}})_{${ys}} = ${N(fxy)},\\quad ${name}_{${ys}${xs}}${PL} = (${name}_{${ys}})_{${xs}} = ${N(fyx)}`);
    if (!clairaut && Number.isFinite(fxy) && Number.isFinite(fyx)) {
      // how the mixed partial behaves near P
      const g = compileScalar(diff(dx, y), f.params);
      const near = Array.from({ length: 24 }, (_, k) => g(a + 1e-3 * Math.cos((2 * Math.PI * k) / 24 + 0.1), b + 1e-3 * Math.sin((2 * Math.PI * k) / 24 + 0.1))).filter(Number.isFinite);
      rows.push(`\\Rightarrow\\ ${name}_{${xs}${ys}} \\ne ${name}_{${ys}${xs}}:\\ \\text{Clairaut's theorem does not apply}`);
      rows.push(`\\text{(} ${name}_{${xs}${ys}} \\text{ is not continuous at } ${PL} \\text{: nearby it ranges over } [${N(Math.min(...near))}, ${N(Math.max(...near))}] \\text{)}`);
    } else if (clairaut) rows.push(`${name}_{${xs}${ys}}${PL} = ${name}_{${ys}${xs}}${PL}`);
  } catch {
    /* second derivatives not available symbolically */
  }
  // differentiable: the linear approximation error is o(|h|)
  if (continuous && Number.isFinite(fx) && Number.isFinite(fy)) {
    const err = (r: number) => Math.max(...paths.map((p) => {
      const [u, v] = p.at(r);
      return Math.abs(F(u, v) - f0 - fx * (u - a) - fy * (v - b)) / Math.hypot(u - a, v - b);
    }));
    differentiable = err(1e-6) < 1e-3 && err(1e-6) <= err(1e-3) + 1e-12;
    rows.push(differentiable ? `\\text{differentiable at } ${PL}\\ \\text{(the tangent-plane error is } o(\\lVert h\\rVert))` : `\\text{not differentiable at } ${PL}\\ \\text{(the tangent-plane error is not } o(\\lVert h\\rVert))`);
  } else rows.push(`\\text{not differentiable at } ${PL}`);
  return { kind: 'smoothness', point: P, rows, continuous, differentiable, clairaut, certainty: 'heuristic', evidence: 'limits along paths and difference quotients evaluated numerically (h → 0); mixed partials from the limit definition at the point' };
}

export const smoothnessBuiltin: Builtin = {
  name: 'smoothness', command: true, minArgs: 1, maxArgs: 2, argModes: ['function', 'value'], keywords: { at: 'value' }, category: 'calculus',
  signature: 'smoothness f at P', doc: 'Continuity, partial derivatives by the limit definition, mixed partials (Clairaut) and differentiability at a point.',
  apply: ([fv, pv], _ctx, raw, kw) => {
    const f = expectFunction(fv);
    const at = kw.values.at ?? pv;
    const name = raw[0]?.type === 'sym' ? symbolLatex(raw[0].name) : (f.label ?? 'f');
    if (f.params.length === 1) {
      const c = at ? (at.kind === 'scalar' ? (at as { value: number }).value : expectCoords(at)[0]) : specialPoints(f)[0]?.[0];
      if (c === undefined) throw new EvalError('say where: smoothness f at c');
      return smoothness1D(f, c, name) as unknown as MathValue;
    }
    if (f.params.length !== 2) throw new EvalError('smoothness: a function of one or two variables');
    const P = at ? expectCoords(at, 'a point (a, b)') : specialPoints(f)[0];
    if (!P || P.length !== 2) throw new EvalError('say where: smoothness f at (a, b)');
    return smoothness2D(f, P, name) as unknown as MathValue;
  },
};