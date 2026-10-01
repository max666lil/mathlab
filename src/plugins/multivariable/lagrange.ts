/**
 * Constrained optimisation (Phase 3a, Hughes-Hallett §15.2–15.3):
 *   maximize f subject to g = c          Lagrange: ∇f = λ∇g on the constraint
 *   minimize f subject to x^2 + y^2 <= 4 interior critical points + Lagrange on the boundary
 *   maximize x + y + z subject to x^2 + y^2 + z^2 = 1 and x = y
 * Candidates come from the Lagrange system solved by multi-start Newton (closed forms recognised for
 * display); on a bounded feasible set the largest / smallest candidate is the global max / min.
 */
import { Expr, num, sub } from '../../math-core/ast';
import { Builtin, EvalContext, EvalError, expectFunction } from '../../math-core/builtins';
import { FunctionValue, MathValue, entryLatex } from '../../math-core/values';
import { toLatex, symbolLatex } from '../../math-core/symbolic/print';
import { newtonSystem, gridSeeds, solve } from '../../math-core/numeric/roots';
import { visual } from '../../visualization/scene-model';
import { gradOf, asScalarField } from '../core-calculus/math';
import { bindEnv } from '../core-calculus/analysis-builtins';

interface Constraint {
  g: FunctionValue;
  /** '=' or '<=' (inequalities are normalised to g ≤ 0) */
  kind: '=' | '<=';
  latex: string;
}

export interface Candidate {
  coords: number[];
  lambdas: number[];
  value: number;
  /** which inequality constraints are active */
  where: string;
  label?: string;
}

export interface OptimumValue {
  kind: 'optimum';
  sense: 'max' | 'min' | 'both';
  objective: string;
  vars: string[];
  constraints: string[];
  candidates: Candidate[];
  bounded: boolean;
  certainty: 'numeric';
  evidence: string;
  [k: string]: unknown;
}

function constraintsOf(ctx: EvalContext, raw: Expr, vars: string[]): Constraint[] {
  const out: Constraint[] = [];
  const visit = (e: Expr) => {
    if (e.type === 'call' && e.callee.type === 'sym' && e.callee.name === 'and') return e.args.forEach(visit);
    if (e.type !== 'eq') throw new EvalError('constraints are equations or inequalities, e.g. x^2 + y^2 = 1 or x + y <= 4');
    const latex = toLatex(e);
    switch (e.rel) {
      case undefined:
        out.push({ g: ctx.makeFunction(sub(e.left, e.right), vars), kind: '=', latex });
        return;
      case '<':
      case '<=':
        out.push({ g: ctx.makeFunction(sub(e.left, e.right), vars), kind: '<=', latex });
        return;
      case '>':
      case '>=':
        out.push({ g: ctx.makeFunction(sub(e.right, e.left), vars), kind: '<=', latex });
        return;
      default:
        throw new EvalError(`'${e.rel}' is not a constraint`);
    }
  };
  visit(raw);
  return out;
}

/** Subsets of the inequality indices (each inequality active on the boundary or not). */
function subsets(ix: number[]): number[][] {
  return ix.reduce<number[][]>((acc, i) => [...acc, ...acc.map((s) => [...s, i])], [[]]);
}

