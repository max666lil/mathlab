/**
 * Evaluates expressions to typed MathValues against a scope (the reactive graph's current values).
 * Also builds FunctionValues: inlining user functions, splitting implicit products (xy → x·y),
 * binding free parameters numerically and compiling to closures.
 */
import { Expr, mapExpr, freeSymbols, sym, bin } from '../math-core/ast';
import { compile, NumericEnv, CompileError } from '../math-core/compile';
import { CONSTANTS, getScalarFunction } from '../math-core/scalar-functions';
import { getBuiltin, argMode, EvalContext, EvalError, KwArgs } from '../math-core/builtins';
import { diff } from '../math-core/symbolic/diff';
import { simplify } from '../math-core/symbolic/simplify';
import { toText, toLatex } from '../math-core/symbolic/print';
import {
  MathValue, FunctionValue, ScalarValue, PointValue, VectorValue, MatrixValue,
  scalar, point, vector, matrixV, valueMember,
} from '../math-core/values';
import { dot, cross, matVec, matMul } from '../math-core/linalg';
import { isRational } from '../math-core/rational';
import type { Certainty } from '../math-core/values';

export { EvalError };

export interface Scope {
  lookup(name: string): MathValue | undefined;
}

/** Variables that may appear free in an expression to make it an anonymous function. */
export const LIFT_VARS = ['x', 'y', 'z', 't'];

const spanErr = (msg: string, e: Expr) => new EvalError(msg, e.span);

export class Evaluator implements EvalContext {
  constructor(private scope: Scope) {}

  lookup(name: string): MathValue | undefined {
    const v = this.scope.lookup(name);
    if (v) return v;
    if (name in CONSTANTS) return scalar(CONSTANTS[name]);
    return this.derivedName(name);
  }

  /** f' (derivative of a 1-variable function) and f_x / f_xy (partial derivatives). */
  private derivedName(name: string): MathValue | undefined {
    if (name.endsWith("'")) {
      const base = this.lookup(name.slice(0, -1));
      if (base?.kind === 'function') {
        const f = base as FunctionValue;
        if (f.params.length === 1 && f.expr) return this.makeFunction(diff(f.expr, f.params[0]), f.params, { label: `${f.label ?? 'f'}'`, base: f, env: f.env });
      }
      return undefined;
    }
    const us = name.indexOf('_');
    if (us > 0) {
      const base = this.scope.lookup(name.slice(0, us));
      if (base?.kind === 'function') {
        const f = base as FunctionValue;
        const vars = [...name.slice(us + 1)];
        if (f.expr && f.out === 'scalar' && vars.length > 0 && vars.every((v) => f.params.includes(v))) {
          let e = f.expr;
          for (const v of vars) e = diff(e, v);
          return this.makeFunction(e, f.params, { label: `${f.label ?? 'f'}_{${vars.join('')}}`, base: f, env: f.env });
        }
      }
    }
    return undefined;
  }

  evaluate(e: Expr): MathValue {
    switch (e.type) {
      case 'num':
        return scalar(e.value);
      case 'sym': {
        const v = this.lookup(e.name);
        if (v) return v;
        const split = this.splitName(e.name);
        if (split) return this.evaluate(split);
        if (LIFT_VARS.includes(e.name)) throw spanErr(`'${e.name}' is a free variable here — define a function, e.g. g(${e.name}) = …`, e);
        throw spanErr(`Unknown name '${e.name}'`, e);
      }
      case 'neg':
        return this.negate(this.evaluate(e.arg), e);
      case 'bin':
        return this.binary(e);
      case 'member': {
        const obj = this.evaluate(e.object);
        const v = valueMember(obj, e.prop);
        if (!v) throw spanErr(`${obj.kind} has no component '${e.prop}'`, e);
        return v;
      }
      case 'call':
        return this.call(e);
      case 'tuple': {
        const items = e.items.map((it) => this.evaluate(it));
        return point(items.map((it, i) => this.num(it, e.items[i])));
      }
      case 'vec': {
        const comps = e.items.map((it) => this.num(this.evaluate(it), it));
        return vector(comps, undefined, this.rationalLiteral(e.items, comps));
      }
      case 'list':
        return { kind: 'list', items: e.items.map((it) => this.evaluate(it)) };
      case 'matrix': {
        const rows = e.rows.map((r) => r.map((it) => this.num(this.evaluate(it), it)));
        if (rows.some((r) => r.length !== rows[0].length)) throw spanErr('All rows of a matrix must have the same length', e);
        return matrixV(rows, this.rationalLiteral(e.rows.flat(), rows.flat()));
      }
      case 'eq':
        throw spanErr(`'=' is only allowed in definitions and arguments such as slice(f, x = 1)`, e);
    }
  }

