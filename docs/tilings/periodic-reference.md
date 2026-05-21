# Periodic tilings — contrast baseline

This file is the **contrast baseline only**. Periodic tilings are not what
the renderer's tiling engine is for; they are documented here so the
aperiodic systems in the rest of `docs/tilings/` have something concrete to
be defined *against*. One file, one place — do not scatter periodic-tiling
notes elsewhere.

The key fact periodic tilings establish: a periodic planar tiling can have
rotational symmetry of order **1, 2, 3, 4, or 6 only** — never 5, 7, 8, 12.
This "crystallographic restriction" is the entire reason the interesting
families (5-, 7-, 8-, 12-fold) must be aperiodic.

Source: `quadibloc.com/math` pentagonal-tilings page (Cairo tiling and the
17 wallpaper groups).

---

## Conventional periodic tilings (the 17 wallpaper groups)

**Summary.** Every periodic planar tiling belongs to one of exactly 17
symmetry (wallpaper) groups. The reference frame for "what aperiodic buys
you."

| Property         | Value |
|------------------|-------|
| Symmetry order   | 1, 2, 3, 4, or 6 (crystallographic restriction) |
| Symmetry type    | periodic |
| Aperiodic        | no |
| Prototiles       | any (e.g. square, hexagon, octagon+square, dodecagon+triangle) |
| Construction     | direct (translational unit cell) |
| Inflation factor | n/a |
| Attribution      | classical |

### Prototiles
Any shape set with a translational repeating unit. Examples named in the
source: a tiling of squares; octagons alternating with squares (4-fold);
hexagons; dodecagons with triangles in the truncated-corner gaps.

### Construction
A translational unit cell repeated on a lattice. No recurrence, no matching
rules beyond shape fit.

### Matching rules
None.

### Symmetry & aperiodicity
Exact-global symmetry, but limited to orders 1, 2, 3, 4, 6 by the
crystallographic restriction. There are exactly **17 wallpaper groups**. Not
aperiodic — fully periodic by definition.

### Variants & relations
The dodecagon+triangle periodic tiling is the periodic analogue that the
aperiodic dodecagonal tilings (`dodecagonal.md`) extend; the octagon+square
periodic tiling is the periodic analogue behind `octagonal.md`. The argument
"if aperiodic octagonal tilings exist, might aperiodic dodecagonal tilings
exist?" starts from exactly these periodic tilings.

### History & decoration
Classical tiling theory; the 17 wallpaper groups are a standard result.

### Renderer mapping
Not a `Family` and never should be — the renderer's tiling engine exists for
the aperiodic families. A periodic tiling, if ever needed, is a trivial
lattice loop, not a substitution.

### References
Classical; quadibloc pentagonal-tilings page.

---

## Cairo tiling

**Summary.** A periodic tiling by a single *irregular* pentagon — the proof
that pentagons tile the plane only when not regular.

| Property         | Value |
|------------------|-------|
| Symmetry order   | periodic |
| Symmetry type    | periodic |
| Aperiodic        | no |
| Prototiles       | 1 — an irregular (non-regular) pentagon |
| Construction     | direct (translational unit cell) |
| Inflation factor | n/a |
| Attribution      | named for street paving in Cairo |

### Prototiles
A single irregular pentagon. Regular pentagons cannot tile the plane;
irregular ones can.

### Construction
Periodic — a translational repeating cell, one of the 17 wallpaper groups.
No recurrence.

### Matching rules
None — pieces fit periodically.

### Symmetry & aperiodicity
Fully periodic; not aperiodic. Demonstrates that the obstruction to
pentagonal tiling is *regularity*, not pentagons as such — the foundational
fact that motivates the entire 5-fold aperiodic program.

### Variants & relations
Savard's experiments with related irregular-pentagon tilings: three irregular
pentagons meeting at a point yields a tiling that also contains hexagons; a
harder construction reaches an all-irregular-pentagon tiling with a hexagonal
repeating cell — but with no less shape distortion than the Cairo tiling.

### History & decoration
Named for its use in Cairo street paving.

### Renderer mapping
Not a `Family`. Documented as the conceptual starting point: it shows why
5-fold *periodic* tiling fails, which is why the renderer's pentagonal
families (P3, P2) are aperiodic substitution tilings instead.

### References
Classical; quadibloc pentagonal-tilings page. The Cairo pentagon is type 4
in the *Monohedral convex pentagonal tilings* section below.

---

## Monohedral convex pentagonal tilings

**Summary.** Exactly 15 types of convex pentagon tile the Euclidean plane
monohedrally (one tile shape, congruent copies) — the full enumeration of how
pentagons can do periodically what regular pentagons cannot.

| Property         | Value |
|------------------|-------|
| Symmetry order   | periodic |
| Symmetry type    | periodic |
| Aperiodic        | no |
| Prototiles       | 15 convex pentagon types (one tile each, monohedral) |
| Construction     | direct |
| Inflation factor | n/a |
| Attribution      | Reinhardt, Kershner, James, Rice, Stein, Mann–McLoud-Mann–Von Derau |

### Prototiles
A regular pentagon **cannot** tile the plane: its interior angle 108° does not
divide 360°. 15 types of convex pentagon are known to tile, each a one-tile
monohedral set.

Convention: vertices A, B, C, D, E; sides a, b, c, d, e, where side a, b, c,
d, e is clockwise from vertex A, B, C, D, E respectively (so vertices
A, B, C, D, E are opposite sides d, e, a, b, c). Each type is a family
constrained by the conditions below; most have degrees of freedom (types 14
and 15 have none).

