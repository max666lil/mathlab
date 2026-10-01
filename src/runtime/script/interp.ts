/**
 * Interpreter of the script language: tree walking over the parsed program, with MATLAB semantics
 * for arrays (implicit expansion, 1-based column-major indexing, growth on assignment), a step
 * budget, a seeded random number generator, captured output and figures.
 */
import { SExpr, SStmt, SProgram, SFunction } from './parser';
import { Arr, Fn, SV, ScriptError, isArr, isFn, isObj, toArr, simplifyValue, num, truthy, display } from './values';
import { LIBRARY } from './library';

export interface Series {
  type: 'line' | 'scatter' | 'bar' | 'stairs';
  x: number[];
  y: number[];
  width?: number;
  label?: string;
  style?: string;
}
export interface Figure {
  series: Series[];
  title?: string;
  xlabel?: string;
  ylabel?: string;
}

/** What a script can see of the worksheet. */
export interface Host {
  lookup(name: string): SV | undefined;
  /** MLL builtins (det, eigenvalues, integrate …) called with script values */
  callBuiltin?(name: string, args: SV[]): SV | undefined;
}

class Break {}
class Continue {}
class Return {}

/** Seeded generator (mulberry32) so re-evaluating a script reproduces its random numbers. */
export class Rng {
  private s: number;
  private spare: number | null = null;
  constructor(seed = 0) {
    this.s = seed >>> 0;
  }
  seed(n: number) {
    this.s = (Math.floor(n) * 2654435761) >>> 0;
    this.spare = null;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  normal(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const rad = Math.sqrt(-2 * Math.log(u));
    this.spare = rad * Math.sin(2 * Math.PI * v);
    return rad * Math.cos(2 * Math.PI * v);
  }
}

export const DEFAULT_BUDGET = 5_000_000;
const RANDOM = new Set(['rand', 'randn', 'randi', 'randperm']);

export class Interpreter {
  vars = new Map<string, SV>();
  functions = new Map<string, SFunction>();
  output: string[] = [];
  figures: Figure[] = [];
  holdOn = true;
  rng = new Rng(0);
  usedRandom = false;
  /** variables whose value depends on random numbers (directly, through data, or through control flow) */
  tainted = new Set<string>();
  private taintDepth = 0;
  private steps = 0;
  /** stack of (array, dimension, number of dims) for `end` inside indices */
  private endCtx: { a: Arr | string; dim: number; ndims: number }[] = [];

  constructor(private host: Host, private budget = DEFAULT_BUDGET) {}

  tick(k = 1) {
    this.steps += k;
    if (this.steps > this.budget) throw new ScriptError(`script stopped after ${this.budget.toLocaleString()} steps (an endless loop?)`);
  }

  /** text written by disp / fprintf: complete lines go to the output, the rest waits for its newline */
  private pending = '';
  write(text: string) {
    const parts = (this.pending + text).split('\n');
    this.pending = parts.pop()!;
    this.output.push(...parts);
  }
  flush() {
    if (this.pending) this.output.push(this.pending);
    this.pending = '';
  }

  figure(): Figure {
    if (!this.figures.length) this.figures.push({ series: [] });
    return this.figures[this.figures.length - 1];
  }

  run(p: SProgram) {
    for (const f of p.functions) this.functions.set(f.name, f);
    try {
      this.exec(p.body);
    } catch (e) {
      if (e instanceof Return) return;
      if (e instanceof Break || e instanceof Continue) throw new ScriptError('break / continue outside a loop');
      throw e;
    } finally {
      this.flush();
    }
  }

  exec(body: SStmt[]) {
    for (const s of body) this.stmt(s);
  }

