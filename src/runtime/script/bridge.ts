/**
 * Bridge between the script language and the worksheet: worksheet objects become script values
 * (numbers, arrays, callable functions) and script results become typed worksheet objects — lists,
 * matrices, functions (symbolic when an anonymous function is plain arithmetic), text and figures.
 */
import { Expr, num as numE, sym } from '../../math-core/ast';
import { EvalContext, EvalError, getBuiltin } from '../../math-core/builtins';
import { getScalarFunction } from '../../math-core/scalar-functions';
import { FunctionValue, MathValue, scalar, Certainty } from '../../math-core/values';
import { visual } from '../../visualization/scene-model';
import type { ParsedBlock } from '../../parser/blocks';
import { SExpr, SFunction } from './parser';
import { Arr, Fn, SV, ScriptError, isArr, isFn, isObj, toArr, num, simplifyValue } from './values';
import { Interpreter, Figure, Host } from './interp';
import { LIBRARY } from './library';

export interface TextValue {
  kind: 'text';
  text: string;
  [k: string]: unknown;
}

export interface ScriptValue {
  kind: 'script';
  name?: string;
  output: string[];
  figures: Figure[];
  vars: Record<string, MathValue>;
  exports: string[];
  usedRandom: boolean;
  [k: string]: unknown;
}

/** A worksheet function as a script function (element-wise over arrays). */
function callable(f: FunctionValue): Fn {
  const ev = f.eval as (...a: number[]) => number | number[];
  return {
    t: 'fn',
    name: f.label ?? 'f',
    call(args) {
      const arrs = args.map((a) => toArr(a));
      const n = Math.max(1, ...arrs.map((a) => a.n));
      const shape = arrs.find((a) => a.n === n) ?? arrs[0];
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const v = ev(...arrs.map((a) => (a.n === 1 ? a.d[0] : a.d[i])));
        if (Array.isArray(v)) {
          if (n === 1) return [Arr.col(v)];
          throw new ScriptError('vector-valued functions take one point at a time');
        }
        out.push(v);
      }
      return [simplifyValue(shape ? new Arr(shape.r, shape.c, Float64Array.from(out)) : out[0])];
    },
  };
}

export function toSV(v: MathValue, host?: Host): SV {
  // a worksheet function block keeps its MATLAB semantics inside scripts (handles, arrays, several outputs)
  const sf = (v as { scriptFn?: { fn: SFunction; functions: SFunction[] } }).scriptFn;
  if (v.kind === 'function' && sf && host) {
    return {
      t: 'fn',
      name: sf.fn.name,
      call(args, nout) {
        const it = new Interpreter(host);
        for (const g of sf.functions) it.functions.set(g.name, g);
        return it.callFunction(sf.fn, args, nout);
      },
    };
  }
  switch (v.kind) {
    case 'scalar':
      return (v as { value: number }).value;
    case 'bool':
      return (v as { value: boolean }).value ? 1 : 0;
    case 'list': {
      const items = (v as { items: MathValue[] }).items;
      if (items.every((x) => x.kind === 'scalar')) return Arr.row(items.map((x) => (x as { value: number }).value));
      return { t: 'obj', value: v };
    }
    case 'vector':
      return Arr.col((v as { comps: number[] }).comps);
    case 'point':
      return { t: 'obj', value: v };
    case 'matrix':
      return Arr.fromRows((v as { rows: number[][] }).rows);
    case 'text':
      return (v as unknown as TextValue).text;
    case 'function':
      return callable(v as FunctionValue);
    default:
      return { t: 'obj', value: v };
  }
}

const MATLAB_TO_MLL: Record<string, string> = { log: 'ln', log10: 'log10', log2: 'log2', asin: 'asin', acos: 'acos', atan: 'atan' };

/** An anonymous function body in plain arithmetic → a worksheet expression (null otherwise). */
export function sexprToExpr(e: SExpr, params: string[], captured: Map<string, SV>): Expr | null {
  const go = (x: SExpr): Expr | null => {
    switch (x.t) {
      case 'num':
        return numE(x.v);
      case 'id': {
        if (params.includes(x.name)) return sym(x.name);
        const c = captured.get(x.name);
        if (typeof c === 'number') return numE(c);
        if (x.name === 'pi') return sym('π');
        if (x.name === 'e' && c === undefined) return sym('e');
        return null;
      }
      case 'un':
        if (x.op !== '-') return null;
        {
          const a = go(x.a);
          return a && { type: 'neg', arg: a };
        }
      case 'bin': {
        const op = ({ '+': '+', '-': '-', '*': '*', '.*': '*', '/': '/', './': '/', '^': '^', '.^': '^' } as Record<string, '+' | '-' | '*' | '/' | '^'>)[x.op];
        if (!op) return null;
        const a = go(x.a);
        const b = go(x.b);
        return a && b ? { type: 'bin', op, left: a, right: b } : null;
      }
      case 'call': {
        if (x.f.t !== 'id') return null;
        const name = MATLAB_TO_MLL[x.f.name] ?? x.f.name;
        if (!getScalarFunction(name)) return null;
        const args = x.args.map(go);
        return args.every(Boolean) ? { type: 'call', callee: sym(name), args: args as Expr[] } : null;
      }
      default:
        return null;
    }
  };
  return go(e);
}