| Type | Discoverer (year) | Defining angle / edge conditions |
|------|-------------------|----------------------------------|
| 1  | Reinhardt (1918) | B + C = 180°; A + D + E = 360° |
| 2  | Reinhardt (1918) | c = e; B + D = 180° |
| 3  | Reinhardt (1918) | a = b, d = c + e; A = C = D = 120° |
| 4  | Reinhardt (1918) | b = c, d = e; B = D = 90° |
| 5  | Reinhardt (1918) | a = b, d = e; A = 60°, D = 120° |
| 6  | Kershner (1968)  | a = d = e, b = c; B + D = 180°, 2B = E |
| 7  | Kershner (1968)  | b = c = d = e; B + 2E = 2C + D = 360° |
| 8  | Kershner (1968)  | b = c = d = e; 2B + C = D + 2E = 360° |
| 9  | Rice (1976–77)   | b = c = d = e; 2A + C = D + 2E = 360° |
| 10 | James (1975)     | a = b = c + e; A = 90°, B + E = 180°, B + 2C = 360° |
| 11 | Rice (1976–77)   | 2a + c = d = e; A = 90°, 2B + C = 360°, C + E = 180° |
| 12 | Rice (1976–77)   | 2a = d = c + e; A = 90°, 2B + C = 360°, C + E = 180° |
| 13 | Rice (1976–77)   | d = 2a = 2e; B = E = 90°, 2A + D = 360° |
| 14 | Stein (1985)     | 2a = 2c = d = e; A = 90°, B ≈ 145.34°, C ≈ 69.32°, D ≈ 124.66°, E ≈ 110.68° (with 2B + C = 360°, C + E = 180°) |
| 15 | Mann, McLoud-Mann & Von Derau (2015) | a = c = e, b = 2a, d = a + (√2)/(√3 − 1); A = 150°, B = 60°, C = 135°, D = 105°, E = 90° |

Type 14 has no degrees of freedom; exactly b/a = √((11√57 − 25)/8) and
sin B = (√57 − 3)/8. Type 15 has no degrees of freedom either.

### Construction
Direct — each type is laid as a periodic tiling with a translational unit
cell; no recurrence and no inflation. Types differ in how copies pair up and
group into the repeating block (e.g. mirror-image pairs, 2-tile or larger
fundamental domains).

### Matching rules
None — pieces fit by shape and the angle/edge conditions of their type.

### Symmetry & aperiodicity
Fully periodic; not aperiodic. Wallpaper-group symmetries occurring across the
15 types: p2, pgg, cmm, cm, pmg, p1, p3, p31m, p4, p4g, p6. Many tilings have
pgg (22× orbifold), which reduces to p2 (2222) when chiral mirror-image tiles
are counted as distinct prototiles.

Reinhardt's types 1–5 all admit isohedral tilings. Grünbaum & Shephard found
exactly **24** distinct isohedral types of pentagon tiling; 9 of the 24 are
edge-to-edge. There is no upper bound on k for k-isohedral tilings (using
tiles that simultaneously satisfy type 1 and type 2). Bagina (2011) and
Sugimoto (2012) showed there are exactly **8** edge-to-edge convex types.

The list of 15 was proved **complete** by Michaël Rao (2017, computer-assisted;
the first half independently verified by Thomas Hales). Rao's proof also
establishes the contrast-baseline fact: **no convex polygon tiles the plane
*only* aperiodically** — every convex prototile that tiles at all admits a
periodic tiling. The complete list of convex polygons that tile the plane is:
these 15 pentagons, 3 hexagon types, all quadrilaterals, and all triangles.

### Variants & relations
The three dual-uniform (Laves) pentagonal tilings are special high-symmetry
cases:
- **Prismatic pentagonal** — V3.3.3.4.4, type 1, wallpaper group cmm.
- **Cairo pentagonal** — V3.3.4.3.4, type 4, wallpaper group p4g (the *Cairo
  tiling* section above).
- **Floret pentagonal** — V3.3.3.3.6, types 1/5/6, wallpaper group p6.

Non-convex pentagons tile in more ways than convex ones — e.g. the sphinx, a
pentagonal rep-tile that tiles aperiodically yet also periodically. An
equilateral triangle, a square, and a regular hexagon each split into 3, 4,
and 6 congruent non-convex pentagons respectively.

Nonperiodic monohedral pentagonal tilings exist without substitution:
Hirschhorn's tiling has 6-fold rotational symmetry (pentagon angles A = 140°,
B = 60°, C = 160°, D = 80°, E = 100°). Klaassen (2016) showed every discrete
n-fold rotational symmetry with n > 2 is realizable by a monohedral
pentagonal tiling — a non-periodic but also non-substitution route to n-fold
symmetry.

### History & decoration
Discovery history of the 15 types: Reinhardt (1918) types 1–5; Kershner
(1968) types 6–8; James (1975) type 10; Rice (1976–77) types 9, 11, 12, 13;
Stein (1985) type 14; Mann, McLoud-Mann & Von Derau (2015) type 15. Rao
(2017) closed the enumeration.

### Renderer mapping
Not implemented and not a `Family`. These are periodic tilings (or, for the
Hirschhorn/Klaassen cases, rotational-monohedral but non-substitution), so
they fall outside the renderer's substitution engine. The Cairo pentagon
(type 4) is documented in the *Cairo tiling* section above. This section is a
contrast baseline only.

### References
quadibloc pentagonal-tilings page; Rao (2017). Full citations in
`bibliography.md`.
