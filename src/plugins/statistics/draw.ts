/** Drawers of Phase 5: pmf bars / pdf curves with a shaded event, cdfs, simulated histograms, the CLT. */
import { registerDrawer2D, Draw2DArgs } from '../../visualization/2d/registry2d';
import { registerFrameHint } from '../../visualization/sampling';
import { withAlpha } from '../../visualization/colormap';
import { drawLabel } from '../core-calculus/draw-util';
import { quantileOf, normal } from '../../math-core/distributions';
import type { DistributionValue } from './random';

type Box = [number, number][];

/** x-range of a distribution: its support or the 0.1% / 99.9% quantiles. */
function xRange(X: DistributionValue): [number, number] {
  const d = X.dist;
  let a = Number.isFinite(d.lo) ? d.lo : quantileOf(d, 0.001);
  let b = Number.isFinite(d.hi) ? d.hi : quantileOf(d, 0.999);
  if (!Number.isFinite(b) || b - a > 1e6) b = quantileOf(d, 0.995);
  if (!Number.isFinite(a)) a = quantileOf(d, 0.005);
  if (X.discrete) return [a - 0.8, b + 0.8];
  const pad = (b - a) * 0.05 || 1;
  return [a - pad, b + pad];
}

function peak(X: DistributionValue): number {
  const [a, b] = xRange(X);
  let m = 0;
  if (X.discrete) for (let k = Math.ceil(a); k <= b; k++) m = Math.max(m, X.dist.pdf(k));
  else for (let i = 0; i <= 400; i++) {
    const v = X.dist.pdf(a + ((b - a) * i) / 400);
    if (Number.isFinite(v)) m = Math.max(m, v);
  }
  return Math.min(m, 50) || 1;
}

const distBox = (X: DistributionValue): Box => [xRange(X), [0, peak(X) * 1.15]];
registerFrameHint('distplot', (p) => ({ r: 1, dim: 2, box: distBox(p.dist as DistributionValue), free: true }));
registerFrameHint('cdfplot', (p) => ({ r: 1, dim: 2, box: [xRange(p.dist as DistributionValue), [0, 1.08]], free: true }));
registerFrameHint('samplehist', (p) => ({ r: 1, dim: 2, box: distBox(p.dist as DistributionValue), free: true }));
registerFrameHint('cltplot', (p) => {
  const X = p.dist as DistributionValue;
  const sd = Math.sqrt(X.dist.variance);
  const box: Box = [xRange(X), [0, Math.max(peak(X), 1 / (sd * Math.sqrt(2 * Math.PI) / Math.sqrt(30))) * 1.1]];
  return { r: 1, dim: 2, box, free: true };
});

function densityCurve(a: Draw2DArgs, X: DistributionValue, color: string, width: number) {
  const { ctx, view } = a;
  const [x0, x1] = view.xRange;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i <= 600; i++) {
    const x = x0 + ((x1 - x0) * i) / 600;
    const y = X.dist.pdf(x);
    if (!Number.isFinite(y)) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(view.sx(x), view.sy(y));
    else ctx.moveTo(view.sx(x), view.sy(y));
    pen = true;
  }
  ctx.stroke();
}

function bars(a: Draw2DArgs, X: DistributionValue, color: string, shade?: [number, number]) {
  const { ctx, view } = a;
  const [x0, x1] = view.xRange;
  for (let k = Math.ceil(Math.max(x0, X.dist.lo)); k <= Math.min(x1, X.dist.hi); k++) {
    const p = X.dist.pdf(k);
    if (!(p > 1e-12)) continue;
    const inside = shade && k >= shade[0] - 1e-9 && k <= shade[1] + 1e-9;
    ctx.fillStyle = withAlpha(inside ? '#ffd166' : color, inside ? 0.85 : 0.6);
    const w = Math.max(2, (view.sx(k + 0.4) - view.sx(k - 0.4)));
    ctx.fillRect(view.sx(k) - w / 2, view.sy(p), w, view.sy(0) - view.sy(p));
  }
}

registerDrawer2D('distplot', {
  layer: 2,
  draw(a) {
    const { dist: X, shade, sname } = a.item.visual.props as { dist: DistributionValue; shade?: [number, number]; sname?: string };
    const { ctx, view, theme } = a;
    if (X.discrete) bars(a, X, a.item.color, shade);
    else {
      if (shade) {
        const lo = Math.max(shade[0], view.xRange[0]);
        const hi = Math.min(shade[1], view.xRange[1]);
        if (hi > lo) {
          ctx.fillStyle = withAlpha('#ffd166', 0.45);
          ctx.beginPath();
          ctx.moveTo(view.sx(lo), view.sy(0));
          for (let i = 0; i <= 200; i++) {
            const x = lo + ((hi - lo) * i) / 200;
            const y = X.dist.pdf(x);
            ctx.lineTo(view.sx(x), view.sy(Number.isFinite(y) ? y : 0));
          }
          ctx.lineTo(view.sx(hi), view.sy(0));
          ctx.closePath();
          ctx.fill();
        }
      }
      densityCurve(a, X, a.item.color, a.selected ? 3 : 2.4);
    }
    const mean = X.dist.mean;
    if (Number.isFinite(mean)) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = withAlpha(theme.text, 0.55);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(view.sx(mean), view.sy(0));
      ctx.lineTo(view.sx(mean), view.sy(view.yRange[1] * 0.92));
      ctx.stroke();
      ctx.setLineDash([]);
      drawLabel(ctx, `E(${sname ?? 'X'}) = ${+mean.toPrecision(4)}`, view.sx(mean) + 6, view.sy(view.yRange[1] * 0.9), theme.textDim, theme, 12);
    }
  },
});

