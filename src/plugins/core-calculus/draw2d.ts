/**
 * Core 2D drawers for the calculus plugin. Each drawer renders one visual type into the domain
 * (xy-plane) view and may register draggable handles.
 */
import { registerDrawer2D, Draw2DArgs, Handle2D } from '../../visualization/2d/registry2d';
import { sampleGrid, niceLevels, cachedLevelSet, steepestPath, lineBoxInterval, Grid } from '../../visualization/sampling';
import { colormap, withAlpha } from '../../visualization/colormap';
import { FunctionValue, PointValue, SliceValue, MathValue, VectorValue } from '../../math-core/values';
import { formatNumber } from '../../math-core/symbolic/print';
import { normalize, EigenPair } from '../../math-core/linalg';
import { drawArrow, drawLabel, strokeSegments, plainLabel } from './draw-util';

type F2 = (x: number, y: number) => number;

/** Grid over the visible part of the view (so zooming reveals detail). */
function viewGrid(a: Draw2DArgs, fn: FunctionValue, n = 150): Grid {
  const [x0, x1] = a.view.xRange;
  const [y0, y1] = a.view.yRange;
  const q = (v: number) => +v.toPrecision(6);
  return sampleGrid(fn, [q(x0), q(x1)], [q(y0), q(y1)], n);
}

/** Display range for colours / levels: the frame grid when fn is the primary surface. */
function displayRange(a: Draw2DArgs, fn: FunctionValue): [number, number] {
  if (a.frame.surface && a.frame.surface.key === fn.key) return [a.frame.zLo, a.frame.zHi];
  const g = sampleGrid(fn, a.frame.xr, a.frame.yr, 80);
  return [g.lo, g.hi];
}

// ---------------------------------------------------------------- heat map

registerDrawer2D('surface', {
  layer: 0,
  draw(a) {
    const fn = a.item.visual.props.fn as FunctionValue;
    const { view, theme } = a;
    const [lo, hi] = displayRange(a, fn);
    const key = `heat|${fn.key}|${view.key()}|${lo}|${hi}|${theme.name}`;
    let img = a.cache.get(key) as HTMLCanvasElement | undefined;
    if (!img) {
      const step = 2;
      const w = Math.ceil(view.width / step);
      const h = Math.ceil(view.height / step);
      img = document.createElement('canvas');
      img.width = w;
      img.height = h;
      const ictx = img.getContext('2d')!;
      const data = ictx.createImageData(w, h);
      const f = fn.eval as F2;
      const rgb: [number, number, number] = [0, 0, 0];
      const alpha = theme.name === 'dark' ? 0.62 : 0.55;
      const bg = theme.name === 'dark' ? [15, 17, 23] : [251, 251, 253];
      for (let j = 0; j < h; j++) {
        const y = view.wy((j + 0.5) * step);
        for (let i = 0; i < w; i++) {
          const z = f(view.wx((i + 0.5) * step), y);
          const k = (j * w + i) * 4;
          if (!Number.isFinite(z)) {
            data.data[k + 3] = 0;
            continue;
          }
          colormap((z - lo) / (hi - lo), rgb);
          data.data[k] = bg[0] * (1 - alpha) + rgb[0] * 255 * alpha;
          data.data[k + 1] = bg[1] * (1 - alpha) + rgb[1] * 255 * alpha;
          data.data[k + 2] = bg[2] * (1 - alpha) + rgb[2] * 255 * alpha;
          data.data[k + 3] = 255;
        }
      }
      ictx.putImageData(data, 0, 0);
      for (const k of a.cache.keys()) if (k.startsWith('heat|')) a.cache.delete(k);
      a.cache.set(key, img);
    }
    a.ctx.imageSmoothingEnabled = true;
    a.ctx.drawImage(img, 0, 0, view.width, view.height);
  },
});

// ---------------------------------------------------------------- contours

registerDrawer2D('contours', {
  layer: 1,
  draw(a) {
    const fn = a.item.visual.props.fn as FunctionValue;
    const count = (a.item.visual.props.count as number | undefined) ?? 14;
    const [lo, hi] = displayRange(a, fn);
    const g = viewGrid(a, fn);
    const levels = niceLevels(lo, hi, count);
    const sx = (x: number) => a.view.sx(x);
    const sy = (y: number) => a.view.sy(y);
    a.ctx.lineWidth = a.selected ? 1.6 : 1;
    for (const level of levels) {
      a.ctx.strokeStyle = a.theme.contour;
      strokeSegments(a.ctx, cachedLevelSet(g, level), sx, sy);
    }
  },
});

