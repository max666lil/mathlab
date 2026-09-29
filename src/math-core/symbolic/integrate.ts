/**
 * Symbolic antiderivatives (table + linear substitution + g'(x)·F(g(x)) pattern). Every candidate is
 * verified by differentiating it and comparing numerically with the integrand; unverified results are
 * discarded, so "found" means "exact".
 */
import { Expr, num, sym, call, add, mul, div, pow, dependsOn } from '../ast';
import { diff } from './diff';
import { simplify } from './simplify';
import { expand } from './expand';
import { toText } from './print';
import { compileScalar } from '../compile';

function terms(e: Expr): Expr[] {
  if (e.type === 'bin' && e.op === '+') return [...terms(e.left), ...terms(e.right)];
  return [e];
}
function factors(e: Expr): Expr[] {
  if (e.type === 'bin' && e.op === '*') return [...factors(e.left), ...factors(e.right)];
  return [e];
}
const prod = (fs: Expr[]): Expr => (fs.length ? fs.reduce((a, b) => mul(a, b)) : num(1));

/** Coefficient a if u = a·x + b (a ≠ 0), else null. */
function linearCoef(u: Expr, x: string): number | null {
  const d = simplify(diff(u, x));
  return d.type === 'num' && d.value !== 0 ? d.value : null;
}

/** ∫ F(u) du for elementary outer functions, u given. */
function outer(name: string, u: Expr): Expr | null {
  switch (name) {
    case 'exp':
      return call('exp', u);
    case 'sin':
      return mul(num(-1), call('cos', u));
    case 'cos':
      return call('sin', u);
    case 'sinh':
      return call('cosh', u);
    case 'cosh':
      return call('sinh', u);
    case 'sec2':
      return call('tan', u);
    default:
      return null;
  }
}

function basic(e: Expr, x: string): Expr | null {
  if (!dependsOn(e, x)) return mul(e, sym(x));
  if (e.type === 'sym' && e.name === x) return div(pow(sym(x), num(2)), num(2));
  // power of a linear expression: (a x + b)^n
  if (e.type === 'bin' && e.op === '^' && !dependsOn(e.right, x)) {
    const a = linearCoef(e.left, x);
    if (a !== null) {
      if (e.right.type === 'num' && e.right.value === -1) return div(call('ln', call('abs', e.left)), num(a));
      const n1 = simplify(add(e.right, num(1)));
      return div(pow(e.left, n1), mul(num(a), n1));
    }
    // 1/(1 + x²) and 1/√(1 − x²)
    if (e.right.type === 'num') {
      const inner = simplify(e.left);
      const plus = simplify(add(pow(sym(x), num(2)), num(1)));
      const minus = simplify(add(num(1), mul(num(-1), pow(sym(x), num(2)))));
      if (e.right.value === -1 && eq(inner, plus)) return call('atan', sym(x));
      if (e.right.value === -0.5 && eq(inner, minus)) return call('asin', sym(x));
      // sec² as cos^-2
      if (e.right.value === -2 && inner.type === 'call' && inner.callee.type === 'sym' && inner.callee.name === 'cos') {
        const a2 = linearCoef(inner.args[0], x);
        if (a2 !== null) return div(call('tan', inner.args[0]), num(a2));
      }
    }
  }
  // a^x with constant base
  if (e.type === 'bin' && e.op === '^' && !dependsOn(e.left, x)) {
    const a = linearCoef(e.right, x);
    if (a !== null) return div(e, mul(num(a), call('ln', e.left)));
  }
  if (e.type === 'call' && e.callee.type === 'sym' && e.args.length === 1) {
    const name = e.callee.name;
    const u = e.args[0];
    const a = linearCoef(u, x);
    if (a !== null) {
      const o = outer(name, u);
      if (o) return div(o, num(a));
      if ((name === 'ln' || name === 'log') && u.type === 'sym') return add(mul(sym(x), call('ln', sym(x))), mul(num(-1), sym(x)));
      if (name === 'tan') return div(mul(num(-1), call('ln', call('abs', call('cos', u)))), num(a));
    }
  }
  return null;
}

/** Structural equality of simplified expressions (spans ignored). */
function eq(a: Expr, b: Expr) {
  return toText(a, true) === toText(b, true);
}

/** g'(x)·F(g(x)) substitution: tries each factor as F(g) and checks the rest is a constant multiple of g'. */
function substitution(e: Expr, x: string): Expr | null {
  const fs = factors(e);
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i];
    let u: Expr | null = null;
    let F: ((u: Expr) => Expr | null) | null = null;
    if (f.type === 'call' && f.callee.type === 'sym' && f.args.length === 1) {
      const name = f.callee.name;
      u = f.args[0];
      F = (uu) => outer(name, uu);
    } else if (f.type === 'bin' && f.op === '^' && !dependsOn(f.right, x)) {
      u = f.left;
      const n = f.right;
      F = (uu) => (n.type === 'num' && n.value === -1 ? call('ln', call('abs', uu)) : div(pow(uu, simplify(add(n, num(1)))), simplify(add(n, num(1)))));
    } else if (f.type === 'sym' || !dependsOn(f, x)) continue;
    if (!u || !F || !dependsOn(u, x)) continue;
    const du = simplify(diff(u, x));
    const rest = prod(fs.filter((_, j) => j !== i));
    const ratio = simplify(div(rest, du));
    if (dependsOn(ratio, x)) continue;
    const Fu = F(u);
    if (Fu) return mul(ratio, Fu);
  }
  // u·u' pattern: a factor u whose derivative is (a constant multiple of) the rest → u²/2
  for (let i = 0; i < fs.length; i++) {
    const u = fs[i];
    if (!dependsOn(u, x) || u.type === 'sym') continue;
    const du = simplify(diff(u, x));
    const ratio = simplify(div(prod(fs.filter((_, j) => j !== i)), du));
    if (!dependsOn(ratio, x)) return mul(ratio, div(pow(u, num(2)), num(2)));
  }
  return null;
}

function integrateTerm(t: Expr, x: string): Expr | null {
  const fs = factors(t);
  const consts = fs.filter((f) => !dependsOn(f, x));
  const rest = fs.filter((f) => dependsOn(f, x));
  const c = prod(consts);
  if (!rest.length) return mul(c, sym(x));
  const body = prod(rest);
  const r = basic(body, x) ?? substitution(body, x);
  return r ? mul(c, r) : null;
}

/** Verified antiderivative of e with respect to x, or null. */
export function antiderivative(e: Expr, x: string): Expr | null {
  const candidates = [simplify(e), expand(e)];
  for (const cand of candidates) {
    const parts = terms(cand).map((t) => integrateTerm(t, x));
    if (parts.some((p) => !p)) continue;
    const F = simplify(parts.reduce((a, b) => add(a!, b!))!);
    if (verify(F, e, x)) return F;
  }
  return null;
}

/** Numeric check that dF/dx = e at several points of the domain. */
function verify(F: Expr, e: Expr, x: string): boolean {
  try {
    const dF = compileScalar(simplify(diff(F, x)), [x]);
    const f = compileScalar(e, [x]);
    let checked = 0;
    for (const t of [-2.3, -1.1, -0.37, 0.29, 0.77, 1.3, 2.9, 4.1]) {
      const a = f(t);
      const b = dF(t);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      if (Math.abs(a - b) > 1e-7 * (1 + Math.abs(a))) return false;
      checked++;
    }
    return checked >= 3;
  } catch {
    return false;
  }
}