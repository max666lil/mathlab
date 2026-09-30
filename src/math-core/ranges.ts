/** Parameter ranges of curves and surfaces: declared with `for t in [a, b]`, otherwise sensible defaults. */
import type { FunctionValue } from './values';
import type { Expr } from './ast';

const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot']);
function usesTrig(e: Expr | undefined): boolean {
  if (!e) return false;
  let hit = false;
  const walk = (n: Expr) => {
    if (n.type === 'call' && n.callee.type === 'sym' && TRIG.has(n.callee.name)) hit = true;
    for (const c of childrenOf(n)) walk(c);
  };
  walk(e);
  return hit;
}
function childrenOf(e: Expr): Expr[] {
  switch (e.type) {
    case 'neg': return [e.arg];
    case 'bin': case 'eq': return [e.left, e.right];
    case 'call': return e.args;
    case 'tuple': case 'vec': case 'list': return e.items;
    default: return [];
  }
}

/** t-range of a curve: declared, else [0, 2π] (trigonometric) or [−2, 2]. */
export function curveRange(f: FunctionValue): [number, number] {
  const p = f.params[0];
  return f.ranges?.[p] ?? (usesTrig(f.expr) || f.role === 'polar' ? [0, 2 * Math.PI] : [-2, 2]);
}

/** (u, v)-ranges of a surface: declared, else [0, 2π] × [0, π] (trigonometric) or [−1, 1]². */
export function surfaceRanges(f: FunctionValue): [[number, number], [number, number]] {
  const [u, v] = f.params;
  const trig = usesTrig(f.expr);
  return [f.ranges?.[u] ?? (trig ? [0, 2 * Math.PI] : [-1, 1]), f.ranges?.[v] ?? (trig ? [0, Math.PI] : [-1, 1])];
}