  /**
   * A vector / matrix literal is exact when every entry is a rational number built only from
   * rational literals and exact scalars — no transcendental functions or constants.
   */
  private rationalLiteral(items: Expr[], values: number[]): { certainty?: Certainty } {
    const rationalExpr = (x: Expr): boolean => {
      switch (x.type) {
        case 'num':
          return true;
        case 'neg':
          return rationalExpr(x.arg);
        case 'bin':
          if (x.op === '^') return rationalExpr(x.left) && x.right.type === 'num' && Number.isInteger(x.right.value);
          return ['+', '-', '*', '/'].includes(x.op) && rationalExpr(x.left) && rationalExpr(x.right);
        case 'sym': {
          if (x.name in CONSTANTS) return false;
          const v = this.scope.lookup(x.name);
          return v?.kind === 'scalar' && (v.certainty === undefined || v.certainty === 'exact');
        }
        default:
          return false;
      }
    };
    return items.every(rationalExpr) && values.every(isRational) ? { certainty: 'exact' } : {};
  }

  /**
   * A statement-level equation or inequality in x, y: an implicit curve (x² + y² = 1) or a region
   * (y < x²). With no free variables it is simply true or false.
   */
  relation(e: Extract<Expr, { type: 'eq' }>): MathValue {
    const d: Expr = { type: 'bin', op: '-', left: e.left, right: e.right };
    const free = [...liftCandidates(d)].filter((n) => !this.lookup(n) && !getBuiltin(n) && !getScalarFunction(n));
    const vars = new Set(free.flatMap((n) => (LIFT_VARS.includes(n) ? [n] : [...n].filter((c) => LIFT_VARS.includes(c) && !this.lookup(c)))));
    if (vars.has('z')) throw spanErr('Implicit surfaces in x, y, z arrive with 3-D scalar fields (Phase 3a)', e);
    if (vars.has('t')) throw spanErr(`'t' is a parameter — for a curve write (x(t), y(t))`, e);
    if (!vars.size) {
      const a = this.num(this.evaluate(e.left), e.left);
      const b = this.num(this.evaluate(e.right), e.right);
      const ok = e.rel === '<' ? a < b : e.rel === '>' ? a > b : e.rel === '<=' ? a <= b : e.rel === '>=' ? a >= b : Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
      return { kind: 'bool', value: ok };
    }
    const fn = this.makeFunction(d, ['x', 'y']);
    return { kind: 'relation', rel: e.rel ?? '=', fn, latex: toLatex(e), key: `rel|${e.rel ?? '='}|${fn.key}` };
  }

  num(v: MathValue, e: Expr): number {
    if (v.kind === 'scalar') return (v as ScalarValue).value;
    throw spanErr(`Expected a number, got ${v.kind}`, e);
  }

  /** `xy` → x·y when every letter is a known name or free variable. */
  splitName(name: string, allowed?: Set<string>): Expr | undefined {
    const chars = [...name];
    if (chars.length < 2) return undefined;
    const ok = chars.every((c) => allowed?.has(c) || this.scope.lookup(c) !== undefined || c in CONSTANTS);
    if (!ok) return undefined;
    return chars.map((c) => sym(c)).reduce((a, b) => bin('*', a, b));
  }

