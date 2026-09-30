/** Canvas helpers shared by 2D drawers. */
import type { Theme } from '../../visualization/theme';
import { MATH_FONT } from '../../visualization/theme';

export function drawArrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, width = 2.5, head = 11) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  if (len < 1) return;
  const ux = dx / len;
  const uy = dy / len;
  const h = Math.min(head, len * 0.6);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - ux * h * 0.8, y1 - uy * h * 0.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * h - uy * h * 0.45, y1 - uy * h + ux * h * 0.45);
  ctx.lineTo(x1 - ux * h + uy * h * 0.45, y1 - uy * h - ux * h * 0.45);
  ctx.closePath();
  ctx.fill();
}

/** Italic math label with a halo so it stays readable over the heat map. */
export function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, theme: Theme, size = 15, align: CanvasTextAlign = 'left') {
  ctx.font = `italic ${size}px ${MATH_FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = theme.labelBg;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export function strokeSegments(ctx: CanvasRenderingContext2D, segs: Float32Array, sx: (x: number) => number, sy: (y: number) => number) {
  ctx.beginPath();
  for (let k = 0; k < segs.length; k += 4) {
    ctx.moveTo(sx(segs[k]), sy(segs[k + 1]));
    ctx.lineTo(sx(segs[k + 2]), sy(segs[k + 3]));
  }
  ctx.stroke();
}

/** Plain-text name for a label: strips LaTeX commands (\\nabla f → ∇f). */
export function plainLabel(s: string | undefined): string {
  if (!s) return '';
  return s
    .replace(/\\nabla\s*/g, '∇')
    .replace(/\\theta/g, 'θ')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/_/g, '');
}
