/** Figures drawn by scripts: plot / scatter / bar / hist / stairs on the 2-D plane. */
import { registerDrawer2D } from '../../visualization/2d/registry2d';
import { registerFrameHint } from '../../visualization/sampling';
import { withAlpha } from '../../visualization/colormap';
import { drawLabel } from '../core-calculus/draw-util';
import type { Figure } from '../../runtime/script/interp';

const PALETTE = ['#5b8cff', '#f4a261', '#52d69b', '#ff6b6b', '#c77dff', '#ffd166'];
const COLORS: Record<string, string> = { r: '#ff6b6b', g: '#52d69b', b: '#5b8cff', k: '#e6e8ef', m: '#c77dff', c: '#4cc9f0', y: '#ffd166', w: '#ffffff' };

function box(fig: Figure): [number, number][] | null {
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const s of fig.series) {
    s.x.forEach((x, i) => {
      const y = s.y[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const hw = s.type === 'bar' ? (s.width ?? 0.8) / 2 : 0;
      x0 = Math.min(x0, x - hw);
      x1 = Math.max(x1, x + hw);
      y0 = Math.min(y0, y, s.type === 'bar' ? 0 : y);
      y1 = Math.max(y1, y, s.type === 'bar' ? 0 : y);
    });
  }
  if (!Number.isFinite(x0)) return null;
  if (x1 - x0 < 1e-12) [x0, x1] = [x0 - 1, x1 + 1];
  if (y1 - y0 < 1e-12) [y0, y1] = [y0 - 1, y1 + 1];
  return [[x0, x1], [y0, y1]];
}

registerFrameHint('figure', (p) => {
  const b = box(p.figure as Figure);
  return b ? { r: Math.max(1, ...b.flat().map(Math.abs)), dim: 2, box: b, free: true } : undefined;
});

registerDrawer2D('figure', {
  layer: 3,
  draw(a) {
    const fig = a.item.visual.props.figure as Figure;
    const { ctx, view, theme } = a;
    fig.series.forEach((s, k) => {
      const m = s.style ? /[rgbkmcyw]/.exec(s.style) : null;
      const color = m ? COLORS[m[0]] : PALETTE[k % PALETTE.length];
      if (s.type === 'bar') {
        const w = s.width ?? 0.8;
        ctx.fillStyle = withAlpha(color, 0.55);
        ctx.strokeStyle = withAlpha(color, 0.95);
        ctx.lineWidth = 1;
        s.x.forEach((x, i) => {
          const y = s.y[i];
          const X0 = view.sx(x - w / 2), X1 = view.sx(x + w / 2);
          const Y0 = view.sy(0), Y1 = view.sy(y);
          ctx.fillRect(X0, Math.min(Y0, Y1), X1 - X0, Math.abs(Y1 - Y0));
          ctx.strokeRect(X0, Math.min(Y0, Y1), X1 - X0, Math.abs(Y1 - Y0));
        });
      } else if (s.type === 'scatter') {
        ctx.fillStyle = color;
        const r = s.x.length > 2000 ? 1.4 : 2.6;
        s.x.forEach((x, i) => {
          if (!Number.isFinite(x) || !Number.isFinite(s.y[i])) return;
          ctx.beginPath();
          ctx.arc(view.sx(x), view.sy(s.y[i]), r, 0, Math.PI * 2);
          ctx.fill();
        });
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = a.selected ? 3 : 2.2;
        if (s.style?.includes('--')) ctx.setLineDash([7, 5]);
        else if (s.style?.includes(':')) ctx.setLineDash([2, 4]);
        ctx.beginPath();
        let pen = false;
        s.x.forEach((x, i) => {
          const y = s.y[i];
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            pen = false;
            return;
          }
          const X = view.sx(x), Y = view.sy(y);
          if (!pen) ctx.moveTo(X, Y);
          else if (s.type === 'stairs') {
            ctx.lineTo(X, view.sy(s.y[i - 1]));
            ctx.lineTo(X, Y);
          } else ctx.lineTo(X, Y);
          pen = true;
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (s.label) drawLabel(ctx, s.label, 14, 40 + 18 * k, color, theme, 13);
    });
    if (fig.title) drawLabel(ctx, fig.title, 14, 18, theme.text, theme, 14);
    if (fig.xlabel) drawLabel(ctx, fig.xlabel, view.width - 14, view.height - 16, theme.textDim, theme, 13, 'right');
    if (fig.ylabel) drawLabel(ctx, fig.ylabel, 14, view.height / 2, theme.textDim, theme, 13);
  },
});

// R plots (webR): PNG images fitted into the canvas
const images = new Map<string, HTMLImageElement>();
registerDrawer2D('rplot', {
  layer: 9,
  draw(a) {
    const src = a.item.visual.props.src as string;
    let img = images.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => a.ws.emit('view');
      img.src = src;
      images.set(src, img);
      if (images.size > 40) images.delete(images.keys().next().value!);
    }
    if (!img.complete || !img.width) return;
    const { ctx, view } = a;
    const k = Math.min((view.width * 0.96) / img.width, (view.height * 0.96) / img.height);
    const w = img.width * k;
    const h = img.height * k;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect((view.width - w) / 2, (view.height - h) / 2, w, h);
    ctx.drawImage(img, (view.width - w) / 2, (view.height - h) / 2, w, h);
  },
});