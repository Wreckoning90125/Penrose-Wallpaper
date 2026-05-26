# Models of hyperbolic n-space

There is one hyperbolic n-space Hⁿ — a Riemannian manifold of constant
sectional curvature −1 — but four standard concrete models for it. They are
pairwise isometric; switching between them is a matter of choosing the model
whose coordinates and metric make the operation at hand cheapest.

For a Penrose-Wallpaper hyperbolic projection mode (which is 2-dimensional,
n = 2), the relevant models are the **Poincaré disk** (conformal ball with
n = 2, the M. C. Escher *Circle Limit* model), the **Beltrami–Klein disk**
(projective disk), and the **upper half-plane** (used by PSL(2,ℝ) and the
Campen et al. ideal-Delaunay construction). The **hyperboloid** is the
ambient model from which the others are derived and on which the isometry
group acts as a matrix group; it is rarely the right model to actually
compute in.

## Cheat-sheet

| Property | Hyperboloid Hⁿ | Conformal ball Bⁿ (Poincaré) | Upper half-space Uⁿ | Projective disk Dⁿ (Beltrami–Klein) |
|---|---|---|---|---|
| Carrier set | {x ∈ ℝⁿ⁺¹ : x∘x = −1, x₁ > 0} | {x ∈ ℝⁿ : \|x\| < 1} | {x ∈ ℝⁿ : xₙ > 0} | {x ∈ ℝⁿ : \|x\| < 1} |
| Boundary | light cone limit | unit sphere Sⁿ⁻¹ (ideal points) | hyperplane Êⁿ⁻¹ = ℝⁿ⁻¹ ∪ {∞} | unit sphere Sⁿ⁻¹ |
| Distance d(x,y) | acosh(−x∘y) | acosh(1 + 2\|x−y\|² / [(1−\|x\|²)(1−\|y\|²)]) | acosh(1 + \|x−y\|² / (2xₙyₙ)) | d_B(μ(x), μ(y)), no closed form |
| Element of arc length ds | from the Lorentzian metric on the ambient ℝⁿ⁺¹ | 2 \|dx\| / (1 − \|x\|²) | \|dx\| / xₙ | derived from Hⁿ via gnomonic projection μ |
| Element of volume dV | dV on the hyperboloid | 2ⁿ dx₁…dxₙ / (1 − \|x\|²)ⁿ | dx₁…dxₙ / xₙⁿ | derived via μ |
| Conformal? | n/a | **yes** — hyperbolic ∠ = Euclidean ∠ at every point | **yes** | **no** — angles distorted, but geodesics straight |
| Geodesics | H² ∩ time-like 2-plane | straight diameters or arcs orthogonal to the boundary | vertical lines or half-circles orthogonal to ℝⁿ⁻¹ | straight Euclidean chords |
| Isometry group | PO(n,1) acting by Lorentz transformations | M(Bⁿ) — Möbius transformations preserving Bⁿ; n = 2 case is PSU(1,1) ≅ PSL(2,ℝ) | M(Uⁿ) ≅ M(Êⁿ⁻¹); n = 2 case is PSL(2,ℝ); n = 3 case is PSL(2,ℂ) | restriction of PO(n,1) acting projectively on ℝℙⁿ; n = 2 case is PGL(2,ℝ) on the disk |
| Used by | foundational; trigonometry derivations | rendering, *Circle Limit*, hyperbolic crochet | PSL(2,ℝ)/PSL(2,ℂ) calculations, ideal Delaunay, modular surfaces | ideal triangles look Euclidean (used by Springborn / Campen et al. for Penner coordinates) |

`∘` denotes the Lorentzian inner product −x₁y₁ + x₂y₂ + ⋯ + xₙ₊₁yₙ₊₁
(see *Hyperboloid model* below).

## Hyperboloid model Hⁿ

The base. Lorentzian n+1-space ℝ¹,ⁿ has the symmetric bilinear form

    x ◦ y = −x₁y₁ + x₂y₂ + ⋯ + xₙ₊₁yₙ₊₁.

A vector x is *time-like* if x∘x < 0, *space-like* if > 0, *light-like* if
= 0. The hyperboloid

    Hⁿ = {x ∈ ℝⁿ⁺¹ : x∘x = −1, x₁ > 0}

is the positive sheet of the unit-imaginary "sphere" of two sheets. The
hyperbolic distance is

    cosh d_H(x, y) = −x ∘ y.

Isometries of Hⁿ are exactly the restrictions of the *positive* Lorentz
transformations PO(1,n) (linear maps of ℝⁿ⁺¹ that preserve `◦` and the time
direction). Geodesics are the intersections of Hⁿ with 2-dimensional
time-like vector subspaces of ℝⁿ⁺¹ — a hyperbola branch — and parametrized
by

    λ(t) = (cosh t) x + (sinh t) y,    x, y Lorentz-orthonormal.

This model is rarely used to *render* in but is the cleanest setting for
proofs (e.g. the duality between spherical and hyperbolic trigonometry
becomes "imaginary radius").

## Conformal ball / Poincaré disk Bⁿ

