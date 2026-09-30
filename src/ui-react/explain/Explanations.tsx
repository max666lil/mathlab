/**
 * Concept explanations for the gradient lab. Each formula term is a live handle on the scene
 * (see LiveFormula); numbers update while you drag. Symbols use the same colours as the views.
 */
import { useWs, usePres, useTopics, useEmphasis, useAnalysis } from '../hooks';
import { LiveFormula, part } from './LiveFormula';
import { Tex } from '../Tex';
import { localAnalysis, LocalAnalysis, DirectionInfo } from '../../plugins/core-calculus/analysis';
import { numberLatex, symbolLatex } from '../../math-core/symbolic/print';
import { ROLE_COLORS } from '../../visualization/scene-model';
import { LinearExplain, LINEAR_TOPICS } from './LinearExplain';
import { VectorExplain, VECTOR_TOPICS } from './VectorExplain';
import { MultivarExplain, MULTIVAR_TOPICS } from './MultivarExplain';

const N = (x: number, d = 3) => numberLatex(x, d);
const col = (role: string, tex: string) => `\\textcolor{${ROLE_COLORS[role]}}{${tex}}`;
const GRAD = ['role:gradient'];
const LEVEL = ['role:level'];
const DIR = ['role:direction'];

function SurfaceExplain({ a }: { a: LocalAnalysis }) {
  const pres = usePres();
  const f = a.fnLabel;
  return (
    <div className="explain">
      <div className="explain-title">One object, two pictures</div>
      <LiveFormula
        tex={`${part(0, `z = ${f}(x,y)`)} \\qquad\\longleftrightarrow\\qquad ${part(1, `${f}(x,y) = c`)}`}
        parts={[{ keys: ['role:surface'], isolate: true }, { keys: ['role:contours'], isolate: true }]}
      />
      <p>
        The surface and the contour map are the same function. Each contour is the set of points at one height <Tex tex="c" />:
        slice the surface horizontally and look down.
      </p>
      <LiveFormula tex={`${part(0, `${f}(P) = ${N(a.f0)}`)}`} parts={[{ keys: ['role:point'] }]} />
      <p className="dim">Drag P: its height on the surface and the contour it sits on change together.</p>
      <div className="explain-actions">
        <button onClick={() => pres.command('flatten')}>Flatten the surface into its contour map</button>
        <button onClick={() => pres.command('unflatten')}>Back to 3D</button>
      </div>
    </div>
  );
}

function GradientExplain({ a }: { a: LocalAnalysis }) {
  const f = a.fnLabel;
  const P = symbolLatex(a.pointName);
  const g = col('gradient', `\\nabla ${f}`);
  const t = col('level', '\\mathbf t');
  return (
    <div className="explain">
      <div className="explain-title">The gradient is perpendicular to the contour</div>
      <LiveFormula
        tex={`${part(0, `${g}(${P})`)} = \\left\\langle \\tfrac{\\partial ${f}}{\\partial x}, \\tfrac{\\partial ${f}}{\\partial y}\\right\\rangle = ${part(1, `\\left\\langle ${N(a.g[0])}, ${N(a.g[1])}\\right\\rangle`)}`}
        parts={[{ keys: GRAD }, { keys: GRAD }]}
      />
      <p>
        Along the level curve through P, <Tex tex={`${f}`} /> does not change, so its rate of change in the tangent direction{' '}
        <Tex tex={t} /> is zero:
      </p>
      <LiveFormula
        tex={`${part(0, g)} \\cdot ${part(1, t)} ${part(2, '= 0')}`}
        parts={[{ keys: GRAD, isolate: true }, { keys: LEVEL, isolate: true }, { keys: [...GRAD, ...LEVEL], isolate: true }]}
      />
      <p>
        So <Tex tex={g} /> meets the contour at a right angle and points straight uphill, across the contours. Its length
      </p>
      <LiveFormula tex={`${part(0, `\\lVert ${g} \\rVert = ${N(a.gNorm)}`)}`} parts={[{ keys: GRAD, isolate: true }]} />
      <p className="dim">is the steepest slope at P: drag P to where contours crowd together and watch it grow.</p>
    </div>
  );
}

