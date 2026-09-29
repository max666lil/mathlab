/**
 * Explanations for linear maps. Numbers come from the analyzer's facts, so the text always describes
 * the matrix being analysed; buttons replay the transformation on the canvas.
 */
import { usePres, useAnalysis, useTopics, useWs } from '../hooks';
import { LiveFormula, part } from './LiveFormula';
import { Tex } from '../Tex';
import { symbolLatex, numberLatex } from '../../math-core/symbolic/print';
import { MathValue, MatrixValue, FunctionValue, entryLatex, vectorLatex } from '../../math-core/values';
import { linearMatrixOf } from '../../plugins/linear-algebra/builtins';
import type { EigenValue, SubspaceValue } from '../../plugins/linear-algebra/values';

export const LINEAR_TOPICS = new Set(['det', 'eigen', 'rank', 'inverse', 'columns']);

const C = { i: '#83c167', j: '#fc6255', cell: '#f7d96f', eigen: '#c792ea', nul: '#ff6b6b', col: '#4cc9f0' };
const col = (c: string, tex: string) => `\\textcolor{${c}}{${tex}}`;
const N = (x: number) => entryLatex(x, true) || numberLatex(x, 3);

export function LinearExplain({ topic }: { topic: string }) {
  const an = useAnalysis();
  const pres = usePres();
  const ws = useWs();
  useTopics('values', 'view');
  const plan = an.plan();
  if (!plan) return null;
  const fact = (id: string): MathValue | undefined => {
    const spec = plan.facts.find((x) => x.id === id);
    return spec ? an.fact(plan, spec, true).value : undefined;
  };
  const A = plan.object;
  const AL = symbolLatex(A);
  const obj = ws.value(A);
  // a matrix, or a linear map T(x, y) = (…) through its standard matrix
  const M: MatrixValue | undefined =
    obj?.kind === 'matrix' ? (obj as MatrixValue) : obj?.kind === 'function' && linearMatrixOf(obj as FunctionValue) ? { kind: 'matrix', rows: linearMatrixOf(obj as FunctionValue)!, certainty: 'exact' } : undefined;
  if (!M) return null;
  const rows = M.rows;
  const n = rows[0].length;
  const replay = (to = 1) => pres.playTimeline(`lin:${A}`, { from: 0, to });
  const Replay = () => (
    <div className="explain-actions">
      <button onClick={() => replay()}>▶ Play I → {A} again</button>
    </div>
  );
  const colVec = (j: number) => vectorLatex(rows.map((r) => r[j]), M.certainty === 'exact');
  const detV = fact('det');
  const d = detV?.kind === 'scalar' ? (detV as { value: number }).value : undefined;
  const rankV = fact('rank');
  const r = rankV?.kind === 'scalar' ? (rankV as { value: number }).value : undefined;
  const unit = n === 3 ? 'unit cube' : 'unit square';
  const measure = n === 3 ? 'volume' : 'area';

  switch (topic) {
    case 'columns':
    case 'det':
      return (
        <div className="explain">
          <div className="explain-title">The columns are where the basis vectors land</div>
          <LiveFormula
            tex={`${AL}\\,${col(C.i, '\\hat{\\imath}')} = ${part(0, col(C.i, colVec(0)))},\\qquad ${AL}\\,${col(C.j, '\\hat{\\jmath}')} = ${part(1, col(C.j, colVec(1)))}`}
            parts={[{ keys: ['role:lintrans'] }, { keys: ['role:lintrans'] }]}
          />
          <p>
            A linear map is decided by what it does to <Tex tex={col(C.i, '\\hat{\\imath}')} /> and <Tex tex={col(C.j, '\\hat{\\jmath}')} />
            {n === 3 && <> and <Tex tex="\hat{k}" /></>}: every other vector is a combination of them, and grid lines stay parallel and evenly spaced.
          </p>
          {d !== undefined && (
            <>
              <div className="explain-title">The determinant is the {measure} scale</div>
              <LiveFormula tex={`\\det ${AL} = ${part(0, col(C.cell, N(d)))}`} parts={[{ keys: ['role:lintrans'] }]} />
              <p>
                The {unit} becomes a {n === 3 ? 'parallelepiped' : 'parallelogram'} of {measure} <Tex tex={`|\\det ${AL}| = ${N(Math.abs(d))}`} />
                , and every region's {measure} is multiplied by the same factor.{' '}
                {d < 0 && <>The sign is negative: the map flips orientation ({col(C.i, 'î')} and {col(C.j, 'ĵ')} swap their order).</>}
                {d === 0 && <>Here the {unit} is squashed flat — {A} loses a dimension, so it cannot be undone.</>}
              </p>
            </>
          )}
          <Replay />
        </div>
      );
    case 'eigen': {
      const e = fact('eigen') as EigenValue | undefined;
      const real = e?.pairs.filter((p) => p.im === 0) ?? [];
      return (
        <div className="explain">
          <div className="explain-title">Eigenvectors stay on their own line</div>
          <LiveFormula tex={`${AL}\\,${part(0, col(C.eigen, '\\mathbf{v}'))} = ${part(1, col(C.eigen, '\\lambda'))}\\,${part(0, col(C.eigen, '\\mathbf{v}'))}`} parts={[{ keys: ['role:eigen'] }, { keys: ['role:eigen'] }]} />
          <p>
            While the grid moves, most vectors are knocked off the line they span. Eigenvectors are not: they are only stretched by the factor
            <Tex tex={` ${col(C.eigen, '\\lambda')}`} /> (and flipped if <Tex tex="\lambda < 0" />).
          </p>
          <LiveFormula tex={`(${AL} - \\lambda I)\\mathbf{v} = \\mathbf{0},\\ \\mathbf{v} \\neq \\mathbf{0} \\iff \\det(${AL} - \\lambda I) = 0`} parts={[]} />
          <p>
            A non-zero vector is sent to <Tex tex="\mathbf{0}" /> by <Tex tex={`${AL} - \\lambda I`} /> only if that matrix squashes space — its determinant is
            0. So the eigenvalues are the roots of the characteristic polynomial.
          </p>
          {e && (
            <p>
              {real.length ? (
                <>
                  Here:{' '}
                  {real.map((p, k) => (
                    <span key={k}>
                      <Tex tex={`\\lambda = ${N(p.re)}`} /> on <Tex tex={p.basis.map((b) => vectorLatex(b, p.certainty === 'exact')).join(',\\ ')} />
                      {k < real.length - 1 ? '; ' : '.'}
                    </span>
                  ))}
                </>
              ) : (
                <>This matrix has no real eigenvalues: it rotates every direction (complex eigenvalues <Tex tex={`a \\pm bi`} /> mean rotation combined with scaling).</>
              )}
            </p>
          )}
          <Replay />
        </div>
      );
    }
    case 'rank': {
      const ns = fact('nullspace') as SubspaceValue | undefined;
      return (
        <div className="explain">
          <div className="explain-title">Rank = dimensions that survive</div>
          <LiveFormula
            tex={`\\underbrace{${part(0, col(C.col, `\\operatorname{rank} ${AL}`))}}_{\\dim \\operatorname{Col}} + \\underbrace{${part(1, col(C.nul, `\\dim \\operatorname{Nul} ${AL}`))}}_{\\text{squashed}} = ${n}`}
            parts={[{ keys: ['role:colspace'] }, { keys: ['role:nullspace'] }]}
          />
          <p>
            The column space is everything {A} can reach. The null space is everything {A} squashes onto <Tex tex="\mathbf{0}" />. Each input dimension either survives
            (counts toward the rank) or is squashed (counts toward the nullity).
          </p>
          {r !== undefined && (
            <p>
              Here <Tex tex={`\\operatorname{rank} ${AL} = ${r}`} />
              {ns && ns.basis.length > 0 ? (
                <>
                  {' '}and the line <Tex tex={`\\operatorname{span}\\{${ns.basis.map((b) => vectorLatex(b, ns.certainty === 'exact')).join(', ')}\\}`} /> collapses to the origin
                  — open “Null space & column space” and play the transformation to watch it.
                </>
              ) : (
                <>: nothing but <Tex tex="\mathbf{0}" /> is squashed.</>
              )}
            </p>
          )}
          <Replay />
        </div>
      );
    }
    case 'inverse':
      return (
        <div className="explain">
          <div className="explain-title">The inverse undoes the transformation</div>
          <LiveFormula tex={`${AL}^{-1}${AL} = I`} parts={[]} />
          <p>
            {AL && <Tex tex={`${AL}^{-1}`} />} moves every point back to where it came from. That is only possible if no two points were sent to the same place — i.e. nothing
            was squashed: <Tex tex={`\\det ${AL} \\neq 0`} />.
          </p>
          {d !== undefined && (
            <p>
              Here <Tex tex={`\\det ${AL} = ${N(d)}`} />
              {d === 0 ? ', so there is no inverse.' : `, and the inverse scales ${measure}s by 1/${numberLatex(Math.abs(d), 3)}.`}
            </p>
          )}
          <div className="explain-actions">
            <button onClick={() => pres.playTimeline(`lin:${A}`, { from: 1, to: 0 })}>◀ Play {A}⁻¹ (backwards)</button>
          </div>
        </div>
      );
  }
  return null;
}