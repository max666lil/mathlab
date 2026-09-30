/**
 * MLL parser: Pratt expression parser + line-oriented statements.
 *
 *   f(x,y) = x^2 + 2y^2          function definition
 *   P = point(1, 1) draggable     assignment with modifiers
 *   point Q = (1, 2)              assignment with a type hint
 *   a ∈ [-5, 5]                   slider shorthand
 *   show surface(f), contours(f)  show statement
 *   animate θ from 0 to 2π        animation
 *   grad f at P                   bare expression
 *
 * Statement forms are extensible through `registerStatementRule` so plugins can add syntax
 * such as `X ~ Normal(0, 1)` without touching the core parser.
 */
import { Expr, Span, BinOp, Relation, sym } from '../math-core/ast';
import { lex, Token, MathSyntaxError } from './lexer';

export { MathSyntaxError };

interface StatementBase {
  span: Span;
  modifiers: string[];
}

export type Statement =
  | (StatementBase & { kind: 'funcdef'; name: string; nameSpan: Span; params: string[]; body: Expr; typeHint?: string; ranges?: [string, Expr, Expr][] })
  | (StatementBase & { kind: 'assign'; name: string; nameSpan: Span; value: Expr; typeHint?: string })
  | (StatementBase & { kind: 'show'; items: Expr[] })
  | (StatementBase & { kind: 'animate'; name: string; from: Expr; to: Expr; duration?: Expr })
  | (StatementBase & { kind: 'expr'; value: Expr })
  | (StatementBase & { kind: 'hide'; items: Expr[] })
  | (StatementBase & { kind: 'compare'; a: Expr; b: Expr })
  | (StatementBase & { kind: 'custom'; rule: string; name?: string; data: unknown })
  | (StatementBase & { kind: 'error'; message: string; errorSpan: Span });

export const MODIFIERS = new Set(['draggable', 'hidden', 'fixed']);
export const TYPE_HINTS = new Set([
  'point', 'vector', 'field', 'function', 'curve', 'surface', 'matrix', 'scalar', 'gradient', 'direction', 'slider',
]);
const KEYWORDS = new Set(['at', 'from', 'to', 'over', 'draggable', 'hidden', 'fixed', 'toward', 'along', 'as', 'order', 'wrt', 'with']);
/** Clause words that end a command's main argument. */
const CLAUSES = ['at', 'from', 'to', 'toward', 'along', 'as', 'order', 'wrt', 'with', 'onto', 'in', 'around', 'across', 'through', 'on', 'inside'];

/** Hook for plugin syntax. `match` sees the statement's tokens (without newline/eof). */
export interface StatementRule {
  name: string;
  match(tokens: Token[]): boolean;
  parse(p: ExprParser, tokens: Token[], span: Span): Statement;
}

const statementRules: StatementRule[] = [];
export function registerStatementRule(rule: StatementRule) {
  const i = statementRules.findIndex((r) => r.name === rule.name);
  if (i >= 0) statementRules.splice(i, 1);
  statementRules.push(rule);
}

export interface ParserOptions {
  /** Names that may be applied without parentheses: `sin x`, `grad f`. */
  isPrefixFunction?: (name: string) => boolean;
  /**
   * Command builtins and the keyword clauses they accept:
   *   limit f as x -> 0 · integrate f from 0 to 1 · directional f at P toward u · taylor f at 0 order 4
   */
  commandKeywords?: (name: string) => string[] | undefined;
}

const BP = { eq: 5, add: 10, at: 15, mul: 20, neg: 25, pow: 40, postfix: 50 } as const;

export class ExprParser {
  private i = 0;
  private noImplicitFn = 0;
  private stops: Set<string>[] = [];
  private toks: Token[];
  private opts: ParserOptions;
  constructor(toks: Token[], opts: ParserOptions = {}) {
    this.opts = opts;
    this.toks = toks;
    if (toks.length === 0 || toks[toks.length - 1].kind !== 'eof') {
      const end = toks.length ? toks[toks.length - 1].to : 0;
      this.toks = [...toks, { kind: 'eof', text: '', from: end, to: end, spaced: false }];
    }
  }