  private stmt(s: SStmt) {
    this.tick();
    try {
      switch (s.t) {
        case 'expr': {
          const v = this.evalMulti(s.e, 0)[0];
          if (v !== undefined && !s.quiet) {
            const nm = s.e.t === 'id' && this.vars.has(s.e.name) ? s.e.name : 'ans';
            this.flush();
            this.output.push(...display(nm, v));
          }
          if (v !== undefined && !(s.e.t === 'id' && this.vars.has(s.e.name))) this.vars.set('ans', v);
          return;
        }
        case 'assign': {
          const before = this.usedRandom;
          this.usedRandom = false;
          const v = this.eval(s.e);
          const random = this.usedRandom || this.exprTainted(s.e) || (s.index?.some((x) => this.exprTainted(x)) ?? false) || this.taintDepth > 0;
          this.usedRandom = before || this.usedRandom;
          if (random) this.tainted.add(s.name);
          else if (!s.index) this.tainted.delete(s.name);
          if (s.index) this.vars.set(s.name, this.assignIndex(this.vars.get(s.name), s.index, v, s.name));
          else this.vars.set(s.name, v);
          if (!s.quiet) this.output.push(...display(s.name, this.vars.get(s.name)!));
          return;
        }
        case 'multi': {
          const before = this.usedRandom;
          this.usedRandom = false;
          const vs = this.evalMulti(s.e, s.names.length);
          const random = this.usedRandom || this.exprTainted(s.e) || this.taintDepth > 0;
          this.usedRandom = before || this.usedRandom;
          for (const n of s.names) if (random) this.tainted.add(n);
          s.names.forEach((n, i) => {
            if (n === '~') return;
            if (vs[i] === undefined) throw new ScriptError('too many outputs requested');
            this.vars.set(n, vs[i]);
            if (!s.quiet) this.output.push(...display(n, vs[i]));
          });
          return;
        }
        case 'for': {
          const a = toArr(this.eval(s.e));
          const t = this.exprTainted(s.e);
          if (t) this.taintDepth++;
          try {
          // iterate over columns (a row vector gives its elements)
          for (let j = 0; j < a.c; j++) {
            this.tick();
            const col = a.r === 1 ? a.d[j] : new Arr(a.r, 1, a.d.slice(j * a.r, (j + 1) * a.r));
            this.vars.set(s.v, col);
            try {
              this.exec(s.body);
            } catch (e) {
              if (e instanceof Break) break;
              if (e instanceof Continue) continue;
              throw e;
            }
          }
          } finally {
            if (t) this.taintDepth--;
          }
          return;
        }
        case 'while': {
          // a condition that depends on random numbers makes everything assigned in the loop random
          let raised = 0;
          try {
            for (;;) {
              if (this.exprTainted(s.c) && !raised) {
                raised = 1;
                this.taintDepth++;
              }
              if (!truthy(this.eval(s.c))) break;
              this.tick();
              try {
                this.exec(s.body);
              } catch (e) {
                if (e instanceof Break) break;
                if (e instanceof Continue) continue;
                throw e;
              }
            }
          } finally {
            this.taintDepth -= raised;
          }
          return;
        }
        case 'if': {
          let raised = 0;
          try {
            for (const b of s.branches) {
              if (b.c && this.exprTainted(b.c) && !raised) {
                raised = 1;
                this.taintDepth++;
              }
              if (b.c === null || truthy(this.eval(b.c))) {
                this.exec(b.body);
                return;
              }
            }
          } finally {
            this.taintDepth -= raised;
          }
          return;
        }
        case 'break':
          throw new Break();
        case 'continue':
          throw new Continue();
        case 'return':
          throw new Return();
        case 'command':
          if (s.name === 'hold') this.holdOn = s.args[0] !== 'off';
          else if (s.name === 'figure') this.figures.push({ series: [] });
          else if (s.name === 'clc') this.output = [];
          return;
      }
    } catch (e) {
      if (e instanceof ScriptError && e.pos === undefined) e.pos = s.pos;
      throw e;
    }
  }

  /** Does the expression read a random variable (or call a random generator / a function that uses one)? */
  exprTainted(e: SExpr): boolean {
    switch (e.t) {
      case 'id':
        return this.tainted.has(e.name) || RANDOM.has(e.name);
      case 'bin':
        return this.exprTainted(e.a) || this.exprTainted(e.b);
      case 'un':
      case 'post':
      case 'field':
        return this.exprTainted(e.a);
      case 'range':
        return this.exprTainted(e.a) || this.exprTainted(e.b) || (!!e.step && this.exprTainted(e.step));
      case 'call':
        return this.exprTainted(e.f) || e.args.some((a) => this.exprTainted(a));
      case 'mat':
        return e.rows.some((r) => r.some((a) => this.exprTainted(a)));
      case 'lambda':
        return this.exprTainted(e.body);
      default:
        return false;
    }
  }

