# Pentagonal tilings — binary, triangle, and HBS systems

The quasicrystal-modelling branch of the 5-fold family: the binary tiling and
its corner-marking rules, the Mikulla–Roth tiling, the two Robinson/Tübingen
triangle tilings that underlie them, and the hexagon-boat-star (HBS)
formalism.

Source: `quadibloc.com/math/pen02.htm`.

A renderer-relevant theme runs through this file: **binary matching rules are
corner/point-marking rules, not edge-arrow rules, and corner rules alone do
not force aperiodicity.**

---

## Binary tiling

**Summary.** The two Penrose rhombs decorated with corner marks instead of
edge arrows. Models two atomic species in a quasicrystal. Notably, the binary
rules do *not* force aperiodicity.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 5-fold |
| Symmetry type    | statistical |
| Aperiodic        | not-forced |
| Prototiles       | 2 — thick rhomb (72°/108°), thin rhomb (36°/144°) |
| Construction     | substitution + corner-marking matching rule |
| Inflation factor | √(2 + φ) ≈ 1.902 — non-Pisot |
| Attribution      | Lançon & Billard 1988; Godrèche & Lançon 1992 |

### Prototiles
The same two golden rhombs as P3, equal unit edge: thick 72°/108°, thin
36°/144°. Each rhomb carries marks at its four **corners** — two corner
types, drawn as white circles (the "large atom" sites, at the acute ends of
the thin rhomb) and black circles ("small atom" sites).

### Construction
A self-similar rhomb-to-rhomb substitution. Godrèche & Lançon (1992) give it
explicitly: with eₖ = (cos 2πk/5, sin 2πk/5), the large rhomb L (72°/108°) is
built on e₀,e₁ and the sharp rhomb S (36°/144°) on e₀,e₂. The substitution
matrix is **[[3,1],[1,2]]** — L → 3L + 1S, S → 1L + 2S — with leading
eigenvalue φ² (so the linear inflation factor is √(2 + φ) ≈ 1.902, a
*non-Pisot* number; the second eigenvalue 3 − φ ≈ 1.382 also exceeds 1). The
growth recurrence (their eq. 3) joins rotated, g-scaled copies of the previous
finite tilings Lₙ, Sₙ; the centred **Bear** and **Dog** patches (their eq. 4)
drop every translation so the copies fan a full turn around the origin. The
boundary of an infinitely-recurred region is a fractal curve (dimension ≈
1.078).

### Matching rules
**Corner marks, not edge arrows** — analogous in kind to the kite-and-dart
point-colouring rules. Adjacent tiles meet so compatible corner marks
coincide; white = large-atom site, black = small-atom site. These rules are
**not strong enough to force the recurrence, and not strong enough to force
aperiodicity** — that is the headline fact.

### Symmetry & aperiodicity
**Aperiodic: not-forced.** The same two rhombs under the binary rules can
produce the aperiodic binary tiling, *or* a Penrose rhomb tiling, *or* a
recursive self-similar tiling, *or* a periodic tiling (the thick rhomb alone
tiles periodically). Aperiodicity requires matching rules beyond the binary
ones.

### Matching rules — addendum
Super-tile rhombs built from small binary rhombs need obey no matching rules
among themselves.

### Variants & relations
Mikulla–Roth tiling (below). Using the thin rhomb as a "diamond", one can
also assemble a boat, a star, and a pentagon from thick+thin rhombs — the
link to the HBS tiling (below). Models a two-species crystal: the white,
acute-thin-rhomb corner is the atom needing more space.

### History & decoration
Of interest in quasicrystal physics as a two-atomic-species model.

### Renderer mapping
Implemented — `Family::Binary` (`generateBinary` in `tiling/penrose.cpp`).
The renderer drives it purely by the substitution (the corner marks are not
modelled — they carry no aperiodicity guarantee anyway). `generateBinary`
runs the Godrèche–Lançon eq. (3) growth recurrence to depth `generations`,
then closes it with eq. (4) into the centred Bear (`seedIdx` 0) or Dog
(`seedIdx` 1) patch, and normalises into the unit disk. Tiles are 4-vertex
rhombs with `type` 0 = L, 1 = S; `waveSymmetry` 5 is shared with P3/P2.
Verified by the substitution harness: exact tile counts from [[3,1],[1,2]],
every rhomb edge-to-edge, no overlaps.

