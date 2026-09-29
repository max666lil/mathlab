/** Live output of a cell: values as LaTeX, slider widgets, play buttons, visibility chips. */
import { useWs, useTopics } from '../hooks';
import { Tex } from '../Tex';
import type { StatementInfo } from '../../runtime/document';
import type { Workspace } from '../../runtime/workspace';
import { MathValue, ScalarValue, FunctionValue, valueLatex, VisualValue } from '../../math-core/values';
import { symbolLatex, formatNumber } from '../../math-core/symbolic/print';
import { DependencyError } from '../../runtime/graph';
import { plainLabel } from '../../plugins/core-calculus/draw-util';
import { sliceTitle } from '../../visualization/2d/slice-view';

function outputLatex(info: StatementInfo, v: MathValue): string {
  const name = info.name ? symbolLatex(info.name) : undefined;
  if (v.kind === 'function') {
    const f = v as FunctionValue;
    const body = valueLatex(f);
    return name && f.label !== name ? `${name} = ${body}` : body;
  }
  const val = valueLatex(v);
  const parts = [name, v.derivation, val].filter(Boolean) as string[];
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
  const items = ws.sceneItems().filter((it) => it.id.startsWith(`${info.id}#`) || (info.stmt.kind === 'show' && info.stmt.items.some((e) => e.type === 'sym' && it.nodeId === e.name)));
  return (
    <div className="chips">
      {items.map((it) => (
        <button
          key={it.id}
          className={`chip ${it.visible ? '' : 'off'}`}
          title={it.visible ? 'Hide' : 'Show'}
          onClick={(e) => {
            e.stopPropagation();
            ws.setVisible(it.id, !it.visible);
          }}
        >
          <span className="swatch" style={{ background: it.color }} />
          {visualName(it.visual)}
        </button>
      ))}
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

function Row({ ws, info }: { ws: Workspace; info: StatementInfo }) {
  const node = ws.node(info.id);
  const selected = ws.selection === info.id;
  const select = () => ws.select(selected ? null : info.id);
  if (node?.error) {
    const dep = node.error instanceof DependencyError;
    const msg = node.error.message;
    return (
      <div className={`out-row ${dep ? 'warn' : 'error'}`} onClick={select}>
        <span className="out-icon">{dep ? '⚠' : '✕'}</span>
        <span>{msg}</span>
      </div>
    );
  }
  const v = node?.value;
  if (!v) return null;
  if (v.kind === 'show') {
    return (
      <div className="out-row" onClick={select}>
        <ShowChips ws={ws} info={info} />
      </div>
    );
  }
  if (v.kind === 'animation') {
    const playing = ws.isPlaying(info.id);
    return (
      <div className="out-row" onClick={(e) => e.stopPropagation()}>
        <button className={`icon-btn ${playing ? 'active' : ''}`} onClick={() => ws.toggleAnimation(info.id)}>
          {playing ? '❚❚' : '▶'}
        </button>
        <Tex tex={valueLatex(v)} />
      </div>
    );
  }
  const slider = v.kind === 'scalar' && (v as ScalarValue).slider && info.input;
  return (
    <div className={`out-row ${selected ? 'selected' : ''}`} onClick={select}>
      {slider ? <SliderRow ws={ws} info={info} v={v as ScalarValue} /> : <Tex tex={outputLatex(info, v)} className="out-tex" />}
      {info.input?.kind === 'point' && <span className="hint">drag in any view</span>}
    </div>
  );
}

export function CellOutput({ cellId }: { cellId: string }) {
  const ws = useWs();
  useTopics('values', 'doc', 'view', 'selection', 'animation');
  const infos = ws.statements().filter((s) => s.cellId === cellId);
  if (!infos.length) return null;
  return (
    <div className="cell-output">
      {infos.map((info) => (
        <Row key={info.id} ws={ws} info={info} />
      ))}
    </div>
  );
}