// ---------------------------------------------------------------- level curve through P

registerDrawer2D('level', {
  layer: 3,
  draw(a) {
    const { fn, at, value, g } = a.item.visual.props as { fn: FunctionValue; at?: number[]; value: number; g?: number[] };
    const grid = viewGrid(a, fn, 200);
    const { ctx, view } = a;
    ctx.strokeStyle = a.item.color;
    ctx.lineWidth = a.selected ? 3.5 : 2.5;
    strokeSegments(ctx, cachedLevelSet(grid, value), (x) => view.sx(x), (y) => view.sy(y));
    if (!at || !g) return;
    const gn = Math.hypot(g[0], g[1]);
    if (gn < 1e-9) return;
    // tangent to the level curve: perpendicular to the gradient
    const t = [-g[1] / gn, g[0] / gn];
    const px = view.sx(at[0]);
    const py = view.sy(at[1]);
    const L = 64;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(px - t[0] * L, py + t[1] * L);
    ctx.lineTo(px + t[0] * L, py - t[1] * L);
    ctx.stroke();
    ctx.setLineDash([]);
    // right-angle marker between tangent and gradient
    const s = 10;
    const gx = g[0] / gn;
    const gy = g[1] / gn;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = a.theme.text;
    ctx.beginPath();
    ctx.moveTo(px + t[0] * s, py - t[1] * s);
    ctx.lineTo(px + t[0] * s + gx * s, py - t[1] * s - gy * s);
    ctx.lineTo(px + gx * s, py - gy * s);
    ctx.stroke();
    a.hits.push({ itemId: a.item.id, pts: [at[0] - (t[0] * L) / view.scale, at[1] - (t[1] * L) / view.scale, at[0] + (t[0] * L) / view.scale, at[1] + (t[1] * L) / view.scale] });
    if (a.selected) drawLabel(ctx, `f = ${formatNumber(value, 3)}`, px + t[0] * (L + 8), py - t[1] * (L + 8), a.item.color, a.theme, 13);
  },
});
// ---------------------------------------------------------------- steepest paths

