/**
 * Differentiation tools of multivariable calculus (Hughes-Hallett §14.3, §14.6, §14.7; MAT235):
 *
 *   implicit x^2 + y^2 = 25 [at (3, 4)]     dy/dx = −F_x / F_y (∂z/∂x, ∂z/∂y for three variables)
 *   chain(f, cos(t), sin(t)) · chain f along C   dz/dt = f_x x′ + f_y y′, every piece shown
 *   differential f [at P] · differential(f, P, (dx, dy))   df = f_x dx + f_y dy and the estimate Δf ≈ df
 *
 * Results are reports (the steps as lines of LaTeX) that also carry the functions and numbers.
 */
import { Expr, num, sym, bin, freeSymbols, mapExpr } from '../../math-core/ast';
import { Builtin, EvalContext, EvalError, expectCoords, expectFunction, getBuiltin } from '../../math-core/builtins';
import { FunctionValue, MathValue } from '../../math-core/values';
import { CONSTANTS, getScalarFunction } from '../../math-core/scalar-functions';
import { diff } from '../../math-core/symbolic/diff';
import { simplify, trigSimplify } from '../../math-core/symbolic/simplify';
import { numberLatex, symbolLatex, toLatex, toText } from '../../math-core/symbolic/print';
import { visual } from '../../visualization/scene-model';

export interface ReportValue {
  kind: 'report';
  latex: string;
  [k: string]: unknown;
}

const rows = (lines: string[]) => `\\begin{aligned} ${lines.map((l) => `& ${l}`).join(' \\\\ ')} \\end{aligned}`;
const N = (x: number) => numberLatex(x, 5, true);
const tidy = (e: Expr) => {
  const a = simplify(e), b = trigSimplify(a);
  return toText(b).length < toText(a).length ? b : a;
};
const neg = (e: Expr): Expr => ({ type: 'neg', arg: e });
const paren = (e: Expr) => `\\left(${toLatex(e)}\\right)`;
const isZero = (e: Expr) => e.type === 'num' && e.value === 0;

/** Names of an expression that are not defined, constants or functions. */
function unknowns(e: Expr, ctx: EvalContext): string[] {
  const callees = new Set<string>();
  mapExpr(e, (n) => {
    if (n.type === 'call' && n.callee.type === 'sym') callees.add(n.callee.name);
    return n;
  });
  return [...freeSymbols(e)].filter((n) => !callees.has(n) && !ctx.lookup(n) && !(n in CONSTANTS) && !getBuiltin(n) && !getScalarFunction(n));
}

// ------------------------------------------------------------------ implicit differentiation

