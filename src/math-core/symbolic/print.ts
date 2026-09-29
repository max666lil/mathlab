/**
 * Printing expressions as MLL text (round-trips through the parser) and as LaTeX (KaTeX).
 */
import { Expr } from '../ast';
import { getScalarFunction } from '../scalar-functions';

const PREC = { eq: 0, sum: 1, prod: 2, neg: 3, pow: 4, atom: 5 } as const;

/** Format a number for display: integers exact, others to `digits` significant digits. */
export function formatNumber(x: number, digits = 4): string {
  if (!isFinite(x)) return isNaN(x) ? 'NaN' : x > 0 ? '∞' : '-∞';
  if (Object.is(x, -0)) x = 0;
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-4 || a >= 1e9)) return x.toExponential(digits - 1).replace(/\.?0+e/, 'e');
  const decimals = Math.max(0, digits - 1 - Math.floor(Math.log10(a)));
  let s = x.toFixed(Math.min(decimals, 10));
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/** Recognise simple fractions p/q with q ≤ 12 (for LaTeX display). */
export function asFraction(x: number): [number, number] | null {
  if (Number.isInteger(x)) return null;
  for (let q = 2; q <= 12; q++) {
    const p = Math.round(x * q);
    if (Math.abs(p / q - x) < 1e-12) return [p, q];
  }
  return null;
}

/** Split a product into numeric coefficient and remaining factors. */
export function productParts(e: Expr): { coef: number; factors: Expr[] } {
  const factors: Expr[] = [];
  let coef = 1;
  const visit = (n: Expr) => {
    if (n.type === 'bin' && n.op === '*') {
      visit(n.left);
      visit(n.right);
    } else if (n.type === 'num') coef *= n.value;
    else if (n.type === 'neg') {
      coef = -coef;
      visit(n.arg);
    } else factors.push(n);
  };
  visit(e);
  return { coef, factors };
}

interface Term {
  term: Expr;
  negative: boolean;
}

function sumTerms(e: Expr, out: Term[] = []): Term[] {
  if (e.type === 'bin' && e.op === '+') {
    sumTerms(e.left, out);
    sumTerms(e.right, out);
  } else if (e.type === 'bin' && e.op === '-') {
    sumTerms(e.left, out);
    sumTerms(e.right, []).forEach((t) => out.push({ term: t.term, negative: !t.negative }));
  } else {
    const { coef } = productParts(e);
    if (coef < 0) out.push({ term: negate(e), negative: true });
    else out.push({ term: e, negative: false });
  }
  return out;
}

export function negate(e: Expr): Expr {
  if (e.type === 'num') return { type: 'num', value: -e.value };
  if (e.type === 'neg') return e.arg;
  const { coef, factors } = productParts(e);
  const c = -coef;
  if (factors.length === 0) return { type: 'num', value: c };
  let out = factors.reduce((a, b) => ({ type: 'bin', op: '*', left: a, right: b }) as Expr);
  if (c !== 1) out = { type: 'bin', op: '*', left: { type: 'num', value: c }, right: out };
  return out;
}

function precOf(e: Expr): number {
  switch (e.type) {
    case 'num':
      return e.value < 0 ? PREC.neg : PREC.atom;
    case 'neg':
      return PREC.neg;
    case 'bin':
      if (e.op === '+' || e.op === '-') return PREC.sum;
      if (e.op === '^') return PREC.pow;
      if (e.op === 'at') return PREC.atom;
      if (e.op === '*') return productParts(e).coef < 0 ? PREC.neg : PREC.prod;
      return PREC.prod;
    case 'eq':
      return PREC.eq;
    default:
      return PREC.atom;
  }
}

/** Is a factor "simple" enough to juxtapose after a number: 2x, 2x^2, 2sin(x). */
function juxtaposable(e: Expr): boolean {
  if (e.type === 'sym' || e.type === 'call') return true;
  return e.type === 'bin' && e.op === '^' && (e.left.type === 'sym' || e.left.type === 'call');
}

/** Split product factors into numerator / denominator (negative numeric exponents). */
function fractionParts(factors: Expr[]): { num: Expr[]; den: Expr[] } {
  const num: Expr[] = [];
  const den: Expr[] = [];
  for (const f of factors) {
    if (f.type === 'bin' && f.op === '^' && f.right.type === 'num' && f.right.value < 0) {
      den.push(f.right.value === -1 ? f.left : { type: 'bin', op: '^', left: f.left, right: { type: 'num', value: -f.right.value } });
    } else num.push(f);
  }
  return { num, den };
}

// ---------------------------------------------------------------- text

