/**
 * Explanations for vector fields (divergence and curl) and for the Laplacian of a scalar field.
 * Numbers come from the analyzer's facts, so they always describe the object being analysed.
 */
import { useAnalysis, useTopics } from '../hooks';
import { LiveFormula, part } from './LiveFormula';
import { Tex } from '../Tex';
import { symbolLatex, numberLatex } from '../../math-core/symbolic/print';
import { MathValue, valueLatex } from '../../math-core/values';

export const VECTOR_TOPICS = new Set(['divcurl', 'laplacian', 'lineintegral', 'green', 'flux', 'stokes', 'divergence']);

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
  if (topic === 'flux' || topic === 'stokes' || topic === 'divergence') {
    const th = (fact(topic === 'stokes' ? 'stokes' : topic === 'divergence' ? 'gauss' : 'flux') ?? null) as unknown as { lhs?: number; rhs?: number; value?: number } | null;
    const both = th && th.lhs !== undefined ? <p>Here the two sides are <Tex tex={`${numberLatex(th.lhs, 5)}`} /> and <Tex tex={`${numberLatex(th.rhs!, 5)}`} />.</p> : null;
    if (topic === 'flux')
      return (
        <div className="explain">
          <div className="explain-title">Flux: how much of the field passes through the surface</div>
          <LiveFormula tex={`\\iint_S \\mathbf{F}\\cdot d\\mathbf{S} = \\iint_D \\mathbf{F}(\\mathbf{S}(u,v))\\cdot(\\mathbf{S}_u\\times\\mathbf{S}_v)\\,du\\,dv`} parts={[]} />
          <p>
            Each small patch of the surface has area |S_u × S_v| du dv and a normal direction. Only the part of F along the normal crosses the patch (green
            arrows cross along the normal, red ones against it). Closed surfaces are oriented outward.
          </p>
          {th?.value !== undefined && <p>Here the flux is <Tex tex={numberLatex(th.value, 5)} />.</p>}
        </div>
      );
    if (topic === 'stokes')
      return (
        <div className="explain">
          <div className="explain-title">Stokes: circulation around the edge = total curl through the surface</div>
          <LiveFormula tex={`\\oint_{\\partial S} \\mathbf{F}\\cdot d\\mathbf{r} = \\iint_S (\\nabla\\times\\mathbf{F})\\cdot d\\mathbf{S}`} parts={[]} />
          <p>
            The same cancellation as in Green's theorem, on a curved surface: cut S into small patches, each with circulation ≈ (curl F)·n ΔS. Shared edges
            cancel; only the boundary curve ∂S (yellow, walked with the surface on the left of the normal) remains. Any surface with the same boundary gives the
            same answer.
          </p>
          {both}
        </div>
      );
    return (
      <div className="explain">
        <div className="explain-title">Divergence theorem: outflow through the skin = sources inside</div>
        <LiveFormula tex={`\\oint\\!\\!\\oint_{S} \\mathbf{F}\\cdot d\\mathbf{S} = \\iiint_V \\nabla\\cdot\\mathbf{F}\\,dV`} parts={[]} />
        <p>
          Divergence is the outflow per unit volume of a tiny box. Fill the solid with boxes: the flux between neighbouring boxes cancels, and what leaves through
          the outer skin is the sum of all the sources inside.
        </p>
        {both}
      </div>
    );
  }
  if (topic === 'green') {
    const g = fact('green') as unknown as { lhs: number; rhs: number } | undefined;
    return (
      <div className="explain">
        <div className="explain-title">Green's theorem: the inside cancels, only the boundary is left</div>
        <LiveFormula tex={`\\oint_{C} \\mathbf{F}\\cdot d\\mathbf{r} = \\iint_{D} \\Big(\\frac{\\partial Q}{\\partial x} - \\frac{\\partial P}{\\partial y}\\Big)\\,dA`} parts={[]} />
        <p>
          Cut the region into small cells. Each cell has its own little circulation ≈ (curl F)·ΔA — that is what curl means. Add them all up: every edge shared
          by two cells is walked once in each direction, so those contributions cancel (the faint dashed edges). What survives is the outer boundary — the
          circulation around C.
        </p>
        <p>Play the animation: as the cells get smaller, Σ (curl F)·ΔA approaches ∮ F·dr.</p>
        {g && (
          <p>
            Here <Tex tex={`\\oint = ${numberLatex(g.lhs, 5)}`} /> and <Tex tex={`\\iint = ${numberLatex(g.rhs, 5)}`} />.
          </p>
        )}
      </div>
    );
  }
  if (topic === 'lineintegral') {
    const w = fact('work') ?? fact('circulation');
    return (
      <div className="explain">
        <div className="explain-title">Work adds up F·Δr along the path</div>
        <LiveFormula tex={`\\int_C \\mathbf{F}\\cdot d\\mathbf{r} = \\int_a^b \\mathbf{F}(\\mathbf{r}(t))\\cdot \\mathbf{r}'(t)\\,dt`} parts={[]} />
        <p>
          Cut the path into tiny steps Δr. On each step the field contributes F·Δr: positive when it pushes along the motion (green arrows), negative when it
          pushes against it (red). The moving point shows the running total.
        </p>
        <p>
          Around a closed curve this is the <b>circulation</b>. For a gradient field F = ∇φ it only depends on the end points (φ(end) − φ(start)), so every closed
          loop gives 0. The flux ∮ F·n ds instead adds up the part of F crossing the curve (outward positive).
        </p>
        {w && <p>Here the total is <Tex tex={valueLatex(w)} />.</p>}
      </div>
    );
  }
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