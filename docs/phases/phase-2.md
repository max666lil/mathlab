# Phase 2 — 3-D scalar fields and constrained optimisation

Status: **next**. Part of the [MathLab roadmap](../ROADMAP.md).

## Goal

MathLab leaves the "z = f(x, y) only" stage:

1. **True 3-D scalar fields** `T: ℝ³ → ℝ` — gradient, Hessian, critical points, symmetry, level surfaces,
   slices — visualised in ℝ³ with correct geometry (not as a graph).
2. **Constrained optimisation** — `maximize/minimize f subject to g = c`, Lagrange multipliers, and the
   geometry that explains them (∇f ∥ ∇g, a level set first touching the constraint).

Both are recognised automatically; no mode selector.

---

## Flagship A — the Earth temperature field (acceptance case)

```
r(x,y,z) = sqrt(x^2 + y^2 + z^2)
T(x,y,z) = 6000 - 5700 r(x,y,z)^2      # temperature; Earth radius = 1
analyze T
```

Expected:

| Fact | Value | Certainty |
|---|---|---|
| type | `function ℝ³ → ℝ` | — |
| domain | ℝ³ | exact |
| gradient | ∇T = ⟨−11400x, −11400y, −11400z⟩ | exact |
| radial symmetry | T depends only on r; ∇T ∥ position vector (x × ∇T = 0) | exact (symbolic check), else evidence |
| level surfaces | T = c are spheres of radius √((6000 − c)/5700) | exact (from radial form) / evidence |
| critical points | (0, 0, 0), local max, T = 6000 | exact (constant Hessian) |
| Hessian | −11400·I | exact |
| at P (draggable 3-D point) | T(P), ∇T(P), ‖∇T(P)‖, directional derivative toward u | exact |

Canvas: nested translucent level surfaces (spheres) coloured by T; a draggable slice plane `x = a` with a
heat map of T on it (also shown as a 2-D view); a draggable 3-D point P with ∇T(P) drawn perpendicular to
the level sphere through P.

"Why?": ∇T is radial because T only changes with r; it is perpendicular to the level sphere because moving
along the sphere keeps T constant (∇T · t = 0 for every tangent t).

## Flagship B — Lagrange multipliers (acceptance case)

```
f(x,y) = 4 - x^2 - 2y^2
maximize f subject to x^2 + y^2 = 1
```

Expected: ∇f = (−2x, −4y), ∇g = (2x, 2y), ∇f = λ∇g gives

| Candidate | λ | f | Classification |
|---|---|---|---|
| (±1, 0) | −1 | 3 | maximum on the constraint |
| (0, ±1) | −2 | 2 | minimum on the constraint |

Certainty: candidates exact when the Lagrange system is solved symbolically (polynomial system of low
degree), otherwise numeric; the max/min comparison is exact over the candidate list because the constraint
set is compact (stated as evidence when compactness cannot be established).

Canvas: contour map of f, the constraint curve g = 1, ∇f and ∇g at the candidates (parallel at the
optimum); an animation of the level curve f = c moving from high c downwards until it **first touches**
the constraint — at the touching point the curves are tangent and `∇f = λ∇g` is displayed; 3-D view with
the surface and the constraint curve lifted onto it.

Then the same for three variables: `maximize x + y + z subject to x^2 + y^2 + z^2 = 1` (plane level
surfaces touching a sphere).

---

## Language

| Form | Result |
|---|---|
| `T(x,y,z) = …` | ScalarField3D (already parses; needs recognition + analysis) |
| `P = point(1, 0.5, 0.3) draggable` | 3-D point (draggable on the active slice plane) |
| `maximize f subject to g = c` / `minimize …` / `… and h = d` | OptimizationProblem (new statement rule) |
| `lagrange f subject to g = c` | Candidates (point set with λ, value, classification) |
| `level T = c` | LevelSurface (3-D) — `level f = c` stays a curve for 2-D |
| `slice T at x = a` (also y, z) | plane slice: a ScalarField2D on the plane |
| `critical T`, `gradient T`, `hessian T`, `directional T at P toward u` | 3-D versions of Phase 1 commands |

Parser work: a statement rule for `maximize|minimize … subject to …` (`src/parser/parser.ts`,
`registerStatementRule`); `subject`, `and` as clause words; `slice … at x = a` via command keywords.

## Objects / value kinds

| Kind | Content | Notes |
|---|---|---|
| ScalarField3D | FunctionValue with 3 params | recognised by a new analyzer |
| Constraint | equation g = c (FunctionValue g, number c) | 2 or 3 variables |
| OptimizationProblem | objective, sense (max/min), constraints | analysed by `optimization` |
| Candidates | PointSet with λ per point, value, classification | reuses `pointset` + extra fields |
| LevelSurface | visual: field, level c, mesh cache key | marching cubes |
| Point (3-D) | coords length 3, draggable | drag on the active slice plane |