The model used by Escher's *Circle Limit* prints, by hyperbolic crochet, and
the natural one to *render* in. The carrier set is the open Euclidean unit
ball

    Bⁿ = {x ∈ ℝⁿ : |x| < 1},

with metric

    cosh d_B(x, y) = 1 + 2 |x − y|² / [(1 − |x|²)(1 − |y|²)].

The element of arc length is

    ds = 2 |dx| / (1 − |x|²).

Volumes:

    dV = 2ⁿ dx₁…dxₙ / (1 − |x|²)ⁿ.

The isometry from Hⁿ to Bⁿ is **stereographic projection from −eₙ₊₁** onto
the Bⁿ × {0} hyperplane:

    ζ(x) = (2x₁, …, 2xₙ, 1 + |x|²) / (1 − |x|²),     ζ : Bⁿ → Hⁿ.

**Geodesics** are intersections of Bⁿ with Euclidean m-spheres orthogonal to
the boundary sphere Sⁿ⁻¹, together with straight diameters of Bⁿ. In 2D:
diameters of the disk, plus circular arcs orthogonal to the unit circle.

**Angles are preserved** (the model is conformal) — hence "conformal ball
model." This is why Escher's tile boundaries can be circular arcs and yet
the corner angles at vertices are visibly the same on each tile.

**Hyperbolic spheres are Euclidean spheres.** A set S ⊂ Bⁿ is a hyperbolic
sphere if and only if S is a Euclidean sphere contained in Bⁿ. The
hyperbolic and Euclidean centres differ unless the centre is the origin.

**Horospheres** in Bⁿ are Euclidean spheres internally tangent to Sⁿ⁻¹. In
2D, *horocycles* are Euclidean circles tangent to the unit circle from
inside.

**Isometries.** Every isometry of Bⁿ extends uniquely to a Möbius
transformation of Êⁿ that leaves Bⁿ invariant; these are exactly the
compositions of reflections of Êⁿ in spheres orthogonal to Sⁿ⁻¹. See
`isometries.md`.

**Hyperbolic translation by b ∈ Bⁿ** (the "boost" that takes 0 to b):

    τ_b(x) = [(1 − |b|²) x + (|x|² + 2 x·b + 1) b] / (|b|² |x|² + 2 x·b + 1).

In 2D, identifying B² with the unit disk in ℂ, every orientation-preserving
isometry is

    z ↦ (a z + b̄) / (b z + ā),    |a|² − |b|² = 1.

## Upper half-space Uⁿ

The model used for PSL(2,ℝ) (n = 2) and PSL(2,ℂ) (n = 3), and for the
ideal-Delaunay / Penner-coordinate construction of Campen et al. (see
`discrete-conformal.md`). Carrier set

    Uⁿ = {x ∈ ℝⁿ : xₙ > 0},

with arc length and volume

    ds = |dx| / xₙ,      dV = dx₁…dxₙ / xₙⁿ,

and metric

    cosh d_U(x, y) = 1 + |x − y|² / (2 xₙ yₙ).

**Geodesics** are vertical Euclidean lines and Euclidean half-circles whose
centres lie on the boundary hyperplane Êⁿ⁻¹.

**The standard isomorphism U² ≅ B²** is η(z) = (iz + 1) / (z + i) — a
specific Möbius transformation. In general η = σ ρ where ρ reflects in
Eⁿ⁻¹ and σ reflects in the sphere S(eₙ, √2).

**Horospheres** in Uⁿ are either Euclidean hyperplanes parallel to Eⁿ⁻¹
(based at ∞) or Euclidean spheres in Uⁿ tangent to Eⁿ⁻¹ at one point (based
at that point). The horosphere Σ₁ = {xₙ = 1} inherits a natural Euclidean
metric d(x, y) = |x − y| — the element of hyperbolic arc length |dx|/xₙ
becomes the element of Euclidean arc length on Σ₁.

**Isometries in 2D.** Identifying U² with {z ∈ ℂ : Im z > 0}, every
orientation-preserving isometry is a Möbius transformation

    z ↦ (a z + b) / (c z + d),    a, b, c, d ∈ ℝ,    ad − bc = 1,

i.e. an element of PSL(2,ℝ). Orientation-reversing isometries have the form
z ↦ (a (−z̄) + b) / (c (−z̄) + d).

**Isometries in 3D.** Identifying U³ with the quaternions {z + tj : z ∈ ℂ,
t > 0}, every Möbius transformation of U³ is

    w ↦ (a w + b)(c w + d)⁻¹,    a, b, c, d ∈ ℂ,    ad − bc = 1,

acting on w = z + tj — i.e. PSL(2,ℂ). This is the standard 3-manifold
calculation model.

## Projective disk / Beltrami–Klein Dⁿ

Same carrier set as the Poincaré ball — {x ∈ ℝⁿ : |x| < 1} — but with a
different metric. The map from Dⁿ to Hⁿ here is the *gnomonic projection*
(vertical translation by eₙ₊₁ followed by radial projection to the
hyperboloid):

    μ(x) = (x + eₙ₊₁) / |||x + eₙ₊₁|||,    μ : Dⁿ → Hⁿ,

