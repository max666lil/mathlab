/**
 * Algebraic simplifier. Normal form:
 *   sum     = terms combined by monomial (coefficient × factors), constant last, first-appearance order
 *   product = numeric coefficient first, factors grouped by base with summed exponents, sorted
 * It is deliberately modest: enough to present derivatives readably (2x, 4y, -sin(x)cos(y)).
 */
import { Expr, num } from '../ast';
import { getScalarFunction } from '../scalar-functions';
import { toText } from './print';

const key = (e: Expr) => toText(e, true);

const PURE_FOLD = new Set(['sin', 'cos', 'tan', 'exp', 'ln', 'log', 'sqrt', 'abs', 'sign', 'sinh', 'cosh', 'tanh', 'atan', 'asin', 'acos']);

export function simplify(e: Expr): Expr {
  switch (e.type) {
    case 'num':
    case 'sym':
      return e;
    case 'member':
      return { type: 'member', object: simplify(e.object), prop: e.prop };
    case 'neg':
      return mulList([num(-1), simplify(e.arg)]);
    case 'bin': {
      const l = simplify(e.left);
      const r = simplify(e.right);
      switch (e.op) {
        case '+':
          return addList([l, r]);
        case '-':
          return addList([l, mulList([num(-1), r])]);
        case '*':
          return mulList([l, r]);
        case '/':
          return mulList([l, powS(r, num(-1))]);
        case '^':
          return powS(l, r);
        default:
          return { type: 'bin', op: e.op, left: l, right: r };
      }
    }
    case 'call': {
      const args = e.args.map(simplify);
      const name = e.callee.type === 'sym' ? e.callee.name : undefined;
      if (name && args.length === 1) {
        const a = args[0];
        if (a.type === 'num' && PURE_FOLD.has(name)) {
          const v = getScalarFunction(name)!.fn(a.value);
          if (Number.isInteger(v)) return num(v);
        }
        if ((name === 'ln' || name === 'log') && a.type === 'call' && a.callee.type === 'sym' && a.callee.name === 'exp') return a.args[0];
        if ((name === 'ln' || name === 'log') && a.type === 'sym' && a.name === 'e') return { type: 'num', value: 1 };
        if (name === 'exp' && a.type === 'call' && a.callee.type === 'sym' && (a.callee.name === 'ln' || a.callee.name === 'log')) return a.args[0];
      }
      return { type: 'call', callee: e.callee, args };
    }
    case 'tuple':
    case 'vec':
    case 'list':
      return { type: e.type, items: e.items.map(simplify) };
    case 'matrix':
      return { type: 'matrix', rows: e.rows.map((r) => r.map(simplify)) };
    case 'eq':
      return { type: 'eq', left: simplify(e.left), right: simplify(e.right) };
  }
}

function flatten(e: Expr, op: '+' | '*', out: Expr[]) {
  if (e.type === 'bin' && e.op === op) {
    flatten(e.left, op, out);
    flatten(e.right, op, out);
  } else out.push(e);
}

/** Split a (simplified) term into numeric coefficient and the rest. */
function splitCoef(e: Expr): [number, Expr | null] {
  if (e.type === 'num') return [e.value, null];
  if (e.type === 'bin' && e.op === '*') {
    const fs: Expr[] = [];
    flatten(e, '*', fs);
    let c = 1;
    const rest = fs.filter((f) => {
      if (f.type === 'num') {
        c *= f.value;
        return false;
      }
      return true;
    });
    return [c, rest.length ? rest.reduce((a, b) => ({ type: 'bin', op: '*', left: a, right: b })) : null];
  }
  return [1, e];
}

