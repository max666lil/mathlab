# MathLab Roadmap

MathLab is an **interactive mathematical analysis workbench** for first- and second-year university
mathematics and statistics (courses such as MAT135/136/137, MAT223/224, MAT235/237, STA237/238/257).

The user defines mathematical objects; MathLab recognises them, analyses them, produces new objects,
visualises them, and lets the user keep operating:

```
define objects → automatic understanding → analysis → new objects → visualization → keep operating
```

It should feel as simple as Desmos at first glance and as deep as a mathematical workstation when needed.

> Phases are only the **development order**. The product is one object system —
> **Objects + Operations + Relations + Analysis + Visualization** — never a set of "modes" or topic demos.

| Phase | Core capabilities | Mathematical world | Status |
|---|---|---|---|
| 1 | f(x), f(x,y), derivatives, limits, integrals, Taylor, gradient, Hessian, critical points | one-variable and multivariable functions | ✅ done |
| 2 | f(x,y,z), level surfaces, constraints, Lagrange multipliers | 3-D scalar fields + optimisation | next — [spec](phases/phase-2.md) |
| 3 | double/triple integrals, regions, polar/cylindrical/spherical coordinates, Jacobian, change of variables | multiple integrals and coordinate systems | planned |
| 4 | vectors, matrices, linear maps, span, basis, rank, null space, eigenvalues/eigenvectors, determinant | linear algebra | planned |
| 5 | distributions, random-variable transformations, joint/conditional, expectation, sampling, CLT, estimation | probability and statistics | planned |
| 6 | vector fields, flow, line/surface integrals, curl, divergence, flux, Green/Stokes/Divergence theorems | vector calculus | planned |
| 7 | sequences, series, power series, Taylor series, convergence | infinite processes | planned |

---

## 1. Invariant principles

These hold in every phase. A feature that violates one of them is not done.

1. **Results are objects.**
   > The Analysis panel is not the mathematical truth; it is only one presentation of the mathematical
   > truth. Every meaningful result produced by an analyzer must exist as a typed, addressable mathematical
   > object or relation in the runtime whenever possible, so it can be referenced, transformed, analyzed
   > again, or visualized independently. Never encode mathematical knowledge only as UI rows or prose.

   Every analysis fact is an ordinary MLL expression evaluated by the same builtins a user can type
   (`critical(f)`, `domain(f)`, …), and can be pinned into the worksheet as a named object.
2. **Certainty is always visible.** Every result carries `exact` (symbolic, or verified symbolically),
   `numeric` (iterative method with a residual check) or `evidence` (sampled / scanned — not a proof),
   plus an evidence string (method, window, sample size, error estimate). A numeric value that matches a
   closed form is shown as "≈ 1 − √2" and stays `numeric`.
3. **Lazy analysis.** Tier-0 facts (type, formula, domain, derivative) appear immediately; tier-1 facts
   (roots, critical points, integrals, simulations …) are computed only when their card is opened or the
   object is referenced, off the typing path, and memoised.
4. **Object recognition, not modes.** The user never chooses "calculus mode" or "statistics mode". The
   first analyzer that recognises the focused object wins.
5. **The analyzer decides the workspace.** Each analyzer returns a `WorkspaceLayout` (canvas title,
   views, combinations). The UI contains no `if (f is 1-D) …` routing.
6. **Representation is programmable.** Basics are shown automatically; `show`, `hide`, `compare`
   (and later `plot`, `animate`, `slice`, `trace`, `highlight`) stay available and override defaults.
7. **Every visualization answers a mathematical question.** Depth over breadth; one excellent flagship
   per phase before widening.

---

## 2. Object system

Three layers, one language:

| Layer | Examples |
|---|---|
| Mathematical world (definitions) | `f(x) = sin(x)/x`, `A = [[2,1],[1,2]]`, `P = (1,2)`, `X ~ Normal(0,1)`, `F(x,y) = <-y, x>`, `R = x^2 + y^2 <= 1` |
| Analysis (operations producing objects) | `limit f as x -> 0`, `derivative f`, `critical f`, `eigenvectors A`, `expectation X`, `curl F`, `integrate f over R` |
| Representation | `show`, `hide`, `compare`, `plot`, `animate`, `slice`, `trace`, `highlight` |

