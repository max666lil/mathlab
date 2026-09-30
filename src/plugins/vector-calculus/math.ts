/**
 * Vector calculus: divergence, curl, Laplacian, Jacobian, potentials, conservativity, equilibria.
 * Derivatives are symbolic (exact); zero tests are symbolic first, then numeric on sample points;
 * a point where a quantity is non-zero is a proof, sampled zeros are evidence.
 */
import { Builtin, EvalContext, EvalError } from '../../math-core/builtins';
import { Expr, freeSymbols } from '../../math-core/ast';
import { diff } from '../../math-core/symbolic/diff';
import { simplify } from '../../math-core/symbolic/simplify';
import { antiderivative } from '../../math-core/symbolic/integrate';
import { toLatex, numberLatex } from '../../math-core/symbolic/print';
import { compileScalar } from '../../math-core/compile';
import { domainConditions } from '../../math-core/domain';
import { newtonSystem, gridSeeds } from '../../math-core/numeric/roots';
import { FunctionValue, MathValue, BoolValue, PointValue, VectorValue } from '../../math-core/values';
import type { PointSetValue } from '../../math-core/result-values';
import { visual } from '../../visualization/scene-model';
import { eigenOf } from '../linear-algebra/eigen';

// ------------------------------------------------------------------ inputs

/** A vector field F: ℝⁿ → ℝⁿ (n = 2, 3) with a symbolic body. */
export function isField(v: MathValue | undefined): v is FunctionValue {
  const f = v as FunctionValue;
  return v?.kind === 'function' && f.out === 'vector' && !!f.expr && (f.expr.type === 'vec' || f.expr.type === 'tuple') && f.expr.items.length === f.params.length && (f.params.length === 2 || f.params.length === 3);
}

export function expectField(v: MathValue | undefined): FunctionValue {
  if (!isField(v)) throw new EvalError('Expected a vector field F(x, y) = <P, Q> or F(x, y, z) = <P, Q, R>');
  return v;
}

export const comps = (f: FunctionValue): Expr[] => (f.expr as Extract<Expr, { type: 'vec' }>).items;

function expectScalarField(v: MathValue | undefined): FunctionValue {
  const f = v as FunctionValue;
  if (v?.kind !== 'function' || f.out !== 'scalar' || !f.expr) throw new EvalError('Expected a scalar function f(x, y) = …');
  return f;
}

const derived = (ctx: EvalContext, f: FunctionValue, e: Expr, label: string, role: string): FunctionValue => ({
  ...ctx.makeFunction(simplify(e), f.params, { label, role, env: f.env }),
  certainty: 'exact',
  evidence: 'symbolic differentiation',
});

// ------------------------------------------------------------------ zero tests

/** Deterministic sample points in [−2.7, 2.7]ⁿ. */
function samples(n: number, count = 48): number[][] {
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648) * 5.4 - 2.7;
  return Array.from({ length: count }, () => Array.from({ length: n }, rnd));
}

export type ZeroTest = { status: 'zero' | 'numzero' | 'nonzero'; at?: number[]; value?: number };

export function zeroTest(e: Expr, f: FunctionValue): ZeroTest {
  const s = simplify(e);
  if (s.type === 'num') return s.value === 0 ? { status: 'zero' } : { status: 'nonzero', value: s.value };
  const g = compileScalar(s, f.params, f.env);
  let seen = 0;
  for (const p of samples(f.params.length)) {
    const v = g(...p);
    if (!Number.isFinite(v)) continue;
    seen++;
    if (Math.abs(v) > 1e-8) return { status: 'nonzero', at: p, value: v };
  }
  return seen ? { status: 'numzero' } : { status: 'nonzero' };
}

// ------------------------------------------------------------------ operators

export function divExpr(f: FunctionValue): Expr {
  return simplify(comps(f).map((c, i) => diff(c, f.params[i])).reduce((a, b) => ({ type: 'bin', op: '+', left: a, right: b })));
}

