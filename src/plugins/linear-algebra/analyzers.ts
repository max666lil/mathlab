/**
 * Analyzers of linear algebra. A matrix is recognised as a linear map: the canvas shows the
 * transformation (2-D or 3-D by shape) with a timeline I → A; the analysis is a set of facts —
 * ordinary MLL expressions over the linear-algebra builtins — that compute only when opened.
 */
import { registerAnalyzer, AnalysisPlan, FactSpec, SectionSpec, WorkspaceLayout } from '../../runtime/analysis';
import type { Workspace } from '../../runtime/workspace';
import type { MathValue, MatrixValue, VectorValue, ListValue, FunctionValue } from '../../math-core/values';
import type { SubspaceValue, AffineValue } from './values';
import { linearMatrixOf } from './builtins';
import { valueLatex } from '../../math-core/values';
import { symbolLatex } from '../../math-core/symbolic/print';
import { registerRelation } from '../../visualization/presentation';
import { isSymmetric } from './eigen';

registerRelation('role:eigen', ['role:lintrans']);
registerRelation('role:nullspace', ['role:lintrans']);

/** First named free vector of dimension n (tracked by the transformation). */
function firstVector(ws: Workspace, n: number): string | undefined {
  const vs = ws.statements().filter((s) => {
    const v = s.name ? ws.value(s.id) : undefined;
    return v?.kind === 'vector' && (v as VectorValue).comps.length === n && !(v as VectorValue).anchor && !v.derivation;
  });
  return (vs.find((s) => s.input?.kind === 'vector') ?? vs[0])?.name;
}

export function matrixLayout(name: string, rows: number[][]): WorkspaceLayout {
  const m = rows.length;
  const n = rows[0]?.length ?? 0;
  const timeline = { key: `lin:${name}`, stops: ['I', name], signature: JSON.stringify(rows) };
  if (m === 2 && n === 2)
    return {
      canvasTitle: `Transformation ${name}`,
      views: [{ id: 'plane', label: '2D', renderer: 'plane' }],
      defaultView: 'plane',
      timeline,
    };
  if (m <= 3 && n <= 3 && Math.max(m, n) === 3)
    return { canvasTitle: `Transformation ${name}`, views: [{ id: 'space', label: '3D', renderer: 'scene' }], defaultView: 'space', timeline };
  return { canvasTitle: 'Matrix', views: [{ id: 'plane', label: 'Plane', renderer: 'plane' }], defaultView: 'plane' };
}

registerAnalyzer({
  id: 'matrix',
  focusOnEdit: true,
  recognizes: (v) => v.kind === 'matrix' && (v as MatrixValue).rows.length > 0,
  plan(A, value, ws): AnalysisPlan {
    const rows = (value as MatrixValue).rows;
    const m = rows.length;
    const n = rows[0].length;
    const sq = m === n;
    const drawable = m <= 3 && n <= 3 && Math.max(m, n) >= 2;
    const v = firstVector(ws, n);
    const sections: SectionSpec[] = [{ id: 'overview', title: 'Summary', summary: true, why: sq ? 'det' : 'columns' }];
    const facts: FactSpec[] = [];
    const f = (id: string, title: string, expr: string, section: string, extra: Partial<FactSpec> = {}) =>
      facts.push({ id, title, expr, tier: section === 'overview' ? 0 : 1, section, ...extra });

    if (drawable) f('transformation', 'Transformation', `transformation(${A}${v ? `, ${v}` : ''})`, 'overview', { visual: 'always', hidden: true, tier: 0 });
    if (sq) f('det', 'det', `det(${A})`, 'overview', { pinName: 'd' });
    f('rank', 'Rank', `rank(${A})`, 'overview', { pinName: 'r' });

    if (sq) {
      sections.push({ id: 'eigen', title: 'Eigenvalues & eigenvectors', why: 'eigen' });
      f('eigen', 'Eigen', `eigen(${A})`, 'eigen', { pinName: 'E', visual: 'auto' });
      f('diagonalizable', 'Diagonalizable', `diagonalizable(${A})`, 'eigen');
      f('diagonalize', 'A = PDP⁻¹', `diagonalize(${A})`, 'eigen', { pinName: 'F' });
      f('charpoly', 'Characteristic polynomial', `charpoly(${A})`, 'eigen', { pinName: 'p' });
    }

    sections.push({ id: 'subspaces', title: 'Null space & column space', why: 'rank' });
    f('nullspace', 'Null space', `nullspace(${A})`, 'subspaces', { pinName: 'N', visual: 'auto' });
    f('columnspace', 'Column space', `columnspace(${A})`, 'subspaces', { pinName: 'Col', visual: 'auto' });
    f('rowspace', 'Row space', `rowspace(${A})`, 'subspaces', { pinName: 'Row' });
    f('nullity', 'Nullity', `nullity(${A})`, 'subspaces');

    sections.push({ id: 'inverse', title: sq ? 'Inverse & row reduction' : 'Row reduction', why: sq ? 'inverse' : undefined });
    if (sq) {
      f('invertible', 'Invertible', `invertible(${A})`, 'inverse');
      f('inverse', 'Inverse', `inverse(${A})`, 'inverse', { pinName: `${A}inv` });
    }
    f('rref', 'rref', `rref(${A})`, 'inverse', { pinName: 'R' });

    sections.push({ id: 'decomp', title: 'Decompositions' });
    if (sq && isSymmetric(rows)) f('orthodiag', 'A = QDQᵀ', `orthodiagonalize(${A})`, 'decomp', { pinName: 'S' });
    f('svd', 'SVD', `svd(${A})`, 'decomp', { pinName: 'SVD' });
    f('qr', 'QR', `qr(${A})`, 'decomp', { pinName: 'QR' });

    const example = n === 3 ? '<1, 2, 1>' : n === 2 ? '<1, 2>' : `<${Array(n).fill(1).join(', ')}>`;
    if (v) {
      sections.push({ id: 'vectors', title: `Where ${v} goes` });
      f('image', `${A}${v}`, `${A} ${v}`, 'vectors', { pinName: 'w' });
    } else if (drawable) {
      sections.push({ id: 'vectors', title: 'Follow a vector', actions: [{ label: `Add a vector v and its image ${A}v`, rows: [`v = ${example} draggable`, `w = ${A} v`] }] });
    }

    return {
      object: A,
      typeLabel: `${m}×${n} matrix${sq ? '' : ` · ℝ${sup(n)} → ℝ${sup(m)}`}`,
      layout: matrixLayout(A, rows),
      title: `${symbolLatex(A)} = ${valueLatex(value)}`,
      sections,
      facts,
      relations: [],
      diagnostics: [],
    };
  },
});

const SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const sup = (n: number) => (n === 1 ? '' : (SUP[n] ?? `^${n}`));

// ------------------------------------------------------------------ subspaces, vector lists, solution sets, linear maps

const spaceLayout = (title: string, dim: number): WorkspaceLayout =>
  dim === 3
    ? { canvasTitle: title, views: [{ id: 'space', label: '3D', renderer: 'scene' }], defaultView: 'space' }
    : { canvasTitle: title, views: [{ id: 'plane', label: '2D', renderer: 'plane' }], defaultView: 'plane' };

registerAnalyzer({
  id: 'subspace',
  focusOnEdit: true,
  recognizes: (v) => v.kind === 'subspace',
  plan(W, value): AnalysisPlan {
    const s = value as unknown as SubspaceValue;
    const facts: FactSpec[] = [
      { id: 'dim', title: 'Dimension', expr: `dim(${W})`, tier: 0, section: 'overview', pinName: 'k' },
      { id: 'basis', title: 'Basis', expr: `basis(${W})`, tier: 0, section: 'overview', pinName: 'B' },
      { id: 'orthogonal', title: 'Orthogonal basis', expr: `gramschmidt(${W})`, tier: 1, section: 'ortho', pinName: 'U' },
      { id: 'orthonormal', title: 'Orthonormal basis', expr: `orthonormal(${W})`, tier: 1, section: 'ortho', pinName: 'Q' },
    ];
    return {
      object: W,
      typeLabel: `subspace of ℝ${sup(s.ambient)} · dim ${s.basis.length}`,
      layout: spaceLayout(`Subspace ${W}`, s.ambient),
      title: `${symbolLatex(W)} = ${valueLatex(value)}`,
      sections: [
        { id: 'overview', title: 'Summary', summary: true },
        { id: 'ortho', title: 'Orthogonal bases (Gram–Schmidt)' },
      ],
      facts,
      relations: [],
      diagnostics: [],
    };
  },
});

const isVectorList = (v: MathValue) => {
  if (v.kind !== 'list') return false;
  const items = (v as ListValue).items;
  return items.length > 0 && items.every((it) => it.kind === 'vector' && (it as VectorValue).comps.length === (items[0] as VectorValue).comps.length);
};

