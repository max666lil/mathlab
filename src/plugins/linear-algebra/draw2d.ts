/**
 * 2-D drawers of linear algebra: the transformation grid (3Blue1Brown style), eigen-lines and
 * subspaces. Everything moves with the matrix's timeline M(t).
 */
import { registerDrawer2D, Draw2DArgs } from '../../visualization/2d/registry2d';
import { drawArrow, drawLabel } from '../core-calculus/draw-util';
import { withAlpha } from '../../visualization/colormap';
import { formatNumber } from '../../math-core/symbolic/print';
import { MathValue, MatrixValue, VectorValue } from '../../math-core/values';
import { LinTransProps, matrixAt, apply, det2 } from './lintrans';
import type { EigenValue, SubspaceValue } from './values';

export const LA_COLORS = {
  grid: '#3fa9f5',
  axis: '#dfe6f3',
  i: '#83c167',
  j: '#fc6255',
  k: '#58c4dd',
  cell: '#f7d96f',
  vector: '#ffd166',
  eigen: '#c792ea',
  nullspace: '#ff6b6b',
  colspace: '#4cc9f0',
};

function inv2(M: number[][]): number[][] | null {
  const d = det2(M);
  if (Math.abs(d) < 1e-9) return null;
  return [[M[1][1] / d, -M[0][1] / d], [-M[1][0] / d, M[0][0] / d]];
}

/** Lines of the transformed grid covering the view: preimage box of the viewport under M. */
function drawGrid(a: Draw2DArgs, M: number[][]) {
  const { ctx, view } = a;
  const [x0, x1] = view.xRange;
  const [y0, y1] = view.yRange;
  const Mi = inv2(M);
  let lo = [-40, -40];
  let hi = [40, 40];
  if (Mi) {
    const pre = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map((c) => apply(Mi, c));
    lo = [Math.min(...pre.map((p) => p[0])), Math.min(...pre.map((p) => p[1]))];
    hi = [Math.max(...pre.map((p) => p[0])), Math.max(...pre.map((p) => p[1]))];
  }
  const cap = (v: number) => Math.max(-60, Math.min(60, v));
  const line = (p: number[], q: number[]) => {
    const P = apply(M, p);
    const Q = apply(M, q);
    ctx.moveTo(view.sx(P[0]), view.sy(P[1]));
    ctx.lineTo(view.sx(Q[0]), view.sy(Q[1]));
  };
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = withAlpha(LA_COLORS.grid, 0.75);
  ctx.beginPath();
  for (let k = Math.floor(cap(lo[0])); k <= Math.ceil(cap(hi[0])); k++) if (k !== 0) line([k, cap(lo[1]) - 1], [k, cap(hi[1]) + 1]);
  for (let k = Math.floor(cap(lo[1])); k <= Math.ceil(cap(hi[1])); k++) if (k !== 0) line([cap(lo[0]) - 1, k], [cap(hi[0]) + 1, k]);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = withAlpha(LA_COLORS.axis, 0.9);
  ctx.beginPath();
  line([0, cap(lo[1]) - 1], [0, cap(hi[1]) + 1]);
  line([cap(lo[0]) - 1, 0], [cap(hi[0]) + 1, 0]);
  ctx.stroke();
}

