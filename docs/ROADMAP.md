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
| 2 | matrices, vectors, linear maps, rref, rank, det, inverse, subspaces, eigen, diagonalization, systems, projections, least squares, QR, SVD — with 3Blue1Brown-style animated transformations in 2-D and 3-D | linear algebra (MAT223/224) | ✅ done — [spec](phases/phase-2-linear-algebra.md) |
| 3 | 3a 3-D fields + Lagrange · 3b multiple integrals, coordinates, Jacobian · 3c vector fields, div, curl, Laplacian · 3d line/surface integrals, Green/Stokes/Divergence | multivariable and vector calculus (MAT235) | in progress: 3c ✅ 3d ✅ — [spec](phases/phase-3-mat235.md) |
| 4 | ODE: Laplace / inverse Laplace transform, linear ODEs and IVPs, slope fields, systems x′ = Ax and phase portraits · PDE: heat, wave and Laplace equations, boundary conditions, separation of variables, Fourier series | differential equations (ODE + PDE) and transforms (MAT244, APM346) | planned |
| 5 | distributions, random-variable transformations, joint/conditional, expectation, sampling, CLT, estimation | probability and statistics | planned |
| 6 | sequences, series, power series, Taylor series, convergence | infinite processes | planned |

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
| Point, Vector, Matrix | 1 | exact (rational) matrices and draggable vectors/columns in Phase 2 |
| Subspace, Affine (solution set), Eigen, Diagonalization, QR, SVD, Complex, Boolean (with reason), LinearMap | 2 | |
| ScalarField3D, Constraint, OptimizationProblem, Candidates | 3a | |
| Region (2-D / 3-D), Integral, CoordinateSystem, Jacobian | 3b | Jacobian is a Matrix-valued function |
| VectorField, Potential, Curve (parametric), Surface (parametric), Flow | 3c–3d | |
| Transform (Laplace), ODE, IVP, SolutionCurve, PDE, BoundaryValueProblem, FourierSeries | 4 | |
| Distribution, RandomVariable, Sample, Estimator | 5 | samples are heavy nodes (seeded RNG, worker) |
| Sequence, Series, PowerSeries | 6 | |

### Cross-phase flows (why one object system matters)

```
f(x,y) = x^2 - y^2          ScalarField2D           (Phase 1)
H = hessian f               MatrixField             (Phase 1)
A = H at (0,0)              Matrix                  (Phase 1 → Phase 2)
eigen A                     Eigen → eigenspaces     (Phase 2)
show transformation A       visualization

J = jacobian (r cos θ, r sin θ)    Matrix-valued function → det J = r    (Phase 3b → Phase 2)
F = gradient f              VectorField              (Phase 1 → Phase 3c)
jacobian F at P             Matrix → eigenvalues classify the equilibrium (Phase 3c → Phase 2)
x' = A x                    ODE system → phase portrait from eigen A     (Phase 4 → Phase 2)
u_t = k laplacian u         PDE → steady state ∇²u = 0 is a harmonic function (Phase 4 → Phase 3c)
X ~ Uniform(0,1); Y = X^2   RandomVariable → Transformation → RandomVariable (Phase 5)
```

Any matrix- or vector-valued fact offers **"Analyze as matrix / vector"** — e.g. the Hessian at a point
opens the Phase 2 matrix analysis.

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

### Phase 2 — Linear algebra ✅

Full specification: **[phases/phase-2-linear-algebra.md](phases/phase-2-linear-algebra.md)**.

- **Goal**: matrices and linear maps as first-class objects with geometric meaning — complete MAT223/224
  computation, exact for rational input, and a 3Blue1Brown-style animated transformation view.
- **Objects**: Matrix, Vector, Subspace (span / null / column / row / eigenspace), Affine (solution sets),
  Eigen, Diagonalization, QR, SVD, Complex, Boolean-with-reason, LinearMap.
- **Operations**: `det`, `trace`, `rank`, `rref`, `inverse`, `A^-1`, `A^T`, `eigen`, `charpoly`,
  `diagonalize`, `nullspace`, `columnspace`, `rowspace`, `span`, `basis`, `independent`, `solve(A, b)`,
  `project v onto W`, `leastsquares`, `gramschmidt`, `qr`, `svd`, `coords v in B`, `standardmatrix T`,
  `transformation(A, …)`.
- **Analyzers**: `matrix` (layout by shape: 2-D transformation view / 3-D view / numbers), `subspace`,
  `vector-list`, `affine`, `linear-map`.
- **Canvas**: the grid deforms continuously from I to A (transport bar, auto-play on edit); î, ĵ, k̂ land
  on the columns; unit square / cube → parallelogram / parallelepiped with |det A|; eigen-lines stay put;
  the null space collapses; stepped timelines for composition, diagonalization (P⁻¹ → D → P) and SVD
  (rotate → stretch → rotate); draggable columns and vectors rewrite the worksheet.
- **Flagships**: `A = [[2,1],[1,2]]` (det 3, eigen 3 and 1, animated), `[[1,2,3],[4,5,6],[7,8,9]]` in 3-D
  (collapses onto a plane, null space ⟨1,−2,1⟩), composition / diagonalization / SVD timelines, and from
  Phase 1: Hessian at a point → **Analyze as matrix**.
- **Certainty**: exact (fraction arithmetic) for rational matrices; numeric otherwise (eigenvalues by
  Durand–Kerner on the exact characteristic polynomial, SVD via the symmetric eigensolver).

### Phase 3 — Multivariable and vector calculus (MAT235)

Full specification: **[phases/phase-3-mat235.md](phases/phase-3-mat235.md)**.

