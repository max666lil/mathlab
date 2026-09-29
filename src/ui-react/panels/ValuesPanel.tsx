/** Numerical view: local analysis at P and every named value, linked to the scene by hover. */
import { useWs, useTopics, useEmphasis } from '../hooks';
import { Tex } from '../Tex';
import { localAnalysis, LocalAnalysis } from '../../plugins/core-calculus/analysis';
import { numberLatex, symbolLatex } from '../../math-core/symbolic/print';
import { valueLatex, typeLabel, MathValue } from '../../math-core/values';
import type { Workspace } from '../../runtime/workspace';

const N = (x: number) => numberLatex(x, 4);
const vecL = (v: number[]) => `\\left\\langle ${v.map(N).join(', ')}\\right\\rangle`;
const matL = (m: number[][]) => `\\begin{pmatrix}${m.map((r) => r.map(N).join(' & ')).join(' \\\\ ')}\\end{pmatrix}`;

/** Keys an object is known by in the scene (its name and its role). */
export function objectKeys(ws: Workspace, id: string): string[] {
  const role = ws.value(id)?.role;
  return role ? [id, `role:${role}`] : [id];
}

function LocalCard({ a }: { a: LocalAnalysis }) {
  const emph = useEmphasis();
  const f = a.fnLabel;
  const P = symbolLatex(a.pointName);
  const rows: [string, string, string[]][] = [
    [`${P}`, `\\left(${a.p.map(N).join(', ')}\\right)`, ['role:point']],
    [`${f}(${P})`, N(a.f0), ['role:point', 'role:level']],
    [`\\nabla ${f}(${P})`, vecL(a.g), ['role:gradient']],
    [`\\lVert\\nabla ${f}\\rVert`, N(a.gNorm), ['role:gradient']],
    ...a.directions.map((d): [string, string, string[]] => [`D_{\\hat ${symbolLatex(d.name)}}${f}`, N(d.D), ['role:slice-dir', 'role:direction']]),
    [`H_{${f}}(${P})`, matL(a.H), ['role:hessian']],
    ['\\lambda_1,\\ \\lambda_2', a.eig.map((e) => N(e.value)).join(',\\ '), ['role:hessian']],
    ['\\det H', N(a.detH), ['role:hessian']],
  ];
  return (
    <div className="local-card">
      <table className="kv">
        <tbody>
          {rows.map(([k, v, keys]) => (
            <tr key={k} className={emph.active(keys) ? 'lit' : ''} onMouseEnter={() => emph.enter(keys)} onMouseLeave={emph.leave}>
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

export function ValuesView() {
  const ws = useWs();
  const emph = useEmphasis();
  useTopics('values', 'selection', 'view', 'doc');
  const a = localAnalysis(ws);
  const named = ws.statements().filter((s) => s.name && ws.value(s.id));
  return (
    <div className="values">
      {a && <LocalCard a={a} />}
      <div className="section-title">All values</div>
      <table className="kv named">
        <tbody>
          {named.map((s) => {
            const v = ws.value(s.id) as MathValue;
            if (v.kind === 'show' || v.kind === 'animation') return null;
            const keys = objectKeys(ws, s.id);
            const lit = emph.active(keys) || s.deps.some((d) => emph.active([d]));
            return (
              <tr
                key={s.id}
                className={`${ws.selection === s.id ? 'selected' : ''} ${lit ? 'lit' : ''}`}
                onClick={() => ws.select(s.id)}
                onMouseEnter={() => emph.enter(keys)}
                onMouseLeave={emph.leave}
              >
                <td><Tex tex={symbolLatex(s.name!)} /></td>
                <td className="val"><Tex tex={valueLatex(v)} /></td>
                <td className="dim">{typeLabel(v)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}