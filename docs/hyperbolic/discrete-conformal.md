# Discrete conformal equivalence — Campen et al. 2021

A summary of *Efficient and Robust Discrete Conformal Equivalence with
Boundary* (Campen, Capouellez, Shen, Zhu, Panozzo, Zorin; SIGGRAPH Asia
2021, ACM Trans. Graph. 40(6) Art. 1) and a map of its reference
implementation. Adjacent technique — not on the critical path for the
Poincaré-disk projection mode in `projection-design.md`, but recorded
here because it is the strongest current method for the related problem
"compute a discrete metric of prescribed curvature on a triangle mesh"
and because the underlying machinery (cusped hyperbolic metric, Penner
coordinates, Ptolemy flips) is the same machinery a Coxeter-group
hyperbolic tiling renderer would use.

## What the paper does

**Input.** A triangle mesh M (possibly with boundary), with positive edge
lengths ℓ satisfying the triangle inequality, and a target prescription
Θ̂ : V → ℝ⁺ of interior cone angles plus, for boundary vertices,
target geodesic curvatures κ̂. The total must obey Gauss–Bonnet:
ΣΘ̂_i + Σκ̂_i = 2π χ(M).

**Output.** A *conformally equivalent* metric ℓ̃ on (a flip-modified
retriangulation of) M whose vertex angle sums match Θ̂ exactly. Two
discrete metrics ℓ and ℓ̃ on the same mesh are conformally equivalent if
there exist per-vertex log-scale factors u : V → ℝ such that

    ℓ̃_ij = ℓ_ij · exp((u_i + u_j) / 2)               (1)

(Springborn et al. 2008). The discrete Gauss curvature at vertex i is
κ_i = 2π − Θ_i (interior) or π − Θ_i (boundary), and the *angle defect*
to match is g_i(u) = Θ̂_i − Θ_i(u).

**Approach.** Newton's method on the convex energy

    E(u) = Σ_{T_ijk} [2 f(λ̃_ij, λ̃_jk, λ̃_ki) − π (u_i + u_j + u_k)]
                                                              + Θ̂ ⋅ u

(Eq. 7 of Springborn 2020; involves Milnor's Lobachevsky function via the
per-triangle f). The gradient is g(u) = Θ̂ − Θ(u) (Eq. 2) and the
Hessian is the cotangent Laplacian of the scaled metric — both cheap and
robust to evaluate, unlike the energy itself.

The crucial robustness move: as the metric changes during Newton, edges
that violate the discrete **Delaunay condition** are flipped — but rather
than discarding the violating triangle, the *Ptolemy length-flip rule* is
used, which keeps the metric isometric in the underlying cusped hyperbolic
metric:

    ℓ_km = (ℓ_jk ℓ_im + ℓ_ki ℓ_mj) / ℓ_ij            (6, Ptolemy)

(this is the Penner-coordinate flip rule). The mesh is kept *intrinsically
Delaunay* throughout via Weeks's algorithm — eagerly flipping every
non-Delaunay edge — and Newton iterates on the Delaunay-maintained mesh.

**Energy-free line search.** Because E is convex along the search
direction d, its derivative d ⋅ g(u + λ d) is monotonic in λ and has at
most one zero; ensuring d ⋅ g(u + λ d) ≤ 0 is sufficient for E-decrease
(Eq. 8). This avoids ever evaluating the noisy Lobachevsky-function-based
E during line search, which dominated numerical error in earlier work.

**Boundary handling.** A surface with boundary is doubled along the
boundary to form a closed surface M = N ∪ N′ with reflection symmetry R.
Newton iterates with the variables u shared across the two halves
("tufted double cover" of Sharp & Crane 2020). Edge flips can produce
diagonals crossing the symmetry line; the paper enumerates the seven flip
types compatible with the symmetry (Fig. 5, Table 1 of the paper) and
shows the three sets (1,∥,2)↔(t,⊥,t), (1,1,t)+(2,2,t)↔(t,⊥,q),
(1,1,q)+(2,2,q)↔(q,⊥,q) — the rest reduce to the standard interior flip.