  eval(e: SExpr): SV {
    const v = this.evalMulti(e, 1)[0];
    if (v === undefined) throw new ScriptError('this expression has no value');
    return v;
  }

  /** Evaluate, allowing function calls to return several outputs. */
  evalMulti(e: SExpr, nout: number): SV[] {
    switch (e.t) {
      case 'num':
        return [e.v];
      case 'str':
        return [e.v];
      case 'id':
        return this.name(e.name, [], nout, e.pos);
      case 'mat':
        return [this.matrix(e.rows)];
      case 'bin':
        return [this.binary(e.op, e.a, e.b)];
      case 'un': {
        const a = this.eval(e.a);
        return [e.op === '-' ? ew(a, -1, (x, y) => x * y) : logicalNot(a)];
      }
      case 'post':
        return [transpose(this.eval(e.a))];
      case 'range': {
        const a = num(this.eval(e.a), 'a number in a range');
        const step = e.step ? num(this.eval(e.step), 'a number in a range') : 1;
        const b = num(this.eval(e.b), 'a number in a range');
        return [rangeArr(a, step, b)];
      }
      case 'call':
        return this.call(e, nout);
      case 'colon':
        throw new ScriptError("':' only inside an index");
      case 'end': {
        const c = this.endCtx[this.endCtx.length - 1];
        if (!c) throw new ScriptError("'end' only inside an index");
        const len = typeof c.a === 'string' ? c.a.length : c.a.n;
        if (c.ndims === 1) return [len];
        return [c.dim === 0 ? (c.a as Arr).r : (c.a as Arr).c];
      }
      case 'lambda': {
        const captured = new Map(this.vars);
        const self = this;
        const fn: Fn = {
          t: 'fn',
          name: 'anonymous',
          lambda: { params: e.params, body: e.body, captured },
          call(args) {
            const saved = self.vars;
            self.vars = new Map(captured);
            e.params.forEach((p, i) => self.vars.set(p, args[i] ?? 0));
            try {
              return [self.eval(e.body)];
            } finally {
              self.vars = saved;
            }
          },
        };
        return [fn];
      }
      case 'handle':
        return [this.handle(e.name)];
      case 'field': {
        const a = this.eval(e.a);
        const k = ({ x: 0, y: 1, z: 2 } as Record<string, number>)[e.name];
        if (isObj(a)) {
          const v = a.value as unknown as Record<string, unknown>;
          const coords = (v.coords ?? v.comps) as number[] | undefined;
          if (coords && k !== undefined) return [coords[k]];
          if (typeof v[e.name] === 'number') return [v[e.name] as number];
        }
        if (isArr(a) && a.isVector() && k !== undefined && k < a.n) return [a.d[k]];
        throw new ScriptError(`no field '${e.name}'`);
      }
    }
  }

  private handle(name: string): Fn {
    return { t: 'fn', name, call: (args, nout) => this.callNamed(name, args, nout, undefined) };
  }

  /** A bare name: a variable, or a function called with no arguments. */
  private name(n: string, args: SV[], nout: number, pos?: number): SV[] {
    if (this.vars.has(n)) return [this.vars.get(n)!];
    return this.callNamed(n, args, nout, pos);
  }

  private call(e: Extract<SExpr, { t: 'call' }>, nout: number): SV[] {
    // x(…) on a variable: indexing (or calling a function handle)
    if (e.f.t === 'id' && this.vars.has(e.f.name)) {
      const target = this.vars.get(e.f.name)!;
      if (isFn(target)) return target.call(e.args.map((a) => this.eval(a)), nout);
      return [this.index(target, e.args)];
    }
    if (e.f.t === 'id') return this.callNamed(e.f.name, e.args.map((a) => this.eval(a)), nout, e.pos);
    const f = this.eval(e.f);
    if (isFn(f)) return f.call(e.args.map((a) => this.eval(a)), nout);
    return [this.index(f, e.args)];
  }

