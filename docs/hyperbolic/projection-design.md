# Poincaré-disk projection — design as implemented

The `todo.md` item is

> **Hyperbolic projection mode (Poincaré disk).** Distinct geometry
> path; generators stay Euclidean.

This file is the design *and* the implementation map — read both
together with the code. The mode is live: select Settings → Projection
to switch between Euclidean (default) and Poincaré disk.

## What "generators stay Euclidean" means

A `Family` produces a list of `Tile` objects in E² with E² vertex
coordinates and a `type` tag. The hyperbolic mode leaves family code
untouched and changes only the world-to-clip path:

1. **World coordinates** stay in E². No change to `tiling/penrose.cpp`,
   no new substitution rules, no Coxeter reflection group.
2. **Projection** runs *in the vertex shader* (`fill.vert`, `border.vert`):

       z   = x̂ · tanh(|x|·s/2)                  // E² → B², s = hypScale
       w   = τ_b(z)                              // hyperbolic boost in B²
       clip = view · w                            // affine map disk → clip

   The radial homeomorphism `x ↦ x̂ · tanh(|x|·s/2)` is bijective
   ℝ² → B² and conformal at the origin. `hypScale` controls the *tile
   spread* inside the disk: the derivative at r=0 is `s/2`, so larger
   `s` expands content near the centre and saturates far content
   against the disk boundary (the *Circle Limit* feel); smaller `s`
   compresses *everything* toward the disk centre — at `s = 0` the
   whole tiling collapses to a single point. Default 1.5 (slider 50)
   gives a moderate spread.
   The view-matrix `baseScale` is forced to 1.0 in disk mode (rather
   than the Euclidean `min(2/gw, 2/gh)·0.95`) because the shader's
   output is strictly inside the unit disk — `tanh ∈ (-1, +1)` and
   `τ_b` preserves B². No margin: the disk boundary is at infinite
   hyperbolic distance, so content thins to zero density approaching
   it; there's no sharp edge to clip. Without this override, raising
   `hypScale` pushes the projected disk past the screen edges (the
   Euclidean `baseScale` sizes against the pre-projection world).
3. **Tile sides** are straight in E² and, under a non-affine map E² → B²,
   map to curves; rendered as a straight clip-space segment from
   projected endpoint to projected endpoint, the tile edge cuts inside
   the true hyperbolic geodesic and the visual character is wrong.
   The `hypEdgeSubdiv` setting (1–32) splits each border edge into N
   equal sub-segments in E² *before* the dedup map and the GPU upload;
   each sub-segment is projected per-vertex by the shader and connected
   by a straight clip-space segment, so a polyline approximates the
   arc. Default 1 (no tessellation, cheap chord); 16 reads as a true
   arc at typical zoom.
4. **The result** is a *picture* of a Euclidean tiling under a
   hyperbolic-styled projection, not the orbit of a Fuchsian group. No
   Euclidean substitution tiling is the orbit of any discrete
   hyperbolic-isometry group. This is what Escher's *Circle Limit*
   prints look like to most viewers and what every other hyperbolic-art
   tool (HyperRogue, KaleidoTile, Wikipedia's tiling figures) does for
   non-{p,q} tilings.

## Validity across families

| Family | Status in the disk projection |
|---|---|
| P3 / P2 / P1 (Penrose) | Cosmetic. *Circle Limit* aesthetic on a Euclidean substitution; valid as decoration, not as an H² tiling. |
| Ammann–Beenker, Heptagonal, Dodecagonal | Cosmetic. Same. The cut-and-project superspace structure is preserved (still a projection of a higher-D periodic lattice — the projection runs in the *display* path, not the geometry). |
| Chair / Pinwheel / Tübingen / Danzer | Cosmetic. Same. |
| **Binary** (Godrèche–Lançon) | **Geometrically meaningful.** The Euclidean Binary family descends from the H² *binary tiling of the plane*: tiles bounded by horocyclic arcs in H². The disk projection of our Binary tiles is therefore a faithful Circle-Limit view of *something close to* the genuine H² ancestor (the horocycles bound become approximate boundary-tangent circles in B²). See `../tilings/pentagonal-binary.md`. |

So: valid in the Penrose / aperiodic / quasi-crystallographic tiling
space as a **projection** that is cosmetic for most families and
quasi-faithful for Binary. It is *not* a claim that Penrose tiles are
hyperbolic — that would require a new generator, not a projection.

## Why this projection map

There is no global conformal homeomorphism ℂ → 𝔻 (Riemann mapping
theorem excludes ℂ itself), so every E² → B² map distorts angles away
from the origin. Three radially-symmetric options were considered;
hyperbolic-radius `x̂ · tanh(|x|·s/2)` won on visual feel. Linear-radius
`x / (1 + |x|)` is the fallback if `tanh` ever becomes a shader hot
spot. The map `x · 2 / (1 + |x|²)` (inverse-stereographic equator
projection) is *not* a homeomorphism — `|x|=2` maps to `0.8·x̂`,
wrapping back — and must not be used.

## Pan: hyperbolic boost τ_b

The disk centre is moved by the **hyperbolic translation τ_b of B²**,
not a Euclidean translation. Settings → Projection → "Disk centre — X /
Y" carries the components of b ∈ B² (clamped to |b| ≤ 0.92 so the τ_b
denominator stays bounded). Audio / time / page-scroll modulation
reaches the boost through the **Hyperbolic boost X / Y** Target nodes
in the node graph — the graph's evaluate() clamps the additive
modulation into [-0.92, +0.92] component-wise.