registerAnalyzer({
  id: 'vector-list',
  focusOnEdit: true,
  recognizes: isVectorList,
  plan(S, value): AnalysisPlan {
    const items = (value as ListValue).items as VectorValue[];
    const n = items[0].comps.length;
    const facts: FactSpec[] = [
      { id: 'self', title: S, expr: S, tier: 0, section: 'overview', visual: 'always', hidden: true },
      { id: 'independent', title: 'Independent', expr: `independent(${S})`, tier: 0, section: 'overview' },
      { id: 'dim', title: 'dim span', expr: `dim(${S})`, tier: 0, section: 'overview' },
      { id: 'span', title: 'Span', expr: `span(${S})`, tier: 1, section: 'span', pinName: 'W', visual: 'auto' },
      { id: 'basis', title: 'Basis of the span', expr: `basis(${S})`, tier: 1, section: 'span', pinName: 'B' },
      { id: 'matrix', title: 'As columns', expr: `matrix(${S})`, tier: 1, section: 'span', pinName: 'M' },
      { id: 'orthogonal', title: 'Gram–Schmidt', expr: `gramschmidt(${S})`, tier: 1, section: 'ortho', pinName: 'U' },
      { id: 'orthonormal', title: 'Orthonormal', expr: `orthonormal(${S})`, tier: 1, section: 'ortho', pinName: 'Q' },
    ];
    return {
      object: S,
      typeLabel: `${items.length} vector${items.length === 1 ? '' : 's'} in ℝ${sup(n)}`,
      layout: spaceLayout('Vectors', n),
      title: `${symbolLatex(S)} = ${valueLatex(value)}`,
      sections: [
        { id: 'overview', title: 'Summary', summary: true },
        { id: 'span', title: 'Span & basis' },
        { id: 'ortho', title: 'Orthogonalize' },
      ],
      facts,
      relations: [],
      diagnostics: [],
    };
  },
});

registerAnalyzer({
  id: 'affine',
  recognizes: (v) => v.kind === 'affine',
  plan(X, value): AnalysisPlan {
    const a = value as unknown as AffineValue;
    return {
      object: X,
      typeLabel: `solution set in ℝ${sup(a.ambient)}`,
      layout: spaceLayout('Row picture', a.ambient),
      title: `${symbolLatex(X)}:\\ ${valueLatex(value)}`,
      sections: [{ id: 'overview', title: 'Summary', summary: true }],
      facts: [
        { id: 'self', title: 'Solutions', expr: X, tier: 0, section: 'overview' }, // drawn by the worksheet object itself
        ...(a.consistent ? [{ id: 'dim', title: 'Free parameters', expr: `${X}.dim`, tier: 0 as const, section: 'overview' }] : []),
      ],
      relations: [],
      diagnostics: [],
    };
  },
});

registerAnalyzer({
  id: 'linear-map',
  focusOnEdit: true,
  recognizes: (v) => {
    const f = v as FunctionValue;
    return v.kind === 'function' && f.out === 'vector' && f.params.length >= 2 && f.params.length <= 3 && !!linearMatrixOf(f);
  },
  plan(T, value): AnalysisPlan {
    const rows = linearMatrixOf(value as FunctionValue)!;
    const M = `standardmatrix(${T})`;
    const sq = rows.length === rows[0].length;
    const facts: FactSpec[] = [
      { id: 'transformation', title: 'Transformation', expr: `transformation(${T})`, tier: 0, section: 'overview', visual: 'always', hidden: true },
      { id: 'matrix', title: 'Standard matrix', expr: M, tier: 0, section: 'overview', pinName: 'A' },
      ...(sq ? [{ id: 'det', title: 'det', expr: `det(${M})`, tier: 0 as const, section: 'overview' }] : []),
      ...(sq ? [{ id: 'eigen', title: 'Eigen', expr: `eigen(${M})`, tier: 1 as const, section: 'eigen', pinName: 'E', visual: 'auto' as const }] : []),
      { id: 'nullspace', title: 'Kernel', expr: `nullspace(${M})`, tier: 1, section: 'subspaces', pinName: 'N', visual: 'auto' },
      { id: 'columnspace', title: 'Range', expr: `columnspace(${M})`, tier: 1, section: 'subspaces', pinName: 'Col', visual: 'auto' },
    ];
    return {
      object: T,
      typeLabel: `linear map ℝ${sup(rows[0].length)} → ℝ${sup(rows.length)}`,
      layout: { ...matrixLayout(T, rows), canvasTitle: `Linear map ${T}` },
      title: valueLatex(value),
      sections: [
        { id: 'overview', title: 'Summary', summary: true, why: 'columns' },
        ...(sq ? [{ id: 'eigen', title: 'Eigenvalues & eigenvectors' }] : []),
        { id: 'subspaces', title: 'Kernel & range' },
      ],
      facts,
      relations: [],
      diagnostics: [],
    };
  },
});
