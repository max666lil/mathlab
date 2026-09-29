/**
 * Workspace: the single framework-free object the UI talks to. It owns the document, the
 * reactive graph, selection / hover state, visibility, animations and direct manipulation.
 * Views subscribe to topics and read state; they never compute mathematics themselves.
 */
import { Graph, NodeState, DependencyError } from './graph';
import { MathDocument, StatementInfo, newCellId } from './document';
import { MathValue, PointValue, ScalarValue, ShowValue, AnimationValue, VisualValue, point, scalar } from '../math-core/values';
import { freeSymbols } from '../math-core/ast';
import { EvalError } from '../math-core/builtins';
import { SceneItem, toVisuals, colorFor } from '../visualization/scene-model';
import { installCoreBuiltins } from '../math-core/core-builtins';
import { analyzerFor } from './analysis';
import type { AnalysisService } from './analysis';

export type Topic = 'doc' | 'values' | 'selection' | 'hover' | 'view' | 'animation' | 'emphasis';

/** Transient focus on some objects (hovering a formula term, a notebook row, an arrow...). */
export interface Emphasis {
  /** object keys: node names ('u'), roles ('role:gradient'), annotations ('annot:angle') */
  keys: string[];
  /** hide everything unrelated instead of dimming it */
  isolate?: boolean;
  source: string;
}

export interface Diagnostic {
  from: number;
  to: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface Hover {
  x: number;
  y: number;
  /** which view produced the hover (views ignore their own echo) */
  source: string;
}

interface Playing {
  target: string;
  from: number;
  to: number;
  duration: number;
  start: number;
  loop: boolean;
}

const TAU = 2 * Math.PI;

/** Result kinds that are drawn automatically when named (Desmos-like). */
const SHOWN_KINDS = new Set(['point', 'plane', 'pointset', 'visual', 'asymptotes', 'slice']);

export class Workspace {
  doc: MathDocument;
  graph = new Graph<MathValue>();
  selection: string | null = null;
  hover: Hover | null = null;
  /** Scene-item or `${nodeId}#auto` visibility overrides */
  visibility = new Map<string, boolean>();
  playing = new Map<string, Playing>();
  versions: Record<Topic, number> = { doc: 0, values: 0, selection: 0, hover: 0, view: 0, animation: 0, emphasis: 0 };
  emphasis: Emphasis | null = null;
  /** active concept mode (interpreted by the presentation layer) */
  mode = 'all';
  /** the object being analysed (Analysis panel + primary canvas view) */
  focus: string | null = null;
  analysis: AnalysisService | null = null;
  private lastEditedCell: string | null = null;

  private listeners = new Map<Topic, Set<() => void>>();
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private rewriteTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRewrites = new Set<string>();
  private sceneCache: { version: number; view: number; items: SceneItem[] } | null = null;

  constructor(sources: string[] = []) {
    installCoreBuiltins();
    this.doc = new MathDocument(sources);
    this.rebuild();
  }

  // ---------------------------------------------------------------- events

  on(topic: Topic, fn: () => void): () => void {
    let s = this.listeners.get(topic);
    if (!s) this.listeners.set(topic, (s = new Set()));
    s.add(fn);
    return () => s!.delete(fn);
  }
  emit(topic: Topic) {
    this.versions[topic]++;
    this.listeners.get(topic)?.forEach((fn) => fn());
  }

  // ---------------------------------------------------------------- document

  get cells() {
    return this.doc.cells;
  }

  setCellSource(cellId: string, source: string, immediate = false) {
    const cell = this.doc.cell(cellId);
    if (!cell || cell.source === source) return;
    cell.source = source;
    this.lastEditedCell = cellId;
    this.emit('doc');
    this.scheduleRebuild(immediate ? 0 : 150);
  }

  addCell(afterId?: string, source = ''): string {
    const cell = { id: newCellId(), source };
    const i = afterId ? this.doc.cells.findIndex((c) => c.id === afterId) : this.doc.cells.length - 1;
    this.doc.cells.splice(i + 1, 0, cell);
    this.rebuild();
    return cell.id;
  }

  removeCell(cellId: string) {
    this.doc.cells = this.doc.cells.filter((c) => c.id !== cellId);
    this.rebuild();
  }

  moveCell(cellId: string, delta: number) {
    const i = this.doc.cells.findIndex((c) => c.id === cellId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.doc.cells.length) return;
    const [c] = this.doc.cells.splice(i, 1);
    this.doc.cells.splice(j, 0, c);
    this.rebuild();
  }

