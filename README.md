# MathLab — interactive mathematical analysis workbench

Define mathematical objects, and MathLab recognises them, analyses them, and lets you keep working
with the results — symbolically, numerically and geometrically.

```
f(x,y) = x^3 - 3x + y^2        ← recognised as a function ℝ² → ℝ, analysed automatically
C = critical f                 ← a typed point set: {(−1, 0) saddle, (1, 0) local min}
Q = first(C)
H = hessian f at Q
eigenvalues H
P = point(1, 0.5) draggable    ← drag it: every dependent result and visual updates
directional f at P toward (3,-2)
limit sin(x)/x as x -> 0
integrate x^2 from 0 to 1
```

The screen has three areas — **Worksheet** (one statement per row, rendered as mathematics; click to
edit) · **Canvas** (the view that fits the object: graph, 3D surface, contour map) · **Analysis**
(cards that compute only when opened). There is no mode selector: the object decides.

Principles:
- **The Analysis panel is only a presentation of the mathematics.** Every analysis fact is an ordinary
  expression (`critical(f)`, `domain(f)`, …) evaluated with the same builtins you can type, so any row
  can be pinned into the worksheet as a named object and used again.
- **Certainty is always shown**: `exact` (symbolic, or verified symbolically), `numeric` (iterative method
  with a residual check), `evidence` (sampled/scanned — not a proof). Numeric values that match a closed
  form are shown as "≈ 1 − √2", still labelled numeric.
- **Lazy analysis**: type, formula, domain and derivatives appear at once; roots, critical points,
  asymptotes, Taylor polynomials, integrals… are computed when their card is opened.
- **`show` / `hide` / `compare` stay available** as the programmable representation layer.
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

In the editor, type `\theta`, `\pi` or `\nabla` for Unicode symbols. Edits apply as you type;
Shift+Enter moves to the next cell.

## Analysis engine and linked highlighting

`src/runtime/analysis.ts` holds the analyzer registry: an analyzer recognises a value and returns a
plan of *facts* (MLL expressions), relations and sections; `AnalysisService` evaluates facts lazily and
caches them by the identity of the objects they reference. Analyzers for f(x), f(x, y) and point sets live
in `plugins/core-calculus/analyzers.ts`; the analysis builtins in `analysis-builtins.ts`. Later phases add
analyzers (3-D scalar fields, vector fields, distributions, optimisation problems, sequences) to the same
registry.

Every scene item carries the keys of the objects it represents (`u`, `role:gradient`, …). Hovering
or selecting an object anywhere — an arrow in 2D or 3D, a notebook row, a value, a term of an
explanation formula — emphasises all its representations and dims the rest; hovering `‖∇f‖` or
`cos φ` in the explanation isolates just those objects.

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

Phase 1 (done): workbench shell, object recognition, lazy analysis of f(x) and f(x, y), CAS commands
(derivative, integrate, limit, solve, taylor, critical/zeros/extrema/inflections, domain, monotonicity,
concavity, asymptotes, tangent, directional), typed results with certainty, `show`/`hide`/`compare`.

Next phases, each adding analyzers and value kinds to the same registries:
2. Constrained optimisation (`maximize f subject to g = c`, Lagrange geometry) and f(x, y, z)
   (level surfaces).
3. Probability & statistics (`X ~ Normal(0, 1)`, `Y = X^2`, pdf/cdf/samples, sampling distributions).
4. Vector fields, div/curl, line and surface integrals, flux.
5. Sequences and series.