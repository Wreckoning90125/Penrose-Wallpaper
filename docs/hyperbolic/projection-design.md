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
   ℝ² → B² and conformal at the origin. `hypScale` controls the
   *compression toward the boundary*: the derivative at r=0 is `s/2`,
   so larger `s` saturates far content against `|z|=1` (the *Circle
   Limit* feel); smaller `s` keeps the projection close to a uniform
   radial squeeze.
   The view matrix **auto-fits the projected tiling to the screen**
   in disk mode — `baseScale = 1 / tanh(r_max · s / 2)`, where r_max
   is the farthest world-bbox corner. At low `s` the projected
   tiling is small in disk coordinates, so `baseScale` is large and
   the visible content fills the screen with the disk boundary
   off-screen; at high `s` the projected radius approaches 1 and
   `baseScale → 1`, so the disk boundary lands at the screen edge
   with far tiles piled against it. Decoupling fit from compression
   removes the "tile collapse to invisible dot" failure mode the
   slider used to have at low values.
3. **Tile sides** are straight in E² and, under a non-affine map E² → B²,
   map to curves; rendered as a straight clip-space segment from
   projected endpoint to projected endpoint, the tile edge cuts inside
   the true hyperbolic geodesic and the visual character is wrong. Two
   independent slider knobs split this into a polyline approximation:
   `hypBorderSubdiv` (1..32, cost linear in N) splits each tile-edge
   border into N straight sub-segments; `hypFillSubdiv` (1..8, cost
   N², so capped lower) splits each fill triangle into N² child
   triangles via a barycentric (i,j,k) grid with linear interpolation
   of bary/bulge/centroid/material into each child vertex. The bevel
   `min(bary)` still falls only on original parent edges (interior
   subdivision cuts never have a zero barycentric). Separate sliders
   because forcing one cap on both either stops the cheap one short or
   blows fill memory at high counts — at gen-6 with 1500 tiles,
   fillSub=32 would mean 1.5M sub-tris ≈ 250 MB of vertex data.
   Defaults 1 (no tessellation); border=8 + fill=4 reads as a true
   arc-and-fill approximation at typical zoom.
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
| `cpp/settings.h` | `Projection` enum + 5 new fields (`projection`, `hypScale`, `hypBoostX/Y`, `hypBorderSubdiv`, `hypFillSubdiv`); `geometryChanged` triggers on either subdivision count AND on `projection` — all three gate the tessellation path so toggling any of them has to rebuild for the polyline split to apply or strip. |
| `cpp/jni_bridge.cpp` | `kIntCount=14`, `kFloatCount=87`. Decodes the new ints/floats; clamps `hypBorderSubdiv` to [1,32] and `hypFillSubdiv` to [1,8] defensively. |
| `cpp/renderer/render_state.h` | `PushBlock` extended to 48 bytes — `hypBoostX/Y`, `hypScale`, `projection`. |
| `cpp/renderer/renderer.cpp` | Populates the new push-constant slots from `fx*` graph results; clamps `\|b\|` to 0.92 and `hypScale` ≥ 1e-3 against runaway graph modulation. In disk mode the view matrix auto-fits the projected and boosted geometry: `baseScale = 1 / postR` where `postR = (projR + \|b\|) / (1 + projR·\|b\|)` is the Möbius-addition max of `\|τ_b(z)\|` over the projected ball — exact bound across the full boost range, no off-screen overflow. `projR = tanh(geomRmax · hypScale / 2)` uses the true farthest vertex computed in buildGeometry, not the bbox corner. |
| `cpp/renderer/renderer_geometry.cpp` | When `projection==PoincareDisk`: if `hypBorderSubdiv>1`, splits each border edge into N sub-segments before the dedup map; if `hypFillSubdiv>1`, tessellates each fill triangle into N² child triangles via barycentric grid + linear attribute interpolation. Records `geomRmax_` = max |vertex| across the actual emitted tile vertices for the auto-fit. |
| `shaders/fill.vert` | `hyp` push-constant vec4; projection block (radial map + τ_b) gated on `pc.hyp.w > 0.5`. |
| `shaders/border.vert` | Same projection block as `fill.vert`, factored as `projectHyp(vec2)`. In disk mode, computes the disk-space tangent analytically by composing the radial-map jacobian (`projTangentRadial`: polar-basis decomposition with radial component scaled by f'(r)=(s/2)·sech²(r·s/2), tangential by f(r)/r=tanh(r·s/2)/r) and the τ_b conformal rotation (`boostTangent`: complex multiply by q̄²/\|q\|² where q = 1 + b̄z). Perpendicular = disk normal, extrude at width = world halfwidth × hypScale/2. Borders stay visibly thick across the entire disk and orient correctly under any boost. |
| `cpp/graph/graph.{h,cpp}` | Three new `Target` node kinds: `OutHypBoostX`, `OutHypBoostY`, `OutHypScale`. Clamp ranges defined in the graph's `evaluate()` lo/hi tables. |
| `kotlin/Settings.kt` | Five new fields with conversion (boost 0..100 → -0.9..+0.9, scale 0..100 → 0..3.0, etc.) and SharedPreferences keys. |
| `kotlin/SettingsFragment.kt` | New `Projection` screen registered + navigation row. |
| `res/xml/preferences.xml`, `res/xml/preferences_projection.xml`, `res/values/arrays.xml` | Projection navigation entry, the screen itself, and the `projection_entries`/`projection_values` arrays. |

## Culling

Inherited from the Euclidean path: the swapchain scissor and the
view-matrix zoom. The auto-fit `baseScale = 1/postR` already keeps
the projected and boosted tiling inside the unit disk in clip space,
so finite-area content stays on-screen at any `hypScale` / boost.

## References

`models.md` (the τ_b formula, the disk model), `isometries.md`
(PSU(1,1) matrix form for τ_b), `discrete-groups.md` (why this is a
projection of an E² tiling, not a Fuchsian-group orbit), and the
`Hyperbolic projection mode` row of `../tilings/ROADMAP.md`.