  peek(o = 0): Token {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }
  next(): Token {
    return this.toks[Math.min(this.i++, this.toks.length - 1)];
  }
  atEnd() {
    return this.peek().kind === 'eof';
  }
  isOp(text: string, o = 0) {
    const t = this.peek(o);
    return t.kind === 'op' && t.text === text;
  }
  isIdent(text?: string, o = 0) {
    const t = this.peek(o);
    return t.kind === 'ident' && (text === undefined || t.text === text);
  }
  expectOp(text: string): Token {
    const t = this.next();
    if (t.kind !== 'op' || t.text !== text) throw new MathSyntaxError(`Expected '${text}'`, t.from, Math.max(t.to, t.from + 1));
    return t;
  }
  expectIdent(text?: string): Token {
    const t = this.next();
    if (t.kind !== 'ident' || (text && t.text !== text))
      throw new MathSyntaxError(text ? `Expected '${text}'` : 'Expected a name', t.from, Math.max(t.to, t.from + 1));
    return t;
  }
  expectEnd() {
    const t = this.peek();
    if (t.kind !== 'eof') throw new MathSyntaxError(`Unexpected '${t.text}'`, t.from, t.to);
  }

  parseExpr(rbp = 0): Expr {
    let left = this.nud();
    for (;;) {
      const t = this.peek();
      const lbp = this.infixBp(t, left);
      if (lbp <= rbp) break;
      left = this.led(left, t);
    }
    return left;
  }

  private startsPrimary(t: Token): boolean {
    if (t.kind === 'num') return true;
    if (t.kind === 'ident') {
      if (KEYWORDS.has(t.text)) return false;
      if (this.noImplicitFn > 0 && this.opts.isPrefixFunction?.(t.text)) return false;
      return true;
    }
    return t.kind === 'op' && (t.text === '∇' || t.text === '(');
  }

  /** Parse with extra stop words (clause keywords end the current expression). */
  withStops<T>(words: Iterable<string>, fn: () => T): T {
    this.stops.push(new Set(words));
    try {
      return fn();
    } finally {
      this.stops.pop();
    }
  }

  private stopped(t: Token) {
    return t.kind === 'ident' && this.stops.some((s) => s.has(t.text));
  }

  private infixBp(t: Token, left: Expr): number {
    if (this.stopped(t)) return 0;
    if (t.kind === 'op') {
      switch (t.text) {
        case '[':
          return isCallable(left) && !t.spaced ? BP.postfix : 0;
        case '=':
          return BP.eq;
        case '+':
        case '-':
          return BP.add;
        case '*':
        case '/':
        case '·':
        case '×':
          return BP.mul;
        case '^':
          return BP.pow;
        case '.':
        case '!':
          return BP.postfix;
        case '(':
          return isCallable(left) ? BP.postfix : BP.mul;
        case '∇':
          return BP.mul;
      }
      return 0;
    }
    if (t.kind === 'ident' && t.text === 'at') return BP.at;
    if (this.startsPrimary(t)) return BP.mul; // implicit multiplication
    return 0;
  }

  private led(left: Expr, t: Token): Expr {
    const from = spanOf(left).from;
    if (t.kind === 'ident' && t.text === 'at') {
      this.next();
      const right = this.parseExpr(BP.neg);
      return { type: 'bin', op: 'at', left, right, span: { from, to: spanOf(right).to } };
    }
    if (t.kind === 'op') {
      switch (t.text) {
        case '=': {
          this.next();
          const right = this.parseExpr(BP.eq);
          return { type: 'eq', left, right, span: { from, to: spanOf(right).to } };
        }
        case '+':
        case '-':
        case '*':
        case '/':
        case '·':
        case '×': {
          this.next();
          const bp = t.text === '+' || t.text === '-' ? BP.add : BP.mul;
          const right = this.parseExpr(bp);
          return { type: 'bin', op: t.text as BinOp, left, right, span: { from, to: spanOf(right).to } };
        }
        case '^': {
          this.next();
          const right = this.parseExpr(BP.pow - 1);
          return { type: 'bin', op: '^', left, right, span: { from, to: spanOf(right).to } };
        }
        case '[': {
          this.next();
          const index = this.withStops([], () => this.parseExpr(0));
          const close = this.expectOp(']');
          return { type: 'call', callee: sym('item'), args: [left, index], span: { from, to: close.to } };
        }
        case '!': {
          // n! — factorial (Γ(n + 1) for non-integers)
          const bang = this.next();
          return { type: 'call', callee: sym('factorial'), args: [left], span: { from, to: bang.to } };
        }
        case '.': {
          this.next();
          const id = this.expectIdent();
          return { type: 'member', object: left, prop: id.text, span: { from, to: id.to } };
        }
        case '(': {
          if (isCallable(left)) {
            this.next();
            const args = this.parseList(')');
            const close = this.expectOp(')');
            return { type: 'call', callee: left, args, span: { from, to: close.to } };
          }
          break;
        }
      }
    }
    // implicit multiplication
    const right = this.parseExpr(BP.mul);
    return { type: 'bin', op: '*', left, right, span: { from, to: spanOf(right).to } };
  }

