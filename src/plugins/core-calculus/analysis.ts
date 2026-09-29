/**
 * Local analysis at a point (framework-free): the numbers the Values / Explanation panels show.
 * Computed from the same primitives as the visuals (gradOf, hessianOf, symmetricEigen).
 */
import type { Workspace } from '../../runtime/workspace';
import { Evaluator } from '../../runtime/evaluator';
import { frameFromItems } from '../../visualization/sampling';
import type { FunctionValue, PointValue } from '../../math-core/values';
import { gradOf, hessianOf, localData } from './math';
import { symmetricEigen, EigenPair, normalize, dot, quadForm, det } from '../../math-core/linalg';
import { toLatex, symbolLatex } from '../../math-core/symbolic/print';
import { diff } from '../../math-core/symbolic/diff';

export interface DirectionInfo {
  name: string;
  color: string;
  u: number[];
  D: number;
  angleDeg: number;
  curvature: number;
}

export interface LocalAnalysis {
  fnName: string;
  fnLabel: string;
  pointName: string;
  p: number[];
  f0: number;
  g: number[];
  gNorm: number;
  H: number[][];
  eig: EigenPair[];
  detH: number;
  classification: string;
  directions: DirectionInfo[];
}

function evaluatorFor(ws: Workspace) {
  return new Evaluator({ lookup: (n) => ws.value(n) });
}

export function localAnalysis(ws: Workspace): LocalAnalysis | null {
  const items = ws.sceneItems();
  const frame = frameFromItems(items);
  let f: FunctionValue | undefined = frame.surface;
  if (!f) {
    const named = ws.statements().find((s) => {
      const v = ws.value(s.id) as FunctionValue | undefined;
      return v?.kind === 'function' && v.out === 'scalar' && v.params.length === 2;
    });
    f = named && (ws.value(named.id) as FunctionValue);
  }
  if (!f || f.params.length !== 2) return null;
  const sel = ws.selection && ws.value(ws.selection)?.kind === 'point' ? ws.selection : undefined;
  const pid = sel ?? ws.statements().find((s) => s.input?.kind === 'point')?.id ?? ws.statements().find((s) => ws.value(s.id)?.kind === 'point')?.id;
  if (!pid) return null;
  const p = (ws.value(pid) as PointValue).coords;
  if (p.length !== 2) return null;
  const ev = evaluatorFor(ws);
  let d;
  try {
    d = localData(ev, f, p);
  } catch {
    return null;
  }
  const eig = symmetricEigen(d.H);
  const gNorm = Math.hypot(d.g[0], d.g[1]);
  const detH = det(d.H);
  let classification: string;
  const tol = 1e-6 * (1 + Math.abs(d.f0));
  if (gNorm > 1e-6) classification = eig.every((e) => e.value > tol) ? 'not critical — surface curves upward in every direction here' : eig.every((e) => e.value < -tol) ? 'not critical — surface curves downward in every direction here' : eig.some((e) => e.value > tol) && eig.some((e) => e.value < -tol) ? 'not critical — saddle-shaped curvature here' : 'not critical';
  else if (eig.every((e) => e.value > tol)) classification = 'critical point: local minimum';
  else if (eig.every((e) => e.value < -tol)) classification = 'critical point: local maximum';
  else if (eig.some((e) => e.value > tol) && eig.some((e) => e.value < -tol)) classification = 'critical point: saddle';
  else classification = 'critical point: degenerate (second-derivative test inconclusive)';
  const directions: DirectionInfo[] = [];
  for (const it of items) {
    if (it.visual.vtype !== 'arrow' || it.visual.role === 'gradient') continue;
    const vec = it.visual.props.vec as number[];
    if (vec.length !== 2 || Math.hypot(vec[0], vec[1]) < 1e-12) continue;
    const u = normalize(vec);
    const D = dot(d.g, u);
    const angle = gNorm > 1e-12 ? (Math.acos(Math.max(-1, Math.min(1, D / gNorm))) * 180) / Math.PI : NaN;
    directions.push({ name: (it.visual.props.sourceId as string) ?? it.visual.label ?? 'u', color: it.color, u, D, angleDeg: angle, curvature: quadForm(d.H, u) });
  }
  const fnName = ws.statements().find((s) => ws.value(s.id) === f)?.name ?? 'f';
  return { fnName, fnLabel: f.label ?? 'f', pointName: pid, p, f0: d.f0, g: d.g, gNorm, H: d.H, eig, detH, classification, directions };
}

export interface SymbolicLine {
  label: string;
  latex: string;
}

/** Symbolic derivatives of a function node, for the Symbolic view / inspector. */
export function symbolicSummary(ws: Workspace, id: string): SymbolicLine[] {
  const v = ws.value(id);
  if (v?.kind !== 'function') return [];
  const f = v as FunctionValue;
  if (!f.expr || f.out !== 'scalar') return [];
  const name = f.label ?? symbolLatex(id);
  const vars = f.params.map(symbolLatex).join(', ');
  const out: SymbolicLine[] = [];
  try {
    if (f.params.length === 1) {
      const d1 = diff(f.expr, f.params[0]);
      out.push({ label: `${name}'(${vars})`, latex: toLatex(d1) });
      out.push({ label: `${name}''(${vars})`, latex: toLatex(diff(d1, f.params[0])) });
      return out;
    }
    const ev = evaluatorFor(ws);
    const g = gradOf(ev, f);
    const H = hessianOf(ev, f);
    f.params.forEach((p, i) => {
      if (g.expr?.type === 'vec') out.push({ label: `\\frac{\\partial ${name}}{\\partial ${symbolLatex(p)}}`, latex: toLatex(g.expr.items[i]) });
    });
    if (g.expr) out.push({ label: `\\nabla ${name}(${vars})`, latex: toLatex(g.expr) });
    if (H.expr) out.push({ label: `H_{${name}}(${vars})`, latex: toLatex(H.expr) });
  } catch {
    /* non-differentiable: no symbolic summary */
  }
  return out;
}