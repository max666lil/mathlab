/**
 * MLL lexer. Unicode-aware: Greek identifiers, π, ·, ×, ∇, ∈, ⟨ ⟩ and superscript powers
 * (x² → x ^ 2). Comments start with `#` or `//`.
 */

export type TokKind = 'num' | 'ident' | 'op' | 'newline' | 'eof';

export interface Token {
  kind: TokKind;
  text: string;
  value?: number;
  from: number;
  to: number;
  /** true when whitespace immediately precedes the token */
  spaced: boolean;
}

export class MathSyntaxError extends Error {
  constructor(
    message: string,
    public from: number,
    public to: number,
  ) {
    super(message);
  }
}

const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-',
};

const MULTI_OPS = ['<=', '>=', '**', '->'];
const SINGLE_OPS = '+-*/^()[]{},=<>.:;|·×∇∈⟨⟩~';

const isDigit = (c: string) => c >= '0' && c <= '9';
const isIdentStart = (c: string) => /[\p{L}_]/u.test(c) && !(c in SUPERSCRIPTS) && c !== '∇' && c !== '∈';
const isIdentPart = (c: string) => isIdentStart(c) || isDigit(c) || c === "'";

export function lex(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  let spaced = false;
  const push = (kind: TokKind, text: string, from: number, to: number, value?: number) => {
    toks.push({ kind, text, from, to, value, spaced });
    spaced = false;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      push('newline', '\n', i, i + 1);
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      spaced = true;
      i++;
      continue;
    }
    if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      const start = i;
      while (isDigit(src[i] ?? '')) i++;
      if (src[i] === '.' && isDigit(src[i + 1] ?? '')) {
        i++;
        while (isDigit(src[i] ?? '')) i++;
      } else if (src[i] === '.' && !isIdentStart(src[i + 1] ?? '') && src[i + 1] !== '.') {
        i++; // "2." is a number
      }
      if ((src[i] === 'e' || src[i] === 'E') && (isDigit(src[i + 1] ?? '') || ((src[i + 1] === '-' || src[i + 1] === '+') && isDigit(src[i + 2] ?? '')))) {
        i += 2;
        while (isDigit(src[i] ?? '')) i++;
      }
      const text = src.slice(start, i);
      push('num', text, start, i, parseFloat(text));
      continue;
    }
    if (c in SUPERSCRIPTS) {
      const start = i;
      let digits = '';
      while (i < src.length && src[i] in SUPERSCRIPTS) digits += SUPERSCRIPTS[src[i++]];
      push('op', '^', start, start);
      spaced = false;
      if (digits.startsWith('-')) {
        push('op', '-', start, start + 1);
        digits = digits.slice(1);
      }
      push('num', digits, start, i, parseFloat(digits));
      continue;
    }
    if (c === '∞') {
      push('ident', '∞', i, i + 1);
      i++;
      continue;
    }
    if (isIdentStart(c)) {
      const start = i;
      i++;
      while (i < src.length && isIdentPart(src[i])) i++;
      const text = src.slice(start, i);
      if (text === 'π' || text === 'pi') push('ident', 'π', start, i);
      else push('ident', text, start, i);
      continue;
    }
    const two = src.slice(i, i + 2);
    if (MULTI_OPS.includes(two)) {
      push('op', two === '**' ? '^' : two, i, i + 2);
      i += 2;
      continue;
    }
    if (SINGLE_OPS.includes(c)) {
      let text = c;
      if (c === '⟨') text = '<';
      if (c === '⟩') text = '>';
      push('op', text, i, i + 1);
      i++;
      continue;
    }
    throw new MathSyntaxError(`Unexpected character '${c}'`, i, i + 1);
  }
  push('eof', '', src.length, src.length);
  return toks;
}