registerDrawer2D('cdfplot', {
  layer: 2,
  draw(a) {
    const X = (a.item.visual.props as { dist: DistributionValue }).dist;
    const { ctx, view } = a;
    const [x0, x1] = view.xRange;
    ctx.strokeStyle = a.item.color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    if (X.discrete) {
      // a step function: jumps at the support points
      let prev = X.dist.cdf(x0);
      ctx.moveTo(view.sx(x0), view.sy(prev));
      for (let k = Math.ceil(x0); k <= x1; k++) {
        const F = X.dist.cdf(k);
        ctx.lineTo(view.sx(k), view.sy(prev));
        ctx.moveTo(view.sx(k), view.sy(F));
        prev = F;
      }
      ctx.lineTo(view.sx(x1), view.sy(prev));
    } else
      for (let i = 0; i <= 500; i++) {
        const x = x0 + ((x1 - x0) * i) / 500;
        const y = X.dist.cdf(x);
        if (i === 0) ctx.moveTo(view.sx(x), view.sy(y));
        else ctx.lineTo(view.sx(x), view.sy(y));
      }
    ctx.stroke();
  },
});

function histogram(a: Draw2DArgs, xs: number[], discrete: boolean, color: string) {
  const { ctx, view } = a;
  const n = xs.length;
  if (!n) return;
  if (discrete) {
    const counts = new Map<number, number>();
    for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
    ctx.fillStyle = withAlpha(color, 0.35);
    ctx.strokeStyle = withAlpha(color, 0.9);
    for (const [k, c] of counts) {
      const p = c / n;
      const X0 = view.sx(k - 0.45);
      const X1 = view.sx(k + 0.45);
      ctx.fillRect(X0, view.sy(p), X1 - X0, view.sy(0) - view.sy(p));
      ctx.strokeRect(X0, view.sy(p), X1 - X0, view.sy(0) - view.sy(p));
    }
    return;
  }
  const s = [...xs].sort((p, q) => p - q);
  const lo = Math.max(s[Math.floor(n * 0.001)], view.xRange[0]);
  const hi = Math.min(s[Math.ceil(n * 0.999) - 1], view.xRange[1]);
  const k = Math.max(10, Math.min(60, Math.round(Math.sqrt(n))));
  const w = (hi - lo) / k || 1;
  const counts = new Array(k).fill(0);
  for (const x of s) if (x >= lo && x <= hi) counts[Math.min(k - 1, Math.floor((x - lo) / w))]++;
  ctx.fillStyle = withAlpha(color, 0.35);
  ctx.strokeStyle = withAlpha(color, 0.8);
  ctx.lineWidth = 1;
  counts.forEach((c, i) => {
    const d = c / (n * w);
    const X0 = view.sx(lo + i * w);
    const X1 = view.sx(lo + (i + 1) * w);
    ctx.fillRect(X0, view.sy(d), X1 - X0, view.sy(0) - view.sy(d));
    ctx.strokeRect(X0, view.sy(d), X1 - X0, view.sy(0) - view.sy(d));
  });
}

registerDrawer2D('samplehist', {
  layer: 1,
  draw(a) {
    const { dist: X, xs } = a.item.visual.props as { dist: DistributionValue; xs: number[] };
    histogram(a, xs, X.discrete, a.item.color);
    if (!X.discrete) densityCurve(a, X, '#ffd166', 2);
    drawLabel(a.ctx, `n = ${xs.length} simulated draws`, 14, 18, a.theme.text, a.theme, 13);
  },
});

registerDrawer2D('cltplot', {
  layer: 1,
  draw(a) {
    const { dist: X, means, ns, timeline } = a.item.visual.props as { dist: DistributionValue; means: number[][]; ns: number[]; timeline: string };
    const level = Math.max(0, Math.min(ns.length - 1, Math.round(a.timeline(timeline, ns.length - 1))));
    const n = ns[level];
    histogram(a, means[level], X.discrete && n === 1, a.item.color);
    // the normal approximation N(μ, σ/√n)
    const approx = { ...X, discrete: false, dist: normal(X.dist.mean, Math.sqrt(X.dist.variance / n)) } as DistributionValue;
    densityCurve(a, approx, '#ffd166', 2.2);
    drawLabel(a.ctx, `sample means, n = ${n}   (curve: N(μ, σ/√n))`, 14, 18, a.theme.text, a.theme, 13);
  },
});