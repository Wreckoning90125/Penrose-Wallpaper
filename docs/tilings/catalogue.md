# Catalogue of aperiodic prototile sets

Reference catalogue of every known aperiodic set of prototiles — a
transcription of Wikipedia's "List of aperiodic sets of tiles". Grouped by
the space tiled: **E²** (Euclidean plane), **H²/Hⁿ** (hyperbolic),
**E³/Eⁿ** (Euclidean 3-space and higher).

This is a flat reference list, not a per-system template file — the
generative families the renderer implements are documented in full in their
own files (see `README.md` Index). The **Renderer** column names the `Family`
when this app draws the set (directly or via an MLD-equivalent form), or `—`
when it does not. Full citations are collected in `bibliography.md`; only
author + year appear here.

---

## Key terms

- **MLD** — *mutually locally derivable*: two tilings each reconstructible
  from the other by a local rule; same information, different shapes.
- **Weakly aperiodic** — admits no tiling with a *compact* fundamental domain,
  but may admit one invariant under an infinite symmetry.
- **Strongly aperiodic** — admits no tiling invariant under *any* non-trivial
  symmetry; the unqualified meaning of "aperiodic".
- **Screw-periodic** — every tiling is invariant under a screw motion (rotate
  + translate along an axis), hence non-periodic but not strongly aperiodic.
- **Einstein** — a single prototile ("one stone") that tiles only
  aperiodically; an aperiodic monotile.

---

## E² — Euclidean plane

| Name | Tiles | Year | Renderer | Notes |
|------|-------|------|----------|-------|
| Penrose P1 | 6 | 1974 | P1 | Well-known; head of the list. Six prototiles, Penrose 1974 |
| Penrose P2 (kite & dart) | 2 | 1977 | P2 | Well-known |
| Penrose P3 (rhombs) | 2 | 1978 | P3 | Well-known; independently Ammann 1976 |
| Binary tiles | 2 | 1988 | Binary | Similar in shape to P3 tiles but the tilings are not MLD from each other; developed to model the atomic arrangement in binary alloys |
| Robinson tiles | 6 | 1971 | — | Enforce aperiodicity by forming an infinite hierarchy of square lattices |
| Ammann A1 tiles | 6 | 1977 | — | Enforce aperiodicity by forming an infinite hierarchical binary tree |
| Ammann A2 tiles | 2 | 1986 | — | |
| Ammann A3 tiles | 3 | 1986 | — | |
| Ammann A4 tiles | 2 | 1986 | — | Tilings MLD with Ammann A5 |
| Ammann A5 tiles | 2 | 1982 | — | Tilings MLD with Ammann A4 |
| Penrose hexagon-triangle tiles | 3 | 1997 | — | Uses mirror images of tiles for tiling |
| Pegasus tiles | 2 | 2016 | — | Variant of the Penrose hexagon-triangle tiles; discovered 2003 or earlier |
| Golden triangle tiles | 10 | 2001 | — | Date is for discovery of matching rules; dual to Ammann A2 |
| Socolar tiles | 3 | 1989 | — | Tilings MLD from the tilings by the Shield tiles |
| Shield tiles | 4 | 1988 | — | Tilings MLD from the tilings by the Socolar tiles |
| Square triangle tiles | 5 | 1986 | — | |
| Starfish, ivy leaf and hex tiles | 3 | — | P1 / P2 / P3 | Tiling is MLD to Penrose P1, P2, P3, and Robinson triangles — rendered via the Penrose families |
| Robinson triangle | 4 | — | P1 / P2 / P3 | Tiling is MLD to Penrose P1, P2, P3, and "Starfish, ivy leaf, hex" — rendered via the Penrose families |
| Danzer triangles | 6 | 1996 | Danzer | The renderer's `Danzer` family is the 4-prototile F₇ triangle substitution (Nischke–Danzer 1996); see `heptagonal.md` |
| Pinwheel tiles | 1 | 1994 | Pinwheel | Date is for publication of matching rules |
| Socolar–Taylor tile | 1 | 2010 | SocolarTaylor | Marked hexagonal monotile with local matching rules; rendered through the MLD-equivalent Akiyama-Lee half-hex substitution; shape-only 2D form is disconnected; aperiodic hierarchical, limit-periodic tiling |
| Wang tiles | 20426 | 1966 | — | |
| Wang tiles | 104 | 2008 | — | |
| Wang tiles | 52 | 1971 | — | Enforce aperiodicity by forming an infinite hierarchy of square lattices |
| Wang tiles | 32 | 1986 | — | Locally derivable from the Penrose tiles |
| Wang tiles | 24 | 1986 | — | Locally derivable from the A2 tiling |
| Wang tiles | 16 | 1986 | — | Derived from tiling A2 and its Ammann bars |
| Wang tiles | 14 | 1996 | — | |
| Wang tiles | 13 | 1996 | — | |
| Wang tiles | 11 | 2015 | — | Smallest aperiodic set of Wang tiles |
| Decagonal Sponge tile | 1 | 2002 | — | Porous tile consisting of non-overlapping point sets |
| TS1 | 2 | 2014 | — | Supertile made of 2 tiles |

