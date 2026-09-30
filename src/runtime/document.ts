/**
 * The notebook document: ordered cells of MLL source. Analysis turns statements into graph
 * node definitions; input statements (sliders, draggable points) know how to rewrite their own
 * source text so that direct manipulation and symbolic editing stay in sync.
 */
import { Expr, Span, freeSymbols } from '../math-core/ast';
import { parseProgram, Statement, spanOf } from '../parser/parser';
import { getBuiltin, EvalError } from '../math-core/builtins';
import { getScalarFunction } from '../math-core/scalar-functions';
import { symbolLatex, formatNumber, toText } from '../math-core/symbolic/print';
import { MathValue, FunctionValue, PointValue, VectorValue, MatrixValue, ScalarValue, ShowValue, point, vector } from '../math-core/values';
import { NodeDef } from './graph';
import { Evaluator, Scope } from './evaluator';
import { runScript, functionOf, ScriptValue } from './script/bridge';

export interface Cell {
  id: string;
  source: string;
}

export interface InputSpec {
  kind: 'point' | 'slider' | 'vector' | 'matrix';
  nodeId: string;
  cellId: string;
  /** Span in the cell source replaced when the value changes */
  span: Span;
  format(value: MathValue): string;
}

export interface StatementInfo {
  id: string;
  cellId: string;
  index: number;
  stmt: Statement;
  name?: string;
  deps: string[];
  input?: InputSpec;
  hidden: boolean;
}

let cellCounter = 0;
export const newCellId = () => `c${++cellCounter}`;

const parseOpts = {
  isPrefixFunction: (n: string) => !!getBuiltin(n)?.prefix || !!getScalarFunction(n),
  commandKeywords: (n: string) => {
    const b = getBuiltin(n);
    return b?.command ? Object.keys(b.keywords ?? {}) : undefined;
  },
};

/** Parser options of the document language (commands, prefix functions). */
export const parserOptions = parseOpts;

export function isPrefixFunction(n: string) {
  return parseOpts.isPrefixFunction(n);
}

/** Expressions appearing in a statement (for dependency analysis). */
function statementExprs(st: Statement): Expr[] {
  switch (st.kind) {
    case 'funcdef':
      return [st.body, ...(st.ranges ?? []).flatMap(([, a, b]) => [a, b])];
    case 'assign':
      return [st.value];
    case 'show':
    case 'hide':
      return st.items;
    case 'compare':
      return [st.a, st.b];    case 'expr':
      return [st.value];
    case 'animate':
      return [st.from, st.to, ...(st.duration ? [st.duration] : [])];
    default:
      return [];
  }
}

