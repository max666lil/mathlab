/**
 * Recognise closed forms of floating-point results (p/q, (p/q)√n, (p/q)π, (p/q)e).
 * Recognition is presentation help only — it never upgrades a numeric result to "exact".
 */

export interface Recognized {
  latex: string;
  text: string;
}

const SQUAREFREE = [2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22, 23, 26, 29, 30, 31, 33, 34, 35, 37, 38, 39, 41, 42, 43, 46, 47];

function rational(x: number, maxQ: number): [number, number] | null {
  for (let q = 1; q <= maxQ; q++) {
    const p = Math.round(x * q);
    if (Math.abs(p / q - x) <= 1e-10 * Math.max(1, Math.abs(x))) return [p, q];
  }
  return null;
}

function fracLatex(p: number, q: number, factor = ''): string {
  const sign = p < 0 ? '-' : '';
  const a = Math.abs(p);
  if (q === 1) return `${sign}${a === 1 && factor ? '' : a}${factor}`;
  const top = a === 1 && factor ? factor : `${a}${factor}`;
  return `${sign}\\frac{${top}}{${q}}`;
}

function fracText(p: number, q: number, factor = ''): string {
  const a = Math.abs(p);
  const sign = p < 0 ? '-' : '';
  const body = a === 1 && factor ? factor : `${a}${factor}`;
  return q === 1 ? `${sign}${body}` : `${sign}${body}/${q}`;
}

export function recognize(x: number): Recognized | null {
  if (!Number.isFinite(x)) return null;
  if (Math.abs(x) < 1e-13) return { latex: '0', text: '0' };
  const r = rational(x, 64);
  if (r) return { latex: fracLatex(r[0], r[1]), text: fracText(r[0], r[1]) };
  for (const n of SQUAREFREE) {
    const s = rational(x / Math.sqrt(n), 24);
    if (s) return { latex: fracLatex(s[0], s[1], `\\sqrt{${n}}`), text: fracText(s[0], s[1], `√${n}`) };
  }
  // (p + r√n)/q — e.g. roots of quadratics such as 1 − √2
  for (const n of SQUAREFREE.slice(0, 12)) {
    const sq = Math.sqrt(n);
    for (let q = 1; q <= 12; q++)
      for (let r = -12; r <= 12; r++) {
        if (r === 0) continue;
        const p = Math.round(x * q - r * sq);
        if (p === 0) continue;
        if (Math.abs((p + r * sq) / q - x) <= 1e-10 * Math.max(1, Math.abs(x))) {
          const g = gcd(gcd(Math.abs(p), Math.abs(r)), q);
          const [pp, rr, qq] = [p / g, r / g, q / g];
          const rs = `${Math.abs(rr) === 1 ? '' : Math.abs(rr)}\\sqrt{${n}}`;
          const rt = `${Math.abs(rr) === 1 ? '' : Math.abs(rr)}√${n}`;
          const num = `${pp} ${rr < 0 ? '-' : '+'} ${rs}`;
          const numT = `${pp} ${rr < 0 ? '-' : '+'} ${rt}`;
          return qq === 1 ? { latex: num, text: numT } : { latex: `\\frac{${num}}{${qq}}`, text: `(${numT})/${qq}` };
        }
      }
  }
  const pi = rational(x / Math.PI, 12);
  if (pi) return { latex: fracLatex(pi[0], pi[1], '\\pi'), text: fracText(pi[0], pi[1], 'π') };
  const e = rational(x / Math.E, 6);
  if (e) return { latex: fracLatex(e[0], e[1], 'e'), text: fracText(e[0], e[1], 'e') };
  const l2 = rational(x / Math.LN2, 6);
  if (l2) return { latex: fracLatex(l2[0], l2[1], '\\ln 2'), text: fracText(l2[0], l2[1], 'ln 2') };
  return null;
}
function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : Math.abs(a) || 1;
}