### Object kinds by phase

| Kind | Introduced | Notes |
|---|---|---|
| ScalarField1D / 2D (`function`) | 1 | FunctionValue with 1 or 2 params, symbolic body |
| PointSet, Intervals, Domain, Limit, Asymptotes | 1 | typed analysis results with certainty |
| Point, Vector, Matrix (numeric) | 1 | already exist; become first-class in Phase 4 |
| ScalarField3D, Constraint, OptimizationProblem, Candidates | 2 | |
| Region (2-D / 3-D), Integral, CoordinateSystem, Jacobian | 3 | Jacobian is a Matrix-valued function |
| LinearMap, Subspace (span / null space / column space), Basis | 4 | |
| Distribution, RandomVariable, Sample, Estimator | 5 | samples are heavy nodes (seeded RNG, worker) |
| VectorField, Curve (parametric), Surface (parametric), Flow | 6 | |
| Sequence, Series, PowerSeries | 7 | |

### Cross-phase flows (why one object system matters)

```
f(x,y) = x^2 - y^2          ScalarField2D           (Phase 1)
H = hessian f               MatrixField             (Phase 1)
A = H at (0,0)              Matrix                  (Phase 1 → Phase 4)
eigenvectors A              Vectors                 (Phase 4)
show eigenvectors A         visualization

J = jacobian (r cos θ, r sin θ)    Matrix-valued function → det J = r    (Phase 3 → Phase 4)
X ~ Uniform(0,1); Y = X^2   RandomVariable → Transformation → RandomVariable (Phase 5)
F = gradient f              VectorField              (Phase 1 → Phase 6)
```

Any matrix- or vector-valued fact offers **"Analyze as matrix / vector"** — e.g. the Hessian at a point
opens the Phase 4 matrix analysis.

---

## 3. Extension points in the current code

Every phase plugs into existing registries; the core runtime is not restructured.

| Extension point | Where | Used for |
|---|---|---|
| `registerAnalyzer`, `AnalysisPlan`, `WorkspaceLayout`, facts / sections / relations | `src/runtime/analysis.ts` | recognising a new object kind and planning its analysis + canvas |
| `registerBuiltin` (with `command`, `keywords`, `argModes`) | `src/math-core/builtins.ts` | new operations and command syntax (`integrate f over R`, `expectation X`) |
| Command clause parsing, statement rules, `registerStatementRule` | `src/parser/parser.ts` | new statement forms (`maximize … subject to …`, `X ~ Normal(0,1)`) |
| `registerValueKind` | `src/math-core/values.ts`, `src/math-core/result-values.ts` | new typed results (Region, Distribution, Subspace …) |
| Default visuals, 2-D drawers, 3-D visuals | `src/visualization/scene-model.ts`, `src/visualization/2d/registry2d.ts`, `src/visualization/3d/registry3d.ts` | drawing new kinds |
| Emphasis relations | `src/visualization/presentation.ts` (`registerRelation`) | linked highlighting between related objects |
| Heavy graph nodes | `src/runtime/graph.ts` (`heavy` flag, reserved) | Monte Carlo, marching cubes in workers |
| Plugin API | `src/plugins/plugin-api.ts` | each phase ships as a plugin (like `plugins/core-calculus`) |
---

## 4. Phases

Every phase section uses the same template: goal · objects · operations & commands · analyzers &
layout · canvas · explanations · flagship acceptance · certainty · dependencies · out of scope.

### Phase 1 — Functions of one and two variables ✅

- **Goal**: a real analysis tool for f(x) and f(x,y) — not a calculator, not a demo.
- **Objects**: ScalarField1D/2D, PointSet (critical points, zeros, solutions), Intervals, Domain, Limit,
  Asymptotes, Point, Vector, Matrix, Plane, Slice.