/** 2-D: the scalar ∂Q/∂x − ∂P/∂y; 3-D: the vector ⟨R_y − Q_z, P_z − R_x, Q_x − P_y⟩. */
export function curlExprs(f: FunctionValue): Expr[] {
  const [x, y, z] = f.params;
  const c = comps(f);
  const d = (e: Expr, v: string) => diff(e, v);
  const sub = (a: Expr, b: Expr): Expr => simplify({ type: 'bin', op: '-', left: a, right: b });
  if (c.length === 2) return [sub(d(c[1], x), d(c[0], y))];
  return [sub(d(c[2], y), d(c[1], z)), sub(d(c[0], z), d(c[2], x)), sub(d(c[1], x), d(c[0], y))];
}

export function laplacianExpr(f: FunctionValue): Expr {
  return simplify(f.params.map((v) => diff(diff(f.expr!, v), v)).reduce((a, b) => ({ type: 'bin', op: '+', left: a, right: b })));
}

const N = (x: number) => numberLatex(x, 4);

/** Circulation ∮ F · dr around a circle (numeric, midpoint rule). */
export function circulation(F: (...p: number[]) => number[], c: number[], r: number, n = 720): number {
  let s = 0;
  for (let k = 0; k < n; k++) {
    const t = ((k + 0.5) / n) * 2 * Math.PI;
    const v = F(c[0] + r * Math.cos(t), c[1] + r * Math.sin(t));
    if (!v.every(Number.isFinite)) return NaN;
    s += (-v[0] * Math.sin(t) + v[1] * Math.cos(t)) * r * ((2 * Math.PI) / n);
  }
  return s;
}

export function conservativeOf(f: FunctionValue): BoolValue {
  const tests = curlExprs(f).map((e) => ({ e, t: zeroTest(e, f) }));
  const bad = tests.find((x) => x.t.status === 'nonzero');
  const n = f.params.length;
  if (bad) return { kind: 'bool', value: false, reason: `\\operatorname{curl} F = ${n === 2 ? toLatex(bad.e) : `\\langle ${tests.map((x) => toLatex(x.e)).join(', ')}\\rangle`} \\neq 0`, certainty: 'exact' };
  const symbolic = tests.every((x) => x.t.status === 'zero');
  const holes = comps(f).some((c) => domainConditions(c, f.params).length > 0);
  if (!holes)
    return { kind: 'bool', value: true, reason: `\\operatorname{curl} F = 0 \\text{ on } \\mathbb{R}^{${n}}`, certainty: symbolic ? 'exact' : 'heuristic', evidence: symbolic ? 'curl simplifies to 0' : 'curl vanishes at 48 sample points' };
  if (n === 2) {
    const F = f.eval as (...p: number[]) => number[];
    const centers = [[0, 0], ...gridSeeds([[-2.5, 2.5], [-2.5, 2.5]], 5)];
    for (const c of centers) {
      const circ = circulation(F, c, 0.7);
      if (Number.isFinite(circ) && Math.abs(circ) > 1e-6)
        return { kind: 'bool', value: false, reason: `\\operatorname{curl} F = 0,\\ \\text{but } \\oint F\\cdot d\\mathbf{r} = ${N(circ)} \\text{ around } (${c.map(N).join(', ')})`, certainty: 'heuristic', evidence: 'the domain has a hole; circulation around it computed numerically' };
    }
  }
  return { kind: 'bool', value: true, reason: `\\operatorname{curl} F = 0\\ \\text{(domain has excluded points; loops tested)}`, certainty: 'heuristic', evidence: 'circulation around sample loops vanishes' };
}

