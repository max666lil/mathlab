/**
 * Values of the script language: numbers, dense column-major arrays (as in MATLAB), strings,
 * function handles and opaque worksheet objects (distributions, symbolic functions …).
 */
import type { MathValue } from '../../math-core/values';

export class Arr {
  /** logical arrays come from comparisons and index as masks */
  logical = false;
  constructor(public r: number, public c: number, public d: Float64Array) {}
  static zeros(r: number, c: number) {
    return new Arr(r, c, new Float64Array(r * c));
  }
  static row(xs: number[]) {
    return new Arr(1, xs.length, Float64Array.from(xs));
  }
  static col(xs: number[]) {
    return new Arr(xs.length, 1, Float64Array.from(xs));
  }
  static fromRows(rows: number[][]) {
    const r = rows.length;
    const c = r ? rows[0].length : 0;
    const a = Arr.zeros(r, c);
    for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) a.d[i + j * r] = rows[i][j];
    return a;
  }
  get n() {
    return this.r * this.c;
  }
  get(i: number, j: number) {
    return this.d[i + j * this.r];
  }
  rows(): number[][] {
    return Array.from({ length: this.r }, (_, i) => Array.from({ length: this.c }, (_, j) => this.get(i, j)));
  }
  isVector() {
    return this.r === 1 || this.c === 1;
  }
}

export interface Fn {
  t: 'fn';
  name: string;
  /** call with evaluated arguments and the number of requested outputs */
  call(args: SV[], nout: number): SV[];
  /** source of an anonymous function (@(x) x.^2) for display and symbolic conversion */
  lambda?: { params: string[]; body: import('./parser').SExpr; captured: Map<string, SV> };
}

export interface Opaque {
  t: 'obj';
  value: MathValue;
}

export type SV = number | string | Arr | Fn | Opaque;

export const isArr = (v: SV): v is Arr => v instanceof Arr;
export const isFn = (v: SV): v is Fn => typeof v === 'object' && !(v instanceof Arr) && (v as Fn).t === 'fn';
export const isObj = (v: SV): v is Opaque => typeof v === 'object' && !(v instanceof Arr) && (v as Opaque).t === 'obj';

export class ScriptError extends Error {
  constructor(message: string, public pos?: number) {
    super(message);
  }
}

/** A value as an array (numbers → 1×1). */
export function toArr(v: SV, what = 'a number or an array'): Arr {
  if (typeof v === 'number') return new Arr(1, 1, Float64Array.of(v));
  if (v instanceof Arr) return v;
  if (typeof v === 'string') return Arr.row([...v].map((c) => c.charCodeAt(0)));
  throw new ScriptError(`expected ${what}`);
}

/** 1×1 arrays collapse to numbers. */
export function simplifyValue(v: SV): SV {
  if (v instanceof Arr && v.n === 1 && !v.logical) return v.d[0];
  if (v instanceof Arr && v.n === 1 && v.logical) return v.d[0];
  return v;
}

export function num(v: SV, what = 'a number'): number {
  if (typeof v === 'number') return v;
  if (v instanceof Arr && v.n === 1) return v.d[0];
  throw new ScriptError(`expected ${what}`);
}

export function truthy(v: SV): boolean {
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (v instanceof Arr) return v.n > 0 && Array.prototype.every.call(v.d, (x: number) => x !== 0 && !Number.isNaN(x));
  if (typeof v === 'string') return v.length > 0;
  return true;
}

/** MATLAB-style display: "x = 3", matrices row by row. */
export function display(name: string, v: SV): string[] {
  const f = (x: number) => (Number.isInteger(x) && Math.abs(x) < 1e15 ? String(x) : Number.isNaN(x) ? 'NaN' : !Number.isFinite(x) ? (x > 0 ? 'Inf' : '-Inf') : String(+x.toPrecision(5)));
  if (typeof v === 'number') return [`${name} = ${f(v)}`];
  if (typeof v === 'string') return [`${name} = '${v}'`];
  if (v instanceof Arr) {
    if (v.n === 0) return [`${name} = []`];
    if (v.n > 60) return [`${name} = [${v.r}×${v.c} array]`];
    const rows = v.rows().map((r) => r.map(f));
    const w = Math.max(...rows.flat().map((s) => s.length));
    return [`${name} =`, ...rows.map((r) => '   ' + r.map((s) => s.padStart(w)).join('   '))];
  }
  if (isFn(v)) return [`${name} = @${v.lambda ? `(${v.lambda.params.join(',')}) …` : v.name}`];
  return [`${name} = ${(v as Opaque).value.kind}`];
}