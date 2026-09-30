import { describe, it, expect } from 'vitest';
import { parseExpression } from '../src/parser/parser';
import { toText } from '../src/math-core/symbolic/print';
import { trigSimplify } from '../src/math-core/symbolic/simplify';

const ts = (s: string) => toText(trigSimplify(parseExpression(s)));

describe('trigSimplify', () => {
  it('merges sin² and cos² inside products', () => {
    expect(ts('r cos(θ)^2 + r sin(θ)^2')).toBe('r');
    expect(ts('3 a sin(t)^2 + 3 a cos(t)^2 + 1')).toBe('3a + 1');
    expect(ts('ρ^2 sin(φ)^3 cos(θ)^2 + ρ^2 sin(φ)^3 sin(θ)^2 + ρ^2 sin(φ) cos(φ)^2')).toBe('ρ^2*sin(φ)');
  });
  it('leaves other expressions alone', () => {
    expect(ts('sin(x)^2 + 2cos(x)^2')).toBe('cos(x)^2 + 1');
    expect(ts('x + y')).toBe('x + y');
  });
});