function roundTo(x: number, decimals: number) {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

export function formatInputNumber(x: number, decimals: number): string {
  return formatNumber(roundTo(x, decimals), 12);
}

export class MathDocument {
  cells: Cell[] = [];
  statements: StatementInfo[] = [];
  private parseCache = new Map<string, Statement[]>();

  constructor(sources: string[] = []) {
    this.cells = sources.map((s) => ({ id: newCellId(), source: s }));
  }

  cell(id: string) {
    return this.cells.find((c) => c.id === id);
  }

  parseCell(source: string): Statement[] {
    let st = this.parseCache.get(source);
    if (!st) {
      st = parseProgram(source, parseOpts);
      if (this.parseCache.size > 500) this.parseCache.clear();
      this.parseCache.set(source, st);
    }
    return st;
  }

  /** Parse every cell and derive statement infos (ids, names, dependencies, inputs). */
  analyze(): StatementInfo[] {
    const infos: StatementInfo[] = [];
    const taken = new Set<string>();
    const exportsOf = new Map<string, string[]>();
    for (const cell of this.cells) {
      this.parseCell(cell.source).forEach((stmt, index) => {
        let name = stmt.kind === 'funcdef' || stmt.kind === 'assign' ? stmt.name : stmt.kind === 'custom' || stmt.kind === 'block' ? stmt.name : undefined;
        let id = `${cell.id}#${index}`;
        if (name && !taken.has(name)) {
          id = name;
          taken.add(name);
        } else if (name) name = undefined; // duplicate — reported at evaluation
        infos.push({ id, cellId: cell.id, index, stmt, name, deps: [], hidden: stmt.modifiers.includes('hidden') });
        // a script leaves its variables in the worksheet: one node each, computed from the script
        if (stmt.kind === 'block' && stmt.block.blockKind === 'script') {
          const ex: string[] = [];
          for (const w of stmt.block.writes) {
            if (taken.has(w)) continue;
            taken.add(w);
            ex.push(w);
            infos.push({ id: w, cellId: cell.id, index, stmt: { kind: 'custom', rule: 'script-export', name: w, data: { script: id, var: w }, span: stmt.span, modifiers: [] }, name: w, deps: [id], hidden: false });
          }
          exportsOf.set(id, ex);
        }
      });
    }
    const names = new Set(infos.filter((i) => i.name).map((i) => i.name!));
    for (const info of infos) {
      const st = info.stmt;
      if (st.kind === 'custom' && st.rule === 'script-export') {
        info.input = undefined;
        continue;
      }
      if (st.kind === 'block') {
        // names it reads that the worksheet defines (not its own variables)
        const own = new Set(exportsOf.get(info.id) ?? []);
        info.deps = st.block.reads.filter((n) => names.has(n) && !own.has(n) && n !== info.name);
        continue;
      }
      info.deps = this.dependencies(info.stmt, names);
      info.input = this.inputSpec(info);
    }
    this.statements = infos;
    return infos;
  }

  private dependencies(st: Statement, names: Set<string>): string[] {
    const params = st.kind === 'funcdef' ? new Set(st.params) : new Set<string>();
    const deps = new Set<string>();
    const add = (n: string) => {
      if (params.has(n)) return;
      if (names.has(n)) return void deps.add(n);
      if (n.endsWith("'")) return add(n.slice(0, -1));
      const us = n.indexOf('_');
      if (us > 0 && names.has(n.slice(0, us))) return void deps.add(n.slice(0, us));
      if (getBuiltin(n) || getScalarFunction(n)) return;
      if ([...n].length > 1) [...n].forEach((c) => names.has(c) && !params.has(c) && deps.add(c));
    };
    for (const e of statementExprs(st)) freeSymbols(e).forEach(add);
    if (st.kind === 'animate') add(st.name);
    return [...deps];
  }

  private inputSpec(info: StatementInfo): InputSpec | undefined {
    const st = info.stmt;
    if (st.kind !== 'assign' || !info.name) return undefined;
    const cell = this.cell(info.cellId)!;
    const v = st.value;
    const src = (e: Expr) => cell.source.slice(spanOf(e).from, spanOf(e).to);
    const isCall = (e: Expr, n: string) => e.type === 'call' && e.callee.type === 'sym' && e.callee.name === n;
    if (st.modifiers.includes('draggable') && (isCall(v, 'point') || v.type === 'tuple')) {
      const wrap = isCall(v, 'point') ? (s: string) => `point(${s})` : (s: string) => `(${s})`;
      return {
        kind: 'point', nodeId: info.id, cellId: info.cellId, span: spanOf(v),
        format: (val) => wrap((val as PointValue).coords.map((c) => formatInputNumber(c, 2)).join(', ')),
      };
    }
    const plainNumbers = (items: Expr[]) => items.every((e) => e.type === 'num');
    // v = <1, 2> draggable: the tip can be dragged
    if (st.modifiers.includes('draggable') && v.type === 'vec' && plainNumbers(v.items)) {
      return {
        kind: 'vector', nodeId: info.id, cellId: info.cellId, span: spanOf(v),
        format: (val) => `<${(val as VectorValue).comps.map((c) => formatInputNumber(c, 2)).join(', ')}>`,
      };
    }
    // A = [[2, 1], [1, 2]]: a numeric matrix literal can be reshaped on the canvas (drag î, ĵ)
    if (v.type === 'matrix' && plainNumbers(v.rows.flat())) {
      return {
        kind: 'matrix', nodeId: info.id, cellId: info.cellId, span: spanOf(v),
        format: (val) => `[${(val as MatrixValue).rows.map((r) => `[${r.map((c) => formatInputNumber(c, 2)).join(', ')}]`).join(', ')}]`,
      };
    }
    if (isCall(v, 'slider') && v.type === 'call' && v.args.length >= 2) {
      const [lo, hi, , step] = v.args;
      const shorthand = st.typeHint === 'slider' && cell.source.slice(spanOf(v).from, spanOf(v).from + 1) === '[';
      const span = shorthand ? st.span : spanOf(v);
      return {
        kind: 'slider', nodeId: info.id, cellId: info.cellId, span,
        format: (val) => {
          const s = (val as ScalarValue).slider;
          const range = s ? s.max - s.min : 10;
          const decimals = Math.max(0, 3 - Math.floor(Math.log10(Math.max(range, 1e-9))));
          const body = `slider(${src(lo)}, ${src(hi)}, ${formatInputNumber((val as ScalarValue).value, decimals)}${step ? `, ${src(step)}` : ''})`;
          return shorthand ? `${info.name} = ${body}` : body;
        },
      };
    }
    return undefined;
  }

  /** Graph node definitions for the analyzed statements. */
  nodeDefs(): NodeDef<MathValue>[] {
    const firstByName = new Map<string, StatementInfo>();
    for (const i of this.statements) if (i.name) firstByName.set(i.name, i);
    return this.statements.map((info) => ({
      id: info.id,
      deps: info.deps,
      input: !!info.input,
      compute: (get) => {
        const allowed = new Set(info.deps);
        const scope: Scope = { lookup: (n) => (allowed.has(n) ? get(n) : undefined) };
        return evaluateStatement(info, new Evaluator(scope), firstByName);
      },
    }));
  }

  /**
   * Rewrite an input statement's source for a new value (drag / slider). Returns the new cell
   * source. Spans are refreshed by re-parsing just that cell; the graph is left untouched.
   */
  applyInput(info: StatementInfo, value: MathValue): string | undefined {
    const spec = info.input;
    const cell = spec && this.cell(spec.cellId);
    if (!spec || !cell) return undefined;
    const text = spec.format(value);
    const src = cell.source.slice(0, spec.span.from) + text + cell.source.slice(spec.span.to);
    if (src === cell.source) return src;
    cell.source = src;
    this.refreshCell(cell.id);
    return src;
  }

  /** Re-parse one cell whose structure is unchanged, updating statement spans in place. */
  refreshCell(cellId: string) {
    const cell = this.cell(cellId)!;
    const parsed = this.parseCell(cell.source);
    const infos = this.statements.filter((s) => s.cellId === cellId);
    if (parsed.length !== infos.length) return false;
    infos.forEach((info, k) => {
      info.stmt = parsed[k];
      info.input = this.inputSpec(info);
    });
    return true;
  }
}

export function evaluateStatement(info: StatementInfo, ev: Evaluator, firstByName: Map<string, StatementInfo>): MathValue {
  const st = info.stmt;
  switch (st.kind) {
    case 'error':
      throw new EvalError(st.message, st.errorSpan);
    case 'funcdef': {
      if (!info.name) throw new EvalError(`'${st.name}' is already defined`, st.nameSpan);
      // r(θ) = …: a polar curve
      const polar = st.name === 'r' && st.params.length === 1 && st.params[0] === 'θ';
      const fn = ev.makeFunction(st.body, st.params, { label: symbolLatex(st.name), role: polar ? 'polar' : undefined });
      if (!st.ranges) return fn;
      // parameter ranges (curves, surfaces): evaluated like any expression, so sliders can drive them
      const ranges: Record<string, [number, number]> = {};
      for (const [v, a, b] of st.ranges) {
        const lo = ev.num(ev.evaluate(a), a);
        const hi = ev.num(ev.evaluate(b), b);
        if (!(hi > lo)) throw new EvalError(`the range of ${v} must be increasing`, spanOf(a));
        ranges[v] = [lo, hi];
      }
      return { ...fn, ranges, key: `${fn.key}|${JSON.stringify(ranges)}` };
    }
    case 'assign': {
      if (!info.name) throw new EvalError(`'${st.name}' is already defined${firstByName.has(st.name) ? ' above' : ''}`, st.nameSpan);
      // r = 1 + cos(θ): a polar curve
      if (st.name === 'r' && freeSymbols(st.value).has('θ') && !ev.lookup('θ')) return ev.makeFunction(st.value, ['θ'], { label: 'r', role: 'polar' });
      let v = st.value.type === 'eq' ? ev.relation(st.value) : ev.evaluateOrLift(st.value);
      if (v.kind === 'function' && !(v as FunctionValue).label) v = { ...(v as FunctionValue), label: symbolLatex(st.name) };
      if (st.typeHint === 'vector' && v.kind === 'point') v = vector((v as PointValue).coords);
      if (st.typeHint === 'point' && v.kind === 'vector') v = point((v as VectorValue).comps);
      if (st.modifiers.includes('draggable') && v.kind !== 'point' && v.kind !== 'vector' && v.kind !== 'matrix') throw new EvalError('Only points, vectors and matrices can be draggable', st.span);
      return v;
    }
    case 'show':
      return { kind: 'show', items: st.items.map((e) => ev.evaluateOrLift(e)), sources: st.items.map((e) => (e.type === 'sym' ? e.name : undefined)) } as ShowValue;
    case 'expr':
      return st.value.type === 'eq' ? ev.relation(st.value) : ev.evaluateOrLift(st.value);
    case 'animate': {
      const from = ev.num(ev.evaluate(st.from), st.from);
      const to = ev.num(ev.evaluate(st.to), st.to);
      const duration = st.duration ? ev.num(ev.evaluate(st.duration), st.duration) : 4;
      const target = ev.lookup(st.name);
      if (!target || target.kind !== 'scalar') throw new EvalError(`'${st.name}' must be a slider or number to animate`, st.span);
      return { kind: 'animation', target: st.name, from, to, duration };
    }
    case 'hide':
      return { kind: 'hide', targets: st.items.map((e) => toText(e)) } as MathValue;
    case 'compare': {
      const a = ev.evaluateOrLift(st.a);
      const b = ev.evaluateOrLift(st.b);
      const items: MathValue[] = [a, { ...b, role: 'compare' }];
      if (a.kind === 'function' && b.kind === 'function') {
        const d = ev.evaluate({ type: 'bin', op: '-', left: st.a, right: st.b });
        if (d.kind === 'function') items.push({ ...d, role: 'difference', label: '\\Delta' } as FunctionValue);
      }
      return { kind: 'show', items } as ShowValue;
    }
    case 'custom': {
      if (st.rule === 'script-export') {
        const { script, var: v } = st.data as { script: string; var: string };
        const s = ev.lookup(script) as ScriptValue | undefined;
        if (!s || s.kind !== 'script') throw new EvalError(`the script defining ${v} failed`, st.span);
        const value = s.vars[v];
        if (!value) throw new EvalError(`${v} is not assigned when the script finishes`, st.span);
        return value;
      }
      throw new EvalError(`Statement '${st.rule}' has no evaluator`, st.span);
    }
    case 'block':
      if (st.block.blockKind === 'function') {
        if (!info.name) throw new EvalError(`'${st.name}' is already defined`, st.span);
        return functionOf(st.block, ev);
      }
      if (st.name && !info.name) throw new EvalError(`'${st.name}' is already defined`, st.span);
      return runScript(st.block, ev) as unknown as MathValue;
  }
}