registerDrawer2D('path', {
  layer: 2,
  draw(a) {
    const { fn, grad, from, mode } = a.item.visual.props as { fn: FunctionValue; grad: FunctionValue; from: number[]; mode: string };
    const key = `path|${fn.key}|${from}|${mode}|${a.frame.xr}|${a.frame.yr}`;
    let paths = a.cache.get(key) as [number[][], boolean][] | undefined;
    if (!paths) {
      paths = [];
      if (mode !== 'descent') paths.push([steepestPath(fn, grad, from, 1, a.frame.xr, a.frame.yr), false]);
      if (mode !== 'ascent') paths.push([steepestPath(fn, grad, from, -1, a.frame.xr, a.frame.yr), true]);
      a.cache.set(key, paths);
    }
    const { ctx, view } = a;
    ctx.strokeStyle = a.item.color;
    ctx.lineWidth = a.selected ? 3 : 2;
    for (const [pts, dashed] of paths) {
      ctx.setLineDash(dashed ? [6, 5] : []);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(view.sx(p[0]), view.sy(p[1])) : ctx.moveTo(view.sx(p[0]), view.sy(p[1]))));
      ctx.stroke();
      const end = pts[pts.length - 1];
      if (pts.length > 3) {
        ctx.setLineDash([]);
        ctx.fillStyle = a.item.color;
        ctx.beginPath();
        ctx.arc(view.sx(end[0]), view.sy(end[1]), 3.5, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    ctx.setLineDash([]);
  },
});

// ---------------------------------------------------------------- slice lines

registerDrawer2D('slice', {
  layer: 2,
  draw(a) {
    const s = a.item.visual.props.slice as SliceValue;
    const { ctx, view } = a;
    const iv = lineBoxInterval(s.origin, s.dir, view.xRange, view.yRange);
    if (!iv) return;
    const p0 = s.origin.map((o, i) => o + iv[0] * s.dir[i]);
    const p1 = s.origin.map((o, i) => o + iv[1] * s.dir[i]);
    ctx.strokeStyle = withAlpha(a.item.color, 0.9);
    ctx.lineWidth = a.selected ? 2.5 : 1.6;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(view.sx(p0[0]), view.sy(p0[1]));
    ctx.lineTo(view.sx(p1[0]), view.sy(p1[1]));
    ctx.stroke();
    ctx.setLineDash([]);
    const name = s.axis === 1 ? `x = ${formatNumber(s.origin[0], 3)}` : s.axis === 0 ? `y = ${formatNumber(s.origin[1], 3)}` : 'û-slice';
    a.hits.push({ itemId: a.item.id, pts: [p0[0], p0[1], p1[0], p1[1]] });
    const lp = s.origin.map((o, i) => o + (iv[1] - 0.35) * s.dir[i]);
    if (a.selected) drawLabel(ctx, name, view.sx(lp[0]) + 6, view.sy(lp[1]) - 8, a.item.color, a.theme, 12);
  },
});

// ---------------------------------------------------------------- Hessian principal directions

registerDrawer2D('hessian_axes', {
  layer: 3,
  draw(a) {
    const { at, eig } = a.item.visual.props as { at: number[]; eig: EigenPair[] };
    const { ctx, view } = a;
    const px = view.sx(at[0]);
    const py = view.sy(at[1]);
    eig.forEach((e, k) => {
      const L = 48;
      const [vx, vy] = e.vector;
      ctx.strokeStyle = a.item.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(k === 0 ? [] : [4, 4]);
      ctx.beginPath();
      ctx.moveTo(px - vx * L, py + vy * L);
      ctx.lineTo(px + vx * L, py - vy * L);
      ctx.stroke();
      ctx.setLineDash([]);
      a.hits.push({ itemId: a.item.id, pts: [at[0] - (vx * L) / view.scale, at[1] - (vy * L) / view.scale, at[0] + (vx * L) / view.scale, at[1] + (vy * L) / view.scale] });
      if (a.selected) drawLabel(ctx, `λ${k === 0 ? '₁' : '₂'} = ${formatNumber(e.value, 3)}`, px + vx * (L + 6), py - vy * (L + 6), a.item.color, a.theme, 12);
    });
  },
});

// ---------------------------------------------------------------- arrows (vectors)

function anchorInputs(a: Draw2DArgs, anchor: number[]): string[] {
  return a.ws
    .statements()
    .filter((s) => {
      if (s.input?.kind !== 'point') return false;
      const v = a.ws.value(s.id) as PointValue | undefined;
      return !!v && v.coords.every((c, i) => Math.abs(c - (anchor[i] ?? 0)) < 1e-9);
    })
    .map((s) => s.id);
}

registerDrawer2D('arrow', {
  layer: 4,
  draw(a) {
    const { anchor, vec: fullVec, sourceId } = a.item.visual.props as { anchor: number[]; vec: number[]; sourceId?: string };
    if (anchor.length !== 2 || fullVec.length !== 2) return;
    const vec = fullVec.map((c) => c * a.style.grow);
    a.hits.push({ itemId: a.item.id, pts: [anchor[0], anchor[1], anchor[0] + vec[0], anchor[1] + vec[1]] });
    const { ctx, view } = a;
    const x0 = view.sx(anchor[0]);
    const y0 = view.sy(anchor[1]);
    const x1 = view.sx(anchor[0] + vec[0]);
    const y1 = view.sy(anchor[1] + vec[1]);
    if (a.selected) {
      ctx.shadowColor = a.item.color;
      ctx.shadowBlur = 10;
    }
    drawArrow(ctx, x0, y0, x1, y1, a.item.color, a.selected ? 3.2 : 2.6);
    ctx.shadowBlur = 0;
    const label = plainLabel(a.item.visual.label);
    if (label) {
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      drawLabel(ctx, label, x1 + ((x1 - x0) / len) * 10 - ((y1 - y0) / len) * 8, y1 + ((y1 - y0) / len) * 10 + ((x1 - x0) / len) * 8, a.item.color, a.theme, 16, 'center');
    }
    // drag the tip: solve for the inputs the vector depends on (not the anchor)
    if (sourceId && a.ws.graph.has(sourceId)) {
      const exclude = anchorInputs(a, anchor);
      const solvable = [...a.ws.graph.ancestors(sourceId), sourceId].some((id) => a.ws.statement(id)?.input && !exclude.includes(id));
      if (solvable) {
        a.handles.push({
          x: anchor[0] + fullVec[0],
          y: anchor[1] + fullVec[1],
          r: 12,
          itemId: a.item.id,
          nodeId: sourceId,
          cursor: 'grab',
          drag: ([wx, wy]) => {
            a.ws.solveFor(sourceId, [wx - anchor[0], wy - anchor[1]], (v: MathValue) => (v.kind === 'vector' ? (v as VectorValue).comps : undefined), exclude);
          },
        } satisfies Handle2D);
      }
    }
  },
});

// ---------------------------------------------------------------- points

registerDrawer2D('point', {
  layer: 6,
  draw(a) {
    const { coords, inputId } = a.item.visual.props as { coords: number[]; inputId?: string };
    if (coords.length < 2) return;
    const { ctx, view } = a;
    const px = view.sx(coords[0]);
    const py = view.sy(coords[1]);
    if (a.selected) {
      ctx.strokeStyle = withAlpha(a.item.color, 0.5);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(px, py, 11, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.fillStyle = a.item.color;
    ctx.strokeStyle = a.theme.bg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, inputId ? 7 : 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    const label = plainLabel(a.item.visual.label);
    if (label) drawLabel(ctx, label, px + 11, py - 12, a.theme.text, a.theme, 16);
    if (inputId) {
      a.handles.push({
        x: coords[0],
        y: coords[1],
        r: 14,
        itemId: a.item.id,
        nodeId: inputId,
        cursor: 'move',
        drag: ([wx, wy], mods) => {
          const snap = (v: number) => (mods.shift ? Math.round(v * 4) / 4 : v);
          a.ws.setPoint(inputId, [snap(wx), snap(wy)]);
        },
      });
    }
  },
});

// ---------------------------------------------------------------- y = f(x)

registerDrawer2D('graph1d', {
  layer: 2,
  draw(a) {
    const fn = a.item.visual.props.fn as FunctionValue;
    const f = fn.eval as (x: number) => number;
    const { ctx, view } = a;
    ctx.strokeStyle = a.item.color;
    ctx.lineWidth = a.selected ? 3.2 : 2.4;
    ctx.beginPath();
    let pen = false;
    let lastY = 0;
    for (let px = 0; px <= view.width; px += 1.5) {
      const y = f(view.wx(px));
      const py = view.sy(y);
      if (!Number.isFinite(y) || (pen && Math.abs(py - lastY) > view.height * 2)) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
      pen = true;
      lastY = py;
    }
    ctx.stroke();
  },
});

// ---------------------------------------------------------------- planar vector fields

registerDrawer2D('field2', {
  layer: 1,
  draw(a) {
    const fn = a.item.visual.props.fn as FunctionValue;
    const F = fn.eval as (x: number, y: number) => number[];
    const { ctx, view } = a;
    const cell = Math.max(28, Math.min(view.width, view.height) / 18);
    const vals: [number, number, number[]][] = [];
    let maxN = 0;
    for (let py = cell / 2; py < view.height; py += cell)
      for (let px = cell / 2; px < view.width; px += cell) {
        const v = F(view.wx(px), view.wy(py));
        if (!v.every(Number.isFinite)) continue;
        maxN = Math.max(maxN, Math.hypot(v[0], v[1]));
        vals.push([px, py, v]);
      }
    for (const [px, py, v] of vals) {
      const n = Math.hypot(v[0], v[1]);
      if (n < 1e-12) continue;
      const len = cell * 0.8 * Math.sqrt(n / (maxN || 1));
      const [ux, uy] = normalize(v);
      drawArrow(ctx, px - (ux * len) / 2, py + (uy * len) / 2, px + (ux * len) / 2, py - (uy * len) / 2, withAlpha(a.item.color, 0.35 + 0.65 * (n / maxN)), 1.4, 6);
    }
  },
});