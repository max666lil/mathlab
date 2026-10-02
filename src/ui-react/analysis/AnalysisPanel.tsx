/**
 * Analysis panel: one presentation of the analysis of the focused object. A compact summary is always
 * visible; everything else sits in collapsed sections that compute (and draw) only when opened.
 * Every row is a fact — an MLL expression — so it can be pinned into the worksheet as an object.
 */
import { useWs, useAnalysis, useEmphasis } from '../hooks';
import { Tex } from '../Tex';
import type { AnalysisPlan, FactSpec, SectionSpec } from '../../runtime/analysis';
import type { AnalysisService } from '../../runtime/analysis';
import type { Workspace } from '../../runtime/workspace';
import { valueLatex, MathValue } from '../../math-core/values';
import { freshName } from '../../plugins/core-calculus/analyzers';

/** Provenance badge — only for results that are not exact (exact is the unmarked default). */
export function CertaintyBadge({ v }: { v?: MathValue }) {
  const c = v?.certainty;
  if (!c || c === 'exact') return null;
  return (
    <span className={`badge badge-${c}`} title={v?.evidence ?? c}>
      {c === 'numeric' ? 'numeric' : 'evidence'}
    </span>
  );
}

function factLatex(v: MathValue): string {
  // a visual object's row just says where it is; its name is the row title
  if (v.kind === 'visual') return '\\small\\textsf{on canvas}';
  if (v.kind === 'function' && (v as { expr?: unknown }).expr) {
    // in a labelled row the body is enough: "Gradient  ⟨2x, 4y⟩"
    const text = valueLatex(v);
    const eq = text.indexOf(' = ');
    return eq > 0 ? text.slice(eq + 3) : text;
  }
  return valueLatex(v);
}

/** Result kinds that have an analysis of their own (the ↗ tool opens it). */
const ANALYZE_AS: Record<string, string> = { matrix: 'a matrix', subspace: 'a subspace', affine: 'a solution set' };

function appendRows(ws: Workspace, rows: string[]) {
  let after = ws.cells.filter((c) => c.source.trim()).slice(-1)[0]?.id;
  for (const r of rows) after = ws.addCell(after, r);
}

/** Multi-line results (a smoothness report) get the full width under their title. */
const WIDE_KINDS = new Set(['smoothness', 'linearform']);

function FactRow({ plan, spec, an }: { plan: AnalysisPlan; spec: FactSpec; an: AnalysisService }) {
  const ws = useWs();
  const emph = useEmphasis();
  const st = an.fact(plan, spec);
  const keys = [`fact:${spec.id}`];
  const pinName = () => freshName(ws, spec.pinName ?? (spec.id.replace(/[^A-Za-z]/g, '') || 'R'));
  const pin = () => appendRows(ws, [`${pinName()} = ${spec.expr}`]);
  // a matrix-valued fact (e.g. the Hessian at P) becomes an object of its own: pin it and analyse it as a matrix
  const analyzeAs = st.value && ANALYZE_AS[st.value.kind] && spec.expr !== plan.object ? ANALYZE_AS[st.value.kind] : undefined;
  const openAs = () => {
    const name = pinName();
    appendRows(ws, [`${name} = ${spec.expr}`]);
    ws.flush();
    ws.setFocus(name);
  };
  return (
    <div className={`fact ${emph.active(keys) ? 'lit' : ''} ${st.value && WIDE_KINDS.has(st.value.kind) ? 'wide' : ''}`} onMouseEnter={() => emph.enter(keys)} onMouseLeave={emph.leave}>
      <span className="fact-title">{spec.title}</span>
      <span className="fact-value">
        {st.status === 'pending' && <span className="dim">…</span>}
        {st.status === 'error' && <span className="dim small">{st.error}</span>}
        {st.status === 'ready' && st.value && <Tex tex={factLatex(st.value)} />}
      </span>
      <span className="fact-tools">
        <CertaintyBadge v={st.value} />
        {spec.visual === 'toggle' && (
          <button className={`mini ${an.isToggled(plan, spec.id) ? 'on' : ''}`} title="Show in the canvas" onClick={() => an.toggle(plan, spec.id)}>
            ◐
          </button>
        )}
        {analyzeAs && (
          <button className="mini hover-only" title={`Analyze as ${analyzeAs}: pin it and open its analysis`} onClick={openAs}>
            ↗
          </button>
        )}
        <button className="mini hover-only" title={`Pin as a worksheet object: ${spec.expr}`} onClick={pin}>
          ⤓
        </button>
      </span>
    </div>
  );
}

function Section({ plan, section, an }: { plan: AnalysisPlan; section: SectionSpec; an: AnalysisService }) {
  const ws = useWs();
  const emph = useEmphasis();
  const facts = plan.facts.filter((f) => f.section === section.id && !f.hidden);
  const keys = facts.map((f) => `fact:${f.id}`);
  if (section.summary)
    return (
      <div className="summary">
        {facts.map((f) => (
          <FactRow key={f.id} plan={plan} spec={f} an={an} />
        ))}
        {section.why && (
          <button className="why-toggle why-link" onClick={() => an.setDrawer({ kind: 'why', topic: section.why! })}>
            Why? — explain
          </button>
        )}
      </div>
    );
  const open = an.sectionOpen(plan, section.id);
  return (
    <section className={`card ${open ? 'open' : ''}`}>
      <button className="card-head" onClick={() => an.setSectionOpen(plan, section.id, !open)} onMouseEnter={() => open && emph.enter(keys)} onMouseLeave={emph.leave}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        <span className="card-title">{section.title}</span>
      </button>
      {open && (
        <div className="card-body">
          {facts.map((f) => (
            <FactRow key={f.id} plan={plan} spec={f} an={an} />
          ))}
          {section.actions?.map((a) => (
            <button key={a.label} className="action" onClick={() => appendRows(ws, a.rows)}>
              {a.label}
            </button>
          ))}
          {section.why && (
            <button className="why-toggle" onClick={() => an.setDrawer({ kind: 'why', topic: section.why! })}>
              Why? — explain
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function AnalysisPanel() {
  const an = useAnalysis();
  const plan = an.plan();
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Analysis</span>
        {plan && <span className="type-chip">{plan.typeLabel}</span>}
      </div>
      <div className="panel-body scroll analysis">
        {!plan ? (
          <div className="empty">
            Define an object in the worksheet — for example <code>f(x) = x^3 - 3x</code> or <code>f(x,y) = x^2 - y^2</code> — and its analysis appears here.
          </div>
        ) : (
          <>
            <div className="analysis-title">
              <Tex tex={plan.title} />
            </div>
            {plan.sections.map((s) => (
              <Section key={s.id} plan={plan} section={s} an={an} />
            ))}
            <div className="analysis-foot dim">
              Unmarked results are exact. <span className="badge badge-numeric">numeric</span> iterative approximation ·{' '}
              <span className="badge badge-heuristic">evidence</span> sampled, not a proof · ⤓ pins a result into the worksheet.
            </div>
          </>
        )}
      </div>
    </div>
  );
}