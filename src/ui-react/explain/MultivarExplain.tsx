/**
 * Explanations for multiple integrals: iterated integrals as sweeping strips (Fubini) and the polar
 * area element r dr dθ (the Jacobian). Bounds and values come from the analyzer's facts.
 */
import { useAnalysis, useTopics } from '../hooks';
import { LiveFormula } from './LiveFormula';
import { Tex } from '../Tex';
import { numberLatex, symbolLatex } from '../../math-core/symbolic/print';
import type { MathValue } from '../../math-core/values';

export const MULTIVAR_TOPICS = new Set(['iterated', 'polar']);

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