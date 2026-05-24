# Roadmap — candidate additions

Best candidate work for the next session, ranked. Not a symmetry-family doc;
a planning list. Effort is relative (low = one row + one generator, as the
Danzer family was; high = new subsystem).

Two tracks run in parallel: **tiling choice** (this file) and **surface
sophistication** (`docs/render/physical-material.md`, the BRDF + lighting +
preset architecture). The tiling track's committed next item is the
Hat / Spectre einstein family — see *Obvious next step* below.

## Renderer — new families and modes

| Candidate | Kind | Effort | Status / blocker |
|-----------|------|--------|------------------|
| **Hat / Spectre einstein** | new E² substitution `Family` | medium | **Top pick.** Smith–Myers–Kaplan–Goodman-Strauss 2023 (`catalogue.md`). The metatile substitution (H, T, P, F clusters) is published and volume-hierarchic → closure-verifiable exactly as Danzer was. The Spectre needs no reflections (strictly chiral). |
| Square-triangle / Shield / Socolar 12-fold | extend `Dodecagonal` | low–medium | `dodecagonal.md`, `catalogue.md`. Square+triangle is largely a display split of the existing dodecagonal rhombs; Shield/Socolar are MLD. |
| Socolar–Taylor monotile | new `Family` | medium | `catalogue.md`. Hierarchical; the tile is *not connected*, so the `Tile` model would need a disconnected-tile representation. |
| Harriss 7-fold rhomb substitution | new `Family` | high | `heptagonal.md`. Blocked on the rhomb-packing closure solver below. |
| Hyperbolic projection mode (Poincaré disk) | new projection, not a `Family` | **shipped** | Vertex-shader projection (`fill.vert`, `border.vert`); τ_b boost + scale + edge subdivision in Settings; three Target nodes in the modulation graph. Background in `../hyperbolic/` (models, isometries, discrete groups, projection design); boundary against the Euclidean engine in `hyperbolic-and-tooling.md`. Cosmetic for the substitution families, quasi-faithful for Binary (its H² horocyclic ancestor). |
| Endless home-screen pan | rework of the `Generative` pan mode | medium–high | Today's `Generative` mode grows the patch — each drag triggers a deflation pass, the view stays centred. True endless pan instead *translates* the view across an unbounded tiling: generate tiles covering the visible window plus a margin as it moves, drop tiles that leave. Decouples view position from generation depth; the home-screen page offset feeds the same translation. |

## Docs

| Candidate | Effort | Note |
|-----------|--------|------|
| Convert per-doc `### References` to short pointers into `bibliography.md` | low–medium | `bibliography.md` already holds every full citation; the per-doc subsections still duplicate them. Mechanical pass over ~12 files. |
| Per-family superspace / cut-and-project record | medium | For the de Bruijn families: document the higher-dimensional lattice + acceptance window (`hyperbolic-and-tooling.md`). |

## Tooling

| Candidate | Effort | Unblocks |
|-----------|--------|----------|
| Rhomb-packing closure solver (edge-match + interior-vertex angle = 2π) | high | the Harriss 7-fold family; figure-free derivation of rhomb substitutions |
| `verify_tilings.cpp`: also emit substitution-matrix primitivity + Perron eigenvalue | low | a tighter algebraic certificate alongside the area/coverage check |
| Delaney–Dress symbol classifier for vertex configurations | medium | rigorous, figure-free classification of every family's vertex stars |

## Obvious next step

The **Hat/Spectre einstein** family: it is the highest-profile aperiodic
result of the decade, its substitution is documented and volume-hierarchic,
and it drops into the engine as one `FamilySpec` row plus one geometry
function — the same shape of work as the Danzer family, verifiable by
`tools/verify_tilings.cpp`. Pair it with the `bibliography.md` pointer
refactor to finish the doc tree.
