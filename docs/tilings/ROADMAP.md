# Roadmap — candidate additions

Best candidate work for the next session, ranked. Not a symmetry-family doc;
a planning list. Effort is relative (low = one row + one generator, as the
Danzer family was; high = new subsystem).

Two tracks run in parallel: **tiling choice** (this file) and **surface
sophistication** (`docs/render/physical-material.md`, the BRDF + lighting +
preset architecture). The Hat / Spectre einstein family and the
Socolar-Taylor half-hex substitution are now implemented; the next tiling work
should build on the remaining catalogue gaps below.

## Renderer — new families and modes

| Candidate | Kind | Effort | Status / work needed |
|-----------|------|--------|------------------|
| **Hat / Spectre einstein** | E² substitution `Family` | **shipped** | Implemented as `Family::Hat` and `Family::Spectre`; see `einstein.md`. Keep as the baseline for future monotile work. |
| **Socolar-Taylor half-hex** | E² substitution `Family` | **shipped** | Implemented as `Family::SocolarTaylor`; see `socolar-taylor.md`. Uses the Akiyama-Lee half-hex substitution MLD-equivalent to the marked hexagonal Taylor-Socolar tiling. |
| Square-triangle / Shield / Socolar 12-fold | extend `Dodecagonal` plus new substitution/decorations | low–medium | `dodecagonal.md`, `catalogue.md`. Not the shipped de Bruijn rhomb-square family, but close enough to reuse the dodecagonal orientation/render path; Shield/Socolar still need their own substitution or decoration mapping. |
| Harriss 7-fold rhomb substitution | new `Family` | high | `heptagonal.md`. Separate from the shipped `Heptagonal` multigrid rhombs and `Danzer` triangle substitution; needs either a rhomb-packing closure solver or an explicit coordinate reconstruction of the published rule. |
| Hyperbolic projection mode (Poincaré disk) | new projection, not a `Family` | **shipped** | Vertex-shader projection (`fill.vert`, `border.vert`) with Möbius-addition auto-fit; τ_b boost + scale + independent border/fill subdivisions in Settings; three Target nodes in the modulation graph drive boost X/Y and scale. Background in `../hyperbolic/` (models, isometries, discrete groups, projection design); boundary against the Euclidean engine in `hyperbolic-and-tooling.md`. Cosmetic for the substitution families, quasi-faithful for Binary (its H² horocyclic ancestor). |
| Endless / windowed pan | moving-window tiling generation | **shipped** | Android Free pan translates the view in screen pixels, Android Endless follows launcher `xPixelOffset`, and both feed the renderer's active geometry window. The native renderer generates a source patch, filters it to the visible window plus margin around the current view/page offset, drops tiles outside that active window, and keeps full-patch bounds for stable framing. |

## Docs

| Candidate | Effort | Note |
|-----------|--------|------|
| Per-family superspace / cut-and-project record | medium | For the de Bruijn families: document the higher-dimensional lattice + acceptance window (`hyperbolic-and-tooling.md`). |

## Tooling

The finite chamber-graph / vertex-configuration extractor is shipped as
`tools/tiling_dsymbols.h` and is gated by `tools/verify_tilings.cpp`.

| Candidate | Effort | Unblocks |
|-----------|--------|----------|
| Rhomb-packing closure solver (edge-match + interior-vertex angle = 2π) | high | figure-free derivation of the Harriss 7-fold rhomb substitution and other rhomb substitutions |
| `verify_tilings.cpp`: also emit substitution-matrix primitivity + Perron eigenvalue | low | a tighter algebraic certificate alongside the area/coverage check |

## Obvious next step

The **square-triangle / Shield / Socolar 12-fold** lane is now the cleanest
next implementation target. It can reuse the existing dodecagonal machinery
where possible, has local Savard material, and gives immediate visual payoff
without needing a disconnected-tile model.
