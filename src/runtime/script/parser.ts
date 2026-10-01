/**
 * MATLAB-style script language (Phase S): lexer and parser. Scripts live in worksheet blocks
 *
 *   function s = partialsum(n)          script clt
 *     s = 0;                              rng(1); m = zeros(1, 2000);
 *     for k = 1:n                         for i = 1:2000
 *       s = s + 1/k^2;                      m(i) = mean(rand(1, 30));
 *     end                                 end
 *   end                                   hist(m, 30)
 *                                       end
 *
 * Syntax follows MATLAB: 1-based indexing with (), [1 2; 3 4] literals, a:b:c ranges, element-wise
 * .* ./ .^, ' transpose, % comments, ; to suppress output, @(x) anonymous functions.
 */

export interface Tok {
  k: 'num' | 'id' | 'str' | 'op' | 'nl' | 'eof';
  v: string;
  n?: number;
  pos: number;
  /** whitespace right before the token (matters inside [ ]) */
  sp: boolean;
}

export class ScriptSyntaxError extends Error {
  constructor(message: string, public pos: number) {
    super(message);
  }
}

const OPS = ['...', '.*', './', '.^', ".'", '==', '~=', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '\\', '^', "'", '<', '>', '&', '|', '~', '!', '=', ':', ',', ';', '(', ')', '[', ']', '{', '}', '@', '.'];

