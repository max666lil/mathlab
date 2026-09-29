# MathLab

An interactive laboratory for first- and second-year university mathematics. Every object is
explorable at the same time as an equation, as geometry, as numbers and as an animation, and all
views stay linked.

This is the first vertical slice: a reactive math language, a notebook, and linked 2D/3D views,
built around the **gradient / tangent-plane lab**:

```
f(x,y) = x^2 + 2y^2
P = point(1, 1) draggable
θ = slider(0, 2π, 0.6)
u = <cos θ, sin θ>
g = grad(f) at P
H = hessian(f) at P
D = g · u
show surface(f), contours(f)
show g, arrow(P, u)
show tangent_plane(f, P), level(f, P)
show slice(f, x = P.x), slice(f, y = P.y), slice(f, P, u)
show hessian_axes(f, P), gradient_path(f, P)
show quadratic(f, P) hidden
animate θ from 0 to 2π
```

You can drag P in the contour map, on the 3D surface, or along a cross-section. You can also drag
the tip of `u`, which solves for θ. Everything that depends on P or θ updates on the same frame:
f(P), ∇f(P), H(P), D_u f, the tangent plane, the level curve, the slices, the principal
directions and the steepest path. Dragging also rewrites the definition in the notebook, and
editing the text moves the objects.

## Running

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: parser, symbolic calculus, graph, runtime, examples
npm run typecheck
```

## Architecture

```
src/
  math-core/        framework-free mathematics
    ast.ts            expression AST (with source spans)
    symbolic/         simplify, diff (d/dx, ∇, Hessian), print (MLL text + LaTeX)
    compile.ts        AST → fast JS closure (only literals / whitelisted functions emitted)
    values.ts         typed MathValues + open value-kind registry
    builtins.ts       registry of value-level operators
    linalg.ts, numeric.ts, scalar-functions.ts
  parser/           MLL lexer + Pratt parser + extensible statement rules
  runtime/
    graph.ts          generic reactive DAG (value-agnostic; topological, minimal recompute)
    document.ts       cells → statements → graph nodes; input statements rewrite their own source
    evaluator.ts      typed evaluation, function lifting/inlining, xy → x·y, f', f_x
    workspace.ts      the single facade the UI talks to (inputs, inverse drag solving, scene
                      items, selection, linked hover, animations)
  visualization/    renderer-level, framework-free
    scene-model.ts    MathValue → declarative visual items (+ semantic colours)
    sampling.ts       grids, marching squares, slices, steepest paths, shared scene frame
    2d/               canvas domain view, cross-section view, drawer registry
    3d/               Three.js scene view, world map (z-scaling + flatten), camera shots
    animation/clock.ts
  plugins/
    plugin-api.ts     definePlugin / installPlugin
    core-calculus/    grad, hessian, partial, tangent_plane, slice, … + their 2D/3D visuals,
                      implemented as a plugin through the same API third parties use
  ui-react/         React owns only layout, notebook editors and panels
```

How data flows:

1. The **document** parses every cell into statements. Each statement becomes a **graph node**
   whose dependencies are the names it references.
2. The **graph** evaluates nodes into typed **MathValues** (a point, a function with its symbolic
   body, a plane, a slice, a visual). When an input changes, it recomputes only that input's
   descendants. Moving P never re-samples the surface.
3. `show` statements and visible named objects become **scene items**. The 2D and 3D renderers
   draw each item type through registries. Both views share one frame and one colormap, so the
   same object has the same colour and position everywhere.
4. **Direct manipulation** goes back through the workspace. `setPoint` / `setSlider` update the
   graph immediately and the source text shortly after. Dragging a derived object (the tip of
   `u = <cos θ, sin θ>`) runs a damped Gauss–Newton solve over the upstream inputs.

The graph does not know about calculus, and renderers do not know about statements. That is the
seam the probability engine will use. `X ~ Normal(0,1)` becomes a plugin statement rule, a
`random-variable` value kind and sample nodes (the graph already reserves a `heavy` flag for
off-thread Monte Carlo). `Y = X^2` becomes a transform node, and pdf/cdf/histogram become
registered visuals. None of this changes the core runtime.

## MLL quick reference

| Syntax | Meaning |
| --- | --- |
| `f(x,y) = x^2 + 2y^2` | function (implicit multiplication, `x²`, `π`, `θ`, `\|x\|`) |
| `P = point(1, 1) draggable` | a draggable point |
| `a = slider(-5, 5, 1)` / `a ∈ [-5, 5]` | parameter with a slider |
| `u = <cos θ, sin θ>` | vector |
| `grad(f) at P`, `∇f(P)`, `grad f at P` | gradient at a point |
| `f'(x)`, `f_x`, `f_xy`, `partial(f, x)` | derivatives |
| `hessian(f) at P`, `dirderiv(f, P, u)`, `linearization(f, P)`, `taylor2(f, P)` | local analysis |
| `g · u`, `norm`, `normalize`, `cross`, `det`, `transpose`, `eigenvalues` | vectors & matrices |
| `show surface(f), contours(f, 20)` | add to the views (`hidden` to create switched off) |
| `slice(f, x = P.x)`, `slice(f, P, u)` | vertical cross-sections |
| `tangent_plane`, `level`, `hessian_axes`, `gradient_path`, `quadratic`, `arrow` | visual objects |
| `animate θ from 0 to 2π` | animation |

In the editor, type `\theta`, `\pi` or `\nabla` for Unicode symbols. Shift+Enter runs a cell and
moves to the next one.

## Writing a plugin

```ts
import { definePlugin, installPlugin } from './plugins/plugin-api';
import { registerDrawer2D } from './visualization/2d/registry2d';

installPlugin(definePlugin({
  name: 'my-plugin',
  install(api) {
    api.registerBuiltin({ name: 'laplacian', minArgs: 1, maxArgs: 1, argModes: ['function'],
      signature: 'laplacian(f)', doc: 'Δf', category: 'calculus',
      apply: ([f], ctx) => /* build a FunctionValue with ctx.makeFunction(...) */ f! });
  },
}));
registerDrawer2D('my-visual', { layer: 3, draw: (a) => { /* canvas drawing */ } });
```

## Status and next steps

Done in this slice: the parser and symbolic core, the reactive graph, the notebook with
two-way source sync, linked 2D/3D/slice views, camera shots and the flatten morph, the Hessian
and quadratic approximation, the steepest paths, and the local analysis and explanation panel.

Next:
- **Probability engine**, following the design above, then the `X ~ Normal(0,1)`, `Y = X²`
  flagship.
- A secant → tangent derivative demo, a local-approximation "microscope" that re-samples when
  zoomed, and a Lagrange-multiplier scene.
- Vector-field lab (3D fields, curl paddle wheel, flux) and linear-algebra grid transforms.
- An AI tutor that drives the workspace API (show / highlight / camera shot / animate).