  loadDocument(sources: string[]) {
    this.doc = new MathDocument(sources);
    this.focus = null;
    this.lastEditedCell = null;
    this.selection = null;
    this.visibility.clear();
    this.playing.clear();
    this.rebuild();
    this.emit('selection');
    this.emit('view');
  }

  private scheduleRebuild(ms: number) {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => this.rebuild(), ms);
  }

  /** Re-analyze the document and recompute the whole graph. */
  rebuild() {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = null;
    this.pendingRewrites.clear();
    this.doc.analyze();
    this.graph.define(this.doc.nodeDefs());
    for (const [id, p] of this.playing) if (!this.graph.has(id) || !this.isScalarInput(id)) this.playing.delete(p.target);
    this.updateFocus();
    this.emit('doc');
    this.emit('values');
  }

  /** Flush a pending (debounced) rebuild immediately. */
  flush() {
    if (this.rebuildTimer) this.rebuild();
    this.flushRewrites();
  }

  // ---------------------------------------------------------------- focus (object recognition)

  isAnalyzable(name: string): boolean {
    return !!analyzerFor(this.value(name), name, this);
  }

  setFocus(name: string | null) {
    if (name && !this.isAnalyzable(name)) return;
    if (this.focus === name) return;
    this.focus = name;
    this.emit('view');
  }

  /**
   * Pick the object to analyse: what the user just edited (a definition or `analyze X`), else the
   * current focus if still valid, else an explicit `analyze X`, else the last analysable definition.
   */
  private updateFocus() {
    const named = this.doc.statements.filter((s) => s.name);
    const request = (ids: string[]) => {
      for (const id of ids) {
        const v = this.value(id);
        if (v?.kind === 'focus') {
          const t = (v as unknown as { target: string }).target;
          if (this.value(t)) return t;
        }
      }
      return undefined;
    };
    let next: string | null = null;
    if (this.lastEditedCell) {
      const inCell = this.doc.statements.filter((s) => s.cellId === this.lastEditedCell);
      next = request(inCell.map((s) => s.id)) ?? inCell.find((s) => s.name && this.value(s.id)?.kind === 'function' && this.isAnalyzable(s.name))?.name ?? null;
      this.lastEditedCell = null;
    }
    if (!next && this.focus && this.isAnalyzable(this.focus)) next = this.focus;
    if (!next) next = request(this.doc.statements.map((s) => s.id).reverse()) ?? null;
    // prefer primary objects (functions) over derived results such as point sets
    if (!next) next = [...named].reverse().find((s) => this.value(s.id)?.kind === 'function' && this.isAnalyzable(s.name!))?.name ?? null;
    if (!next) next = [...named].reverse().find((s) => this.isAnalyzable(s.name!))?.name ?? null;
    this.focus = next;
  }
  // ---------------------------------------------------------------- values

  statements(): StatementInfo[] {
    return this.doc.statements;
  }
  statement(id: string): StatementInfo | undefined {
    return this.doc.statements.find((s) => s.id === id);
  }
  node(id: string): NodeState<MathValue> | undefined {
    return this.graph.get(id);
  }
  value(id: string): MathValue | undefined {
    return this.graph.value(id);
  }

  /** Errors for a cell, positioned at the offending source span. */
  diagnostics(cellId: string): Diagnostic[] {
    const out: Diagnostic[] = [];
    for (const info of this.doc.statements) {
      if (info.cellId !== cellId) continue;
      const err = this.graph.get(info.id)?.error;
      if (!err) continue;
      const span = err instanceof EvalError && err.span ? err.span : info.stmt.span;
      const dependency = err instanceof DependencyError;
      out.push({ from: span.from, to: Math.max(span.to, span.from + 1), message: err.message, severity: dependency ? 'warning' : 'error' });
    }
    return out;
  }

  // ---------------------------------------------------------------- inputs (direct manipulation)

  isScalarInput(id: string) {
    return this.statement(id)?.input?.kind === 'slider';
  }

  /** Set an input node's value; dependents update immediately, source text follows shortly. */
  setInput(id: string, value: MathValue, notify = true) {
    const info = this.statement(id);
    if (!info?.input) return;
    this.graph.setInput(id, value, notify);
    this.pendingRewrites.add(id);
    if (!this.rewriteTimer) this.rewriteTimer = setTimeout(() => this.flushRewrites(), 90);
    if (notify) this.emit('values');
  }