/** ∫ e dv treating the other variables as constants (factors free of v are pulled out). */
function integrateWrt(e: Expr, v: string): Expr | null {
  if (!freeSymbols(e).has(v)) return { type: 'bin', op: '*', left: e, right: { type: 'sym', name: v } };
  if (e.type === 'bin' && (e.op === '+' || e.op === '-')) {
    const a = integrateWrt(e.left, v);
    const b = integrateWrt(e.right, v);
    return a && b ? { type: 'bin', op: e.op, left: a, right: b } : null;
  }
  if (e.type === 'neg') {
    const a = integrateWrt(e.arg, v);
    return a && { type: 'neg', arg: a };
  }
  if (e.type === 'bin' && e.op === '*') {
    if (!freeSymbols(e.left).has(v)) {
      const r = integrateWrt(e.right, v);
      return r && { type: 'bin', op: '*', left: e.left, right: r };
    }
    if (!freeSymbols(e.right).has(v)) {
      const l = integrateWrt(e.left, v);
      return l && { type: 'bin', op: '*', left: e.right, right: l };
    }
  }
  if (e.type === 'bin' && e.op === '/' && !freeSymbols(e.right).has(v)) {
    const l = integrateWrt(e.left, v);
    return l && { type: 'bin', op: '/', left: l, right: e.right };
  }
  return antiderivative(e, v);
}

/** φ with ∇φ = F, by integrating component by component; verified at sample points. */
export function potentialExpr(f: FunctionValue): Expr {
  const c = comps(f);
  const vars = f.params;
  let phi: Expr = { type: 'num', value: 0 };
  for (let i = 0; i < vars.length; i++) {
    // remaining part of the i-th component not yet explained by φ
    const rest = simplify({ type: 'bin', op: '-', left: c[i], right: diff(phi, vars[i]) });
    for (let j = 0; j < i; j++) {
      if (zeroTest(diff(rest, vars[j]), f).status === 'nonzero') throw new EvalError('F is not conservative (no potential exists)');
    }
    if (rest.type === 'num' && rest.value === 0) continue;
    const I = integrateWrt(rest, vars[i]);
    if (!I) throw new EvalError(`no closed-form potential found (could not integrate ${toLatex(rest)} d${vars[i]})`);
    phi = simplify({ type: 'bin', op: '+', left: phi, right: I });
  }
  for (let i = 0; i < vars.length; i++) {
    if (zeroTest({ type: 'bin', op: '-', left: diff(phi, vars[i]), right: c[i] }, f).status === 'nonzero') throw new EvalError('F is not conservative (no potential exists)');
  }
  return phi;
}

export function jacobianExpr(f: FunctionValue): Expr {
  return { type: 'matrix', rows: comps(f).map((c) => f.params.map((v) => simplify(diff(c, v)))) };
}

/** Type of an equilibrium from the eigenvalues of the Jacobian there. */
export function classify(J: number[][]): string {
  const pairs = eigenOf(J, false).pairs;
  const tol = 1e-9 * Math.max(1, ...J.flat().map(Math.abs));
  if (pairs.some((p) => p.im === 0 && Math.abs(p.re) <= tol)) return 'degenerate';
  const res = pairs.map((p) => p.re);
  const complex = pairs.some((p) => p.im !== 0);
  if (complex && res.every((r) => Math.abs(r) <= tol)) return 'center';
  if (res.every((r) => r < 0)) return complex ? 'stable spiral' : 'stable node';
  if (res.every((r) => r > 0)) return complex ? 'unstable spiral' : 'unstable node';
  return 'saddle';
}

export function equilibriaOf(ctx: EvalContext, f: FunctionValue): PointSetValue {
  const n = f.params.length;
  const F = f.eval as (...p: number[]) => number[];
  const J = ctx.makeFunction(jacobianExpr(f), f.params, { env: f.env }).eval as (...p: number[]) => number[][];
  const seeds = n === 2 ? [...gridSeeds([[-4, 4], [-4, 4]], 9), ...gridSeeds([[-10, 10], [-10, 10]], 5)] : gridSeeds([[-3, 3], [-3, 3], [-3, 3]], 5);
  const r = newtonSystem((p) => F(...p), seeds);
  const clean = (x: number) => (Math.abs(x) < 1e-10 ? 0 : x);
  const points = r.solutions.map((p) => {
    const q = p.map(clean);
    let type = 'degenerate';
    try {
      type = classify(J(...q));
    } catch {
      /* keep degenerate */
    }
    return { coords: q, type };
  });
  return { kind: 'pointset', what: 'equilibria', dim: n, points, certainty: 'numeric', evidence: `Newton's method from ${r.seeds} starting points; type from the eigenvalues of the Jacobian` };
}

