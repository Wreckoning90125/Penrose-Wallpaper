# TODO

Forward-looking work, ranked. Items that change subsystem architecture
link to the detailed roadmap doc that owns them; items that don't are
described inline.

Completed work is tracked in git history and the per-doc reference
sections it belongs to (`docs/render/physical-material.md` for the
surface architecture, `docs/tilings/ROADMAP.md` for tiling families);
this file is the single forward-looking list — no duplication of "done"
across files.

## Surface / render

- **Phase E — HDR offscreen + bloom + AgX tonemap.** Specular and
  clearcoat glints and emissive ripple crests resolve and glow instead
  of clipping; the composite pass owns tonemap + encode so AgX runs
  once, in linear, regardless of the swapchain path. New
  `R16G16B16A16_SFLOAT` offscreen attachment; dual-Kawase bloom
  (luminance-thresholded downsample chain ~5 mips, upsample-combine);
  composite/tonemap fullscreen pass; offscreen images + sampler +
  pipelines + descriptor sets. Background:
  `docs/render/physical-material.md` "Lighting rig".

- **Phase F — border merge.** Draw the border inside `fill.frag` as a
  `smoothstep` on the Phase A `edgeDist`; drop `border.vert`,
  `border.frag`, `BorderVertex`, and the border pipeline. One pipeline
  draws fill + border, the shared-uniforms factor naturally shrinks to
  the two fill stages. Background:
  `docs/render/physical-material.md` "Files and ownership".

## Tilings

- **Square-triangle / Shield / Socolar 12-fold.** Not the shipped
  `Dodecagonal` de Bruijn rhomb-square family, but closely related:
  the square-triangle display layer can reuse that machinery, while
  Shield/Socolar need their own substitution or decoration mapping.
  Detail: `docs/tilings/dodecagonal.md`.

- **Harriss 7-fold rhomb substitution.** Separate from the shipped
  `Heptagonal` multigrid rhombs and `Danzer` triangles. Implementing
  it needs either a rhomb-packing closure solver or an explicit,
  verifiable coordinate reconstruction of the published substitution
  rule. Detail: `docs/tilings/heptagonal.md`.

- **Endless home-screen pan.** Rework `Generative` from "grow the
  patch under view" to "translate the view across an unbounded
  tiling": generate tiles covering the visible window plus a margin
  as it moves, drop tiles that leave. Decouples view position from
  generation depth; the home-screen page offset feeds the same
  translation. Detail: `docs/tilings/ROADMAP.md`.

- **Per-family preview tile shapes.** Material picker thumbnails
  currently render onto a single Penrose fat-rhomb (`tools/bake_preset_thumbnails.py::chip_normal`)
  for every preset, regardless of the active tiling family. The bake
  could emit `family × preset` PNGs using a representative tile shape
  per family (rhomb / triangle / chair / L-tile / etc.) so the picker
  preview matches the active family's geometry. Either bake all
  combinations as static drawables, or move the preview to a runtime
  offscreen render pass with the actual `fill.frag` (heavier — see
  Phase E groundwork).

## Docs

- **Per-family superspace / cut-and-project record.** For the de
  Bruijn families: document the higher-dimensional lattice + acceptance
  window. Detail: `docs/tilings/hyperbolic-and-tooling.md`.

## Tooling

- **Rhomb-packing closure solver** (edge-match + interior-vertex
  angle = 2π). Gives a figure-free route to the Harriss 7-fold rhomb
  substitution and other rhomb substitution reconstructions. Detail:
  `docs/tilings/ROADMAP.md`.

- **`verify_tilings.cpp`: substitution-matrix primitivity + Perron
  eigenvalue.** A tighter algebraic certificate alongside the area /
  coverage check. Detail: `docs/tilings/ROADMAP.md`.