export function toText(e: Expr, precise = false): string {
  const fmt = (x: number) => (precise ? String(x) : formatNumber(x, 6));
  const p = (x: Expr, min: number) => {
    const s = toText(x, precise);
    return precOf(x) < min ? `(${s})` : s;
  };
  const list = (xs: Expr[]) => xs.map((a) => toText(a, precise)).join(', ');
  switch (e.type) {
    case 'num':
      return fmt(e.value);
    case 'sym':
      return e.name;
    case 'member':
      return `${p(e.object, PREC.atom)}.${e.prop}`;
    case 'neg':
      return `-${p(e.arg, PREC.pow)}`;
    case 'eq':
      return `${toText(e.left, precise)} = ${toText(e.right, precise)}`;
    case 'call':
      return `${p(e.callee, PREC.atom)}(${list(e.args)})`;
    case 'tuple':
      return `(${list(e.items)})`;
    case 'vec':
      return `<${list(e.items)}>`;
    case 'list':
      return `[${list(e.items)}]`;
    case 'matrix':
      return `[${e.rows.map((r) => `[${list(r)}]`).join(', ')}]`;
    case 'bin':
      switch (e.op) {
        case '+':
        case '-':
          return sumTerms(e)
            .map((t, i) => {
              if (i === 0) return t.negative ? `-${p(t.term, PREC.prod)}` : p(t.term, PREC.sum + 1);
              return t.negative ? ` - ${p(t.term, PREC.prod)}` : ` + ${p(t.term, PREC.sum + 1)}`;
            })
            .join('');
        case '*': {
          const { coef, factors } = productParts(e);
          if (factors.length === 0) return fmt(coef);
          if (coef < 0) return `-${p(negate(e), PREC.prod)}`;
          const { num, den } = fractionParts(factors);
          const join = (fs: Expr[]) => fs.map((f) => p(f, PREC.prod + 0.5)).join('*');
          let top = num.length ? join(num) : '';
          if (coef !== 1) top = top ? (juxtaposable(num[0]) ? `${fmt(coef)}${top}` : `${fmt(coef)}*${top}`) : fmt(coef);
          if (!top) top = '1';
          if (!den.length) return top;
          const bottom = den.length === 1 ? p(den[0], PREC.pow) : `(${join(den)})`;
          return `${top}/${bottom}`;
        }
        case '/':
          return `${p(e.left, PREC.prod)}/${p(e.right, PREC.pow)}`;
        case '^':
          return `${p(e.left, PREC.pow + 1)}^${p(e.right, PREC.atom)}`;
        case '·':
          return `${p(e.left, PREC.prod)} · ${p(e.right, PREC.prod + 1)}`;
        case '×':
          return `${p(e.left, PREC.prod)} × ${p(e.right, PREC.prod + 1)}`;
        case 'at':
          return `${p(e.left, PREC.atom)} at ${p(e.right, PREC.atom)}`;
      }
  }
}

// ---------------------------------------------------------------- LaTeX

const GREEK: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'varepsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota',
  κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', υ: 'upsilon',
  φ: 'varphi', χ: 'chi', ψ: 'psi', ω: 'omega', Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Ξ: 'Xi',
  Π: 'Pi', Σ: 'Sigma', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega',
};
const GREEK_WORDS = new Set(Object.values(GREEK).concat(['phi', 'epsilon']));

/** Custom LaTeX for function names (plugins may add, e.g. grad → ∇). */
const latexFunctionNames = new Map<string, string>();
export function registerLatexFunctionName(name: string, latex: string) {
  latexFunctionNames.set(name, latex);
}

export function symbolLatex(name: string): string {
  let base = name;
  let primes = '';
  while (base.endsWith("'")) {
    primes += "'";
    base = base.slice(0, -1);
  }
  let sub = '';
  const us = base.indexOf('_');
  if (us > 0) {
    sub = base.slice(us + 1);
    base = base.slice(0, us);
  } else {
    const m = /^(.*?[^\d])(\d+)$/.exec(base);
    if (m) {
      base = m[1];
      sub = m[2];
    }
  }
  let b: string;
  if (base in GREEK) b = `\${GREEK[base]}`;
  else if (GREEK_WORDS.has(base)) b = `\${base}`;
  else if (base.length === 1) b = base;
  else b = `\mathrm{${base}}`;
  return b + primes + (sub ? `_{${sub.length === 1 ? sub : symbolLatex(sub)}}` : '');
}

export function numberLatex(x: number, digits = 4): string {
  const f = asFraction(x);
  if (f && Math.abs(f[1]) <= 12) return `${f[0] < 0 ? '-' : ''}\frac{${Math.abs(f[0])}}{${f[1]}}`;
  const s = formatNumber(x, digits);
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s);
  if (m) return `${m[1]}\times 10^{${Number(m[2])}}`;
  return s.replace('∞', '\infty');
}

