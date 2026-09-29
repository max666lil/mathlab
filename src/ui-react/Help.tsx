/** Quick reference for the MathLab Language (MLL). */
import { Tex } from './Tex';
import { allBuiltins } from '../math-core/builtins';

const SYNTAX: [string, string][] = [
  ['f(x) = x^3 - 3x   ·   f(x,y) = x^2 + 2y^2', 'define a function — it is analysed automatically (Analysis panel)'],
  ['P = point(1, 1) draggable   ·   a = slider(-5, 5, 1)', 'points you can drag, parameters with sliders'],
  ['derivative f   ·   derivative f wrt y order 2', 'derivatives (exact)'],
  ['integrate f   ·   integrate x^2 from 0 to 1', 'antiderivative (verified) or definite integral'],
  ['limit sin(x)/x as x -> 0   ·   … as x -> 0+   ·   … as x -> ∞', 'limits (exact by continuity, otherwise numeric evidence)'],
  ['solve x^2 - x - 1 = 0   ·   solve(x + y = 3, x - y = 1)', 'equations'],
  ['taylor exp(x) at 0 order 4', 'Taylor polynomials'],
  ['critical f · zeros f · extrema f · inflections f', 'point sets — they are objects: C = critical f, P = first(C), C[2]'],
  ['domain f · monotonicity f · concavity f · asymptotes f', 'more analysis results'],
  ['grad f at P · hessian f at P · tangent f at P', 'local analysis'],
  ['directional f at P toward (3,-2)', 'directional derivative, with its geometry'],
  ['A = [[2,1],[1,2]]   ·   v = <1, 2> draggable   ·   A v · A^-1 · Aᵀ · A^3', 'matrices are linear maps — analysed and animated automatically (drag î, ĵ)'],
  ['det A · rank A · rref A · inverse A · eigen A · charpoly A · diagonalize A', 'exact for rational matrices; results are objects (E = eigen A, E[1])'],
  ['nullspace A · columnspace A · span(u, v) · basis S · independent S · dim W', 'subspaces and bases'],
  ['solve(A, b) · project v onto W · leastsquares(A, b) · coords v in B', 'systems (row picture), projections, coordinates'],
  ['gramschmidt S · orthonormal S · qr A · svd A', 'orthogonalization and decompositions (◐ plays them step by step)'],
  ['transformation(A, B) · T(x,y) = (x + y, 2y)', 'composition B then A · linear maps by formula'],
  ['show derivative f · hide contours · show level f = 3', 'representation control (basics are shown automatically)'],
  ['compare f with taylor f at 0 order 4', 'overlay two functions and their difference'],
  ['analyze C', 'analyse another object in the Analysis panel'],
  ['\\theta ⇥', 'type \\theta, \\pi, \\nabla … for symbols · Enter = next row'],
];

export function HelpDialog({ onClose }: { onClose(): void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>MathLab Language</span>
          <button onClick={onClose}>✕</button>
        </div>
        <table className="kv help">
          <tbody>
            {SYNTAX.map(([code, what]) => (
              <tr key={code}>
                <td><code>{code}</code></td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="builtins">
          {allBuiltins().map((b) => (
            <div key={b.name} className="builtin">
              <code>{b.signature}</code>
              <span className="dim">{b.doc}</span>
            </div>
          ))}
        </div>
        <p className="dim">
          Every object is live: edit any cell and all dependent cells and views update. Dragging a point or a vector rewrites its
          definition in the notebook. <Tex tex={'D_{\\hat u}f = \\nabla f\\cdot \\hat u'} />
        </p>
      </div>
    </div>
  );
}