  private parseList(close: string): Expr[] {
    const items: Expr[] = [];
    if (this.isOp(close)) return items;
    for (;;) {
      items.push(this.parseExpr(0));
      if (this.isOp(',')) {
        this.next();
        continue;
      }
      break;
    }
    return items;
  }

  private nud(): Expr {
    const t = this.next();
    if (t.kind === 'num') return { type: 'num', value: t.value!, span: { from: t.from, to: t.to } };
    if (t.kind === 'ident') {
      if (KEYWORDS.has(t.text)) throw new MathSyntaxError(`Unexpected '${t.text}'`, t.from, t.to);
      const s: Expr = { type: 'sym', name: t.text, span: { from: t.from, to: t.to } };
      const nx = this.peek();
      // command syntax: critical f, limit f as x -> 0, integrate f from a to b …
      const kws = this.opts.commandKeywords?.(t.text);
      // limit(f, 0) is a call; limit (2x+1)/(x-3) as … (space before the parenthesis) is command syntax
      if (kws && !(nx.kind === 'op' && nx.text === '(' && !nx.spaced) && (this.startsPrimary(nx) || (nx.kind === 'op' && ['-', '|', '<', '[', '('].includes(nx.text))))
        return this.parseCommand(s, kws);
      // prefix application: sin x, grad f
      const literalArg = nx.kind === 'op' && (nx.text === '[' || nx.text === '<') && nx.spaced;
      if (this.opts.isPrefixFunction?.(t.text) && !(nx.kind === 'op' && nx.text === '(') && (this.startsPrimary(nx) || literalArg)) {
        this.noImplicitFn++;
        let arg: Expr;
        try {
          arg = this.parseExpr(BP.at);
        } finally {
          this.noImplicitFn--;
        }
        return { type: 'call', callee: s, args: [arg], span: { from: t.from, to: spanOf(arg).to } };
      }
      return s;
    }
    if (t.kind === 'op') {
      switch (t.text) {
        case '-': {
          const arg = this.parseExpr(BP.neg);
          if (arg.type === 'num') return { type: 'num', value: -arg.value, span: { from: t.from, to: spanOf(arg).to } };
          return { type: 'neg', arg, span: { from: t.from, to: spanOf(arg).to } };
        }
        case '+':
          return this.parseExpr(BP.neg);
        case '∇': {
          // ∇·F (divergence), ∇×F (curl), ∇²f (Laplacian)
          const nx = this.peek();
          const special =
            nx.kind === 'op' && nx.text === '·' ? 'div' : nx.kind === 'op' && nx.text === '×' ? 'curl' : nx.kind === 'op' && nx.text === '^' && this.peek(1).kind === 'num' && this.peek(1).value === 2 ? 'laplacian' : undefined;
          if (special) {
            this.next();
            if (special === 'laplacian') this.next();
            const arg = this.primaryOnly();
            return { type: 'call', callee: { type: 'sym', name: special, span: { from: t.from, to: t.to } }, args: [arg], span: { from: t.from, to: spanOf(arg).to } };
          }
          const operand = this.primaryOnly();
          return {
            type: 'call',
            callee: { type: 'sym', name: 'grad', span: { from: t.from, to: t.to } },
            args: [operand],
            span: { from: t.from, to: spanOf(operand).to },
          };
        }
        case '(': {
          const items = this.parseList(')');
          const close = this.expectOp(')');
          const span = { from: t.from, to: close.to };
          if (items.length === 1) return { ...items[0], span };
          if (items.length === 0) throw new MathSyntaxError('Empty parentheses', t.from, close.to);
          return { type: 'tuple', items, span };
        }
        case '<': {
          const items = this.parseList('>');
          const close = this.expectOp('>');
          return { type: 'vec', items, span: { from: t.from, to: close.to } };
        }
        case '[': {
          const items = this.parseList(']');
          const close = this.expectOp(']');
          const span = { from: t.from, to: close.to };
          if (items.length > 0 && items.every((it) => it.type === 'list'))
            return { type: 'matrix', rows: items.map((it) => (it as Extract<Expr, { type: 'list' }>).items), span };
          return { type: 'list', items, span };
        }
        case '|': {
          const inner = this.parseExpr(0);
          const close = this.expectOp('|');
          return { type: 'call', callee: sym('abs'), args: [inner], span: { from: t.from, to: close.to } };
        }
      }
    }
    if (t.kind === 'eof') throw new MathSyntaxError('Unexpected end of input', t.from, t.from + 1);
    throw new MathSyntaxError(`Unexpected '${t.text}'`, t.from, t.to);
  }

