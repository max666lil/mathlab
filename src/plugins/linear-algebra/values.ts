/**
 * Value kinds of linear algebra. Every result is a typed object: subspaces, solution sets,
 * eigen-decompositions and factorizations can be named, indexed (E[1], W[2]), analysed and drawn.
 */
import { MathValue, Certainty, VisualValue, scalar, vector, matrixV, entryLatex, vectorLatex, matrixLatex, registerValueKind } from '../../math-core/values';
import { registerItems } from '../../math-core/result-values';
import { numberLatex } from '../../math-core/symbolic/print';
import type { EigenPair } from './eigen';

interface LABase {
  [key: string]: unknown;
  role?: string;
  derivation?: string;
  certainty?: Certainty;
  evidence?: string;
  visuals?: VisualValue[];
  key: string;
}

export interface SubspaceValue extends LABase {
  kind: 'subspace';
  ambient: number;
  basis: number[][];
  /** 'null space' | 'column space' | 'row space' | 'span' | 'eigenspace λ = 3' | … */
  what: string;
  /** the matrix it belongs to (null space moves with its transformation) */
  matrix?: number[][];
  of?: string;
}

export interface AffineValue extends LABase {
  kind: 'affine';
  ambient: number;
  consistent: boolean;
  particular?: number[];
  directions: number[][];
  /** the system it solves (for the row picture) */
  system?: { A: number[][]; b: number[] };
}

export interface ComplexValue extends LABase {
  kind: 'complex';
  re: number;
  im: number;
}

export interface EigenValue extends LABase {
  kind: 'eigen';
  n: number;
  pairs: EigenPair[];
  charpoly: number[];
  matrix?: number[][];
  of?: string;
}

export interface FactorizationValue extends LABase {
  kind: 'factorization';
  /** 'diagonalization' | 'orthogonal diagonalization' | 'QR' | 'SVD' */
  what: string;
  /** factor name → matrix, in display order (A = P D P⁻¹: P, D, Pinv) */
  factors: [string, number[][]][];
  /** LaTeX of the product that equals A, e.g. 'P D P^{-1}' */
  product: string;
  /** name of the factorized matrix (keys its stepped animation) */
  of?: string;
}

const keyOf = (o: unknown) => JSON.stringify(o);

export const subspace = (ambient: number, basis: number[][], what: string, certainty: Certainty, extra: Partial<SubspaceValue> = {}): SubspaceValue => ({
  kind: 'subspace', ambient, basis, what, certainty, key: keyOf(['sub', ambient, basis, what]), ...extra,
});

export const affine = (ambient: number, consistent: boolean, particular: number[] | undefined, directions: number[][], certainty: Certainty, system?: AffineValue['system']): AffineValue => ({
  kind: 'affine', ambient, consistent, particular, directions, certainty, system, key: keyOf(['aff', particular, directions, consistent]),
});

export const complex = (re: number, im: number, certainty: Certainty): ComplexValue => ({ kind: 'complex', re, im, certainty, key: keyOf([re, im]) });

export function lambdaLatex(p: { re: number; im: number }, exact: boolean): string {
  if (p.im === 0) return entryLatex(p.re, exact);
  const re = Math.abs(p.re) < 1e-13 ? '' : entryLatex(p.re, exact);
  const im = Math.abs(p.im);
  const imL = Math.abs(im - 1) < 1e-13 ? '' : entryLatex(im, exact);
  return `${re}${re ? ' \\pm ' : '\\pm '}${imL}i`;
}

const SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const Rn = (n: number) => `ℝ${n === 1 ? '' : SUP[n] ?? `^${n}`}`;
const RnL = (n: number) => (n === 1 ? '\\mathbb{R}' : `\\mathbb{R}^{${n}}`);

export function spanLatex(basis: number[][], ambient: number, exact: boolean, full = true): string {
  if (!basis.length) return '\\{\\mathbf{0}\\}';
  if (full && basis.length === ambient) return RnL(ambient);
  return `\\operatorname{span}\\left\\{${basis.map((b) => vectorLatex(b, exact)).join(', ')}\\right\\}`;
}

const dimName = (d: number, n: number) => (d === 0 ? 'the origin' : d === n ? `all of ${Rn(n)}` : d === 1 ? 'a line' : d === 2 ? 'a plane' : `${d}-dimensional`);

registerValueKind({
  kind: 'subspace',
  latex: (v) => {
    const s = v as unknown as SubspaceValue;
    return spanLatex(s.basis, s.ambient, s.certainty === 'exact');
  },
  typeLabel: (v) => {
    const s = v as unknown as SubspaceValue;
    return `${s.what} · ${dimName(s.basis.length, s.ambient)} in ${Rn(s.ambient)} (dim ${s.basis.length})`;
  },
  member: (v, prop) => {
    const s = v as unknown as SubspaceValue;
    if (prop === 'dim') return scalar(s.basis.length, { certainty: 'exact' });
    if (prop === 'basis') return { kind: 'list', items: s.basis.map((b) => vector(b, undefined, { certainty: s.certainty })), certainty: s.certainty };
    return undefined;
  },
});
registerItems('subspace', (v, k) => {
  const s = v as unknown as SubspaceValue;
  return s.basis[k] ? vector(s.basis[k], undefined, { certainty: s.certainty }) : undefined;
});