  private negate(v: MathValue, e: Expr): MathValue {
    switch (v.kind) {
      case 'scalar':
        return scalar(-(v as ScalarValue).value);
      case 'vector':
        return vector((v as VectorValue).comps.map((x) => -x), (v as VectorValue).anchor, { certainty: v.certainty });
      case 'point':
        return point((v as PointValue).coords.map((x) => -x));
      case 'matrix':
        return matrixV((v as MatrixValue).rows.map((r) => r.map((x) => -x)), { certainty: v.certainty });
      case 'function':
        return this.functionOp('*', scalar(-1), v, e);
    }
    throw spanErr(`Cannot negate ${v.kind}`, e);
  }

  private binary(e: Extract<Expr, { type: 'bin' }>): MathValue {
    // A^T (transpose) and A^-1 (inverse) delegate to the linear-algebra builtins
    if (e.op === '^' && e.right.type === 'sym' && e.right.name === 'T' && !this.lookup('T')) {
      const a = this.evaluate(e.left);
      if (a.kind === 'vector') return matrixV([(a as VectorValue).comps.slice()], { certainty: a.certainty }); // row vector
      if (a.kind !== 'matrix') throw spanErr(`Only matrices and vectors can be transposed (got ${a.kind})`, e);
      return this.callBuiltin('transpose', [a], e);
    }
    return this.binaryOp(e);
  }

  /** Apply a registered builtin to already evaluated arguments (used by operator syntax). */
  private callBuiltin(name: string, args: MathValue[], e: Expr): MathValue {
    const b = getBuiltin(name);
    if (!b) throw spanErr(`'${name}' is not available`, e);
    try {
      return b.apply(args, this, [], { values: {}, raw: {} });
    } catch (err) {
      if (err instanceof EvalError && !err.span) err.span = e.span;
      throw err;
    }
  }

  private binaryOp(e: Extract<Expr, { type: 'bin' }>): MathValue {
    if (e.op === 'at') {
      const f = this.evaluate(e.left);
      const arg = this.evaluate(e.right);
      if (f.kind === 'vector' && arg.kind === 'point') {
        const v = f as VectorValue;
        return vector(v.comps, (arg as PointValue).coords, { role: v.role, derivation: v.derivation });
      }
      return this.apply(f, [arg], e);
    }
    const a = this.evaluate(e.left);
    const b = this.evaluate(e.right);
    return this.inheritCertainty(this.arith(e, a, b), a, b);
  }

  /**
   * Linear-algebra results (vectors, points, matrices) are exact when all operands are exact
   * (plain rational scalars count as exact), otherwise they take the weakest operand certainty.
   */
  private inheritCertainty(r: MathValue, a: MathValue, b: MathValue): MathValue {
    if (r.certainty || !['vector', 'point', 'matrix'].includes(r.kind)) return r;
    if (a.kind === 'point' || b.kind === 'point') return r;
    const of = (v: MathValue): Certainty | undefined => v.certainty ?? (v.kind === 'scalar' && isRational((v as ScalarValue).value) ? 'exact' : undefined);
    const cs = [of(a), of(b)];
    if (cs.some((c) => !c)) return r;
    const order: Certainty[] = ['heuristic', 'numeric', 'exact'];
    return { ...r, certainty: cs.reduce((w, c) => (order.indexOf(c!) < order.indexOf(w!) ? c : w)) };
  }

