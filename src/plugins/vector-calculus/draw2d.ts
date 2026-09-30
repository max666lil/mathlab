/**
 * 2-D drawers of vector calculus: streamlines, moving particles, the flux box (divergence) and the
 * paddle wheel (curl), and the mean-value circle (Laplacian of a scalar field).
 */
import { registerDrawer2D } from '../../visualization/2d/registry2d';
import { drawArrow, drawLabel } from '../core-calculus/draw-util';
import { withAlpha } from '../../visualization/colormap';
import { formatNumber } from '../../math-core/symbolic/print';
import type { FunctionValue } from '../../math-core/values';
import { streamlines2, particleTracks, trackIndex, flowScale, FIELD_RANGE } from './flow';
import { MARKER_COLORS } from '../core-calculus/draw2d';
import { ROLE_COLORS } from '../../visualization/scene-model';

Object.assign(MARKER_COLORS, {
  'stable node': '#52d69b',
  'stable spiral': '#52d69b',
  'unstable node': '#ff6b6b',
  'unstable spiral': '#ff6b6b',
  center: '#4cc9f0',
});
Object.assign(ROLE_COLORS, { field: '#4cc9f0', streamline: '#80deea', particle: '#ffe08a', flux: '#ff6b6b', paddle: '#f4a261', laplacian: '#c792ea', potential: '#52d69b', divergence: '#ff6b6b', curl: '#f4a261' });

export const VC_COLORS = { streamline: '#80deea', particle: '#ffe08a', out: '#ff6b6b', in: '#4cc9f0', paddle: '#f4a261', mean: '#c792ea' };