export function optimize(ctx: EvalContext, f: FunctionValue, consRaw: Expr, sense: 'max' | 'min' | 'both', name: string): OptimumValue {
  asScalarField(f);
  const n = f.params.length;
  if (n < 2 || n > 3) throw new EvalError('constrained optimisation: f of two or three variables');
  const cons = constraintsOf(ctx, consRaw, f.params);
  const eqs = cons.filter((c) => c.kind === '=');
  const ineqs = cons.map((c, i) => (c.kind === '<=' ? i : -1)).filter((i) => i >= 0);
  if (eqs.length >= n) throw new EvalError('too many equality constraints for the number of variables');
  const F = f.eval as (...p: number[]) => number;
  const gf = gradOf(ctx, f).eval as (...p: number[]) => number[];
  const gs = cons.map((c) => ({ G: c.g.eval as (...p: number[]) => number, dG: gradOf(ctx, c.g).eval as (...p: number[]) => number[] }));
  const feasible = (p: number[]) => cons.every((c, i) => (c.kind === '=' ? Math.abs(gs[i].G(...p)) < 1e-7 : gs[i].G(...p) <= 1e-7));
  const box: [number, number][] = Array.from({ length: n }, () => [-3, 3]);
  const found: Candidate[] = [];
  const add = (c: Candidate) => {
    // clean Newton round-off (3.77999999996 → 3.78)
    c.coords = c.coords.map((x) => {
      const r = Math.round(x * 1e8) / 1e8;
      return Math.abs(x - r) < 1e-9 * Math.max(1, Math.abs(x)) ? r : x;
    });
    c.value = F(...c.coords);
    if (!c.coords.every(Number.isFinite) || !Number.isFinite(c.value) || !feasible(c.coords)) return;
    if (found.some((q) => q.coords.every((x, i) => Math.abs(x - c.coords[i]) < 1e-6))) return;
    found.push(c);
  };
  for (const active of subsets(ineqs)) {
    const act = [...cons.map((c, i) => (c.kind === '=' ? i : -1)).filter((i) => i >= 0), ...active];
    if (act.length > n) continue;
    const m = act.length;
    // n active constraints pin down vertices (corners of the feasible set): candidates whatever ∇f is there
    if (m === n) {
      const V = newtonSystem((x) => act.map((j) => gs[j].G(...x)), gridSeeds(box, 4));
      for (const x0 of V.solutions) {
        const x = x0.map((c) => (Math.abs(c) < 1e-12 ? 0 : c));
        add({ coords: x, lambdas: act.map(() => NaN), value: F(...x), where: 'corner' });
      }
      continue;
    }
    // ∇f − Σ λⱼ ∇gⱼ = 0, gⱼ = 0 for the active constraints
    const R = (u: number[]) => {
      const x = u.slice(0, n);
      const lam = u.slice(n);
      const g0 = gf(...x);
      const dGs = act.map((j) => gs[j].dG(...x));
      const res = g0.map((v, k) => v - dGs.reduce((s, d, q) => s + lam[q] * d[k], 0));
      for (const j of act) res.push(gs[j].G(...x));
      return res;
    };
    // λ seeded by least squares at each starting point (∇f ≈ Σ λⱼ∇gⱼ), one Newton run per point
    const lamAt = (x: number[]): number[][] => {
      if (m === 0) return [[]];
      const A = act.map((j) => gs[j].dG(...x));
      const g0 = gf(...x);
      const N = A.map((a) => A.map((b) => a.reduce((s, v, k) => s + v * b[k], 0)));
      const rhs = A.map((a) => a.reduce((s, v, k) => s + v * g0[k], 0));
      const lam = [...N.flat(), ...rhs].every(Number.isFinite) ? solve(N, rhs) : null;
      return lam && lam.every(Number.isFinite) ? [lam] : [act.map(() => 1), act.map(() => -1)];
    };
    const xSeeds = n === 2 ? [...gridSeeds(box, 7), ...gridSeeds([[-12, 12], [-12, 12]], 4)] : gridSeeds([[-2.5, 2.5], [-2.5, 2.5], [-2.5, 2.5]], 4);
    const seeds = xSeeds.flatMap((x) => lamAt(x).map((l) => [...x, ...l]));
    const r = newtonSystem(R, seeds);
    for (const u of r.solutions) {
      const x = u.slice(0, n).map((c) => (Math.abs(c) < 1e-12 ? 0 : c));
      add({ coords: x, lambdas: u.slice(n), value: F(...x), where: active.length ? 'boundary' : m ? 'constraint' : 'interior' });
    }
    // points of the constraint where ∇g = 0 (Lagrange's condition can miss them)
    if (m === 1) {
      const j = act[0];
      const S = (x: number[]) => [...gs[j].dG(...x), gs[j].G(...x)].slice(0, n + 1);
      const sing = newtonSystem((x) => S(x).slice(0, n), gridSeeds(box, 5));
      for (const x of sing.solutions) if (Math.abs(gs[j].G(...x)) < 1e-8) add({ coords: x, lambdas: [NaN], value: F(...x), where: 'singular point of the constraint' });
    }
  }
  if (!found.length) throw new EvalError('no candidates found (the constraint set may be empty, or outside the search box)');
  // bounded feasible set: no feasible sample far away
  const far = 40;
  let bounded = true;
  for (let k = 0; k < 400 && bounded; k++) {
    const dir = Array.from({ length: n }, (_, i) => Math.cos(k * 2.3999 + i * 1.7) * (i === n - 1 ? Math.sin(k * 0.37) + 1.2 : 1));
    const L = Math.hypot(...dir) || 1;
    // along each direction look for points satisfying the equalities approximately and the inequalities
    for (const s of [far, far * 1.5]) {
      const p = dir.map((d) => (d / L) * s);
      const okIneq = cons.every((c, i) => c.kind === '=' || gs[i].G(...p) <= 0);
      const okEq = eqs.length === 0 || cons.every((c, i) => c.kind === '<=' || Math.sign(gs[i].G(...p)) !== Math.sign(gs[i].G(...dir.map((d) => (d / L) * s * 1.1))));
      if (okIneq && okEq) bounded = false;
    }
  }
  found.sort((a, b) => b.value - a.value);
  const top = found[0].value;
  const bottom = found[found.length - 1].value;
  for (const c of found) {
    if (bounded && Math.abs(c.value - top) < 1e-9 * Math.max(1, Math.abs(top))) c.label = 'maximum';
    else if (bounded && Math.abs(c.value - bottom) < 1e-9 * Math.max(1, Math.abs(bottom))) c.label = 'minimum';
  }
  const vis = optimumVisuals(ctx, f, cons, found, sense, bounded);
  return {
    kind: 'optimum', sense, objective: name, vars: f.params, constraints: cons.map((c) => c.latex), candidates: found, bounded,
    certainty: 'numeric',
    evidence: `Lagrange system ∇f = λ∇g solved by Newton's method from many starting points${ineqs.length ? '; each inequality active or not (interior critical points included)' : ''}; ${bounded ? 'the feasible set is bounded, so the largest / smallest candidate is the global max / min' : 'the feasible set is unbounded: candidates are not guaranteed to be global extrema'}`,
    visuals: vis,
  };
}

