/**
 * Coordinate systems of the plane and of space (Hughes-Hallett §16.4–16.5, §21.2): the maps to
 * Cartesian coordinates, their Jacobian factors, implicit parameter ranges, and the conversion of
 * Cartesian expressions into tidy polar / cylindrical / spherical ones (x² + y² → r², with
 * sin² + cos² = 1 applied coefficient by coefficient).
 */
import { Expr, num, sym, mapExpr, dependsOn } from '../../math-core/ast';
import { simplify, addList, mulList, powS } from '../../math-core/symbolic/simplify';
import { polyCoeffsExpr } from '../../math-core/symbolic/expand';

export type CoordSystem = 'cartesian' | 'polar' | 'cylindrical' | 'spherical';

/** Coordinate names of each system (Cartesian: the first 2 or 3). */
export const SYSTEM_VARS: Record<CoordSystem, string[]> = {
  cartesian: ['x', 'y', 'z'],
  polar: ['r', 'θ'],
  cylindrical: ['r', 'θ', 'z'],
  spherical: ['ρ', 'φ', 'θ'],
};

/** Variables that are never negative (r, ρ) — used when isolating bounds and simplifying powers. */
export const POSITIVE = new Set(['r', 'ρ', 'ϱ']);

/** Implicit ranges of angular / radial coordinates. */
export const IMPLICIT_RANGE: Record<string, [number, number]> = {
  r: [0, Infinity],
  ρ: [0, Infinity],
  θ: [0, 2 * Math.PI],
  φ: [0, Math.PI],
};

const cos = (e: Expr): Expr => ({ type: 'call', callee: sym('cos'), args: [e] });
const sin = (e: Expr): Expr => ({ type: 'call', callee: sym('sin'), args: [e] });
const mul = (...xs: Expr[]) => mulList(xs);

/** x, y[, z] in terms of the system's coordinates. */
export function toCartesianMap(system: CoordSystem): Record<string, Expr> {
  const [r, t, p, rho] = [sym('r'), sym('θ'), sym('φ'), sym('ρ')];
  switch (system) {
    case 'polar':
      return { x: mul(r, cos(t)), y: mul(r, sin(t)) };
    case 'cylindrical':
      return { x: mul(r, cos(t)), y: mul(r, sin(t)), z: sym('z') };
    case 'spherical':
      return { x: mul(rho, sin(p), cos(t)), y: mul(rho, sin(p), sin(t)), z: mul(rho, cos(p)) };
    default:
      return {};
  }
}

/** |det J| of the map to Cartesian coordinates: dA = r dr dθ, dV = ρ² sin φ dρ dφ dθ. */
export function jacobianFactor(system: CoordSystem): Expr {
  switch (system) {
    case 'polar':
    case 'cylindrical':
      return sym('r');
    case 'spherical':
      return mul(powS(sym('ρ'), num(2)), sin(sym('φ')));
    default:
      return num(1);
  }
}

export function jacobianLatex(system: CoordSystem): string {
  return system === 'polar' ? 'r\\,dr\\,d\\theta' : system === 'cylindrical' ? 'r\\,dz\\,dr\\,d\\theta' : system === 'spherical' ? '\\rho^{2}\\sin\\varphi\\,d\\rho\\,d\\varphi\\,d\\theta' : '';
}

export function substitute(e: Expr, map: Record<string, Expr>): Expr {
  return mapExpr(e, (n) => (n.type === 'sym' && map[n.name] ? map[n.name] : n));
}

/** (v^k)^p → v^{kp} and √(v^k) → v^{k/2} for a non-negative variable v (also inside products). */
function positivePowers(e: Expr, v: string): Expr {
  return mapExpr(e, (n) => {
    let base: Expr | undefined;
    let p: number | undefined;
    if (n.type === 'call' && n.callee.type === 'sym' && n.callee.name === 'sqrt' && n.args.length === 1) [base, p] = [n.args[0], 0.5];
    else if (n.type === 'bin' && n.op === '^' && n.right.type === 'num') [base, p] = [n.left, n.right.value];
    if (!base || p === undefined || !dependsOn(base, v)) return n;
    const fs: Expr[] = base.type === 'bin' && base.op === '*' ? flat(base) : [base];
    const out: Expr[] = [];
    const rest: Expr[] = [];
    for (const f of fs) {
      const k = f.type === 'sym' && f.name === v ? 1 : f.type === 'bin' && f.op === '^' && f.left.type === 'sym' && f.left.name === v && f.right.type === 'num' ? f.right.value : undefined;
      if (k === undefined) rest.push(f);
      else out.push(powS(sym(v), num(k * p)));
    }
    if (!out.length) return n;
    if (rest.length) {
      const r = mulList(rest);
      // √(c r²) = √c · r only for a non-negative remaining factor
      if (r.type !== 'num' || r.value < 0) return n;
      out.push(p === 0.5 ? { type: 'call', callee: sym('sqrt'), args: [r] } : powS(r, num(p)));
    }
    return mulList(out);
  });
}

