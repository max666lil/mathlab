/**
 * The canvas: one primary visualization chosen from the focused object — a graph for f(x), a surface
 * (3D), contour map or both for f(x, y). Renderers are framework-free; this is a thin shell.
 */
import { useEffect, useRef, useState } from 'react';
import { useWs, usePres, useTopics } from '../hooks';
import { SceneView } from '../../visualization/3d/scene-view';
import { SHOTS, ShotName } from '../../visualization/3d/camera';
import { PlaneView } from '../../visualization/2d/plane-view';
import { SliceView, sliceTitle } from '../../visualization/2d/slice-view';
import type { FunctionValue, SliceValue } from '../../math-core/values';

type View = '3d' | 'contour' | 'split';

function devViews(): Record<string, unknown> {
  const w = window as unknown as { __views?: Record<string, unknown> };
  return (w.__views ??= {});
}

function SliceInset({ onClose }: { onClose(): void }) {
  const ws = useWs();
  useTopics('values', 'view');
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<SliceView | null>(null);
  const slices = ws.sceneItems().filter((i) => i.visual.vtype === 'slice' && i.visible);
  const [pick, setPick] = useState<string | null>(null);
  const current = slices.find((s) => s.id === pick) ?? slices[slices.length - 1];
  useEffect(() => {
    if (!host.current || !current) return;
    if (!view.current) view.current = new SliceView(host.current, ws, current.id);
    else view.current.setItem(current.id);
  }, [ws, current?.id]);
  useEffect(() => () => view.current?.destroy(), []);
  if (!current) return null;
  return (
    <div className="inset">
      <div className="inset-head">
        {slices.map((s) => (
          <button key={s.id} className={s.id === current.id ? 'active' : ''} onClick={() => setPick(s.id)} title={sliceTitle(s.visual.props.slice as SliceValue)}>
            <span className="swatch" style={{ background: s.color }} />
            {s.visual.role === 'slice-x' ? 'x-slice' : s.visual.role === 'slice-y' ? 'y-slice' : 'u-slice'}
          </button>
        ))}
        <button className="close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      <div className="inset-body" ref={host} />
    </div>
  );
}

export function CanvasPanel() {
  const ws = useWs();
  const pres = usePres();
  useTopics('view', 'doc', 'values');
  const host3d = useRef<HTMLDivElement>(null);
  const host2d = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<SceneView | null>(null);
  const [plane, setPlane] = useState<PlaneView | null>(null);
  const [view, setView] = useState<View>('3d');
  const [menu, setMenu] = useState(false);
  const [insetClosed, setInsetClosed] = useState(false);
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

  const focus = ws.focus ? (ws.value(ws.focus) as FunctionValue | undefined) : undefined;
  const dims = focus?.kind === 'function' ? focus.params.length : 0;
  const surfaceObject = dims === 2;
  const show3d = surfaceObject && view !== 'contour';
  const show2d = !surfaceObject || view !== '3d';
  const hasSlices = ws.sceneItems().some((i) => i.visual.vtype === 'slice' && i.visible);
  useEffect(() => setInsetClosed(false), [hasSlices]);

  return (
    <div className="panel canvas-panel">
      <div className="panel-header">
        <span className="panel-title">{dims === 1 ? 'Graph' : dims === 2 ? 'Surface & contours' : 'Canvas'}</span>
        {surfaceObject && (
          <div className="seg">
            {(['3d', 'contour', 'split'] as View[]).map((v) => (
              <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                {v === '3d' ? '3D' : v === 'contour' ? 'Contour' : 'Both'}
              </button>
            ))}
          </div>
        )}
        <div className="spacer" />
        <button onClick={() => plane?.resetView()} title="Fit the view">
          Fit
        </button>
        {show3d && (
          <div className="menu-wrap">
            <button onClick={() => setMenu(!menu)} title="Camera">
              ⋯
            </button>
            {menu && (
              <div className="menu" onMouseLeave={() => setMenu(false)}>
                {SHOTS.map((s) => (
                  <button
                    key={s.name}
                    title={s.hint}
                    onClick={() => {
                      scene?.shot(s.name as ShotName);
                      setMenu(false);
                    }}
                  >
                    {s.label === '3D' ? 'Default view' : s.label}
                  </button>
                ))}
                <button
                  onClick={() => {
                    scene?.setFlatten(!scene.flattened);
                    scene?.shot(scene.flattened ? 'top' : 'orbit');
                    setMenu(false);
                  }}
                >
                  {scene?.flattened ? 'Unflatten' : 'Flatten into contour map'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className={`panel-body canvas-body ${show3d && show2d ? 'split' : ''}`}>
        <div className="canvas-slot" style={{ display: show3d ? 'block' : 'none' }} ref={host3d} />
        <div className="canvas-slot" style={{ display: show2d ? 'block' : 'none' }} ref={host2d} />
        {hasSlices && !insetClosed && <SliceInset onClose={() => setInsetClosed(true)} />}
      </div>
    </div>
  );
}