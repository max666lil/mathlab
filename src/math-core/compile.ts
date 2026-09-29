/**
 * Compiles expression ASTs into fast JS closures. Generated source only ever contains numeric
 * literals, positional argument names and whitelisted function references — never user text.
 */
import { Expr } from './ast';
import { CONSTANTS, getScalarFunction } from './scalar-functions';

/** Numeric environment for free symbols: scalars, or coordinates for member access (P.x). */
export type NumericEnv = Record<string, number | number[]>;

export class CompileError extends Error {}

export type CompiledScalar = (...args: number[]) => number;
export type CompiledAny = (...args: number[]) => number | number[] | number[][];

const MEMBER_INDEX: Record<string, number> = { x: 0, y: 1, z: 2, w: 3 };

export function memberIndex(prop: string): number | undefined {
  if (prop in MEMBER_INDEX) return MEMBER_INDEX[prop];
  if (/^\d+$/.test(prop)) return Number(prop) - 1;
  return undefined;
}

const lit = (x: number) => (Number.isNaN(x) ? 'NaN' : x === Infinity ? 'Infinity' : x === -Infinity ? '(-Infinity)' : `(${x})`);

function gen(e: Expr, params: string[], env: NumericEnv, fns: Map<string, (...a: number[]) => number>): string {
  const g = (x: Expr) => gen(x, params, env, fns);
  switch (e.type) {
    case 'num':
      return lit(e.value);
    case 'sym': {
      const i = params.indexOf(e.name);
      if (i >= 0) return `a${i}`;
      const v = env[e.name];
      if (typeof v === 'number') return lit(v);
      if (Array.isArray(v)) return `[${v.map(lit).join(',')}]`;
      if (e.name in CONSTANTS) return lit(CONSTANTS[e.name]);
      throw new CompileError(`Unknown symbol '${e.name}'`);
    }
    case 'member': {
      if (e.object.type === 'sym') {
        const v = env[e.object.name];
        const idx = memberIndex(e.prop);
        if (Array.isArray(v) && idx !== undefined && idx < v.length) return lit(v[idx]);
      }
      throw new CompileError(`Cannot evaluate member '.${e.prop}'`);
    }
    case 'neg':
      return `(-${g(e.arg)})`;
    case 'bin':
      switch (e.op) {
        case '+':
        case '-':
        case '*':
        case '/':
          return `(${g(e.left)}${e.op}${g(e.right)})`;
        case '^': {
          if (e.right.type === 'num' && e.right.value === 2) return `((t=${g(e.left)})*t)`;
          return `Math.pow(${g(e.left)},${g(e.right)})`;
        }
        default:
          throw new CompileError(`Operator '${e.op}' is not supported inside a function body`);
      }
    case 'call': {
      const name = e.callee.type === 'sym' ? e.callee.name : undefined;
      const sf = name ? getScalarFunction(name) : undefined;
      if (!name || !sf) throw new CompileError(`Unknown function '${name ?? '?'}'`);
      const [lo, hi] = typeof sf.arity === 'number' ? [sf.arity, sf.arity] : sf.arity;
      if (e.args.length < lo || e.args.length > hi) throw new CompileError(`${name} expects ${lo === hi ? lo : `${lo}–${hi}`} argument(s)`);
      fns.set(name, sf.fn);
      return `F[${JSON.stringify(name)}](${e.args.map(g).join(',')})`;
    }
    case 'vec':
    case 'tuple':
      return `[${e.items.map(g).join(',')}]`;
    case 'matrix':
      return `[${e.rows.map((r) => `[${r.map(g).join(',')}]`).join(',')}]`;
    default:
      throw new CompileError(`Cannot compile ${e.type}`);
  }
}

export function compile(expr: Expr, params: string[], env: NumericEnv = {}): CompiledAny {
  const fns = new Map<string, (...a: number[]) => number>();
  const body = gen(expr, params, env, fns);
  const F: Record<string, (...a: number[]) => number> = Object.fromEntries(fns);
  const args = params.map((_, i) => `a${i}`).join(',');
  // eslint-disable-next-line no-new-func
  return new Function('F', `"use strict";let t;return function(${args}){return ${body};};`)(F) as CompiledAny;
}

export function compileScalar(expr: Expr, params: string[], env: NumericEnv = {}): CompiledScalar {
  return compile(expr, params, env) as CompiledScalar;
}