  /** name <arg> [at E] [toward|along E] [from E to E] [as x -> E[±]] [order N] [wrt x] [with E] */
  private parseCommand(name: Extract<Expr, { type: 'sym' }>, kws: string[]): Expr {
    const arg = this.withStops(CLAUSES, () => this.parseExpr(0));
    // clause word → keyword argument it fills: 'as' fills wrt/approach, 'along' fills toward
    const has = new Set(kws);
    const allowed = new Set(CLAUSES.filter((w) => (w === 'as' ? has.has('approach') : w === 'along' ? has.has('toward') : w === 'to' ? false : has.has(w))));
    const kwargs: [string, Expr][] = [];
    let end = spanOf(arg).to;
    this.withStops(CLAUSES, () => {
      for (;;) {
        const k = this.peek();
        if (k.kind !== 'ident' || !allowed.has(k.text)) break;
        this.next();
        const value = (): Expr => {
          const e = this.parseExpr(0);
          end = spanOf(e).to;
          return e;
        };
        switch (k.text) {
          case 'from':
            kwargs.push(['from', value()]);
            this.expectIdent('to');
            kwargs.push(['to', value()]);
            break;
          case 'as': {
            const v = this.expectIdent();
            kwargs.push(['wrt', { type: 'sym', name: v.text, span: { from: v.from, to: v.to } }]);
            this.expectOp('->');
            const target = this.parseExpr(BP.add);
            end = spanOf(target).to;
            kwargs.push(['approach', target]);
            // one-sided: x -> 0+ / x -> 0-
            if ((this.isOp('+') || this.isOp('-')) && (this.peek(1).kind === 'eof' || this.stopped(this.peek(1)))) {
              const side = this.next();
              end = side.to;
              kwargs.push(['side', { type: 'sym', name: side.text === '+' ? 'right' : 'left' }]);
            }
            break;
          }
          case 'wrt': {
            const v = this.expectIdent();
            end = v.to;
            kwargs.push(['wrt', { type: 'sym', name: v.text, span: { from: v.from, to: v.to } }]);
            break;
          }
          case 'along':
            kwargs.push(['toward', value()]);
            break;
          default:
            kwargs.push([k.text, value()]);
        }
      }
    });
    return { type: 'call', callee: name, args: [arg], ...(kwargs.length ? { kwargs } : {}), span: { from: spanOf(name).from, to: end } };
  }

  /** A primary without postfix operators (so ∇f(P) parses as (∇f)(P)). */  private primaryOnly(): Expr {
    const t = this.peek();
    if (t.kind === 'ident') {
      this.next();
      return { type: 'sym', name: t.text, span: { from: t.from, to: t.to } };
    }
    return this.nud();
  }
}

/** Only names, calls and members are callable: `f(x)`, `grad(f)(P)`, `obj.fn(x)`. */
function isCallable(e: Expr) {
  return e.type === 'sym' || e.type === 'call' || e.type === 'member';
}

export function spanOf(e: Expr): Span {
  return e.span ?? { from: 0, to: 0 };
}

const OPENERS = new Set(['(', '[', '{']);
const CLOSERS = new Set([')', ']', '}']);
const CONTINUATION_OPS = new Set(['+', '-', '*', '/', '^', '=', ',', '·', '×']);

