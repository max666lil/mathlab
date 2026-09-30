/**
 * Green's theorem: ∮_C F·dr = ∬_D (∂Q/∂x − ∂P/∂y) dA for the region D inside a closed plane curve C.
 * The double integral uses a scan-line rule over the polygon of the sampled curve (Gauss–Legendre in x
 * and y, estimated by comparing two resolutions). The result is a typed theorem check with both sides.
 */
import { Builtin, EvalContext, EvalError } from '../../math-core/builtins';
import { Expr } from '../../math-core/ast';
import { FunctionValue, MathValue, Certainty } from '../../math-core/values';
import { curveRange } from '../../math-core/ranges';
import { visual } from '../../visualization/scene-model';
import { expectField, curlExprs } from './math';
import { expectCurve, closedOf, selfIntersecting } from './curves';
import { lineIntegral } from './integrals';

const GL8 = { x: [-0.9602898564975363, -0.7966664774136267, -0.525532409916329, -0.1834346424956498, 0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363], w: [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362, 0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763] };

/** The closed curve as a polygon. */
export function polygonOf(C: FunctionValue, n = 2400): number[][] {
  const [a, b] = curveRange(C);
  const g = C.eval as (t: number) => number[];
  const P: number[][] = [];
  for (let i = 0; i < n; i++) P.push(g(a + ((b - a) * i) / n));
  return P;
}

/** x-intervals where the horizontal line y = c is inside the polygon (even–odd rule). */
function spans(P: number[][], c: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    const q = P[(i + 1) % P.length];
    if ((p[1] <= c && q[1] > c) || (q[1] <= c && p[1] > c)) xs.push(p[0] + ((c - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
  }
  xs.sort((u, v) => u - v);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

/** ∬_D f dA over the polygon, with `panels` Gauss–Legendre panels in y. */
function scanIntegral(f: (x: number, y: number) => number, P: number[][], panels: number): number {
  const ys = P.map((p) => p[1]);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const h = (y1 - y0) / panels;
  let total = 0;
  for (let k = 0; k < panels; k++) {
    const mid = y0 + (k + 0.5) * h;
    for (let j = 0; j < 8; j++) {
      const y = mid + (GL8.x[j] * h) / 2;
      let row = 0;
      for (const [xa, xb] of spans(P, y)) {
        const c = (xa + xb) / 2;
        const r = (xb - xa) / 2;
        for (let i = 0; i < 8; i++) {
          const v = f(c + GL8.x[i] * r, y);
          if (Number.isFinite(v)) row += GL8.w[i] * v * r;
        }
      }
      total += (GL8.w[j] * h * row) / 2;
    }
  }
  return total;
}

export function regionIntegral(f: (x: number, y: number) => number, C: FunctionValue): { value: number; error: number } {
  const P = polygonOf(C);
  const coarse = scanIntegral(f, P, 60);
  const fine = scanIntegral(f, P, 120);
  return { value: fine, error: Math.abs(fine - coarse) };
}

export interface TheoremValue {
  kind: 'theorem';
  name: string;
  lhsLatex: string;
  rhsLatex: string;
  lhs: number;
  rhs: number;
  holds: boolean;
  certainty: Certainty;
  evidence: string;
  key: string;
  visuals?: MathValue[];
  [k: string]: unknown;
}

const nameOf = (e: Expr | undefined, fb: string) => (e?.type === 'sym' ? e.name : fb);

export const greenBuiltins: Builtin[] = [
  {
    name: 'green', command: true, minArgs: 1, maxArgs: 2, argModes: ['function', 'value'], keywords: { on: 'value' }, category: 'vector calculus', signature: 'green F on C',
    doc: "Green's theorem check: ∮_C F·dr and ∬_D curl F dA over the region inside the closed plane curve C.",
    apply: ([Fv, c], ctx: EvalContext, raw, kw) => {
      const F = expectField(Fv);
      const C = expectCurve(kw.values.on ?? c);
      if (F.params.length !== 2) throw new EvalError("Green's theorem is for plane fields F(x, y)");
      if (!closedOf(C)) throw new EvalError('C must be a closed curve');
      if (selfIntersecting(C)) throw new EvalError('C crosses itself: the region inside is not well defined');
      const nF = nameOf(raw[0], 'F');
      const nC = nameOf(kw.raw.on ?? raw[1], 'C');
      const circ = lineIntegral(ctx, F, C, 'work', { F: nF, C: nC });
      const curl = ctx.makeFunction(curlExprs(F)[0], F.params, { env: F.env });
      const cf = curl.eval as (x: number, y: number) => number;
      const r = regionIntegral(cf, C);
      // counter-clockwise boundary: ∮ = ∬; clockwise: ∮ = −∬
      const P = polygonOf(C, 600);
      let area2 = 0;
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        const q = P[(i + 1) % P.length];
        area2 += p[0] * q[1] - q[0] * p[1];
      }
      const orient = area2 >= 0 ? 1 : -1;
      const rhs = orient * r.value;
      const holds = Math.abs(circ.value - rhs) <= 1e-4 * Math.max(1, Math.abs(rhs)) + 5 * r.error;
      const th: TheoremValue = {
        kind: 'theorem', name: "Green's theorem",
        lhsLatex: `\\oint_{${nC}} ${nF}\\cdot d\\mathbf{r}`,
        rhsLatex: `${orient < 0 ? '-' : ''}\\iint_{D} (\\nabla\\times ${nF})\\,dA`,
        lhs: circ.value, rhs, holds,
        certainty: 'numeric',
        evidence: `line integral ${circ.certainty === 'exact' ? 'exact' : 'numeric'}; double integral by scan lines over the region inside ${nC} (±${r.error.toExponential(1)})${orient < 0 ? '; C is clockwise, so the double integral changes sign' : ''}`,
        key: `green|${F.key}|${C.key}`,
        visuals: [visual('greencells', { curl, curve: C, F, timeline: `green:${nF}:${nC}`, stops: ['1×1', '2×2', '4×4', '8×8', '16×16', '32×32'], total: circ.value, orient }, "Green's cells", 'green')],
      };
      return th as unknown as MathValue;
    },
  },
  {
    name: 'integrateinside', minArgs: 2, maxArgs: 2, category: 'vector calculus', signature: 'integrateinside(f, C)',
    doc: '∬ f dA over the region inside a closed plane curve C (numeric).',
    argModes: ['value', 'value'],
    apply: ([fv, c]) => {
      const C = expectCurve(c);
      if (!closedOf(C)) throw new EvalError('C must be a closed curve');
      // the integrand may be a constant or use only some of x, y
      let g: (x: number, y: number) => number;
      if (fv?.kind === 'scalar') {
        const k = (fv as unknown as { value: number }).value;
        g = () => k;
      } else {
        const f = fv as FunctionValue;
        if (f?.kind !== 'function' || f.out !== 'scalar' || !f.params.every((p) => p === 'x' || p === 'y')) throw new EvalError('the integrand must be a number or a function of x, y');
        const e = f.eval as (...a: number[]) => number;
        g = (x, y) => e(...f.params.map((p) => (p === 'x' ? x : y)));
      }
      const r = regionIntegral(g, C);
      return { kind: 'scalar', value: r.value, certainty: 'numeric', evidence: `scan-line Gauss–Legendre over the region inside the curve (±${r.error.toExponential(1)})` } as MathValue;
    },
  },
];