registerDrawer2D('lintrans', {
  layer: 1,
  draw(a) {
    const p = a.item.visual.props as unknown as LinTransProps;
    if (p.n !== 2) return;
    const { ctx, view, theme } = a;
    const end = p.stages.length;
    const t = a.timeline(p.timeline, end);
    const M = matrixAt(p, t);
    drawGrid(a, M);

    // unit square → parallelogram, area = |det M(t)|
    const o = [view.sx(0), view.sy(0)];
    const i = apply(M, [1, 0]);
    const j = apply(M, [0, 1]);
    const ij = apply(M, [1, 1]);
    const d = det2(M);
    ctx.beginPath();
    ctx.moveTo(o[0], o[1]);
    ctx.lineTo(view.sx(i[0]), view.sy(i[1]));
    ctx.lineTo(view.sx(ij[0]), view.sy(ij[1]));
    ctx.lineTo(view.sx(j[0]), view.sy(j[1]));
    ctx.closePath();
    ctx.fillStyle = withAlpha(d < 0 ? LA_COLORS.j : LA_COLORS.cell, 0.28);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = withAlpha(LA_COLORS.cell, 0.9);
    ctx.stroke();
    const c = [view.sx(ij[0] / 2), view.sy(ij[1] / 2)];
    const area = Math.abs(d) < 5e-4 ? '0' : formatNumber(Math.abs(d), 3);
    drawLabel(ctx, `area × ${area}${d < -5e-4 ? ' (flipped)' : ''}`, c[0], c[1] + 5, LA_COLORS.cell, theme, 13, 'center');

    // basis vectors î, ĵ land on the columns
    drawArrow(ctx, o[0], o[1], view.sx(i[0]), view.sy(i[1]), LA_COLORS.i, 3.2, 12);
    drawArrow(ctx, o[0], o[1], view.sx(j[0]), view.sy(j[1]), LA_COLORS.j, 3.2, 12);
    const tag = (v: number[], s: string, color: string) => {
      const len = Math.hypot(v[0], v[1]) || 1;
      drawLabel(ctx, s, view.sx(v[0] + (v[0] / len) * 0.28), view.sy(v[1] + (v[1] / len) * 0.28) + 5, color, theme, 16, 'center');
    };
    tag(i, 'î', LA_COLORS.i);
    tag(j, 'ĵ', LA_COLORS.j);
    a.hits.push({ itemId: a.item.id, pts: [0, 0, i[0], i[1]] }, { itemId: a.item.id, pts: [0, 0, j[0], j[1]] });

    // drag î / ĵ (at the end state): reshape the matrix — the worksheet follows
    if (p.sourceId && Math.abs(t - end) < 1e-6 && p.stages.length === 1 && a.ws.graph.has(p.sourceId)) {
      const src = p.sourceId;
      const solvable = [...a.ws.graph.ancestors(src), src].some((id) => a.ws.statement(id)?.input);
      if (solvable)
        [0, 1].forEach((col) => {
          const tip = col === 0 ? i : j;
          a.handles.push({
            x: tip[0], y: tip[1], r: 13, itemId: a.item.id, nodeId: src, cursor: 'grab',
            drag: ([wx, wy], mods) => {
              const snap = (x: number) => (mods.shift ? x : Math.round(x * 4) / 4);
              a.holdTimeline(p.timeline, end);
              a.ws.solveFor(src, [snap(wx), snap(wy)], (v: MathValue) => (v.kind === 'matrix' ? (v as MatrixValue).rows.map((r) => r[col]) : undefined));
            },
          });
        });
    }

    // tracked vectors ride along: v at t = 0, A v at the end
    for (const v of p.vectors) {
      if (v.comps.length !== 2) continue;
      const w = apply(M, v.comps);
      drawArrow(ctx, o[0], o[1], view.sx(w[0]), view.sy(w[1]), LA_COLORS.vector, 2.8, 11);
      const label = t < end / 2 ? v.label : `${p.name}${v.label}`;
      tag(w, label, LA_COLORS.vector);
      a.hits.push({ itemId: a.item.id, pts: [0, 0, w[0], w[1]] });
      if (v.sourceId && a.ws.graph.has(v.sourceId)) {
        const src = v.sourceId;
        a.handles.push({
          x: w[0], y: w[1], r: 12, itemId: a.item.id, nodeId: src, cursor: 'grab',
          drag: ([wx, wy]) => {
            a.ws.solveFor(src, [wx, wy], (val: MathValue) => (val.kind === 'vector' ? apply(M, (val as VectorValue).comps) : undefined));
          },
        });
      }
    }
  },
});

