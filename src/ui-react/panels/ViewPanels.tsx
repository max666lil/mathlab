/** View panels: thin React shells that mount the framework-free renderers. */
import { useEffect, useRef, useState } from 'react';
import { useWs, usePres, useTopics, useEmphasis } from '../hooks';
import { SceneView } from '../../visualization/3d/scene-view';
import { SHOTS } from '../../visualization/3d/camera';
import { PlaneView } from '../../visualization/2d/plane-view';
import { SliceView, sliceTitle } from '../../visualization/2d/slice-view';
import type { SliceValue } from '../../math-core/values';
import type { SceneItem } from '../../visualization/scene-model';

/** Dev-only handle for debugging renderers from the console. */
function devViews(): Record<string, unknown> {
  const w = window as unknown as { __views?: Record<string, unknown> };
  return (w.__views ??= {});
}

export function Scene3DPanel() {
  const ws = useWs();
  const pres = usePres();
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<SceneView | null>(null);
  const [, rerender] = useState(0);
  useTopics('doc');
  const flat = view?.flattened ?? false;
  useEffect(() => {
    const v = new SceneView(host.current!, ws, pres);
    setView(v);
    if (import.meta.env.DEV) devViews().scene = v;
    return () => v.destroy();
  }, [ws, pres]);
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Surface · 3D</span>
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
            view?.shot(flat ? 'orbit' : 'top');
            rerender((n) => n + 1);
          }}
        >
          {flat ? 'Unflatten' : 'Flatten'}
        </button>
      </div>
      <div className="panel-body" ref={host} />
      <div className="panel-hint">drag P on the surface · orbit with the mouse</div>
    </div>
  );
}

export function Graph2DPanel() {
  const ws = useWs();
  const pres = usePres();
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<PlaneView | null>(null);
  useEffect(() => {
    const v = new PlaneView(host.current!, ws, pres);
    setView(v);
    if (import.meta.env.DEV) devViews().plane = v;
    return () => v.destroy();
  }, [ws, pres]);
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Domain · contour map</span>
        <button onClick={() => view?.resetView()} title="Fit to the domain">
          Fit
        </button>
      </div>
      <div className="panel-body" ref={host} />
      <div className="panel-hint">drag P and the tip of u · scroll to zoom</div>
    </div>
  );
}

const SLICE_NAMES: Record<string, string> = { 'slice-x': 'x-slice', 'slice-y': 'y-slice', 'slice-dir': 'u-slice' };

/** One large cross-section, switchable between the x-, y- and u-slices. */
export function CrossSectionPanel() {
  const ws = useWs();
  const pres = usePres();
  const emph = useEmphasis();
  useTopics('values', 'view', 'doc');
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<SliceView | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const slices = ws.sceneItems().filter((i) => i.visual.vtype === 'slice');
  useEffect(() => pres.onModeChange(() => setChoice(null)), [pres]);
  // explicit choice > slice of the emphasised object > the mode's preferred slice > first
  const auto =
    slices.find((s) => s.visual.role !== 'slice-x' && s.visual.role !== 'slice-y' && emph.active(s.keys.filter((k) => k !== 'P' && k !== 'f'))) ??
    slices.find((s) => s.visual.role === pres.mode.slice) ??
    slices[0];
  const current: SceneItem | undefined = slices.find((s) => s.id === choice) ?? auto;
  useEffect(() => {
    if (!host.current || !current) return;
    if (!view.current) view.current = new SliceView(host.current, ws, current.id);
    else view.current.setItem(current.id);
  }, [ws, current?.id]);
  useEffect(() => () => view.current?.destroy(), []);
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Cross-section</span>
        <div className="seg">
          {slices.map((s) => (
            <button
              key={s.id}
              className={current?.id === s.id ? 'active' : ''}
              title={sliceTitle(s.visual.props.slice as SliceValue)}
              onClick={() => setChoice(s.id)}
              onMouseEnter={() => emph.enter([`role:${s.visual.role}`])}
              onMouseLeave={emph.leave}
            >
              <span className="swatch" style={{ background: s.color }} /> {SLICE_NAMES[s.visual.role ?? ''] ?? 'slice'}
            </button>
          ))}
        </div>
      </div>
      <div
        className="panel-body"
        ref={host}
        onMouseEnter={() => current && emph.enter([`role:${current.visual.role}`])}
        onMouseLeave={emph.leave}
      >
        {slices.length === 0 && (
          <div className="empty">
            Add <code>show slice(f, x = P.x)</code> or <code>show slice(f, P, u)</code> to see cross-sections.
          </div>
        )}
      </div>
    </div>
  );
}