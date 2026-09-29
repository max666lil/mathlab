# Phase 2 — Linear algebra

Status: **in progress**. Part of the [MathLab roadmap](../ROADMAP.md). Courses: MAT223 / MAT224.

## Goal

Matrices, vectors, subspaces and linear maps become first-class objects with geometric meaning:

1. **Complete computational linear algebra** — rref, rank, determinant, inverse, null / column / row
   space, eigenvalues and eigenspaces, diagonalization, linear systems, projections, least squares,
   Gram–Schmidt / QR, SVD, coordinates in a basis — exact for rational input.
2. **A 3Blue1Brown-style transformation view** — the plane (or space) itself moves: the grid deforms
   continuously from I to A, î and ĵ (and k̂) travel to the columns of A, the unit square becomes a
   parallelogram whose area is |det A|, eigen-directions stay on their own lines, the null space
   collapses to 0. It works in 2-D and in 3-D.

Everything is recognised automatically: typing `A = [[2,1],[1,2]]` analyses a matrix and shows its
transformation; no mode selector.

---

## Flagship A — the 2-D transformation (acceptance case)

```
A = [[2,1],[1,2]]
```

| Fact | Value | Certainty |
|---|---|---|
| type | 2×2 matrix | — |
| det | 3 | exact |
| rank | 2 | exact |
| eigen | λ = 3: span{⟨1,1⟩} · λ = 1: span{⟨−1,1⟩} | exact |
| diagonalizable | yes — two independent eigenvectors | exact |
| inverse | (1/3)·[[2,−1],[−1,2]] | exact |
| null space | {0} | exact |
| column space | ℝ² | exact |

Canvas: the grid morphs from the identity to A when A is defined or edited (transport bar: ▶, scrubber
`I → A`). î (green) and ĵ (red) land on the columns ⟨2,1⟩ and ⟨1,2⟩, the unit square becomes a
parallelogram labelled "area × 3". Opening **Eigen** draws the two eigen-lines; during the animation vectors
on them only stretch (×3 and ×1). Dragging the tip of î or ĵ rewrites the matrix in the worksheet.

```
v = <1, 2> draggable
w = A v
```
v is carried by the animation to Av; dragging v updates w everywhere.

## Flagship B — a singular 3×3 matrix in space

```
B = [[1,2,3],[4,5,6],[7,8,9]]
```
det 0, rank 2, null space span{⟨1,−2,1⟩}, column space = a plane. In 3-D the lattice and the unit cube
flatten onto the column-space plane; the null-space line is highlighted and collapses to the origin.

## Flagship C — stepped animations

- `transformation(A, B)` plays B first, then A (stops `I → B → AB`) — composition is "apply right to left".
- `diagonalize A` plays P⁻¹ (to eigen-coordinates) → D (pure stretch) → P (back).
- `svd A` plays Vᵀ (rotate) → Σ (stretch along axes) → U (rotate).

---

## Language

| Form | Result |
|---|---|
| `A = [[2,1],[1,2]]` | Matrix (exact when all entries are rational) |
| `A = [[2,1],[1,2]] draggable` | matrix whose columns can be dragged on the canvas |
| `v = <1, 2>` / `v = <1, 2> draggable` | vector (draggable tip) |
| `A v`, `A*v`, `A(v)` | matrix times vector |
| `A B`, `A^3`, `A^-1`, `A^T`, `Aᵀ`, `2A`, `A/2`, `A + B` | matrix algebra |
| `det A`, `trace A`, `rank A`, `nullity A`, `rref A`, `inverse A`, `transpose A`, `identity 3` | numbers and matrices |
| `eigen A`, `eigenvalues A`, `eigenvectors A`, `eigenspace(A, 3)`, `charpoly A` | eigen structure (`charpoly` is a function of λ) |
| `diagonalize A`, `invertible A`, `diagonalizable A` | decomposition / yes-no facts with reasons |
| `nullspace A`, `columnspace A`, `rowspace A`, `span(u, v)`, `basis S`, `dim W`, `independent S` | subspaces |
| `solve(A, b)` | solution set: point, line, plane, … or "inconsistent" |
| `project v onto W`, `leastsquares(A, b)` | projection / least-squares solution |
| `gramschmidt S`, `qr A`, `svd A` | orthogonalization and decompositions |
| `coords v in B`, `matrix(u, v)`, `columns A`, `rows A` | bases and coordinates |
| `T(x,y) = (2x + y, x + 2y)`, `standardmatrix T` | linear map → its matrix |
| `transformation(A, v, …)`, `transformation(A, B)` | the animated transformation as a visual object |

