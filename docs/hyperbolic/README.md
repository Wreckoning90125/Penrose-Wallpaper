# Hyperbolic geometry — reference for the H² projection mode

Background for the **Hyperbolic projection mode (Poincaré disk)**,
shipping in this build (Settings → Projection). The renderer's tiling
generators are Euclidean; the hyperbolic mode is a *projection* — the
vertex shader maps each world coordinate through the E² → B² radial
homeomorphism and the τ_b hyperbolic boost before the affine view
transform takes it to clip space. Validity table per family is in
`projection-design.md`. The maths reference material backing every
choice is here so the next change has its derivations within reach.

Two complementary paths the docs cover:

- **Direct rendering of an E² tiling in H².** Take an existing `Family`
  (P3 rhombs, Ammann–Beenker, …) and map its vertex coordinates through
  a Euclidean → Poincaré-disk projection. The tile generators stay
  Euclidean; the world-to-screen path and the way tile sides are drawn
  change (circular arcs instead of straight segments). This is what
  the shipping projection mode does — see `projection-design.md`.
- **Native hyperbolic tilings (regular {p,q} with 1/p + 1/q < 1/2).**
  Built from the orbit of a discrete group acting on H², not a
  projection of Euclidean coordinates. The group theory is in
  `discrete-groups.md` (Dirichlet domains, side-pairing → cycle
  relations, Coxeter classification); the formulas for placing a
  fundamental triangle are in `models.md` (hyperbolic trigonometry,
  closed-form sides of T(2, p, q)).

Boundary with the Euclidean engine: `../tilings/hyperbolic-and-tooling.md`.

## Files

| File | Contents |
|------|----------|
| `models.md` | The four standard models of Hⁿ (hyperboloid, conformal ball / Poincaré disk, upper half-space, projective disk / Beltrami–Klein), their metrics, geodesics, arc-length and volume elements. How to convert between them. |
| `isometries.md` | Möbius transformations on Ên, the Poincaré extension, the classification (elliptic / parabolic / hyperbolic), and matrix forms (PSL(2,ℝ) for H², PSL(2,ℂ) for H³, PO(n,1) in general). |
| `discrete-groups.md` | Discrete subgroups of I(H²), Fuchsian groups, fundamental domains, elementary vs. non-elementary, and how regular {p,q} tilings sit inside this. |
| `discrete-conformal.md` | Summary of the Campen et al. 2021 *Efficient and Robust Discrete Conformal Equivalence with Boundary* paper and a map of the `ConformalIdealDelaunay` reference implementation — the strongest current method for computing a discrete metric of prescribed curvature on a triangle mesh. |
| `projection-design.md` | Penrose-Wallpaper integration notes: which model to render in, how the existing renderer pipeline changes, what is cheap vs. expensive. |

## Sources

The two primary sources read for this directory:

- **Ratcliffe, John G.** *Foundations of Hyperbolic Manifolds.* Graduate Texts
  in Mathematics 149, Springer. 2nd ed. (also: 3rd ed., 2019). The textbook
  reference; sections drawn from: §3 (hyperbolic geometry; §3.5 hyperbolic
  trigonometry — laws of cosines I/II, area = angle defect, T(2,p,q) sides),
  §4 (inversive geometry — Möbius transformations, Poincaré extension,
  conformal ball + upper half-space models, isometry classification), §5
  (isometry groups, discrete groups, discrete Euclidean groups, elementary
  groups), §6.1 (projective disk model), §6.6–§6.8 (Dirichlet domains,
  convex fundamental polyhedra, tessellations, side-pairing → cycle
  relations → group presentation), §7.1 (reflection groups, Coxeter
  presentations), §7.2 (simplex reflection groups: spherical / Euclidean /
  hyperbolic classification).
- **Campen, M.; Capouellez, R.; Shen, H.; Zhu, L.; Panozzo, D.; Zorin, D.**
  (2021) "Efficient and Robust Discrete Conformal Equivalence with Boundary."
  *ACM Trans. Graph.* 40(6), Article 1 (SIGGRAPH Asia). The reference
  implementation is the [`ConformalIdealDelaunay`](https://github.com/mcampen/ConformalIdealDelaunay)
  C++ codebase.

Full citations land in `../tilings/bibliography.md` under
*Hyperbolic geometry*.
