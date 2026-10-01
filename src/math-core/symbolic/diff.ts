/**
 * Symbolic differentiation. Other symbols (parameters such as `a`, members such as `P.x`)
 * are treated as constants. Throws NotDifferentiableError when no rule applies; callers
 * fall back to numeric differentiation.
 */
import { Expr, num, neg, add, sub, mul, div, pow, call, dependsOn, freeSymbols } from '../ast';
import { simplify } from './simplify';
import { compileScalar } from '../compile';
import { limitAt } from '../numeric/limits';
import { CONSTANTS, getScalarFunction } from '../scalar-functions';

export class NotDifferentiableError extends Error {}

type Rule = (u: Expr) => Expr;

/** d/du of f(u) for elementary functions (outer derivative, chain rule applied by caller). */
const RULES: Record<string, Rule> = {
  sin: (u) => call('cos', u),
  cos: (u) => neg(call('sin', u)),
  tan: (u) => pow(call('cos', u), num(-2)),
  sec: (u) => mul(call('sec', u), call('tan', u)),
  csc: (u) => neg(mul(call('csc', u), call('cot', u))),
  cot: (u) => neg(pow(call('sin', u), num(-2))),
  asin: (u) => pow(sub(num(1), pow(u, num(2))), num(-0.5)),
  arcsin: (u) => pow(sub(num(1), pow(u, num(2))), num(-0.5)),
  acos: (u) => neg(pow(sub(num(1), pow(u, num(2))), num(-0.5))),
  arccos: (u) => neg(pow(sub(num(1), pow(u, num(2))), num(-0.5))),
  atan: (u) => pow(add(num(1), pow(u, num(2))), num(-1)),
  arctan: (u) => pow(add(num(1), pow(u, num(2))), num(-1)),
  sinh: (u) => call('cosh', u),
  cosh: (u) => call('sinh', u),
  tanh: (u) => sub(num(1), pow(call('tanh', u), num(2))),
  exp: (u) => call('exp', u),
  ln: (u) => pow(u, num(-1)),
  log: (u) => pow(u, num(-1)),
  log10: (u) => pow(mul(u, call('ln', num(10))), num(-1)),
  log2: (u) => pow(mul(u, call('ln', num(2))), num(-1)),
  sqrt: (u) => div(num(0.5), call('sqrt', u)),
  cbrt: (u) => div(num(1), mul(num(3), pow(call('cbrt', u), num(2)))),
  abs: (u) => call('sign', u),
  sign: () => num(0),
  floor: () => num(0),
  ceil: () => num(0),
  round: () => num(0),
};

export function registerDerivativeRule(name: string, rule: Rule) {
  RULES[name] = rule;
}

function d(e: Expr, v: string): Expr {
  if (!dependsOn(e, v)) {
    if (e.type === 'vec' || e.type === 'tuple') return { type: e.type, items: e.items.map(() => num(0)) };
    if (e.type === 'matrix') return { type: 'matrix', rows: e.rows.map((r) => r.map(() => num(0))) };
    return num(0);
  }
  switch (e.type) {
    case 'sym':
      return num(e.name === v ? 1 : 0);
    case 'neg':
      return neg(d(e.arg, v));
    case 'bin': {
      const { left: u, right: w } = e;
      switch (e.op) {
        case '+':
          return add(d(u, v), d(w, v));
        case '-':
          return sub(d(u, v), d(w, v));
        case '*':
          if (!dependsOn(u, v)) return mul(u, d(w, v));
          if (!dependsOn(w, v)) return mul(d(u, v), w);
          return add(mul(d(u, v), w), mul(u, d(w, v)));
        case '/':
          if (!dependsOn(w, v)) return div(d(u, v), w);
          return div(sub(mul(d(u, v), w), mul(u, d(w, v))), pow(w, num(2)));
        case '^':
          if (!dependsOn(w, v)) return mul(mul(w, pow(u, sub(w, num(1)))), d(u, v));
          if (!dependsOn(u, v)) return mul(mul(pow(u, w), call('ln', u)), d(w, v));
          return mul(pow(u, w), add(mul(d(w, v), call('ln', u)), div(mul(w, d(u, v)), u)));
        default:
          throw new NotDifferentiableError(`Cannot differentiate operator ${e.op}`);
      }
    }
    case 'call': {
      const name = e.callee.type === 'sym' ? e.callee.name : undefined;
      if (name === 'piecewise') return diffPiecewise(e, v);
      const rule = name ? RULES[name] : undefined;
      if (!rule || e.args.length !== 1) throw new NotDifferentiableError(`No derivative rule for ${name ?? 'call'}`);
      const u = e.args[0];
      return mul(rule(u), d(u, v));
    }
    case 'vec':
    case 'tuple':
      return { type: e.type, items: e.items.map((it) => d(it, v)) };
    case 'matrix':
      return { type: 'matrix', rows: e.rows.map((r) => r.map((it) => d(it, v))) };
    default:
      throw new NotDifferentiableError(`Cannot differentiate ${e.type}`);
  }
}