export function lexScript(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let sp = false;
  const valueEnd = () => {
    const p = out[out.length - 1];
    return !!p && (p.k === 'num' || p.k === 'id' || p.k === 'str' || (p.k === 'op' && [')', ']', '}', "'", ".'"].includes(p.v)));
  };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      sp = true;
      continue;
    }
    if (c === '%' || c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '\n') {
      out.push({ k: 'nl', v: '\n', pos: i, sp });
      i++;
      sp = false;
      continue;
    }
    // line continuation
    if (src.startsWith('...', i)) {
      while (i < src.length && src[i] !== '\n') i++;
      i++;
      sp = true;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ k: 'num', v: m[0], n: parseFloat(m[0]), pos: i, sp });
      i += m[0].length;
      sp = false;
      continue;
    }
    if (/[A-Za-z_\u0370-\u03ff]/.test(c)) {
      const m = /^[A-Za-z_\u0370-\u03ff][A-Za-z0-9_\u0370-\u03ff]*/.exec(src.slice(i))!;
      out.push({ k: 'id', v: m[0], pos: i, sp });
      i += m[0].length;
      sp = false;
      continue;
    }
    // strings: "…" always; '…' unless the quote is a transpose (right after a value, no space)
    if (c === '"' || (c === "'" && !(valueEnd() && !sp))) {
      let j = i + 1;
      let s = '';
      for (;;) {
        if (j >= src.length || src[j] === '\n') throw new ScriptSyntaxError('unterminated string', i);
        if (src[j] === c) {
          if (src[j + 1] === c) {
            s += c;
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      out.push({ k: 'str', v: s, pos: i, sp });
      i = j + 1;
      sp = false;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ScriptSyntaxError(`unexpected character '${c}'`, i);
    out.push({ k: 'op', v: op === '!=' ? '~=' : op, pos: i, sp });
    i += op.length;
    sp = false;
  }
  out.push({ k: 'eof', v: '', pos: src.length, sp });
  return out;
}

// ------------------------------------------------------------------ AST

export type SExpr =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; name: string; pos: number }
  | { t: 'bin'; op: string; a: SExpr; b: SExpr; pos: number }
  | { t: 'un'; op: string; a: SExpr }
  | { t: 'post'; op: string; a: SExpr }
  | { t: 'range'; a: SExpr; step?: SExpr; b: SExpr }
  | { t: 'call'; f: SExpr; args: SExpr[]; pos: number }
  | { t: 'colon' }
  | { t: 'end' }
  | { t: 'mat'; rows: SExpr[][] }
  | { t: 'lambda'; params: string[]; body: SExpr; src: string }
  | { t: 'handle'; name: string }
  | { t: 'field'; a: SExpr; name: string };

export type SStmt =
  | { t: 'expr'; e: SExpr; quiet: boolean; pos: number }
  | { t: 'assign'; name: string; index?: SExpr[]; e: SExpr; quiet: boolean; pos: number }
  | { t: 'multi'; names: string[]; e: SExpr; quiet: boolean; pos: number }
  | { t: 'for'; v: string; e: SExpr; body: SStmt[]; pos: number }
  | { t: 'while'; c: SExpr; body: SStmt[]; pos: number }
  | { t: 'if'; branches: { c: SExpr | null; body: SStmt[] }[]; pos: number }
  | { t: 'break'; pos: number }
  | { t: 'continue'; pos: number }
  | { t: 'return'; pos: number }
  | { t: 'command'; name: string; args: string[]; pos: number };

export interface SFunction {
  name: string;
  params: string[];
  outs: string[];
  body: SStmt[];
}

export interface SProgram {
  body: SStmt[];
  functions: SFunction[];
}

// ------------------------------------------------------------------ parser

/** Words used MATLAB-style without parentheses: hold on, grid on, clc, close all, format long. */
const COMMAND_WORDS = new Set(['hold', 'grid', 'clc', 'close', 'format', 'clear', 'axis', 'figure', 'drawnow', 'more']);

export class ScriptParser {
  private i = 0;
  private inIndex = 0;
  private inMatrix = 0;
  private parens = 0;
  constructor(private toks: Tok[], private src: string) {}

  private peek(o = 0) {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }
  private next() {
    return this.toks[Math.min(this.i++, this.toks.length - 1)];
  }
  private isOp(v: string, o = 0) {
    const t = this.peek(o);
    return t.k === 'op' && t.v === v;
  }
  private isId(v?: string, o = 0) {
    const t = this.peek(o);
    return t.k === 'id' && (v === undefined || t.v === v);
  }
  private expectOp(v: string) {
    const t = this.next();
    if (t.k !== 'op' || t.v !== v) throw new ScriptSyntaxError(`expected '${v}'`, t.pos);
    return t;
  }
  private expectId(): Tok {
    const t = this.next();
    if (t.k !== 'id') throw new ScriptSyntaxError('expected a name', t.pos);
    return t;
  }
  private skipSeps() {
    while (this.peek().k === 'nl' || this.isOp(';') || this.isOp(',')) this.next();
  }

  program(): SProgram {
    const functions: SFunction[] = [];
    const body = this.block(['<eof>'], functions);
    return { body, functions };
  }

  /** Statements until one of the terminator words (end, else, elseif) or eof. */
  block(terms: string[], functions: SFunction[]): SStmt[] {
    const out: SStmt[] = [];
    for (;;) {
      this.skipSeps();
      const t = this.peek();
      if (t.k === 'eof') {
        if (!terms.includes('<eof>')) throw new ScriptSyntaxError(`missing 'end'`, t.pos);
        return out;
      }
      if (t.k === 'id' && terms.includes(t.v)) return out;
      if (t.k === 'id' && t.v === 'function') {
        functions.push(this.functionDef(functions));
        continue;
      }
      out.push(this.statement(functions));
    }
  }

  functionDef(functions: SFunction[]): SFunction {
    this.next(); // function
    let outs: string[] = [];
    // function [a, b] = name(...) · function y = name(...) · function name(...)
    if (this.isOp('[')) {
      this.next();
      while (!this.isOp(']')) {
        outs.push(this.expectId().v);
        if (this.isOp(',')) this.next();
      }
      this.next();
      this.expectOp('=');
    } else if (this.isId() && this.isOp('=', 1)) {
      outs = [this.next().v];
      this.next();
    }
    const name = this.expectId().v;
    const params: string[] = [];
    if (this.isOp('(')) {
      this.next();
      while (!this.isOp(')')) {
        params.push(this.expectId().v);
        if (this.isOp(',')) this.next();
      }
      this.next();
    }
    const body = this.block(['end', '<eof>'], functions);
    if (this.isId('end')) this.next();
    return { name, params, outs, body };
  }

  private endOfStatement(): boolean {
    const t = this.peek();
    let quiet = false;
    if (t.k === 'op' && t.v === ';') {
      quiet = true;
      this.next();
    } else if (t.k === 'op' && t.v === ',') this.next();
    else if (t.k === 'nl') this.next();
    else if (t.k !== 'eof' && !(t.k === 'id' && ['end', 'else', 'elseif'].includes(t.v)))
      throw new ScriptSyntaxError(`unexpected '${t.v}'`, t.pos);
    return quiet;
  }

  statement(functions: SFunction[]): SStmt {
    const t = this.peek();
    const pos = t.pos;
    if (t.k === 'id') {
      switch (t.v) {
        case 'for': {
          this.next();
          const paren = this.isOp('(');
          if (paren) this.next();
          const v = this.expectId().v;
          this.expectOp('=');
          const e = this.expr();
          if (paren) this.expectOp(')');
          const body = this.block(['end'], functions);
          this.next();
          return { t: 'for', v, e, body, pos };
        }
        case 'while': {
          this.next();
          const c = this.expr();
          const body = this.block(['end'], functions);
          this.next();
          return { t: 'while', c, body, pos };
        }
        case 'if': {
          this.next();
          const branches: { c: SExpr | null; body: SStmt[] }[] = [];
          let c: SExpr | null = this.expr();
          for (;;) {
            const body = this.block(['elseif', 'else', 'end'], functions);
            branches.push({ c, body });
            const w = this.next().v;
            if (w === 'end') break;
            if (w === 'elseif') c = this.expr();
            else {
              const eb = this.block(['end'], functions);
              this.next();
              branches.push({ c: null, body: eb });
              break;
            }
          }
          return { t: 'if', branches, pos };
        }
        case 'break':
        case 'continue':
        case 'return':
          this.next();
          this.endOfStatement();
          return { t: t.v, pos } as SStmt;
      }
      // command syntax: hold on, clc, close all, figure
      if (COMMAND_WORDS.has(t.v) && !this.isOp('=', 1) && !this.isOp('(', 1)) {
        this.next();
        const args: string[] = [];
        while (this.peek().k === 'id' || this.peek().k === 'num') args.push(this.next().v);
        this.endOfStatement();
        return { t: 'command', name: t.v, args, pos };
      }
    }
    // [a, b] = f(…)
    if (this.isOp('[')) {
      const save = this.i;
      const names = this.tryTargets();
      if (names && this.isOp('=') && !this.isOp('=', 1)) {
        this.next();
        const e = this.expr();
        return { t: 'multi', names, e, quiet: this.endOfStatement(), pos };
      }
      this.i = save;
    }
    const e = this.expr();
    if (this.isOp('=')) {
      this.next();
      const rhs = this.expr();
      const quiet = this.endOfStatement();
      if (e.t === 'id') return { t: 'assign', name: e.name, e: rhs, quiet, pos };
      if (e.t === 'call' && e.f.t === 'id') return { t: 'assign', name: e.f.name, index: e.args, e: rhs, quiet, pos };
      throw new ScriptSyntaxError('cannot assign to this expression', pos);
    }
    return { t: 'expr', e, quiet: this.endOfStatement(), pos };
  }

  private tryTargets(): string[] | null {
    this.next(); // [
    const names: string[] = [];
    while (!this.isOp(']')) {
      if (!this.isId() && !this.isOp('~')) return null;
      names.push(this.next().v);
      if (this.isOp(',')) this.next();
      else if (!this.isOp(']') && !this.isId() && !this.isOp('~')) return null;
    }
    this.next();
    return names;
  }

  // precedence: || < && < | < & < comparison < : < + - < * / < unary < ^ < postfix
  expr(): SExpr {
    return this.binary(0);
  }

  private static LEVELS: string[][] = [['||'], ['&&'], ['|'], ['&'], ['==', '~=', '<', '<=', '>', '>=']];

  private binary(level: number): SExpr {
    if (level === ScriptParser.LEVELS.length) return this.range();
    let a = this.binary(level + 1);
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && ScriptParser.LEVELS[level].includes(t.v) && !this.matrixBreak(t)) {
        this.next();
        const b = this.binary(level + 1);
        a = { t: 'bin', op: t.v, a, b, pos: t.pos };
      } else return a;
    }
  }

  private range(): SExpr {
    // a bare ':' inside an index means "all"
    if (this.inIndex && this.isOp(':') && (this.isOp(',', 1) || this.isOp(')', 1))) {
      this.next();
      return { t: 'colon' };
    }
    const a = this.additive();
    if (!this.isOp(':') || (this.inMatrix && this.parens === 0 && false)) return a;
    this.next();
    const b = this.additive();
    if (this.isOp(':')) {
      this.next();
      const c = this.additive();
      return { t: 'range', a, step: b, b: c };
    }
    return { t: 'range', a, b };
  }

  /** Inside [ ]: "1 -2" is two elements, "1 - 2" and "1-2" are one. */
  private matrixBreak(t: Tok): boolean {
    if (!this.inMatrix || this.parens > 0 || this.inIndex) return false;
    if (t.k !== 'op' || !(t.v === '+' || t.v === '-')) return false;
    return t.sp && !this.peek(1).sp;
  }

  private additive(): SExpr {
    let a = this.multiplicative();
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && (t.v === '+' || t.v === '-') && !this.matrixBreak(t)) {
        this.next();
        const b = this.multiplicative();
        a = { t: 'bin', op: t.v, a, b, pos: t.pos };
      } else return a;
    }
  }

  private multiplicative(): SExpr {
    let a = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && ['*', '/', '.*', './', '\\'].includes(t.v)) {
        this.next();
        const b = this.unary();
        a = { t: 'bin', op: t.v, a, b, pos: t.pos };
      } else return a;
    }
  }

  private unary(): SExpr {
    const t = this.peek();
    if (t.k === 'op' && (t.v === '-' || t.v === '+' || t.v === '~' || t.v === '!')) {
      this.next();
      const a = this.unary();
      return t.v === '+' ? a : { t: 'un', op: t.v === '!' ? '~' : t.v, a };
    }
    return this.power();
  }

  /** MATLAB's ^ is left-associative: 2^3^2 = 64; the exponent may be signed: 2^-1. */
  private power(): SExpr {
    let a = this.postfix();
    for (;;) {
      const t = this.peek();
      if (!(t.k === 'op' && (t.v === '^' || t.v === '.^'))) return a;
      this.next();
      const u = this.peek();
      let b: SExpr;
      if (u.k === 'op' && (u.v === '-' || u.v === '+')) {
        this.next();
        const e = this.postfix();
        b = u.v === '-' ? { t: 'un', op: '-', a: e } : e;
      } else b = this.postfix();
      a = { t: 'bin', op: t.v, a, b, pos: t.pos };
    }
  }

  private postfix(): SExpr {
    let a = this.primary();
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && t.v === '(' && !(this.inMatrix && this.parens === 0 && t.sp)) {
        this.next();
        this.inIndex++;
        this.parens++;
        const args: SExpr[] = [];
        try {
          while (!this.isOp(')')) {
            // R-style named argument: pgamma(15, 2, scale = 2.5) → …, 'scale', 2.5
            if (this.isId() && this.isOp('=', 1) && !this.isOp('=', 2)) {
              const nm = this.next().v;
              this.next();
              args.push({ t: 'str', v: nm }, this.expr());
            } else args.push(this.expr());
            if (this.isOp(',')) this.next();
            else if (!this.isOp(')')) throw new ScriptSyntaxError(`expected ',' or ')'`, this.peek().pos);
          }
        } finally {
          this.inIndex--;
          this.parens--;
        }
        this.next();
        a = { t: 'call', f: a, args, pos: t.pos };
      } else if (t.k === 'op' && (t.v === "'" || t.v === ".'") && !t.sp) {
        this.next();
        a = { t: 'post', op: t.v, a };
      } else if (t.k === 'op' && t.v === '.' && this.peek(1).k === 'id' && !t.sp) {
        this.next();
        a = { t: 'field', a, name: this.next().v };
      } else if (t.k === 'id' && !t.sp && a.t === 'num') {
        // 2x → 2*x (a number directly followed by a name)
        const b = this.postfixNoNum();
        a = { t: 'bin', op: '*', a, b, pos: t.pos };
      } else return a;
    }
  }

  private postfixNoNum(): SExpr {
    return this.postfix();
  }

  private primary(): SExpr {
    const t = this.next();
    switch (t.k) {
      case 'num':
        return { t: 'num', v: t.n! };
      case 'str':
        return { t: 'str', v: t.v };
      case 'id':
        if (t.v === 'end' && this.inIndex) return { t: 'end' };
        return { t: 'id', name: t.v, pos: t.pos };
      case 'op':
        if (t.v === '(') {
          this.parens++;
          const saved = this.inMatrix;
          this.inMatrix = 0;
          try {
            const e = this.expr();
            this.expectOp(')');
            return e;
          } finally {
            this.parens--;
            this.inMatrix = saved;
          }
        }
        if (t.v === '[') return this.matrix();
        if (t.v === '@') {
          if (this.isOp('(')) {
            this.next();
            const params: string[] = [];
            while (!this.isOp(')')) {
              params.push(this.expectId().v);
              if (this.isOp(',')) this.next();
            }
            this.next();
            const start = this.peek().pos;
            const savedM = this.inMatrix;
            this.inMatrix = 0;
            const body = this.expr();
            this.inMatrix = savedM;
            const end = this.peek().pos;
            return { t: 'lambda', params, body, src: this.src.slice(start, end).trim() };
          }
          return { t: 'handle', name: this.expectId().v };
        }
        break;
    }
    throw new ScriptSyntaxError(t.k === 'eof' ? 'unexpected end of input' : `unexpected '${t.v}'`, t.pos);
  }

  private matrix(): SExpr {
    this.inMatrix++;
    const savedParens = this.parens;
    const savedIndex = this.inIndex;
    this.parens = 0;
    this.inIndex = 0;
    const rows: SExpr[][] = [[]];
    try {
      for (;;) {
        const t = this.peek();
        if (t.k === 'op' && t.v === ']') {
          this.next();
          break;
        }
        if (t.k === 'eof') throw new ScriptSyntaxError(`missing ']'`, t.pos);
        if ((t.k === 'op' && t.v === ';') || t.k === 'nl') {
          this.next();
          if (rows[rows.length - 1].length) rows.push([]);
          continue;
        }
        if (t.k === 'op' && t.v === ',') {
          this.next();
          continue;
        }
        rows[rows.length - 1].push(this.expr());
      }
    } finally {
      this.inMatrix--;
      this.parens = savedParens;
      this.inIndex = savedIndex;
    }
    if (!rows[rows.length - 1].length) rows.pop();
    return { t: 'mat', rows };
  }
}

export function parseScript(src: string): SProgram {
  return new ScriptParser(lexScript(src), src).program();
}