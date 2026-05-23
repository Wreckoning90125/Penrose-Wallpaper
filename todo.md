# TODO

Forward-looking work, ranked. Items that change subsystem architecture
link to the detailed roadmap doc that owns them; items that don't are
described inline.

Completed work is tracked in the per-doc Status sections it belongs to
(`docs/render/physical-material-rendering.md` §0 for surface phases,
`docs/tilings/ROADMAP.md` for tiling families); this file is the single
forward-looking list — no duplication of "done" across files.

## Surface / render

- **Phase E — HDR offscreen + bloom + AgX tonemap.** Specular and
  clearcoat glints and emissive ripple crests resolve and glow instead
  of clipping; the composite pass owns tonemap + encode so AgX runs
  once, in linear, regardless of the swapchain path. New
  `R16G16B16A16_SFLOAT` offscreen attachment; dual-Kawase bloom
  (luminance-thresholded downsample chain ~5 mips, upsample-combine);
  composite/tonemap fullscreen pass; offscreen images + sampler +
  pipelines + descriptor sets. Detail:
  `docs/render/physical-material-rendering.md` §5 Phase E.

- **Phase F — border merge.** Draw the border inside `fill.frag` as a
  `smoothstep` on Phase A's `edgeDist`; drop `border.vert`,
  `border.frag`, `BorderVertex`, and the border pipeline. One pipeline
  draws fill + border, the shared-uniforms factor naturally shrinks to
  the two fill stages. Detail:
  `docs/render/physical-material-rendering.md` §5 Phase F.

## Tilings

- **Hat / Spectre einstein.** 2023
  (Smith–Myers–Kaplan–Goodman-Strauss); documented metatile
  substitution (H, T, P, F clusters), volume-hierarchic →
  closure-verifiable exactly as Danzer was. Spectre is strictly chiral
  (needs no reflections). Drops in as one `FamilySpec` row + one
  geometry function. Detail: `docs/tilings/ROADMAP.md` *Obvious next
  step* + `docs/tilings/catalogue.md`.

- **Square-triangle / Shield / Socolar 12-fold.** Largely a display
  split of the existing dodecagonal rhombs (square+triangle); Shield
  and Socolar are MLD with what we have. Detail:
  `docs/tilings/dodecagonal.md`.

- **Socolar–Taylor monotile.** Hierarchical; the tile is **not
  connected**, so the `Tile` model would need a disconnected-tile
  representation. Detail: `docs/tilings/ROADMAP.md`.

- **Harriss 7-fold rhomb substitution.** Blocked on the rhomb-packing
  closure solver below. Detail: `docs/tilings/heptagonal.md`.

- **Hyperbolic projection mode (Poincaré disk).** Distinct geometry
  path; generators stay Euclidean. Detail:
  `docs/tilings/hyperbolic-and-tooling.md`.

- **Endless home-screen pan.** Rework `Generative` from "grow the
  patch under view" to "translate the view across an unbounded
  tiling": generate tiles covering the visible window plus a margin
  as it moves, drop tiles that leave. Decouples view position from
  generation depth; the home-screen page offset feeds the same
  translation. Detail: `docs/tilings/ROADMAP.md`.

## Docs

- **Bibliography refactor.** Convert each per-doc `### References`
  block into short pointers into `docs/tilings/bibliography.md` (which
  already holds the full citations). Mechanical pass over ~12 files.

- **Per-family superspace / cut-and-project record.** For the de
  Bruijn families: document the higher-dimensional lattice + acceptance
  window. Detail: `docs/tilings/hyperbolic-and-tooling.md`.

## Tooling

- **Rhomb-packing closure solver** (edge-match + interior-vertex
  angle = 2π). Unblocks the Harriss 7-fold family and figure-free
  derivation of rhomb substitutions. Detail: `docs/tilings/ROADMAP.md`.

- **`verify_tilings.cpp`: substitution-matrix primitivity + Perron
  eigenvalue.** A tighter algebraic certificate alongside the area /
  coverage check. Detail: `docs/tilings/ROADMAP.md`.

- **Delaney–Dress symbol classifier** for vertex configurations.
  Rigorous, figure-free classification of every family's vertex stars.
  Detail: `docs/tilings/ROADMAP.md`.
