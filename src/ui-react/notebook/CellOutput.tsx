/** Live output of a cell: values as LaTeX, slider widgets, play buttons, visibility chips. */
import { useWs, useTopics, useEmphasis } from '../hooks';
import { Tex } from '../Tex';
import type { StatementInfo } from '../../runtime/document';
import type { Workspace } from '../../runtime/workspace';
import { MathValue, ScalarValue, FunctionValue, valueLatex, VisualValue } from '../../math-core/values';
import type { Expr } from '../../math-core/ast';
import { symbolLatex, formatNumber, toLatex } from '../../math-core/symbolic/print';
import { DependencyError } from '../../runtime/graph';
import { getBuiltin } from '../../math-core/builtins';
import { getScalarFunction, CONSTANTS } from '../../math-core/scalar-functions';
import { plainLabel } from '../../plugins/core-calculus/draw-util';
import { sliceTitle } from '../../visualization/2d/slice-view';
import { objectKeys } from '../object-keys';
import { CertaintyBadge } from '../analysis/AnalysisPanel';

/** Is the expression just literal data (no point in printing it next to its value)? */
function literal(e: Expr): boolean {
  switch (e.type) {
    case 'num':
      return true;
    case 'neg':
      return literal(e.arg);
    case 'tuple':
    case 'vec':
    case 'list':
      return e.items.every(literal);
    case 'matrix':
      return e.rows.every((r) => r.every(literal));
    case 'call':
      return e.callee.type === 'sym' && (e.callee.name === 'point' || e.callee.name === 'vector') && e.args.every(literal);
    default:
      return false;
  }
}