- **3a — 3-D scalar fields and constrained optimisation**: `T: ℝ³ → ℝ` with gradient, Hessian, Laplacian,
  level surfaces (marching cubes), slice planes; `maximize|minimize f subject to g = c`, Lagrange
  candidates, the level curve expanding until it first touches the constraint (∇f = λ∇g).
  Flagships: the **Earth** temperature field and the **Lagrange** scene.
- **3b — multiple integrals and coordinates**: regions, `integrate f over R`, polar / cylindrical /
  spherical, Jacobian (a Matrix-valued function; |det J| is the cell's area scale, animated with the
  Phase 2 timeline machinery). Flagship: ∬ over the unit disk = 7π/2 with dx dy → r dr dθ.
- **3c — vector fields**: `div`, `curl`, `laplacian` (∇²), conservative fields and potentials,
  streamlines and particles, equilibria classified by the Jacobian's eigenvalues. Flagship:
  `F(x,y) = <-y, x>` (div 0, curl 2) and a gradient field with its potential.
- **3d — curves, surfaces and the big theorems**: line integrals, flux, Green / Stokes / Divergence with
  the cancelling-cells animation. Flagship: circulation of ⟨−y, x⟩ around the unit circle = 2π.
- **Dependencies**: Phase 1 engine; Phase 2 matrices, eigen and the Euclidean 3-D map; marching cubes.

### Phase 4 — Differential equations (ODE + PDE) and transforms (MAT244, APM346)

- **Goal**: ODEs, PDEs and the Laplace transform as objects, with solutions you can see.

#### ODE part
- **Objects**: Transform (Laplace pair F(s) ↔ f(t)), ODE, IVP, SolutionCurve, SlopeField, LinearSystem.
- **Operations**: `laplace f`, `inverse laplace F` (table + partial fractions), `solve y'' + 3y' + 2y = 0
  with y(0) = 1, y'(0) = 0` (via Laplace or characteristic equation), `slopefield y' = …`,
  `x' = A x` (phase portrait).
- **Analyzers**: `transform` (f(t) and F(s) side by side; poles in the s-plane), `ode` (slope field +
  solution curves through draggable initial points), `linear-system` (phase portrait whose type — node,
  saddle, spiral, centre — comes from `eigen A` of Phase 2).
- **Canvas**: slope fields (reusing the Phase 3c arrow drawers), solution curves through a draggable
  initial condition, e^{−st} weighting under f(t) for the Laplace integral, pole locations vs. behaviour.
- **Certainty**: table / partial-fraction transforms exact; numeric integration (RK45 with error control)
  is numeric.

#### PDE part
- **Objects**: PDE, BoundaryValueProblem (domain, boundary and initial conditions), FourierSeries,
  Solution u(x, t) (and u(x, y) for steady states).
- **Operations**: `heat u_t = k u_xx on [0, L] with u(0,t) = 0, u(L,t) = 0, u(x,0) = f(x)`,
  `wave u_tt = c^2 u_xx …`, `laplace equation on the rectangle / disk with boundary values …`,
  `separate` (separation of variables), `fourier f on [0, L]` (sine / cosine / full series),
  `dalembert` for the wave equation, `steady state`.
- **Analyzers**: `pde` (classification — parabolic / hyperbolic / elliptic; method; eigenfunctions
  sin(nπx/L) with eigenvalues (nπ/L)² as eigen objects), `fourier-series` (coefficients, partial sums,
  convergence, Gibbs phenomenon).
- **Canvas**: heat diffusing along a rod (colour + graph, timeline loop), a vibrating string (standing
  waves, d'Alembert travelling waves), steady-state temperature on a rectangle or disk (heat map, reusing
  the Phase 1 heat map and the 3c Laplacian / mean-value picture), Fourier partial sums converging to the
  initial profile, each mode decaying at its own rate.
- **Certainty**: Fourier coefficients exact when the integrals are symbolic; truncated series numeric with
  the truncation stated; finite-difference solutions (explicit scheme with a stability check) numeric.
- **Dependencies**: Fourier series are built here and reused by Phase 6; the Laplacian (3c); eigenvalues
  and eigenvectors (Phase 2) for the Sturm–Liouville picture.
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
- **Dependencies**: heavy graph nodes (workers), Phase 1 integration/limits for analytic moments, Phase 3b multiple integrals for joint distributions.
- **Out of scope**: full regression suites, Bayesian inference beyond simple conjugate examples.

### Phase 6 — Sequences and series

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
| Equal-aspect 3-D world map | today `WorldMap` rescales z for graphs of f(x,y); fields in ℝ³, regions and vector fields and 3-D linear maps need true geometry | Phase 2 (3-D transformations) |
| Workers for heavy nodes | marching cubes, Monte Carlo, cubature must not block typing or dragging | Phase 3a (marching cubes), Phase 5 |
| Exact rational arithmetic | exact matrices, exact region bounds | Phase 2 |
| Undo / history, save / load documents | real work sessions | any time |
| "Analyze as …" actions | cross-phase object flows | Phase 2 |
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
Phase 2 (linear algebra) → Phase 3 (MAT235: 3a → 3b → 3c → 3d) → Phase 4 (ODE + PDE, Laplace, Fourier) → Phase 5 → Phase 6
```

A phase is done when:
1. its flagship scenarios pass as automated tests (engine level) and end to end in the browser;
2. every new result kind has a certainty label and can be pinned, referenced and re-analysed;
3. its analyzers declare their own workspace layouts;
4. README and this roadmap are updated, and the phase spec in `docs/phases/` records what shipped.