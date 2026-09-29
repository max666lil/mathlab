/**
 * Analysis engine. Analyzers recognise a mathematical object and describe its analysis as FACTS:
 * each fact is an MLL expression (e.g. "critical(f)") evaluated with the ordinary builtins, so the
 * result is a typed, addressable object — the Analysis panel is only one presentation of it.
 *
 * Tier-0 facts are computed as soon as the object is analysed; tier-1 facts only when their section
 * is opened (lazily, off the typing path). Results are cached by expression + the identity of the
 * objects it references.
 */
import type { Workspace } from './workspace';
import type { MathValue } from '../math-core/values';
import { freeSymbols } from '../math-core/ast';
import { parseExpression } from '../parser/parser';
import { Evaluator } from './evaluator';
import { parserOptions } from './document';

export interface FactSpec {
  id: string;
  title: string;
  /** MLL expression that reproduces the fact, e.g. "critical(f)" */
  expr: string;
  tier: 0 | 1;
  section: string;
  /** suggested name when the fact is pinned into the worksheet */
  pinName?: string;
  /** canvas behaviour: always shown, shown while its section is open, or only when toggled on */
  visual?: 'always' | 'auto' | 'toggle';
  /** drawn but not listed as a row (e.g. the surface itself) */
  hidden?: boolean;
  /** only these visual types of the value are drawn (e.g. the arrow of a directional derivative, not its slice) */
  visualTypes?: string[];
}

export interface SectionSpec {
  id: string;
  title: string;
  defaultOpen?: boolean;
  /** key of an explanation the UI can show ("Why?") */
  why?: string;
  /** always-visible compact summary (no header, not collapsible) */
  summary?: boolean;
  /** opening the section also opens this contextual drawer below the canvas */
  drawer?: 'slices';
  /** rows to insert into the worksheet to unlock more analysis (e.g. add a point) */
  actions?: { label: string; rows: string[] }[];
}

export interface Relation {
  kind: string;
  between: string[];
  text: string;
}

/** A canvas view the workspace can show, and which renderer draws it. */
export interface CanvasView {
  id: string;
  label: string;
  renderer: 'plane' | 'scene';
}

/**
 * The workspace layout an analyzer asks for. The UI never decides this from the object itself:
 * f(x) → one 2D graph, f(x, y) → 3D / contour / both, later F(x, y) → field view, X ~ … → probability views.
 */
export interface WorkspaceLayout {
  canvasTitle: string;
  views: CanvasView[];
  /** named combinations shown side by side, e.g. "Both" = 3D + contour */
  combos?: { id: string; label: string; views: string[] }[];
  defaultView: string;
}

/** Layout when nothing is being analysed: a plain coordinate plane. */
export const DEFAULT_LAYOUT: WorkspaceLayout = {
  canvasTitle: 'Canvas',
  views: [{ id: 'plane', label: 'Plane', renderer: 'plane' }],
  defaultView: 'plane',
};

export interface AnalysisPlan {
  object: string;
  typeLabel: string;
  layout: WorkspaceLayout;
  /** LaTeX headline */
  title: string;
  sections: SectionSpec[];
  facts: FactSpec[];
  relations: Relation[];
  diagnostics: string[];
}

export interface Analyzer {
  id: string;
  recognizes(value: MathValue, name: string, ws: Workspace): boolean;
  plan(name: string, value: MathValue, ws: Workspace): AnalysisPlan;
}

const analyzers: Analyzer[] = [];
export function registerAnalyzer(a: Analyzer) {
  const i = analyzers.findIndex((x) => x.id === a.id);
  if (i >= 0) analyzers[i] = a;
  else analyzers.push(a);
}
export function analyzerFor(value: MathValue | undefined, name: string, ws: Workspace): Analyzer | undefined {
  return value ? analyzers.find((a) => a.recognizes(value, name, ws)) : undefined;
}

export interface FactState {
  spec: FactSpec;
  status: 'idle' | 'pending' | 'ready' | 'error';
  value?: MathValue;
  error?: string;
}

interface CacheEntry {
  key: string;
  state: FactState;
}

export class AnalysisService {
  private open = new Map<string, boolean>();
  private toggled = new Map<string, boolean>();
  private cache = new Map<string, CacheEntry>();
  private listeners = new Set<() => void>();
  private queue = new Set<string>();
  /** contextual drawer below the canvas (cross-sections, explanations); null = closed */
  drawer: { kind: 'slices' } | { kind: 'why'; topic: string } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  version = 0;

  constructor(private ws: Workspace) {
    ws.analysis = this;
    // a newly loaded document starts with default cards
    let doc = ws.doc;
    ws.on('doc', () => {
      if (ws.doc !== doc) {
        doc = ws.doc;
        this.open.clear();
        this.toggled.clear();
        this.drawer = null;
      }
    });
  }

  on(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
    this.ws.emit('view');
  }

  /** The plan for the focused object (or null). */
  plan(): AnalysisPlan | null {
    const name = this.ws.focus;
    if (!name) return null;
    const v = this.ws.value(name);
    const a = analyzerFor(v, name, this.ws);
    return a && v ? a.plan(name, v, this.ws) : null;
  }

