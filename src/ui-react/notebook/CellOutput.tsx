/** Live output of a cell: values as LaTeX, slider widgets, play buttons, visibility chips. */
import { useWs, useTopics, useEmphasis } from '../hooks';
import { Tex } from '../Tex';
import type { StatementInfo } from '../../runtime/document';
import type { Workspace } from '../../runtime/workspace';
import { MathValue, ScalarValue, FunctionValue, valueLatex, VisualValue } from '../../math-core/values';
import type { Expr } from '../../math-core/ast';
import { symbolLatex, formatNumber, toLatex } from '../../math-core/symbolic/print';
import { DependencyError } from '../../runtime/graph';
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

function outputLatex(info: StatementInfo, v: MathValue, math: boolean): string {
  const name = info.name ? symbolLatex(info.name) : undefined;
  if (v.kind === 'function') {
    const f = v as FunctionValue;
    const body = valueLatex(f);
    return name && f.label !== name ? `${name} = ${body}` : body;
  }
  const st = info.stmt;
  const expr = st.kind === 'assign' || st.kind === 'expr' ? st.value : undefined;
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
    return (
      <div className={`out-row ${dep ? 'warn' : 'error'}`}>
        <span className="out-icon">{dep ? '⚠' : '✕'}</span>
        <span>{node.error.message}</span>
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