function Gauge({ a, d }: { a: LocalAnalysis; d: DirectionInfo }) {
  const emph = useEmphasis();
  const W = 300;
  const x = (v: number) => 14 + ((v + a.gNorm) / (2 * a.gNorm || 1)) * (W - 28);
  const on = emph.active(['role:slice-dir']);
  return (
    <svg className={`gauge ${on ? 'on' : ''}`} viewBox={`0 0 ${W} 58`} onMouseEnter={() => emph.enter(['role:slice-dir', ...DIR])} onMouseLeave={emph.leave}>
      <line x1={x(-a.gNorm)} x2={x(a.gNorm)} y1={24} y2={24} className="gauge-axis" />
      <rect x={Math.min(x(0), x(d.D))} y={18} width={Math.abs(x(d.D) - x(0))} height={12} rx={3} fill={d.D >= 0 ? '#52d69b' : '#ff6b6b'} opacity={0.85} />
      <line x1={x(0)} x2={x(0)} y1={12} y2={36} className="gauge-zero" />
      <circle cx={x(d.D)} cy={24} r={6} fill={ROLE_COLORS.direction} />
      <text x={x(-a.gNorm)} y={52} textAnchor="start">−‖∇f‖ descent</text>
      <text x={x(0)} y={52} textAnchor="middle">0 · along contour</text>
      <text x={x(a.gNorm)} y={52} textAnchor="end">‖∇f‖ ascent</text>
    </svg>
  );
}

function DirectionalExplain({ a }: { a: LocalAnalysis }) {
  const ws = useWs();
  const f = a.fnLabel;
  const P = symbolLatex(a.pointName);
  const d = a.directions[0];
  if (!d) return <div className="explain">Add a direction, e.g. <code>u = &lt;1, 0&gt;</code> and <code>show arrow(P, u)</code>.</div>;
  const un = symbolLatex(d.name);
  const g = col('gradient', `\\nabla ${f}`);
  const u = col('direction', `\\hat{${un}}`);
  const D = `D_{${u}}${f}(${P})`;
  const slider = ws.graph.ancestors(d.name).find((id) => ws.isScalarInput(id));
  const cosPhi = Math.cos((d.angleDeg * Math.PI) / 180);
  const angleKeys = [...GRAD, ...DIR, 'annot:angle'];
  return (
    <div className="explain">
      <div className="explain-title">Why the gradient is the direction of fastest increase</div>
      <LiveFormula
        tex={`${part(0, D)} = ${part(1, g)}\\cdot ${part(2, u)} = ${part(3, `\\lVert ${g}\\rVert`)}\\,${part(4, '\\cos\\varphi')}`}
        parts={[{ keys: ['role:slice-dir', ...DIR] }, { keys: GRAD }, { keys: DIR }, { keys: GRAD, isolate: true }, { keys: angleKeys, isolate: true }]}
      />
      <LiveFormula
        tex={`= ${part(0, N(a.gNorm))} \\cdot ${part(1, `\\cos(${N(d.angleDeg, 3)}^\\circ)`)} = ${part(2, `${N(a.gNorm)} \\cdot ${N(cosPhi)}`)} = ${part(3, N(d.D))}`}
        parts={[{ keys: GRAD, isolate: true }, { keys: angleKeys, isolate: true }, { keys: angleKeys }, { keys: ['role:slice-dir', ...DIR] }]}
      />
      <Gauge a={a} d={d} />
      <p>
        <Tex tex={D} /> is the slope of the surface above the line through P in direction <Tex tex={u} /> — the u-slice. Only the angle{' '}
        <Tex tex="\varphi" /> between <Tex tex={u} /> and <Tex tex={g} /> matters: the slope is largest when <Tex tex="\varphi = 0" />, zero when{' '}
        <Tex tex={u} /> runs along the contour (<Tex tex="\varphi = 90^\circ" />), most negative when <Tex tex="\varphi = 180^\circ" />.
      </p>
      {slider && (
        <div className="explain-actions">
          <button onClick={() => ws.toggleAnimation(slider)}>{ws.isPlaying(slider) ? '❚❚ Stop' : `▶ Rotate ${d.name}`}</button>
          <span className="dim">or drag the tip of {d.name} in either view</span>
        </div>
      )}
    </div>
  );
}

