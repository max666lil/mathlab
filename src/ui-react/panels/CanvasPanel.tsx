/**
 * The canvas: shows the views the analyzer of the focused object asks for (its WorkspaceLayout) —
 * one primary view, switchable; secondary material (cross-sections, explanations) lives in a
 * contextual drawer that appears only when requested. Renderers are framework-free.
 */
import { useEffect, useRef, useState } from 'react';
import { useWs, usePres, useTopics, useAnalysis } from '../hooks';
import { DEFAULT_LAYOUT } from '../../runtime/analysis';
import { SceneView } from '../../visualization/3d/scene-view';
import { SHOTS, ShotName } from '../../visualization/3d/camera';
import { PlaneView } from '../../visualization/2d/plane-view';
import { SliceView, sliceTitle } from '../../visualization/2d/slice-view';
import type { SliceValue } from '../../math-core/values';
import { Explanation } from '../explain/Explanations';

function devViews(): Record<string, unknown> {
  const w = window as unknown as { __views?: Record<string, unknown> };
  return (w.__views ??= {});
}

const sliceName = (role?: string) => (role === 'slice-x' ? 'x-slice' : role === 'slice-y' ? 'y-slice' : 'u-slice');

function SliceDrawer() {
  const ws = useWs();
  useTopics('values', 'view');
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<SliceView | null>(null);
  const slices = ws.sceneItems().filter((i) => i.visual.vtype === 'slice' && i.visible);
  const [pick, setPick] = useState<string | null>(null);
  const current = slices.find((s) => s.id === pick) ?? slices[0];
  useEffect(() => {
    if (!host.current || !current) return;
    if (!view.current) view.current = new SliceView(host.current, ws, current.id);
    else view.current.setItem(current.id);
  }, [ws, current?.id]);
  useEffect(() => () => view.current?.destroy(), []);
  return (
    <>
      <div className="drawer-tabs">
        {slices.map((s) => (
          <button key={s.id} className={s.id === current?.id ? 'active' : ''} onClick={() => setPick(s.id)} title={sliceTitle(s.visual.props.slice as SliceValue)}>
            <span className="swatch" style={{ background: s.color }} />
            {sliceName(s.visual.role)}
          </button>
        ))}
      </div>
      <div className="drawer-canvas" ref={host}>
        {!current && <div className="empty">Computing cross-sections…</div>}
      </div>
    </>
  );
}

export function CanvasPanel() {
  const ws = useWs();
  const pres = usePres();
  const an = useAnalysis();
  useTopics('view', 'doc', 'values');
  const host3d = useRef<HTMLDivElement>(null);
  const host2d = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<SceneView | null>(null);
  const [plane, setPlane] = useState<PlaneView | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const s = new SceneView(host3d.current!, ws, pres);
    const p = new PlaneView(host2d.current!, ws, pres);
    setScene(s);
    setPlane(p);
    if (import.meta.env.DEV) Object.assign(devViews(), { scene: s, plane: p });
    return () => {
      s.destroy();
      p.destroy();
    };
  }, [ws, pres]);

  const layout = an.plan()?.layout ?? DEFAULT_LAYOUT;
  const options = [...layout.views.map((v) => ({ id: v.id, label: v.label, views: [v.id] })), ...(layout.combos ?? [])];
  const layoutKey = options.map((o) => o.id).join('|');
  useEffect(() => setChoice(null), [layoutKey]);
  const active = options.find((o) => o.id === choice) ?? options.find((o) => o.id === layout.defaultView) ?? options[0];
  const renderers = new Set(active.views.map((id) => layout.views.find((v) => v.id === id)?.renderer));
  const show3d = renderers.has('scene');
  const show2d = renderers.has('plane');
  const drawer = an.drawer;

  const act = (fn: () => void) => () => {
    fn();
    setMenu(false);
  };

  return (
    <div className="panel canvas-panel">
      <div className="panel-header">
        <span className="panel-title">{layout.canvasTitle}</span>
        <div className="spacer" />
        {options.length > 1 && (
          <div className="seg">
            {options.map((o) => (
              <button key={o.id} className={active.id === o.id ? 'active' : ''} onClick={() => setChoice(o.id)}>
                {o.label}
              </button>
            ))}
          </div>
        )}
        <div className="menu-wrap">
          <button onClick={() => setMenu(!menu)} title="View options">
            ⋯
          </button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <button onClick={act(() => plane?.resetView())}>Fit the 2D view</button>
              {show3d &&
                SHOTS.map((s) => (
                  <button key={s.name} title={s.hint} onClick={act(() => scene?.shot(s.name as ShotName))}>
                    {s.label === '3D' ? 'Default 3D view' : s.label === 'Top' ? 'Top view' : s.label}
                  </button>
                ))}
              {show3d && (
                <button
                  onClick={act(() => {
                    scene?.setFlatten(!scene.flattened);
                    scene?.shot(scene.flattened ? 'top' : 'orbit');
                  })}
                >
                  {scene?.flattened ? 'Unflatten' : 'Flatten into contour map'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className={`panel-body canvas-body ${show3d && show2d ? 'split' : ''}`}>
        <div className="canvas-slot" style={{ display: show3d ? 'block' : 'none' }} ref={host3d} />
        <div className="canvas-slot" style={{ display: show2d ? 'block' : 'none' }} ref={host2d} />
      </div>
      {drawer && (
        <div className={`drawer drawer-${drawer.kind}`}>
          <div className="drawer-head">
            <span className="drawer-title">{drawer.kind === 'slices' ? 'Cross-section' : 'Explanation'}</span>
            <button className="close" onClick={() => an.setDrawer(null)} title="Close">
              ✕
            </button>
          </div>
          {drawer.kind === 'slices' ? (
            <SliceDrawer />
          ) : (
            <div className="drawer-scroll">
              <Explanation topic={drawer.topic} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}