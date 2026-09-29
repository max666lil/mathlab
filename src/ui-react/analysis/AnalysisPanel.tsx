/**
 * Analysis panel: one presentation of the analysis of the focused object. Every row is a fact —
 * an MLL expression evaluated with the ordinary builtins — so it can be pinned into the worksheet
 * as a named object. Cards compute their (tier-1) facts only when opened.
 */
import { useState } from 'react';
import { useWs, useAnalysis, useEmphasis } from '../hooks';
import { Tex } from '../Tex';
import type { AnalysisPlan, FactSpec, SectionSpec } from '../../runtime/analysis';
import type { AnalysisService } from '../../runtime/analysis';
import type { Workspace } from '../../runtime/workspace';
import { valueLatex, MathValue, VisualValue } from '../../math-core/values';
import { freshName } from '../../plugins/core-calculus/analyzers';
import { Explanation } from '../explain/Explanations';

export function CertaintyBadge({ v }: { v?: MathValue }) {
  if (!v?.certainty) return null;
  const c = v.certainty;
  const label = c === 'exact' ? 'exact' : c === 'numeric' ? 'numeric' : 'evidence';
  return (
    <span className={`badge badge-${c}`} title={v.evidence ?? c}>
      {label}
    </span>
  );
}

function factLatex(v: MathValue): string {
  if (v.kind === 'visual') {
    const vv = v as VisualValue;
    return `\\text{${(vv.label ?? vv.vtype).replace(/[\\{}]/g, '')}}`;
  }
  return valueLatex(v);
}

function appendRows(ws: Workspace, rows: string[]) {
  let after = ws.cells.filter((c) => c.source.trim()).slice(-1)[0]?.id;
  for (const r of rows) after = ws.addCell(after, r);
}

function FactRow({ plan, spec, an }: { plan: AnalysisPlan; spec: FactSpec; an: AnalysisService }) {
  const ws = useWs();
  const emph = useEmphasis();
  const st = an.fact(plan, spec);
  const keys = [`fact:${spec.id}`];
  const pin = () => appendRows(ws, [`${freshName(ws, spec.pinName ?? spec.id.replace(/[^A-Za-z]/g, '') ?? 'R')} = ${spec.expr}`]);
  return (
    <div className={`fact ${emph.active(keys) ? 'lit' : ''}`} onMouseEnter={() => emph.enter(keys)} onMouseLeave={emph.leave}>
      <div className="fact-head">
        <span className="fact-title">{spec.title}</span>
        <span className="fact-tools">
          <CertaintyBadge v={st.value} />
          {spec.visual === 'toggle' && (
            <button className={`mini ${an.isToggled(plan, spec.id) ? 'on' : ''}`} title="Show in the canvas" onClick={() => an.toggle(plan, spec.id)}>
              ◐
            </button>
          )}
          <button className="mini" title={`Pin as a worksheet object: ${spec.expr}`} onClick={pin}>
            ⤓
          </button>
        </span>
      </div>
      <div className="fact-value">
        {st.status === 'pending' && <span className="dim">computing…</span>}
        {st.status === 'error' && <span className="dim">{st.error}</span>}
        {st.status === 'ready' && st.value && <Tex tex={factLatex(st.value)} />}
      </div>
    </div>
  );
}

function Card({ plan, section, an }: { plan: AnalysisPlan; section: SectionSpec; an: AnalysisService }) {
  const ws = useWs();
  const emph = useEmphasis();
  const [why, setWhy] = useState(false);
  const open = an.sectionOpen(plan, section.id);
  const facts = plan.facts.filter((f) => f.section === section.id && !f.hidden);
  const keys = facts.map((f) => `fact:${f.id}`);
  return (
    <section className={`card ${open ? 'open' : ''}`}>
      <button className="card-head" onClick={() => an.setSectionOpen(plan, section.id, !open)} onMouseEnter={() => open && emph.enter(keys)} onMouseLeave={emph.leave}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        <span className="card-title">{section.title}</span>
        {!open && facts.length > 0 && <span className="card-count">{facts.length}</span>}
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
            <>
              <button className="why-toggle" onClick={() => setWhy(!why)}>
                {why ? 'Hide explanation' : 'Why? — explain the geometry'}
              </button>
              {why && (
                <div className="why">
                  <Explanation topic={section.why} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function AnalysisPanel() {
  const an = useAnalysis();
  const emph = useEmphasis();
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
              <Card key={s.id} plan={plan} section={s} an={an} />
            ))}
            {plan.relations.length > 0 && (
              <div className="relations">
                {plan.relations.map((r) => (
                  <span key={r.text} className={`relation ${emph.active(r.between) ? 'lit' : ''}`} onMouseEnter={() => emph.enter(r.between)} onMouseLeave={emph.leave}>
                    {r.text}
                  </span>
                ))}
              </div>
            )}
            <div className="analysis-foot dim">
              Results are objects: ⤓ pins one into the worksheet. <span className="badge badge-exact">exact</span> symbolic ·{' '}
              <span className="badge badge-numeric">numeric</span> iterative method with a residual check · <span className="badge badge-heuristic">evidence</span> sampled / scanned, not a proof.
            </div>
          </>
        )}
      </div>
    </div>
  );
}