  callNamed(name: string, args: SV[], nout: number, pos?: number): SV[] {
    this.tick();
    const local = this.functions.get(name);
    if (local) return this.callFunction(local, args, nout);
    // worksheet objects shadow library functions (a user's euler(…) wins over the built-in one)
    const w = this.host.lookup(name);
    if (w !== undefined) {
      if (isFn(w)) return w.call(args, nout);
      if (!args.length) return [w];
      return [getIndex(toArr(w, 'an array to index'), args)];
    }
    const lib = LIBRARY[name];
    if (lib) return lib(args, Math.max(1, nout), this);
    const b = this.host.callBuiltin?.(name, args);
    if (b !== undefined) return [b];
    throw new ScriptError(`undefined name '${name}'`, pos);
  }

  callFunction(f: SFunction, args: SV[], nout: number): SV[] {
    if (args.length > f.params.length) throw new ScriptError(`${f.name} takes ${f.params.length} argument(s)`);
    const saved = this.vars;
    this.vars = new Map();
    f.params.forEach((p, i) => {
      if (i < args.length) this.vars.set(p, args[i]);
    });
    this.vars.set('nargin', args.length);
    try {
      try {
        this.exec(f.body);
      } catch (e) {
        if (!(e instanceof Return)) throw e;
      }
      return f.outs.slice(0, Math.max(1, nout)).map((o) => {
        const v = this.vars.get(o);
        if (v === undefined) throw new ScriptError(`${f.name}: output '${o}' was never assigned`);
        return v;
      });
    } finally {
      this.vars = saved;
    }
  }

  // ---------------------------------------------------------------- arrays

  private matrix(rows: SExpr[][]): SV {
    const blocks = rows.map((r) => r.map((e) => this.eval(e)));
    // strings concatenate as text
    if (blocks.length === 1 && blocks[0].length && blocks[0].every((b) => typeof b === 'string')) return (blocks[0] as string[]).join('');
    return simplifyValue(vcat(blocks.map((r) => hcat(r.map((v) => toArr(v))))));
  }

  private binary(op: string, ea: SExpr, eb: SExpr): SV {
    if (op === '&&' || op === '||') {
      const a = truthy(this.eval(ea));
      if (op === '&&' && !a) return 0;
      if (op === '||' && a) return 1;
      return truthy(this.eval(eb)) ? 1 : 0;
    }
    const a = this.eval(ea);
    const b = this.eval(eb);
    this.tick(isArr(a) ? a.n : 1);
    return binaryOp(op, a, b);
  }

  index(target: SV, argsE: SExpr[]): SV {
    const a = typeof target === 'string' ? target : toArr(target, 'an array to index');
    const idx = argsE.map((e, k) => {
      this.endCtx.push({ a, dim: k, ndims: argsE.length });
      try {
        return e.t === 'colon' ? (':' as const) : this.eval(e);
      } finally {
        this.endCtx.pop();
      }
    });
    if (typeof a === 'string') {
      const pos = idx.length === 1 && idx[0] !== ':' ? positions(idx[0], a.length) : [...a].map((_, i) => i);
      return pos.map((i) => a[i]).join('');
    }
    return getIndex(a, idx);
  }