/** Undefined names of a row, multi-letter ones split into letters (ax → a): candidates for sliders. */
function missingLetters(ws: Workspace, info: StatementInfo): string[] {
  const cell = ws.doc.cells.find((c) => c.id === info.cellId);
  const src = cell ? cell.source.slice(info.stmt.span.from, info.stmt.span.to) : '';
  const known = (n: string) => !!ws.value(n) || !!getBuiltin(n) || !!getScalarFunction(n) || n in CONSTANTS;
  const out: string[] = [];
  for (const word of src.match(/[\p{L}_][\p{L}\p{N}_]*/gu) ?? []) {
    if (known(word)) continue;
    const parts = [...word].every((ch) => /\p{L}/u.test(ch)) && [...word].length > 1 ? [...word] : [word];
    for (const p of parts) if (!known(p) && !['x', 'y', 'z', 't'].includes(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

function outputLatex(info: StatementInfo, v: MathValue, math: boolean): string {
  const name = info.name ? symbolLatex(info.name) : undefined;
  const st = info.stmt;
  if (v.kind === 'function') {
    const f = v as FunctionValue;
    // a value that carries its own display (∇f in the polar basis) is shown as such
    if (f.display) return f.display;
    const plusC = f.role === 'antiderivative' ? ' + C' : '';
    // a command such as integrate x^2 reads  ∫ x² dx = x³/3 + C
    if (!name && st.kind === 'expr' && st.value.type === 'call' && f.expr) return `${toLatex(st.value)} = ${toLatex(f.expr)}${plusC}`;
    const body = valueLatex(f) + plusC;
    return name && f.label !== name ? `${name} = ${body}` : body;
  }
  const expr = st.kind === 'assign' || st.kind === 'expr' ? st.value : undefined;
  // an equation / inequality is its own display: x² + y² = 9, R: x² + y² ≤ 1
  // X ~ N(64, 0.78)
  if (v.kind === 'distribution') return name ? `${name} \\sim ${valueLatex(v)}` : valueLatex(v);
  // P(B | A) = 0.95: the fact is its own display (its node name is internal)
  if (v.kind === 'probfact') return valueLatex(v);
  // worked steps are their own display (the command is already in the editor row)
  if (v.kind === 'report' || v.kind === 'linearform' || v.kind === 'steepest') return valueLatex(v);
  if (v.kind === 'relation' || v.kind === 'region' || v.kind === 'implicitsurface') return name ? `${name}:\\ ${valueLatex(v)}` : valueLatex(v);
  // math mode: show the definition itself (∇f(P)), code mode: how it was obtained numerically
  const middle = math && expr && !literal(expr) ? toLatex(expr) : v.derivation;
  const parts = [name, middle, valueLatex(v)].filter(Boolean) as string[];
  return parts.join(' = ');
}

function visualName(v: VisualValue): string {
  if (v.vtype === 'slice') return sliceTitle(v.props.slice as never);
  const l = plainLabel(v.label);
  const names: Record<string, string> = { surface: 'surface', contours: 'contours', plane: 'tangent plane', level: 'level curve', path: 'steepest path', hessian_axes: 'principal directions', quadratic: 'quadratic approx.', arrow: 'vector', point: 'point', graph1d: 'graph', field2: 'vector field' };
  const kind = names[v.vtype] ?? v.vtype;
  if (v.vtype === 'arrow' || v.vtype === 'point') return l || kind;
  if (v.vtype === 'surface' || v.vtype === 'contours' || v.vtype === 'graph1d') return `${kind} ${l}`.trim();
  return kind;
}

function ShowChips({ ws, info }: { ws: Workspace; info: StatementInfo }) {
  const emph = useEmphasis();
  const items = ws.sceneItems().filter((it) => it.id.startsWith(`${info.id}#`) || (info.stmt.kind === 'show' && info.stmt.items.some((e) => e.type === 'sym' && it.nodeId === e.name)));
  return (
    <div className="chips">
      {items.map((it) => {
        const keys = [it.primary, ...(it.visual.role ? [`role:${it.visual.role}`] : [])];
        return (
          <button
            key={it.id}
            className={`chip ${it.visible ? '' : 'off'} ${emph.active(it.keys) ? 'lit' : ''}`}
            title={it.visible ? 'Hide in "All" mode' : 'Show'}
            onMouseEnter={() => emph.enter(keys)}
            onMouseLeave={emph.leave}
            onClick={(e) => {
              e.stopPropagation();
              ws.setVisible(it.id, !it.visible);
            }}
          >
            <span className="swatch" style={{ background: it.color }} />
            {visualName(it.visual)}
          </button>
        );
      })}
    </div>
  );
}

function SliderRow({ ws, info, v }: { ws: Workspace; info: StatementInfo; v: ScalarValue }) {
  const s = v.slider!;
  const step = s.step ?? (s.max - s.min) / 1000;
  const playing = ws.isPlaying(info.id);
  return (
    <div className="slider-row" onClick={(e) => e.stopPropagation()}>
      <button className={`icon-btn ${playing ? 'active' : ''}`} title={playing ? 'Pause' : 'Play'} onClick={() => ws.toggleAnimation(info.id)}>
        {playing ? '❚❚' : '▶'}
      </button>
      <Tex tex={symbolLatex(info.name!)} />
      <input
        type="range"
        min={s.min}
        max={s.max}
        step={step}
        value={v.value}
        onChange={(e) => ws.setSlider(info.id, Number(e.target.value))}
        onPointerUp={() => ws.flushRewrites()}
      />
      <span className="mono">{formatNumber(v.value, 4)}</span>
    </div>
  );
}

function Row({ ws, info, math }: { ws: Workspace; info: StatementInfo; math: boolean }) {
  const emph = useEmphasis();
  const node = ws.node(info.id);
  const selected = ws.selection === info.id;
  const keys = info.name ? objectKeys(ws, info.id) : [];
  const lit = keys.length > 0 && (emph.active(keys) || info.deps.some((d) => emph.active([d])));
  const hover = {
    onMouseEnter: () => keys.length && emph.enter(keys),
    onMouseLeave: emph.leave,
  };
  const select = (e: React.MouseEvent) => {
    if (math) return; // in math mode a click opens the editor
    e.stopPropagation();
    ws.select(selected ? null : info.id);
  };
  if (node?.error) {
    const dep = node.error instanceof DependencyError;
    // like Desmos: an unknown name in a formula can become a slider with one click (x² + y² = r²)
    const unknown = /^Unknown name '([^']+)'$/.exec(node.error.message)?.[1];
    // ax + by + cz = d: every undefined letter of the row becomes a slider at once
    const letters = unknown ? missingLetters(ws, info) : [];
    return (
      <div className={`out-row ${dep ? 'warn' : 'error'}`}>
        <span className="out-icon">{dep ? '⚠' : '✕'}</span>
        <span>{letters.length > 1 ? `${letters.join(', ')} are not defined yet` : node.error.message}</span>
        {unknown && letters.length > 0 && (
          <button
            className="slider-fix"
            title={`Insert ${letters.map((l) => `${l} = slider(…)`).join(', ')} above this row`}
            onClick={(e) => {
              e.stopPropagation();
              const one = letters.length === 1;
              for (const l of letters) ws.insertCellBefore(info.cellId, one ? `${l} = slider(0, 5, 1)` : `${l} = slider(-5, 5, 1)`);
            }}
          >
            ＋ slider{letters.length > 1 ? 's' : ''} {letters.join(', ')}
          </button>
        )}
      </div>
    );
  }
  const v = node?.value;
  if (!v) return null;
  if (v.kind === 'show') {
    return (
      <div className="out-row plain">
        <ShowChips ws={ws} info={info} />
      </div>
    );
  }
  if (v.kind === 'animation') {
    const playing = ws.isPlaying(info.id);
    return (
      <div className="out-row plain" onClick={(e) => e.stopPropagation()}>
        <button className={`icon-btn ${playing ? 'active' : ''}`} onClick={() => ws.toggleAnimation(info.id)}>
          {playing ? '❚❚' : '▶'}
        </button>
        <Tex tex={valueLatex(v)} />
      </div>
    );
  }
  // a script: what it printed, and the variables / figures it produced
  if (v.kind === 'script') {
    const s = v as unknown as { output: string[]; vars: Record<string, MathValue>; images?: string[]; pending?: boolean };
    const out = s.output.length > 40 ? [...s.output.slice(0, 18), `… ${s.output.length - 36} more lines …`, ...s.output.slice(-18)] : s.output;
    return (
      <div className={`out-row script ${selected ? 'selected' : ''}`} onClick={select} {...hover}>
        <div className="script-summary">
          <Tex tex={valueLatex(v)} />
          {Object.keys(s.vars).length > 0 && <span className="dim small"> → {Object.keys(s.vars).join(', ')}</span>}
        </div>
        {out.length > 0 && <pre className={`script-out ${s.pending ? 'pending' : ''}`}>{out.join('\n')}</pre>}
        {(s.images ?? []).map((src, i) => (
          <img key={i} className="r-plot" src={src} alt={`R plot ${i + 1}`} />
        ))}
      </div>
    );
  }
  if (v.kind === 'text') {
    return (
      <div className="out-row plain">
        <pre className="script-out">{info.name ? `${info.name} = ` : ''}{(v as unknown as { text: string }).text}</pre>
      </div>
    );
  }
  const slider = v.kind === 'scalar' && (v as ScalarValue).slider && info.input;
  return (
    <div className={`out-row ${selected ? 'selected' : ''} ${lit ? 'lit' : ''}`} onClick={select} {...hover}>
      {slider ? <SliderRow ws={ws} info={info} v={v as ScalarValue} /> : <Tex tex={outputLatex(info, v, math)} className="out-tex" />}
      {!slider && <CertaintyBadge v={v} />}
      {info.input?.kind === 'point' && <span className="hint">drag in any view</span>}
    </div>
  );
}

function Comments({ source }: { source: string }) {
  const lines = source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('#') || l.startsWith('//'))
    .map((l) => l.replace(/^(#|\/\/)\s?/, ''));
  if (!lines.length) return null;
  return <div className="cell-prose">{lines.join(' ')}</div>;
}

export function CellOutput({ cellId, math = false, showComments = false }: { cellId: string; math?: boolean; showComments?: boolean }) {
  const ws = useWs();
  useTopics('values', 'doc', 'view', 'selection', 'animation');
  const infos = ws.statements().filter((s) => s.cellId === cellId);
  const cell = ws.doc.cell(cellId);
  if (!infos.length && !showComments) return null;
  return (
    <div className="cell-output">
      {showComments && cell && <Comments source={cell.source} />}
      {infos.map((info) => (
        <Row key={info.id} ws={ws} info={info} math={math} />
      ))}
    </div>
  );
}