# MathLab curriculum map — the five sources

MathLab's content is defined by five sources. Every chapter below is mapped to the **objects**,
**operations** and **visuals** that implement it, and to the phase that delivers it. Worked examples from
the books are the acceptance tests (`tests/books-*.test.ts`) — they test the shared engine, never special
cases.

| Source | Course | Scope in MathLab |
|---|---|---|
| Hughes-Hallett, McCallum et al., *Calculus: Single and Multivariable*, 8th ed. (Wiley 2021) | MAT135/136/137, MAT235 | all 21 chapters |
| Devore, Berk & Carlton, *Modern Mathematical Statistics with Applications*, 3rd ed. (Springer 2021) | STA237 (ch. 1–6), STA238 (ch. 7–10) | ch. 1–6 first, 7–10 later |
| STA237 syllabus (UofT, Fall 2026) | STA237 | simulation-first teaching (R / LearnR) → MathLab scripts |
| Kolman & Beck, *Elementary Linear Programming with Applications*, 2nd ed. (1995) | LP / OR | ch. 1–5 |
| Osborne, *An Introduction to Game Theory* (draft ch. 1–2) | game theory | strategic games, Nash equilibrium (+ mixed strategies, zero-sum games by LP) |

Plus the already-shipped linear algebra (MAT223/224).

---

## 1. Architecture: one engine, two ways in

```
                ┌──────────── worksheet (declarative, reactive, like Desmos) ─────────────┐
 definitions →  │ f(x,y) = …   R = x^2+y^2 <= 1   X ~ Normal(0, 1)   maximize … subject to … │
                └─────────────────────────────┬───────────────────────────────────────────┘
                ┌──────────── scripts (imperative, MATLAB-like) ──────────────────────────┐
 programs    →  │ function / for / while / if, arrays 1:n, A(i,j), rand, plot, hist        │
                └─────────────────────────────┬───────────────────────────────────────────┘
                                              ▼
                typed objects in the reactive graph (value kinds + certainty)
                                              ▼
                analyzers (recognition → layout → facts = MLL expressions → visuals)
```

- A script is **just another way to produce objects**: every top-level variable a script assigns becomes
  an ordinary node of the graph (scalar, list, matrix, function, sample, figure …), so it is analysed,
  pinned, referenced and plotted exactly like a worksheet definition. Principle 1 of the roadmap holds.
- Scripts are deterministic (seeded RNG, `rng(n)`), have a step budget and never freeze the tab.

## 2. The programming layer (Phase S) — "MATLAB inside MathLab" (first release shipped)