with inverse

    μ⁻¹(x₁, …, xₙ₊₁) = (x₁/xₙ₊₁, …, xₙ/xₙ₊₁).

The metric is d_D(x, y) = d_H(μ(x), μ(y)).

**Two-line description:** Dⁿ is the Poincaré disk's carrier with the
projective Hⁿ → Dⁿ structure that makes **geodesics straight Euclidean
chords** of the disk. Angles are not preserved.

**Why both disk models?** The Beltrami–Klein model is the natural one for
geometric arguments where straight lines matter (e.g. Hilbert's
parallel-postulate proof, ideal-triangle bookkeeping); the Poincaré disk is
the natural one for conformal rendering and for tilings with curved sides.
Ratcliffe and the Campen et al. paper switch between them at convenience.

**Ideal triangles.** A triangle in Hⁿ whose vertices are all on the
boundary at infinity is *ideal*. In Beltrami–Klein, an ideal triangle is a
Euclidean triangle inscribed in the unit disk (see Fig. 6 of Campen et al.
2021). In the Poincaré disk, the same triangle has three sides that are
circular arcs joining the three boundary points, each orthogonal to the
boundary circle. All ideal triangles are congruent in Hⁿ — there is a
hyperbolic isometry taking any three ideal points to any other three.

## Hyperbolic trigonometry

For computing the dimensions of a {p, q} fundamental triangle (and
therefore where to place its vertices in B² to seed a reflection
group), the standard formulas are (Ratcliffe §3.5):

**Law of cosines I (sides → angle):** for a hyperbolic triangle with
sides a, b, c and opposite angles α, β, γ,

    cos γ = (cosh a · cosh b − cosh c) / (sinh a · sinh b).

**Law of cosines II (angles → side):** the *dual* identity, only valid
in hyperbolic geometry, lets you solve for sides from angles alone:

    cosh c = (cos γ + cos α · cos β) / (sin α · sin β).

**Law of sines:** `sinh a / sin α = sinh b / sin β = sinh c / sin γ`.

**Area = angle defect:** `Area(T) = π − (α + β + γ)`. So the smallest
hyperbolic triangle T(2, 3, 7) has area `π − (π/2 + π/3 + π/7) = π/42`.

**Right triangle with hypotenuse c, legs a, b, opposite angles α, β:**

    cosh c = cosh a · cosh b              (hyperbolic Pythagoras)
    cos α  = cosh a · sin β               (Bolyai's relation)
    tan α  = tanh b / sinh a              (legs ↔ opposite angle)

**{p, q} fundamental triangle** T(2, p, q) has angles π/2, π/p, π/q.
Apply law of cosines II to get its side lengths:

    cosh(side opposite π/p) = (cos(π/p) + cos(π/2) cos(π/q)) / (sin(π/2) sin(π/q))
                            = cos(π/p) / sin(π/q)
    cosh(side opposite π/q) = cos(π/q) / sin(π/p)
    cosh(hypotenuse, opp π/2) = cot(π/p) cot(π/q)

(The third formula requires `cot(π/p) cot(π/q) > 1`, i.e.
`1/p + 1/q < 1/2`, which is exactly the hyperbolic regime.) For (2, 7,
3), cot(π/7) cot(π/3) = 2.0765 × 0.5774 = 1.1993 ⇒ hypotenuse ≈
0.6068. Convert to Euclidean disk-radius via `tanh(d/2)` (Ratcliffe
Exercise 4.5.1: in B² the Euclidean distance from origin to a point at
hyperbolic distance d is `tanh(d/2)`).

## Converting between models in 2D

Using B² (Poincaré disk in ℂ, |z| < 1), U² (upper half-plane in ℂ,
Im z > 0), and D² (Beltrami–Klein disk in ℝ², |x| < 1):

| From → to | Formula |
|---|---|
| U² → B² | z ↦ (iz + 1) / (z + i) |
| B² → U² | z ↦ i(1 − z) / (1 + z) (inverse of the above) |
| B² → D² | x ↦ 2x / (1 + \|x\|²)  (radial map; same disk, contracted radially) |
| D² → B² | x ↦ x / (1 + √(1 − \|x\|²))  (radial map; inverse) |
| H² → B² | stereographic from −e₃ (formula above) |
| H² → D² | gnomonic, x ↦ (x₁/x₃, x₂/x₃) |

The B² ↔ D² radial map is the one Campen et al. (their §6.1) use to
convert each Beltrami–Klein ideal triangle into the Poincaré disk for
rendering.

## References

Ratcliffe, *Foundations of Hyperbolic Manifolds*, §3.1–§3.2 (Lorentzian
n-space, hyperboloid), §4.5 (conformal ball), §4.6 (upper half-space),
§4.7 (classification of transformations), §6.1 (projective disk). See
`../tilings/bibliography.md` under *Hyperbolic geometry*.

The 2-line "two-triangle chart" Beltrami–Klein construction used by Campen
et al. for ideal-Delaunay flips is in `discrete-conformal.md`.
