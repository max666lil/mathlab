/** View panels: thin React shells that mount the framework-free renderers. */
import { useEffect, useRef, useState } from 'react';
import { useWs, useTopics } from '../hooks';
import { SceneView } from '../../visualization/3d/scene-view';
import { SHOTS } from '../../visualization/3d/camera';
import { PlaneView } from '../../visualization/2d/plane-view';
import { SliceView, sliceTitle } from '../../visualization/2d/slice-view';
import type { SliceValue } from '../../math-core/values';

/** Dev-only handle for debugging renderers from the console. */
function devViews(): Record<string, unknown> {
  const w = window as unknown as { __views?: Record<string, unknown> };
  return (w.__views ??= {});
}

export function Scene3DPanel() {
  const ws = useWs();
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<SceneView | null>(null);
  const [, rerender] = useState(0);
  useTopics('doc');
  const flat = view?.flattened ?? false;
  useEffect(() => {
    const v = new SceneView(host.current!, ws);
    setView(v);
    if (import.meta.env.DEV) devViews().scene = v;
    return () => v.destroy();
  }, [ws]);
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">3D scene</span>
        <div className="seg">
          {SHOTS.map((s) => (
            <button key={s.name} title={s.hint} onClick={() => view?.shot(s.name)}>
              {s.label}
            </button>
          ))}
        </div>
        <button
          className={`toggle ${flat ? 'active' : ''}`}
          title="Press the surface flat onto the floor: it becomes its own contour map"
          onClick={() => {
            view?.setFlatten(!flat);
            if (!flat) view?.shot('top');
            rerender((n) => n + 1);
          }}
        >
          Flatten
        </button>
      </div>
      <div className="panel-body" ref={host} />
      <div className="panel-hint">drag P on the surface · orbit with the mouse · double-click to reset</div>
    </div>
  );
}

export function Graph2DPanel() {
  const ws = useWs();
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<PlaneView | null>(null);
  useEffect(() => {
    const v = new PlaneView(host.current!, ws);
    setView(v);
    if (import.meta.env.DEV) devViews().plane = v;
    return () => v.destroy();
  }, [ws]);
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Domain · contour map</span>
        <button onClick={() => view?.resetView()} title="Fit to the domain">Fit</button>
      </div>
      <div className="panel-body" ref={host} />
      <div className="panel-hint">drag points and vector tips · scroll to zoom · shift snaps</div>
    </div>
  );
}

function SliceHost({ itemId }: { itemId: string }) {
  const ws = useWs();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<SliceView | null>(null);
  useEffect(() => {
    view.current = new SliceView(host.current!, ws, itemId);
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);
  useEffect(() => view.current?.setItem(itemId), [itemId]);
  return <div className="slice-host" ref={host} />;
}

export function SlicePanel() {
  const ws = useWs();
  useTopics('values', 'view');
  const slices = ws.sceneItems().filter((i) => i.visible && i.visual.vtype === 'slice');
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Cross-sections</span>
        <span className="panel-sub">{slices.map((s) => sliceTitle(s.visual.props.slice as SliceValue)).join('   ')}</span>
      </div>
      <div className="panel-body slices">
        {slices.length === 0 && (
          <div className="empty">
            Add <code>show slice(f, x = P.x)</code> or <code>show slice(f, P, u)</code> to see cross-sections.
          </div>
        )}
        {slices.map((s) => (
          <SliceHost key={s.id} itemId={s.id} />
        ))}
      </div>
    </div>
  );
}