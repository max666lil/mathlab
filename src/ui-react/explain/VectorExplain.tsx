/**
 * Explanations for vector fields (divergence and curl) and for the Laplacian of a scalar field.
 * Numbers come from the analyzer's facts, so they always describe the object being analysed.
 */
import { useAnalysis, useTopics } from '../hooks';
import { LiveFormula, part } from './LiveFormula';
import { Tex } from '../Tex';
import { symbolLatex, numberLatex } from '../../math-core/symbolic/print';
import { MathValue, valueLatex } from '../../math-core/values';

export const VECTOR_TOPICS = new Set(['divcurl', 'laplacian']);

const col = (c: string, tex: string) => `\\textcolor{${c}}{${tex}}`;
const OUT = '#ff6b6b';
const PAD = '#f4a261';
const MEAN = '#c792ea';

function body(v: MathValue | undefined): string {
  if (!v) return '?';
  const t = valueLatex(v);
  const eq = t.indexOf(' = ');
  return eq > 0 ? t.slice(eq + 3) : t;
}

export function VectorExplain({ topic }: { topic: string }) {
  const an = useAnalysis();
  useTopics('values', 'view');
  const plan = an.plan();
  if (!plan) return null;
  const fact = (id: string): MathValue | undefined => {
    const spec = plan.facts.find((x) => x.id === id);
    return spec ? an.fact(plan, spec, true).value : undefined;
  };
  const num = (id: string) => {
    const v = fact(id);
    return v?.kind === 'scalar' ? (v as { value: number }).value : undefined;
  };
  const F = symbolLatex(plan.object);
  if (topic === 'laplacian') {
    const L = fact('laplacian');
    const lp = num('lapP');
    return (
      <div className="explain">
        <div className="explain-title">The Laplacian compares a value with its neighbours</div>
        <LiveFormula tex={`${part(0, col(MEAN, `\\nabla^2 ${F}`))} = \\nabla\\cdot\\nabla ${F} = ${F}_{xx} + ${F}_{yy}`} parts={[{ keys: ['role:laplacian'] }]} />
        <p>
          Average <Tex tex={F} /> over a small circle of radius <Tex tex="r" /> around <Tex tex="P" />:
        </p>
        <LiveFormula tex={`\\overline{${F}}_{\\text{circle}} - ${F}(P) \\approx \\frac{r^2}{4}\\,${part(0, col(MEAN, `\\nabla^2 ${F}(P)`))}`} parts={[{ keys: ['role:laplacian'] }]} />
        <p>
          <Tex tex={`\\nabla^2 ${F} > 0`} />: the neighbours are higher on average (a valley-like point). <Tex tex={`\\nabla^2 ${F} < 0`} />: lower (a peak-like point).{' '}
          <Tex tex={`\\nabla^2 ${F} = 0`} /> everywhere means <Tex tex={F} /> is <b>harmonic</b>: every value is the average of its surroundings — the steady-state
          temperature of the heat equation.
        </p>
        {L && (
          <p>
            Here <Tex tex={`\\nabla^2 ${F} = ${body(L)}`} />
            {lp !== undefined && (
              <>
                , and at <Tex tex="P" /> it is <Tex tex={numberLatex(lp, 4)} />
              </>
            )}
            .
          </p>
        )}
      </div>
    );
  }
  const div = fact('div');
  const curl = fact('curl');
  const dP = num('divP');
  const cP = num('curlP');
  return (
    <div className="explain">
      <div className="explain-title">Divergence: net outflow of a tiny box</div>
      <LiveFormula tex={`${part(0, col(OUT, `\\operatorname{div} ${F}`))} = \\frac{\\partial P}{\\partial x} + \\frac{\\partial Q}{\\partial y} = \\lim_{\\text{box} \\to P} \\frac{\\text{flux out of the box}}{\\text{area}}`} parts={[{ keys: ['role:flux'] }]} />
      <p>
        Put a small box around a point: red arrows leave it, blue ones enter. Divergence is what flows out minus what flows in, per unit area. Positive: a source
        (particles spread apart); negative: a sink (particles bunch up).
      </p>
      {div && (
        <p>
          Here <Tex tex={`\\operatorname{div} ${F} = ${body(div)}`} />
          {dP !== undefined && (
            <>
              {' '}— at <Tex tex="P" /> it is <Tex tex={numberLatex(dP, 4)} />
            </>
          )}
          .
        </p>
      )}
      <div className="explain-title">Curl: how fast a paddle wheel spins</div>
      <LiveFormula tex={`${part(0, col(PAD, `\\operatorname{curl} ${F}`))} = \\frac{\\partial Q}{\\partial x} - \\frac{\\partial P}{\\partial y} = 2 \\times \\text{angular speed of a tiny paddle wheel}`} parts={[{ keys: ['role:paddle'] }]} />
      <p>
        Drop a tiny paddle wheel into the flow. If the flow is faster on one side than the other, it turns. Counter-clockwise is positive. A field with curl 0 everywhere
        (on a domain without holes) is <b>conservative</b>: it is the gradient of a potential φ, and work around every closed loop is 0.
      </p>
      {curl && (
        <p>
          Here <Tex tex={`\\operatorname{curl} ${F} = ${body(curl)}`} />
          {cP !== undefined && (
            <>
              {' '}— at <Tex tex="P" /> it is <Tex tex={numberLatex(cP, 4)} />
            </>
          )}
          .
        </p>
      )}
    </div>
  );
}