### References
Lançon, F. & Billard, L., *J. Physique* **49** (1988) 249 (the binary tiling);
Godrèche, C. & Lançon, F., "A simple example of a non-Pisot tiling with
five-fold symmetry", *J. Phys. I France* **2** (1992) 207 (the explicit
substitution, eqs. 3–4); Mikulla, Roth (named variant); quadibloc `pen02.htm`.

---

## Mikulla–Roth tiling

**Summary.** A specific binary tiling derived from the Tübingen triangle
tiling by placing atoms at triangle vertices and acute-triangle centres.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 5-fold |
| Symmetry type    | statistical |
| Aperiodic        | yes (inherits Tübingen-triangle aperiodicity) |
| Prototiles       | thick & thin rhombs (binary), derived from acute & obtuse Robinson triangles |
| Construction     | substitution (via the Tübingen triangle tiling) |
| Inflation factor | golden-ratio family |
| Attribution      | Mikulla, Roth |

### Prototiles
A binary tiling, so underlain by the thick/thin rhombs. Constructed from the
acute and obtuse isosceles (Robinson/Tübingen) triangles. Atom decoration:
**large** atoms (white) at every triangle vertex; **small** atoms (black) at
the centre of each *acute* isosceles triangle only.

### Construction
Start from the **Tübingen triangle tiling** (below) with its triangle
substitution. Derive the Mikulla–Roth binary tiling by (a) marking every
triangle vertex as a large/white atom, and (b) placing a small/black atom at
the centre of each acute triangle. The boat/star/pentagon binary clusters
*appear* in it but are not used in its construction.

### Matching rules
Inherits the binary corner-marking rules (white/black corner types).

### Symmetry & aperiodicity
Aperiodic — it carries the aperiodic structure of its Tübingen-triangle
parent.

### Variants & relations
A named member of the binary-tiling family; parent is the Tübingen triangle
tiling.

### History & decoration
A quasicrystal model with two atomic species (large/white, small/black).

### Renderer mapping
Not implemented. Would be a derived layer over a Tübingen-triangle `Family`
rather than a `Family` of its own.

### References
Mikulla, Roth; quadibloc `pen02.htm`.

---

## Robinson triangle tiling

**Summary.** The Penrose rhombs bisected into golden triangles; aperiodic by
inheritance from P3.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 5-fold |
| Symmetry type    | statistical |
| Aperiodic        | yes |
| Prototiles       | 2 — acute (36°-apex) and obtuse (108°-apex) isosceles triangles |
| Construction     | substitution |
| Inflation factor | φ |
| Attribution      | Robinson |

### Prototiles
Two isosceles golden triangles from bisecting Penrose rhombs:
- **Acute** — bisect the **thin** rhomb along its short diagonal: apex 36°,
  base angles 72° (acute Robinson triangle / golden gnomon).
- **Obtuse** — bisect the **thick** rhomb along its long diagonal: apex 108°,
  base angles 36° (obtuse Robinson triangle).
Edge ratios involve φ.

### Construction
A substitution relation: each acute and obtuse triangle subdivides into
smaller acute/obtuse triangles per generation (the standard golden-ratio
inflation). In Savard's diagram, black lines mark current-generation
triangles and orange lines mark next-generation boundaries — the orange lines
encode each triangle's orientation.

### Matching rules
Inherited from the Penrose rhomb rules via the bisection; triangle
orientation (the orange next-generation boundaries) is the operative
constraint.

### Symmetry & aperiodicity
Aperiodic — it is exactly P3 with each rhomb cut into two triangles, so it
inherits Penrose aperiodicity.

### Variants & relations
Closely related to the Tübingen triangle tiling (a similar but distinct
recurrence). Generated from P3.

### History & decoration
A standard quasicrystal building block; the route to the Mikulla–Roth tiling.

### Renderer mapping
Not implemented. Trivially derivable from `Family::P3` by bisecting each
emitted rhomb — a post-process, not a separate `Family`.

### References
Robinson; quadibloc `pen02.htm`.

---

## Tübingen triangle tiling

