/**
 * Linear-algebra operations. Rational input is processed exactly (fractions), everything else
 * numerically; every result carries its certainty and is a typed, addressable object.
 */
import { Builtin, EvalError, KwArgs } from '../../math-core/builtins';
import { Expr, sym, num, bin } from '../../math-core/ast';
import { simplify } from '../../math-core/symbolic/simplify';
import { diff } from '../../math-core/symbolic/diff';
import {
  MathValue, MatrixValue, VectorValue, PointValue, ListValue, FunctionValue, BoolValue, Certainty,
  scalar, vector, matrixV, entryLatex, vectorLatex,
} from '../../math-core/values';
import { Field, Q, QF, numericField, toQMatrix, tolFor, primitive, toFrac } from './field';
import * as alg from './algorithms';
import { eigenOf, isSymmetric } from './eigen';
import { orthonormalize, qrOf, svdOf } from './decomp';
import {
  SubspaceValue, EigenValue, FactorizationValue, subspace, affine, eigenvaluesList, eigenvectorsList,
} from './values';

// ------------------------------------------------------------------ inputs

/** A matrix with its exactness decided once: rational entries + exact certainty → fractions. */
export interface Mx {
  rows: number[][];
  q: Q[][] | null;
  certainty: Certainty;
}

const weakest = (cs: (Certainty | undefined)[]): Certainty => {
  const order: Certainty[] = ['heuristic', 'numeric', 'exact'];
  return cs.reduce<Certainty>((w, c) => (order.indexOf(c ?? 'numeric') < order.indexOf(w) ? (c ?? 'numeric') : w), 'exact');
};

export function mxOf(rows: number[][], certainty: Certainty | undefined): Mx {
  const q = certainty === 'exact' ? toQMatrix(rows) : null;
  return { rows, q, certainty: q ? 'exact' : certainty === 'heuristic' ? 'heuristic' : 'numeric' };
}

export function expectMx(v: MathValue | undefined, what = 'a matrix'): Mx {
  if (v?.kind === 'matrix') return mxOf((v as MatrixValue).rows, v.certainty);
  throw new EvalError(`Expected ${what}, got ${v?.kind ?? 'nothing'}`);
}

const square = (m: Mx, op: string) => {
  if (m.rows.length !== m.rows[0].length) throw new EvalError(`${op} needs a square matrix (this one is ${m.rows.length}×${m.rows[0].length})`);
};

/** Vectors given as a list, the columns of a matrix, a subspace basis, or single vectors. */
export function vectorsOf(args: (MathValue | undefined)[]): { vs: number[][]; certainty: Certainty } {
  const vs: number[][] = [];
  const cs: (Certainty | undefined)[] = [];
  const add = (v: MathValue | undefined) => {
    if (!v) return;
    if (v.kind === 'vector') vs.push((v as VectorValue).comps);
    else if (v.kind === 'point') vs.push((v as PointValue).coords);
    else if (v.kind === 'matrix') (v as MatrixValue).rows[0].forEach((_, j) => vs.push((v as MatrixValue).rows.map((r) => r[j])));
    else if (v.kind === 'subspace') vs.push(...(v as unknown as SubspaceValue).basis);
    else if (v.kind === 'list') return (v as ListValue).items.forEach(add);
    else throw new EvalError(`Expected vectors, got ${v.kind}`);
    cs.push(v.certainty);
  };
  args.forEach(add);
  if (vs.some((v) => v.length !== vs[0].length)) throw new EvalError('All vectors must have the same dimension');
  return { vs, certainty: weakest(cs) };
}

const columnsMatrix = (vs: number[][]) => (vs.length ? vs[0].map((_, i) => vs.map((v) => v[i])) : []);

type Solver<U> = <T>(F: Field<T>, A: T[][]) => U;
/** Run a field-generic algorithm exactly when possible, numerically otherwise. */
export function onField<U>(m: Mx, f: Solver<U>): U {
  return m.q ? f(QF, m.q) : f(numericField(tolFor(m.rows)), m.rows);
}

const toNums = <T>(F: Field<T>, A: T[][]) => A.map((r) => r.map((x) => clean(F.num(x))));
const clean = (x: number) => (Math.abs(x) < 1e-12 ? 0 : x);
const L = (x: number, c: Certainty) => entryLatex(x, c === 'exact');

