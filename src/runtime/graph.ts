/**
 * Generic reactive dependency graph. Value-agnostic: the same machinery drives
 * P → ∇f(P) → tangent plane today and X → Y = X² → pdf(Y) later.
 *
 * - `define` replaces the whole node set (document rebuild); cycles become node errors.
 * - `setInput` changes an input node and recomputes only its descendants, in topological order.
 */

export interface NodeDef<V> {
  id: string;
  deps: string[];
  compute: (get: (id: string) => V) => V;
  /** Input nodes can be overwritten with `setInput` (sliders, draggable points). */
  input?: boolean;
  /** Reserved: expensive nodes (Monte Carlo) may later be computed off the main thread. */
  heavy?: boolean;
  /**
   * What the node computes (its source text). On `define`, a node whose signature and dependencies are
   * unchanged — and whose dependencies were not recomputed — keeps its previous value instead of being
   * computed again (an edit in one row does not re-run every script and solver in the document).
   */
  sig?: string;
  /** always recompute (results that arrive asynchronously, e.g. R blocks) */
  volatile?: boolean;
}

export interface NodeState<V> {
  def: NodeDef<V>;
  value?: V;
  error?: Error;
  version: number;
}

export class DependencyError extends Error {
  constructor(public dep: string) {
    super(`Depends on '${dep}', which has an error`);
  }
}

export class CycleError extends Error {
  constructor(public cycle: string[]) {
    super(`Circular definition: ${cycle.join(' → ')}`);
  }
}

export class Graph<V> {
  private nodes = new Map<string, NodeState<V>>();
  private order: string[] = [];
  private dependents = new Map<string, string[]>();
  private listeners = new Set<(changed: string[]) => void>();

  define(defs: NodeDef<V>[]) {
    const old = this.nodes;
    this.nodes = new Map(defs.map((d) => [d.id, { def: d, version: 0 }]));
    this.dependents = new Map(defs.map((d) => [d.id, []]));
    for (const d of defs) for (const dep of d.deps) this.dependents.get(dep)?.push(d.id);
    this.order = this.topoSort();
    // incremental: keep the values of unchanged nodes whose inputs did not change
    const changed = new Set<string>();
    for (const id of this.order) {
      const n = this.nodes.get(id)!;
      const o = old.get(id);
      const d = n.def;
      const same =
        o && !d.volatile && d.sig !== undefined && o.def.sig === d.sig && !(n.error instanceof CycleError) && !(o.error instanceof CycleError) &&
        o.def.deps.length === d.deps.length && d.deps.every((x, i) => x === o.def.deps[i] && !changed.has(x)) &&
        d.deps.every((x) => this.nodes.has(x) === old.has(x));
      if (same) {
        n.value = o!.value;
        n.error = o!.error;
        n.version = o!.version;
      } else {
        this.computeNode(n);
        changed.add(id);
      }
    }
    this.emit(this.order);
  }

  private topoSort(): string[] {
    const order: string[] = [];
    const state = new Map<string, 0 | 1 | 2>(); // 0 new, 1 visiting, 2 done
    const stack: string[] = [];
    const visit = (id: string) => {
      const s = state.get(id) ?? 0;
      if (s === 2) return;
      if (s === 1) {
        const cycle = stack.slice(stack.indexOf(id)).concat(id);
        for (const c of cycle) {
          const n = this.nodes.get(c);
          if (n) n.error = new CycleError(cycle);
        }
        return;
      }
      state.set(id, 1);
      stack.push(id);
      for (const dep of this.nodes.get(id)?.def.deps ?? []) if (this.nodes.has(dep)) visit(dep);
      stack.pop();
      state.set(id, 2);
      order.push(id);
    };
    for (const id of this.nodes.keys()) visit(id);
    return order;
  }

  private computeNode(n: NodeState<V>) {
    if (n.error instanceof CycleError) return;
    const get = (id: string): V => {
      const d = this.nodes.get(id);
      if (!d) throw new Error(`Unknown '${id}'`);
      if (d.error || d.value === undefined) throw new DependencyError(id);
      return d.value;
    };
    try {
      n.value = n.def.compute(get);
      n.error = undefined;
    } catch (e) {
      n.value = undefined;
      n.error = e instanceof Error ? e : new Error(String(e));
    }
    n.version++;
  }


  /** All transitive dependents of `ids`, in topological order (excluding the ids themselves). */
  descendants(ids: string[]): string[] {
    const mark = new Set<string>();
    const walk = (id: string) => {
      for (const d of this.dependents.get(id) ?? []) {
        if (!mark.has(d)) {
          mark.add(d);
          walk(d);
        }
      }
    };
    ids.forEach(walk);
    return this.order.filter((id) => mark.has(id));
  }

  /** All transitive dependencies of `id`. */
  ancestors(id: string): string[] {
    const mark = new Set<string>();
    const walk = (x: string) => {
      for (const d of this.nodes.get(x)?.def.deps ?? []) {
        if (this.nodes.has(d) && !mark.has(d)) {
          mark.add(d);
          walk(d);
        }
      }
    };
    walk(id);
    return this.order.filter((x) => mark.has(x));
  }

  /** Overwrite an input node's value and propagate. Returns the recomputed ids. */
  setInput(id: string, value: V, notify = true): string[] {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Unknown node '${id}'`);
    n.value = value;
    n.error = undefined;
    n.version++;
    const desc = this.descendants([id]);
    for (const d of desc) {
      const dn = this.nodes.get(d);
      if (dn) this.computeNode(dn);
    }
    if (notify) this.emit([id, ...desc]);
    return [id, ...desc];
  }

  has(id: string) {
    return this.nodes.has(id);
  }
  get(id: string): NodeState<V> | undefined {
    return this.nodes.get(id);
  }
  value(id: string): V | undefined {
    return this.nodes.get(id)?.value;
  }
  ids(): string[] {
    return this.order.slice();
  }
  deps(id: string): string[] {
    return this.nodes.get(id)?.def.deps.filter((d) => this.nodes.has(d)) ?? [];
  }
  dependentsOf(id: string): string[] {
    return this.dependents.get(id)?.slice() ?? [];
  }

  subscribe(fn: (changed: string[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(changed: string[]) {
    for (const l of this.listeners) l(changed);
  }
}
