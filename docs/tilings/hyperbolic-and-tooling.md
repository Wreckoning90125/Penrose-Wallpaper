# Hyperbolic tilings, related art, and external tooling

Context for the boundary of this repo's tiling engine. Every `Family`
generates tiles in E²; the **Poincaré-disk projection mode** (Settings →
Projection; full design in `../hyperbolic/projection-design.md`) maps
those E² coordinates into B² in the shader. This file records the
neighbouring topics — hyperbolic (H²) tilings proper, the decorative-art
lineage, and crystallographic software — that recur in questions but
sit outside the generators / projection that ship today.

## The Euclidean boundary

Every renderer `Family` is a tiling of E² — substitution (P3, P2, P1,
Chair, Pinwheel, Tübingen, Danzer) or de Bruijn dualization (Dodecagonal,
Ammann–Beenker, Heptagonal, Binary). The hyperbolic mode is a *projection*
of those Euclidean generators, not a new family — the generators stay
the same; the display path changes.

## Hyperbolic tilings (H²)

A regular tiling {p,q} (q regular p-gons per vertex) lives in E² when
1/p + 1/q = 1/2, on the sphere when > 1/2, and in **H²** when < 1/2 — an
infinite family (e.g. {5,4}, {7,3}, {5,∞}).

Aperiodicity in H² is not the E² notion. The two split:

| Term | Meaning |
|------|---------|
| weakly aperiodic   | admits tilings, but none with a cocompact (2-D) symmetry group |
| strongly aperiodic | admits tilings, none with an infinite symmetry group |

In E² the two coincide; in H² they do not. Relevant sets (see `catalogue.md`):

| Set | Tiles | Space | Note |
|-----|-------|-------|------|
| Böröczky tile | 1 | Hⁿ | weakly aperiodic monotile (1974) |
| Goodman-Strauss strongly aperiodic | 85 | H² | 2005 |
| Goodman-Strauss strongly aperiodic | 26 | H² | 2005 |

**Genuine overlap with this repo — the binary tiling.** The Godrèche–Lançon
binary tiling (`pentagonal-binary.md`, the `Binary` family) descends from the
*binary tiling of H²*: tiles bounded by horocycle arcs, or by hyperbolic line
segments, which yields pentagonal tilings that are non-periodic because their
symmetry group can be one-dimensional but not two-dimensional. The Euclidean
binary tiling keeps the substitution combinatorics of that H² construction.

## The art lineage — Escher and hyperbolic crochet

| Work | Geometry | Relation here |
|------|----------|---------------|
| Escher, *Regular Division of the Plane* | E², isohedral periodic (17 wallpaper groups) | recoloured isohedral tilings — see `periodic-reference.md` |
| Escher, *Circle Limit* I–IV | H², regular {p,q} (via Coxeter) | the projection mode reproduces the *Circle Limit* aesthetic on Euclidean tilings; genuine {p,q} would need a Fuchsian generator (`../hyperbolic/discrete-groups.md`) |
| Hyperbolic crochet coral (Taimina; Wertheim, *Crochet Coral Reef*) | H² surfaces | constant-negative-curvature surfaces; a {p,q}, 1/p+1/q<1/2, is their discrete skeleton |
| elfnor procedural hyperbolic-coral generators (Blender / Sverchok) | H² surfaces | parametric form of the same surfaces |

None of this is aperiodic-substitution. The shared layer is **decoration**:
Escher's method is recolouring an isohedral tiling, which is exactly what this
renderer adds on top of a substitution tiling (`ColorMode::Type/Orient/Ring`,
palettes). The Poincaré-disk projection mode handles the H² display side
for any of these (`../hyperbolic/projection-design.md`).

## EPINET — the hyperbolic ↔ crystallographic-net bridge

EPINET (*Euclidean Patterns in Non-Euclidean Tilings*; Hyde, Ramsden, Robins,
ANU) enumerates 3-periodic Euclidean nets by wrapping 2-periodic **hyperbolic**
tilings onto triply-periodic minimal surfaces (gyroid, diamond, primitive). Its
edge tables are net (graph) data — each net is a hyperbolic tiling's 1-skeleton
projected into E³.

- The EPINET hyperbolic tilings are encoded by **Delaney–Dress symbols** —
  combinatorial tiling theory: a rigorous, picture-free encoding of a tiling's
  topology. That is the kind of figure-free formalism the substitution work
  wants (cf. the closure algebra in `tools/README.md`).
- The edge tables themselves describe H²-to-E³ nets, not E² substitution
  tilings — orthogonal to anything our families produce.

## Crystallographic and aperiodic-order tooling

| Tool / formalism | Domain | Applies to this repo? |
|------------------|--------|-----------------------|
| spglib, moyo, spgrep | space-group symmetry of periodic 3-D crystals (the 230 space groups) | only `periodic-reference.md`; an aperiodic tiling has no space group |
| pyxtal | random periodic crystal generation | no |
| aflow | periodic materials database | no |
| superspace groups, (3+d)-D (de Wolff–Janner–Janssen) | incommensurate crystals & quasicrystals | **yes** — the cut-and-project families are projections from a higher-D periodic lattice; this is their symmetry language |
| Delaney–Dress symbols, Gavrog / 3dt (Delgado-Friedrichs) | combinatorial tiling topology, figure-free | **yes** — classifies vertex configurations rigorously |
| `tools/verify_tilings.cpp` | substitution-tiling closure | this repo's own check; no off-the-shelf equivalent exists |

The 230 space groups ("sg230") and the periodic-crystallography stack answer a
*periodic* question. Quasicrystals and the cut-and-project families instead
have a **superspace** description: `generateMultigrid` is the de Bruijn dual of
a projection from a higher-dimensional periodic lattice through an acceptance
window. EPINET edge tables run only up to sg230 because they target periodic
3-D nets — the same periodic boundary.

## Renderer implications

- The hyperbolic mode is a **projection** (`../hyperbolic/projection-design.md`),
  not a new `Family` — the generators stay Euclidean and the shader does the
  E² → B² map plus the τ_b boost. The full reference stack for the model
  geometry, isometries, and discrete-group theory is `../hyperbolic/`.
- The `Binary` family is the deepest H² link in the existing generators:
  the Godrèche–Lançon construction descends from the horocyclic binary
  tiling of H². `pentagonal-binary.md` records that origin; in the
  projection mode, the Binary tiles are the closest to genuinely
  hyperbolic content of any family.
- 3-D sets (Penrose rhombohedra, Schmitt–Conway–Danzer, Danzer tetrahedra;
  see `catalogue.md`) belong to a volumetric renderer, a separate engine
  from the 2-D fill-and-border stack here.

## References

See `bibliography.md` (this file's sources are grouped under
*hyperbolic-and-tooling*; the deeper hyperbolic-geometry sources sit
under *hyperbolic geometry*).