const PARAMS = ['s', 't', 'u', 'w', 'r', 'q'];
registerValueKind({
  kind: 'affine',
  latex: (v) => {
    const a = v as unknown as AffineValue;
    if (!a.consistent) return '\\varnothing\\quad\\text{(inconsistent)}';
    const ex = a.certainty === 'exact';
    const terms = [vectorLatex(a.particular!, ex), ...a.directions.map((d, i) => `${PARAMS[i] ?? `t_{${i + 1}}`}\\,${vectorLatex(d, ex)}`)];
    return `\\mathbf{x} = ${terms.join(' + ')}`;
  },
  typeLabel: (v) => {
    const a = v as unknown as AffineValue;
    if (!a.consistent) return 'no solution';
    const d = a.directions.length;
    return d === 0 ? 'unique solution' : d === 1 ? 'a line of solutions' : d === 2 ? 'a plane of solutions' : `${d}-parameter family of solutions`;
  },
  member: (v, prop) => {
    const a = v as unknown as AffineValue;
    if (prop === 'dim') return scalar(a.directions.length, { certainty: 'exact' });
    if ((prop === 'particular' || prop === 'point') && a.particular) return vector(a.particular, undefined, { certainty: a.certainty });
    return undefined;
  },
});

registerValueKind({
  kind: 'complex',
  latex: (v) => {
    const c = v as unknown as ComplexValue;
    const ex = c.certainty === 'exact';
    const re = Math.abs(c.re) < 1e-13 ? '' : entryLatex(c.re, ex);
    const im = Math.abs(c.im);
    const imL = Math.abs(im - 1) < 1e-13 ? '' : entryLatex(im, ex);
    return `${re}${c.im < 0 ? ' - ' : re ? ' + ' : ''}${imL}i`;
  },
  typeLabel: () => 'complex number',
  member: (v, prop) => {
    const c = v as unknown as ComplexValue;
    if (prop === 're') return scalar(c.re, { certainty: c.certainty });
    if (prop === 'im') return scalar(c.im, { certainty: c.certainty });
    return undefined;
  },
});

export function eigenspaceOf(e: EigenValue, k: number): SubspaceValue | undefined {
  const p = e.pairs[k];
  if (!p || p.im !== 0) return undefined;
  return subspace(e.n, p.basis, `eigenspace λ = ${numberLatex(p.re)}`, p.certainty, { lambda: p.re, role: 'eigen' });
}

registerValueKind({
  kind: 'eigen',
  latex: (v) => {
    const e = v as unknown as EigenValue;
    const rows = e.pairs
      .filter((p) => p.im >= 0)
      .map((p) => {
        const ex = p.certainty === 'exact';
        const mult = p.alg > 1 ? `\\ (\\text{alg. } ${p.alg},\\ \\text{geo. } ${p.geo})` : '';
        if (p.im !== 0) return `\\lambda = ${lambdaLatex(p, ex)}:\\ \\text{no real eigenvectors}`;
        return `\\lambda = ${entryLatex(p.re, ex)}:\\ ${spanLatex(p.basis, e.n, ex, false)}${mult}`;
      });
    return rows.length === 1 ? rows[0] : `\\begin{array}{l} ${rows.join(' \\\\ ')} \\end{array}`;
  },
  typeLabel: (v) => {
    const e = v as unknown as EigenValue;
    const real = e.pairs.filter((p) => p.im === 0).length;
    return `eigen-decomposition · ${real} real eigenvalue${real === 1 ? '' : 's'}${e.pairs.some((p) => p.im !== 0) ? ' + complex' : ''}`;
  },
  member: (v, prop) => {
    const e = v as unknown as EigenValue;
    if (prop === 'values') return eigenvaluesList(e);
    if (prop === 'vectors') return eigenvectorsList(e);
    return undefined;
  },
});
registerItems('eigen', (v, k) => eigenspaceOf(v as unknown as EigenValue, k));

export function eigenvaluesList(e: EigenValue): MathValue {
  const items: MathValue[] = [];
  for (const p of e.pairs) for (let i = 0; i < p.alg; i++) items.push(p.im === 0 ? scalar(p.re, { certainty: p.certainty }) : complex(p.re, p.im, p.certainty));
  return { kind: 'list', items, certainty: e.certainty };
}

export function eigenvectorsList(e: EigenValue): MathValue {
  const items = e.pairs.flatMap((p) => p.basis.map((b) => vector(b, undefined, { certainty: p.certainty, role: 'eigen' })));
  return { kind: 'list', items, certainty: e.certainty };
}

registerValueKind({
  kind: 'factorization',
  latex: (v) => {
    const f = v as unknown as FactorizationValue;
    const ex = f.certainty === 'exact';
    const name = (n: string) => (n === 'Pinv' ? 'P^{-1}' : n === 'S' ? '\\Sigma' : n === 'Vt' ? 'V^{T}' : n);
    // one factor per line: the row title already says A = P D P⁻¹
    return `\\begin{array}{l} ${f.factors.map(([n, m]) => `${name(n)} = ${matrixLatex(m, ex)}`).join(' \\\\[2pt] ')} \\end{array}`;
  },
  typeLabel: (v) => (v as unknown as FactorizationValue).what,
  member: (v, prop) => {
    const f = v as unknown as FactorizationValue;
    const alias: Record<string, string> = { Σ: 'S', Sigma: 'S', inv: 'Pinv' };
    const hit = f.factors.find(([n]) => n === (alias[prop] ?? prop));
    return hit ? matrixV(hit[1], { certainty: f.certainty }) : undefined;
  },
});