- **Operations**: `derivative`, `gradient`, `hessian`, `integrate`, `limit`, `solve`, `taylor`, `critical`,
  `zeros`, `extrema`, `inflections`, `domain`, `monotonicity`, `concavity`, `asymptotes`, `tangent`,
  `directional`, `first`, `C[k]`, `analyze`; `show` / `hide` / `compare`.
- **Analyzers**: `function-1d` (layout: Graph), `function-2d` (layout: 3D / Contour / Both), `pointset`.
- **Canvas**: graph with markers, asymptotes, tangent line; surface, contours, gradient, tangent plane,
  level curve, slices, principal directions, steepest paths, quadratic approximation.
- **Flagships (passing)**: `f(x,y) = x^2 + 2y^2` with draggable P and direction u; `f(x) = sin(x) + x/3`
  with slider a and tangent line; `C = critical f → Q = first(C) → H = hessian f at Q → eigenvalues H`.
- **Known limits**: see §6.

### Phase 2 — 3-D scalar fields and constrained optimisation (next)

Full specification: **[phases/phase-2.md](phases/phase-2.md)**.

- **Goal**: leave "z = f(x,y) only" — true fields `T: ℝ³ → ℝ` and optimisation under constraints.
- **Objects**: ScalarField3D, Constraint, OptimizationProblem, Candidates, 3-D Point, LevelSurface.
- **Operations**: `maximize|minimize f subject to g = c`, `lagrange`, `level T = c`, `slice T at x = a`,
  3-D `critical`, `gradient`, `hessian`, `directional`.
- **Analyzers**: `scalar-field-3d`, `optimization`.
- **Flagships**: the **Earth** temperature field `T(x,y,z)` (radial symmetry, spherical level surfaces,
  slice plane) and the **Lagrange** scene `maximize 4 - x^2 - 2y^2 subject to x^2 + y^2 = 1`
  (level curve expanding until it first touches the constraint; ∇f = λ∇g).
- **Dependencies**: Phase 1 engine; new equal-aspect 3-D world map; marching cubes.

### Phase 3 — Multiple integrals and coordinate systems

- **Goal**: make ∬ f dA and ∭ f dV geometric, and make dA = r dr dθ something you *see*, not memorise.
- **Objects**: Region (inequalities, type I/II descriptions, polar/cylindrical/spherical descriptions),
  Integral (iterated, with bounds), CoordinateSystem, Jacobian (matrix-valued function).
- **Operations**: `R = x^2 + y^2 <= 1`, `integrate f over R`, `integrate f over R in polar`,
  `coordinates polar | cylindrical | spherical`, `jacobian T`, `bounds R`, `area R`, `volume E`,
  `change of variables u = …, v = …`, `swap order`.
- **Analyzers**: `region` (layout: region in the plane / in space), `integral` (layout: surface over the
  region + volume + iterated-bounds view).
- **Canvas**: region shading in the xy-plane; surface z = f(x,y) above it; the volume; an infinitesimal
  column f dA; Riemann boxes refining to the integral; iterated-integral sweep (inner then outer).
- **Explanations**: a dx dy cell deforms continuously into an r dr dθ sector (area scale = |det J| = r);
  the same for cylindrical (r dr dθ dz) and spherical (ρ² sin φ dρ dφ dθ) cells.
- **Flagship acceptance**:
  ```
  R = x^2 + y^2 <= 1
  f(x,y) = 4 - x^2 - y^2
  I = integrate f over R          # 7π/2, exact via polar
  coordinates polar               # animates dx dy → r dr dθ, shows dA = r dr dθ
  J = jacobian (r cos θ, r sin θ) # Matrix-valued; det J = r
  ```
  plus a triple integral over a ball in spherical coordinates.
- **Certainty**: exact when bounds and antiderivatives are symbolic; numeric (adaptive cubature with error
  estimate) otherwise; region descriptions from inequalities are exact, sampled boundaries are evidence.
