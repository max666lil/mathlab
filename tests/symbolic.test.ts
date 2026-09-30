import { describe, it, expect } from 'vitest';
import { parseExpression, parseProgram } from '../src/parser/parser';
import { diff, gradient, hessian } from '../src/math-core/symbolic/diff';
import { simplify } from '../src/math-core/symbolic/simplify';
import { toText, toLatex } from '../src/math-core/symbolic/print';
import { compileScalar } from '../src/math-core/compile';
import { numericGradient } from '../src/math-core/numeric';
import { symmetricEigen } from '../src/math-core/linalg';

const prefix = new Set(['sin', 'cos', 'tan', 'exp', 'ln', 'sqrt', 'grad', 'hessian']);
const P = (s: string) => parseExpression(s, { isPrefixFunction: (n) => prefix.has(n) });
const T = (s: string) => toText(simplify(P(s)));

describe('parser', () => {
  it('implicit multiplication and powers', () => {
    expect(T('x^2 + 2y^2')).toBe('x^2 + 2y^2');
    expect(T('2x y')).toBe('2x*y');
    expect(T('-x^2')).toBe('-x^2');
    expect(T('x²+y³')).toBe('x^2 + y^3');
    expect(T('2(x+1)')).toBe('2x + 2');
  });
  it('prefix application and at', () => {
    expect(toText(P('sin x'))).toBe('sin(x)');
    expect(toText(P('sin 2x'))).toBe('sin(2x)');
    expect(toText(P('grad f at P'))).toBe('grad(f) at P');
    expect(toText(P('grad(f) at P · u'))).toBe('grad(f) at P · u');
    expect(toText(P('∇f(P)'))).toBe('grad(f)(P)');
    expect(toText(P('<cos θ, sin θ>'))).toBe('<cos(θ), sin(θ)>');
  });
  it('statements', () => {
    const st = parseProgram('f(x,y) = x^2 + 2y^2\nP = point(1, 1) draggable\nθ = slider(0, 2π, 0.6)\nshow surface(f), contours(f)\na ∈ [-5, 5]\nanimate θ from 0 to 2π');
    expect(st.map((s) => s.kind)).toEqual(['funcdef', 'assign', 'assign', 'show', 'assign', 'animate']);
    expect(st[1].modifiers).toEqual(['draggable']);
  });
  it('multi-line continuation', () => {
    const st = parseProgram('f(x,y) = x +\n  y\ng = 1');
    expect(st.length).toBe(2);
  });
});

describe('differentiation', () => {
  it('gradient of flagship function', () => {
    const f = P('x^2 + 2y^2');
    expect(toText(gradient(f, ['x', 'y']))).toBe('<2x, 4y>');
    expect(toText(hessian(f, ['x', 'y']))).toBe('[[2, 0], [0, 4]]');
  });
  it('chain/product rules', () => {
    expect(toText(diff(P('sin(x)*cos(y)'), 'x'))).toBe('cos(x)*cos(y)');
    expect(toText(diff(P('a*x^2'), 'x'))).toBe('2a*x');
    expect(toText(diff(P('exp(-x^2)'), 'x'))).toBe('-2x*exp(-x^2)');
  });
  const corpus = ['x^2*y + sin(x*y)', 'exp(x)*cos(y) + ln(1 + x^2 + y^2)', 'sqrt(1 + x^2 + y^2)', 'x/(1+y^2)', 'atan(y/x)', '(x^2+y^2)^1.5', 'x^y', 'tanh(x - y)*abs(x+2)'];
  for (const src of corpus) {
    it(`matches central differences: ${src}`, () => {
      const f = P(src);
      const g = gradient(f, ['x', 'y']);
      const fn = compileScalar(f, ['x', 'y']);
      const gx = compileScalar((g as any).items[0], ['x', 'y']);
      const gy = compileScalar((g as any).items[1], ['x', 'y']);
      for (let k = 0; k < 10; k++) {
        const p = [0.3 + Math.random() * 1.5, 0.2 + Math.random() * 1.5];
        const ng = numericGradient(fn, p);
        expect(gx(p[0], p[1])).toBeCloseTo(ng[0], 4);
        expect(gy(p[0], p[1])).toBeCloseTo(ng[1], 4);
      }
    });
  }
  it('latex', () => {
    expect(toLatex(simplify(P('x^2 + 2y^2')))).toBe('x^{2} + 2 y^{2}');
    expect(toLatex(simplify(P('x/2')))).toBe('\\frac{x}{2}');
    expect(toLatex(simplify(P('sin(x)^2 + sqrt(y)')))).toBe('\\sin^{2}\\left(x\\right) + \\sqrt{y}');
  });
});

describe('linalg', () => {
  it('symmetric eigen', () => {
    const e = symmetricEigen([[2, 1], [1, 2]]);
    expect(e[0].value).toBeCloseTo(3);
    expect(e[1].value).toBeCloseTo(1);
    expect(Math.abs(e[0].vector[0])).toBeCloseTo(Math.SQRT1_2);
  });
});