function optimumVisuals(ctx: EvalContext, f: FunctionValue, cons: Constraint[], cands: Candidate[], sense: string, bounded: boolean) {
  const n = f.params.length;
  const best = cands.find((c) => c.label === (sense === 'min' ? 'minimum' : 'maximum')) ?? cands[0];
  const out = [];
  const levelAt = (c: number) => ctx.makeFunction(sub(bindEnv(f.expr!, f.env), num(c)), f.params);
  if (n === 2) {
    out.push(visual('contours', { fn: f }, 'contours', 'contours'));
    for (const c of cons) out.push(c.kind === '=' ? visual('implicit', { fn: c.g }, c.latex, 'constraint') : visual('region', { fn: c.g, rel: '<=' }, c.latex, 'constraint'));
    out.push(visual('markers', { set: { dim: 2, points: cands.map((c) => ({ coords: c.coords, value: c.value, type: c.label ?? 'candidate' })) } }, 'candidates', 'critical'));
    if (f.expr && bounded) {
      // the level curve sweeps towards the optimum and touches the constraint there
      const vals = cands.map((c) => c.value);
      const spread = Math.max(...vals) - Math.min(...vals) || Math.abs(best.value) || 1;
      const from = sense === 'min' ? best.value - 0.8 * spread : best.value + 0.8 * spread;
      // frame the picture around the candidates
      const xs = cands.map((c) => c.coords[0]);
      const ys = cands.map((c) => c.coords[1]);
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
      const pad = 0.6 * span;
      const box = [[Math.min(...xs) - pad, Math.max(...xs) + pad], [Math.min(...ys) - pad, Math.max(...ys) + pad]];
      out.push(visual('levelsweep', { fn: f, from, to: best.value, box, timeline: `lagrange:${f.key}`, stops: ['', `${f.label ?? 'f'} = ${+best.value.toPrecision(5)}`], stages: `${f.key}|${best.value}` }, 'level curve', 'level'));
      out.push(visual('implicit', { fn: levelAt(best.value) }, 'optimal level', 'level'));
    }
  } else {
    for (const c of cons) out.push(visual('isosurface', { fn: c.g, levels: [0], box: [[-2.5, 2.5], [-2.5, 2.5], [-2.5, 2.5]], solid: true }, c.latex, 'constraint'));
    if (f.expr) out.push(visual('isosurface', { fn: f, levels: [best.value], box: [[-2.5, 2.5], [-2.5, 2.5], [-2.5, 2.5]], flat: false }, 'optimal level surface', 'level'));
    for (const c of cands) out.push(visual('point', { coords: c.coords }, c.label ?? 'candidate', 'critical'));
  }
  // ∇f ∥ ∇g at the optimum
  const g0 = gradOf(ctx, f).eval(...best.coords) as number[];
  const unit = (v: number[]) => {
    const L = Math.hypot(...v) || 1;
    return v.map((x) => (0.8 * x) / L);
  };
  out.push(visual('arrow', { anchor: best.coords, vec: unit(g0) }, '∇f', 'gradient'));
  for (const c of cons.slice(0, 1)) out.push(visual('arrow', { anchor: best.coords, vec: unit(gradOf(ctx, c.g).eval(...best.coords) as number[]) }, '∇g', 'direction'));
  return out;
}