  private assignIndex(cur: SV | undefined, idxE: SExpr[], v: SV, name: string): SV {
    const a = cur === undefined ? Arr.zeros(0, 0) : toArr(cur, `${name} to be an array`);
    const idx = idxE.map((e, k) => {
      this.endCtx.push({ a, dim: k, ndims: idxE.length });
      try {
        return e.t === 'colon' ? (':' as const) : this.eval(e);
      } finally {
        this.endCtx.pop();
      }
    });
    return simplifyValue(setIndex(a, idx, v));
  }
}

// ------------------------------------------------------------------ array operations

export function rangeArr(a: number, step: number, b: number): Arr {
  if (step === 0 || (step > 0 && a > b) || (step < 0 && a < b)) return Arr.zeros(1, 0);
  const n = Math.floor((b - a) / step + 1e-10) + 1;
  if (n > 5e7) throw new ScriptError('range too large');
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = a + i * step;
  return new Arr(1, n, d);
}

function hcat(parts: Arr[]): Arr {
  const ps = parts.filter((p) => p.n > 0);
  if (!ps.length) return Arr.zeros(0, 0);
  const rows = ps[0].r;
  if (ps.some((p) => p.r !== rows)) throw new ScriptError('horizontal concatenation: rows do not match');
  const cols = ps.reduce((s, p) => s + p.c, 0);
  const out = Arr.zeros(rows, cols);
  let off = 0;
  for (const p of ps) {
    out.d.set(p.d, off * rows);
    off += p.c;
  }
  return out;
}

function vcat(parts: Arr[]): Arr {
  const ps = parts.filter((p) => p.n > 0);
  if (!ps.length) return Arr.zeros(0, 0);
  const cols = ps[0].c;
  if (ps.some((p) => p.c !== cols)) throw new ScriptError('vertical concatenation: columns do not match');
  const rows = ps.reduce((s, p) => s + p.r, 0);
  const out = Arr.zeros(rows, cols);
  let off = 0;
  for (const p of ps) {
    for (let j = 0; j < cols; j++) for (let i = 0; i < p.r; i++) out.d[off + i + j * rows] = p.d[i + j * p.r];
    off += p.r;
  }
  return out;
}

export function transpose(v: SV): SV {
  if (typeof v === 'number') return v;
  const a = toArr(v);
  const out = Arr.zeros(a.c, a.r);
  for (let i = 0; i < a.r; i++) for (let j = 0; j < a.c; j++) out.d[j + i * a.c] = a.d[i + j * a.r];
  return out;
}

/** Element-wise operation with MATLAB implicit expansion. */
export function ew(a: SV, b: SV, f: (x: number, y: number) => number, logical = false): SV {
  if (typeof a === 'number' && typeof b === 'number') return f(a, b);
  const A = toArr(a);
  const B = toArr(b);
  const rows = A.r === B.r ? A.r : A.r === 1 ? B.r : B.r === 1 ? A.r : -1;
  const cols = A.c === B.c ? A.c : A.c === 1 ? B.c : B.c === 1 ? A.c : -1;
  if (rows < 0 || cols < 0) throw new ScriptError(`sizes do not match: ${A.r}×${A.c} and ${B.r}×${B.c}`);
  const out = Arr.zeros(rows, cols);
  for (let j = 0; j < cols; j++)
    for (let i = 0; i < rows; i++) out.d[i + j * rows] = f(A.d[(A.r === 1 ? 0 : i) + (A.c === 1 ? 0 : j) * A.r], B.d[(B.r === 1 ? 0 : i) + (B.c === 1 ? 0 : j) * B.r]);
  out.logical = logical;
  return out;
}

function logicalNot(a: SV): SV {
  return ew(a, 0, (x) => (x === 0 ? 1 : 0), true);
}

function matmul(a: SV, b: SV): SV {
  if (typeof a === 'number' || typeof b === 'number' || toArr(a).n === 1 || toArr(b).n === 1) return ew(a, b, (x, y) => x * y);
  const A = toArr(a);
  const B = toArr(b);
  if (A.c !== B.r) throw new ScriptError(`inner dimensions do not match: ${A.r}×${A.c} times ${B.r}×${B.c} (use .* for element-wise)`);
  const out = Arr.zeros(A.r, B.c);
  for (let i = 0; i < A.r; i++)
    for (let j = 0; j < B.c; j++) {
      let s = 0;
      for (let k = 0; k < A.c; k++) s += A.d[i + k * A.r] * B.d[k + j * B.r];
      out.d[i + j * A.r] = s;
    }
  return simplifyValue(out);
}

/** A \ b by Gaussian elimination with partial pivoting (square A). */
export function solve(a: SV, b: SV): SV {
  const A = toArr(a).rows();
  const Bm = toArr(b);
  const n = A.length;
  if (!n || A[0].length !== n) throw new ScriptError('A \\ b needs a square matrix A');
  if (Bm.r !== n) throw new ScriptError('A \\ b: rows of b must match A');
  const M = A.map((row, i) => [...row, ...Array.from({ length: Bm.c }, (_, j) => Bm.get(i, j))]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (Math.abs(M[p][k]) < 1e-14) throw new ScriptError('matrix is singular');
    [M[k], M[p]] = [M[p], M[k]];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      for (let j = k; j < M[i].length; j++) M[i][j] -= f * M[k][j];
    }
  }
  const X = Arr.zeros(n, Bm.c);
  for (let j = 0; j < Bm.c; j++)
    for (let i = n - 1; i >= 0; i--) {
      let s = M[i][n + j];
      for (let k = i + 1; k < n; k++) s -= M[i][k] * X.d[k + j * n];
      X.d[i + j * n] = s / M[i][i];
    }
  return simplifyValue(X);
}

