/**
 * The polar picture at a point P: the ray and the circle through P, the moving basis e_r, e_θ, the
 * gradient split into f_r e_r + (1/r) f_θ e_θ (head to tail, adding up to ∇f), and the arc that
 * explains the 1/r: turning by dθ at radius r covers ds = r dθ.
 */
import { registerDrawer2D } from '../../visualization/2d/registry2d';
import { registerFrameHint } from '../../visualization/sampling';
import { withAlpha } from '../../visualization/colormap';
import { drawArrow, drawLabel } from './draw-util';

const C_R = '#4cc9f0';
const C_T = '#f4a261';
const C_G = '#ffd166';
const n3 = (x: number) => String(+x.toPrecision(3));

registerFrameHint('polarbasis', (p) => {
  const r = p.r as number;
  const R = Math.max(2, Math.ceil(r * 1.6 * 2) / 2);
  return { r: R, dim: 2 };
});

registerDrawer2D('polarbasis', {
  layer: 5,
  draw(a) {
    const { at, r, theta, fr, fth } = a.item.visual.props as { at: number[]; r: number; theta: number; fr: number; fth: number };
    const { ctx, view, theme } = a;
    const [px, py] = at;
    const span = Math.min(view.xRange[1] - view.xRange[0], view.yRange[1] - view.yRange[0]);
    const L = span * 0.13;
    const er = [Math.cos(theta), Math.sin(theta)];
    const et = [-Math.sin(theta), Math.cos(theta)];
    const S = (x: number, y: number): [number, number] => [view.sx(x), view.sy(y)];
    // the ray and the circle through P: the two polar coordinate lines
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = withAlpha(C_R, 0.55);
    ctx.beginPath();
    ctx.moveTo(...S(0, 0));
    ctx.lineTo(...S(er[0] * (r + 1.5 * L), er[1] * (r + 1.5 * L)));
    ctx.stroke();
    ctx.strokeStyle = withAlpha(C_T, 0.55);
    ctx.beginPath();
    for (let k = 0; k <= 180; k++) {
      const t = (2 * Math.PI * k) / 180;
      const [x, y] = S(r * Math.cos(t), r * Math.sin(t));
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
    // the arc ds = r dθ and the angle dθ at the origin
    const dth = Math.min(0.45, (1.6 * L) / Math.max(r, 1e-9));
    ctx.strokeStyle = withAlpha(C_T, 0.95);
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let k = 0; k <= 24; k++) {
      const t = theta + (dth * k) / 24;
      const [x, y] = S(r * Math.cos(t), r * Math.sin(t));
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(theme.text, 0.35);
    ctx.beginPath();
    ctx.moveTo(...S(0, 0));
    ctx.lineTo(...S(r * Math.cos(theta + dth), r * Math.sin(theta + dth)));
    ctx.stroke();
    const rho = Math.min(r * 0.35, L);
    ctx.beginPath();
    for (let k = 0; k <= 16; k++) {
      const t = theta + (dth * k) / 16;
      const [x, y] = S(rho * Math.cos(t), rho * Math.sin(t));
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    const mid = theta + dth / 2;
    drawLabel(ctx, 'dθ', ...S((rho + L * 0.35) * Math.cos(mid), (rho + L * 0.35) * Math.sin(mid)), theme.textDim, theme, 13, 'center');
    drawLabel(ctx, 'ds = r dθ', ...S((r + L * 0.45) * Math.cos(mid), (r + L * 0.45) * Math.sin(mid)), C_T, theme, 13, 'center');
    // the moving basis at P
    const [sx, sy] = S(px, py);
    drawArrow(ctx, sx, sy, ...S(px + L * er[0], py + L * er[1]), C_R, 2.4);
    drawArrow(ctx, sx, sy, ...S(px + L * et[0], py + L * et[1]), C_T, 2.4);
    drawLabel(ctx, 'e_r', ...S(px + L * 1.18 * er[0], py + L * 1.18 * er[1]), C_R, theme, 15, 'center');
    drawLabel(ctx, 'e_θ', ...S(px + L * 1.2 * et[0], py + L * 1.2 * et[1]), C_T, theme, 15, 'center');
    // ∇f = f_r e_r + (1/r) f_θ e_θ, the parts head to tail
    const gr = fr, gt = fth / r;
    const mag = Math.hypot(gr, gt);
    if (mag > 1e-12) {
      const k = (1.9 * L) / mag;
      const p1 = [px + k * gr * er[0], py + k * gr * er[1]];
      const p2 = [p1[0] + k * gt * et[0], p1[1] + k * gt * et[1]];
      ctx.save();
      ctx.globalAlpha *= 0.9;
      if (Math.abs(gr) * k > 1e-6 * L) drawArrow(ctx, sx, sy, ...S(p1[0], p1[1]), withAlpha(C_R, 0.85), 2, 9);
      if (Math.abs(gt) * k > 1e-6 * L) drawArrow(ctx, ...S(p1[0], p1[1]), ...S(p2[0], p2[1]), withAlpha(C_T, 0.85), 2, 9);
      ctx.restore();
      drawArrow(ctx, sx, sy, ...S(p2[0], p2[1]), C_G, 3.2, 12);
      drawLabel(ctx, '∇f', ...S(p2[0] + 0.25 * L * (p2[0] - px) / (k * mag), p2[1] + 0.25 * L * (p2[1] - py) / (k * mag)), C_G, theme, 16, 'center');
      if (Math.abs(gr) * k > 0.15 * L) drawLabel(ctx, `f_r e_r`, ...S((px + p1[0]) / 2 + 0.22 * L * et[0], (py + p1[1]) / 2 + 0.22 * L * et[1]), C_R, theme, 12, 'center');
      if (Math.abs(gt) * k > 0.15 * L) drawLabel(ctx, `(1/r) f_θ e_θ`, ...S((p1[0] + p2[0]) / 2 + 0.3 * L * er[0], (p1[1] + p2[1]) / 2 + 0.3 * L * er[1]), C_T, theme, 12, 'center');
    }
    // the numbers
    const lines = [
      `r = ${n3(r)},  θ = ${n3(theta)}`,
      `f_r = ${n3(fr)},  f_θ = ${n3(fth)}`,
      `∇f = ${n3(gr)} e_r + ${n3(gt)} e_θ   ((1/r) f_θ = ${n3(fth)}/${n3(r)})`,
      Math.abs(fth) < 1e-9 * Math.max(1, Math.abs(fr)) ? 'f_θ = 0: ∇f points along e_r, perpendicular to the circle' : '',
    ].filter(Boolean);
    lines.forEach((t, i) => drawLabel(ctx, t, 14, 22 + i * 19, i === 2 ? C_G : theme.text, theme, 13));
  },
});