Shipped (`src/runtime/script/`, `src/parser/blocks.ts`, `src/plugins/scripting/`, tests `tests/script.test.ts`):
lexer / parser / interpreter with MATLAB semantics (column-major arrays, implicit expansion, `end` in
indices, growth and deletion on assignment, `[a, b] = f(…)`, `@(x)` closures, `hold on`), ~120 library
functions (constructors, element-wise math, column-wise reductions, `quantile` / `prctile` / `iqr`,
`integral` / `fzero` / `trapz` / `polyfit` / `interp1`, `det` / `inv` / `\`, seeded `rand` / `randn` /
`randi` / `randperm`, `fprintf` / `disp`, `plot` / `scatter` / `bar` / `hist` / `histogram` / `stairs` /
`fplot`), a step budget, blocks in cells (Enter continues an open block, auto-indent), function blocks
callable from the worksheet (symbolic when a one-line body is plain arithmetic), script variables as
worksheet nodes with dependencies, random-dependent results marked as simulation evidence (taint tracking
through data and control flow), lambdas returned as symbolic functions, MLL builtins callable from
scripts, figures with free axes. Not yet: worker execution, `switch`, cell arrays, structs, strings
beyond basics, `ode45` (Phase 4).

MATLAB's strengths that matter here: arrays are values, element-wise operations, ranges, 1-based
indexing, short functions, `plot` / `hist` one-liners. MathLab adopts that syntax inside **blocks**; the
one-line worksheet language stays as it is.

```matlab
% a function block (multi-line)
function s = partialsum(n)
  s = 0;
  for k = 1:n
    s = s + 1/k^2;
  end
end

% a script block: its top-level variables become worksheet objects
script clt
  rng(1);
  n = 30; k = 2000;
  means = zeros(1, k);
  for i = 1:k
    means(i) = mean(rand(1, n));
  end
  hist(means, 30)
end
```

| Feature | Form |
|---|---|
| blocks | `function [a, b] = name(x, y) … end`, `script name … end`, `for i = v … end`, `while c … end`, `if / elseif / else … end`, `break`, `continue`, `return` |
| arrays | `[1 2 3]`, `[1, 2; 3, 4]`, `1:n`, `0:0.1:1`, `zeros(m,n)`, `ones`, `eye`, `linspace`, `numel`, `size`, `length`, `end` inside indices |
| indexing | `v(i)`, `A(i, j)`, `A(:, 2)`, `v(2:end)`, masks `v(v > 0)`; assignment grows arrays |
| element-wise | `.*`, `./`, `.^`; scalar functions map over arrays; comparisons give 0/1 arrays |
| reductions | `sum`, `prod`, `cumsum`, `mean`, `median`, `var`, `std`, `min`, `max`, `sort`, `find`, `any`, `all` |
| random | `rng(seed)`, `rand`, `randn`, `randi`, `sample(X, n)` for any distribution object |
| output | `disp`, `plot(x, y)`, `scatter`, `hist(v, bins)`, `bar`, `stairs` → figure objects on the canvas |
| interop | worksheet objects are readable inside scripts (`f(2)`, `A`, `X`); symbolic operations stay callable (`diff`, `integrate`) |

Comments `%` and `#`; a trailing `;` suppresses the echo, as in MATLAB.

Implementation:
- **Parser** (`src/parser/blocks.ts`): block openers (`function`, `script`, `for`, `while`, `if`) at the
  start of a statement consume lines up to the matching `end` (`end` inside indices is not a closer). A
  block is one `Statement` (`kind: 'block'`) holding a small statement AST (`assign`, `index-assign`,
  `for`, `while`, `if`, `expr`, `return` …) over ordinary `Expr` plus new nodes `range`, `index`,
  element-wise operators and `:`.
- **Interpreter** (`src/runtime/script/`): closure-compiled tree walker; values are the existing
  `MathValue`s plus a dense numeric array (`Float64Array` + shape) converted to `list` / `vector` /
  `matrix` at the boundary. Step budget (default 5·10⁶) → "script stopped after N steps" instead of a
  frozen tab; later a worker (the graph's reserved `heavy` flag).
- **Document**: a `function` block defines a callable `FunctionValue` (symbolic when the body is one
  `y = expr`); a `script` block defines one node per exported variable plus figure nodes; its
  dependencies are the free names it reads.
- **Analyzers**: exported lists → `dataset` (Phase 5), matrices → Phase 2, functions → Phase 1.

## 3. Coordinates and multiple integrals (Phase 3b) — first milestone

Hughes-Hallett §16.1–16.5, §21.1–21.2, §8.3; Devore §5.1 (probabilities over regions).

| Object | Language |
|---|---|
| coordinate systems `polar`, `cylindrical`, `spherical`; any map `T(u,v) = (…)` | `coordinates polar`, `jacobian T`, `integrate f over R in polar` |
| region 2-D / 3-D (inequalities, or bounds in any system) | `R = x^2 + y^2 <= 1`, `D = 0 <= x <= 1 and x^2 <= y <= x`, `E = x^2+y^2+z^2 <= 4 and z >= 0`, `S = 1 <= r <= 2 and 0 <= θ <= π/4` |
| integrals | `integrate f over R`, `… in polar`, `area R`, `volume E`, `average f over R`, `mass δ over R`, `centroid R` |
| iterated bounds | `bounds R` (type I / type II / polar …), `swap order` |
| Riemann sums | `riemann f over R n = 8` (upper / lower / midpoint / corner) |

Engine:
- **Region → iterated description**: type I / II when the boundary solves symbolically for y (or x);
  polar when the region is described in r, θ or is a disk / annulus / sector / cardioid; spherical for
  balls and cones. Otherwise sampled bounds (evidence).
- **Exact iterated integration**: inner antiderivative + FTC with symbolic bounds, then outer
  (`src/math-core/symbolic/integrate.ts`); fallback nested Gauss–Legendre / Kronrod (numeric, error).
- **Change of variables**: substitute the coordinate map, multiply by |det J|, integrate in the new
  variables; `integrate f over R` tries Cartesian and the natural system and keeps the exact one.

Visuals: region shading; surface over the region with columns f dA; the **strip sweep** (a strip crosses
the region showing its inner bounds); **Riemann boxes** refining 2 → 4 → 8 → 16 (stepped timeline);
**coordinate explorer** (polar grid, cylindrical / spherical coordinate surfaces with sliders);
**Jacobian cell** (the (u, v) grid mapped to the curved (x, y) grid; one cell's area ≈ |det J| Δu Δv).

Acceptance: ∬_disk 4 − x² − y² = 7π/2; roof 12 − x/4 − y/8 over [0,8]×[0,16] = 1280 (both orders and as a
triple integral); ∫₀¹∫_{x²}^{x} (1 + x) dy dx = 1/4; ∫₀⁶∫_{x/3}^{2} x√(y³+1) dy dx = 26 (after swapping the
order); ∬_{[0,1]²} e^{−(x²+y²)}: n = 4 upper 0.68 / lower 0.44 → 0.5577; ∬ (x²+y²)^{−3/2} over
1 ≤ r ≤ 2, 0 ≤ θ ≤ π/4 = π/8; ball 4πa³/3; cone z = √(x²+y²) ≤ 3 with density z = 81π/4; ellipse area πab.

## 4. Calculus — remaining chapters

| Chapter | Missing today | Phase |
|---|---|---|
| 5, 7.5 Riemann sums, numeric rules | left / right / midpoint / trapezoid / Simpson with error table | 3b (1-D `riemann f from a to b`) |
| 8.1–8.3 volumes by slicing, polar area | solids of revolution, ½∫r² dθ sector sweep | 3b |
| 12.5, 14.5 f(x,y,z), level surfaces | 3-D scalar fields | 3a |
| 15.2 extrema on regions, least squares; 15.3 Lagrange | boundary analysis, Lagrange | 3a |
| 16, 21.2 multiple integrals, coordinates, Jacobian | everything | 3b |
| 11 differential equations | slope fields, Euler, separable, logistic, systems, phase plane, oscillations | 4 |
| 9–10 sequences, series, Taylor error, Fourier | everything | 6 (Fourier with 4) |

Pedagogy ("Rule of Four"): every object shows **formula, graph, table and words**; numerical
approximation first with the exact answer beside it (Riemann → integral, Euler → solution, partial sums →
series), error visible.

Acceptance highlights: Lagrange P = x^{2/3}y^{1/3}, x + y ≤ 3.78 → (2.52, 1.26), λ ≈ 0.53; x + y on
x² + y² = 4 → ±2√2; Euler y′ = y, Δx = 0.1 → 1.1, 1.21 …; SIR S₀ = 762, threshold 192; cooling 37 → 35 °C in
2 h (k ≈ 0.063); square wave F₁, F₃, F₅, F₇; P₇ of sin at π/3 = 0.8660213; dosage 250(1 − 0.04ⁿ)/0.96 → 260.4.

## 5. Probability and statistics (Phase 5) — Devore ch. 1–6 + STA237

Parameterisations follow the book (R equivalents documented): `Normal(μ, σ)` (σ is the sd),
`Exponential(λ)` (rate), `Gamma(α, β)` (scale), `Poisson(μ)`, `Binomial(n, p)`, `Hypergeometric(n, M, N)`,
`NegBinomial(r, p)` and `Geometric(p)` count **trials**, `Weibull(α, β)` (shape, scale),
`Lognormal(μ, σ)` (of ln X), `Beta(α, β[, A, B])`, `Uniform(A, B)`, `ChiSquared(ν)`, `T(ν)`, `F(ν₁, ν₂)`,
`Bernoulli(p)`, finite tables `pmf([16, 32, 64], [.3, .5, .2])`, joint tables, `BivariateNormal`.

| Devore chapter | Objects | Operations | Visuals |
|---|---|---|---|
| 1 descriptive | Dataset | mean, median, trimmed mean, s², s, quartiles (**Tukey hinges**, switchable to R type 7), iqr, fences, mild / extreme outliers | histogram (density scale), stem-and-leaf, dotplot, boxplot, comparative boxplots, bar / Pareto |
| 2 probability | events, trees | counting, addition rule, conditional, total probability, Bayes | tree diagram, two-way table, Monte Carlo estimate with SE |
| 3 discrete RVs | Distribution, RandomVariable | pmf, cdf, E, V, E[h(X)], mgf, percentiles | pmf bars, step cdf, simulated histogram over the pmf |
| 4 continuous RVs | pdf families, Y = g(X) | P(a ≤ X ≤ b) as area, percentiles, standardising, normal approximation with continuity correction, transformation theorem | shaded area, cdf, parameter sliders, normal probability plot ((i − .5)/n), before / after transformation |
| 5 joint | joint pmf / pdf, marginals, conditionals | independence, Cov, ρ, linear combinations, convolution, E(Y|X), bivariate normal, order statistics | joint table with margins, joint pdf surface + region (3b), scatter of simulated pairs |
| 6 sampling | statistics, sampling distributions | E(X̄) = μ, V(X̄) = σ²/n, CLT, LLN, χ², t, F | CLT animation n = 1 → 5 → 10 → 30 with QQ plot, LLN running mean |

Simulation (syllabus; Devore §2.6, 3.8, 4.8, 6.1) uses the programming layer: `sample(X, 1000)`,
`rand`, loops with counters, P̂ ± √(P̂(1−P̂)/n), inverse-cdf method.

Acceptance: fuel data x̄ 28.9, s 5.04, q1 25.4, q3 31.0; Bayes P(D|+) = .047; Bin(15, .2) P(X ≤ 8) = .999;
h(2; 10, 5, 25) = .385; NB(4, .2) P(X = 15) = .050; Apgar E = 7.15, V = 1.5815; f = 1.5(1 − x²) median .347;
Φ(1.25) = .8944; IQ with continuity correction .0516; deductible table ρ = .301; (6/5)(x + y²):
P(X ≤ ¼, Y ≤ ¼) = 7/640; florist E(S²) = 244; P(3.5 ≤ X̄ ≤ 3.8) = .1645.

## 6. Linear programming and games (Phase 7, new)

Kolman–Beck conventions: **standard form** = max cᵀx, Ax ≤ b, x ≥ 0; **canonical form** = equalities;
the objective row holds z_j − c_j; entering = most negative (or **Bland's rule**), departing = minimum
θ over positive entries; artificial variables with the **two-phase** method; all tableaux in **exact
fractions** (`src/math-core/rational.ts`).

| Object | Language |
|---|---|
| LP problem | `L = maximize 120x + 100y subject to 2x + 2y <= 8, 5x + 3y <= 15` (x, y ≥ 0 by default, stated) |
| simplex run | `simplex L` — stepped timeline of tableaux (entering ↓, departing ←, pivot circled); `bland` option |
| dual | `dual L` (an LP object), complementary slackness relation |
| sensitivity | `sensitivity L` (ranges for each c_k and b_i) |
| integer program | `integer x, y` clause → branch-and-bound tree |
| transportation / assignment | `transport(C, supply, demand)`, `assign(C)` (Hungarian, covering lines) |
| strategic game | `G = game(...)` bimatrix → best responses, pure Nash equilibria, dominance; zero-sum `game(A)` → saddle point, mixed strategies and value via LP |

Visuals: feasible polygon with the objective line sliding to the optimum; the simplex path moving vertex to
vertex in sync with the tableau timeline; 3-variable LPs as a polytope in 3-D; branch-and-bound tree;
transportation loops; bimatrix with best responses marked; 2×n zero-sum lower envelope.

Acceptance: sawmill → (3/2, 5/2), z = 430, dual (35, 10); graphical 4x + 3y → 27/2; unbounded example;
complementary slackness (6, 0) / (0, 2/3), z = 12; dual simplex → (10/3, 0, 2/3), z = −10/3; branch and
bound → (6, 0), z = 42 (relaxation 741/17); transportation $1900 (min-cost start $2160); assignment 13;
Prisoner's Dilemma (Fink, Fink); BoS two equilibria; Matching Pennies no pure NE (mixed ½, ½, value 0).

## 7. Order of work

```
3b coordinates & multiple integrals → S programming layer → 3a 3-D fields + Lagrange
→ 5 probability & statistics (simulation uses S) → 4 ODE (+ PDE) → 6 series (+ Fourier)
→ 7 linear programming & games
```

Each milestone: engine + book acceptance tests + browser check of new examples, then docs.