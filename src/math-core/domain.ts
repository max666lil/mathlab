/**
 * Domains of elementary expressions: symbolic conditions read off the AST (exact), and a numeric
 * interval scan for one variable (heuristic: finite window, sampling).
 */
import { Expr, children, dependsOn } from './ast';
import { toLatex } from './symbolic/print';
import { simplify } from './symbolic/simplify';
import { compileScalar, oddRootExponent } from './compile';
import { roots1D } from './numeric/roots';

export interface DomainCondition {
  expr: Expr;
  rel: '>' | '≥' | '≠' | 'between';
  latex: string;
}

export function domainConditions(e: Expr, vars: string[]): DomainCondition[] {
  const out: DomainCondition[] = [];
  const seen = new Set<string>();
  const push = (expr: Expr, rel: DomainCondition['rel']) => {
    if (!vars.some((v) => dependsOn(expr, v))) return;
    const s = simplify(expr);
    const L = toLatex(s);
    const latex = rel === 'between' ? `-1 \\le ${L} \\le 1` : `${L} ${rel === '≥' ? '\\ge' : rel === '≠' ? '\\ne' : '>'} 0`;
    if (seen.has(latex)) return;
    seen.add(latex);
    out.push({ expr: s, rel, latex });
  };
  const walk = (n: Expr) => {
    if (n.type === 'call' && n.callee.type === 'sym' && n.args.length >= 1) {
      const u = n.args[0];
      switch (n.callee.name) {
        case 'ln':
        case 'log':
        case 'log10':
        case 'log2':
          push(u, '>');
          break;
        case 'sqrt':
          push(u, '≥');
          break;
        case 'tan':
        case 'sec':
          push({ type: 'call', callee: { type: 'sym', name: 'cos' }, args: [u] }, '≠');
          break;
        case 'cot':
        case 'csc':
          push({ type: 'call', callee: { type: 'sym', name: 'sin' }, args: [u] }, '≠');
          break;
        case 'asin':
        case 'acos':
        case 'arcsin':
        case 'arccos':
          push(u, 'between');
          break;
      }
    }
    if (n.type === 'bin' && n.op === '/') push(n.right, '≠');
    if (n.type === 'bin' && n.op === '^') {
      const odd = oddRootExponent(n.right);
      const p = n.right.type === 'num' ? n.right.value : odd?.value;
      if (p !== undefined) {
        if (p < 0) push(n.left, '≠');
        // x^(1/3), x^(2/3) are real for every x (odd root); other fractional powers need a non-negative base
        if (!Number.isInteger(p) && !odd) push(n.left, p < 0 ? '>' : '≥');
      } else if (vars.some((v) => dependsOn(n.right, v))) {
        // x^x, 2^x … with a variable exponent: real powers need a positive base (unless it is a constant > 0)
        if (vars.some((v) => dependsOn(n.left, v))) push(n.left, '>');
      }
    }
    if (n.type === 'neg' && n.arg.type === 'num') return;
    children(n).forEach(walk);
  };
  walk(e);
  return out;
}

export interface Interval {
  a: number;
  b: number;
  closedA: boolean;
  closedB: boolean;
}

export interface DomainScan {
  intervals: Interval[];
  window: [number, number];
}

/**
 * Domain of f(x) on a window, as a union of intervals. Excluded points come from the roots of the
 * "≠ 0" conditions; interval ends are refined by bisection. Ends that reach the window edge are
 * reported as ±∞ (heuristic).
 */
export function scanDomain1D(f: (x: number) => number, conds: DomainCondition[], x: string, window: [number, number] = [-100, 100]): DomainScan {
  const [lo, hi] = window;
  const N = 20000;
  // overflow (exp(1/x) near 0⁺) is still defined; NaN is not
  const ok = (t: number) => !Number.isNaN(f(t));
  const xs: number[] = [];
  for (let i = 0; i <= N; i++) xs.push(lo + ((hi - lo) * i) / N);
  const valid = xs.map(ok);
  const refine = (a: number, b: number) => {
    // a valid, b invalid (or reverse): bisect towards the boundary
    const va = ok(a);
    for (let k = 0; k < 60; k++) {
      const m = (a + b) / 2;
      if (ok(m) === va) a = m;
      else b = m;
    }
    return va ? a : b;
  };
  const intervals: Interval[] = [];
  let start: number | null = null;
  for (let i = 0; i <= N; i++) {
    if (valid[i] && start === null) start = i === 0 ? -Infinity : refine(xs[i], xs[i - 1]);
    if ((!valid[i] || i === N) && start !== null) {
      const end = valid[i] && i === N ? Infinity : refine(xs[i - 1], xs[i]);
      intervals.push({ a: start, b: end, closedA: Number.isFinite(start) && ok(start), closedB: Number.isFinite(end) && ok(end) });
      start = null;
    }
  }
  // excluded isolated points (roots of denominators etc.)
  const holes: number[] = [];
  for (const c of conds) {
    if (c.rel !== '≠') continue;
    try {
      const g = compileScalar(c.expr, [x]);
      holes.push(...roots1D(g, lo, hi, 8000).roots);
    } catch {
      /* not a function of x alone */
    }
  }
  const split: Interval[] = [];
  for (const iv of intervals) {
    const inside = holes.filter((h) => h > iv.a && h < iv.b).sort((p, q) => p - q);
    let a = iv.a;
    let ca = iv.closedA;
    for (const h of inside) {
      split.push({ a, b: h, closedA: ca, closedB: false });
      a = h;
      ca = false;
    }
    split.push({ a, b: iv.b, closedA: ca, closedB: iv.closedB });
  }
  const clean = (v: number) => (Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : v);
  // an end point where a condition becomes an equality: '≥' / 'between' include it, '>' / '≠' exclude it
  const endIncluded = (t: number) => {
    for (const c of conds) {
      try {
        const g = compileScalar(c.expr, [x])(t);
        if (c.rel === 'between' ? Math.abs(Math.abs(g) - 1) < 1e-7 : Math.abs(g) < 1e-7) return c.rel === '≥' || c.rel === 'between';
      } catch {
        /* condition in other variables */
      }
    }
    return Number.isFinite(f(t));
  };
  // decide open/closed at the cleaned end point (bisection stops just inside the domain)
  return {
    intervals: split.map((i) => {
      const a = clean(i.a);
      const b = clean(i.b);
      return { a, b, closedA: i.closedA && Number.isFinite(a) && endIncluded(a), closedB: i.closedB && Number.isFinite(b) && endIncluded(b) };
    }),
    window,
  };
}