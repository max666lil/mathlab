/** Numerical view + live explanation of the local geometry at the active point. */
import { useWs, useTopics } from '../hooks';
import { Tex } from '../Tex';
import { localAnalysis, LocalAnalysis } from '../../plugins/core-calculus/analysis';
import { numberLatex, symbolLatex } from '../../math-core/symbolic/print';
import { valueLatex, typeLabel, MathValue } from '../../math-core/values';

const N = (x: number) => numberLatex(x, 4);
const vecL = (v: number[]) => `\\left\\langle ${v.map(N).join(', ')}\\right\\rangle`;
const matL = (m: number[][]) => `\\begin{pmatrix}${m.map((r) => r.map(N).join(' & ')).join(' \\\\ ')}\\end{pmatrix}`;

function Explanation({ a }: { a: LocalAnalysis }) {
  const f = a.fnLabel;
  const P = symbolLatex(a.pointName);
  return (
    <div className="explain">
      <div className="explain-title">Why ∇{a.fnName} points uphill</div>
      {a.directions.length === 0 && <p>Add a direction, e.g. <code>u = &lt;1, 0&gt;</code> and <code>show arrow(P, u)</code>, to compare directions.</p>}
      {a.directions.map((d) => (
        <div key={d.name} className="explain-block">
          <Tex display tex={`\\begin{aligned} D_{\\hat ${symbolLatex(d.name)}}${f}(${P}) &= \\nabla ${f}\\cdot\\hat ${symbolLatex(d.name)} = \\lVert\\nabla ${f}\\rVert\\cos\\varphi \\\\ &= ${N(a.gNorm)}\\cdot\\cos(${N(d.angleDeg)}^\\circ) = ${N(d.D)}\\end{aligned}`} />
          <p>
            The slope of the surface in direction <span style={{ color: d.color }}>{d.name}</span> is the dot product with the gradient. It is
            largest (<Tex tex={`=\\lVert\\nabla ${f}\\rVert = ${N(a.gNorm)}`} />) when <Tex tex={'\\varphi = 0'} />, i.e. when {d.name} points along ∇{a.fnName};
            zero when {d.name} is tangent to the level curve (<Tex tex={'\\varphi = 90^\\circ'} />).
          </p>
          <Tex display tex={`\\hat ${symbolLatex(d.name)}^{\\mathsf T} H\\,\\hat ${symbolLatex(d.name)} = ${N(d.curvature)}`} />
          <p className="dim">second derivative along {d.name}: how the slice through P in that direction bends.</p>
        </div>
      ))}
    </div>
  );
}

function LocalCard({ a }: { a: LocalAnalysis }) {
  const f = a.fnLabel;
  const P = symbolLatex(a.pointName);
  const rows: [string, string][] = [
    [`${P}`, `\\left(${a.p.map(N).join(', ')}\\right)`],
    [`${f}(${P})`, N(a.f0)],
    [`\\nabla ${f}(${P})`, vecL(a.g)],
    [`\\lVert\\nabla ${f}\\rVert`, N(a.gNorm)],
    [`H_{${f}}(${P})`, matL(a.H)],
    ['\\lambda_1,\\ \\lambda_2', a.eig.map((e) => N(e.value)).join(',\\ ')],
    ['\\det H', N(a.detH)],
  ];
  return (
    <div className="local-card">
      <table className="kv">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td><Tex tex={k} /></td>
              <td><Tex tex={v} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="classification">{a.classification}</div>
    </div>
  );
}

export function ValuesPanel() {
  const ws = useWs();
  useTopics('values', 'selection', 'view', 'doc');
  const a = localAnalysis(ws);
  const named = ws.statements().filter((s) => s.name && ws.value(s.id));
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Values & explanation</span>
      </div>
      <div className="panel-body scroll values">
        {a && (
          <div className="values-grid">
            <LocalCard a={a} />
            <Explanation a={a} />
          </div>
        )}
        <table className="kv named">
          <tbody>
            {named.map((s) => {
              const v = ws.value(s.id) as MathValue;
              if (v.kind === 'function' || v.kind === 'show' || v.kind === 'animation') return null;
              return (
                <tr key={s.id} className={ws.selection === s.id ? 'selected' : ''} onClick={() => ws.select(s.id)}>
                  <td><Tex tex={symbolLatex(s.name!)} /></td>
                  <td><Tex tex={valueLatex(v)} /></td>
                  <td className="dim">{typeLabel(v)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}