// ------------------------------------------------------------------ core computations (shared with analyzers)

export const detOf = (m: Mx) => onField(m, (F, A) => clean(F.num(alg.det(F, A))));
export const rankOf = (m: Mx) => onField(m, (F, A) => alg.rref(F, A).pivots.length);

export function nullspaceOf(m: Mx): SubspaceValue {
  const basis = onField(m, (F, A) => alg.nullspace(F, A).map((v) => (F.exact ? primitive(v as unknown as Q[]).map((q) => Number(q.n) / Number(q.d)) : v.map((x) => clean(F.num(x))))));
  return subspace(m.rows[0].length, basis, 'null space', m.certainty, { role: 'nullspace', matrix: m.rows });
}

export function columnspaceOf(m: Mx): SubspaceValue {
  const pivots = onField(m, (F, A) => alg.rref(F, A).pivots);
  return subspace(m.rows.length, pivots.map((j) => m.rows.map((r) => r[j])), 'column space', m.certainty, { role: 'colspace', pivots, matrix: m.rows });
}

export function rowspaceOf(m: Mx): SubspaceValue {
  const basis = onField(m, (F, A) => {
    const { R, pivots } = alg.rref(F, A);
    return R.slice(0, pivots.length).map((r) => r.map((x) => clean(F.num(x))));
  });
  return subspace(m.rows[0].length, basis, 'row space', m.certainty, { role: 'rowspace' });
}

export function inverseOf(m: Mx): number[][] | null {
  square(m, 'inverse');
  return onField(m, (F, A) => {
    const inv = alg.inverse(F, A);
    return inv ? toNums(F, inv) : null;
  });
}

export function eigenValueOf(m: Mx): EigenValue {
  square(m, 'eigen');
  const r = eigenOf(m.rows, m.certainty === 'exact' && !!m.q);
  const certainty = m.certainty === 'exact' ? r.certainty : weakest([m.certainty, 'numeric']);
  return { kind: 'eigen', n: m.rows.length, pairs: r.pairs, charpoly: r.charpoly, certainty, evidence: r.evidence, key: JSON.stringify(['eig', m.rows]), matrix: m.rows };
}

function diagonalizability(e: EigenValue): { ok: boolean; reason: string } {
  const complexPair = e.pairs.find((p) => p.im !== 0);
  if (complexPair) return { ok: false, reason: `\\text{complex eigenvalues } ${entryLatex(complexPair.re, false) === '0' ? '' : entryLatex(complexPair.re, complexPair.certainty === 'exact')} \\pm ${entryLatex(Math.abs(complexPair.im), complexPair.certainty === 'exact')}i` };
  const short = e.pairs.find((p) => p.geo < p.alg);
  if (short) return { ok: false, reason: `\\lambda = ${entryLatex(short.re, short.certainty === 'exact')}:\\ \\text{geo. mult. } ${short.geo} < \\text{alg. mult. } ${short.alg}` };
  return { ok: true, reason: `${e.n}\\ \\text{independent eigenvectors}` };
}

export function diagonalizationOf(m: Mx): FactorizationValue {
  const e = eigenValueOf(m);
  const d = diagonalizability(e);
  if (!d.ok) throw new EvalError(`not diagonalizable over ℝ — ${d.reason.replace(/\\text\{([^}]*)\}/g, '$1').replace(/\\/g, '')}`);
  const cols: number[][] = [];
  const lambdas: number[] = [];
  for (const p of e.pairs) for (const b of p.basis) {
    cols.push(b);
    lambdas.push(p.re);
  }
  const P = columnsMatrix(cols);
  const D = lambdas.map((l, i) => lambdas.map((_, j) => (i === j ? l : 0)));
  const Pm = mxOf(P, e.certainty);
  const Pinv = inverseOf(Pm) ?? P;
  return { kind: 'factorization', what: 'diagonalization', factors: [['P', P], ['D', D], ['Pinv', Pinv]], product: 'P D P^{-1}', certainty: weakest([e.certainty, ...e.pairs.map((p) => p.certainty)]), key: JSON.stringify(['diag', m.rows]), evidence: e.evidence };
}