  private arith(e: Extract<Expr, { type: 'bin' }>, a: MathValue, b: MathValue): MathValue {
    const k = `${a.kind}${e.op}${b.kind}`;
    const S = (v: MathValue) => (v as ScalarValue).value;
    const V = (v: MathValue) => (v.kind === 'vector' ? (v as VectorValue).comps : (v as PointValue).coords);
    const M = (v: MathValue) => (v as MatrixValue).rows;
    const same = (x: number[], y: number[]) => {
      if (x.length !== y.length) throw spanErr(`Dimension mismatch: ${x.length} vs ${y.length}`, e);
    };
    if (a.kind === 'function' || b.kind === 'function') return this.functionOp(e.op, a, b, e);
    switch (k) {
      case 'scalar+scalar': return scalar(S(a) + S(b));
      case 'scalar-scalar': return scalar(S(a) - S(b));
      case 'scalar*scalar':
      case 'scalar·scalar': return scalar(S(a) * S(b));
      case 'scalar/scalar': return scalar(S(a) / S(b));
      case 'scalar^scalar': return scalar(Math.pow(S(a), S(b)));
      case 'vector+vector':
      case 'vector-vector': {
        same(V(a), V(b));
        const s = e.op === '+' ? 1 : -1;
        return vector(V(a).map((x, i) => x + s * V(b)[i]), (a as VectorValue).anchor);
      }
      case 'point+vector':
      case 'point-vector':
      case 'vector+point': {
        same(V(a), V(b));
        const s = e.op === '-' ? -1 : 1;
        return point(V(a).map((x, i) => x + s * V(b)[i]));
      }
      case 'point-point':
        same(V(a), V(b));
        return vector(V(a).map((x, i) => x - V(b)[i]), V(b));
      case 'point+point':
        same(V(a), V(b));
        return point(V(a).map((x, i) => x + V(b)[i]));
      case 'scalar*vector':
      case 'vector*scalar': {
        const [s, v] = a.kind === 'scalar' ? [S(a), b] : [S(b), a];
        return vector(V(v).map((x) => s * x), (v as VectorValue).anchor);
      }
      case 'scalar*point':
      case 'point*scalar': {
        const [s, v] = a.kind === 'scalar' ? [S(a), b] : [S(b), a];
        return point(V(v).map((x) => s * x));
      }
      case 'vector/scalar':
        return vector(V(a).map((x) => x / S(b)), (a as VectorValue).anchor);
      case 'point/scalar':
        return point(V(a).map((x) => x / S(b)));
      case 'vector·vector':
      case 'vector·point':
      case 'point·vector':
        same(V(a), V(b));
        return scalar(dot(V(a), V(b)));
      case 'vector×vector':
        if (V(a).length === 2 && V(b).length === 2) return scalar(V(a)[0] * V(b)[1] - V(a)[1] * V(b)[0]);
        return vector(cross(V(a), V(b)));
      case 'matrix/scalar':
        return matrixV(M(a).map((r) => r.map((x) => x / S(b))));
      case 'vector*matrix':
        if (V(a).length !== M(b).length) throw spanErr('Row vector / matrix dimension mismatch', e);
        return vector(M(b)[0].map((_, j) => V(a).reduce((s, x, i) => s + x * M(b)[i][j], 0)));
      case 'matrix·vector':
      case 'matrix*vector':
      case 'matrix*point':
        if (M(a)[0].length !== V(b).length) throw spanErr('Matrix/vector dimension mismatch', e);
        return b.kind === 'point' ? point(matVec(M(a), V(b))) : vector(matVec(M(a), V(b)));
      case 'matrix*matrix':
        if (M(a)[0].length !== M(b).length) throw spanErr('Matrix dimension mismatch', e);
        return matrixV(matMul(M(a), M(b)));
      case 'scalar*matrix':
      case 'matrix*scalar': {
        const [s, m] = a.kind === 'scalar' ? [S(a), b] : [S(b), a];
        return matrixV(M(m).map((r) => r.map((x) => s * x)));
      }
      case 'matrix+matrix':
      case 'matrix-matrix': {
        if (M(a).length !== M(b).length || M(a)[0].length !== M(b)[0].length) throw spanErr('Matrices must have the same size', e);
        const s = e.op === '+' ? 1 : -1;
        return matrixV(M(a).map((r, i) => r.map((x, j) => x + s * M(b)[i][j])));
      }
      case 'matrix^scalar': {
        let n = S(b);
        if (M(a).length !== M(a)[0].length) throw spanErr('Only square matrices have powers', e);
        if (!Number.isInteger(n)) throw spanErr('Matrix powers must be integers', e);
        let base = a as MatrixValue;
        if (n < 0) {
          base = this.callBuiltin('inverse', [a], e) as MatrixValue;
          n = -n;
        }
        let r: number[][] = M(a).map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));
        while (n-- > 0) r = matMul(r, base.rows);
        return matrixV(r, { certainty: base.certainty });
      }
      case 'vector*vector':
        throw spanErr(`Use '·' (dot) or '×' (cross) to multiply vectors`, e);
    }
    throw spanErr(`Cannot apply '${e.op}' to ${a.kind} and ${b.kind}`, e);
  }

  /** Arithmetic on functions: (f + g)(x,y), 2f, f/3 … built symbolically. */
  private functionOp(op: string, a: MathValue, b: MathValue, e: Expr): MathValue {
    const asExpr = (v: MathValue): Expr => {
      if (v.kind === 'scalar') return { type: 'num', value: (v as ScalarValue).value };
      if (v.kind === 'function' && (v as FunctionValue).expr) return (v as FunctionValue).expr!;
      throw spanErr(`Cannot combine ${v.kind} with a function using '${op}'`, e);
    };
    const fa = a.kind === 'function' ? (a as FunctionValue) : undefined;
    const fb = b.kind === 'function' ? (b as FunctionValue) : undefined;
    const params = (fa ?? fb)!.params;
    if (fa && fb && fa.params.join() !== fb.params.join()) throw spanErr('Functions have different variables', e);
    if (!['+', '-', '*', '/', '^'].includes(op)) throw spanErr(`Cannot apply '${op}' to functions`, e);
    const body = simplify(bin(op as '+', asExpr(a), asExpr(b)));
    return this.makeFunction(body, params, { env: { ...(fa?.env ?? {}), ...(fb?.env ?? {}) } });
  }

  private call(e: Extract<Expr, { type: 'call' }>): MathValue {
    if (e.callee.type !== 'sym') return this.apply(this.evaluate(e.callee), e.args.map((a) => this.evaluate(a)), e);
    const name = e.callee.name;
    const user = this.lookup(name);
    if (user) return this.apply(user, e.args.map((a) => this.evaluate(a)), e);
    const b = getBuiltin(name);
    if (b) {
      if (e.args.length < b.minArgs || e.args.length > b.maxArgs) {
        const n = b.minArgs === b.maxArgs ? `${b.minArgs}` : `${b.minArgs}–${b.maxArgs}`;
        throw spanErr(`${name} expects ${n} argument(s): ${b.signature}`, e);
      }
      const args = e.args.map((a, i) => {
        const m = argMode(b, i);
        if (m === 'raw') return undefined;
        if (m === 'function') return this.toFunction(a);
        return this.evaluate(a);
      });
      const kw: KwArgs = { values: {}, raw: {} };
      for (const [k, v] of e.kwargs ?? []) {
        const mode = b.keywords?.[k];
        if (!mode) throw spanErr(`${name} does not take '${k}'`, v);
        kw.raw[k] = v;
        kw.values[k] = mode === 'raw' ? undefined : mode === 'function' ? this.toFunction(v) : this.evaluate(v);
      }
      try {
        const r = b.apply(args, this, e.args, kw);
        // a builtin that does not judge its own result inherits the weakest certainty of its inputs
        if (!r.certainty) {
          const order = ['heuristic', 'numeric', 'exact'] as const;
          const cs = [...args, ...Object.values(kw.values)].map((a) => a?.certainty).filter(Boolean) as (typeof order)[number][];
          if (cs.length) return { ...r, certainty: cs.reduce((w, c) => (order.indexOf(c) < order.indexOf(w) ? c : w)) };
        }
        return r;
      } catch (err) {
        if (err instanceof EvalError && !err.span) err.span = e.span;
        throw err;
      }
    }
    const sf = getScalarFunction(name);
    if (sf) {
      const [lo, hi] = typeof sf.arity === 'number' ? [sf.arity, sf.arity] : sf.arity;
      if (e.args.length < lo || e.args.length > hi) throw spanErr(`${name} takes ${lo === hi ? lo : `${lo}–${hi}`} argument${hi === 1 ? '' : 's'}`, e);
      const args = e.args.map((a) => this.evaluate(a));
      if (args.some((a) => a.kind === 'function')) {
        const fs = args.filter((a) => a.kind === 'function') as FunctionValue[];
        const body = { ...e, args: args.map((a, i) => (a.kind === 'function' ? (a as FunctionValue).expr ?? e.args[i] : e.args[i])) };
        return this.makeFunction(body, fs[0].params);
      }
      return scalar(sf.fn(...args.map((a, i) => this.num(a, e.args[i]))));
    }
    throw spanErr(`Unknown function '${name}'`, e.callee);
  }

  /** Apply a function value to arguments: f(1, 2), f(P), grad(f) at P. */
  apply(fv: MathValue, args: MathValue[], e: Expr): MathValue {
    if (fv.kind === 'scalar' && args.length === 1 && args[0].kind === 'scalar')
      return scalar((fv as ScalarValue).value * (args[0] as ScalarValue).value); // a(x+1): implicit product
    if (fv.kind === 'matrix' && args.length === 1 && (args[0].kind === 'vector' || args[0].kind === 'point')) {
      // A(v): a matrix is a linear map
      const m = (fv as MatrixValue).rows;
      const v = args[0].kind === 'vector' ? (args[0] as VectorValue).comps : (args[0] as PointValue).coords;
      if (m[0].length !== v.length) throw spanErr('Matrix/vector dimension mismatch', e);
      const c = fv.certainty && fv.certainty === args[0].certainty ? { certainty: fv.certainty } : {};
      return args[0].kind === 'point' ? { ...point(matVec(m, v)), ...c } : vector(matVec(m, v), undefined, c);
    }
    if (fv.kind !== 'function') throw spanErr(`${fv.kind} is not a function`, e);
    const f = fv as FunctionValue;
    let coords: number[];
    if (args.length === 1 && (args[0].kind === 'point' || args[0].kind === 'vector')) {
      coords = args[0].kind === 'point' ? (args[0] as PointValue).coords : (args[0] as VectorValue).comps;
    } else coords = args.map((a) => this.num(a, e));
    if (coords.length !== f.params.length)
      throw spanErr(`${f.label ?? 'function'} takes ${f.params.length} input(s), got ${coords.length}`, e);
    const out = f.eval(...coords);
    const derivation = `${f.label ?? 'f'}\\left(${coords.map((c) => +c.toFixed(4)).join(', ')}\\right)`;
    // evaluating a symbolic formula is exact arithmetic (up to floating point); numeric functions are numeric
    const certainty = f.certainty ?? (f.expr ? 'exact' : 'numeric');
    if (typeof out === 'number') return scalar(out, { derivation, role: f.role, certainty });
    if (Array.isArray(out[0])) return matrixV(out as number[][], { derivation, role: f.role, certainty });
    const comps = out as number[];
    return vector(comps, comps.length === coords.length ? coords.slice() : undefined, { derivation, role: f.role, certainty });
  }

  toFunction(e: Expr): FunctionValue {
    if (e.type === 'sym') {
      const v = this.lookup(e.name);
      if (v?.kind === 'function') return v as FunctionValue;
    }
    const unresolved = new Set<string>();
    const scan = (x: Expr) => {
      if (x.type === 'sym' && !this.lookup(x.name) && !getBuiltin(x.name) && !getScalarFunction(x.name)) {
        const chars = [...x.name];
        if (chars.length > 1 && chars.every((c) => LIFT_VARS.includes(c) || this.lookup(c))) chars.filter((c) => !this.lookup(c)).forEach((c) => unresolved.add(c));
        else unresolved.add(x.name);
      }
      if (x.type === 'call') x.args.forEach(scan);
      else if (x.type !== 'member') for (const c of childrenOf(x)) scan(c);
    };
    scan(e);
    if (unresolved.size > 0) {
      const bad = [...unresolved].filter((n) => !LIFT_VARS.includes(n));
      if (bad.length) throw spanErr(`Unknown name '${bad[0]}'`, e);
      const params = LIFT_VARS.filter((v) => unresolved.has(v));
      return this.makeFunction(e, params);
    }
    const v = this.evaluate(e);
    if (v.kind !== 'function') throw spanErr(`Expected a function, got ${v.kind}`, e);
    return v as FunctionValue;
  }

  /** Evaluate, but lift expressions with free x, y, z, t to anonymous functions. */
  evaluateOrLift(e: Expr): MathValue {
    const free = [...liftCandidates(e)].filter((n) => !this.lookup(n) && !getBuiltin(n) && !getScalarFunction(n));
    // lift only when a real free variable remains (ab with a, b defined is a product, not a function)
    const hasVar = free.some((n) => LIFT_VARS.includes(n) || [...n].some((c) => LIFT_VARS.includes(c) && !this.lookup(c)));
    const liftable = hasVar && free.every((n) => LIFT_VARS.includes(n) || [...n].every((c) => LIFT_VARS.includes(c) || this.lookup(c)));
    return liftable ? this.toFunction(e) : this.evaluate(e);
  }

  makeFunction(expr: Expr, params: string[], opts: { label?: string; role?: string; base?: FunctionValue; env?: NumericEnv } = {}): FunctionValue {
    const env: NumericEnv = { ...(opts.env ?? {}) };
    const allowed = new Set(params);
    const body = mapExpr(expr, (n) => this.prepareNode(n, params, allowed, env));
    // bind free symbols numerically
    for (const name of freeSymbols(body)) {
      if (params.includes(name) || name in env) continue;
      const v = this.scope.lookup(name);
      if (!v) continue; // constants / function names are handled by the compiler
      if (v.kind === 'scalar') env[name] = (v as ScalarValue).value;
      else if (v.kind === 'point') env[name] = (v as PointValue).coords;
      else if (v.kind === 'vector') env[name] = (v as VectorValue).comps;
    }
    let fn: FunctionValue['eval'];
    try {
      fn = compile(body, params, env);
    } catch (err) {
      if (err instanceof CompileError) throw new EvalError(err.message, expr.span);
      throw err;
    }
    const out: FunctionValue['out'] = body.type === 'vec' || body.type === 'tuple' ? 'vector' : body.type === 'matrix' ? 'matrix' : 'scalar';
    const key = `${params.join(',')}|${toText(body, true)}|${JSON.stringify(env)}`;
    return { kind: 'function', params, expr: body, env, eval: fn, out, label: opts.label, key, role: opts.role, base: opts.base };
  }

  /** One bottom-up rewrite step while preparing a function body. */
  private prepareNode(n: Expr, params: string[], allowed: Set<string>, env: NumericEnv): Expr {
    if (n.type === 'sym') {
      if (params.includes(n.name) || n.name in env) return n;
      const v = this.scope.lookup(n.name);
      if (v) {
        if (v.kind === 'function') throw spanErr(`'${n.name}' is a function — call it, e.g. ${n.name}(${params.join(', ')})`, n);
        return n;
      }
      if (n.name in CONSTANTS) return n;
      const split = this.splitName(n.name, allowed);
      if (split) return split;
      if (!getScalarFunction(n.name) && !getBuiltin(n.name)) throw spanErr(`Unknown name '${n.name}'`, n);
      return n;
    }
    if (n.type === 'call' && n.callee.type === 'sym') {
      const name = n.callee.name;
      // x(x + 1) inside a body: implicit multiplication by the variable
      if (params.includes(name)) {
        if (n.args.length === 1) return bin('*', n.callee, n.args[0]);
        throw spanErr(`'${name}' is a variable, not a function`, n);
      }
      const v = this.scope.lookup(name) ?? this.derivedName(name);
      if (v?.kind === 'function') {
        const f = v as FunctionValue;
        if (!f.expr) throw spanErr(`${name} has no symbolic form and cannot be used inside a formula`, n);
        if (n.args.length !== f.params.length) throw spanErr(`${name} takes ${f.params.length} input(s)`, n);
        Object.assign(env, f.env);
        const subst = new Map(f.params.map((p, i) => [p, n.args[i]]));
        return mapExpr(f.expr, (m) => (m.type === 'sym' && subst.has(m.name) ? subst.get(m.name)! : m));
      }
      if (v?.kind === 'scalar' && n.args.length === 1) return bin('*', n.callee, n.args[0]);
      if (!v && getBuiltin(name) && !getScalarFunction(name)) {
        const usesParams = [...freeSymbols(n)].some((s) => params.includes(s));
        if (usesParams) throw spanErr(`${name}(…) cannot depend on the variables ${params.join(', ')} here`, n);
        const r = this.evaluate(n);
        if (r.kind === 'scalar') return { type: 'num', value: (r as ScalarValue).value };
        throw spanErr(`${name}(…) does not produce a number`, n);
      }
      return n;
    }
    if (n.type === 'bin' && n.op === '·') {
      const l = this.vectorComponents(n.left);
      const r = this.vectorComponents(n.right);
      if (l && r && l.length === r.length) return l.map((c, i) => bin('*', c, r[i])).reduce((a, b) => bin('+', a, b));
      if (!l && !r) return bin('*', n.left, n.right);
      throw spanErr(`'·' needs two vectors of the same dimension`, n);
    }
    return n;
  }

  private vectorComponents(e: Expr): Expr[] | undefined {
    if (e.type === 'vec' || e.type === 'tuple') return e.items;
    if (e.type === 'sym') {
      const v = this.scope.lookup(e.name);
      const n = v?.kind === 'vector' ? (v as VectorValue).comps.length : v?.kind === 'point' ? (v as PointValue).coords.length : 0;
      if (n) return Array.from({ length: n }, (_, i) => ({ type: 'member', object: e, prop: ['x', 'y', 'z', 'w'][i] }) as Expr);
    }
    return undefined;
  }
}