export const implicitBuiltin: Builtin = {
  name: 'implicit', command: true, keywords: { at: 'value' }, minArgs: 1, maxArgs: 1, argModes: ['raw'], category: 'multivariable',
  signature: 'implicit x^2 + y^2 = 25 at (3, 4)', doc: 'Implicit differentiation: dy/dx = −F_x / F_y for F(x, y) = 0 (∂z/∂x, ∂z/∂y for three variables), with the tangent at a point.',
  apply: (_a, ctx, raw, kw) => {
    const e = raw[0];
    if (e.type !== 'eq' || e.rel || e.left.type === 'eq') throw new EvalError('implicit needs an equation, e.g. implicit x^2 + y^2 = 25');
    const F = simplify(bin('-', e.left, e.right));
    const free = unknowns(F, ctx);
    const vars = ['x', 'y', 'z'].filter((v) => free.includes(v));
    if (vars.length < 2 || free.some((n) => !vars.includes(n))) throw new EvalError(`an equation in x, y (or x, y, z)${free.some((n) => !vars.includes(n)) ? ` — ${free.filter((n) => !vars.includes(n)).join(', ')} is not defined` : ''}`);
    const dep = vars[vars.length - 1];
    const part = Object.fromEntries(vars.map((v) => [v, tidy(diff(F, v))])) as Record<string, Expr>;
    if (isZero(part[dep])) throw new EvalError(`F does not depend on ${dep}: ${dep} is not a function of the other variables`);
    const indep = vars.slice(0, -1);
    const d = Object.fromEntries(indep.map((v) => [v, tidy(neg(bin('/', part[v], part[dep])))])) as Record<string, Expr>;
    const sub = (v: string) => `F_{${v}}`;
    const dTex = (v: string) => (vars.length === 2 ? `\\frac{d${dep}}{d${v}}` : `\\frac{\\partial ${dep}}{\\partial ${v}}`);
    const lines = [
      `F(${vars.join(', ')}) = ${toLatex(F)} = 0`,
      vars.map((v) => `${sub(v)} = ${toLatex(part[v])}`).join(',\\quad '),
      ...indep.map((v) => `${dTex(v)} = -\\frac{${sub(v)}}{${sub(dep)}} = ${toLatex(d[v])}`),
    ];
    const Ffn = ctx.makeFunction(F, vars);
    const derivative = indep.map((v) => ctx.makeFunction(d[v], vars));
    const out: ReportValue = { kind: 'report', latex: '', certainty: 'exact', evidence: 'F(x, y(x)) = 0 differentiated by the chain rule: F_x + F_y·y′ = 0', derivative: derivative.length === 1 ? derivative[0] : derivative, visuals: [] };
    const visuals: unknown[] = vars.length === 2 ? [visual('implicit', { fn: Ffn }, toLatex(e), 'level')] : [];
    const at = kw?.values.at;
    if (at) {
      const P = expectCoords(at, `a point (${vars.join(', ')})`);
      if (P.length !== vars.length) throw new EvalError(`the point needs ${vars.length} coordinates`);
      const g = vars.map((v) => (ctx.makeFunction(part[v], vars).eval as (...p: number[]) => number)(...P));
      const F0 = (Ffn.eval as (...p: number[]) => number)(...P);
      if (Math.abs(F0) > 1e-6 * Math.max(1, ...P.map(Math.abs))) lines.push(`\\text{the point is not on it: } F(P) = ${N(F0)}`);
      else if (Math.abs(g[g.length - 1]) < 1e-12) {
        lines.push(`F_{${dep}}(P) = 0:\\ \\text{vertical tangent — } ${dep} \\text{ is not a function of the others near } P`);
        out.slope = Infinity;
      } else {
        const slopes = indep.map((_, i) => -g[i] / g[g.length - 1]);
        indep.forEach((v, i) => lines.push(`\\left.${dTex(v)}\\right|_{P} = ${N(slopes[i])}`));
        out.slope = slopes.length === 1 ? slopes[0] : slopes;
        const off = (v: string, i: number) => `(${v} ${P[i] < 0 ? '+' : '-'} ${N(Math.abs(P[i]))})`;
        if (vars.length === 2) lines.push(`\\text{tangent: } y ${P[1] < 0 ? '+' : '-'} ${N(Math.abs(P[1]))} = ${N(slopes[0])}\\,${off('x', 0)}`);
        else lines.push(`\\text{tangent plane:}`, `\\quad ${vars.map((v, i) => `${N(g[i])}${off(v, i)}`).join(' + ').replace(/\+ -/g, '- ')} = 0`);
      }
      if (vars.length === 2 && g.some((c) => Math.abs(c) > 1e-12)) {
        const line = ctx.makeFunction({ type: 'bin', op: '+', left: bin('*', num(g[0]), bin('-', sym('x'), num(P[0]))), right: bin('*', num(g[1]), bin('-', sym('y'), num(P[1]))) }, ['x', 'y']);
        visuals.push(visual('implicit', { fn: line }, 'tangent line', 'tangent'), visual('point', { coords: P }, 'P', 'point'));
      }
    }
    out.latex = rows(lines);
    out.visuals = visuals;
    return out as unknown as MathValue;
  },
};
// ------------------------------------------------------------------ the chain rule, step by step

export const chainBuiltin: Builtin = {
  // the parser stores the clause 'along C' under the keyword 'toward'
  name: 'chain', command: true, keywords: { toward: 'value' }, minArgs: 1, maxArgs: 4, argModes: ['value', 'raw'], category: 'multivariable',
  signature: 'chain(f, cos(t), sin(t)) · chain f along C · chain(f, s + t, s t)',
  doc: 'The chain rule written out: dz/dt = f_x·dx/dt + f_y·dy/dt (partial derivatives when the inner functions have two variables).',
  apply: (args, ctx, raw, kw) => {
    const f = expectFunction(args[0]);
    if (f.out !== 'scalar' || !f.expr) throw new EvalError('chain needs a function given by a formula, e.g. f(x, y) = x^2 y');
    const n = f.params.length;
    let inner: Expr[];
    let vars: string[] = [];
    const curve = kw?.values.toward as FunctionValue | undefined;
    if (curve) {
      if (curve.kind !== 'function' || !curve.expr || (curve.expr.type !== 'tuple' && curve.expr.type !== 'vec') || curve.expr.items.length !== n) throw new EvalError(`chain f along C: C needs ${n} components, e.g. C(t) = (cos t, sin t)`);
      inner = curve.expr.items;
      vars = curve.params.slice();
    } else {
      const given = raw.slice(1);
      if (given.length !== n) throw new EvalError(`${f.label ?? 'f'} has ${n} variables: give ${n} inner functions, e.g. chain(f, ${f.params.map((p) => `${p}(t)`).join(', ')})`);
      inner = given.map((g) => {
        // the name of a worksheet function x(t) stands for its formula
        const v = g.type === 'sym' ? (ctx.lookup(g.name) as FunctionValue | undefined) : undefined;
        if (v?.kind === 'function' && v.expr && v.out === 'scalar') {
          v.params.forEach((p) => !vars.includes(p) && vars.push(p));
          return v.expr;
        }
        return g;
      });
      for (const g of inner) for (const u of unknowns(g, ctx)) if (!vars.includes(u)) vars.push(u);
    }
    if (!vars.length) throw new EvalError('the inner functions need a variable, e.g. chain(f, cos(t), sin(t))');
    if (vars.length > 2) throw new EvalError(`too many variables in the inner functions (${vars.join(', ')})`);
    const partials = f.params.map((p) => tidy(diff(f.expr!, p)));
    const subst = (e: Expr) => mapExpr(e, (m) => (m.type === 'sym' && f.params.includes(m.name) ? inner[f.params.indexOf(m.name)] : m));
    const z = f.label ?? 'f';
    const one = vars.length === 1;
    const D = (top: string, v: string, partial: boolean) => (partial ? `\\frac{\\partial ${top}}{\\partial ${v}}` : `\\frac{d${top}}{d${v}}`);
    const lines = [f.params.map((p, i) => `${symbolLatex(p)} = ${toLatex(inner[i])}`).join(',\\quad ')];
    const results: FunctionValue[] = [];
    for (const v of vars) {
      const din = inner.map((g) => tidy(diff(g, v)));
      const general = f.params.map((p) => `${D(z, symbolLatex(p), true)}${D(symbolLatex(p), symbolLatex(v), !one)}`).join(' + ');
      const pieces = f.params.map((_, i) => `${paren(partials[i])}${paren(din[i])}`).join(' + ');
      const total = tidy(f.params.map((_, i) => bin('*', subst(partials[i]), din[i]) as Expr).reduce((a, b) => bin('+', a, b)));
      lines.push(`${D(z, symbolLatex(v), !one)} = ${general}`, `\\quad = ${pieces}`, `\\quad = ${toLatex(total)}`);
      results.push(ctx.makeFunction(total, vars, { label: D(z, symbolLatex(v), !one), env: f.env }));
    }
    return {
      kind: 'report', latex: rows(lines), certainty: 'exact',
      evidence: 'each path from the outer function to the variable contributes (rate along the path) × (rate of the inner function)',
      derivative: one ? results[0] : results,
    } as unknown as MathValue;
  },
};