export function solveOf(m: Mx, b: number[], bc: Certainty | undefined) {
  if (b.length !== m.rows.length) throw new EvalError(`b must have ${m.rows.length} entries`);
  const aug = mxOf(m.rows.map((r, i) => [...r, b[i]]), weakest([m.certainty, bc]));
  const n = m.rows[0].length;
  const res = onField(aug, (F, AB) => {
    const s = alg.solveSystem(F, AB.map((r) => r.slice(0, n)), AB.map((r) => r[n]));
    const vec = (v: (typeof AB)[number]) => v.map((x) => clean(F.num(x)));
    const dirs = s.directions.map((v) => (F.exact ? primitive(v as unknown as Q[]).map((q) => Number(q.n) / Number(q.d)) : vec(v)));
    return { consistent: s.consistent, particular: s.particular ? vec(s.particular) : undefined, directions: dirs };
  });
  return affine(n, res.consistent, res.particular, res.directions, aug.certainty, { A: m.rows, b });
}

// ------------------------------------------------------------------ builtin helpers

const V = 'value' as const;
type ApplyFn = (args: (MathValue | undefined)[], kw: KwArgs, raw: Expr[]) => MathValue;
const unary = (name: string, doc: string, apply: (m: Mx, raw: Expr[]) => MathValue, signature = `${name} A`): Builtin => ({
  name, prefix: true, minArgs: 1, maxArgs: 1, category: 'linear algebra', signature, doc,
  apply: ([a], _ctx, raw) => apply(expectMx(a), raw),
});
const fn = (name: string, min: number, max: number, signature: string, doc: string, apply: ApplyFn, extra: Partial<Builtin> = {}): Builtin => ({
  name, minArgs: min, maxArgs: max, category: 'linear algebra', signature, doc, apply: (args, _ctx, raw, kw) => apply(args, kw, raw), ...extra,
});
const bool = (value: boolean, reason: string, certainty: Certainty): BoolValue => ({ kind: 'bool', value, reason, certainty });
const nameOf = (raw: Expr[] | undefined, fallback = 'A') => (raw?.[0]?.type === 'sym' ? raw[0].name : fallback);

// ------------------------------------------------------------------ builtins

