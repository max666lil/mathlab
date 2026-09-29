/** Visual objects of linear algebra: the animated transformation, and default visuals of the result kinds. */
import { Builtin, EvalError } from '../../math-core/builtins';
import { MathValue, MatrixValue, VectorValue, VisualValue, FunctionValue } from '../../math-core/values';
import { linearMatrixOf } from './builtins';
import { det } from '../../math-core/linalg';
import { visual, ROLE_COLORS } from '../../visualization/scene-model';
import { LinTransProps, TrackedVector, embed } from './lintrans';
import type { EigenValue, SubspaceValue, FactorizationValue } from './values';

Object.assign(ROLE_COLORS, {
  lintrans: '#3fa9f5',
  eigen: '#c792ea',
  nullspace: '#ff6b6b',
  colspace: '#4cc9f0',
  rowspace: '#52d69b',
  span: '#4cc9f0',
  projection: '#ffd166',
  solution: '#ff8fab',
});

const mul = (A: number[][], B: number[][]) => A.map((r) => B[0].map((_, j) => r.reduce((s, x, k) => s + x * B[k][j], 0)));

/**
 * transformation(A, v, …) — the plane / space deformed by A, carrying v along.
 * transformation(A, B) — B first, then A (stops I → B → AB): composition reads right to left.
 */
export const transformationBuiltin: Builtin = {
  name: 'transformation', minArgs: 1, maxArgs: 8, category: 'linear algebra', signature: 'transformation(A, v, …)  |  transformation(A, B)',
  doc: 'The animated linear transformation: grid, basis vectors, unit cell (area = |det|), vectors carried along. With several matrices: applied right to left, step by step.',
  apply: (args, _ctx, raw) => {
    const mats: { rows: number[][]; name: string; id?: string }[] = [];
    const vectors: TrackedVector[] = [];
    args.forEach((a, i) => {
      const name = raw[i]?.type === 'sym' ? raw[i].name : undefined;
      if (a?.kind === 'matrix') mats.push({ rows: (a as MatrixValue).rows, name: name ?? (mats.length ? 'B' : 'A'), id: name });
      else if (a?.kind === 'function') {
        const rows = linearMatrixOf(a as FunctionValue);
        if (!rows) throw new EvalError(`${name ?? 'the function'} is not linear`);
        mats.push({ rows, name: name ?? 'T' });
      }
      else if (a?.kind === 'vector') vectors.push({ comps: (a as VectorValue).comps, label: name ?? 'v', sourceId: name });
      else throw new EvalError(`transformation: expected matrices and vectors, got ${a?.kind}`);
    });
    if (!mats.length) throw new EvalError('transformation needs a matrix');
    const n = Math.max(...mats.map((m) => Math.max(m.rows.length, m.rows[0].length)));
    if (n > 3) throw new EvalError('transformation can be drawn for matrices up to 3×3');
    const sq = mats.map((m) => {
      const e = embed(m.rows);
      return e.length === n ? e : embed([...e.map((r) => [...r, ...Array(n - r.length).fill(0)]), ...Array(n - e.length).fill(Array(n).fill(0))]);
    });
    // cumulative products, rightmost first
    const stages: number[][][] = [];
    let acc: number[][] | null = null;
    for (let k = sq.length - 1; k >= 0; k--) {
      acc = acc ? mul(sq[k], acc) : sq[k];
      stages.push(acc);
    }
    const names = mats.map((m) => m.name);
    const stops = ['I', ...names.map((_, k) => names.slice(names.length - 1 - k).join(''))];
    const pad = (v: number[]) => [...v, ...Array(Math.max(0, n - v.length)).fill(0)].slice(0, n);
    const props: LinTransProps = {
      stages, stops, n,
      timeline: `lin:${names.join('')}`,
      name: names.join(''),
      sourceId: mats.length === 1 ? mats[0].id : undefined,
      vectors: vectors.map((v) => ({ ...v, comps: pad(v.comps) })),
      det: det(stages[stages.length - 1]),
    };
    return visual('lintrans', props as unknown as Record<string, unknown>, `transformation ${names.join('')}`, 'lintrans');
  },
};

export function eigenVisual(v: MathValue, name?: string): VisualValue[] {
  const e = v as unknown as EigenValue;
  return [visual('eigenlines', { e, timeline: e.of ? `lin:${e.of}` : undefined }, name ?? 'eigen-lines', 'eigen')];
}

export function affineVisual(v: MathValue, name?: string): VisualValue[] {
  return [visual('affine', { a: v }, name ?? 'solutions', 'solution')];
}

export function subspaceVisual(v: MathValue, name?: string): VisualValue[] {
  const s = v as unknown as SubspaceValue;
  return [visual('subspace', { s, timeline: s.of ? `lin:${s.of}` : undefined }, name ?? s.what, s.role ?? 'span')];
}

const T = (A: number[][]) => A[0].map((_, j) => A.map((r) => r[j]));
const pad = (A: number[][], n: number) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => A[i]?.[j] ?? 0));

/**
 * A factorization as a stepped transformation: A = P D P⁻¹ plays P⁻¹ → D → P, A = U Σ Vᵀ plays
 * Vᵀ (rotate) → Σ (stretch) → U (rotate), A = Q R plays R → Q. It replaces the plain I → A morph while shown.
 */
export function factorizationVisual(v: MathValue, name?: string): VisualValue[] {
  const f = v as unknown as FactorizationValue;
  const F = Object.fromEntries(f.factors);
  const owner = f.of ?? 'A';
  let steps: [string, number[][]][];
  if (f.what === 'diagonalization') steps = [['P⁻¹', F.Pinv], ['D', F.D], ['P', F.P]];
  else if (f.what === 'orthogonal diagonalization') steps = [['Qᵀ', T(F.Q)], ['D', F.D], ['Q', F.Q]];
  else if (f.what === 'SVD') steps = [['Vᵀ', T(F.V)], ['Σ', F.S], ['U', F.U]];
  else if (f.what === 'QR') steps = [['R', F.R], ['Q', F.Q]];
  else return [];
  const n = Math.max(...steps.flatMap(([, M]) => [M.length, M[0]?.length ?? 0]));
  if (n > 3 || n < 2) return [];
  const stages: number[][][] = [];
  let acc: number[][] | null = null;
  for (const [, M] of steps) {
    const S = pad(M, n);
    acc = acc ? mul(S, acc) : S;
    stages.push(acc);
  }
  const stops = ['I', ...steps.map(([s], k) => (k === steps.length - 1 ? owner : steps.slice(0, k + 1).map(([x]) => x).reverse().join('')))];
  const props: LinTransProps & { base: string } = {
    stages, stops, n, name: owner, vectors: [], det: det(stages[stages.length - 1]),
    timeline: `lin:${owner}:${f.what}`,
    base: owner,
  };
  return [visual('lintrans', props as unknown as Record<string, unknown>, name ?? f.what, 'lintrans')];
}