## Objects / value kinds

| Kind | Content | Notes |
|---|---|---|
| matrix | rows, certainty | exists; gains exact display and a cache key |
| vector | comps | exists; draggable tip |
| subspace | ambient n, basis, what (null / column / row / span / eigen) | `dim`, `basis` members; visual: line / plane through 0 |
| affine | particular + directions, or inconsistent | solution sets of linear systems |
| complex | re, im | complex eigenvalues (display) |
| eigen | pairs {λ, algebraic multiplicity, geometric multiplicity, eigenspace basis} | `E[k]` is the k-th eigenspace |
| diagonalization / qr / svd | P, D, P⁻¹ / Q, R / U, Σ, V | members are matrices |
| boolean | value + reason | `invertible`, `diagonalizable`, `independent`, `consistent` |

## Certainty

- A matrix is **exact** when every entry is a rational number (integers, fractions, terminating decimals,
  exact slider values) and no transcendental function or constant was used. Exact matrices are processed
  with fraction arithmetic (safe integers; overflow falls back to numeric).
- Eigenvalues are exact when the characteristic polynomial (computed exactly with Faddeev–LeVerrier)
  factors into rational roots and at most one quadratic factor; otherwise they are **numeric**
  (Durand–Kerner), shown as "≈ …" when a closed form is recognised.
- SVD and QR of non-trivial matrices are numeric.

## Analyzers and layouts

- **`matrix`** — layout by shape: 2×2 → "Transformation" plane view (+ "In space"); 3×3, 3×2, 2×3 →
  3-D view; larger → numbers only. The layout declares a **timeline** (transport bar) keyed to the matrix.
  - summary: shape, det (◐ unit square/cube), rank;
  - sections (collapsed, lazy): **Eigen**, **Subspaces**, **Inverse**, **Decompositions**, **Vectors**;
  - Why? drawers: det (area/volume scale, orientation), eigen (Av = λv ⇒ det(A − λI) = 0), columns (where
    î, ĵ land), rank (dimensions squashed), inverse (undo).
- **`subspace`**, **`vector-list`**, **`affine`** (row picture of a linear system), **`linear-map`**
  (a linear vector-valued function → its standard matrix, same transformation view).

## Rendering work

1. **Presentation timelines** — named animation parameters (`timeline(key)`), played/scrubbed from a
   transport bar the layout declares; auto-play when the matrix changes.
2. **2-D `lintrans` drawer** — transformed grid M(t) = (1 − t)I + tA, basis arrows, unit cell with
   area label, eigen-lines, null-space line, tracked vectors.
3. **Euclidean 3-D world map** — identity z mapping, axes through the origin, no floor box; frame hints
   from visuals (`registerFrameHint`).
4. **3-D `lintrans` visual** — lattice, parallelepiped, î/ĵ/k̂, eigen-lines, column-space plane.
5. **Subspace / affine visuals**; projection with residual and right-angle mark.

## Milestones

1. **2a** — exact core (`exact.ts`), numeric fallback, value kinds, builtins, `A^-1` / `A^T` / `A(v)`.
2. **2b** — matrix analyzer, timelines, 2-D transformation view, draggable vectors/columns → Flagship A.
3. **2c** — Euclidean 3-D map, 3-D transformation view, subspace visuals → Flagship B.
4. **2d** — vector sets, linear systems (row picture), projections, least squares, coordinates, linear maps.
5. **2e** — stepped timelines (composition, diagonalization, SVD), "Analyze as matrix" for matrix-valued
   facts (Hessian at P), examples, help, docs → Flagship C.

## Tests and acceptance

- Unit: exact rref / det / inverse; null space of [[1,2,3],[4,5,6],[7,8,9]] = span{⟨1,−2,1⟩}; eigen of
  [[2,1],[1,2]] exact; rotation → ±i; shear [[1,1],[0,1]] not diagonalizable (with reason); systems
  with one / none / infinitely many solutions; projection; Gram–Schmidt; SVD reconstruction; parser and
  evaluator for `A^-1`, `A^T`, `Aᵀ`, `A(v)`, `A v`.
- Engine: recognition, layout by shape, lazy sections, pinned `E = eigen A` → `E[1]`, focus follows
  an edited matrix, timeline play / scrub.
- Browser: all three flagships end to end.

## Out of scope

Abstract vector spaces beyond ℝⁿ (polynomial spaces are represented by coordinate vectors), complex
eigenvectors (complex eigenvalues are shown and explained as rotation-scaling), Jordan form, numerical
conditioning analysis.