export const linearAlgebraBuiltins: Builtin[] = [
  unary('det', 'Determinant (exact for rational matrices).', (m) => {
    square(m, 'det');
    return scalar(detOf(m), { certainty: m.certainty, evidence: m.q ? 'fraction-exact elimination' : 'Gaussian elimination with partial pivoting' });
  }),
  unary('trace', 'Trace: sum of the diagonal entries.', (m) => {
    square(m, 'trace');
    return scalar(m.rows.reduce((s, r, i) => s + r[i], 0), { certainty: m.certainty });
  }),
  unary('rank', 'Rank: number of pivots = dimension of the column space.', (m) => scalar(rankOf(m), { certainty: m.certainty, evidence: m.q ? 'exact row reduction' : 'row reduction with tolerance' })),
  unary('nullity', 'Nullity: dimension of the null space (n − rank).', (m) => scalar(m.rows[0].length - rankOf(m), { certainty: m.certainty })),
  unary('rref', 'Reduced row echelon form.', (m) => {
    const { R, pivots } = onField(m, (F, A) => {
      const r = alg.rref(F, A);
      return { R: toNums(F, r.R), pivots: r.pivots };
    });
    return matrixV(R, { certainty: m.certainty, evidence: `pivot columns ${pivots.map((p) => p + 1).join(', ') || 'none'}`, pivots } as Partial<MatrixValue>);
  }),
  unary('inverse', 'Inverse matrix A⁻¹ (exact for rational matrices).', (m, raw) => {
    const inv = inverseOf(m);
    if (!inv) throw new EvalError(`${nameOf(raw)} is not invertible: det = 0 (rank ${rankOf(m)} < ${m.rows.length})`);
    return matrixV(inv, { certainty: m.certainty, role: 'inverse' });
  }),
  unary('transpose', 'Transpose Aᵀ.', (m) => matrixV(m.rows[0].map((_, j) => m.rows.map((r) => r[j])), { certainty: m.certainty })),
  fn('identity', 1, 1, 'identity n', 'The n×n identity matrix.', ([n]) => {
    const k = n?.kind === 'scalar' ? (n as { value: number }).value : NaN;
    if (!Number.isInteger(k) || k < 1 || k > 12) throw new EvalError('identity n needs an integer 1 … 12');
    return matrixV(Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))), { certainty: 'exact' });
  }, { prefix: true }),
  unary('invertible', 'Whether A is invertible, with the reason.', (m) => {
    if (m.rows.length !== m.rows[0].length) return bool(false, `\\text{not square: } ${m.rows.length}\\times${m.rows[0].length}`, 'exact');
    const d = detOf(m);
    const ok = m.q ? d !== 0 : Math.abs(d) > tolFor(m.rows);
    return bool(ok, ok ? `\\det = ${L(d, m.certainty)} \\neq 0` : `\\det = 0,\\ \\operatorname{rank} = ${rankOf(m)} < ${m.rows.length}`, m.certainty);
  }),
  unary('eigen', 'Eigenvalues with their eigenspaces and multiplicities.', (m, raw) => ({ ...eigenValueOf(m), of: raw[0]?.type === 'sym' ? raw[0].name : undefined })),
  unary('eigenvalues', 'Eigenvalues (with multiplicity; complex ones as a ± bi).', (m) => eigenvaluesList(eigenValueOf(m))),
  unary('eigenvectors', 'A basis of each real eigenspace.', (m) => eigenvectorsList(eigenValueOf(m))),
  fn('eigenspace', 2, 2, 'eigenspace(A, λ)', 'The eigenspace null(A − λI).', ([a, l]) => {
    const m = expectMx(a);
    square(m, 'eigenspace');
    const lambda = l?.kind === 'scalar' ? (l as { value: number }).value : NaN;
    if (!Number.isFinite(lambda)) throw new EvalError('eigenspace(A, λ): λ must be a number');
    const shifted = mxOf(m.rows.map((r, i) => r.map((x, j) => (i === j ? x - lambda : x))), m.certainty === 'exact' && toFrac(lambda) ? 'exact' : 'numeric');
    const s = nullspaceOf(shifted);
    if (!s.basis.length) throw new EvalError(`${entryLatex(lambda, false)} is not an eigenvalue (A − λI is invertible)`);
    return { ...s, what: `eigenspace λ = ${entryLatex(lambda, false)}`, role: 'eigen', key: JSON.stringify(['es', m.rows, lambda]) };
  }),
  {
    name: 'charpoly', prefix: true, minArgs: 1, maxArgs: 1, category: 'linear algebra', signature: 'charpoly A',
    doc: 'Characteristic polynomial p(λ) = det(λI − A) as a function of λ (its roots are the eigenvalues).',
    apply: ([a], ctx, raw) => {
    const m = expectMx(a);
    square(m, 'charpoly');
    const c = onField(m, (F, A) => alg.charpoly(F, A).map((x) => clean(F.num(x))));
    const lam = sym('λ');
    let body: Expr | undefined;
    for (let k = c.length - 1; k >= 0; k--) {
      if (c[k] === 0) continue;
      const pow: Expr = k === 0 ? num(1) : k === 1 ? lam : bin('^', lam, num(k));
      const term: Expr = k === 0 ? num(c[k]) : c[k] === 1 ? pow : bin('*', num(c[k]), pow);
      body = body ? bin('+', body, term) : term;
    }
    return { ...ctx.makeFunction(simplify(body ?? num(0)), ['λ'], { label: `p_{${nameOf(raw)}}`, role: 'charpoly' }), certainty: m.certainty };
    },
  },
  unary('diagonalizable', 'Whether A = P D P⁻¹ over ℝ, with the reason.', (m) => {
    const e = eigenValueOf(m);
    const d = diagonalizability(e);
    return bool(d.ok, d.reason, e.certainty ?? 'numeric');
  }),
  unary('diagonalize', 'A = P D P⁻¹: eigenvectors in P, eigenvalues in D.', (m) => diagonalizationOf(m)),
  unary('orthodiagonalize', 'Symmetric A = Q D Qᵀ with orthonormal eigenvectors (spectral theorem).', (m) => {
    square(m, 'orthodiagonalize');
    if (!isSymmetric(m.rows)) throw new EvalError('orthogonal diagonalization needs a symmetric matrix');
    const e = eigenValueOf(m);
    const cols = e.pairs.flatMap((p) => orthonormalize(p.basis));
    const lambdas = e.pairs.flatMap((p) => p.basis.map(() => p.re));
    const Qm = columnsMatrix(cols);
    const D = lambdas.map((l, i) => lambdas.map((_, j) => (i === j ? l : 0)));
    return { kind: 'factorization', what: 'orthogonal diagonalization', factors: [['Q', Qm], ['D', D]], product: 'Q D Q^{T}', certainty: e.certainty, key: JSON.stringify(['odiag', m.rows]) } as FactorizationValue;
  }),
  unary('nullspace', 'Null space {x : A x = 0} with a basis.', (m, raw) => ({ ...nullspaceOf(m), of: raw[0]?.type === 'sym' ? raw[0].name : undefined })),
  unary('kernel', 'Kernel = null space.', (m) => nullspaceOf(m)),
  unary('columnspace', 'Column space: spanned by the pivot columns of A.', (m, raw) => ({ ...columnspaceOf(m), of: raw[0]?.type === 'sym' ? raw[0].name : undefined })),
  unary('rowspace', 'Row space: spanned by the non-zero rows of rref(A).', (m) => rowspaceOf(m)),
  fn('span', 1, 8, 'span(u, v, …)', 'The subspace spanned by vectors (basis = an independent subset).', (args) => {
    const { vs, certainty } = vectorsOf(args);
    const m = mxOf(columnsMatrix(vs), certainty);
    const pivots = onField(m, (F, A) => alg.rref(F, A).pivots);
    return subspace(vs[0].length, pivots.map((j) => vs[j]), 'span', m.certainty, { role: 'span', given: vs.length });
  }),
  fn('basis', 1, 8, 'basis S', 'A basis: an independent subset spanning the same subspace.', (args) => {
    const { vs, certainty } = vectorsOf(args);
    const m = mxOf(columnsMatrix(vs), certainty);
    const pivots = onField(m, (F, A) => alg.rref(F, A).pivots);
    return { kind: 'list', items: pivots.map((j) => vector(vs[j], undefined, { certainty: m.certainty })), certainty: m.certainty } as ListValue;
  }, { prefix: true }),
  fn('dim', 1, 1, 'dim W', 'Dimension of a subspace (or of the span of vectors).', ([w]) => {
    if (w?.kind === 'subspace') return scalar((w as unknown as SubspaceValue).basis.length, { certainty: w.certainty });
    const { vs, certainty } = vectorsOf([w]);
    return scalar(rankOf(mxOf(columnsMatrix(vs), certainty)), { certainty });
  }, { prefix: true }),
  fn('independent', 1, 8, 'independent S', 'Whether vectors are linearly independent, with a dependency if not.', (args) => {
    const { vs, certainty } = vectorsOf(args);
    const m = mxOf(columnsMatrix(vs), certainty);
    const ns = nullspaceOf(m);
    if (!ns.basis.length) return bool(true, `\\operatorname{rank} = ${vs.length} = \\text{number of vectors}`, m.certainty);
    const c = ns.basis[0];
    const terms = c.map((x, i) => (x === 0 ? '' : `${x < 0 ? '-' : '+'}${Math.abs(x) === 1 ? '' : L(Math.abs(x), m.certainty)}\\mathbf{v}_{${i + 1}}`)).filter(Boolean).join(' ').replace(/^\+/, '');
    return bool(false, `${terms} = \\mathbf{0}`, m.certainty);
  }, { prefix: true }),
  fn('project', 1, 2, 'project v onto W', 'Orthogonal projection of v onto a vector, subspace or column space.', ([v, w], kw) => {
    const target = kw.values.onto ?? w;
    if (!v || !target) throw new EvalError('project v onto W');
    const x = vectorsOf([v]);
    const { vs, certainty } = vectorsOf([target]);
    const m = mxOf(columnsMatrix(vs), weakest([certainty, x.certainty]));
    const pivots = onField(m, (F, A) => alg.rref(F, A).pivots);
    const B = mxOf(columnsMatrix(pivots.map((j) => vs[j])), m.certainty);
    const all = mxOf(B.rows.map((r, i) => [...r, x.vs[0][i]]), m.certainty);
    const k = pivots.length;
    const p = onField(all, (F, BA) => {
      const Bm = BA.map((r) => r.slice(0, k));
      const P = alg.projector(F, Bm);
      if (!P) throw new EvalError('cannot project onto {0}');
      return alg.mulVec(F, P, BA.map((r) => r[k])).map((t) => clean(F.num(t)));
    });
    const residual = x.vs[0].map((t, i) => t - p[i]);
    return vector(p, undefined, { certainty: all.certainty, role: 'projection', residual, source: x.vs[0] } as Partial<VectorValue>);
  }, { command: true, keywords: { onto: V } }),
  fn('leastsquares', 2, 2, 'leastsquares(A, b)', 'Least-squares solution of A x ≈ b (normal equations AᵀA x = Aᵀb).', ([a, b]) => {
    const m = expectMx(a);
    const bv = vectorsOf([b]);
    const At = m.rows[0].map((_, j) => m.rows.map((r) => r[j]));
    const AtA = At.map((r) => At.map((s) => r.reduce((t, x, i) => t + x * s[i], 0)));
    const Atb = At.map((r) => r.reduce((t, x, i) => t + x * bv.vs[0][i], 0));
    const sol = solveOf(mxOf(AtA, m.certainty), Atb, bv.certainty);
    if (sol.directions.length) return { ...sol, what: 'least-squares solutions' };
    const x = sol.particular!;
    const r = m.rows.map((row, i) => bv.vs[0][i] - row.reduce((t, y, j) => t + y * x[j], 0));
    return vector(x, undefined, { certainty: sol.certainty, role: 'leastsquares', evidence: `residual ‖b − A x̂‖ = ${Math.hypot(...r).toPrecision(4)}` });
  }),
  fn('gramschmidt', 1, 8, 'gramschmidt S', 'Orthogonal basis by Gram–Schmidt (exact for rational vectors).', (args) => {
    const { vs, certainty } = vectorsOf(args);
    const m = mxOf(vs, certainty);
    const out = onField(m, (F, A) => alg.gramSchmidt(F, A).map((v) => v.map((x) => clean(F.num(x)))));
    return { kind: 'list', items: out.map((v) => vector(v, undefined, { certainty: m.certainty })), certainty: m.certainty } as ListValue;
  }, { prefix: true }),
  fn('orthonormal', 1, 8, 'orthonormal S', 'Orthonormal basis (Gram–Schmidt, then normalise).', (args) => {
    const { vs, certainty } = vectorsOf(args);
    const out = orthonormalize(vs);
    return { kind: 'list', items: out.map((v) => vector(v, undefined, { certainty })), certainty } as ListValue;
  }, { prefix: true }),
  unary('qr', 'A = Q R with orthonormal columns in Q (numeric).', (m) => {
    const { Q: Qm, R } = qrOf(m.rows);
    return { kind: 'factorization', what: 'QR', factors: [['Q', Qm], ['R', R]], product: 'Q R', certainty: 'numeric', key: JSON.stringify(['qr', m.rows]), evidence: 'modified Gram–Schmidt' } as FactorizationValue;
  }),
  unary('svd', 'A = U Σ Vᵀ: rotate, stretch along axes, rotate (numeric).', (m) => {
    const s = svdOf(m.rows);
    return { kind: 'factorization', what: 'SVD', factors: [['U', s.U], ['S', s.S], ['V', s.V]], product: 'U \\Sigma V^{T}', certainty: 'numeric', key: JSON.stringify(['svd', m.rows]), evidence: 'eigenvectors of AᵀA (Jacobi)', sigma: s.sigma } as FactorizationValue;
  }),
  fn('coords', 1, 2, 'coords v in B', 'Coordinates of v in the basis B (columns of B, or a list of vectors).', ([v, b], kw) => {
    const basis = kw.values.in ?? b;
    if (!v || !basis) throw new EvalError('coords v in B');
    const x = vectorsOf([v]);
    const { vs, certainty } = vectorsOf([basis]);
    const sol = solveOf(mxOf(columnsMatrix(vs), certainty), x.vs[0], x.certainty);
    if (!sol.consistent) throw new EvalError('v is not in the span of B');
    if (sol.directions.length) throw new EvalError('B is not a basis (its vectors are dependent)');
    return vector(sol.particular!, undefined, { certainty: sol.certainty, role: 'coords', basis: vs } as Partial<VectorValue>);
  }, { command: true, keywords: { in: V } }),
  fn('matrix', 1, 8, 'matrix(u, v, …)', 'The matrix whose columns are the given vectors.', (args) => {
    const { vs, certainty } = vectorsOf(args);
    return matrixV(columnsMatrix(vs), { certainty });
  }),
  unary('columns', 'The columns of A as a list of vectors.', (m) => ({ kind: 'list', items: m.rows[0].map((_, j) => vector(m.rows.map((r) => r[j]), undefined, { certainty: m.certainty })), certainty: m.certainty }) as ListValue),
  unary('rows', 'The rows of A as a list of vectors.', (m) => ({ kind: 'list', items: m.rows.map((r) => vector(r.slice(), undefined, { certainty: m.certainty })), certainty: m.certainty }) as ListValue),
  fn('standardmatrix', 1, 1, 'standardmatrix T', 'The matrix of a linear map T(x, y) = (…): its constant Jacobian.', ([t]) => {
    const f = t as FunctionValue;
    if (f?.kind !== 'function' || !f.expr || (f.expr.type !== 'vec' && f.expr.type !== 'tuple')) throw new EvalError('standardmatrix T needs a vector-valued function T(x, y) = (…)');
    const rows = linearMatrixOf(f);
    if (!rows) throw new EvalError(`${f.label ?? 'T'} is not linear`);
    return matrixV(rows, { certainty: 'exact', role: 'standard matrix' });
  }, { prefix: true, argModes: ['function'] }),
];

