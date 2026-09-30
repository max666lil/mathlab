/** Drawers of the graphing layer: implicit curves, shaded regions, parametric / polar curves (2-D and 3-D). */
import * as THREE from 'three';
import { registerDrawer2D, Draw2DArgs } from '../../visualization/2d/registry2d';
import { registerVisual3D, Visual3D, Ctx3D, disposeObject, FatLine } from '../../visualization/3d/registry3d';
import type { SceneItem } from '../../visualization/scene-model';
import { sampleGrid, cachedLevelSet } from '../../visualization/sampling';
import { withAlpha, hexToRgb } from '../../visualization/colormap';
import type { FunctionValue } from '../../math-core/values';
import { strokeSegments } from './draw-util';
import { curveRange } from '../../math-core/ranges';

function viewGrid(a: Draw2DArgs, fn: FunctionValue, n: number) {
  const q = (v: number) => +v.toPrecision(6);
  return sampleGrid(fn, [q(a.view.xRange[0]), q(a.view.xRange[1])], [q(a.view.yRange[0]), q(a.view.yRange[1])], n);
}

registerDrawer2D('implicit', {
  layer: 3,
  draw(a) {
    const fn = a.item.visual.props.fn as FunctionValue;
    const { ctx, view } = a;
    ctx.strokeStyle = a.item.color;
    ctx.lineWidth = a.selected ? 3.4 : 2.4;
    strokeSegments(ctx, cachedLevelSet(viewGrid(a, fn, 260), 0), (x) => view.sx(x), (y) => view.sy(y));
  },
});

registerDrawer2D('region', {
  layer: 0,
  draw(a) {
    const { fn, rel } = a.item.visual.props as { fn: FunctionValue; rel: string };
    const { ctx, view } = a;
    const f = fn.eval as (x: number, y: number) => number;
    const inside = (g: number) => (rel === '<' ? g < 0 : rel === '<=' ? g <= 0 : rel === '>' ? g > 0 : g >= 0);
    const key = `region|${fn.key}|${rel}|${view.key()}|${a.item.color}`;
    let img = a.cache.get(key) as HTMLCanvasElement | undefined;
    if (!img) {
      const step = 3;
      const w = Math.ceil(view.width / step);
      const h = Math.ceil(view.height / step);
      img = document.createElement('canvas');
      img.width = w;
      img.height = h;
      const ic = img.getContext('2d')!;
      const data = ic.createImageData(w, h);
      const [r, g, b] = hexToRgb(a.item.color);
      for (let j = 0; j < h; j++) {
        const y = view.wy((j + 0.5) * step);
        for (let i = 0; i < w; i++) {
          const v = f(view.wx((i + 0.5) * step), y);
          if (!Number.isFinite(v) || !inside(v)) continue;
          const k = (j * w + i) * 4;
          data.data[k] = r * 255;
          data.data[k + 1] = g * 255;
          data.data[k + 2] = b * 255;
          data.data[k + 3] = 70;
        }
      }
      ic.putImageData(data, 0, 0);
      a.cache.set(key, img);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, view.width, view.height);
    // boundary: dashed when strict (< / >), solid when included (≤ / ≥)
    ctx.strokeStyle = withAlpha(a.item.color, 0.95);
    ctx.lineWidth = a.selected ? 2.8 : 2;
    if (rel === '<' || rel === '>') ctx.setLineDash([7, 5]);
    strokeSegments(ctx, cachedLevelSet(viewGrid(a, fn, 220), 0), (x) => view.sx(x), (y) => view.sy(y));
    ctx.setLineDash([]);
  },
});

/** Sample a parametric / polar curve on the default parameter range. */
export function curvePoints(fn: FunctionValue, polar: boolean, n = 1200): (number[] | null)[] {
  const g = fn.eval as (t: number) => number | number[];
  const CURVE_RANGE = curveRange(fn);
  const out: (number[] | null)[] = [];
  for (let i = 0; i <= n; i++) {
    const t = CURVE_RANGE[0] + ((CURVE_RANGE[1] - CURVE_RANGE[0]) * i) / n;
    const v = g(t);
    const p = polar ? [(v as number) * Math.cos(t), (v as number) * Math.sin(t)] : (v as number[]);
    out.push(Array.isArray(p) && p.every(Number.isFinite) ? p : null);
  }
  return out;
}

registerDrawer2D('curve', {
  layer: 3,
  draw(a) {
    const { fn, polar } = a.item.visual.props as { fn: FunctionValue; polar?: boolean };
    const { ctx, view } = a;
    const pts = curvePoints(fn, !!polar);
    if (pts.some((p) => p && p.length > 2)) return; // space curves are drawn in 3-D
    ctx.strokeStyle = a.item.color;
    ctx.lineWidth = a.selected ? 3.2 : 2.4;
    ctx.beginPath();
    let pen = false;
    let last: number[] | null = null;
    for (const p of pts) {
      if (!p) {
        pen = false;
        continue;
      }
      const x = view.sx(p[0]);
      const y = view.sy(p[1]);
      if (pen && last && Math.hypot(x - last[0], y - last[1]) > view.height) pen = false;
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
      last = [x, y];
    }
    ctx.stroke();
    // orientation: arrowheads in the direction of increasing parameter
    ctx.fillStyle = a.item.color;
    for (const frac of [0.2, 0.45, 0.7]) {
      const i = Math.floor(frac * (pts.length - 2));
      const p = pts[i];
      const q = pts[i + 2];
      if (!p || !q) continue;
      const x0 = view.sx(p[0]), y0 = view.sy(p[1]), x1 = view.sx(q[0]), y1 = view.sy(q[1]);
      if (Math.hypot(x1 - x0, y1 - y0) < 0.5) continue;
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const s = a.selected ? 9 : 7;
      ctx.beginPath();
      ctx.moveTo(x1 + s * Math.cos(ang), y1 + s * Math.sin(ang));
      ctx.lineTo(x1 + s * Math.cos(ang + 2.5), y1 + s * Math.sin(ang + 2.5));
      ctx.lineTo(x1 + s * Math.cos(ang - 2.5), y1 + s * Math.sin(ang - 2.5));
      ctx.fill();
    }
    a.hits.push({ itemId: a.item.id, pts: pts.filter((p): p is number[] => !!p).flatMap((p) => [p[0], p[1]]) });
  },
});

class Curve3D implements Visual3D {
  object = new THREE.Group();
  private line: FatLine | null = null;
  update(item: SceneItem, ctx: Ctx3D, selected: boolean) {
    const { fn, polar } = item.visual.props as { fn: FunctionValue; polar?: boolean };
    const pts = curvePoints(fn, !!polar, 600);
    if (!this.line) {
      this.line = new FatLine(ctx.lineMaterial(item.color, 2.6));
      this.object.add(this.line.line);
    }
    this.line.material.color.set(item.color);
    this.line.material.linewidth = selected ? 3.4 : 2.6;
    const flat: number[] = [];
    const m = ctx.map;
    for (const p of pts) {
      if (!p) continue;
      const v = p.length > 2 ? m.v(p[0], p[1], p[2]) : m.floor(p[0], p[1]);
      flat.push(v.x, v.y, v.z);
    }
    this.line.set(flat);
  }
  dispose() {
    disposeObject(this.object);
  }
}
registerVisual3D('curve', () => new Curve3D());