function mpower(a: SV, b: SV): SV {
  if (typeof a === 'number' && typeof b === 'number') return Math.pow(a, b);
  const A = toArr(a);
  if (A.n === 1) return ew(a, b, Math.pow);
  const k = num(b, 'an integer power');
  if (A.r !== A.c || !Number.isInteger(k) || k < 0) throw new ScriptError('A^k needs a square matrix and a whole number k ≥ 0 (use .^ for element-wise)');
  let R: SV = Arr.fromRows(Array.from({ length: A.r }, (_, i) => Array.from({ length: A.r }, (_, j) => (i === j ? 1 : 0))));
  for (let i = 0; i < k; i++) R = matmul(R, A);
  return R;
}

export function binaryOp(op: string, a: SV, b: SV): SV {
  if (typeof a === 'string' && typeof b === 'string' && (op === '==' || op === '~=')) return (a === b) === (op === '==') ? 1 : 0;
  switch (op) {
    case '+':
      return ew(a, b, (x, y) => x + y);
    case '-':
      return ew(a, b, (x, y) => x - y);
    case '.*':
      return ew(a, b, (x, y) => x * y);
    case './':
      return ew(a, b, (x, y) => x / y);
    case '.^':
      return ew(a, b, Math.pow);
    case '*':
      return matmul(a, b);
    case '/':
      if (typeof b === 'number' || toArr(b).n === 1) return ew(a, b, (x, y) => x / y);
      throw new ScriptError('matrix right division A/B is not supported — use ./ or A * inv(B)');
    case '\\':
      return solve(a, b);
    case '^':
      return mpower(a, b);
    case '==':
      return ew(a, b, (x, y) => (x === y ? 1 : 0), true);
    case '~=':
      return ew(a, b, (x, y) => (x !== y ? 1 : 0), true);
    case '<':
      return ew(a, b, (x, y) => (x < y ? 1 : 0), true);
    case '<=':
      return ew(a, b, (x, y) => (x <= y ? 1 : 0), true);
    case '>':
      return ew(a, b, (x, y) => (x > y ? 1 : 0), true);
    case '>=':
      return ew(a, b, (x, y) => (x >= y ? 1 : 0), true);
    case '&':
      return ew(a, b, (x, y) => (x !== 0 && y !== 0 ? 1 : 0), true);
    case '|':
      return ew(a, b, (x, y) => (x !== 0 || y !== 0 ? 1 : 0), true);
  }
  throw new ScriptError(`unknown operator ${op}`);
}

/** 1-based index values (or a logical mask) → 0-based positions. */
function positions(v: SV | ':', len: number): number[] {
  if (v === ':') return Array.from({ length: len }, (_, i) => i);
  const a = toArr(v, 'an index');
  if (a.logical) {
    const out: number[] = [];
    for (let i = 0; i < a.n; i++) if (a.d[i] !== 0) out.push(i);
    return out;
  }
  return Array.from(a.d, (x) => {
    if (!Number.isInteger(x) || x < 1) throw new ScriptError(`index must be a positive whole number, got ${x}`);
    return x - 1;
  });
}

