/** Inspector: the selected object's type, definition, symbolic form, dependencies and actions. */
import { useWs, useTopics } from '../hooks';
import { Tex } from '../Tex';
import { symbolicSummary } from '../../plugins/core-calculus/analysis';
import { valueLatex, typeLabel, FunctionValue, MathValue } from '../../math-core/values';
import { symbolLatex } from '../../math-core/symbolic/print';
import type { Workspace } from '../../runtime/workspace';

function source(ws: Workspace, id: string): string {
  const info = ws.statement(id);
  const cell = info && ws.doc.cell(info.cellId);
  return cell && info ? cell.source.slice(info.stmt.span.from, info.stmt.span.to) : '';
}

/** Contextual "add to notebook" actions: direct manipulation generates code. */
function actions(ws: Workspace, id: string, v: MathValue): { label: string; code: string }[] {
  const out: { label: string; code: string }[] = [];
  const firstField = ws.statements().find((s) => {
    const fv = ws.value(s.id) as FunctionValue | undefined;
    return fv?.kind === 'function' && fv.out === 'scalar' && fv.params.length === 2;
  })?.name;
  if (v.kind === 'function' && (v as FunctionValue).out === 'scalar' && (v as FunctionValue).params.length === 2) {
    out.push({ label: 'Surface + contours', code: `show surface(${id}), contours(${id})` });
    out.push({ label: 'Gradient field', code: `show grad(${id})` });
  }
  if (v.kind === 'point' && firstField) {
    const f = firstField;
    out.push({ label: `∇${f} at ${id}`, code: `show grad(${f}) at ${id}` });
    out.push({ label: 'Tangent plane', code: `show tangent_plane(${f}, ${id})` });
    out.push({ label: 'Level curve', code: `show level(${f}, ${id})` });
    out.push({ label: 'Slices', code: `show slice(${f}, x = ${id}.x), slice(${f}, y = ${id}.y)` });
    out.push({ label: 'Quadratic approx.', code: `show quadratic(${f}, ${id})` });
    out.push({ label: 'Steepest path', code: `show gradient_path(${f}, ${id})` });
  }
  return out;
}

export function InspectorView() {
  const ws = useWs();
  useTopics('selection', 'values', 'view', 'doc');
  const id = ws.selection;
  const node = id ? ws.node(id) : undefined;
  const info = id ? ws.statement(id) : undefined;
  return (
    <div className="inspector">
        {!id || !info ? (
          <div className="empty">Select an object — click a point, a vector or a notebook result.</div>
        ) : (
          <>
            <div className="insp-head">
              <Tex tex={info.name ? symbolLatex(info.name) : '\\text{result}'} className="insp-name" />
              <span className="insp-type">{node?.value ? typeLabel(node.value) : 'error'}</span>
            </div>
            <pre className="insp-src">{source(ws, id)}</pre>
            {node?.error && <div className="out-row error">{node.error.message}</div>}
            {node?.value && node.value.kind !== 'show' && (
              <div className="insp-value">
                <Tex tex={valueLatex(node.value)} display />
              </div>
            )}
            {symbolicSummary(ws, id).map((l) => (
              <div key={l.label} className="insp-sym">
                <Tex tex={`${l.label} = ${l.latex}`} />
              </div>
            ))}
            <div className="insp-deps">
              <span className="dim">depends on</span>
              {ws.graph.deps(id).map((d) => (
                <button key={d} className="chip" onClick={() => ws.select(d)}>
                  <Tex tex={symbolLatex(d.includes('#') ? '·' : d)} />
                </button>
              ))}
              <span className="dim">used by</span>
              {ws.graph.dependentsOf(id).map((d) => (
                <button key={d} className="chip" onClick={() => ws.select(d)}>
                  {d.includes('#') ? 'show …' : <Tex tex={symbolLatex(d)} />}
                </button>
              ))}
            </div>
            {node?.value && info.name && ws.isVisualizable(id) && node.value.kind !== 'point' && (
              <label className="insp-toggle">
                <input type="checkbox" checked={ws.isShown(id)} onChange={(e) => ws.setVisible(`${id}#auto`, e.target.checked)} /> show in views
              </label>
            )}
            {node?.value && info.name && (
              <div className="insp-actions">
                {actions(ws, info.name, node.value).map((a) => (
                  <button key={a.label} onClick={() => ws.addCell(ws.doc.cells[ws.doc.cells.length - 1]?.id, a.code)}>
                    ＋ {a.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
    </div>
  );
}