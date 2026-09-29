/** Visual objects of linear algebra: the animated transformation, and default visuals of the result kinds. */
import { Builtin, EvalError } from '../../math-core/builtins';
import { MathValue, MatrixValue, VectorValue, VisualValue } from '../../math-core/values';
import { det } from '../../math-core/linalg';
import { visual, ROLE_COLORS } from '../../visualization/scene-model';
import { LinTransProps, TrackedVector, embed } from './lintrans';
import type { EigenValue, SubspaceValue } from './values';

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

export function subspaceVisual(v: MathValue, name?: string): VisualValue[] {
  const s = v as unknown as SubspaceValue;
  return [visual('subspace', { s, timeline: s.of ? `lin:${s.of}` : undefined }, name ?? s.what, s.role ?? 'span')];
}