  sectionOpen(plan: AnalysisPlan, id: string): boolean {
    return this.open.get(`${plan.object}:${id}`) ?? !!plan.sections.find((s) => s.id === id)?.defaultOpen;
  }

  setSectionOpen(plan: AnalysisPlan, id: string, open: boolean) {
    this.open.set(`${plan.object}:${id}`, open);
    const section = plan.sections.find((s) => s.id === id);
    if (section?.drawer === 'slices') this.drawer = open ? { kind: 'slices' } : this.drawer?.kind === 'slices' ? null : this.drawer;
    this.emit();
  }

  setDrawer(d: AnalysisService['drawer']) {
    this.drawer = d;
    this.emit();
  }

  isToggled(plan: AnalysisPlan, factId: string) {
    return this.toggled.get(`${plan.object}:${factId}`) ?? false;
  }
  toggle(plan: AnalysisPlan, factId: string) {
    const k = `${plan.object}:${factId}`;
    this.toggled.set(k, !(this.toggled.get(k) ?? false));
    this.emit();
  }

  /** Identity of the objects an expression refers to (cache key). */
  private depsKey(expr: string): string {
    let names: string[] = [];
    try {
      names = [...freeSymbols(parseExpression(expr, parserOptions))];
    } catch {
      /* evaluated (and reported) below */
    }
    return names
      .map((n) => {
        const v = this.ws.value(n) as (MathValue & { key?: string; coords?: number[]; value?: number; comps?: number[] }) | undefined;
        if (!v) return `${n}:-`;
        return `${n}:${v.key ?? JSON.stringify(v.coords ?? v.comps ?? v.value ?? v.kind)}`;
      })
      .join('|');
  }

  private evaluate(expr: string): FactState['value'] {
    const ev = new Evaluator({ lookup: (n) => this.ws.value(n) });
    return ev.evaluateOrLift(parseExpression(expr, parserOptions));
  }

  /**
   * State of a fact. Tier-0 facts (and facts whose section is open) are computed on demand; the first
   * computation of a tier-1 fact is deferred so typing stays responsive.
   */
  fact(plan: AnalysisPlan, spec: FactSpec): FactState {
    const key = this.depsKey(spec.expr);
    const ck = `${plan.object}|${spec.expr}`;
    const hit = this.cache.get(ck);
    const needed = spec.tier === 0 || this.sectionOpen(plan, spec.section);
    if (hit && hit.key === key && hit.state.status !== 'pending') return hit.state;
    if (!needed) return hit?.key === key ? hit.state : { spec, status: 'idle' };
    // tier 0, or a tier-1 fact that was computed before (its heavy parts are memoised): compute now
    if (spec.tier === 0 || (hit && hit.state.status === 'ready')) return this.compute(ck, key, spec);
    this.queue.add(ck);
    if (!hit || hit.state.status !== 'pending') this.cache.set(ck, { key, state: { spec, status: 'pending' } });
    if (!this.timer) this.timer = setTimeout(() => this.flush(plan), 0);
    return this.cache.get(ck)!.state;
  }

  private compute(ck: string, key: string, spec: FactSpec): FactState {
    let state: FactState;
    try {
      state = { spec, status: 'ready', value: this.evaluate(spec.expr) };
    } catch (e) {
      state = { spec, status: 'error', error: e instanceof Error ? e.message : String(e) };
    }
    this.cache.set(ck, { key, state });
    if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!);
    return state;
  }

  private flush(plan: AnalysisPlan) {
    this.timer = null;
    const pending = [...this.queue];
    this.queue.clear();
    for (const ck of pending) {
      const entry = this.cache.get(ck);
      if (!entry) continue;
      this.compute(ck, this.depsKey(entry.state.spec.expr), entry.state.spec);
    }
    if (pending.length && plan) this.emit();
  }

  /** Compute everything that is currently needed (tests / synchronous callers). */
  flushNow() {
    const plan = this.plan();
    if (this.timer) clearTimeout(this.timer);
    if (plan) {
      for (const f of plan.facts) this.fact(plan, f);
      this.flush(plan);
    }
  }

  /** Visuals contributed by the analysis of the focused object. */
  autoValues(): { id: string; value: MathValue; keys: string[]; visible: boolean; primary: string }[] {
    const plan = this.plan();
    if (!plan) return [];
    const out: { id: string; value: MathValue; keys: string[]; visible: boolean; primary: string }[] = [];
    for (const spec of plan.facts) {
      if (!spec.visual) continue;
      const open = this.sectionOpen(plan, spec.section);
      const visible = spec.visual === 'always' || (spec.visual === 'auto' && open) || (spec.visual === 'toggle' && this.isToggled(plan, spec.id));
      if (!visible && spec.tier === 1 && !open) continue;
      const st = this.fact(plan, spec);
      if (st.status !== 'ready' || !st.value) continue;
      const value = spec.visualTypes && st.value.visuals ? { ...st.value, visuals: st.value.visuals.filter((v) => spec.visualTypes!.includes(v.vtype)) } : st.value;
      out.push({ id: `auto:${plan.object}:${spec.id}`, value, keys: [plan.object, `fact:${spec.id}`], visible, primary: plan.object });
    }
    return out;
  }
}