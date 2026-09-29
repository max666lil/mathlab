/**
 * Symbolic differentiation. Other symbols (parameters such as `a`, members such as `P.x`)
 * are treated as constants. Throws NotDifferentiableError when no rule applies; callers
 * fall back to numeric differentiation.
 */
import { Expr, num, neg, add, sub, mul, div, pow, call, dependsOn } from '../ast';
import { simplify } from './simplify';

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