export function getIndex(a: Arr, idx: (SV | ':')[]): SV {
  if (idx.length === 1) {
    const pos = positions(idx[0], a.n);
    for (const p of pos) if (p >= a.n) throw new ScriptError(`index ${p + 1} exceeds the ${a.n} elements`);
    const vals = pos.map((p) => a.d[p]);
    // result orientation: a row stays a row; A(:) is a column
    const I = idx[0];
    const rowShape = I !== ':' && (a.r === 1 || (a.c !== 1 && isArr(I) && I.r === 1 && !I.logical));
    return simplifyValue(rowShape ? Arr.row(vals) : Arr.col(vals));
  }
  if (idx.length === 2) {
    const rowIx = positions(idx[0], a.r);
    const colIx = positions(idx[1], a.c);
    for (const p of rowIx) if (p >= a.r) throw new ScriptError(`row index ${p + 1} exceeds ${a.r} rows`);
    for (const p of colIx) if (p >= a.c) throw new ScriptError(`column index ${p + 1} exceeds ${a.c} columns`);
    const out = Arr.zeros(rowIx.length, colIx.length);
    colIx.forEach((cIdx, j) => rowIx.forEach((rIdx, i) => (out.d[i + j * rowIx.length] = a.d[rIdx + cIdx * a.r])));
    return simplifyValue(out);
  }
  throw new ScriptError('only 1 or 2 indices are supported');
}

export function setIndex(a0: Arr, idx: (SV | ':')[], v: SV): Arr {
  const val = toArr(v);
  // removal: A(i) = []
  if (val.n === 0 && isArr(v)) {
    if (idx.length === 1) {
      const drop = new Set(positions(idx[0], a0.n));
      const keep = Array.from(a0.d).filter((_, i) => !drop.has(i));
      return a0.c === 1 && a0.r > 1 ? Arr.col(keep) : Arr.row(keep);
    }
    if (idx[0] === ':') {
      const drop = new Set(positions(idx[1], a0.c));
      return Arr.fromRows(a0.rows().map((row) => row.filter((_, j) => !drop.has(j))));
    }
    const drop = new Set(positions(idx[0], a0.r));
    return Arr.fromRows(a0.rows().filter((_, i) => !drop.has(i)));
  }
  if (idx.length === 1) {
    const pos = positions(idx[0], a0.n);
    const need = pos.length ? Math.max(...pos) + 1 : 0;
    let a = a0;
    if (need > a.n) {
      // growing: vectors grow along their direction (an empty array becomes a row)
      if (a.r <= 1) {
        const g = Arr.zeros(1, need);
        g.d.set(a.d);
        a = g;
      } else if (a.c === 1) {
        const g = Arr.zeros(need, 1);
        g.d.set(a.d);
        a = g;
      } else throw new ScriptError('linear index out of range for a matrix');
    } else a = new Arr(a.r, a.c, a.d.slice());
    if (val.n !== 1 && val.n !== pos.length) throw new ScriptError(`cannot assign ${val.n} values to ${pos.length} positions`);
    pos.forEach((p, k) => (a.d[p] = val.n === 1 ? val.d[0] : val.d[k]));
    return a;
  }
  if (idx.length === 2) {
    const rowIx = idx[0] === ':' ? Array.from({ length: Math.max(a0.r, val.r) }, (_, i) => i) : positions(idx[0], a0.r);
    const colIx = idx[1] === ':' ? Array.from({ length: Math.max(a0.c, val.c) }, (_, i) => i) : positions(idx[1], a0.c);
    const R = Math.max(a0.r, ...rowIx.map((x) => x + 1));
    const C = Math.max(a0.c, ...colIx.map((x) => x + 1));
    const a = Arr.zeros(R, C);
    for (let j = 0; j < a0.c; j++) for (let i = 0; i < a0.r; i++) a.d[i + j * R] = a0.d[i + j * a0.r];
    if (val.n !== 1 && val.n !== rowIx.length * colIx.length) throw new ScriptError(`cannot assign a ${val.r}×${val.c} value to ${rowIx.length}×${colIx.length} positions`);
    colIx.forEach((cIdx, j) => rowIx.forEach((rIdx, i) => (a.d[rIdx + cIdx * R] = val.n === 1 ? val.d[0] : val.d[i + j * rowIx.length])));
    return a;
  }
  throw new ScriptError('only 1 or 2 indices are supported');
}