export function optimumLatex(o: OptimumValue): string {
  const head = `\\text{${o.sense === 'max' ? 'maximize' : o.sense === 'min' ? 'minimize' : 'extremize'} } ${o.objective} \\text{ subject to } ${o.constraints.join(',\\ ')}`;
  const rows = o.candidates.map((c) => {
    const pt = `(${c.coords.map((x) => entryLatex(x, true)).join(', ')})`;
    const lam = c.lambdas.length ? c.lambdas.map((l) => (Number.isFinite(l) ? entryLatex(l, true) : '—')).join(', ') : '—';
    return `${pt} & ${lam} & ${entryLatex(c.value, true)} & \\text{${c.label ?? c.where}}`;
  });
  return `\\begin{array}{l} ${head} \\\\ \\begin{array}{c|c|c|l} \\text{point} & \\lambda & ${o.objective} & \\\\ \\hline ${rows.join(' \\\\ ')} \\end{array} \\end{array}`;
}

const make = (sense: 'max' | 'min' | 'both', nm: string): Builtin => ({
  name: nm, command: true, minArgs: 1, maxArgs: 1, argModes: ['function'], keywords: { subject: 'raw' }, category: 'multivariable',
  signature: `${nm} f subject to g = c [and …]`, doc: sense === 'both' ? 'Lagrange candidates of f on the constraint set (∇f = λ∇g).' : `${sense === 'max' ? 'Maximum' : 'Minimum'} of f subject to equality / inequality constraints (Lagrange multipliers).`,
  apply: ([fv], ctx, raw, kw) => {
    const c = kw.raw.subject;
    if (!c) throw new EvalError(`say the constraint: ${nm} f subject to g = c`);
    const f = expectFunction(fv);
    const name = raw[0]?.type === 'sym' ? symbolLatex(raw[0].name) : f.expr ? toLatex(bindEnv(f.expr, f.env)) : 'f';
    return optimize(ctx, f, c, sense, name) as unknown as MathValue;
  },
});

export const lagrangeBuiltins: Builtin[] = [make('max', 'maximize'), make('min', 'minimize'), make('both', 'lagrange')];