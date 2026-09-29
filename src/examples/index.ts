/** Example documents. Each is a list of notebook cells. */

export interface Example {
  id: string;
  title: string;
  course: string;
  cells: string[];
}

export const flagship: Example = {
  id: 'gradient-lab',
  title: 'Gradient, tangent plane & directional derivative',
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
  flagship,
  {
    id: 'saddle',
    title: 'A saddle point',
    course: 'Multivariable Calculus',
    cells: [
      'f(x,y) = x^2 - y^2',
      'P = point(0.8, -0.6) draggable',
      'show surface(f), contours(f), grad(f) at P\nshow tangent_plane(f, P), level(f, P)\nshow hessian_axes(f, P), quadratic(f, P)',
      'H = hessian(f) at P',
    ],
  },
  {
    id: 'waves',
    title: 'Parameters & animation',
    course: 'Multivariable Calculus',
    cells: [
      'a = slider(-2, 2, 1)\nt = slider(0, 2π, 0)',
      'f(x,y) = a sin(x + t) cos(y - t)',
      'P = point(0.5, 0.5) draggable',
      'show surface(f), contours(f), grad(f) at P, tangent_plane(f, P)',
      'animate t from 0 to 2π',
    ],
  },
  {
    id: 'peaks',
    title: 'Local extrema & gradient ascent',
    course: 'Multivariable Calculus',
    cells: [
      'f(x,y) = 3(1-x)^2 exp(-x^2 - (y+1)^2) - 10(x/5 - x^3 - y^5) exp(-x^2 - y^2) - exp(-(x+1)^2 - y^2)/3',
      'P = point(0.3, 0.9) draggable',
      'show surface(f), contours(f, 24)\nshow grad(f) at P, gradient_path(f, P)\nshow level(f, P)',
    ],
  },
  {
    id: 'single-variable',
    title: 'Derivative of one variable',
    course: 'Calculus I',
    cells: ['f(x) = sin(x) + x/3', "show f, f'", 'a = slider(-3, 3, 1)', "m = f'(a)"],
  },
];
