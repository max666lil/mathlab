/** Example documents. Each is a list of notebook cells. */

export interface Example {
  id: string;
  title: string;
  course: string;
  cells: string[];
}

export const flagship: Example = {
  id: 'gradient-lab',
  title: 'Gradient lab (explicit show statements)',
  course: 'Multivariable Calculus',
  cells: [
    '# A scalar field — edit it and everything updates\nf(x,y) = x^2 + 2y^2',
    '# Drag P in the contour map or on the surface\nP = point(1, 1) draggable',
    '# A unit direction — drag the tip of u, or play θ\nθ = slider(0, 2π, 0.6)\nu = <cos θ, sin θ>',
    'g = grad(f) at P\nH = hessian(f) at P\nD = g · u',
    'show surface(f), contours(f)\nshow g, arrow(P, u)\nshow tangent_plane(f, P), level(f, P)',
    '# Cross-sections through P: slopes are ∂f/∂x, ∂f/∂y and D_u f\nshow slice(f, x = P.x), slice(f, y = P.y)\nshow slice(f, P, u)',
    'show hessian_axes(f, P), gradient_path(f, P)\nshow quadratic(f, P) hidden',
    'animate θ from 0 to 2π',
  ],
};

export const examples: Example[] = [
  {
    id: 'surface',
    title: 'Function of two variables — gradient & tangent plane',
    course: 'Multivariable Calculus',
    cells: ['f(x,y) = x^2 + 2y^2', 'P = point(1, 1) draggable', 'θ = slider(0, 2π, 0.6)', 'u = <cos θ, sin θ>'],
  },
  {
    id: 'cubic',
    title: 'Function of one variable — full analysis',
    course: 'Calculus I',
    cells: ['f(x) = x^3 - 3x'],
  },
  {
    id: 'tangent',
    title: 'Derivative & tangent line at a point',
    course: 'Calculus I',
    cells: ['f(x) = sin(x) + x/3', 'a = slider(-5, 5, -2.744)', "f'(a)"],
  },
  {
    id: 'rational',
    title: 'Rational function — asymptotes',
    course: 'Calculus I',
    cells: ['f(x) = (x^2 + 1)/(x - 1)'],
  },
  {
    id: 'saddle',
    title: 'Critical points of a surface',
    course: 'Multivariable Calculus',
    cells: ['f(x,y) = x^3 - 3x + y^2', 'C = critical f', 'P = point(0.5, 0.8) draggable'],
  },
  {
    id: 'cas',
    title: 'Calculations (CAS)',
    course: 'Calculus I–II',
    cells: [
      'limit sin(x)/x as x -> 0',
      'limit (1 + 1/x)^x as x -> ∞',
      'integrate x^2 from 0 to 1',
      'integrate x*exp(x^2)',
      'solve x^2 - x - 1 = 0',
      'taylor exp(x) at 0 order 4',
      'derivative x^2 sin(x)',
    ],
  },
  {
    id: 'objects',
    title: 'Results are objects',
    course: 'Multivariable Calculus',
    cells: ['f(x,y) = x^2 - y^2 + x*y/2', 'C = critical f', 'Q = first(C)', 'H = hessian f at Q', 'eigenvalues H', 'P = point(1, 0.5) draggable', 'directional f at P toward (3,-2)'],
  },
  {
    id: 'peaks',
    title: 'Peaks — extrema & gradient ascent',
    course: 'Multivariable Calculus',
    cells: ['f(x,y) = 3(1-x)^2 exp(-x^2 - (y+1)^2) - 10(x/5 - x^3 - y^5) exp(-x^2 - y^2) - exp(-(x+1)^2 - y^2)/3', 'P = point(0.3, 0.9) draggable'],
  },
  {
    id: 'matrix',
    title: 'Matrix as a transformation — eigenvectors',
    course: 'Linear Algebra',
    cells: ['A = [[2,1],[1,2]]', 'v = <1, 2> draggable', 'w = A v'],
  },
  {
    id: 'shear',
    title: 'Shear — not diagonalizable',
    course: 'Linear Algebra',
    cells: ['S = [[1,1],[0,1]]'],
  },
  {
    id: 'rotation',
    title: 'Rotation — complex eigenvalues',
    course: 'Linear Algebra',
    cells: ['θ = slider(0, 2π, 0.8)', 'R = [[cos θ, -sin θ],[sin θ, cos θ]]'],
  },
  {
    id: 'singular3',
    title: 'Singular 3×3 — space collapses onto a plane',
    course: 'Linear Algebra',
    cells: ['B = [[1,0,1],[0,1,1],[1,1,2]]'],
  },
  {
    id: 'shear3',
    title: '3×3 transformation — shear and stretch in space',
    course: 'Linear Algebra',
    cells: ['M = [[1,1,0],[0,1,0],[0,0,2]]', 'v = <1, 1, 1>'],
  },
  {
    id: 'la-system',
    title: 'Linear system — the row picture',
    course: 'Linear Algebra',
    cells: ['X = solve([[1,1,1],[1,-1,0],[0,1,-1]], <3, 0, 0>)', 'analyze X'],
  },
  {
    id: 'la-projection',
    title: 'Projection onto a plane, least squares',
    course: 'Linear Algebra',
    cells: ['W = span(<1,0,1>, <0,1,1>)', 'v = <1, 2, 0>', 'project v onto W'],
  },
  {
    id: 'linear-map',
    title: 'Linear map T(x, y) — its matrix',
    course: 'Linear Algebra',
    cells: ['T(x,y) = (x + y, 2y)'],
  },
  {
    id: 'rotation-field',
    title: 'Vector field — rotation (curl 2, div 0)',
    course: 'Vector Calculus',
    cells: ['F(x,y) = <-y, x>', 'P = point(1.5, 0.5) draggable'],
  },
  {
    id: 'source-field',
    title: 'Vector field — a source (div 2)',
    course: 'Vector Calculus',
    cells: ['F(x,y) = <x, y>', 'P = point(1, 1) draggable'],
  },
  {
    id: 'gradient-field',
    title: 'Gradient field — conservative, harmonic potential',
    course: 'Vector Calculus',
    cells: ['f(x,y) = x^2 - y^2', 'G = gradient f', 'analyze G'],
  },
  {
    id: 'vortex',
    title: 'Vortex — curl 0 but not conservative',
    course: 'Vector Calculus',
    cells: ['F(x,y) = <-y/(x^2 + y^2), x/(x^2 + y^2)>'],
  },
  {
    id: 'damped',
    title: 'Equilibria — a stable spiral',
    course: 'Vector Calculus',
    cells: ['F(x,y) = <y, -x - y/2>'],
  },
  {
    id: 'field3d',
    title: 'Vector field in space',
    course: 'Vector Calculus',
    cells: ['F(x,y,z) = <-y, x, z/2>', 'P = point(1, 0.5, 0.5) draggable'],
  },
  {
    id: 'curve-circulation',
    title: 'Line integral — work around a circle',
    course: 'Vector Calculus',
    cells: ['F(x,y) = <-y, x/2 + y>', 'C(t) = (cos t, sin t)'],
  },
  {
    id: 'green',
    title: "Green's theorem — cells cancel inside an ellipse",
    course: 'Vector Calculus',
    cells: ['F(x,y) = <-y + x y, x>', 'C(t) = (2cos t, 1.3sin t)', 'analyze F'],
  },
  {
    id: 'helix',
    title: 'Space curve — helix, curvature, work',
    course: 'Vector Calculus',
    cells: ['F(x,y,z) = <-y, x, 1>', 'H(t) = (cos t, sin t, t/4) for t in [0, 4π]', 't0 = slider(0, 4π, 2)'],
  },
  {
    id: 'sphere-flux',
    title: 'Surface flux and the divergence theorem (sphere)',
    course: 'Vector Calculus',
    cells: ['F(x,y,z) = <x, y, z/2>', 'S(u,v) = (cos u sin v, sin u sin v, cos v) for u in [0, 2π], v in [0, π]'],
  },
  {
    id: 'stokes',
    title: "Stokes' theorem — hemisphere and its boundary circle",
    course: 'Vector Calculus',
    cells: ['F(x,y,z) = <-y, x, z>', 'H(u,v) = (cos u sin v, sin u sin v, cos v) for u in [0, 2π], v in [0, π/2]'],
  },
  {
    id: 'earth-field',
    title: 'Temperature inside the Earth — level spheres, slice, gradient ⟂ level surface',
    course: 'Multivariable Calculus',
    cells: ['T(x,y,z) = 6000 - 5700 (x^2 + y^2 + z^2)', 'P = point(0.6, 0.3, 0.4)', 'c = slider(-2, 2, 0)'],
  },
  {
    id: 'quadrics',
    title: 'Level surfaces of x² + y² − z²: hyperboloids and a cone',
    course: 'Multivariable Calculus',
    cells: ['f(x,y,z) = x^2 + y^2 - z^2', 'x^2 + y^2 - z^2 = 1', 'x^2 + y^2 - z^2 = -1'],
  },
  {
    id: 'lagrange',
    title: 'Lagrange multipliers — the level curve touches the constraint (∇f ∥ ∇g)',
    course: 'Multivariable Calculus',
    cells: ['f(x,y) = 4 - x^2 - 2y^2', 'L = maximize f subject to x^2 + y^2 = 1'],
  },
  {
    id: 'lagrange-budget',
    title: 'Lagrange — production x^(2/3) y^(1/3) on a budget line (λ = shadow price)',
    course: 'Multivariable Calculus',
    cells: ['P(x,y) = x^(2/3) y^(1/3)', 'B = maximize P subject to x + y = 3.78 and x >= 0 and y >= 0'],
  },
  {
    id: 'piecewise-clairaut',
    title: 'Piecewise — mixed partials that differ: f_xy(0,0) ≠ f_yx(0,0)',
    course: 'Multivariable Calculus',
    cells: ['f(x,y) = {(x,y) != (0,0): x y (x^2 - y^2)/(x^2 + y^2), 0}', 'g(x,y) = {(x,y) != (0,0): x y/(x^2 + y^2), 0}'],
  },
  {
    id: 'piecewise-1d',
    title: 'Piecewise f(x) — corners, jumps and removable holes',
    course: 'Calculus I',
    cells: ['f(x) = {x < 0: -x, x <= 2: x^2, 4}', 'k(x) = {x != 0: sin(x)/x, 1}'],
  },
  {
    id: 'disk-integral',
    title: 'Double integral over the unit disk — 7π/2 in polar coordinates',
    course: 'Multivariable Calculus',
    cells: ['f(x,y) = 4 - x^2 - y^2', 'R = x^2 + y^2 <= 1'],
  },
  {
    id: 'region-between',
    title: 'Region between y = x² and y = x — both orders of integration',
    course: 'Multivariable Calculus',
    cells: ['D = 0 <= x <= 1 and x^2 <= y <= x', 'mass 1 + x over D'],
  },
  {
    id: 'swap-order',
    title: 'Swap the order: ∫∫ x√(y³+1) becomes exact',
    course: 'Multivariable Calculus',
    cells: ['g(x,y) = x sqrt(y^3 + 1)', 'D = 0 <= x <= 6 and x/3 <= y <= 2', 'integrate g over D'],
  },
  {
    id: 'polar-sector',
    title: 'Polar region — a cardioid and a sector',
    course: 'Multivariable Calculus',
    cells: ['C = r <= 1 + cos(θ)', 'S = 1 <= r <= 2 and 0 <= θ <= π/4', 'integrate (x^2 + y^2)^(-3/2) over S'],
  },
  {
    id: 'polar-map',
    title: 'Polar coordinates as a map — the grid bends, det J = r',
    course: 'Multivariable Calculus',
    cells: ['T(r, θ) = (r cos(θ), r sin(θ))', 'S(ρ, φ, θ) = (ρ sin(φ) cos(θ), ρ sin(φ) sin(θ), ρ cos(φ))', 'det(jacobian S)'],
  },
  {
    id: 'solid-ball',
    title: 'Solids — half ball in spherical coordinates, a cone',
    course: 'Multivariable Calculus',
    cells: ['E = x^2 + y^2 + z^2 <= 4 and z >= 0', 'K = sqrt(x^2 + y^2) <= z <= 3', 'mass z over K'],
  },
  {
    id: 'normal-rv',
    title: 'Random variable — N(64, 0.78): P(a < X ≤ b) under sliders, percentiles, CLT',
    course: 'Probability & Statistics',
    cells: ['X ~ Normal(64, 0.78)', 'a = slider(61, 67, 63)', 'b = slider(61, 67, 65)', 'quantile(X, 0.995)'],
  },
  {
    id: 'binomial-rv',
    title: 'Binomial(15, 0.2) — pmf bars, P(X ≤ 8), cdf step function',
    course: 'Probability & Statistics',
    cells: ['X ~ Binomial(15, 0.2)', 'P(X <= 8)', 'E(X)', 'Var(X)'],
  },
  {
    id: 'exponential-clt',
    title: 'The central limit theorem — means of an exponential (skewed) population',
    course: 'Probability & Statistics',
    cells: ['T ~ Exponential(0.5)', 'clt(T)'],
  },
  {
    id: 'dataset-fuel',
    title: 'Data — fuel efficiency (Devore Ex 1.16): fourths, outliers, histogram, boxplot, normal plot',
    course: 'Probability & Statistics',
    cells: ['D = [31.0, 27.8, 38.3, 27.0, 23.4, 30.0, 30.1, 21.5, 25.4, 34.5]'],
  },
  {
    id: 'script-clt',
    title: 'Script — the central limit theorem by simulation',
    course: 'Probability & Statistics',
    cells: [
      "script clt\n  rng(1);\n  n = 30; k = 2000;\n  means = zeros(1, k);\n  for i = 1:k\n    means(i) = mean(rand(1, n));\n  end\n  histogram(means, 30, 'Normalization', 'pdf')\n  title('Means of 30 uniforms')\n  fprintf('mean %.4f, sd %.4f (theory 0.5, %.4f)\\n', mean(means), std(means), sqrt(1/12/n));\nend",
    ],
  },
  {
    id: 'script-euler',
    title: "Script — Euler's method for y′ = y (functions, loops, plots)",
    course: 'Differential Equations',
    cells: [
      'function y = euler(f, y0, h, n)\n  y = zeros(1, n + 1);\n  y(1) = y0;\n  for k = 1:n\n    y(k + 1) = y(k) + h * f((k - 1) * h, y(k));\n  end\nend',
      "script ode\n  h = 0.1; n = 10;\n  x = 0:h:1;\n  y = euler(@(x, y) y, 1, h, n);\n  plot(x, y, 'o'); hold on; plot(x, exp(x));\n  err = exp(1) - y(end)\nend",
    ],
  },
  {
    id: 'script-devore',
    title: 'Script — Devore: boxplot, normal plot and a compound Poisson simulation (R functions)',
    course: 'Probability & Statistics',
    cells: [
      "script fuel\n  x = [31.0 27.8 38.3 27.0 23.4 30.0 30.1 21.5 25.4 34.5];\n  five = fivenum(x)\n  s = sd(x)\n  boxplot(x)\n  title('Fuel efficiency (Ex 1.16)')\nend",
      "script packages\n  rng(1); N = 10000; small = 0;\n  for i = 1:N\n    x = rpois(1, 5);\n    p = sum(sample(c(1, 2, 3, 4), x, TRUE, c(.4, .3, .2, .1)));\n    small = small + (p <= 10);\n  end\n  phat = small / N\n  se = sqrt(phat * (1 - phat) / N)\nend",
      "script tables\n  p1 = pbinom(8, 15, .2)\n  p2 = dhyper(2, 5, 20, 10)\n  p3 = 1 - pgamma(15, 2, 1/2.5)\n  z = qnorm(.995, 64, .78)\nend",
    ],
  },
  {
    id: 'script-birthday',
    title: 'Script — Monte Carlo: the birthday problem',
    course: 'Probability & Statistics',
    cells: [
      'script birthday\n  rng(7); trials = 5000; n = 23; hits = 0;\n  for t = 1:trials\n    b = randi(365, 1, n);\n    if numel(unique(b)) < n\n      hits = hits + 1;\n    end\n  end\n  phat = hits / trials\n  se = sqrt(phat * (1 - phat) / trials)\nend',
    ],
  },
  {
    id: 'parameter',
    title: 'Parameters — watch the analysis update',
    course: 'Calculus I',
    cells: ['a = slider(-3, 3, 1)', 'f(x) = x^3 - a x', 'animate a from -3 to 3'],
  },
  flagship,
];