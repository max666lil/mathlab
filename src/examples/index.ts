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
    id: 'solid-ball',
    title: 'Solids — half ball in spherical coordinates, a cone',
    course: 'Multivariable Calculus',
    cells: ['E = x^2 + y^2 + z^2 <= 4 and z >= 0', 'K = sqrt(x^2 + y^2) <= z <= 3', 'mass z over K'],
  },
  {
    id: 'parameter',
    title: 'Parameters — watch the analysis update',
    course: 'Calculus I',
    cells: ['a = slider(-3, 3, 1)', 'f(x) = x^3 - a x', 'animate a from -3 to 3'],
  },
  flagship,
];