/** Split tokens into statements at top-level newlines / semicolons (with continuation rules). */
function splitStatements(toks: Token[]): Token[][] {
  const out: Token[][] = [];
  let cur: Token[] = [];
  let depth = 0;
  for (const t of toks) {
    if (t.kind === 'eof') break;
    if (t.kind === 'op' && OPENERS.has(t.text)) depth++;
    if (t.kind === 'op' && CLOSERS.has(t.text)) depth = Math.max(0, depth - 1);
    const isSemicolon = t.kind === 'op' && t.text === ';';
    if (t.kind === 'newline' || isSemicolon) {
      const last = cur[cur.length - 1];
      const continues = !isSemicolon && (depth > 0 || (last !== undefined && last.kind === 'op' && CONTINUATION_OPS.has(last.text)));
      if (!continues) {
        if (cur.length) out.push(cur);
        cur = [];
        depth = 0;
      }
      continue;
    }
    cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

export function parseProgram(src: string, opts: ParserOptions = {}): Statement[] {
  let toks: Token[];
  try {
    toks = lex(src);
  } catch (e) {
    if (e instanceof MathSyntaxError)
      return [{ kind: 'error', message: e.message, errorSpan: { from: e.from, to: e.to }, span: { from: 0, to: src.length }, modifiers: [] }];
    throw e;
  }
  return splitStatements(toks).map((st) => parseStatementTokens(st, opts));
}

export function parseStatementTokens(tokens: Token[], opts: ParserOptions = {}): Statement {
  const span = { from: tokens[0].from, to: tokens[tokens.length - 1].to };
  const modifiers: string[] = [];
  let toks = tokens;
  while (toks.length > 1 && toks[toks.length - 1].kind === 'ident' && MODIFIERS.has(toks[toks.length - 1].text)) {
    modifiers.unshift(toks[toks.length - 1].text);
    toks = toks.slice(0, -1);
  }
  try {
    for (const rule of statementRules) {
      if (rule.match(toks)) {
        const st = rule.parse(new ExprParser(toks, opts), toks, span);
        st.modifiers = modifiers;
        return st;
      }
    }
    return parseCoreStatement(toks, span, modifiers, opts);
  } catch (e) {
    if (e instanceof MathSyntaxError) return { kind: 'error', message: e.message, errorSpan: { from: e.from, to: e.to }, span, modifiers };
    throw e;
  }
}

function parseCoreStatement(toks: Token[], span: Span, modifiers: string[], opts: ParserOptions): Statement {
  const p = new ExprParser(toks, opts);
  const first = toks[0];
  if (first.kind === 'ident' && first.text === 'show' && toks.length > 1) {
    p.next();
    const items: Expr[] = [];
    for (;;) {
      items.push(p.parseExpr(0));
      if (p.isOp(',')) {
        p.next();
        continue;
      }
      break;
    }
    p.expectEnd();
    return { kind: 'show', items, span, modifiers };
  }
  if (first.kind === 'ident' && first.text === 'hide' && toks.length > 1) {
    p.next();
    const items: Expr[] = [];
    for (;;) {
      items.push(p.parseExpr(0));
      if (p.isOp(',')) {
        p.next();
        continue;
      }
      break;
    }
    p.expectEnd();
    return { kind: 'hide', items, span, modifiers };
  }
  if (first.kind === 'ident' && first.text === 'compare' && toks.length > 1) {
    p.next();
    const a = p.withStops(['with'], () => p.parseExpr(0));
    p.expectIdent('with');
    const b = p.parseExpr(0);
    p.expectEnd();
    return { kind: 'compare', a, b, span, modifiers };
  }  if (first.kind === 'ident' && first.text === 'animate' && toks.length > 1) {
    p.next();
    const name = p.expectIdent().text;
    p.expectIdent('from');
    const from = p.parseExpr(0);
    p.expectIdent('to');
    const to = p.parseExpr(0);
    let duration: Expr | undefined;
    if (p.isIdent('over')) {
      p.next();
      duration = p.parseExpr(0);
    }
    p.expectEnd();
    return { kind: 'animate', name, from, to, duration, span, modifiers };
  }
  // type hint: `point P = ...`, `field F(x,y) = ...`
  let typeHint: string | undefined;
  const t2 = toks[2];
  if (first.kind === 'ident' && TYPE_HINTS.has(first.text) && toks[1]?.kind === 'ident' && t2?.kind === 'op' && (t2.text === '=' || t2.text === '(' || t2.text === '∈')) {
    typeHint = first.text;
    p.next();
  }
  // slider shorthand: a ∈ [lo, hi]
  if (p.isIdent() && p.isOp('∈', 1)) {
    const nameTok = p.next();
    p.next();
    const range = p.parseExpr(0);
    p.expectEnd();
    if (range.type !== 'list' || range.items.length < 2) throw new MathSyntaxError('Expected an interval [lo, hi]', spanOf(range).from, spanOf(range).to);
    const value: Expr = { type: 'call', callee: sym('slider'), args: range.items, span: spanOf(range) };
    return { kind: 'assign', name: nameTok.text, nameSpan: { from: nameTok.from, to: nameTok.to }, value, typeHint: 'slider', span, modifiers };
  }
  const lhs = p.parseExpr(BP.eq);
  if (p.isOp('=')) {
    p.next();
    let rhs = p.withStops(['for'], () => p.parseExpr(0));
    // R = x^2 + y^2 <= 1: a named region
    const relR = parseRelation(p);
    if (relR) rhs = { type: 'eq', left: rhs, right: relR.rhs, rel: relR.rel, span: { from: spanOf(rhs).from, to: spanOf(relR.rhs).to } };
    // C(t) = (cos t, sin t) for t in [0, 2π]; S(u,v) = … for u in [0, 2π], v in [0, π]
    const ranges: [string, Expr, Expr][] = [];
    if (p.isIdent('for')) {
      p.next();
      for (;;) {
        const v = p.expectIdent();
        p.expectIdent('in');
        const iv = p.parseExpr(0);
        if (iv.type !== 'list' || iv.items.length !== 2) throw new MathSyntaxError('Expected an interval [a, b]', spanOf(iv).from, spanOf(iv).to);
        ranges.push([v.text, iv.items[0], iv.items[1]]);
        if (!p.isOp(',')) break;
        p.next();
      }
    }
    p.expectEnd();
    if (lhs.type === 'sym') return { kind: 'assign', name: lhs.name, nameSpan: spanOf(lhs), value: rhs, typeHint, span, modifiers };
    if (lhs.type === 'call' && lhs.callee.type === 'sym' && lhs.args.every((a) => a.type === 'sym')) {
      const params = lhs.args.map((a) => (a as Extract<Expr, { type: 'sym' }>).name);
      const bad = ranges.find(([v]) => !params.includes(v));
      if (bad) throw new MathSyntaxError(`'${bad[0]}' is not a parameter of ${lhs.callee.name}`, spanOf(lhs).from, spanOf(lhs).to);
      return { kind: 'funcdef', name: lhs.callee.name, nameSpan: spanOf(lhs.callee), params, body: rhs, typeHint, span, modifiers, ...(ranges.length ? { ranges } : {}) };
    }
    // x^2 + y^2 = 1: an implicit curve
    return { kind: 'expr', value: { type: 'eq', left: lhs, right: rhs, span: { from: spanOf(lhs).from, to: spanOf(rhs).to } }, span, modifiers };
  }
  // y < x^2, x^2 + y^2 >= 1: a region
  const rel = parseRelation(p);
  if (rel) {
    p.expectEnd();
    return { kind: 'expr', value: { type: 'eq', left: lhs, right: rel.rhs, rel: rel.rel, span: { from: spanOf(lhs).from, to: spanOf(rel.rhs).to } }, span, modifiers };
  }
  p.expectEnd();
  return { kind: 'expr', value: lhs, span, modifiers };
}

/** `< E`, `<= E`, `≤ E`, `> E`, `>= E`, `≥ E` at statement level. */
function parseRelation(p: ExprParser): { rel: Relation; rhs: Expr } | undefined {
  const t = p.peek();
  if (t.kind !== 'op' || !['<', '>', '≤', '≥', '<=', '>='].includes(t.text)) return undefined;
  p.next();
  let rel: Relation = t.text === '≤' ? '<=' : t.text === '≥' ? '>=' : (t.text as Relation);
  if ((t.text === '<' || t.text === '>') && p.isOp('=') && !p.peek().spaced) {
    p.next();
    rel = t.text === '<' ? '<=' : '>=';
  }
  return { rel, rhs: p.parseExpr(0) };
}

/** Parse a single expression (used by tests and tools). */
export function parseExpression(src: string, opts: ParserOptions = {}): Expr {
  const toks = lex(src).filter((t) => t.kind !== 'newline');
  const p = new ExprParser(toks, opts);
  const e = p.parseExpr(0);
  p.expectEnd();
  return e;
}
