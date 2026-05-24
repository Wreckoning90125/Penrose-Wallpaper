# Hyperbolic geometry — notes for the planned H² projection mode

Background for the **Hyperbolic projection mode (Poincaré disk)**, which
ships in this build (Settings → Projection). The renderer's tiling
generators are Euclidean; the hyperbolic mode is a *projection* — the
vertex shader maps each world coordinate through the E² → B² radial
homeomorphism and the τ_b hyperbolic boost before the affine view
transform takes it to clip space. Validity table per family is in
`projection-design.md`. The maths reference material backing every
choice is here so the next change has its derivations within reach.

Two parallel tracks:

- **Direct rendering of an E² tiling in H².** Take an existing `Family` (P3
  rhombs, Ammann–Beenker, …) and map its vertex coordinates through a
  Euclidean → Poincaré-disk projection. The tile generators stay Euclidean;
  what changes is the world-to-screen path and the way tile sides are
  drawn (now circular arcs, not straight segments). This is the cheap,
  visually distinct option — see `projection-design.md`.
- **Native hyperbolic tilings (regular {p,q} with 1/p + 1/q < 1/2).** Requires
  a hyperbolic-isometry transform stack and orbit enumeration of a discrete
  group acting on H², not just a projection of Euclidean coordinates. See
  `discrete-groups.md` for the group theory and `models.md` for which model
  to compute in.

Out of scope here: implementation in shaders / Vulkan plumbing.
Implementation choices are tracked in `projection-design.md` once the design
is decided. Boundary with the Euclidean engine is recorded in
`../tilings/hyperbolic-and-tooling.md`.

## Files

| File | Contents |
|------|----------|
| `models.md` | The four standard models of Hⁿ (hyperboloid, conformal ball / Poincaré disk, upper half-space, projective disk / Beltrami–Klein), their metrics, geodesics, arc-length and volume elements. How to convert between them. |
| `isometries.md` | Möbius transformations on Ên, the Poincaré extension, the classification (elliptic / parabolic / hyperbolic), and matrix forms (PSL(2,ℝ) for H², PSL(2,ℂ) for H³, PO(n,1) in general). |
| `discrete-groups.md` | Discrete subgroups of I(H²), Fuchsian groups, fundamental domains, elementary vs. non-elementary, and how regular {p,q} tilings sit inside this. |
| `discrete-conformal.md` | Summary of the Campen et al. 2021 *Efficient and Robust Discrete Conformal Equivalence with Boundary* paper and a map of the `ConformalIdealDelaunay` reference implementation. Adjacent technique, not on the projection critical path; here so the option is known. |
| `projection-design.md` | Penrose-Wallpaper integration notes: which model to render in, how the existing renderer pipeline changes, what is cheap vs. expensive. |

## Sources

The two primary sources read for this directory:

- **Ratcliffe, John G.** *Foundations of Hyperbolic Manifolds.* Graduate Texts
  in Mathematics 149, Springer. 2nd ed. (also: 3rd ed., 2019). The textbook
  reference; chapters used: §3 (Hyperbolic Geometry), §4 (Inversive Geometry
  — reflections, stereographic projection, Möbius transformations, Poincaré
  extension, conformal ball model, upper half-space model, classification),
  §5 (isometry groups, discrete groups, discrete Euclidean groups, elementary
  groups), §6.1 (projective disk model).
- **Campen, M.; Capouellez, R.; Shen, H.; Zhu, L.; Panozzo, D.; Zorin, D.**
  (2021) "Efficient and Robust Discrete Conformal Equivalence with Boundary."
  *ACM Trans. Graph.* 40(6), Article 1 (SIGGRAPH Asia). The reference
  implementation is the [`ConformalIdealDelaunay`](https://github.com/mcampen/ConformalIdealDelaunay)
  C++ codebase.

Full citations land in `../tilings/bibliography.md` under
*Hyperbolic geometry*.