/** Extend a line through the origin across the view. */
function fullLine(a: Draw2DArgs, dir: number[]) {
  const R = 4 * Math.max(Math.abs(a.view.xRange[0]), Math.abs(a.view.xRange[1]), Math.abs(a.view.yRange[0]), Math.abs(a.view.yRange[1]));
  const l = Math.hypot(dir[0], dir[1]) || 1;
  const u = [(dir[0] / l) * R, (dir[1] / l) * R];
  a.ctx.beginPath();
  a.ctx.moveTo(a.view.sx(-u[0]), a.view.sy(-u[1]));
  a.ctx.lineTo(a.view.sx(u[0]), a.view.sy(u[1]));
  a.ctx.stroke();
}

registerDrawer2D('eigenlines', {
  layer: 2,
  draw(a) {
    const { e, timeline } = a.item.visual.props as { e: EigenValue; timeline?: string };
    if (e.n !== 2 || !e.matrix) return;
    const { ctx, view, theme } = a;
    const props = { stages: [e.matrix as number[][]], n: 2 } as LinTransProps;
    const t = timeline ? a.timeline(timeline, 1) : 1;
    const M = matrixAt(props, t);
    const color = a.item.color;
    for (const pair of e.pairs) {
      if (pair.im !== 0) continue;
      for (const b of pair.basis) {
        ctx.setLineDash([7, 6]);
        ctx.lineWidth = a.selected ? 2.4 : 1.6;
        ctx.strokeStyle = withAlpha(color, 0.9);
        fullLine(a, b);
        ctx.setLineDash([]);
        // vectors on the eigen-line only stretch (by λ) — they never leave the line
        const l = Math.hypot(b[0], b[1]) || 1;
        for (const s of [-2, -1, 1, 2]) {
          const w = apply(M, [(b[0] / l) * s, (b[1] / l) * s]);
          drawArrow(ctx, view.sx(0), view.sy(0), view.sx(w[0]), view.sy(w[1]), withAlpha(color, 0.85), 2, 9);
        }
        const tip = apply(M, [(b[0] / l) * 2, (b[1] / l) * 2]);
        drawLabel(ctx, `λ = ${formatNumber(pair.re, 3)}`, view.sx(tip[0]) + 8, view.sy(tip[1]) - 8, color, theme, 13);
      }
    }
  },
});

registerDrawer2D('subspace', {
  layer: 2,
  draw(a) {
    const { s, timeline } = a.item.visual.props as { s: SubspaceValue; timeline?: string };
    if (s.ambient !== 2) return;
    const { ctx, view } = a;
    const color = a.item.color;
    if (s.basis.length === 0) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(view.sx(0), view.sy(0), 5, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (s.basis.length >= 2) return; // all of ℝ²
    const b = s.basis[0];
    const M = s.matrix && timeline && s.role === 'nullspace' ? matrixAt({ stages: [s.matrix as number[][]], n: 2 } as LinTransProps, a.timeline(timeline, 1)) : null;
    if (!M) {
      ctx.lineWidth = a.selected ? 3 : 2.2;
      ctx.strokeStyle = withAlpha(color, 0.9);
      fullLine(a, b);
      a.hits.push({ itemId: a.item.id, pts: [-b[0] * 50, -b[1] * 50, b[0] * 50, b[1] * 50] });
      return;
    }
    // null space: the whole line is squashed onto the origin as t → end
    const l = Math.hypot(b[0], b[1]) || 1;
    ctx.fillStyle = color;
    for (let k = -12; k <= 12; k++) {
      const w = apply(M, [(b[0] / l) * k * 0.5, (b[1] / l) * k * 0.5]);
      ctx.beginPath();
      ctx.arc(view.sx(w[0]), view.sy(w[1]), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    const tip = apply(M, [(b[0] / l) * 2, (b[1] / l) * 2]);
    drawLabel(ctx, 'null space', view.sx(tip[0]) + 8, view.sy(tip[1]) - 8, color, a.theme, 13);
  },
});