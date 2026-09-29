/**
 * Analyzers of linear algebra. A matrix is recognised as a linear map: the canvas shows the
 * transformation (2-D or 3-D by shape) with a timeline I → A; the analysis is a set of facts —
 * ordinary MLL expressions over the linear-algebra builtins — that compute only when opened.
 */
import { registerAnalyzer, AnalysisPlan, FactSpec, SectionSpec, WorkspaceLayout } from '../../runtime/analysis';
import type { Workspace } from '../../runtime/workspace';
import type { MatrixValue, VectorValue } from '../../math-core/values';
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