function LocalExplain({ a }: { a: LocalAnalysis }) {
  const pres = usePres();
  const f = a.fnLabel;
  const P = symbolLatex(a.pointName);
  const lin = col('tangent', `\\nabla ${f}(${P})\\cdot\\Delta`);
  const quad = col('quadratic', `\\tfrac12\\,\\Delta^{\\mathsf T} H\\,\\Delta`);
  const shape = a.eig.every((e) => e.value > 0) ? 'a bowl: it curves up in every direction' : a.eig.every((e) => e.value < 0) ? 'a dome: it curves down in every direction' : a.eig.some((e) => e.value > 0) && a.eig.some((e) => e.value < 0) ? 'a saddle: up in one principal direction, down in the other' : 'flat in some direction';
  return (
    <div className="explain">
      <div className="explain-title">Zoom in: plane first, then curvature</div>
      <LiveFormula
        tex={`${f}(${P}+\\Delta) \\approx ${part(0, `${f}(${P})`)} + ${part(1, lin)} + ${part(2, quad)}`}
        parts={[{ keys: ['role:point'] }, { keys: ['role:tangent'], isolate: true }, { keys: ['role:quadratic', 'role:hessian'], isolate: true }]}
      />
      <p>
        Close to P the surface is almost its tangent plane (the linear term). The quadratic term bends the plane: along the principal directions
        of <Tex tex="H" /> the curvature is
      </p>
      <LiveFormula
        tex={part(0, a.eig.map((e, i) => `\\lambda_${i + 1} = ${N(e.value)}`).join(',\\quad '))}
        parts={[{ keys: ['role:hessian'], isolate: true }]}
      />
      <p className="dim">Near P the surface is {shape}.</p>
      <div className="explain-actions">
        <button onClick={() => pres.command('shot:zoom')}>Zoom into P</button>
        <button onClick={() => pres.command('shot:tangent')}>See the plane edge-on</button>
      </div>
    </div>
  );
}

/**
 * f: ℝ → ℝ — the derivative as the slope of the tangent line. Numbers come from the analyzer's facts
 * (f(a), f′(a), a), so the explanation always describes the object that is being analysed.
 */
function TangentExplain1D() {
  const an = useAnalysis();
  const plan = an.plan();
  if (!plan) return null;
  const fact = (id: string) => {
    const spec = plan.facts.find((x) => x.id === id);
    const v = spec ? an.fact(plan, spec).value : undefined;
    return v?.kind === 'scalar' ? (v as { value: number }).value : undefined;
  };
  const a = fact('a');
  const fa = fact('value-at');
  const m = fact('slope-at');
  if (a === undefined || fa === undefined || m === undefined) return <div className="empty">Add a point a to see the explanation.</div>;
  const f = symbolLatex(plan.object);
  const tangent = ['role:tangent'];
  const trend = Math.abs(m) < 1e-9 ? 'horizontal: a critical point candidate' : m > 0 ? `rising: ${plan.object} is increasing at a` : `falling: ${plan.object} is decreasing at a`;
  return (
    <div className="explain">
      <div className="explain-title">The derivative is the slope of the tangent line</div>
      <LiveFormula
        tex={`L(x) = ${part(0, `${f}(a)`)} + ${part(1, col('tangent', `${f}'(a)`))}\\,(x - a)`}
        parts={[{ keys: ['role:point'] }, { keys: tangent, isolate: true }]}
      />
      <LiveFormula
        tex={`= ${part(0, N(fa))} ${m < 0 ? '-' : '+'} ${part(1, N(Math.abs(m)))}\\,(x ${a < 0 ? '+' : '-'} ${N(Math.abs(a))})`}
        parts={[{ keys: ['role:point'] }, { keys: tangent, isolate: true }]}
      />
      <p>
        <Tex tex={`${f}'(a) = \\lim_{h\\to 0} \\frac{${f}(a+h) - ${f}(a)}{h}`} /> is the limit of secant slopes. The tangent line is the best
        linear approximation of <Tex tex={f} /> near <Tex tex="a" />.
      </p>
      <p>
        Here <Tex tex={`${f}'(${N(a)}) = ${N(m)}`} />, so the tangent is {trend}. Drag the slider for <Tex tex="a" /> (or play it) and watch the
        slope change sign at the critical points.
      </p>
    </div>
  );
}

/** Explanations by topic (shown from an analysis card's "Why?"). */
export function Explanation({ topic }: { topic: string }) {
  const ws = useWs();
  if (topic === 'tangent-1d') return <TangentExplain1D />;
  if (LINEAR_TOPICS.has(topic)) return <LinearExplain topic={topic} />;
  if (VECTOR_TOPICS.has(topic)) return <VectorExplain topic={topic} />;
  if (MULTIVAR_TOPICS.has(topic)) return <MultivarExplain topic={topic} />;
  useTopics('values', 'view', 'selection', 'animation');
  const a = localAnalysis(ws);
  if (!a) return <div className="empty">Add a point to see the explanation.</div>;
  switch (topic) {
    case 'surface':
      return <SurfaceExplain a={a} />;
    case 'local':
      return <LocalExplain a={a} />;
    default:
      return (
        <div className="explain-stack">
          <GradientExplain a={a} />
          {a.directions.length > 0 && <DirectionalExplain a={a} />}
          <LocalExplain a={a} />
        </div>
      );
  }
}