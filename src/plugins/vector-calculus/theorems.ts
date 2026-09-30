/**
 * Stokes' theorem (∮_∂S F·dr = ∬_S curl F·dS) and the divergence theorem (∯_S F·dS = ∭_V div F dV)
 * for parametric surfaces, as typed theorem checks with both sides computed independently.
 */
import { Builtin, EvalContext, EvalError } from '../../math-core/builtins';
import type { Expr } from '../../math-core/ast';
import { FunctionValue, MathValue } from '../../math-core/values';
import { surfaceRanges } from '../../math-core/ranges';
import { visual } from '../../visualization/scene-model';
import { expectField, curlExprs, divExpr } from './math';
import { expectSurface, closedSurface, normalFn, surfaceIntegral, orientation, rectIntegral } from './surfaces';
import type { TheoremValue } from './green';

const GL8 = { x: [-0.9602898564975363, -0.7966664774136267, -0.525532409916329, -0.1834346424956498, 0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363], w: [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362, 0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763] };

type S2 = (u: number, v: number) => number[];
type F3 = (...p: number[]) => number[];

const nameOf = (e: Expr | undefined, fb: string) => (e?.type === 'sym' ? e.name : fb);

/** Edges of the parameter rectangle that form the boundary of S (not collapsed poles, not glued seams). */
export function boundaryEdges(S: FunctionValue): { from: [number, number]; to: [number, number] }[] {
  const [[u0, u1], [v0, v1]] = surfaceRanges(S);
  const f = S.eval as S2;
  const same = (p: number[], q: number[]) => p.every((c, i) => Math.abs(c - q[i]) < 1e-7 * (1 + Math.abs(c)));
  const pts = (a: [number, number], b: [number, number]) => Array.from({ length: 9 }, (_, k) => f(a[0] + ((b[0] - a[0]) * k) / 8, a[1] + ((b[1] - a[1]) * k) / 8));
  // counter-clockwise around the rectangle: with N = S_u × S_v this is the right-hand orientation of ∂S
  const edges: { from: [number, number]; to: [number, number] }[] = [
    { from: [u0, v0], to: [u1, v0] },
    { from: [u1, v0], to: [u1, v1] },
    { from: [u1, v1], to: [u0, v1] },
    { from: [u0, v1], to: [u0, v0] },
  ];
  const sample = edges.map((e) => pts(e.from, e.to));
  return edges.filter((_, i) => {
    const e = sample[i];
    if (e.every((p) => same(p, e[0]))) return false; // a pole
    const opp = sample[(i + 2) % 4].slice().reverse(); // the opposite edge, traversed the same way
    return !e.every((p, k) => same(p, opp[k])); // a seam glued to the opposite edge cancels
  });
}

function circulationOnEdges(F: F3, S: FunctionValue, edges: { from: [number, number]; to: [number, number] }[], panels = 64): number {
  const f = S.eval as S2;
  let total = 0;
  for (const { from, to } of edges) {
    const h = 1 / panels;
    for (let k = 0; k < panels; k++) {
      for (let i = 0; i < 8; i++) {
        const s = (k + 0.5 + GL8.x[i] / 2) * h;
        const u = from[0] + (to[0] - from[0]) * s;
        const v = from[1] + (to[1] - from[1]) * s;
        const d = 1e-6;
        const p = f(u, v);
        const q = f(u + (to[0] - from[0]) * d, v + (to[1] - from[1]) * d);
        const tangent = q.map((c, j) => (c - p[j]) / d); // dS/ds
        const val = F(...p);
        if (val.every(Number.isFinite)) total += GL8.w[i] * (h / 2) * (val[0] * tangent[0] + val[1] * tangent[1] + val[2] * tangent[2]);
      }
    }
  }
  return total;
}