  setPoint(id: string, coords: number[]) {
    const v = this.value(id);
    if (v?.kind !== 'point') return;
    const rounded = coords.map((c) => Math.round(c * 100) / 100);
    this.setInput(id, { ...(v as PointValue), coords: rounded });
  }

  setSlider(id: string, x: number) {
    const v = this.value(id) as ScalarValue | undefined;
    if (v?.kind !== 'scalar') return;
    const s = v.slider;
    const clamped = s ? Math.min(s.max, Math.max(s.min, x)) : x;
    this.setInput(id, { ...v, value: clamped });
  }

  /** Write pending input values back into the cell sources. */
  flushRewrites() {
    if (this.rewriteTimer) clearTimeout(this.rewriteTimer);
    this.rewriteTimer = null;
    if (!this.pendingRewrites.size) return;
    for (const id of this.pendingRewrites) {
      const info = this.statement(id);
      const v = this.value(id);
      if (info && v) this.doc.applyInput(info, v);
    }
    this.pendingRewrites.clear();
    this.emit('doc');
  }

  /**
   * Inverse manipulation: adjust the inputs upstream of `nodeId` (sliders, points) so that
   * `read(value(nodeId))` approaches `desired` — e.g. dragging the tip of u = <cos θ, sin θ>
   * solves for θ. Damped Gauss–Newton with finite-difference Jacobian.
   */
  solveFor(nodeId: string, desired: number[], read: (v: MathValue) => number[] | undefined, exclude: string[] = []): boolean {
    const inputs = [...this.graph.ancestors(nodeId), nodeId].filter((id) => this.statement(id)?.input && !exclude.includes(id));
    if (!inputs.length) return false;
    type Slot = { id: string; k: number };
    const slots: Slot[] = [];
    for (const id of inputs) {
      const v = this.value(id);
      if (v?.kind === 'scalar') slots.push({ id, k: -1 });
      else if (v?.kind === 'point') (v as PointValue).coords.forEach((_, k) => slots.push({ id, k }));
    }
    const getX = () => slots.map(({ id, k }) => {
      const v = this.value(id)!;
      return k < 0 ? (v as ScalarValue).value : (v as PointValue).coords[k];
    });
    const setX = (x: number[], notify: boolean) => {
      const byId = new Map<string, MathValue>();
      slots.forEach(({ id, k }, i) => {
        const v = byId.get(id) ?? this.value(id)!;
        if (k < 0) {
          const s = (v as ScalarValue).slider;
          let val = x[i];
          if (s) {
            const range = s.max - s.min;
            val = Math.abs(range - TAU) < 1e-6 ? s.min + ((((val - s.min) % range) + range) % range) : Math.min(s.max, Math.max(s.min, val));
          }
          byId.set(id, scalar(val, { slider: s }));
        } else {
          const c = (v as PointValue).coords.slice();
          c[k] = x[i];
          byId.set(id, point(c));
        }
      });
      for (const [id, v] of byId) this.graph.setInput(id, v, false);
      if (notify) byId.forEach((_, id) => this.pendingRewrites.add(id));
    };
    const residual = (): number[] | undefined => {
      const v = this.value(nodeId);
      const r = v && read(v);
      return r?.map((x, i) => x - desired[i]);
    };
    let x = getX();
    let r = residual();
    if (!r) return false;
    for (let iter = 0; iter < 12; iter++) {
      const cost = r.reduce((s, v) => s + v * v, 0);
      if (cost < 1e-12) break;
      const J: number[][] = r.map(() => new Array(x.length).fill(0));
      for (let j = 0; j < x.length; j++) {
        const h = 1e-5 * (1 + Math.abs(x[j]));
        const xp = x.slice();
        xp[j] += h;
        setX(xp, false);
        const rp = residual();
        if (!rp) return false;
        for (let i = 0; i < r.length; i++) J[i][j] = (rp[i] - r[i]) / h;
      }
      // (JᵀJ + λI) Δ = −Jᵀr
      const n = x.length;
      const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0) + (a === b ? 1e-6 : 0)));
      const g = Array.from({ length: n }, (_, a) => -J.reduce((s, row, i) => s + row[a] * r![i], 0));
      const delta = solveLinear(A, g);
      if (!delta) break;
      let step = 1;
      let improved = false;
      for (let ls = 0; ls < 8; ls++, step /= 2) {
        const xn = x.map((xi, i) => xi + step * delta[i]);
        setX(xn, false);
        const rn = residual();
        if (rn && rn.reduce((s, v) => s + v * v, 0) < cost) {
          x = getX();
          r = rn;
          improved = true;
          break;
        }
      }
      if (!improved) {
        setX(x, false);
        break;
      }
    }
    setX(x, true);
    if (!this.rewriteTimer) this.rewriteTimer = setTimeout(() => this.flushRewrites(), 90);
    this.graph.emit(inputs);
    this.emit('values');
    return true;
  }

  // ---------------------------------------------------------------- scene

  /**
   * Visual items for all views: the analysis of the focused object, explicit `show` statements, and
   * results that carry geometry (points, bound vectors, planes, point sets, command results).
   * `hide` statements remove matching items. Cached per values/view version.
   */
  sceneItems(): SceneItem[] {
    const c = this.sceneCache;
    if (c && c.version === this.versions.values && c.view === this.versions.view) return c.items;
    const items: SceneItem[] = [];
    const seen = new Set<string>();
    const named = (n: string) => !!this.statement(n)?.name;
    const keysFor = (visual: VisualValue, base: string[], primary: string) => {
      const keys = new Set(base);
      for (const p of ['sourceId', 'markerId'] as const) {
        const v = (visual.props[p] ?? (visual.props.slice as { markerId?: string } | undefined)?.[p as 'markerId']) as string | undefined;
        if (v) keys.add(v);
      }
      if (visual.role) keys.add(`role:${visual.role}`);
      keys.add(primary);
      return [...keys];
    };
    const add = (id: string, nodeId: string, visual: VisualValue, keys: string[], primary: string, visible: boolean) => {
      if (seen.has(id)) return;
      seen.add(id);
      items.push({ id, nodeId, visual, color: colorFor(visual, items.length), visible: this.visibility.get(id) ?? visible, keys, primary });
    };
    const push = (nodeId: string, v: MathValue, defaultVisible: boolean, name?: string) => {
      const inputId = this.statement(nodeId)?.input ? nodeId : undefined;
      toVisuals(v, { nodeId, name, inputId }).forEach((visual, i) => {
        const primary = (visual.props.sourceId as string | undefined) ?? nodeId;
        add(`${nodeId}#${i}`, nodeId, visual, keysFor(visual, [nodeId], primary), primary, this.visibility.get(`${nodeId}#auto`) ?? defaultVisible);
      });
    };
    // 1. automatic analysis of the focused object
    for (const a of this.analysis?.autoValues() ?? []) {
      toVisuals(a.value, { nodeId: a.primary, name: a.primary }).forEach((visual, i) => add(`${a.id}#${i}`, a.primary, visual, keysFor(visual, a.keys, a.primary), a.primary, a.visible));
    }
    // 2. the worksheet
    const hides: string[] = [];
    for (const info of this.doc.statements) {
      const v = this.value(info.id);
      if (!v) continue;
      if (v.kind === 'hide') {
        hides.push(...((v as unknown as { targets: string[] }).targets ?? []));
        continue;
      }
      if (v.kind === 'show') {
        const sv = v as ShowValue;
        sv.items.forEach((it, k) => {
          const src = sv.sources?.[k];
          if (src && this.value(src)) return push(src, it, !info.hidden, src);
          const expr = info.stmt.kind === 'show' ? info.stmt.items[k] : undefined;
          const refs = expr ? [...freeSymbols(expr)].filter(named) : [];
          toVisuals(it, { nodeId: info.id }).forEach((visual, i) => {
            const primary = (visual.props.sourceId as string | undefined) ?? refs[refs.length - 1] ?? info.id;
            add(`${info.id}#${k}.${i}`, info.id, visual, keysFor(visual, refs, primary), primary, !info.hidden);
          });
        });
        continue;
      }
      const geometric = SHOWN_KINDS.has(v.kind) || (v.kind === 'vector' && !!(v as { anchor?: number[] }).anchor) || !!v.visuals?.length;
      if (info.name && (geometric || this.visibility.get(`${info.id}#auto`))) {
        if (v.kind === 'function' && info.name === this.focus && !v.visuals?.length) continue; // drawn by the analysis
        push(info.id, v, !info.hidden, info.name);
      } else if (!info.name && info.stmt.kind === 'expr' && geometric) {
        // a command such as `tangent f at P` shows its result
        const refs = [...freeSymbols(info.stmt.value)].filter(named);
        toVisuals(v, { nodeId: info.id }).forEach((visual, i) => {
          const primary = (visual.props.sourceId as string | undefined) ?? refs[refs.length - 1] ?? info.id;
          add(`${info.id}#${i}`, info.id, visual, keysFor(visual, refs, primary), primary, !info.hidden);
        });
      }
    }
    const hidden = (it: SceneItem) =>
      hides.some((h) => h === it.visual.vtype || h === it.visual.role || h === it.nodeId || h === it.primary || it.keys.includes(h) || it.keys.includes(`fact:${h}`) || (h === 'graph' && it.visual.vtype === 'graph1d'));
    const out = hides.length ? items.filter((it) => !hidden(it)) : items;
    this.sceneCache = { version: this.versions.values, view: this.versions.view, items: out };
    return out;
  }
  setVisible(key: string, visible: boolean) {
    this.visibility.set(key, visible);
    this.emit('view');
  }

  /** Can this named node be shown in the views? */
  isVisualizable(id: string): boolean {
    const v = this.value(id);
    return !!v && toVisuals(v, { nodeId: id }).length > 0;
  }

  /** Is anything from this node currently visible? */
  isShown(id: string): boolean {
    return this.sceneItems().some((it) => it.nodeId === id && it.visible);
  }

  // ---------------------------------------------------------------- selection / hover

  select(id: string | null) {
    if (this.selection === id) return;
    this.selection = id;
    this.emit('selection');
  }

  setEmphasis(e: Emphasis | null) {
    const same = e && this.emphasis && e.source === this.emphasis.source && e.isolate === this.emphasis.isolate && e.keys.join() === this.emphasis.keys.join();
    if (same || (!e && !this.emphasis)) return;
    this.emphasis = e;
    this.emit('emphasis');
  }

  /** Keys that identify the selected object (its name and semantic role). */
  selectionKeys(): string[] {
    if (!this.selection) return [];
    const v = this.value(this.selection);
    // points are hubs (almost everything is anchored at P): selecting one must not dim the scene
    if (v?.kind === 'point') return [];
    const role = v?.role;
    return role ? [this.selection, `role:${role}`] : [this.selection];
  }

  setMode(mode: string) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.visibility.clear();
    this.emit('view');
  }
  setHover(h: Hover | null) {
    this.hover = h;
    this.emit('hover');
  }

  // ---------------------------------------------------------------- animation

  /** Toggle animation of a slider, or of an `animate` statement's target. */
  toggleAnimation(id: string, now = performance.now()) {
    const v = this.value(id);
    let spec: Omit<Playing, 'start'> | undefined;
    if (v?.kind === 'animation') {
      const a = v as AnimationValue;
      spec = { target: a.target, from: a.from, to: a.to, duration: a.duration, loop: Math.abs(Math.abs(a.to - a.from) - TAU) < 1e-6 };
    } else if (v?.kind === 'scalar' && (v as ScalarValue).slider) {
      const s = (v as ScalarValue).slider!;
      spec = { target: id, from: s.min, to: s.max, duration: 6, loop: Math.abs(s.max - s.min - TAU) < 1e-6 };
    }
    if (!spec || !this.isScalarInput(spec.target)) return;
    if (this.playing.has(spec.target)) this.playing.delete(spec.target);
    else {
      // start from the current value so playback is continuous
      const cur = (this.value(spec.target) as ScalarValue).value;
      const frac = Math.min(1, Math.max(0, (cur - spec.from) / (spec.to - spec.from || 1)));
      this.playing.set(spec.target, { ...spec, start: now - frac * spec.duration * 1000 });
    }
    this.emit('animation');
  }

  isPlaying(id: string): boolean {
    const v = this.value(id);
    const target = v?.kind === 'animation' ? (v as AnimationValue).target : id;
    return this.playing.has(target);
  }

  /** Advance animations; called by the animation clock every frame. */
  tick(now: number): boolean {
    if (!this.playing.size) return false;
    for (const p of this.playing.values()) {
      const t = (now - p.start) / (p.duration * 1000);
      const phase = p.loop ? t % 1 : 1 - Math.abs((t % 2) - 1);
      const v = this.value(p.target) as ScalarValue;
      if (v) this.graph.setInput(p.target, { ...v, value: p.from + (p.to - p.from) * phase }, false);
      this.pendingRewrites.add(p.target);
    }
    this.graph.emit([...this.playing.keys()]);
    if (!this.rewriteTimer) this.rewriteTimer = setTimeout(() => this.flushRewrites(), 250);
    this.emit('values');
    return true;
  }
}

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    if (Math.abs(M[p][i]) < 1e-14) return null;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}