export function fromSV(v: SV, ctx: EvalContext, meta: { certainty?: Certainty; evidence?: string } = {}): MathValue {
  if (typeof v === 'number') return scalar(v, meta);
  if (typeof v === 'string') return { kind: 'text', text: v } as unknown as MathValue;
  if (isArr(v)) {
    if (v.n === 1) return scalar(v.d[0], meta);
    if (v.r === 1 || v.c === 1 || v.n === 0) return { kind: 'list', items: Array.from(v.d, (x) => scalar(x)), ...meta } as unknown as MathValue;
    return { kind: 'matrix', rows: v.rows(), ...meta } as unknown as MathValue;
  }
  if (isFn(v)) {
    if (v.lambda) {
      const ex = sexprToExpr(v.lambda.body, v.lambda.params, v.lambda.captured);
      if (ex) {
        try {
          return { ...ctx.makeFunction(ex, v.lambda.params), certainty: 'exact' } as MathValue;
        } catch {
          /* fall through to a numeric function */
        }
      }
    }
    const params = v.lambda?.params ?? ['x'];
    return {
      kind: 'function', params, out: 'scalar', key: `script-fn|${Math.random()}`, env: {}, label: v.name === 'anonymous' ? undefined : v.name,
      eval: ((...xs: number[]) => num(v.call(xs, 1)[0])) as FunctionValue['eval'],
    } as unknown as MathValue;
  }
  return (v as { value: MathValue }).value;
}

const ALIASES: Record<string, string> = { eig: 'eigenvalues', null: 'nullspace', orth: 'columnspace' };

export function hostFor(ctx: EvalContext): Host {
  const host: Host = {
    lookup(name) {
      const v = ctx.lookup(name);
      return v ? toSV(v, host) : undefined;
    },
    callBuiltin(name, args) {
      const b = getBuiltin(ALIASES[name] ?? name);
      if (!b || args.length < b.minArgs || args.length > b.maxArgs) return undefined;
      try {
        const res = b.apply(args.map((a) => fromSV(a, ctx)), ctx, [], { values: {}, raw: {} });
        return toSV(res);
      } catch (e) {
        if (e instanceof EvalError) throw new ScriptError(`${name}: ${e.message}`);
        throw e;
      }
    },
  };
  return host;
}

function lineOf(text: string, pos: number | undefined): string {
  if (pos === undefined) return '';
  return `line ${text.slice(0, pos).split('\n').length}: `;
}

/** Run a script / code block: output, figures and the variables it leaves behind. */
export function runScript(block: ParsedBlock, ctx: EvalContext): ScriptValue {
  const it = new Interpreter(hostFor(ctx));
  try {
    it.run(block.program);
  } catch (e) {
    if (e instanceof ScriptError) throw new EvalError(`${lineOf(block.body, e.pos)}${e.message}`);
    throw e;
  }
  // variables that depend on random numbers are evidence (a seeded simulation); the rest are computed
  const random = { certainty: 'heuristic' as Certainty, evidence: 'simulation with seeded random numbers (rng) — an estimate, not a proof' };
  const computed = { certainty: 'numeric' as Certainty, evidence: `computed by script ${block.name ?? ''}`.trim() };
  const vars: Record<string, MathValue> = {};
  for (const w of block.writes) {
    const v = it.vars.get(w);
    if (v !== undefined) vars[w] = fromSV(v, ctx, it.tainted.has(w) ? random : computed);
  }
  return {
    kind: 'script',
    name: block.name,
    output: it.output,
    figures: it.figures,
    vars,
    exports: block.writes,
    usedRandom: it.usedRandom,
    visuals: it.figures.filter((f) => f.series.length).map((f, i) => visual('figure', { figure: f }, f.title ?? `figure ${i + 1}`, 'figure')),
  };
}

/** A function block as a worksheet function: symbolic when its body is one assignment of plain arithmetic. */
export function functionOf(block: ParsedBlock, ctx: EvalContext): FunctionValue {
  const f = block.program.functions[0];
  if (!f) throw new EvalError('empty function block');
  if (f.body.length === 1 && f.body[0].t === 'assign' && !f.body[0].index && f.outs.length === 1 && f.body[0].name === f.outs[0]) {
    const ex = sexprToExpr(f.body[0].e, f.params, new Map());
    if (ex) {
      try {
        return { ...ctx.makeFunction(ex, f.params, { label: f.name }), certainty: 'exact', scriptFn: { fn: f, functions: block.program.functions } } as FunctionValue;
      } catch {
        /* numeric below */
      }
    }
  }
  const host = hostFor(ctx);
  const scriptFn = { fn: f, functions: block.program.functions };
  const evalFn = (...xs: number[]) => {
    const it = new Interpreter(host);
    for (const g of block.program.functions) it.functions.set(g.name, g);
    try {
      return num(it.callFunction(f, xs, 1)[0], `${f.name} to return a number`);
    } catch (e) {
      if (e instanceof ScriptError) return NaN;
      throw e;
    }
  };
  return { kind: 'function', params: f.params, out: 'scalar', key: `script-function|${f.name}|${block.body}`, env: {}, label: f.name, eval: evalFn as FunctionValue['eval'], role: 'script-function', scriptFn } as unknown as FunctionValue;
}

export { LIBRARY, isObj };