// ------------------------------------------------------------------ the total differential

export const differentialBuiltin: Builtin = {
  name: 'differential', command: true, keywords: { at: 'value' }, minArgs: 1, maxArgs: 3, argModes: ['function', 'value', 'value'], category: 'multivariable',
  signature: 'differential f · differential f at P · differential(f, P, (0.1, -0.05))',
  doc: 'The total differential df = f_x dx + f_y dy; with steps (dx, dy) the estimate Δf ≈ df beside the true change.',
  apply: (args, ctx, _raw, kw) => {
    const f = expectFunction(args[0]);
    if (f.out !== 'scalar' || !f.expr || f.params.length < 2) throw new EvalError('differential needs a function of two or three variables given by a formula');
    const z = f.label ?? 'f';
    const partials = f.params.map((p) => tidy(diff(f.expr!, p)));
    const d = (p: string) => `d${symbolLatex(p)}`;
    const lines = [
      `d${z} = ${f.params.map((p) => `${z}_{${symbolLatex(p)}}\\,${d(p)}`).join(' + ')}`,
      `\\quad = ${f.params.map((p, i) => `${paren(partials[i])}\\,${d(p)}`).join(' + ')}`,
    ];
    const out: ReportValue = { kind: 'report', latex: '', certainty: 'exact', evidence: 'the linear part of the change of f: the tangent plane written with dx, dy' };
    const at = kw?.values.at ?? args[1];
    if (at) {
      const P = expectCoords(at, 'a point');
      if (P.length !== f.params.length) throw new EvalError(`the point needs ${f.params.length} coordinates`);
      const g = partials.map((e) => (ctx.makeFunction(e, f.params, { env: f.env }).eval as (...p: number[]) => number)(...P));
      out.coefficients = g;
      lines.push(`\\text{at } (${P.map(N).join(', ')}):\\ d${z} = ${g.map((c, i) => `${N(c)}\\,${d(f.params[i])}`).join(' + ').replace(/\+ -/g, '- ')}`);
      if (args[2]) {
        const h = expectCoords(args[2], 'the steps (dx, dy)');
        if (h.length !== P.length) throw new EvalError(`give ${P.length} steps`);
        const F = f.eval as (...p: number[]) => number;
        const df = g.reduce((s, c, i) => s + c * h[i], 0);
        const actual = F(...P.map((c, i) => c + h[i])) - F(...P);
        out.df = df;
        out.actual = actual;
        out.certainty = 'numeric';
        lines.push(
          `${f.params.map((p, i) => `${d(p)} = ${N(h[i])}`).join(',\\ ')}:\\quad d${z} = ${numberLatex(df, 6)}`,
          `\\Delta ${z} = ${numberLatex(actual, 6)} \\quad (\\text{error } ${numberLatex(Math.abs(actual - df), 3)})`,
        );
      }
    }
    out.latex = rows(lines);
    return out as unknown as MathValue;
  },
};

export const toolBuiltins: Builtin[] = [implicitBuiltin, chainBuiltin, differentialBuiltin];