- **Dependencies**: Phase 1 integration (`antiderivative`, quadrature), Phase 2 3-D rendering; the
  Jacobian is the first Matrix-valued object consumed by Phase 4.
- **Out of scope**: general improper multiple integrals, surface integrals (Phase 6).

### Phase 4 — Linear algebra

- **Goal**: matrices and linear maps as first-class objects with geometric meaning.
- **Objects**: Vector, Matrix, LinearMap, Subspace (span, null space, column/row space), Basis,
  Eigenpairs, Projection, LeastSquaresProblem.
- **Operations**: `analyze A`, `det`, `rank`, `rref`, `inverse`, `transpose`, `span`, `basis`, `nullspace`,
  `columnspace`, `eigenvalues`, `eigenvectors`, `diagonalize`, `project v onto W`, `least squares`,
  `A v`, `show transformation A`, `compose`.
- **Analyzers**: `matrix` (layout: transformation view in ℝ² / ℝ³ + numbers), `vector-set` (span/basis),
  `linear-map`.
- **Canvas**: grid continuously deforming under A; unit square → parallelogram with area = |det A|;
  many vectors transforming with eigen-directions highlighted (they stay on their lines); vectors
  collapsing to 0 for the null space; projection and residual for least squares.
- **Flagship acceptance**:
  ```
  A = [[2,1],[1,2]]
  analyze A         # shape 2×2, det 3, rank 2, eigenvalues 3, 1, eigenvectors, nullspace {0}, column space ℝ²
  v = <2,1>
  w = A v
  show transformation A
  ```
  and from Phase 1: Hessian at a point → **Analyze as matrix** → principal directions = eigenvectors.
- **Certainty**: exact for rational/integer matrices (fraction arithmetic); numeric for floating input.
- **Dependencies**: Phase 1 matrices, `symmetricEigen`; Phase 3 Jacobian.
- **Out of scope**: abstract vector spaces beyond ℝⁿ, complex eigenvalues beyond display.

### Phase 5 — Probability and statistics

- **Goal**: let the user *see* how probability mass moves and how estimators behave.
- **Objects**: Distribution (Normal, Uniform, Exponential, Binomial, Poisson, Bernoulli, custom),
  RandomVariable, Transformation, JointDistribution, ConditionalDistribution, Sample, Dataset, Estimator,
  ConfidenceInterval, Test.
- **Operations**: `X ~ Normal(0,1)`, `Y = X^2`, `pdf Y`, `cdf Y`, `sample X n = 5000`, `expectation X`,
  `variance X`, `covariance(X, Y)`, `P(X > 1)`, `condition X on …`, `mean(D)`, `bootstrap mean(D) 5000`,
  `sampling distribution of mean n = 30`, `confidence interval`, `test`.
- **Analyzers**: `distribution`, `random-variable` (with transformation chain), `dataset`,
  `sampling-distribution`.
- **Canvas**: pdf/pmf/cdf; histogram of samples; samples travelling through x ↦ g(x) with density
  compression/stretching; CDF transformation; CLT with a population selector and an n slider
  (1 → 2 → 5 → 10 → 30 → 100); law of large numbers; bootstrap distribution.
- **Flagship acceptance**:
  ```
  X ~ Normal(0,1)
  Y = X^2
  sample Y n = 5000     # histogram vs analytic chi-square(1) pdf
  ```
  and `X ~ Uniform(0,1); Y = X^2` with the change-of-variables formula made visible.
- **Certainty**: analytic pdf/cdf/moments exact; Monte Carlo results are evidence with sample size and
  standard error; seeded RNG for reproducibility.
- **Dependencies**: heavy graph nodes (workers), Phase 1 integration/limits for analytic moments.
- **Out of scope**: full regression suites, Bayesian inference beyond simple conjugate examples.

### Phase 6 — Vector calculus

- **Goal**: fields, flow and the big theorems understood visually.
- **Objects**: VectorField (2-D/3-D), Curve (parametric, closed/open), Surface (parametric, oriented),
  Flow, LineIntegral, FluxIntegral.