export function addList(items: Expr[]): Expr {
  const flat: Expr[] = [];
  items.forEach((i) => flatten(i, '+', flat));
  let constant = 0;
  const groups = new Map<string, { coef: number; rest: Expr }>();
  for (const t of flat) {
    const [c, rest] = splitCoef(t);
    if (!rest) {
      constant += c;
      continue;
    }
    const k = key(rest);
    const g = groups.get(k);
    if (g) g.coef += c;
    else groups.set(k, { coef: c, rest });
  }
  // Pythagorean identity: a·sin²u + b·cos²u = m + (a−m)·sin²u + (b−m)·cos²u with m the common part
  for (const g of groups.values()) {
    const r = g.rest;
    if (!(r.type === 'bin' && r.op === '^' && r.right.type === 'num' && r.right.value === 2 && r.left.type === 'call' && r.left.callee.type === 'sym' && r.left.callee.name === 'sin')) continue;
    const cosKey = key({ type: 'bin', op: '^', left: { type: 'call', callee: { type: 'sym', name: 'cos' }, args: r.left.args }, right: num(2) });
    const h = groups.get(cosKey);
    if (!h || Math.sign(h.coef) !== Math.sign(g.coef)) continue;
    const m = Math.abs(g.coef) < Math.abs(h.coef) ? g.coef : h.coef;
    constant += m;
    g.coef -= m;
    h.coef -= m;
  }
  const terms: Expr[] = [];
  for (const { coef, rest } of groups.values()) {
    if (Math.abs(coef) < 1e-14) continue;
    terms.push(coef === 1 ? rest : mulList([num(coef), rest]));
  }
  if (constant !== 0 || terms.length === 0) terms.push(num(constant));
  return terms.reduce((a, b) => ({ type: 'bin', op: '+', left: a, right: b }));
}

function factorRank(e: Expr): number {
  const b = e.type === 'bin' && e.op === '^' ? e.left : e;
  if (b.type === 'sym') return 0;
  if (b.type === 'member') return 1;
  if (b.type === 'call') return 2;
  return 3;
}

export function mulList(items: Expr[]): Expr {
  const flat: Expr[] = [];
  items.forEach((i) => flatten(i, '*', flat));
  let coef = 1;
  const groups = new Map<string, { base: Expr; exps: Expr[] }>();
  for (const f of flat) {
    if (f.type === 'num') {
      coef *= f.value;
      continue;
    }
    const [base, exp] = f.type === 'bin' && f.op === '^' ? [f.left, f.right] : [f, num(1)];
    const k = key(base);
    const g = groups.get(k);
    if (g) g.exps.push(exp);
    else groups.set(k, { base, exps: [exp] });
  }
  if (coef === 0) return num(0);
  const factors: Expr[] = [];
  for (const { base, exps } of groups.values()) {
    const p = powS(base, exps.length === 1 ? exps[0] : addList(exps));
    if (p.type === 'num') coef *= p.value;
    else factors.push(p);
  }
  // distribute a lone numeric coefficient over a sum: -1*(a+b) → -a - b
  if (factors.length === 1 && coef !== 1 && factors[0].type === 'bin' && factors[0].op === '+') {
    const terms: Expr[] = [];
    flatten(factors[0], '+', terms);
    return addList(terms.map((t) => mulList([num(coef), t])));
  }
  factors.sort((a, b) => factorRank(a) - factorRank(b) || (factorRank(a) === 0 ? key(a).localeCompare(key(b)) : 0));
  if (factors.length === 0) return num(coef);
  const prod = factors.reduce((a, b) => ({ type: 'bin', op: '*', left: a, right: b }));
  return coef === 1 ? prod : { type: 'bin', op: '*', left: num(coef), right: prod };
}

export function powS(b: Expr, e: Expr): Expr {
  if (e.type === 'num') {
    if (e.value === 0) return num(1);
    if (e.value === 1) return b;
  }
  if (b.type === 'num') {
    if (b.value === 1) return num(1);
    if (b.value === 0 && e.type === 'num' && e.value > 0) return num(0);
    if (e.type === 'num') {
      const v = Math.pow(b.value, e.value);
      if (isFinite(v) && (Number.isInteger(e.value) || Number.isInteger(v))) return num(v);
    }
  }
  if (b.type === 'bin' && b.op === '^' && e.type === 'num' && Number.isInteger(e.value) && b.right.type === 'num' && Number.isInteger(b.right.value)) {
    return powS(b.left, num(b.right.value * e.value));
  }
  if (b.type === 'bin' && b.op === '*' && e.type === 'num' && Number.isInteger(e.value)) {
    const fs: Expr[] = [];
    flatten(b, '*', fs);
    return mulList(fs.map((f) => powS(f, e)));
  }
  return { type: 'bin', op: '^', left: b, right: e };
}
