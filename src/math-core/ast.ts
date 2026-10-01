/**
 * Expression AST shared by the parser, the symbolic engine, the compiler and the evaluator.
 * Nodes are immutable plain objects. `span` (source offsets, cell-relative) is optional so that
 * symbolic transformations can create nodes freely.
 */

export interface Span {
  from: number;
  to: number;
}

export type BinOp = '+' | '-' | '*' | '/' | '^' | '·' | '×' | 'at';

export type Expr =
  | { type: 'num'; value: number; span?: Span }
  | { type: 'sym'; name: string; span?: Span }
  | { type: 'neg'; arg: Expr; span?: Span }
  | { type: 'bin'; op: BinOp; left: Expr; right: Expr; span?: Span }
  /** kwargs: keyword clauses of command syntax, e.g. limit f as x -> 0 → [['wrt', x], ['approach', 0]] */
  | { type: 'call'; callee: Expr; args: Expr[]; kwargs?: [string, Expr][]; span?: Span }
  /** (a, b, ...) — a point by default */
  | { type: 'tuple'; items: Expr[]; span?: Span }
  /** <a, b, ...> — a vector */
  | { type: 'vec'; items: Expr[]; span?: Span }
  /** [a, b] — a list / interval */
  | { type: 'list'; items: Expr[]; span?: Span }
  /** [[a, b], [c, d]] — a matrix (row major) */
  | { type: 'matrix'; rows: Expr[][]; span?: Span }
  /** P.x */
  | { type: 'member'; object: Expr; prop: string; span?: Span }
  /** x = a (arguments such as slice(f, x = 1)); as a statement: an implicit curve or, with `rel`, an inequality */
  | { type: 'eq'; left: Expr; right: Expr; rel?: Relation; span?: Span };

export type Relation = '<' | '>' | '<=' | '>=' | '!=';

export const num = (value: number): Expr => ({ type: 'num', value });
export const sym = (name: string): Expr => ({ type: 'sym', name });
export const neg = (arg: Expr): Expr => ({ type: 'neg', arg });
export const bin = (op: BinOp, left: Expr, right: Expr): Expr => ({ type: 'bin', op, left, right });
export const add = (a: Expr, b: Expr) => bin('+', a, b);
export const sub = (a: Expr, b: Expr) => bin('-', a, b);
export const mul = (a: Expr, b: Expr) => bin('*', a, b);
export const div = (a: Expr, b: Expr) => bin('/', a, b);
export const pow = (a: Expr, b: Expr) => bin('^', a, b);
export const call = (name: string, ...args: Expr[]): Expr => ({ type: 'call', callee: sym(name), args });
export const vec = (items: Expr[]): Expr => ({ type: 'vec', items });
export const matrix = (rows: Expr[][]): Expr => ({ type: 'matrix', rows });

export function isNum(e: Expr, v?: number): e is Extract<Expr, { type: 'num' }> {
  return e.type === 'num' && (v === undefined || e.value === v);
}

/** Name of the called function when the callee is a plain symbol. */
export function calleeName(e: Expr): string | undefined {
  return e.type === 'call' && e.callee.type === 'sym' ? e.callee.name : undefined;
}

/** Direct children of a node. */
export function children(e: Expr): Expr[] {
  switch (e.type) {
    case 'neg':
      return [e.arg];
    case 'bin':
    case 'eq':
      return [e.left, e.right];
    case 'call':
      return [e.callee, ...e.args, ...(e.kwargs ?? []).map(([, v]) => v)];
    case 'tuple':
    case 'vec':
    case 'list':
      return e.items;
    case 'matrix':
      return e.rows.flat();
    case 'member':
      return [e.object];
    default:
      return [];
  }
}

/** Rebuild an expression bottom-up, applying `f` to every node after its children. */
export function mapExpr(e: Expr, f: (e: Expr) => Expr): Expr {
  const m = (x: Expr) => mapExpr(x, f);
  let out: Expr;
  switch (e.type) {
    case 'neg':
      out = { ...e, arg: m(e.arg) };
      break;
    case 'bin':
      out = { ...e, left: m(e.left), right: m(e.right) };
      break;
    case 'eq':
      out = { ...e, left: m(e.left), right: m(e.right) };
      break;
    case 'call':
      out = { ...e, callee: e.callee.type === 'sym' ? e.callee : m(e.callee), args: e.args.map(m), ...(e.kwargs ? { kwargs: e.kwargs.map(([k, v]) => [k, m(v)] as [string, Expr]) } : {}) };
      break;
    case 'tuple':
    case 'vec':
    case 'list':
      out = { ...e, items: e.items.map(m) };
      break;
    case 'matrix':
      out = { ...e, rows: e.rows.map((r) => r.map(m)) };
      break;
    case 'member':
      out = { ...e, object: m(e.object) };
      break;
    default:
      out = e;
  }
  return f(out);
}

/** Symbols referenced by an expression, including callee names of calls. */
export function freeSymbols(e: Expr, out = new Set<string>()): Set<string> {
  if (e.type === 'sym') out.add(e.name);
  for (const c of children(e)) freeSymbols(c, out);
  return out;
}

/**
 * Does `e` depend on variable `v`? Callee names and member objects (P.x) are never
 * variables of differentiation, so they are treated as constants.
 */
export function dependsOn(e: Expr, v: string): boolean {
  switch (e.type) {
    case 'num':
    case 'member':
      return false;
    case 'sym':
      return e.name === v;
    case 'call':
      return e.args.some((a) => dependsOn(a, v)) || (e.callee.type !== 'sym' && dependsOn(e.callee, v)) || !!e.kwargs?.some(([, a]) => dependsOn(a, v));
    default:
      return children(e).some((c) => dependsOn(c, v));
  }
}

/** Structural equality ignoring spans. */
export function exprEquals(a: Expr, b: Expr): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'num':
      return a.value === (b as typeof a).value;
    case 'sym':
      return a.name === (b as typeof a).name;
    case 'member':
      return a.prop === (b as typeof a).prop && exprEquals(a.object, (b as typeof a).object);
    case 'bin':
      if (a.op !== (b as typeof a).op) return false;
      break;
  }
  const ca = children(a);
  const cb = children(b);
  if (a.type === 'matrix') {
    const rb = (b as typeof a).rows;
    if (a.rows.length !== rb.length || a.rows.some((r, i) => r.length !== rb[i].length)) return false;
  }
  return ca.length === cb.length && ca.every((c, i) => exprEquals(c, cb[i]));
}