### E² — aperiodic monotiles

| Name | Tiles | Year | Renderer | Notes |
|------|-------|------|----------|-------|
| Aperiodic monotile using dendrites (Mampusti/Whittaker) | 1 | 2021 | — | Monotile using dendrites and a seed tile |
| Aperiodic spiral monotile (Klaassen) | 1 | 2022 | — | Monotile (one matching rule) using a seed tile |
| Hilbert curve monotile (Klaassen) | 1 | 2022 | — | Monotile creating a Hilbert curve using a seed tile |
| Smith–Myers–Kaplan–Goodman-Strauss "Hat" polytile | 1 | 2023 | Hat | Mirrored monotiles; the first example of an "einstein" |
| Smith–Myers–Kaplan–Goodman-Strauss "Spectre" polytile | 1 | 2023 | Spectre | "Strictly chiral" aperiodic monotile; the first real "einstein" (no reflections needed) |

---

## H² / Hⁿ — hyperbolic space

| Name | Tiles | Space | Year | Renderer | Notes |
|------|-------|-------|------|----------|-------|
| Goodman-Strauss strongly aperiodic tiles | 85 | H² | 2005 | — | |
| Goodman-Strauss strongly aperiodic tiles | 26 | H² | 2005 | — | |
| Böröczky hyperbolic tile | 1 | Hⁿ | 1974 | — | Only weakly aperiodic |

---

## E³ / Eⁿ — Euclidean 3-space and higher

| Name | Tiles | Space | Year | Renderer | Notes |
|------|-------|-------|------|----------|-------|
| Schmitt tile | 1 | E³ | 1988 | — | Screw-periodic |
| Schmitt–Conway–Danzer tile | 1 | E³ | 1988 | — | Screw-periodic and convex |
| Socolar–Taylor tile | 1 | E³ | 2010 | — | Periodic in the third dimension |
| Penrose rhombohedra | 2 | E³ | 1981 | — | |
| Mackay–Amman rhombohedra | 4 | E³ | 1981 | — | Icosahedral symmetry; decorated Penrose rhombohedra with a matching rule that forces aperiodicity |
| Wang cubes | 21 | E³ | 1996 | — | |
| Wang cubes | 18 | E³ | 1999 | — | |
| Danzer tetrahedra | 4 | E³ | 1989 | — | |
| I and L tiles | 2 | Eⁿ, n ≥ 3 | 1999 | — | |

---

## Renderer coverage

The renderer covers the three Penrose sets (P1, P2, P3) directly, plus the
Binary, Pinwheel, Chair, dodecagonal/Ammann–Beenker/heptagonal (de Bruijn
multigrid), Tübingen, Danzer 7-fold, Hat, Spectre, and Socolar-Taylor
families; the Robinson-triangle and "starfish, ivy leaf, hex" sets are MLD to
the Penrose tilings and so are covered through P1/P2/P3. The obvious near-term
12-fold candidates are the **square-triangle** and **Shield / Socolar** sets,
which relate directly to our existing Dodecagonal family.