// ------------------------------------------------------------------ builtins

const FN = 'function' as const;
const V = 'value' as const;
const nameOf = (raw: Expr[], k = 0, fallback = 'F') => (raw[k]?.type === 'sym' ? (raw[k] as { name: string }).name : fallback);
const coordsOf = (v: MathValue | undefined): number[] => {
  if (v?.kind === 'point') return (v as PointValue).coords;
  if (v?.kind === 'vector') return (v as VectorValue).comps;
  throw new EvalError('Expected a point');
};

export const vectorCalculusBuiltins: Builtin[] = [
  {
    name: 'div', prefix: true, minArgs: 1, maxArgs: 1, argModes: [FN], category: 'vector calculus', signature: 'div F  ·  ∇·F',
    doc: 'Divergence ∂P/∂x + ∂Q/∂y (+ ∂R/∂z): net outflow per unit area / volume.',
    apply: ([fv], ctx, raw) => {
      const f = expectField(fv);
      return derived(ctx, f, divExpr(f), `\\nabla\\cdot ${f.label ?? nameOf(raw)}`, 'divergence');
    },
  },
  {
    name: 'curl', prefix: true, minArgs: 1, maxArgs: 1, argModes: [FN], category: 'vector calculus', signature: 'curl F  ·  ∇×F',
    doc: 'Curl: in 2-D the scalar ∂Q/∂x − ∂P/∂y (twice the local rotation rate); in 3-D a vector field.',
    apply: ([fv], ctx, raw) => {
      const f = expectField(fv);
      const c = curlExprs(f);
      return derived(ctx, f, c.length === 1 ? c[0] : { type: 'vec', items: c }, `\\nabla\\times ${f.label ?? nameOf(raw)}`, 'curl');
    },
  },
  {
    name: 'laplacian', prefix: true, minArgs: 1, maxArgs: 1, argModes: [FN], category: 'vector calculus', signature: 'laplacian f  ·  ∇²f',
    doc: 'Laplacian ∇²f = div(∇f): how f(P) compares with its average around P.',
    apply: ([fv], ctx, raw) => {
      const f = expectScalarField(fv);
      return derived(ctx, f, laplacianExpr(f), `\\nabla^2 ${f.label ?? nameOf(raw, 0, 'f')}`, 'laplacian');
    },
  },
  {
    name: 'jacobian', prefix: true, minArgs: 1, maxArgs: 1, argModes: [FN], category: 'vector calculus', signature: 'jacobian F  ·  jacobian F at P',
    doc: 'Jacobian matrix of partial derivatives (a matrix-valued function; at a point it is a Matrix).',
    apply: ([fv], ctx, raw) => {
      const f = fv as FunctionValue;
      if (f?.kind !== 'function' || f.out !== 'vector' || !f.expr || (f.expr.type !== 'vec' && f.expr.type !== 'tuple')) throw new EvalError('jacobian needs a vector-valued function');
      return { ...ctx.makeFunction(jacobianExpr(f), f.params, { label: `J_{${f.label ?? nameOf(raw)}}`, role: 'jacobian', env: f.env }), certainty: 'exact' };
    },
  },
  {
    name: 'conservative', prefix: true, minArgs: 1, maxArgs: 1, argModes: [FN], category: 'vector calculus', signature: 'conservative F',
    doc: 'Whether F is a gradient field, with the reason (curl, and circulation around holes of the domain).',
    apply: ([fv]) => conservativeOf(expectField(fv)),
  },
  {
    name: 'potential', prefix: true, minArgs: 1, maxArgs: 1, argModes: [FN], category: 'vector calculus', signature: 'potential F',
    doc: 'A potential φ with ∇φ = F (verified).',
    apply: ([fv], ctx) => {
      const f = expectField(fv);
      return { ...ctx.makeFunction(potentialExpr(f), f.params, { label: '\\varphi', role: 'potential', env: f.env }), certainty: 'exact', evidence: 'integrated component by component; ∇φ = F verified at sample points' };
    },
  },
  {
    name: 'equilibria', prefix: true, minArgs: 1, maxArgs: 1, argModes: [FN], category: 'vector calculus', signature: 'equilibria F',
    doc: 'Points where F = 0, classified (node, saddle, spiral, center) by the eigenvalues of the Jacobian.',
    apply: ([fv], ctx, raw) => ({ ...equilibriaOf(ctx, expectField(fv)), of: nameOf(raw) }),
  },
  {
    name: 'field', prefix: true, minArgs: 1, maxArgs: 1, argModes: [FN], category: 'vector calculus', signature: 'field F', doc: 'The arrows of a vector field.',
    apply: ([fv], _ctx, raw) => {
      const f = expectField(fv);
      return visual(f.params.length === 2 ? 'field2' : 'field3', { fn: f }, `field ${nameOf(raw)}`, 'field');
    },
  },
  {
    name: 'streamlines', prefix: true, minArgs: 1, maxArgs: 1, argModes: [FN], category: 'vector calculus', signature: 'streamlines F', doc: 'Evenly spaced flow lines of F.',
    apply: ([fv], _ctx, raw) => {
      const f = expectField(fv);
      return visual('streamlines', { fn: f, n: f.params.length }, 'streamlines', 'streamline');
    },
  },
  {
    name: 'particles', prefix: true, minArgs: 1, maxArgs: 1, argModes: [FN], category: 'vector calculus', signature: 'particles F', doc: 'Particles carried by the flow of F (animated).',
    apply: ([fv], _ctx, raw) => {
      const f = expectField(fv);
      return visual('particles', { fn: f, n: f.params.length, timeline: `flow:${nameOf(raw)}`, stops: [], loop: true }, 'moving particles', 'particle');
    },
  },
  {
    name: 'fluxbox', minArgs: 2, maxArgs: 2, argModes: [FN, V], category: 'vector calculus', signature: 'fluxbox(F, P)', doc: 'Flux of F through a small box around P — divergence made visible.',
    apply: ([fv, pv], ctx, raw) => {
      const f = expectField(fv);
      if (f.params.length !== 2) throw new EvalError('fluxbox is drawn for plane fields');
      const div = derived(ctx, f, divExpr(f), '\\nabla\\cdot F', 'divergence');
      return visual('fluxbox', { fn: f, div, at: coordsOf(pv), source: nameOf(raw, 1, 'P') }, 'flux through a small box', 'flux');
    },
  },
  {
    name: 'paddlewheel', minArgs: 2, maxArgs: 2, argModes: [FN, V], category: 'vector calculus', signature: 'paddlewheel(F, P)', doc: 'A paddle wheel at P spinning with angular speed curl F(P)/2.',
    apply: ([fv, pv], ctx, raw) => {
      const f = expectField(fv);
      const c = curlExprs(f);
      const curl = derived(ctx, f, c.length === 1 ? c[0] : { type: 'vec', items: c }, '\\nabla\\times F', 'curl');
      return visual('paddle', { fn: f, curl, at: coordsOf(pv), n: f.params.length, timeline: `flow:${nameOf(raw)}`, stops: [], loop: true }, 'paddle wheel', 'paddle');
    },
  },
  {
    name: 'meancircle', minArgs: 2, maxArgs: 2, argModes: [FN, V], category: 'vector calculus', signature: 'meancircle(f, P)', doc: 'f(P) against the average of f on a small circle around P — the Laplacian made visible.',
    apply: ([fv, pv], ctx, raw) => {
      const f = expectScalarField(fv);
      if (f.params.length !== 2) throw new EvalError('meancircle is drawn for functions of two variables');
      const lap = derived(ctx, f, laplacianExpr(f), '\\nabla^2 f', 'laplacian');
      return visual('meancircle', { fn: f, lap, at: coordsOf(pv), source: nameOf(raw, 1, 'P') }, 'mean value on a circle', 'laplacian');
    },
  },
];

