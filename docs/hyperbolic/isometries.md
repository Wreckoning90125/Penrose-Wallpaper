# Isometries of hyperbolic space

What an isometry of Hⁿ *is* depends on the model, but the underlying group
is the same. This file collects the four forms in which the same isometry
group shows up in the four standard models, the classification of
individual isometries into elliptic / parabolic / hyperbolic, and the
matrix forms relevant in dimensions 2 and 3.

## Möbius transformations of Êⁿ

A *sphere of Êⁿ* (the one-point compactification ℝⁿ ∪ {∞}) is either a
Euclidean sphere S(a, r) or an extended hyperplane P(a, t) ∪ {∞}; the
latter is topologically a sphere. A **Möbius transformation** of Êⁿ is a
finite composition of reflections of Êⁿ in such spheres. The group of
Möbius transformations of Êⁿ is M(Êⁿ).

Every isometry of Êⁿ (or similarity, or affine map of Eⁿ) extends to a
Möbius transformation of Êⁿ by setting f(∞) = ∞; in particular,
I(Eⁿ) ⊂ M(Êⁿ).

**Equivalent characterisation.** A homeomorphism φ : Êⁿ → Êⁿ is a Möbius
transformation if and only if it preserves the *cross ratio*

    [u, v, x, y] = d(u, x) d(v, y) / [d(u, v) d(x, y)]

(d is the chordal metric from stereographic projection to Sⁿ).

**Isometric sphere.** For φ ∈ M(Êⁿ) with φ(∞) ≠ ∞, there is a unique
Euclidean sphere Σ — the *isometric sphere* — and a Euclidean isometry ψ
such that φ = ψ σ where σ is reflection in Σ. The radius of Σ is the unique
r making φ act as a Euclidean isometry on S(φ⁻¹(∞), r).

## The four model-specific groups

I(Hⁿ) ≅ PO(1, n) (Lorentz group restricted to the time-positive sheet).

I(Bⁿ) — the conformal-ball isometry group — is exactly the subgroup
M(Bⁿ) ⊂ M(Êⁿ) of Möbius transformations that leave Bⁿ invariant. A
reflection σ of Êⁿ in a sphere Σ leaves Bⁿ invariant if and only if Σ is
orthogonal to Sⁿ⁻¹, so every isometry of Bⁿ is a composition of
reflections in spheres orthogonal to Sⁿ⁻¹.

I(Uⁿ) = M(Uⁿ): the subgroup of M(Êⁿ) leaving the upper half-space Uⁿ
invariant. By the **Poincaré extension** theorem, M(Uⁿ) ≅ M(Êⁿ⁻¹) — a
Möbius transformation φ of Êⁿ⁻¹ extends uniquely to a Möbius
transformation φ̃ of Êⁿ that leaves Uⁿ invariant. So:

    I(Hⁿ) ≅ M(Bⁿ) ≅ M(Uⁿ) ≅ M(Êⁿ⁻¹) ≅ PO(1, n).

| n | M(Êⁿ⁻¹), orientation-preserving subgroup |
|---|---|
| 2 | LF(R̂) = PSL(2,ℝ) acting on Ê¹ = ℝ ∪ {∞}; isomorphic to I₀(H²) |
| 3 | LF(Ĉ) = PSL(2,ℂ) acting on the Riemann sphere; isomorphic to I₀(H³) |

LF denotes linear fractional transformations.

## Classification: elliptic, parabolic, hyperbolic

For a non-identity Möbius transformation φ of Bⁿ (equivalently, of Uⁿ, or
an isometry of Hⁿ), the **Brouwer fixed-point theorem** applied to the
closed ball B̄ⁿ gives at least one fixed point, and the structure of the
fixed-point set classifies φ:

| Type | Fixed points | Characterisation in Uⁿ | Geometric action |
|---|---|---|---|
| **Elliptic** | at least one in Bⁿ (the open interior) | conjugate to an orthogonal transformation of Eⁿ fixing the origin | rotation about a fixed hyperbolic m-plane |
| **Parabolic** | none in Bⁿ; exactly one on Sⁿ⁻¹ | conjugate to the Poincaré extension of a fixed-point-free isometry of Eⁿ⁻¹ (translation, glide, screw, …) | "translation along a horocycle"; leaves each horosphere based at the fixed point invariant and acts as a Euclidean isometry on it |
| **Hyperbolic** (a.k.a. loxodromic when the rotational part is nontrivial in 3D) | none in Bⁿ; exactly two on Sⁿ⁻¹ | conjugate to the Poincaré extension of a magnification ψ(x) = kAx with k > 1 and A orthogonal | translation along the *axis*, the geodesic between the two boundary fixed points; rate log k per unit time; one fixed point attracting, one repelling |