**Theory backbone.** Gu et al. 2018b ("A discrete uniformization theorem
for polyhedral surfaces") and Springborn 2020 ("Ideal Hyperbolic
Polyhedra and Discrete Uniformization") prove the existence and
uniqueness of the conformally-equivalent metric matching a prescribed
target angle set, and that the Ptolemy-flip evolution preserves the
cusped hyperbolic metric.

**Continuous map between meshes.** Section 6 of the paper constructs an
explicit map f : |M| → |M′| from the original to the final metric,
realised as the composition of circumcircle-preserving projective maps
in two-triangle charts in the Beltrami–Klein model. Each ideal triangle is
mapped to an equilateral reference triangle T_ref with vertices on the
unit circle; a flip is then the projective change of chart. This is the
piece that lets the discrete-metric output be turned into a per-pixel
texture coordinate.

## ConformalIdealDelaunay reference code map

GitHub: `mcampen/ConformalIdealDelaunay`. Layout of the C++ implementation:

```
src/
  conformal_ideal_delaunay/
    ConformalIdealDelaunayMapping.hh   -- main class ConformalIdealDelaunay (1578 lines):
                                          DelaunayStats, SolveStats, StatsParameters,
                                          LineSearchParameters, AlgorithmParameters,
                                          and the Newton + line-search + Weeks-flip loop
    Halfedge.hh                        -- Connectivity struct (halfedge mesh; ~219 lines).
                                          Generalised halfedge representation supporting
                                          valence-1 vertices, polygons glued to themselves,
                                          and quad faces — the configurations the
                                          symmetric-flip enumeration produces.
    OverlayMesh.{hh,cc}                -- Fisher et al. 2007 polygon-overlay data structure
                                          tracking the original mesh vs. the flip-modified
                                          mesh; explicit (not normal-coordinate) form,
                                          ~11% overhead.
    Layout.hh                          -- 2-D flat-mesh layout in the plane (for
                                          texture-coordinate output).
    Claussen.hh                        -- Clausen / Milnor Lobachevsky function (for the
                                          energy E, used only for verification, not in the
                                          line search).
    Angle.hh                           -- robust angle computation from edge lengths.
    Sampling.hh                        -- mesh sampling helpers.
    ConformalInterface.hh              -- the top-level public C++ API:
                                          conformal_metric_*(...) and
                                          conformal_parametrization_*(...) functions.
    BarycenterMapping.{cc,hh}          -- the two-triangle barycentric chart of paper §6.
    ConformalPybind.cpp                -- Python bindings.
  conformal_seamless_similarity/
    ConformalSeamlessSimilarityMapping.hh  -- the 2017 predecessor (Campen & Zorin 2017b),
                                              used in the paper's §7.2 comparison.
py/
  script_conformal.py                  -- the CLI; main entry for running the algorithm
                                          on a .obj + per-vertex target angles.
data/examples/
  elephant.obj, fertility_tri.obj, aircraft.obj, ... + *_Th_hat target angle files.
```

**CLI usage** (matches what the paper's experiments do):

```
python py/script_conformal.py -i IN_DIR -f FILENAME [--options]
```

**C++ usage** is via `#include "ConformalInterface.hh"` and either
`conformal_metric_*` (just the metric) or `conformal_parametrization_*`
(metric + explicit 2-D layout).

## References

- Campen, M.; Capouellez, R.; Shen, H.; Zhu, L.; Panozzo, D.; Zorin, D.
  (2021). "Efficient and Robust Discrete Conformal Equivalence with
  Boundary." *ACM Trans. Graph.* **40**(6), Art. 1 (SIGGRAPH Asia 2021).
- Springborn, B.; Schröder, P.; Pinkall, U. (2008). "Conformal
  equivalence of triangle meshes." *ACM Trans. Graph.* **27**(3). — The
  Eq. (1) per-vertex scale factor definition and the convex energy.
- Springborn, B. (2020). "Ideal Hyperbolic Polyhedra and Discrete
  Uniformization." *Discrete & Computational Geometry* **64**(1):63–108.
  — The hyperbolic-polyhedra interpretation that makes the Penner /
  Ptolemy-flip approach exact.
- Gu, X.; Luo, F.; Sun, J.; Wu, T. (2018b). "A discrete uniformization
  theorem for polyhedral surfaces." *J. Differential Geometry*
  **109**(2):223–256. — Existence and uniqueness of the conformally
  equivalent metric matching prescribed Θ̂.
- Fisher, M.; Springborn, B.; Schröder, P.; Bobenko, A. I. (2007).
  "An algorithm for the construction of intrinsic Delaunay triangulations
  with applications to digital geometry processing." *Computing*
  **81**(2-3):199–213. — The explicit polygon-overlay structure used by
  `OverlayMesh.cc`.
- Gillespie, M.; Springborn, B.; Crane, K. (2021). "Discrete Conformal
  Equivalence of Polyhedral Surfaces." *ACM Trans. Graph.* **40**(4). —
  A concurrent paper using the alternative (degeneration-flip) approach;
  baseline in the paper's §7.2 comparison.
- Weeks, J. R. (1993). "Convex hulls and isometries of cusped hyperbolic
  3-manifolds." *Topology and its Applications* **52**(2):127–149. —
  The eager-flip Delaunay algorithm.
- Zorin, D. (2021). "Convergence Analysis of the Algorithm in 'Efficient
  and Robust Discrete Conformal Equivalence with Boundary'."
  arXiv:2109.03436 [math.NA]. — Convergence proof for the energy-free
  Newton.

See `../tilings/bibliography.md` under *Hyperbolic geometry* for the
short cross-references.