/** The constant Jacobian of a linear vector-valued function, or null when it is not linear. */
export function linearMatrixOf(f: FunctionValue): number[][] | null {
  const e = f.expr;
  if (!e || (e.type !== 'vec' && e.type !== 'tuple')) return null;
  const rows: number[][] = [];
  for (const comp of e.items) {
    const row: number[] = [];
    for (const p of f.params) {
      const d = simplify(diff(comp, p));
      if (d.type !== 'num') {
        const free = [...collectSyms(d)].filter((s) => f.params.includes(s));
        if (free.length) return null;
        const v = evalConst(d, f.env);
        if (v === null) return null;
        row.push(v);
      } else row.push(d.value);
    }
    rows.push(row);
  }
  const at0 = f.eval(...f.params.map(() => 0)) as number[];
  if (!Array.isArray(at0) || at0.some((x) => Math.abs(x) > 1e-12)) return null;
  return rows;
}

function collectSyms(e: Expr, out = new Set<string>()): Set<string> {
  if (e.type === 'sym') out.add(e.name);
  const kids: Expr[] = e.type === 'bin' || e.type === 'eq' ? [e.left, e.right] : e.type === 'neg' ? [e.arg] : e.type === 'call' ? e.args : e.type === 'vec' || e.type === 'tuple' || e.type === 'list' ? e.items : [];
  kids.forEach((k) => collectSyms(k, out));
  return out;
}

function evalConst(e: Expr, env: Record<string, number | number[]>): number | null {
  switch (e.type) {
    case 'num': return e.value;
    case 'sym': return typeof env[e.name] === 'number' ? (env[e.name] as number) : null;
    case 'neg': { const a = evalConst(e.arg, env); return a === null ? null : -a; }
    case 'bin': {
      const a = evalConst(e.left, env), b = evalConst(e.right, env);
      if (a === null || b === null) return null;
      return e.op === '+' ? a + b : e.op === '-' ? a - b : e.op === '*' || e.op === '·' ? a * b : e.op === '/' ? a / b : e.op === '^' ? a ** b : null;
    }
    default: return null;
  }
}

export { vectorLatex };