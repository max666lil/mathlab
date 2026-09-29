/**
 * Presentation layer: decides how much of each scene item is shown (concept modes, linked
 * emphasis) and animates it. It never changes mathematics — the same objects exist in every
 * mode; modes only set visibility, emphasis, camera and annotations. Renderers read per-item
 * styles and redraw when the presentation changes.
 */
import type { Workspace } from '../runtime/workspace';
import type { SceneItem } from './scene-model';

export type Level = 'focus' | 'context' | 'hidden';

export interface ConceptMode {
  id: string;
  title: string;
  hint: string;
  /** visibility / emphasis of an item in this mode (undefined → default rule) */
  level(item: SceneItem): Level | undefined;
  /** camera shot to move to when the mode is entered */
  shot?: string;
  /** preferred cross-section (slice role) */
  slice?: string;
  /** annotations drawn in this mode, e.g. 'angle' */
  annotations?: string[];
}

export const ALL_MODE: ConceptMode = {
  id: 'all',
  title: 'All',
  hint: 'Everything the notebook shows',
  level: (it) => (it.visible ? 'focus' : 'hidden'),
};

const modes: ConceptMode[] = [];
export function registerMode(m: ConceptMode) {
  const i = modes.findIndex((x) => x.id === m.id);
  if (i >= 0) modes[i] = m;
  else modes.push(m);
}
export function getModes(): ConceptMode[] {
  return [...modes, ALL_MODE];
}
export function getMode(id: string): ConceptMode {
  return modes.find((m) => m.id === id) ?? ALL_MODE;
}

/** Conceptual links: emphasising one object also brings out the objects that explain it. */
const related = new Map<string, string[]>();
export function registerRelation(key: string, keys: string[]) {
  related.set(key, [...(related.get(key) ?? []), ...keys]);
}

function defaultLevel(it: SceneItem): Level {
  const t = it.visual.vtype;
  if (!it.visible) return 'hidden';
  return t === 'point' || t === 'surface' || t === 'graph1d' || t === 'field2' ? 'focus' : 'hidden';
}

const LEVEL_ALPHA: Record<Level, number> = { focus: 1, context: 0.3, hidden: 0 };

export interface ItemStyle {
  /** 0 … 1 opacity multiplier */
  alpha: number;
  /** 0 … 1 "growth" when appearing (arrows grow out of their base point) */
  grow: number;
  highlight: boolean;
}

interface Anim {
  alpha: number;
  target: number;
  grow: number;
  highlight: boolean;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export class Presentation {
  private items = new Map<string, Anim>();
  private annots = new Map<string, { alpha: number; target: number }>();
  private listeners = new Set<() => void>();
  private modeListeners = new Set<(m: ConceptMode) => void>();
  private commandListeners = new Set<(name: string) => void>();
  private dirty = true;
  private last = 0;
  private lastMode = '';
  private active = new Set<string>();
  private unsubs: (() => void)[] = [];

  constructor(readonly ws: Workspace) {
    for (const t of ['values', 'view', 'selection', 'emphasis', 'doc'] as const) this.unsubs.push(ws.on(t, () => (this.dirty = true)));
  }

  get mode(): ConceptMode {
    return getMode(this.ws.mode);
  }

  on(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** UI → renderer requests that are not state, e.g. 'flatten', 'shot:zoom'. */
  command(name: string) {
    this.commandListeners.forEach((l) => l(name));
  }
  onCommand(fn: (name: string) => void): () => void {
    this.commandListeners.add(fn);
    return () => this.commandListeners.delete(fn);
  }

  onModeChange(fn: (m: ConceptMode) => void): () => void {
    this.modeListeners.add(fn);
    return () => this.modeListeners.delete(fn);
  }

  /** Active emphasis keys (hover beats selection), expanded with related objects. */
  activeKeys(): Set<string> {
    return this.active;
  }

  isActive(keys: string[]): boolean {
    return keys.some((k) => this.active.has(k));
  }

  private recompute() {
    this.dirty = false;
    const ws = this.ws;
    const mode = this.mode;
    if (mode.id !== this.lastMode) {
      const first = this.lastMode === '';
      this.lastMode = mode.id;
      if (!first) this.modeListeners.forEach((l) => l(mode));
    }
    const base = ws.emphasis?.keys ?? ws.selectionKeys();
    const active = new Set(base);
    for (const k of base) related.get(k)?.forEach((r) => active.add(r));
    this.active = active;
    const isolate = !!ws.emphasis?.isolate;
    const seen = new Set<string>();
    for (const it of ws.sceneItems()) {
      seen.add(it.id);
      const override = ws.visibility.get(it.id);
      const level: Level = override === undefined ? (mode.level(it) ?? defaultLevel(it)) : override ? 'focus' : 'hidden';
      let target = LEVEL_ALPHA[level];
      const hit = active.size > 0 && it.keys.some((k) => active.has(k));
      // hovering an object explicitly reveals it even where the mode hides it
      if (hit && target === 0 && ws.emphasis) target = 0.75;
      if (active.size && target > 0) {
        if (hit) target = 1;
        else if (isolate) target = it.visual.vtype === 'point' ? 1 : 0.05;
        else target *= it.visual.vtype === 'surface' ? 0.75 : 0.4;
      }
      const a = this.items.get(it.id);
      if (a) {
        a.target = target;
        a.highlight = hit;
      } else this.items.set(it.id, { alpha: 0, target, grow: 0, highlight: hit });
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this.items.delete(id);
    const wanted = new Set(mode.annotations ?? []);
    for (const k of active) if (k.startsWith('annot:')) wanted.add(k.slice(6));
    for (const name of new Set([...wanted, ...this.annots.keys()])) {
      const a = this.annots.get(name) ?? { alpha: 0, target: 0 };
      a.target = wanted.has(name) ? 1 : 0;
      this.annots.set(name, a);
    }
  }

  /** Advance animations. Returns true if anything changed (renderers should redraw). */
  tick(now: number): boolean {
    const dt = this.last ? Math.max(0, Math.min(100, now - this.last)) : 16;
    this.last = now;
    let changed = false;
    if (this.dirty) {
      this.recompute();
      changed = true;
    }
    const k = 1 - Math.exp(-dt / 110);
    for (const a of [...this.items.values(), ...this.annots.values()]) {
      if (a.alpha !== a.target) {
        a.alpha += (a.target - a.alpha) * k;
        if (Math.abs(a.target - a.alpha) < 0.004) a.alpha = a.target;
        changed = true;
      }
    }
    for (const a of this.items.values()) {
      const g = a.target > 0 ? Math.min(1, a.grow + dt / 650) : a.alpha < 0.01 ? 0 : a.grow;
      if (g !== a.grow) {
        a.grow = g;
        changed = true;
      }
    }
    if (changed) this.listeners.forEach((l) => l());
    return changed;
  }

  style(itemId: string): ItemStyle {
    const a = this.items.get(itemId);
    if (!a) return { alpha: 0, grow: 0, highlight: false };
    return { alpha: a.alpha, grow: easeOut(a.grow), highlight: a.highlight };
  }

  annotation(name: string): number {
    return this.annots.get(name)?.alpha ?? 0;
  }

  destroy() {
    this.unsubs.forEach((u) => u());
  }
}