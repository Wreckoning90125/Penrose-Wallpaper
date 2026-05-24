# Poincaré-disk projection — design notes

The `todo.md` item is

> **Hyperbolic projection mode (Poincaré disk).** Distinct geometry
> path; generators stay Euclidean.

This file records the open design questions and the cheapest defensible
answers for each, so the next time this surfaces the decision is already
half-made. None of this is implemented.

## What "generators stay Euclidean" means concretely

A `Family` in this repo produces a list of `Tile` objects in E²,
each with E² vertex coordinates and a `type` tag. A "hyperbolic projection
mode" leaves the family code untouched and changes only the world-to-clip
path:

1. **World coordinates** stay in E². No change to `tiling/penrose.cpp`,
   no new substitution rules, no Coxeter reflection group.
2. **Projection** maps the E² vertex coordinates through a fixed map
   φ : E² → B² (the open unit disk).
3. **Tile sides**, which are straight in E² and *look* straight in the
   B² image only at the disk centre, must be rendered as circular arcs
   orthogonal to the boundary — otherwise the visual character of the
   *Circle Limit* aesthetic is missing.
4. **The result** is a *picture* of a Euclidean tiling under a
   hyperbolic-styled projection, not the orbit of a Fuchsian group. There
   is no claim that the tiles are "really" hyperbolic isometric copies;
   they are not (no Euclidean substitution tiling is the orbit of any
   discrete hyperbolic-isometry group). This is, however, exactly what
   Escher's *Circle Limit* prints look like to most viewers, and matches
   what every other hyperbolic-art tool (HyperRogue, KaleidoTile,
   Wikipedia's tiling figures) does for non-{p,q} tilings.

## The five questions

### 1. Which projection map E² → B²?

There is **no global conformal homeomorphism** ℂ → 𝔻 — they have
different conformal structures (Riemann mapping theorem excludes the
plane itself from the list of simply-connected domains mappable
conformally to the disk). Every choice of E² → B² distorts angles away
from the origin; the question is *how* it distorts.

Three radially-symmetric candidates:

| Map | Formula | Property |
|---|---|---|
| **Linear radius** | x ↦ x / (1 + \|x\|) | Bijective ℝ² → B². Conformal at the origin. Euclidean radius is monotone-but-bounded. Cheap and well-behaved. |
| **Hyperbolic-radius** | x ↦ x̂ · tanh(\|x\|/2) | Bijective ℝ² → B². The map for which **hyperbolic distance from the origin in B² equals Euclidean distance from the origin in E²** — i.e. a Euclidean point at Euclidean radius r lands at the B² point whose hyperbolic-disk distance from 0 is r. This is the natural "embed E² as a hyperbolic ray bundle through 0" map. The *Circle Limit* aesthetic. |
| **Squared radius** | x ↦ x · 2 / (1 + \|x\|²) | Restriction of inverse stereographic projection ℝ² → S² to the equator plane. Maps {\|x\|=1} to the unit circle (its image is *not* B² — \|x\|=2 maps to 0.8\|x̂\| etc., wrapping back). Not a homeomorphism — included to flag the trap. |

Recommendation: **hyperbolic-radius**. Cheapest natural-feeling choice
that gives Euclidean tiles a hyperbolic look — tiles near the origin
look almost unchanged, far-away tiles compress against the boundary
exactly as in *Circle Limit* prints. **Linear radius** is the simplest
backup and what to start with if `tanh` isn't on the shader fast path.
**Squared radius** is wrong and only listed here so the formula is not
accidentally tried.

### 2. Render tile sides as arcs or as line segments?

Tile sides are straight in E². Under a non-affine map E² → B², a straight
segment maps to a curve; rendered as a straight Euclidean segment from
projected endpoint to projected endpoint, the tile edge cuts inside the
"true" hyperbolic geodesic and the visual character is wrong.

Two options:

- **Tessellate each edge into n sub-segments before projecting.** Sample
  the edge in E² at n+1 points, project each, connect by straight
  segments. Cheap, no shader changes — fits the existing `border.vert`
  vertex pipeline. n = 8 to 16 is enough for visual quality at typical
  zoom levels.
- **Draw circular arcs in the fragment shader.** Compute the unique
  circular arc through the two projected endpoints orthogonal to the
  boundary circle; rasterise it in the fragment shader by signed-distance
  to that arc. Heavier — replaces `border.frag` rendering — but produces
  exact geodesics at any zoom.

Recommendation: **sub-segment tessellation** for v1; SDF arcs only if a
second pass is worth it. Most viewers do not distinguish n = 16 from a
true arc.

### 3. Fill: same shader, or separate?

The `fill.frag` shader is written for Euclidean tiles. The barycentric
inputs used for shading (worn-edge factor, anisotropic tangent direction,
…) compute in tile-local E² coordinates. If we project the *vertices*
before passing to the GPU, the shader still operates in tile-local
coordinates and only the screen-space position changes.

Recommendation: **project on the CPU, leave `fill.frag` untouched** for
v1. The within-tile shading is sub-pixel-correct in E²; sufficient for
typical zoom. A correct hyperbolic interpretation (constant within-tile
shading parameters in *hyperbolic* coordinates) needs the fragment shader
to do the inverse projection per fragment and is a Phase 2 nicety.

### 4. View navigation: Euclidean pan, or hyperbolic boost?

In a Euclidean wallpaper the home-screen pan offset feeds a translation;
the tile coordinates shift. In a hyperbolic wallpaper, "pan" should be a
*hyperbolic* boost — the isometry τ_b of B² that takes the current centre
to a new point b. This keeps the visual quality (no tile-side-tile gap
opens up near the boundary, tiles near the new centre become large) and
matches HyperRogue's navigation feel.

Two implementations:

- **Apply τ_b after projecting.** Project E² → B² as in question 1, then
  compose with τ_b. The home-screen offset becomes a hyperbolic boost.
- **Pan in E² first, then project.** Standard Euclidean pan; the result
  visually looks like a non-hyperbolic-feeling slide.

Recommendation: **τ_b after projecting** if hyperbolic feel is the
point. The PSU(1,1) matrix is two complex numbers per `(a, b)` and a
single composition per frame.

### 5. Culling

The boundary of B² is at infinite hyperbolic distance — render to the
disk's edge or stop earlier? Two answers:

- **Stop when a tile's projected Euclidean diameter falls below one
  pixel.** Trivial to implement: project the tile's centroid and one
  vertex, measure pixel distance, cull below 1. Stops well short of the
  boundary in practice.
- **Stop when a tile is outside the disk.** Only useful when navigation
  goes far enough that the *projected* tile escapes B² — a non-issue if
  the projection range is the whole disk.

Recommendation: **screen-space-diameter cull at < 1 pixel**. This is the
same logic the `Generative` pan mode could use for its "translate the
view" rewrite (`docs/tilings/ROADMAP.md` *Endless home-screen pan*).

## The two-pipeline question

Three options for how this lives alongside the existing renderer:

- **Add a `projection` setting** to `Settings`: enum {Euclidean,
  PoincareDisk}. The same `Family` runs; the renderer chooses how to
  project per frame. Cheapest; one binary. Memory grows by one matrix
  per renderer instance.
- **Add a separate pipeline.** A `HyperbolicRenderer` parallel to the
  existing `Renderer`. Less coupling, more code duplication.
- **Run the projection in a vertex shader.** Push the four-parameter
  Möbius transform as a UBO field; the shader applies it to each vertex.
  Cleanest separation; the existing fill pipeline survives unmodified.

Recommendation: **setting + per-tile vertex projection in
`renderer_geometry.cpp`**. The cost of evaluating the projection map on
the order of ~10⁵ vertices per frame is well under the GPU draw cost.
Pushing to a vertex shader is a clean future move once the projection is
fixed.

## Things genuinely outside scope here

- **Drawing actual {p, q} hyperbolic tilings.** That needs a Fuchsian /
  reflection-group generator (`discrete-groups.md`), not a projection of
  an E² tiling.
- **Decorating a Riemann surface or 3-manifold with a tiling.** Needs the
  conformal-equivalence stack (`discrete-conformal.md`).
- **Spherical projection mode.** The same skeleton (radial map E² → S²)
  is one signature away from this file's design, but produces a very
  different feel and is not on `todo.md`.

## References

`models.md`, `isometries.md`, `discrete-groups.md`, and the
`Hyperbolic projection mode` row of `../tilings/ROADMAP.md`.
