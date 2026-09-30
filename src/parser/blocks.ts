/**
 * MATLAB-style blocks inside worksheet cells. A line that starts with `function`, `script`, `for`,
 * `while`, `if` or `switch` opens a block that runs to its matching `end`; everything else in the
 * cell stays ordinary worksheet language.
 */
import { lexScript, parseScript, ScriptSyntaxError, SProgram, SStmt, SExpr, Tok } from '../runtime/script/parser';

export const BLOCK_OPENERS = new Set(['function', 'script', 'for', 'while', 'if', 'switch']);

export interface BlockSegment {
  from: number;
  to: number;
}

function firstWord(line: string): string {
  return /^\s*([A-Za-z_]\w*)/.exec(line)?.[1] ?? '';
}

/** Net change of block depth over one line (openers at statement starts, `end` outside brackets). */
function depthDelta(line: string, atLineStart: boolean): number {
  let toks: Tok[];
  try {
    toks = lexScript(line);
  } catch {
    return 0;
  }
  let d = 0;
  let paren = 0;
  let stmtStart = true;
  for (const t of toks) {
    if (t.k === 'op' && (t.v === '(' || t.v === '[' || t.v === '{')) paren++;
    else if (t.k === 'op' && (t.v === ')' || t.v === ']' || t.v === '}')) paren = Math.max(0, paren - 1);
    if (t.k === 'id' && paren === 0) {
      if (stmtStart && BLOCK_OPENERS.has(t.v) && (t.v !== 'script' || atLineStart)) d++;
      else if (t.v === 'end') d--;
    }
    stmtStart = t.k === 'nl' || (t.k === 'op' && (t.v === ';' || t.v === ','));
  }
  return d;
}

/** Blocks of a cell source (character ranges covering whole lines). */
export function findBlocks(src: string): BlockSegment[] {
  const out: BlockSegment[] = [];
  const lines = src.split('\n');
  let pos = 0;
  let start = -1;
  let depth = 0;
  for (const line of lines) {
    const lineEnd = pos + line.length;
    if (start < 0) {
      if (BLOCK_OPENERS.has(firstWord(line))) {
        start = pos;
        depth = depthDelta(line, true);
        if (depth <= 0) {
          out.push({ from: start, to: lineEnd });
          start = -1;
          depth = 0;
        }
      }
    } else {
      depth += depthDelta(line, false);
      if (depth <= 0) {
        out.push({ from: start, to: lineEnd });
        start = -1;
        depth = 0;
      }
    }
    pos = lineEnd + 1;
  }
  if (start >= 0) out.push({ from: start, to: src.length });
  return out;
}

/** How many blocks are still open at the end of the text (for Enter in the editor). */
export function openBlocks(src: string): number {
  let depth = 0;
  for (const line of src.split('\n')) {
    if (depth === 0 && !BLOCK_OPENERS.has(firstWord(line))) continue;
    depth += depthDelta(line, depth === 0);
    if (depth < 0) depth = 0;
  }
  return depth;
}

export interface ParsedBlock {
  blockKind: 'function' | 'script' | 'code';
  name?: string;
  program: SProgram;
  /** names read (worksheet dependencies are the ones defined there) */
  reads: string[];
  /** variables a script leaves behind (exported to the worksheet) */
  writes: string[];
  /** offset of the program source inside the cell (for error positions) */
  offset: number;
  body: string;
}

/** Parse a block's text. Throws ScriptSyntaxError with a position relative to the block. */
export function parseBlock(text: string): ParsedBlock {
  const word = firstWord(text);
  if (word === 'script') {
    const m = /^\s*script\b[ \t]*([A-Za-z_]\w*)?[^\n]*\n?/.exec(text)!;
    const name = m[1];
    const rest = text.slice(m[0].length);
    // the closing `end` of the script block
    const endM = /\n?[ \t]*end[ \t;]*(%[^\n]*)?\s*$/.exec(rest);
    if (!endM) throw new ScriptSyntaxError(`missing 'end' for script${name ? ` ${name}` : ''}`, text.length);
    const body = rest.slice(0, endM.index);
    const program = parseAt(body, m[0].length);
    return { blockKind: 'script', name, program, ...usage(program), offset: m[0].length, body };
  }
  const program = parseAt(text, 0);
  if (word === 'function') {
    const f = program.functions[0];
    return { blockKind: 'function', name: f?.name, program, reads: usage(program).reads, writes: [], offset: 0, body: text };
  }
  return { blockKind: 'code', program, reads: usage(program).reads, writes: [], offset: 0, body: text };
}

function parseAt(src: string, offset: number): SProgram {
  try {
    return parseScript(src);
  } catch (e) {
    if (e instanceof ScriptSyntaxError) throw new ScriptSyntaxError(e.message, e.pos + offset);
    throw e;
  }
}

/** Names read and top-level variables written (loop variables and ans are not exported). */
function usage(p: SProgram): { reads: string[]; writes: string[] } {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const loopVars = new Set<string>();
  const expr = (e: SExpr, bound: Set<string>) => {
    switch (e.t) {
      case 'id':
        if (!bound.has(e.name)) reads.add(e.name);
        return;
      case 'bin':
        expr(e.a, bound);
        expr(e.b, bound);
        return;
      case 'un':
      case 'post':
        expr(e.a, bound);
        return;
      case 'range':
        expr(e.a, bound);
        if (e.step) expr(e.step, bound);
        expr(e.b, bound);
        return;
      case 'call':
        expr(e.f, bound);
        e.args.forEach((a) => expr(a, bound));
        return;
      case 'mat':
        e.rows.flat().forEach((a) => expr(a, bound));
        return;
      case 'lambda':
        expr(e.body, new Set([...bound, ...e.params]));
        return;
      case 'field':
        expr(e.a, bound);
        return;
      case 'handle':
        reads.add(e.name);
        return;
      default:
        return;
    }
  };
  const stmts = (body: SStmt[], bound: Set<string>, top: boolean) => {
    for (const s of body) {
      switch (s.t) {
        case 'expr':
          expr(s.e, bound);
          break;
        case 'assign':
          expr(s.e, bound);
          s.index?.forEach((a) => expr(a, bound));
          if (s.index && !bound.has(s.name)) reads.add(s.name);
          bound.add(s.name);
          if (top) writes.add(s.name);
          break;
        case 'multi':
          expr(s.e, bound);
          s.names.forEach((n) => {
            if (n === '~') return;
            bound.add(n);
            if (top) writes.add(n);
          });
          break;
        case 'for':
          expr(s.e, bound);
          bound.add(s.v);
          loopVars.add(s.v);
          stmts(s.body, bound, top);
          break;
        case 'while':
          expr(s.c, bound);
          stmts(s.body, bound, top);
          break;
        case 'if':
          s.branches.forEach((b) => {
            if (b.c) expr(b.c, bound);
            stmts(b.body, bound, top);
          });
          break;
      }
    }
  };
  stmts(p.body, new Set(), true);
  for (const f of p.functions) {
    const bound = new Set([...f.params, ...f.outs, 'nargin']);
    stmts(f.body, bound, false);
  }
  for (const f of p.functions) reads.delete(f.name);
  for (const v of loopVars) writes.delete(v);
  writes.delete('ans');
  return { reads: [...reads], writes: [...writes] };
}