- **Operations**: `F(x,y) = <-y, x>`, `div F`, `curl F`, `streamlines F`, `animate particle in F from P`,
  `C(t) = (cos t, sin t)`, `integrate F along C`, `flux F through S`, `potential F`, `green`, `stokes`,
  `divergence theorem`.
- **Analyzers**: `vector-field` (layout: arrows / streamlines / particles), `curve`, `surface`.
- **Canvas**: arrows, streamlines, moving particles; divergence as net outflow through a tiny box;
  curl as a spinning paddle wheel; a particle along C accumulating F·dr; flux as flow through a surface
  with normals; conservative fields and potentials.
- **Explanations**: Green's theorem by subdividing a region into cells whose interior boundaries cancel,
  converging to the continuous theorem; the same idea for Stokes and Divergence.
- **Flagship acceptance**: `F(x,y) = <-y, x>` with div 0, curl 2, circulation around the unit circle 2π
  (exact) and Green's theorem cell animation.
- **Dependencies**: Phase 2 (3-D fields), Phase 3 (regions, double/triple integrals, Jacobians).

### Phase 7 — Sequences and series

- **Goal**: infinite processes with honest certainty.
- **Objects**: Sequence, Series, PowerSeries, TaylorSeries, ConvergenceResult.
- **Operations**: `a(n) = 1/n^2`, `limit a`, `sum a from 1 to ∞`, `partial sums`, `ratio test`, `root test`,
  `comparison`, `integral test`, `radius of convergence`, `taylor series f at 0`.
- **Analyzers**: `sequence`, `series`, `power-series`.
- **Canvas**: terms and partial sums; convergence bands; Taylor polynomials converging to f with an
  error band; interval of convergence.
- **Certainty**: closed-form sums and tests with symbolic limits exact; numeric partial sums evidence.
- **Dependencies**: Phase 1 limits and Taylor polynomials.
---

## 5. Cross-cutting work

| Topic | Why | First needed |
|---|---|---|
| Equal-aspect 3-D world map | today `WorldMap` rescales z for graphs of f(x,y); fields in ℝ³, regions and vector fields need true geometry | Phase 2 |
| Workers for heavy nodes | marching cubes, Monte Carlo, cubature must not block typing or dragging | Phase 2 (marching cubes), Phase 5 |
| Exact rational arithmetic | exact matrices, exact region bounds | Phase 3–4 |
| Undo / history, save / load documents | real work sessions | any time |
| "Analyze as …" actions | cross-phase object flows | Phase 4 |
| Test strategy | per phase: unit tests (CAS, analyzers), engine tests (recognition, laziness, results-as-objects), browser run of the flagship scenarios | every phase |
| Documentation | README, this roadmap, one spec per phase in `docs/phases/` | every phase |

## 6. Known limits carried from Phase 1

- Search windows: 1-D roots and critical points are scanned on [−20, 20]; 2-D critical points use Newton
  from seeds in [−12, 12]²; 1-D domains are scanned on [−100, 100]. Results outside can be missed — this
  is stated in each result's evidence.
- Integration is table-based (linearity, powers, exp/sin/cos of linear arguments, u-substitution patterns,
  rational functions with a linear denominator); otherwise the user is told to give bounds.
- The simplifier is modest: no factorisation, no Cardano/quartic formulas (cubic roots are numeric).
- Closed-form recognition (p/q, (p + r√n)/q, multiples of π and e) is presentation only.
- In a hidden browser pane, `requestAnimationFrame` stalls, so UI updates pause in automated tests.

## 7. Order and milestones

```
Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
```

A phase is done when:
1. its flagship scenarios pass as automated tests (engine level) and end to end in the browser;
2. every new result kind has a certainty label and can be pinned, referenced and re-analysed;
3. its analyzers declare their own workspace layouts;
4. README and this roadmap are updated, and the phase spec in `docs/phases/` records what shipped.