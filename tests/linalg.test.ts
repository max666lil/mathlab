import { describe, it, expect, beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';
import { valueLatex } from '../src/math-core/values';
import { QF, numericField, toFrac } from '../src/plugins/linear-algebra/field';
import * as alg from '../src/plugins/linear-algebra/algorithms';
import { eigenOf, polyRoots } from '../src/plugins/linear-algebra/eigen';
import { svdOf } from '../src/plugins/linear-algebra/decomp';
import { matMul, transpose } from '../src/math-core/linalg';

beforeAll(() => installMathLab());

/** Evaluate the last cell of a small program. */
function run(...cells: string[]) {
  const ws = new Workspace(cells);
  const sts = ws.statements();
  const node = ws.node(sts[sts.length - 1].id)!;
  if (node.error) throw new Error(node.error.message);
  return node.value as any;
}
const round = (xs: number[]) => xs.map((x) => +x.toFixed(9) + 0);

describe('field-generic algorithms', () => {
  const Q = (rows: number[][]) => rows.map((r) => r.map((x) => toFrac(x)!));
  const N = (A: any[][]) => A.map((r) => r.map((x) => QF.num(x)));
  it('exact rref, det, inverse', () => {
    const A = Q([[2, 1], [1, 2]]);
    expect(QF.num(alg.det(QF, A))).toBe(3);
    expect(N(alg.inverse(QF, A)!)).toEqual([[2 / 3, -1 / 3], [-1 / 3, 2 / 3]]);
    const { R, pivots } = alg.rref(QF, Q([[1, 2, 3], [4, 5, 6], [7, 8, 9]]));
    expect(pivots).toEqual([0, 1]);
    expect(N(R)).toEqual([[1, 0, -1], [0, 1, 2], [0, 0, 0]]);
    expect(alg.inverse(QF, Q([[1, 2], [2, 4]]))).toBeNull();
  });
  it('null space and systems', () => {
    const B = Q([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
    expect(N(alg.nullspace(QF, B))).toEqual([[1, -2, 1]]);
    const one = alg.solveSystem(QF, Q([[1, 1], [1, -1]]), Q([[3, 1]])[0]);
    expect(N([one.particular!])[0]).toEqual([2, 1]);
    expect(alg.solveSystem(QF, Q([[1, 1], [1, 1]]), Q([[1, 2]])[0]).consistent).toBe(false);
    const many = alg.solveSystem(QF, B, Q([[6, 15, 24]])[0]);
    expect(many.consistent).toBe(true);
    expect(many.directions.length).toBe(1);
  });
  it('characteristic polynomial (exact and numeric agree)', () => {
    const rows = [[2, 1], [1, 2]];
    expect(alg.charpoly(QF, Q(rows)).map((x) => QF.num(x))).toEqual([3, -4, 1]);
    expect(round(alg.charpoly(numericField(1e-12), rows))).toEqual([3, -4, 1]);
  });
  it('Gram–Schmidt is exact over Q', () => {
    const out = alg.gramSchmidt(QF, Q([[1, 1, 0], [1, 0, 1]]));
    expect(N(out)).toEqual([[1, 1, 0], [0.5, -0.5, 1]]);
  });
});

describe('eigen', () => {
  it('rational matrices: exact eigenvalues and eigenspaces', () => {
    const e = eigenOf([[2, 1], [1, 2]], true);
    expect(e.certainty).toBe('exact');
    expect(e.pairs.map((p) => p.re)).toEqual([3, 1]);
    expect(e.pairs[0].basis).toEqual([[1, 1]]);
    expect(e.pairs[1].basis).toEqual([[-1, 1]]);
  });
  it('rotation has complex eigenvalues ±i', () => {
    const e = eigenOf([[0, -1], [1, 0]], true);
    expect(e.pairs.map((p) => [p.re, Math.abs(p.im)])).toEqual([[0, 1], [0, 1]]);
    expect(e.pairs.every((p) => p.geo === 0)).toBe(true);
  });
  it('shear is defective', () => {
    const e = eigenOf([[1, 1], [0, 1]], true);
    expect(e.pairs).toHaveLength(1);
    expect([e.pairs[0].alg, e.pairs[0].geo]).toEqual([2, 1]);
  });
  it('irrational eigenvalues from the quadratic factor', () => {
    const e = eigenOf([[1, 1], [1, 0]], true);
    expect(round(e.pairs.map((p) => p.re))).toEqual(round([(1 + Math.sqrt(5)) / 2, (1 - Math.sqrt(5)) / 2]));
  });
  it('numeric: Durand–Kerner and symmetric Jacobi', () => {
    expect(round(polyRoots([-6, 11, -6, 1]).map((r) => r.re).sort())).toEqual([1, 2, 3]);
    const e = eigenOf([[0.5, 0.2, 0], [0.1, 0.3, 0], [0, 0, 1.5]], false);
    expect(e.certainty).toBe('numeric');
    expect(e.pairs).toHaveLength(3);
  });
  it('SVD reconstructs A with V a rotation', () => {
    const A = [[3, 0], [4, 5]];
    const s = svdOf(A);
    const back = matMul(matMul(s.U, s.S), transpose(s.V));
    expect(back.flat().map((x) => +x.toFixed(9))).toEqual(A.flat());
    expect(round(s.sigma)).toEqual(round([3 * Math.sqrt(5), Math.sqrt(5)]));
  });
});

describe('linear algebra in the language', () => {
  it('matrix literals are exact; operators', () => {
    const A = 'A = [[2,1],[1,2]]';
    expect(run(A).certainty).toBe('exact');
    expect(run(A, 'A^-1').rows).toEqual([[2 / 3, -1 / 3], [-1 / 3, 2 / 3]]);
    expect(valueLatex(run(A, 'A^-1'))).toContain('\\frac{2}{3}');
    expect(run('A = [[1,2],[3,4]]', 'A^T').rows).toEqual([[1, 3], [2, 4]]);
    expect(run('A = [[1,2],[3,4]]', 'Aᵀ').rows).toEqual([[1, 3], [2, 4]]);
    expect(run(A, 'v = <1, 0>', 'A(v)').comps).toEqual([2, 1]);
    expect(run(A, 'v = <1, 0>', 'A v').comps).toEqual([2, 1]);
    expect(run(A, 'A/2').rows).toEqual([[1, 0.5], [0.5, 1]]);
    expect(run('A = [[cos(1), 0],[0, 1]]').certainty).toBeUndefined();
    expect(() => run('A = [[1,2],[2,4]]', 'A^-1')).toThrow(/not invertible/);
  });
  it('scalars, subspaces and yes/no facts', () => {
    const B = 'B = [[1,2,3],[4,5,6],[7,8,9]]';
    expect(run(B, 'det B').value).toBe(0);
    expect(run(B, 'rank B').value).toBe(2);
    const ns = run(B, 'nullspace B');
    expect(ns.kind).toBe('subspace');
    expect(ns.basis).toEqual([[1, -2, 1]]);
    expect(run(B, 'columnspace B').basis).toEqual([[1, 4, 7], [2, 5, 8]]);
    expect(run(B, 'invertible B').value).toBe(false);
    expect(run('A = [[1,1],[0,1]]', 'diagonalizable A').value).toBe(false);
    expect(run('A = [[2,1],[1,2]]', 'diagonalizable A').value).toBe(true);
    expect(run('independent(<1,2>, <2,4>)').value).toBe(false);
  });
  it('eigen objects are addressable', () => {
    const E = run('A = [[2,1],[1,2]]', 'E = eigen A', 'E[1]');
    expect(E.kind).toBe('subspace');
    expect(E.basis).toEqual([[1, 1]]);
    expect(run('A = [[2,1],[1,2]]', 'eigenvalues A').items.map((s: any) => s.value)).toEqual([3, 1]);
    const p = run('A = [[2,1],[1,2]]', 'p = charpoly A', 'p(3)');
    expect(p.value).toBe(0);
    const D = run('A = [[2,1],[1,2]]', 'F = diagonalize A', 'F.D');
    expect(D.rows).toEqual([[3, 0], [0, 1]]);
  });
  it('systems, projection, least squares, coordinates, linear maps', () => {
    const s = run('A = [[1,1],[1,-1]]', 'solve(A, <3, 1>)');
    expect(s.kind).toBe('affine');
    expect(s.particular).toEqual([2, 1]);
    expect(run('A = [[1,1],[1,1]]', 'solve(A, <1, 2>)').consistent).toBe(false);
    expect(run('project <2, 3> onto <1, 0>').comps).toEqual([2, 0]);
    expect(run('W = span(<1,0,0>, <0,1,0>)', 'project <1, 2, 3> onto W').comps).toEqual([1, 2, 0]);
    expect(round(run('A = [[1,0],[1,1],[1,2]]', 'leastsquares(A, <6, 0, 0>)').comps)).toEqual([5, -3]);
    expect(run('B = [[1,1],[0,1]]', 'coords <3, 2> in B').comps).toEqual([1, 2]);
    expect(run('T(x,y) = (2x + y, x + 2y)', 'standardmatrix T').rows).toEqual([[2, 1], [1, 2]]);
    expect(() => run('T(x,y) = (x^2, y)', 'standardmatrix T')).toThrow(/not linear/);
  });
});