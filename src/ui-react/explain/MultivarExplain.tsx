/**
 * Explanations for multiple integrals: iterated integrals as sweeping strips (Fubini) and the polar
 * area element r dr dθ (the Jacobian). Bounds and values come from the analyzer's facts.
 */
import { useAnalysis, useTopics } from '../hooks';
import { LiveFormula } from './LiveFormula';
import { Tex } from '../Tex';
import { numberLatex, symbolLatex } from '../../math-core/symbolic/print';
import type { MathValue } from '../../math-core/values';

export const MULTIVAR_TOPICS = new Set(['iterated', 'polar', 'polar-gradient']);

export function MultivarExplain({ topic }: { topic: string }) {
  const an = useAnalysis();
  useTopics('values', 'view');
  const plan = an.plan();
  if (!plan) return null;
  const fact = (id: string): (MathValue & { latex?: string; derivation?: string; value?: number }) | undefined => {
    const spec = plan.facts.find((x) => x.id === id);
    return spec ? (an.fact(plan, spec, true).value as MathValue & { latex?: string; derivation?: string; value?: number }) : undefined;
  };
  const R = symbolLatex(plan.object);
  if (topic === 'polar-gradient') {
    const g = fact('gradpolar') ?? fact('gradient');
    const radial = (g as { polar?: { radial?: boolean } } | undefined)?.polar?.radial;
    return (
      <div className="explain">
        <div className="explain-title">The same gradient, written with “outward” and “around”</div>
        <LiveFormula tex={`\\mathbf e_r = (\\cos\\theta, \\sin\\theta),\\quad \\mathbf e_\\theta = (-\\sin\\theta, \\cos\\theta) \\qquad \\nabla f = f_r\\,\\mathbf e_r + \\frac{1}{r}\\,f_\\theta\\,\\mathbf e_\\theta`} parts={[]} />
        <p>
          (x, y) says “so far along x, so far along y”; (r, θ) says “this far from the origin, in this direction”. The two directions of polar coordinates move
          with the point: e<sub>r</sub> points away from the origin, e<sub>θ</sub> around the circle (e<sub>r</sub> turned 90° counter-clockwise). Both are unit vectors.
        </p>
        <p>
          The gradient measures how fast f changes <b>per unit of distance</b>. Along e<sub>r</sub> a step dr is a distance dr, so the rate is f<sub>r</sub>. But θ is an
          angle: turning by dθ at radius r covers the arc ds = r dθ (the orange arc). Per unit of distance the change is f<sub>θ</sub> dθ / (r dθ) = f<sub>θ</sub> / r —
          that is the 1/r.
        </p>
        <p>
          On the canvas the two parts are drawn head to tail at the point and add up to ∇f (gold). It is the same vector as (f<sub>x</sub>, f<sub>y</sub>); the
          summary also gives its x and y components.
        </p>
        {radial && (
          <p>
            Here f depends on r only, so f<sub>θ</sub> = 0 and ∇f = f′(r) e<sub>r</sub>: the contours are circles r = const and the gradient points straight out,
            perpendicular to them.
          </p>
        )}
        {g && <LiveFormula tex={(g as { display?: string }).display ?? ''} parts={[]} />}
        <table className="explain-table">
          <tbody>
            <tr><td></td><td>Cartesian</td><td>Polar</td></tr>
            <tr><td>position</td><td><Tex tex="(x, y)" /></td><td><Tex tex="(r, \theta)" /></td></tr>
            <tr><td>directions</td><td><Tex tex="\mathbf e_x, \mathbf e_y" /></td><td><Tex tex="\mathbf e_r, \mathbf e_\theta" /></td></tr>
            <tr><td>lengths</td><td><Tex tex="dx,\ dy" /></td><td><Tex tex="dr,\ r\,d\theta" /></td></tr>
            <tr><td>rates</td><td><Tex tex="f_x,\ f_y" /></td><td><Tex tex="f_r,\ \tfrac{1}{r} f_\theta" /></td></tr>
          </tbody>
        </table>
      </div>
    );
  }
  if (topic === 'polar') {
    const b = fact('polarBounds');
    const m = fact('polarMeasure');
    return (
      <div className="explain">
        <div className="explain-title">Why dA = r dr dθ</div>
        <LiveFormula tex={`x = r\\cos\\theta,\\quad y = r\\sin\\theta \\qquad \\det\\begin{pmatrix} \\cos\\theta & -r\\sin\\theta \\\\ \\sin\\theta & r\\cos\\theta \\end{pmatrix} = r`} parts={[]} />
        <p>
          The polar grid cuts the region into small sectors. A sector between radii r and r + Δr and angles θ and θ + Δθ is almost a rectangle with sides Δr
          and r Δθ, so its area is ΔA ≈ r Δr Δθ (the highlighted cell). Far from the origin the cells are bigger — that is the factor r, the determinant of the
          Jacobian of (r, θ) ↦ (x, y).
        </p>
        {b?.latex && (
          <p>
            In polar coordinates the region is <Tex tex={b.latex} />, a rectangle in the (r, θ) plane — which is why round regions are easier there.
          </p>
        )}
        {m?.value !== undefined && (
          <p>
            Its {plan.typeLabel.includes('ℝ³') ? 'volume' : 'area'} is <Tex tex={numberLatex(m.value, 6)} />.
          </p>
        )}
      </div>
    );
  }
  // iterated integrals
  const b1 = fact('bounds');
  const b2 = fact('bounds2');
  const I = fact('integral');
  return (
    <div className="explain">
      <div className="explain-title">An iterated integral sweeps the region with strips</div>
      <LiveFormula tex={`\\iint_{R} f\\,dA = \\int_{a}^{b}\\left(\\int_{g_1(x)}^{g_2(x)} f(x,y)\\,dy\\right)dx`} parts={[]} />
      <p>
        Fix x: the vertical strip through x runs from the lower boundary y = g₁(x) (blue) to the upper boundary y = g₂(x) (orange). The inner integral adds f
        along that strip; the outer integral adds the strips as x sweeps from a to b. The outer bounds are constants; inner bounds may depend on the outer
        variable. Where the lower or upper boundary changes formula, the region is split into pieces.
      </p>
      {b1?.latex && (
        <p>
          <Tex tex={`${R}:\\; ${b1.latex}`} />
        </p>
      )}
      {b2?.latex && (
        <p>
          The same region with horizontal strips (the other order): <Tex tex={b2.latex} />. Swapping the order can turn an impossible inner integral into an easy
          one.
        </p>
      )}
      {I?.derivation && (
        <p>
          <Tex tex={`${I.derivation} = ${numberLatex(I.value ?? NaN, 6)}`} />
        </p>
      )}
    </div>
  );
}