function flat(e: Expr): Expr[] {
  return e.type === 'bin' && e.op === '*' ? [...flat(e.left), ...flat(e.right)] : [e];
}

/**
 * Rewrite e as Σ cₖ vᵏ with simplified coefficients (so r² cos²θ + r² sin²θ → r²), recursively inside
 * function arguments and powers.
 */
export function tidy(e: Expr, v: string): Expr {
  const inner = mapExpr(simplify(e), (n) => {
    if (n.type === 'call') return { ...n, args: n.args.map((a) => collect(a, v)) };
    if (n.type === 'bin' && n.op === '^' && !(n.right.type === 'num' && Number.isInteger(n.right.value) && n.right.value >= 0)) return powS(collect(n.left, v), n.right);
    return n;
  });
  return simplify(positivePowers(collect(inner, v), v));
}

function collect(e: Expr, v: string): Expr {
  const cs = polyCoeffsExpr(e, v);
  if (!cs) return positivePowers(simplify(e), v);
  return positivePowers(addList(cs.map((c, k) => mul(simplify(c), powS(sym(v), num(k))))), v);
}

/** A Cartesian expression in the system's coordinates, tidied. */
export function fromCartesian(e: Expr, system: CoordSystem): Expr {
  switch (system) {
    case 'polar':
    case 'cylindrical':
      return tidy(substitute(e, { x: mul(sym('r'), cos(sym('θ'))), y: mul(sym('r'), sin(sym('θ'))) }), 'r');
    case 'spherical': {
      // via cylindrical coordinates: x² + y² → ϱ², then ϱ = ρ sin φ, z = ρ cos φ
      const cyl = tidy(substitute(e, { x: mul(sym('ϱ'), cos(sym('θ'))), y: mul(sym('ϱ'), sin(sym('θ'))) }), 'ϱ');
      return tidy(substitute(cyl, { ϱ: mul(sym('ρ'), sin(sym('φ'))), z: mul(sym('ρ'), cos(sym('φ'))) }), 'ρ');
    }
    default:
      return simplify(e);
  }
}

/** Numeric map from system coordinates to Cartesian ones. */
export function toCartesianNumeric(system: CoordSystem): (c: number[]) => number[] {
  switch (system) {
    case 'polar':
      return ([r, t]) => [r * Math.cos(t), r * Math.sin(t)];
    case 'cylindrical':
      return ([r, t, z]) => [r * Math.cos(t), r * Math.sin(t), z];
    case 'spherical':
      return ([p, f, t]) => [p * Math.sin(f) * Math.cos(t), p * Math.sin(f) * Math.sin(t), p * Math.cos(f)];
    default:
      return (c) => c;
  }
}

/** Cartesian point → system coordinates with θ ∈ [0, 2π), φ ∈ [0, π]. */
export function fromCartesianNumeric(system: CoordSystem): (p: number[]) => number[] {
  const ang = (x: number, y: number) => {
    const t = Math.atan2(y, x);
    return t < 0 ? t + 2 * Math.PI : t;
  };
  switch (system) {
    case 'polar':
      return ([x, y]) => [Math.hypot(x, y), ang(x, y)];
    case 'cylindrical':
      return ([x, y, z]) => [Math.hypot(x, y), ang(x, y), z];
    case 'spherical':
      return ([x, y, z]) => {
        const p = Math.hypot(x, y, z);
        return [p, p > 0 ? Math.acos(Math.max(-1, Math.min(1, z / p))) : 0, ang(x, y)];
      };
    default:
      return (p) => p;
  }
}