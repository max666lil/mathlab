/** Quick reference for the MathLab Language (MLL). */
import { Tex } from './Tex';
import { allBuiltins } from '../math-core/builtins';

const SYNTAX: [string, string][] = [
  ['f(x) = x^3 - 3x   ·   f(x,y) = x^2 + 2y^2', 'define a function — it is analysed automatically (Analysis panel)'],
  ['P = point(1, 1) draggable   ·   a = slider(-5, 5, 1)', 'points you can drag, parameters with sliders'],
  ['derivative f   ·   derivative f wrt y order 2', 'derivatives (exact)'],
  ['integrate f   ·   integrate x^2 from 0 to 1', 'antiderivative (verified) or definite integral'],
  ['limit sin(x)/x as x -> 0   ·   … as x -> 0+   ·   … as x -> ∞', 'limits (exact by continuity, otherwise numeric evidence)'],
  ['solve x^2 - x - 1 = 0   ·   solve(x + y = 3, x - y = 1)', 'equations'],
  ['taylor exp(x) at 0 order 4', 'Taylor polynomials'],
  ['critical f · zeros f · extrema f · inflections f', 'point sets — they are objects: C = critical f, P = first(C), C[2]'],
  ['domain f · monotonicity f · concavity f · asymptotes f', 'more analysis results'],
  ['grad f at P · hessian f at P · tangent f at P', 'local analysis'],
  ['directional f at P toward (3,-2)', 'directional derivative, with its geometry'],
  ['A = [[2,1],[1,2]]   ·   v = <1, 2> draggable   ·   A v · A^-1 · Aᵀ · A^3', 'matrices are linear maps — analysed and animated automatically (drag î, ĵ)'],
  ['det A · rank A · rref A · inverse A · eigen A · charpoly A · diagonalize A', 'exact for rational matrices; results are objects (E = eigen A, E[1])'],
  ['nullspace A · columnspace A · span(u, v) · basis S · independent S · dim W', 'subspaces and bases'],
  ['solve(A, b) · project v onto W · leastsquares(A, b) · coords v in B', 'systems (row picture), projections, coordinates'],
  ['gramschmidt S · orthonormal S · qr A · svd A', 'orthogonalization and decompositions (◐ plays them step by step)'],
  ['transformation(A, B) · T(x,y) = (x + y, 2y)', 'composition B then A · linear maps by formula'],
  ['F(x,y) = <-y, x> · div F · curl F · ∇·F · ∇×F · laplacian f · potential F · equilibria F', 'vector fields (angle brackets): flow, flux box, paddle wheel'],
  ['C(t) = (cos t, sin t) for t in [0, 2π] · length C · area C · curvature C at t0 · tangent C at t0', 'parametric curves (ranges optional)'],
  ['work F along C · circulation F around C · flux F across C · integrate f along C · green F on C', 'line integrals and Green’s theorem (with the cell animation)'],
  ['S(u,v) = (…) for u in [..], v in [..] · area S · normal S at (u, v) · flux F through S', 'parametric surfaces and flux'],
  ['stokes F on S · gauss F on S', 'Stokes and divergence theorem checks (both sides)'],
  ['R = x^2 + y^2 <= 1 · D = 0 <= x <= 1 and x^2 <= y <= x · S = 1 <= r <= 2 and 0 <= θ <= π/4 · E = ρ <= 2', 'regions and solids (Cartesian, polar, cylindrical, spherical)'],
  ['integrate f over R [in polar] [order dx dy] · area R · volume E · average f over R · mass δ over R · centroid R', 'multiple integrals (exact when possible; polar / spherical chosen for round regions)'],
  ['bounds R [order dx dy] · strips R · riemann f over R · polargrid R', 'iterated bounds, strip sweep, Riemann boxes, the r dr dθ cell'],
  ['T(r, θ) = (r cos(θ), r sin(θ)) · jacobian T · det(jacobian T) · coordgrid T', 'coordinate maps (plane and space): Jacobian, area / volume scale, the bending grid'],
  ['f(r, θ) = r^2 sin(θ) · grad f · grad f in polar · polarform f · cartesian f · polarview f at P', 'polar coordinates: ∇f = f_r e_r + (1/r) f_θ e_θ, with e_r, e_θ drawn at P'],
  ['f(x, y) = c (f already defined) · level f = c · level f at 4 · x^2 + y^2 = r^2 (＋ slider r)', 'level curves whose size a slider controls'],
  ['x - 2y + 3 · 2x + 3y - z · 2x + 3y - z = 5 · ax + by + cz = d (＋ sliders) · linearform S', 'bare formulas are named f, g … and analysed; planes with their normal n = (a, b, c)'],
  ['implicit x^2 + y^2 = 25 at (3, 4) · chain(f, cos(t), sin(t)) · chain f along C · differential f at P', 'implicit differentiation, the chain rule written out, the total differential'],
  ['plane(P, Q, R) · plane(P, n) · distance(P, S) · distance(P, L) · angle(u, v) · steepest f at P', 'planes, distances, angles; where f changes fastest'],
  ['T(x,y,z) = … · critical T · levelsurface(T, c) · sliceplane(T, z, c) · tangent T at P · x^2 + y^2 - z^2 = 1', '3-D scalar fields and implicit surfaces'],
  ['maximize f subject to g = c [and h <= d] · minimize … · lagrange f subject to …', 'Lagrange multipliers (equality and inequality constraints, 2 or 3 variables)'],
  ['script name … end · function y = f(x) … end · for / while / if … end', 'MATLAB-style scripts (Shift+Enter or Enter inside a block adds lines); script variables become worksheet objects'],
  ['[1 2; 3 4] · 1:0.1:2 · v(end) · A(:, 2) · .* ./ .^ · @(x) x.^2 · rng(1) · rand · randn · randi', 'arrays, ranges, indexing, element-wise ops, anonymous functions, seeded random numbers'],
  ['plot · scatter · bar · hist · histogram(v, 30, \'Normalization\', \'pdf\') · fprintf · disp · integral · fzero · trapz · polyfit', 'script output, figures and numerical tools'],
  ['R name … end', 'real R (webR, loaded on first use): worksheet numbers / lists go in, R variables, output and plots come back'],
  ['X ~ Normal(μ, σ) · Binomial(n, p) · Poisson(μ) · Exponential(λ) · Gamma(α, β) · pmf([x…], [p…]) …', 'random variables (Devore’s parameterizations)'],
  ['P(X > a) · P(a < X <= b) · E(X) · Var(X) · SD(X) · quantile(X, p) · pdf X · cdf X · sample(X, n) · clt(X)', 'probabilities, moments, percentiles, simulation, the CLT'],
  ['Y ~ 2X + 3 · S ~ X1 + X2 · M ~ max(D1, D2) · W ~ Z^2 · Xbar ~ mean(X, n) · sum(X, n)', 'functions of random variables, sums of independent ones, sampling distributions'],
  ['E(X^2) · Var(2X - Y) · P(X + Y > 3) · P(X > Y) · P(X > 3 | X > 1) · P(X < 1 or X > 3) · lln(X)', 'E[g(X)], linear combinations, conditional probability, the law of large numbers'],
  ['X ~ density(3x^2, 0, 1) · density({0 <= x <= 1: x, 1 < x <= 2: 2 - x, 0}) · fromcdf(1 - exp(-2x), 0, ∞)', 'your own density or cdf (it must integrate to 1 — the missing constant is reported)'],
  ['normalapprox(X) · normalapprox(X <= 55) · Cov(X + Y, X - Y) · Corr(X, X + Y)', 'normal approximation with the continuity correction; covariance of independent variables'],
  ['P(A) = 0.3 · P(B | A) = 0.9 · P(B | not A) = 0.2 · independent A, B · disjoint A, C', 'facts about events (a probability space); A′, Aᶜ, ∩, ∪ also work'],
  ['P(A | B) · P(A and B) · P(A or not B)', 'solved from the facts: Bayes, total probability, with a tree diagram'],
  ['D = [ … ] · summary D · histogram D · boxplot D · normplot D', 'data: Devore’s summaries and plots'],
  ['dnorm pnorm qnorm rnorm · dbinom pbinom … rpois rexp rgamma · dhyper · dnbinom · sample(x, n, TRUE, p)', 'R distribution functions exactly as Devore writes them (pgamma(x, α, rate), scale = β)'],
  ['normpdf normcdf norminv normrnd · binopdf · expcdf(x, mean) · gamcdf(x, a, scale) · wblcdf(x, scale, shape)', 'the same distributions under MATLAB names and conventions'],
  ['fivenum · iqr · trimmean · boxplot · normplot · stem · tabulate · corr · cov', 'Devore’s descriptive statistics (hinges, mild / extreme outliers, (i − .5)/n plots)'],
  ['leftsum rightsum midsum trapsum simpsum · euler · ode45 · newton · bisection · partialsums · fourier · slopefield · quiver · fminsearch · integral2', 'Hughes-Hallett’s numerical procedures'],
  ['f(x) = {x < 0: -x, x^2} · f(x,y) = {(x,y) != (0,0): x y/(x^2 + y^2), 0} · smoothness f at (0,0)', 'piecewise definitions; limits, partials by the definition, Clairaut at the special point'],
  ['● circle left of a row', 'show / hide what the row draws (all visible objects share one 2-D / 3-D space)'],
  ['x^2 + y^2 = 9 · y < x^2 · r = 1 + cos(θ) · 10! · nCr(5,2) · mean([…])', 'graphing-calculator features'],
  ['show derivative f · hide contours · show level f = 3', 'representation control (basics are shown automatically)'],
  ['compare f with taylor f at 0 order 4', 'overlay two functions and their difference'],
  ['analyze C', 'analyse another object in the Analysis panel'],
  ['\\theta ⇥', 'type \\theta, \\pi, \\nabla … for symbols · Enter = next row'],
];

export function HelpDialog({ onClose }: { onClose(): void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>MathLab Language</span>
          <button onClick={onClose}>✕</button>
        </div>
        <table className="kv help">
          <tbody>
            {SYNTAX.map(([code, what]) => (
              <tr key={code}>
                <td><code>{code}</code></td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="builtins">
          {allBuiltins().map((b) => (
            <div key={b.name} className="builtin">
              <code>{b.signature}</code>
              <span className="dim">{b.doc}</span>
            </div>
          ))}
        </div>
        <p className="dim">
          Every object is live: edit any cell and all dependent cells and views update. Dragging a point or a vector rewrites its
          definition in the notebook. <Tex tex={'D_{\\hat u}f = \\nabla f\\cdot \\hat u'} />
        </p>
      </div>
    </div>
  );
}