**Summary.** An aperiodic golden-triangle substitution tiling, sibling to the
Robinson triangle tiling; the parent of the Mikulla–Roth tiling.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 5-fold |
| Symmetry type    | statistical |
| Aperiodic        | yes |
| Prototiles       | acute & obtuse golden isosceles triangles |
| Construction     | substitution |
| Inflation factor | φ |
| Attribution      | Tübingen quasicrystal group |

### Prototiles
Acute and obtuse golden isosceles triangles, the same triangle family as the
Robinson triangles. Vertices are large-atom sites in the Mikulla–Roth
derivation.

### Construction
A substitution similar to — but distinct from — the Robinson triangle
recurrence, shown on the right-hand side of Savard's triangle-recurrence
diagram (black = current generation, orange = next-generation boundaries /
orientation indicator). Each triangle subdivides into next-generation
triangles each step.

### Matching rules
Triangle-orientation rules as encoded by the recurrence diagram.

### Symmetry & aperiodicity
Aperiodic substitution tiling.

### Variants & relations
Sibling of the Robinson triangle tiling; generates the Mikulla–Roth binary
tiling when vertices/centres are marked with atoms.

### History & decoration
Named for quasicrystal research at Tübingen.

### Renderer mapping
Not implemented. A candidate `Family` — a clean two-triangle substitution —
if a triangle-based 5-fold family is ever wanted alongside the rhomb-based
P3.

### References
Tübingen quasicrystal group; quadibloc `pen02.htm`.

---

## HBS (hexagon-boat-star) tiling

**Summary.** A formalism, not a single tiling: any pentagonal tiling using
only diamond/boat/star alongside pentagons converts to a tiling of three
pieces — hexagon, boat, star — each buildable from the two binary rhombs.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 5-fold |
| Symmetry type    | statistical |
| Aperiodic        | not-forced |
| Prototiles       | 3 — hexagon, boat, star |
| Construction     | conversion from a pentagonal tiling (not a standalone substitution) |
| Inflation factor | n/a |
| Attribution      | Savard's framework name |

### Prototiles
Hexagon, boat, and five-point star — the pieces obtained when a pentagonal
tiling's pentagons and diamonds merge into hexagons. Each is composed of
thick and thin rhombs in a binary arrangement.

### Construction
Defined by *conversion from* a pentagonal tiling rather than by a
substitution rule. A pentagonal tiling that uses only diamond, boat, and star
(those pieces not touching) alongside pentagons becomes an HBS tiling when
each pentagon+diamond pair merges into a hexagon.

### Matching rules
Each of boat, star, hexagon is buildable from the two binary rhombs under the
binary corner-marking rules. The **hexagon** can be aligned to reverse the
white/black vertex sequence along its edges; the **boat and star cannot** —
but the way boats and stars actually occur in convertible pentagonal tilings
makes this restriction harmless.

### Symmetry & aperiodicity
**Not-forced.** Even with all three pieces, aperiodicity needs extra matching
rules — a periodic HBS tiling exists (from a repeated rectangular slab of a
Keplerian tiling).

### Variants & relations
- **HBS dual.** In each of the three pieces, the rhomb edges *not* on the
  piece boundary all join boundary points to a single interior point; those
  leftover interior edges bound shapes that tile the plane as a **dual** of
  the HBS tiling — and that dual is itself an HBS tiling (cf.
  cube/octahedron duality).
- **Contrast with Penrose.** The Penrose tiling resembles this binary↔HBS
  relationship (rhomb boundaries form an HBS boat around each Penrose boat,
  etc.) but the Penrose tiling is **not** a binary tiling, so its leftover
  rhomb edges do not form a valid dual — the rhombs inside each hexagon are
  *reversed*.
- Special cases: double-size pentagon and decagon must be excluded for a
  clean HBS definition; a boat-only pentagonal tiling exists; some HBS
  tilings use only hexagons (the reduced Goethe tiling) or only
  hexagons+boats.

### History & decoration
Savard's unifying framework for pentagonal tilings — Penrose, Keplerian, and
Goethe tilings all feed it.

### Renderer mapping
Not implemented. HBS is a *lens* on other tilings rather than a generative
`Family`; if the renderer ever emits a convertible pentagonal tiling, an HBS
view is a post-process (merge pentagon+diamond → hexagon).

### References
Roger Penrose, Johannes Kepler, Goethe-type tilings (all as inputs);
quadibloc `pen02.htm`.