export const theoremBuiltins: Builtin[] = [
  {
    name: 'stokes', command: true, minArgs: 1, maxArgs: 2, argModes: ['function', 'value'], keywords: { on: 'value' }, category: 'vector calculus', signature: 'stokes F on S',
    doc: "Stokes' theorem check: circulation around the boundary of S and the flux of curl F through S.",
    apply: ([Fv, s], ctx: EvalContext, raw, kw) => {
      const F = expectField(Fv);
      const S = expectSurface(kw.values.on ?? s);
      if (F.params.length !== 3) throw new EvalError("Stokes' theorem needs a field F(x, y, z)");
      const nF = nameOf(raw[0], 'F');
      const nS = nameOf(kw.raw.on ?? raw[1], 'S');
      const edges = boundaryEdges(S);
      const lhs = edges.length ? circulationOnEdges(F.eval as F3, S, edges) : 0;
      // ∬ curl F · (S_u × S_v) — the parametrisation's orientation, matching the boundary direction
      const curl = ctx.makeFunction({ type: 'vec', items: curlExprs(F) }, F.params, { env: F.env }).eval as F3;
      const f = S.eval as S2;
      const sign = orientation(ctx, S);
      const N = normalFn(ctx, S).eval as S2;
      const r = surfaceIntegral((u, v) => {
        const c = curl(...f(u, v));
        const n = N(u, v).map((x) => x * sign); // undo outward re-orientation: use S_u × S_v
        return c[0] * n[0] + c[1] * n[1] + c[2] * n[2];
      }, S);
      const holds = Math.abs(lhs - r.value) <= 1e-4 * Math.max(1, Math.abs(r.value)) + 5 * r.error;
      const th: TheoremValue = {
        kind: 'theorem', name: "Stokes' theorem",
        lhsLatex: `\\oint_{\\partial ${nS}} ${nF}\\cdot d\\mathbf{r}`,
        rhsLatex: `\\iint_{${nS}} (\\nabla\\times ${nF})\\cdot d\\mathbf{S}`,
        lhs: Math.abs(lhs) < 1e-10 ? 0 : lhs, rhs: Math.abs(r.value) < 1e-10 ? 0 : r.value, holds, certainty: 'numeric',
        evidence: edges.length ? `boundary: ${edges.length} edge${edges.length === 1 ? '' : 's'} of the parameter rectangle (poles and seams removed); orientation from S_u × S_v` : 'closed surface: no boundary, so the circulation is 0',
        key: `stokes|${F.key}|${S.key}`,
        visuals: [visual('surfaceboundary', { S, edges }, 'boundary ∂S', 'boundary') as MathValue as never],
      };
      return th as unknown as MathValue;
    },
  },
  {
    name: 'gauss', command: true, minArgs: 1, maxArgs: 2, argModes: ['function', 'value'], keywords: { on: 'value' }, category: 'vector calculus', signature: 'gauss F on S',
    doc: 'Divergence theorem check: outward flux through the closed surface S and ∭ div F dV over the solid inside.',
    apply: ([Fv, s], ctx: EvalContext, raw, kw) => {
      const F = expectField(Fv);
      const S = expectSurface(kw.values.on ?? s);
      if (F.params.length !== 3) throw new EvalError('the divergence theorem needs a field F(x, y, z)');
      if (!closedSurface(S)) throw new EvalError('S must be a closed surface (use stokes F on S for surfaces with a boundary)');
      const nF = nameOf(raw[0], 'F');
      const nS = nameOf(kw.raw.on ?? raw[1], 'S');
      const f = S.eval as S2;
      const N = normalFn(ctx, S).eval as S2; // outward
      const Fe = F.eval as F3;
      const flux = surfaceIntegral((u, v) => {
        const a = Fe(...f(u, v));
        const n = N(u, v);
        return a[0] * n[0] + a[1] * n[1] + a[2] * n[2];
      }, S);
      // the solid as a cone from the centre: x = c + r (S − c), dV = r² (S − c)·N dr du dv (star-shaped solids)
      const [ur, vr] = surfaceRanges(S);
      const cs: number[][] = [];
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) cs.push(f(ur[0] + ((ur[1] - ur[0]) * (i + 0.5)) / 8, vr[0] + ((vr[1] - vr[0]) * (j + 0.5)) / 8));
      const c = [0, 1, 2].map((k) => cs.reduce((t, p) => t + p[k], 0) / cs.length);
      const star = cs.every((_, k) => {
        const i = Math.floor(k / 8), j = k % 8;
        const u = ur[0] + ((ur[1] - ur[0]) * (i + 0.5)) / 8, v = vr[0] + ((vr[1] - vr[0]) * (j + 0.5)) / 8;
        const p = f(u, v);
        const n = N(u, v);
        return n.reduce((t, x, q) => t + x * (p[q] - c[q]), 0) >= -1e-9;
      });
      if (!star) throw new EvalError('the solid is not star-shaped about its centre — the volume integral is not available for this surface');
      const div = ctx.makeFunction(divExpr(F), F.params, { env: F.env }).eval as (...p: number[]) => number;
      const vol = (panels: number) =>
        rectIntegral((u, v) => {
          const p = f(u, v);
          const n = N(u, v);
          const w = [0, 1, 2].map((k) => p[k] - c[k]);
          const jac = w[0] * n[0] + w[1] * n[1] + w[2] * n[2];
          let s = 0;
          for (let i = 0; i < 8; i++) {
            const r = (GL8.x[i] + 1) / 2;
            const d = div(c[0] + r * w[0], c[1] + r * w[1], c[2] + r * w[2]);
            if (Number.isFinite(d)) s += (GL8.w[i] / 2) * d * r * r;
          }
          return s * jac;
        }, ur, vr, panels);
      const vc = vol(8);
      const vf = vol(16);
      const holds = Math.abs(flux.value - vf) <= 1e-4 * Math.max(1, Math.abs(vf)) + 5 * (flux.error + Math.abs(vf - vc));
      const th: TheoremValue = {
        kind: 'theorem', name: 'divergence theorem',
        lhsLatex: `\\oint\\!\\!\\oint_{${nS}} ${nF}\\cdot d\\mathbf{S}`,
        rhsLatex: `\\iiint_{V} \\nabla\\cdot ${nF}\\,dV`,
        lhs: flux.value, rhs: vf, holds, certainty: 'numeric',
        evidence: 'outward flux on the parameter rectangle; volume as a cone from the centre (star-shaped solid), Gauss–Legendre in r, u, v',
        key: `gauss|${F.key}|${S.key}`,
        visuals: [visual('fluxarrows', { F, S, sign: orientation(ctx, S) }, 'flux', 'flux') as MathValue as never],
      };
      return th as unknown as MathValue;
    },
  },
];