export function functionNameLatex(name: string): string {
  const custom = latexFunctionNames.get(name);
  if (custom) return custom;
  const sf = getScalarFunction(name);
  if (sf?.latex) return sf.latex;
  if (name.length === 1 || name in GREEK || /^.[\d_']/.test(name)) return symbolLatex(name);
  return `\operatorname{${name.replace(/_/g, '\_')}}`;
}

export function toLatex(e: Expr, digits = 4): string {
  const L = (x: Expr) => toLatex(x, digits);
  const p = (x: Expr, min: number) => {
    const s = L(x);
    return precOf(x) < min ? `\left(${s}\right)` : s;
  };
  const list = (xs: Expr[]) => xs.map(L).join(', ');
  switch (e.type) {
    case 'num':
      return numberLatex(e.value, digits);
    case 'sym':
      return symbolLatex(e.name);
    case 'member':
      return `${p(e.object, PREC.atom)}_{${e.prop}}`;
    case 'neg':
      return `-${p(e.arg, PREC.pow)}`;
    case 'eq':
      return `${L(e.left)} = ${L(e.right)}`;
    case 'call': {
      const name = e.callee.type === 'sym' ? e.callee.name : undefined;
      if (name === 'sqrt' && e.args.length === 1) return `\sqrt{${L(e.args[0])}}`;
      if (name === 'abs' && e.args.length === 1) return `\left|${L(e.args[0])}\right|`;
      if (name === 'exp' && e.args.length === 1) return `e^{${L(e.args[0])}}`;
      if (name === 'norm' && e.args.length === 1) return `\left\lVert ${L(e.args[0])}\right\rVert`;
      const head = name ? functionNameLatex(name) : p(e.callee, PREC.atom);
      if (name === 'grad' && e.args.length === 1 && e.args[0].type === 'sym') return `${head} ${L(e.args[0])}`;
      return `${head}\left(${list(e.args)}\right)`;
    }
    case 'tuple':
      return `\left(${list(e.items)}\right)`;
    case 'vec':
      return `\left\langle ${list(e.items)}\right\rangle`;
    case 'list':
      return `\left[${list(e.items)}\right]`;
    case 'matrix':
      return `\begin{pmatrix}${e.rows.map((r) => r.map(L).join(' & ')).join(' \\ ')}\end{pmatrix}`;
    case 'bin':
      switch (e.op) {
        case '+':
        case '-':
          return sumTerms(e)
            .map((t, i) => {
              if (i === 0) return t.negative ? `-${p(t.term, PREC.prod)}` : p(t.term, PREC.sum + 1);
              return t.negative ? ` - ${p(t.term, PREC.prod)}` : ` + ${p(t.term, PREC.sum + 1)}`;
            })
            .join('');
        case '*': {
          const { coef, factors } = productParts(e);
          if (factors.length === 0) return numberLatex(coef, digits);
          if (coef < 0) return `-${p(negate(e), PREC.prod)}`;
          const { num, den } = fractionParts(factors);
          const join = (fs: Expr[]) => fs.map((f) => p(f, PREC.prod + 0.5)).join(' ');
          const frac = asFraction(coef);
          if (den.length || frac) {
            const topC = frac ? frac[0] : coef;
            const botC = frac ? frac[1] : 1;
            let top = join(num);
            if (topC !== 1) top = top ? `${numberLatex(topC, digits)} ${top}` : numberLatex(topC, digits);
            if (!top) top = '1';
            let bottom = join(den.map((d) => d));
            if (botC !== 1) bottom = bottom ? `${botC} ${bottom}` : String(botC);
            if (!bottom) return top;
            return `\frac{${top}}{${bottom}}`;
          }
          const body = join(num);
          return coef === 1 ? body : `${numberLatex(coef, digits)} ${body}`;
        }
        case '/':
          return `\frac{${L(e.left)}}{${L(e.right)}}`;
        case '^': {
          const base = e.left.type === 'call' && e.left.callee.type === 'sym' && getScalarFunction(e.left.callee.name)?.latex && e.right.type === 'num' && e.right.value > 0
            ? `${functionNameLatex(e.left.callee.name)}^{${L(e.right)}}\left(${list(e.left.args)}\right)`
            : null;
          if (base) return base;
          return `${p(e.left, PREC.pow + 1)}^{${L(e.right)}}`;
        }
        case '·':
          return `${p(e.left, PREC.prod)} \cdot ${p(e.right, PREC.prod + 1)}`;
        case '×':
          return `${p(e.left, PREC.prod)} \times ${p(e.right, PREC.prod + 1)}`;
        case 'at':
          return `${p(e.left, PREC.atom)}\left(${L(e.right)}\right)`;
      }
  }
}
