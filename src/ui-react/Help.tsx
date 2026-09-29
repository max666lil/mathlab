/** Quick reference for the MathLab Language (MLL). */
import { Tex } from './Tex';
import { allBuiltins } from '../math-core/builtins';

const SYNTAX: [string, string][] = [
  ['f(x,y) = x^2 + 2y^2', 'define a function (implicit multiplication, x², π, θ allowed)'],
  ['P = point(1, 1) draggable', 'a point you can drag in the 2D and 3D views'],
  ['a = slider(-5, 5, 1)   or   a ∈ [-5, 5]', 'a parameter with a slider'],
  ['u = <cos θ, sin θ>', 'a vector'],
  ['g = grad(f) at P   ·   ∇f(P)   ·   grad f at P', 'evaluate the gradient at P'],
  ["f'(x),  f_x,  f_xy", 'derivative / partial derivative notation'],
  ['D = g · u', 'dot product (also ×, norm, normalize, det, ...)'],
  ['show surface(f), contours(f)', 'add objects to the views'],
  ['show slice(f, x = P.x)   ·   slice(f, P, u)', 'cross-sections'],
  ['show quadratic(f, P) hidden', 'create hidden (toggle it from the chips)'],
  ['animate θ from 0 to 2π', 'animation (play button in the output)'],
  ['\\theta ⇥', 'type \\theta, \\pi, \\nabla ... for Greek letters'],
  ['1 2 3 4', 'switch concept mode: Surface, Gradient, Directional derivative, Local geometry'],
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