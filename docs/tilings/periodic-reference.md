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
Classical; quadibloc pentagonal-tilings page.