## Analyzers and layouts

- **`scalar-field-3d`** (`src/plugins/core-calculus/analyzers.ts`) — layout: `3D field` (scene renderer,
  equal aspect) + `Slice` (plane renderer: heat map of the slice) + combo `Both`.
  - tier 0: domain, gradient, Hessian;
  - tier 1: critical points (3-D Newton — reuse `newtonSystem`, `gridSeeds` from
    `src/math-core/numeric/roots.ts`; classification with `symmetricEigen` on the 3×3 Hessian),
    symmetry (radial / axial), level surfaces at nice levels, "At P" card (value, ∇T, directional
    derivative, tangent plane to the level surface).
- **`optimization`** — layout for 2 variables: `Contour` (plane: contours + constraint curve) / `3D`
  (surface + lifted constraint) / `Both`; for 3 variables: `3D` (level surfaces + constraint surface).
  - tier 0: problem statement, ∇f, ∇g, Lagrange system;
  - tier 1: candidates with λ, classification, the optimum, relation `∇f ∥ ∇g` at the optimum.

Relations (for linked highlighting): `gradient ⟂ level surface`, `∇f ∥ ∇g at optimum`,
`level curve tangent to constraint`.

## Rendering work

1. **Equal-aspect world map** for ℝ³ objects — `WorldMap` in `src/visualization/3d/registry3d.ts`
   currently rescales z for graphs; add a mode where x, y, z share one scale and the box is the domain.
   The analyzer's layout selects it.
2. **Marching cubes** isosurfaces — new sampler next to `marchingSquares` in
   `src/visualization/sampling.ts`, cached by field key + level + resolution; run in a worker when the grid
   is large (use the reserved `heavy` node flag in `src/runtime/graph.ts`).
3. **Level-surface visual** — translucent meshes coloured with the shared colormap; nested levels.
4. **Slice plane** — draggable plane `x = a` (or y, z) in 3-D; the 2-D view shows the slice as a heat map
   (reuse the 2-D `surface` heat-map drawer on the sliced 2-D function).
5. **3-D point dragging** — raycast onto the active slice plane; source rewriting as for 2-D points.
6. **Constraint curve** — implicit curve g = c via existing `marchingSquares`; lifted onto the surface in 3-D.
7. **Lagrange animation** — level value c animated by the animation clock; stop at the first contact
   (sign change of `min over constraint (f − c)`); show ∇f and ∇g at the contact point.

## Engine / CAS work

- Simplifier: `sqrt(u)^2 → u` (with the domain condition u ≥ 0 recorded) so the Earth field simplifies.
- Symmetry detection: radial if `x × ∇T` simplifies to 0 (exact); otherwise numeric evidence from
  random rotations (T(Rx) ≈ T(x)).
- Lagrange solver: build ∇f − λ∇g = 0, g = c; solve exactly for low-degree polynomial systems (factor
  out common terms as in the flagship), otherwise multi-start Newton in (x, y[, z], λ).

## Milestones

1. **2a** — ScalarField3D recognition, tier-0 facts, equal-aspect 3-D map, 3-D points.
2. **2b** — marching cubes, level surfaces, slice plane + 2-D slice view → Earth flagship passes.
3. **2c** — `maximize/minimize … subject to …`, Lagrange candidates, optimization analyzer (2 variables).
4. **2d** — Lagrange animation and explanations → Lagrange flagship passes.
5. **2e** — three-variable constraints; README/roadmap updated.

## Tests and acceptance

- Unit: marching cubes on a sphere (vertex count, all vertices within tolerance of radius); radial
  symmetry detection (exact for the Earth field, false for x² + 2y² + z²); 3-D critical points of
  x² + y² − z² (saddle at the origin); Lagrange candidates for Flagship B with λ and max/min.
- Engine: `analyze T` recognises ScalarField3D and returns the 3-D layout; `lagrange … subject to …`
  gives a pinnable point set; facts carry certainty; tier-1 facts are lazy.
- Browser: both flagships end to end — drag the slice plane and the 3-D point; play the Lagrange
  animation; no console errors.

## Out of scope for Phase 2

Inequality constraints / KKT conditions, more than two equality constraints, vector fields (Phase 6),
triple integrals over regions (Phase 3).

## Risks

- Marching-cubes cost on dense grids → worker + cached meshes, coarse grid while dragging.
- Transparency sorting for nested level surfaces → render back-to-front by level, depthWrite off.
- Symbolic Lagrange systems grow quickly → keep the numeric path as the default, exact only when cheap.