registerDrawer2D('streamlines', {
  layer: 1,
  draw(a) {
    const { fn, n } = a.item.visual.props as { fn: FunctionValue; n: number };
    if (n !== 2) return;
    const { ctx, view } = a;
    const lines = streamlines2(fn, FIELD_RANGE);
    ctx.strokeStyle = withAlpha(a.item.color, a.selected ? 0.95 : 0.7);
    ctx.lineWidth = a.selected ? 1.8 : 1.3;
    for (const l of lines) {
      ctx.beginPath();
      for (let i = 0; i < l.length; i += 2) {
        const x = view.sx(l[i]);
        const y = view.sy(l[i + 1]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // arrowhead in the middle, pointing along the flow
      const m = Math.floor(l.length / 4) * 2;
      if (m >= 2 && m + 2 < l.length) {
        const x0 = view.sx(l[m - 2]), y0 = view.sy(l[m - 1]), x1 = view.sx(l[m + 2]), y1 = view.sy(l[m + 3]);
        const ang = Math.atan2(y1 - y0, x1 - x0);
        const cx = view.sx(l[m]), cy = view.sy(l[m + 1]);
        ctx.fillStyle = ctx.strokeStyle as string;
        ctx.beginPath();
        ctx.moveTo(cx + 6 * Math.cos(ang), cy + 6 * Math.sin(ang));
        ctx.lineTo(cx + 6 * Math.cos(ang + 2.5), cy + 6 * Math.sin(ang + 2.5));
        ctx.lineTo(cx + 6 * Math.cos(ang - 2.5), cy + 6 * Math.sin(ang - 2.5));
        ctx.fill();
      }
    }
  },
});

registerDrawer2D('particles', {
  layer: 6,
  draw(a) {
    const { fn, n, timeline } = a.item.visual.props as { fn: FunctionValue; n: number; timeline: string };
    if (n !== 2) return;
    const { ctx, view } = a;
    const tr = particleTracks(fn, 320);
    const t = a.timeline(timeline, 0);
    const color = VC_COLORS.particle;
    for (let i = 0; i < tr.paths.length; i++) {
      const path = tr.paths[i];
      const k = trackIndex(tr, i, t);
      const x = path[k * 2];
      if (!Number.isFinite(x)) continue;
      const y = path[k * 2 + 1];
      // fading tail
      ctx.lineWidth = 1.6;
      for (let j = 1; j <= 7 && k - j >= 0; j++) {
        const px = path[(k - j) * 2], py = path[(k - j) * 2 + 1];
        const qx = path[(k - j + 1) * 2], qy = path[(k - j + 1) * 2 + 1];
        ctx.strokeStyle = withAlpha(color, 0.5 * (1 - j / 8));
        ctx.beginPath();
        ctx.moveTo(view.sx(px), view.sy(py));
        ctx.lineTo(view.sx(qx), view.sy(qy));
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(view.sx(x), view.sy(y), 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
  },
});

registerDrawer2D('fluxbox', {
  layer: 7,
  draw(a) {
    const { fn, div, at } = a.item.visual.props as { fn: FunctionValue; div: FunctionValue; at: number[] };
    const { ctx, view, theme } = a;
    const F = fn.eval as (x: number, y: number) => number[];
    const s = 0.35; // half side of the box
    const [cx, cy] = at;
    ctx.strokeStyle = withAlpha(theme.name === 'dark' ? '#ffffff' : '#1b1e28', 0.85);
    ctx.lineWidth = 1.6;
    ctx.strokeRect(view.sx(cx - s), view.sy(cy + s), view.sx(cx + s) - view.sx(cx - s), view.sy(cy - s) - view.sy(cy + s));
    // outward normal component F·n on each side: red = out, blue = in
    const sides: [number[], number[]][] = [];
    const k = 4;
    for (let i = 0; i < k; i++) {
      const u = -s + ((i + 0.5) * 2 * s) / k;
      sides.push([[cx + s, cy + u], [1, 0]], [[cx - s, cy + u], [-1, 0]], [[cx + u, cy + s], [0, 1]], [[cx + u, cy - s], [0, -1]]);
    }
    let maxF = 1e-9;
    const vals = sides.map(([p, nrm]) => {
      const v = F(p[0], p[1]);
      const f = v[0] * nrm[0] + v[1] * nrm[1];
      maxF = Math.max(maxF, Math.abs(f));
      return f;
    });
    sides.forEach(([p, nrm], i) => {
      const f = vals[i];
      if (!Number.isFinite(f) || Math.abs(f) < 1e-9) return;
      const len = 0.32 * (Math.abs(f) / maxF);
      const out = f > 0;
      const x0 = out ? p[0] : p[0] + nrm[0] * len, y0 = out ? p[1] : p[1] + nrm[1] * len;
      const x1 = out ? p[0] + nrm[0] * len : p[0], y1 = out ? p[1] + nrm[1] * len : p[1];
      drawArrow(ctx, view.sx(x0), view.sy(y0), view.sx(x1), view.sy(y1), out ? VC_COLORS.out : VC_COLORS.in, 2, 7);
    });
    const d = (div.eval as (x: number, y: number) => number)(cx, cy);
    drawLabel(ctx, `div F = ${formatNumber(d, 3)}  (${d > 1e-9 ? 'source: net outflow' : d < -1e-9 ? 'sink: net inflow' : 'in = out'})`, view.sx(cx + s) + 8, view.sy(cy - s) + 16, theme.name === 'dark' ? '#e6e8ef' : '#1b1e28', theme, 13);
  },
});

registerDrawer2D('paddle', {
  layer: 7,
  draw(a) {
    const { fn, curl, at, n, timeline } = a.item.visual.props as { fn: FunctionValue; curl: FunctionValue; at: number[]; n: number; timeline: string };
    if (n !== 2) return;
    const { ctx, view, theme } = a;
    const c = (curl.eval as (x: number, y: number) => number)(at[0], at[1]);
    // angular speed curl/2, in the same flow time as the particles
    const angle = (c / 2) * flowScale(fn) * a.timeline(timeline, 0);
    const R = 0.45;
    const [x0, y0] = [view.sx(at[0]), view.sy(at[1])];
    const rp = view.sx(at[0] + R) - x0;
    ctx.strokeStyle = VC_COLORS.paddle;
    ctx.lineWidth = 3;
    for (let k = 0; k < 4; k++) {
      const th = angle + (k * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + rp * Math.cos(th), y0 - rp * Math.sin(th));
      ctx.stroke();
      ctx.fillStyle = VC_COLORS.paddle;
      ctx.beginPath();
      ctx.arc(x0 + rp * Math.cos(th), y0 - rp * Math.sin(th), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(VC_COLORS.paddle, 0.5);
    ctx.beginPath();
    ctx.arc(x0, y0, rp, 0, Math.PI * 2);
    ctx.stroke();
    const dir = Math.abs(c) < 1e-9 ? 'does not spin' : c > 0 ? 'spins counter-clockwise' : 'spins clockwise';
    drawLabel(ctx, `curl F = ${formatNumber(c, 3)}: ${dir}`, x0 + rp + 8, y0 - rp - 4, VC_COLORS.paddle, theme, 13);
  },
});

registerDrawer2D('meancircle', {
  layer: 7,
  draw(a) {
    const { fn, lap, at } = a.item.visual.props as { fn: FunctionValue; lap: FunctionValue; at: number[] };
    const { ctx, view, theme } = a;
    const f = fn.eval as (x: number, y: number) => number;
    const r = 0.5;
    let avg = 0;
    const m = 64;
    for (let k = 0; k < m; k++) avg += f(at[0] + r * Math.cos((2 * Math.PI * k) / m), at[1] + r * Math.sin((2 * Math.PI * k) / m)) / m;
    const f0 = f(at[0], at[1]);
    const L = (lap.eval as (x: number, y: number) => number)(at[0], at[1]);
    const [x0, y0] = [view.sx(at[0]), view.sy(at[1])];
    const rp = view.sx(at[0] + r) - x0;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = VC_COLORS.mean;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x0, y0, rp, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const cmp = Math.abs(avg - f0) < 1e-9 ? 'avg = f(P): harmonic' : avg > f0 ? 'avg > f(P): ∇²f > 0' : 'avg < f(P): ∇²f < 0';
    drawLabel(ctx, cmp, x0 + rp + 8, y0 - 4, VC_COLORS.mean, theme, 13);
    drawLabel(ctx, `avg − f(P) = ${formatNumber(avg - f0, 3)} ≈ r²∇²f/4`, x0 + rp + 8, y0 + 13, VC_COLORS.mean, theme, 11);
    void L;
  },
});