/**
 * Free symbols that could make an expression an anonymous function. Arguments that builtins
 * take as functions or raw syntax (grad(x^2), slice(f, x = 1)) are excluded — the builtin
 * handles them itself.
 */
function liftCandidates(e: Expr, out = new Set<string>()): Set<string> {
  if (e.type === 'sym') out.add(e.name);
  else if (e.type === 'eq') liftCandidates(e.right, out);
  else if (e.type === 'call') {
    const b = e.callee.type === 'sym' ? getBuiltin(e.callee.name) : undefined;
    e.args.forEach((a, i) => {
      if (!b || argMode(b, i) === 'value') liftCandidates(a, out);
    });
    for (const [k, v] of e.kwargs ?? []) if (!b || (b.keywords?.[k] ?? 'value') === 'value') liftCandidates(v, out);
    if (e.callee.type !== 'sym') liftCandidates(e.callee, out);
  } else if (e.type !== 'member') for (const c of childrenOf(e)) liftCandidates(c, out);
  return out;
}

function childrenOf(e: Expr): Expr[] {
  switch (e.type) {
    case 'neg':
      return [e.arg];
    case 'bin':
    case 'eq':
      return [e.left, e.right];
    case 'tuple':
    case 'vec':
    case 'list':
      return e.items;
    case 'matrix':
      return e.rows.flat();
    default:
      return [];
  }
}