This is conjugacy-invariant, so it depends only on the conjugacy class of
φ in I(Hⁿ).

**Detecting type from a 2×2 matrix.** For
A = [[a, b], [c, d]] ∈ SL(2,ℂ) acting on Ĉ as φ(z) = (az + b)/(cz + d), define
tr² φ = (a + d)². Acting on U³ via Poincaré extension:

| tr² φ | Type |
|---|---|
| in [0, 4) | elliptic |
| = 4 | parabolic |
| in (4, ∞) | hyperbolic translation |
| in ℂ \\ [0, ∞) | loxodromic |

For SL(2,ℝ) acting on U², the cases reduce to the first three (tr² φ is
always real).

**Attractive vs. repulsive fixed points.** For a parabolic φ with fixed
point a ∈ Sⁿ⁻¹ and any x ∈ Bⁿ, φᵐ(x) → a. For a hyperbolic φ with
attracting fixed point a and repelling b, φᵐ(x) → a for any x ∈ B̄ⁿ \ {b}.

## Matrix forms in dimensions 2 and 3

**Orientation-preserving isometries of H²** ≅ PSL(2,ℝ): real 2×2 matrices
of determinant 1 modulo ±I, acting on the upper half-plane as

    z ↦ (a z + b) / (c z + d),    a, b, c, d ∈ ℝ,    ad − bc = 1.

In the Poincaré disk model — identify B² with the unit disk in ℂ — the
same group is realised as PSU(1,1):

    z ↦ (a z + b̄) / (b z + ā),    |a|² − |b|² = 1.

The standard isomorphism between the two forms is conjugation by
η(z) = (iz + 1)/(z + i): if Φ_U(z) = (az + b)/(cz + d) ∈ PSL(2,ℝ) acts on
U², then η Φ_U η⁻¹ acts on B² as the corresponding PSU(1,1) element.

**Orientation-preserving isometries of H³** ≅ PSL(2,ℂ): complex 2×2
matrices of determinant 1 modulo ±I, acting on U³ via Poincaré extension as

    w ↦ (a w + b)(c w + d)⁻¹,    a, b, c, d ∈ ℂ,    ad − bc = 1,

where w = z + tj ∈ {ℂ × ℝ⁺} is identified with U³ via the quaternions.

**Orientation-reversing.** Including a complex conjugation: M(Ĉ) =
LF(Ĉ) ∪ LF(Ĉ) · ρ where ρ(z) = z̄. Every Möbius transformation of Ĉ is
either a linear fractional transformation or the composition of one with
conjugation; LF(Ĉ) = M₀(Ĉ) is the index-2 orientation-preserving subgroup.

## Special elements

**Hyperbolic translation by b ∈ Bⁿ** (an isometry of Bⁿ taking 0 to b):

    τ_b(x) = [(1 − |b|²) x + (|x|² + 2 x·b + 1) b] / (|b|² |x|² + 2 x·b + 1).

τ_b is the composition of two reflections in hyperplanes orthogonal to the
line through 0 and b, and is hyperbolic if b ≠ 0 (with axis that line).

**Magnification in Uⁿ** is x ↦ kx for k > 0; it acts as a hyperbolic
translation along the positive xₙ-axis with translation length log k.

**Composition of two reflections in spheres** gives every orientation-
preserving isometry: the orientation-preserving subgroup M₀(Uⁿ) is
generated by such products. If the two spheres are disjoint and there is a
sphere tangent to both, the product factors into two parabolic
translations.

## Why this matters for a renderer

Computing a Poincaré-disk image of a tiling reduces to: for each tile,
compose an orientation-preserving isometry of B² with the tile's local
coordinates. The cheap representations are:

- **PSL(2,ℝ) acting on U², then map to B² with η.** Single 2×2 real
  matrix per isometry; compose by matrix multiplication; resolve overflow
  by renormalising determinant to 1.
- **PSU(1,1) on B² directly.** 2×2 complex matrix with |a|² − |b|² = 1;
  identical composition story; avoids the η round-trip but uses complex
  arithmetic.
- **PO(1, 2) on H².** 3×3 real matrices; six independent entries; slower
  to multiply but no special form to maintain.

For visibility-culling purposes, the natural early-out is the **isometric
circle** of the next-to-apply transformation: points outside that circle
move closer to the boundary, points inside move further from it (one of
the two by orientation), and points on it are preserved in distance.

## References

Ratcliffe, §4.1 (reflections), §4.3 (Möbius transformations), §4.4
(Poincaré extension), §4.5 (B² ≅ M(B²)), §4.6 (U² ≅ PSL(2,ℝ); U³ ≅
PSL(2,ℂ)), §4.7 (classification). See `../tilings/bibliography.md` under
*Hyperbolic geometry*.