/** The point P of a condition `(x, y) = (a, b)` / `x = a` (or its negation), with its variables. */
function pointOf(c: Expr): { vars: string[]; at: number[]; negated: boolean } | null {
  if (c.type !== 'eq' || (c.rel && c.rel !== '!=')) return null;
  const items = (x: Expr) => (x.type === 'tuple' || x.type === 'vec' ? x.items : [x]);
  const L = items(c.left);
  const R = items(c.right);
  if (L.length !== R.length || !L.every((l) => l.type === 'sym')) return null;
  const at: number[] = [];
  for (const r of R) {
    const s = simplify(r);
    if (s.type !== 'num') return null;
    at.push(s.value);
  }
  return { vars: L.map((l) => (l as { name: string }).name), at, negated: c.rel === '!=' };
}

/** Snap a numerically found limit to a nearby simple fraction. */
function snap(x: number): number {
  for (let q = 1; q <= 12; q++) {
    const p = Math.round(x * q);
    if (Math.abs(x - p / q) < 1e-7 * Math.max(1, Math.abs(x))) return p / q;
  }
  return x;
}

/**
 * d/dv of {c₁: v₁, …, default}: branch by branch — except on a branch that holds at a single point
 * (x, y) = (a, b), where the derivative is not the derivative of that branch's value: it comes from the
 * limit definition, lim (f(P + h eᵥ) − f(P)) / h, computed now (so f_xy ≠ f_yx examples come out right).
 */
function diffPiecewise(e: Extract<Expr, { type: 'call' }>, v: string): Expr {
  const args = e.args;
  const pairs = Math.floor(args.length / 2);
  const out: Expr[] = [];
  const pointBranch = (i: number): { vars: string[]; at: number[] } | null => {
    // a branch `P: value`, or the default when the only other branch is `(x, y) != P: …`
    if (i < pairs) {
      const p = pointOf(args[2 * i]);
      return p && !p.negated ? p : null;
    }
    if (pairs === 1) {
      const p = pointOf(args[0]);
      return p && p.negated ? p : null;
    }
    return null;
  };
  const byDefinition = (P: { vars: string[]; at: number[] }): Expr => {
    const k = P.vars.indexOf(v);
    const free = [...freeSymbols(e)].filter((s) => !(s in CONSTANTS) && s !== 'piecewise' && s !== 'and' && !getScalarFunction(s));
    if (k < 0 || !free.every((s) => P.vars.includes(s))) return num(NaN);
    try {
      const f = compileScalar(e, P.vars);
      const f0 = f(...P.at);
      if (!Number.isFinite(f0)) return num(NaN);
      const q = (h: number) => {
        const p = P.at.slice();
        p[k] += h;
        return (f(...p) - f0) / h;
      };
      const L = limitAt(q, 0);
      return L.kind === 'finite' && L.value !== undefined ? num(snap(L.value)) : num(NaN);
    } catch {
      return num(NaN);
    }
  };
  for (let i = 0; i < pairs; i++) {
    const P = pointBranch(i);
    out.push(args[2 * i], P ? byDefinition(P) : d(args[2 * i + 1], v));
  }
  if (args.length % 2) {
    const P = pointBranch(pairs);
    out.push(P ? byDefinition(P) : d(args[args.length - 1], v));
  }
  return { type: 'call', callee: e.callee, args: out };
}

/** ∂e/∂v, simplified. */
export function diff(e: Expr, v: string): Expr {
  return simplify(d(simplify(e), v));
}

/** Gradient of a scalar expression as a vector expression. */
export function gradient(e: Expr, vars: string[]): Expr {
  return { type: 'vec', items: vars.map((v) => diff(e, v)) };
}

/** Hessian of a scalar expression as a matrix expression. */
export function hessian(e: Expr, vars: string[]): Expr {
  const g = vars.map((v) => diff(e, v));
  return { type: 'matrix', rows: g.map((gi) => vars.map((v) => diff(gi, v))) };
}