τ_b formula (Ratcliffe Eq. 4.5.5):

    τ_b(z) = [(1 − |b|²) z + (|z|² + 2 z·b + 1) b]
             / (|b|² |z|² + 2 z·b + 1).

## Fill shader: unchanged

`fill.frag` operates in tile-local E² barycentric coordinates (worn-edge
factor, anisotropic tangent, ripple phase, …). The projection happens in
`fill.vert` per-vertex, so the fragment shader continues to work in
tile-local coordinates and only `gl_Position` is hyperbolic. Within-tile
shading parameters become subtly non-uniform in hyperbolic-screen-space
but the difference is sub-pixel at typical zoom and not worth the
inverse-projection-per-fragment cost.

## Files touched

| File | What it does in disk mode |
|---|---|
| `cpp/settings.h` | `Projection` enum + 4 new fields (`projection`, `hypScale`, `hypBoostX/Y`, `hypEdgeSubdiv`); `geometryChanged` triggers on `hypEdgeSubdiv` (rebuild) but not on `projection` (shader-side, no rebuild). |
| `cpp/jni_bridge.cpp` | `kIntCount=13`, `kFloatCount=87`. Decodes the new ints/floats. |
| `cpp/renderer/render_state.h` | `PushBlock` extended to 48 bytes — `hypBoostX/Y`, `hypScale`, `projection`. |
| `cpp/renderer/renderer.cpp` | Populates the new push-constant slots from `fx*` graph results; clamps `\|b\|` to 0.92 and `hypScale` ≥ 1e-3 against runaway graph modulation. |
| `cpp/renderer/renderer_geometry.cpp` | When `projection==PoincareDisk` and `hypEdgeSubdiv>1`, splits each border edge into N sub-segments before the dedup map. |
| `cpp/graph/graph.{h,cpp}` | Three new `Target` node kinds: `OutHypBoostX`, `OutHypBoostY`, `OutHypScale`. Clamp ranges defined in the graph's `evaluate()` lo/hi tables. |
| `shaders/fill.vert`, `shaders/border.vert` | `hyp` push-constant vec4; projection block gated on `pc.hyp.w > 0.5`. |
| `kotlin/Settings.kt` | Five new fields with conversion (boost 0..100 → -0.9..+0.9, scale 0..100 → 0..3.0, etc.) and SharedPreferences keys. |
| `kotlin/SettingsFragment.kt` | New `Projection` screen registered + navigation row. |
| `res/xml/preferences.xml`, `res/xml/preferences_projection.xml`, `res/values/arrays.xml` | Projection navigation entry, the screen itself, and the `projection_entries`/`projection_values` arrays. |

## Culling, future work

The disk's boundary is at infinite hyperbolic distance. The renderer
inherits the existing screen-space scissor + view-zoom-based culling
(no projection-specific culling yet). At default zoom and a moderate
patch size the disk fills the screen with finite-area content; running
into the boundary requires a very large `generation` plus a small
`hypScale`, at which point a screen-space-diameter cull would kick in.
That is the same cull the planned *Endless home-screen pan*
(`../tilings/ROADMAP.md`) needs, so the two work share.

Fill-triangle interior tessellation (currently only edges are
tessellated) is the obvious next refinement — visible only at very
large tiles. Not worth a follow-up unless someone reports the
straight-chord interior look as a problem.

## Out of scope (still)

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
