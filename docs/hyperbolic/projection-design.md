# Poincaré-disk projection — design

The `todo.md` item is

> **Hyperbolic projection mode (Poincaré disk).** Distinct geometry
> path; generators stay Euclidean.

This file is the design. Not implemented yet; written so the next session
can go straight to code without re-deriving anything.

## What "generators stay Euclidean" means concretely

A `Family` produces a list of `Tile` objects in E² with E² vertex
coordinates and a `type` tag. The hyperbolic mode leaves family code
untouched and changes only the world-to-clip path:

1. **World coordinates** stay in E². No change to `tiling/penrose.cpp`,
   no new substitution rules, no Coxeter reflection group.
2. **Projection** maps E² vertex coordinates through
   φ(x) = x̂ · tanh(\|x\|/2) — the map for which hyperbolic distance from
   0 in B² equals Euclidean distance from 0 in E². Bijective ℝ² → B²,
   conformal at the origin, gives Euclidean tiles a *Circle Limit*
   feel: tiles near the centre look almost unchanged, far tiles
   compress against the boundary.
3. **Tile sides** are tessellated into 16 equal sub-segments in E²
   before projection. Each sub-segment is projected and drawn straight;
   16 is enough that the eye doesn't see polylines at typical zoom and
   the existing `border.vert` vertex pipeline takes them unchanged.
4. **The result** is a *picture* of a Euclidean tiling under a
   hyperbolic-styled projection, not the orbit of a Fuchsian group. No
   Euclidean substitution tiling is the orbit of any discrete
   hyperbolic-isometry group. This is what Escher's *Circle Limit*
   prints look like to most viewers and what every other hyperbolic-art
   tool (HyperRogue, KaleidoTile, Wikipedia's tiling figures) does for
   non-{p,q} tilings.

## Why this projection map

There is no global conformal homeomorphism ℂ → 𝔻 (Riemann mapping
theorem excludes ℂ itself), so every E² → B² map distorts angles away
from the origin. Three radially-symmetric options were considered;
hyperbolic-radius x̂ · tanh(\|x\|/2) won on visual feel. Linear-radius
x / (1 + \|x\|) is the fallback if `tanh` ever becomes a shader hot
spot. The map x · 2 / (1 + \|x\|²) (inverse-stereographic equator
projection) is *not* a homeomorphism — \|x\|=2 maps to 0.8·x̂, wrapping
back — and must not be used.

## Pan: hyperbolic boost, not Euclidean translation

The home-screen offset feeds a hyperbolic translation τ_b of B², not a
Euclidean translation of E². Concretely: project E² → B² first, then
compose with τ_b post-projection. The PSU(1,1) matrix for τ_b is two
complex numbers and one composition per frame. This preserves the
visual quality near the new centre — tiles that were small at the disk
edge become large under the boost, matching HyperRogue's navigation
feel — and is the only sane choice for "endless pan in a hyperbolic
projection" (see `../tilings/ROADMAP.md` *Endless home-screen pan*).

τ_b formula (Ratcliffe Eq. 4.5.5):

    τ_b(x) = [(1 − |b|²) x + (|x|² + 2 x·b + 1) b]
             / (|b|² |x|² + 2 x·b + 1).

## Fill shader: unchanged

`fill.frag` operates in tile-local E² barycentric coordinates (worn-edge
factor, anisotropic tangent, ripple phase, …). Projecting *vertices* on
the CPU before they reach the GPU leaves the shader untouched — only
gl_Position changes. Within-tile shading parameters become subtly
non-uniform in hyperbolic-screen-space but the difference is sub-pixel
at typical zoom and not worth the inverse-projection-per-fragment cost.

## Culling

Cull a tile when its post-projection screen-space diameter drops below
one pixel. The disk boundary is at infinite hyperbolic distance, so
geometric series convergence makes this stop a finite number of
generations from any centre. Same logic as the planned `Endless
home-screen pan` rewrite.

## Plumbing

Add a `projection` enum to `Settings` (`Euclidean`, `PoincareDisk`).
The same `Family` runs; `renderer_geometry.cpp` reads the enum and
chooses whether to identity-pass the vertex coordinates or run them
through `φ ∘ τ_b ∘ edge-tessellation`. One binary, one extra UBO field
(the τ_b complex pair). Pushing the projection into a vertex shader is
a clean later move once the CPU path is shipped.

## Out of scope

- **Actual {p, q} hyperbolic tilings.** Needs a Fuchsian /
  reflection-group generator (`discrete-groups.md`), not a projection.
- **Decorating a Riemann surface or 3-manifold with a tiling.** Needs
  the conformal-equivalence stack (`discrete-conformal.md`).
- **Spherical projection mode.** Same skeleton (radial map E² → S²),
  different feel, not on `todo.md`.

## References

`models.md` (the τ_b formula, the disk model), `isometries.md`
(PSU(1,1) matrix form for τ_b), `discrete-groups.md` (why this is a
projection of an E² tiling, not a Fuchsian-group orbit), and the
`Hyperbolic projection mode` row of `../tilings/ROADMAP.md`.
