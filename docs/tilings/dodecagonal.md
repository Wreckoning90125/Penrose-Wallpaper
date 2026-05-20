# Dodecagonal tilings — 12-fold

The 12-fold family — the richest in the source material; its de Bruijn
rhomb-square member is the renderer's fourth `Family`. Covered here: the
Socolar (butterfly) tiling, the Stampfli 12-star square-triangle tiling, the
de Bruijn rhomb-square dodecagonal tilings, the ship tiling, and the Keplerian
dodecagonal recurrence.

Two construction methods recur: **dualization** (de Bruijn's grid method) and
**substitution** (recurrence). The natural dodecagonal inflation factor is
√(2 + √3) ≈ 1.93185.

Sources: `quadibloc.com/math/dode01.htm` (Socolar), `dode02.htm` (Stampfli,
de Bruijn, ship), and Savard's Keplerian-dodecagonal page.

---

## Socolar (butterfly) tiling

**Summary.** The 12-fold counterpart of the Penrose and Ammann–Beenker
tilings — square, hexagon, and thin rhomb with notch matching rules. Has a
two-generation substitution and four isomorphic presentations.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 12-fold |
| Symmetry type    | statistical |
| Aperiodic        | yes |
| Prototiles       | 3 — square, hexagon (+ its mirror), thin rhomb |
| Construction     | substitution + matching-rule (notches) |
| Inflation factor | dodecagonal scaling, related to 2 + √3 |
| Attribution      | J. Socolar |

### Prototiles
Notched tiles (the notches *are* the matching rules):
- **Square** — has a *preferred direction*; the notches reduce its symmetry
  to bilateral about the axis perpendicular to that direction.
- **Hexagon** — not symmetric at all after notching; **both the hexagon and
  its mirror image are used**, the mirror form explicitly required by the
  recurrence.
- **Thin rhomb** — a 30° dodecagonal rhomb; retains full rhombus symmetry.

### Construction
A substitution shown over two generations — "very similar in appearance to
the Ammann–Beenker substitution but more complicated." Each of square,
hexagon, rhomb is replaced by a cluster of squares, hexagons, and rhombs; the
recurrence calls for the mirror-reflected hexagon as well as the standard
one. The recurrence **preserves exactly the residual symmetry each piece has
after matching rules are imposed**. Generations grow into roughly dodecagonal
clusters.

### Matching rules
Implemented by **edge notches**. Direct prohibitions: two squares may not
touch; two rhombs may not touch; two hexagons may not touch. The
no-two-hexagons rule is a *derived* long-range property — the notches
directly forbid (a) three hexagons at a vertex and (b) two hexagons + a rhomb
+ a square around a vertex, and those two vertex prohibitions together force
hexagon separation.

### Symmetry & aperiodicity
A quasicrystalline aperiodic 12-fold tiling. **Ammann bars**: rows of rhombs
all pointing the same way form obvious linear features; the row spacing is in
ratio (4·cos15° + √2) / (2·cos15°), with cos15° expressible in radicals via
x = 1/(2 + √3).

### Variants & relations
Four isomorphic presentations of the *same* tiling:
- **Butterfly** — the original Socolar form (squares, hexagons, rhombs).
- **Plate** — a trivial reshape of the pieces; useful because the new shapes
  make some symmetries and one aspect of the matching rules more visible.
- **Shield** — an isomorphic form using "shield" tiles, mapped by a direct
  correspondence diagram.
- **Wheel** — an isomorphic form using **only two piece shapes**; looks very
  different until its outline is overlaid on the original.
A specific symmetrical cluster recurs in many orientations; the centres of
those clusters are the vertices of a **square-triangle tiling** (below).

### History & decoration
The 12-fold member of the Penrose (5) / Ammann–Beenker (8) / Socolar (12)
progression. The dual of two superimposed triangular tilings.

### Renderer mapping
Not implemented. A strong aperiodic-12-fold `Family` candidate, though
heavier than Ammann–Beenker: three prototiles, a mirror hexagon, and notch
matching rules. The renderer would drive it by the two-generation
substitution; the ripple shader needs a 12-fold wave-sum branch.

### References
J. Socolar; Hans-Ude Nissen, *Proc. 5th International Conference on
Quasicrystals* (square-triangle cluster observation); quadibloc `dode01.htm`.

---

## Stampfli 12-star (square-triangle) tiling

**Summary.** The canonical 12-fold square-triangle quasicrystal tiling. Dual
of two superimposed hexagonal grids; interconvertible with the de Bruijn
rhomb-square tilings.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 12-fold |
| Symmetry type    | single-centre (exact only about the 12-fold centre) |
| Aperiodic        | yes |
| Prototiles       | 2 — unit square, equilateral triangle (rhombs appear in deeper inflation) |
| Construction     | dualization; substitution ("super-inflation", incomplete in the source) |
| Inflation factor | √(2 + √3) ≈ 1.93185 |
| Attribution      | P. Stampfli |

### Prototiles
Squares and equilateral (60°) triangles, equal edge length. The recurrence
diagram additionally introduces a 30° thin rhomb and, in deeper inflation
layers, a rhomb "whose two ends are symmetric" plus possibly further squares
and triangles.

### Construction
Two routes:
1. **Dualization** — dual of two regular hexagonal tilings superimposed at
   30° (or 90°). See "de Bruijn rhomb-square tilings" below for the grid.
2. **Super-inflation** (substitution) — inflation factor √(2 + √3). Performed
   about the tiling's *vertices*: a fully-filled rosette is placed around
   each parent vertex; rosettes overlap, drawn filled-in while overlapping
   tiles are drawn uncoloured. Three triangle-prototile variants appear; each
   triangle carries two intact dodecagons (rosette disks), and the three
   variants differ only in how that pair of dodecagons is filled. **The
   source's super-inflation rule is incomplete** — only one rhomb kind is
   shown, and deeper layers need the symmetric-ended rhomb and possibly more
   tiles.
   - Related (weaker) property: rotate a 12-star tiling by 15°, scale by
     √(2 + √3), superimpose on the original from the 12-fold centre — every
     vertex of the enlarged tiling lands on a vertex of the original. But
     triangles break into several possible smaller-tile combinations, so this
     is *not* a clean substitution.
Because some triangles occur in groups of three, the recurrence is **not**
derivable from a pure rhomb tiling.

### Matching rules
None stated — constructed by duality / recurrence rather than edge markings.

### Symmetry & aperiodicity
Aperiodic, quasicrystalline. Has a centre of complete 12-fold symmetry; the
super-inflation property holds exactly only when started from a suitable
point such as that centre — hence **single-centre**.

### Variants & relations
Interconvertible with the de Bruijn rhomb-square tiling: split each thick
(60°) rhomb into two equilateral triangles to go rhomb-square → 12-star;
merge to go back. The square-triangle tiling that appears as the cluster-
vertex structure of the Socolar tiling is of this type.

### History & decoration
P. Stampfli, originally in *Helvetica Physica Acta*. Exhibited in Baake,
Grimm & Moody's *What is Aperiodic Order?*. A square-triangle tiling cannot
make a *finite* shape with more than 6-fold symmetry, and is only 6-fold to
infinity about any centre — yet it carries valid 12-fold symmetry in the
statistical sense (any finite patch occurs in both 90°-rotated orientations).

### Renderer mapping
Not implemented. Attractive: only two prototiles (square + equilateral
triangle), both trivial to mesh. The catch is the source's substitution rule
is incomplete — a renderer `Family` would need a *completed* super-inflation
rule, or generation by dualization of the hexagonal grid (below). The 12-fold
ripple branch is shared with the other dodecagonal systems.

### References
P. Stampfli, *Helvetica Physica Acta*; Hans-Ude Nissen (illustration of the
central region); Baake, Grimm & Moody, *What is Aperiodic Order?*; N. G. de
Bruijn (dualization); quadibloc `dode02.htm`.

---

## de Bruijn rhomb-square dodecagonal tilings

**Summary.** The family of 12-fold tilings produced by de Bruijn's
dualization (grid) method — thin rhomb, thick rhomb, square. Interconvertible
with the Stampfli 12-star.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 12-fold |
| Symmetry type    | single-centre (full 12-fold about a special centre) |
| Aperiodic        | yes (quasiperiodic) |
| Prototiles       | 3 — thin rhomb (30°), thick rhomb (60°), unit square |
| Construction     | dualization |
| Inflation factor | n/a (dualization, not substitution) |
| Attribution      | N. G. de Bruijn (dualization method) |

### Prototiles
Thin rhomb (30°), thick rhomb (60° — splits into two equilateral triangles),
and a unit square; all edges equal length.

### Construction
Generated by **dualization** of a multigrid, not by inflation. The grid is
**two regular hexagonal tilings superimposed**, rotated 30° (or 90°) relative
to each other — each hexagonal net is 6-fold, the pair is 12-fold. Proceed
from grid to tiling by taking the dual. Dualization is distinct from the
cut-and-project ("acceptance domain") method — a 12-star would be a slice
through 6-space under cut-and-project, but dualization sidesteps that.
> Drawing note from the source: a hexagon drawn 24 px wide should be
> 27.7128… px high (16√3 at that scale); Savard shortened two rows of
> hexagons by one pixel every seven rows, re-correcting every thirteen such
> adjustments.

### Matching rules
None — produced by dualization rather than local matching.

### Symmetry & aperiodicity
Quasiperiodic; can have full 12-fold symmetry about a special centre.

### Variants & relations
Splitting each thick rhomb into two equilateral triangles converts a de
Bruijn rhomb-square tiling into the **Stampfli 12-star** square-triangle
tiling — the two are the same tiling in different prototiles. The Socolar
butterfly tiling is the analogous dual of two superimposed *triangular*
tilings; the Penrose ↔ "anti-Penrose" rhomb pair stands in the same dual
relationship.

### History & decoration
N. G. de Bruijn's dualization method. Savard notes the regret that the study
of Moiré patterns (superimposed grids of just this kind) did not lead to the
discovery of quasiperiodicity earlier.

### Renderer mapping
Implemented — `Family::Dodecagonal`, the renderer's fourth family, generated
by `generateDodecagonal` (`tiling/penrose.cpp`). It is the documented
fallback: a clean 12-fold *substitution* stayed elusive, so dualization is the
engine that shipped. A six-direction de Bruijn multigrid is enumerated
intersection by intersection, bypassing the substitution machinery entirely —
`generations` selects the grid line-index range rather than a deflation depth.
Rhombi are 4-vertex `Tile`s with `type` 0/1/2 for the 30°/60°/90° shapes.
Three seeds set the grid offsets: `Rosette` (constant ½ — non-singular and
exactly 12-fold symmetric) and the quasiperiodic `Drift` and `Quasi`; the
hexagrid stays non-singular only while `γ₀−γ₂+γ₄` and `γ₁−γ₃+γ₅` are
non-integers. The ripple shader's 12-fold wave-sum branch (12 plane waves at
30° steps) is shared with the other dodecagonal systems.

### References
N. G. de Bruijn; P. Stampfli; Hans-Ude Nissen; quadibloc `dode02.htm`.

---

## Ship tiling

**Summary.** A 12-fold tiling built from a single decorated dodecagon (a
dodecagon containing two rhombs), with triangle and square connectors.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 12-fold |
| Symmetry type    | statistical |
| Aperiodic        | yes (presented among the quasicrystal tilings; no proof on the page) |
| Prototiles       | squares, equilateral triangles, thin rhombs; structurally, one decorated dodecagon |
| Construction     | direct positional assembly (no inflation rule given) |
| Inflation factor | n/a |
| Attribution      | "ship tiling" (named in the source) |

### Prototiles
At tile level: squares, equilateral triangles, and a few thin rhombs. At the
structural level the whole tiling is built from **one kind of decorated
dodecagon** — a dodecagon containing two rhombs (a "rosette" dodecagon) — used
in various orientations.

### Construction
No inflation rule. Structural assembly: the characteristic rosette has its
circular part formed by a ring of **six** rosette-dodecagons; gaps between
dodecagons are filled by either a single triangle or by a square surrounded
by four triangles.

### Matching rules
Positional — dodecagons placed in orientations and joined by the
triangle / square-plus-four-triangles connectors. No edge arrows or colours.

### Symmetry & aperiodicity
Grouped with the quasicrystallographic dodecagonal tilings; the source gives
no explicit aperiodicity proof.

### Variants & relations
The six-dodecagon ring is the characteristic forced cluster. Shares its
square / triangle / thin-rhomb tile vocabulary with the Stampfli and de
Bruijn tilings.

### History & decoration
Named the "ship tiling"; called an important dodecagonal tiling.

### Renderer mapping
Not implemented. Without an inflation rule it is not a natural fit for the
substitution engine; it would have to be generated by the dodecagon-placement
assembly rule. Lower priority than Stampfli / Socolar.

### References
quadibloc `dode02.htm`.

---

## Keplerian dodecagonal tiling

**Summary.** A 12-fold substitution tiling built by recurrence on a
dodecagon, with thin rhomb / triangle / square fill. Savard develops three
progressively-modified versions; the most reduced collapses to a
square-triangle (Stampfli-type) tiling.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 12-fold |
| Symmetry type    | single-centre (perfect 12-fold when seeded from a dodecagon) |
| Aperiodic        | yes (substitution tiling) |
| Prototiles       | dodecagon (neutral + 2 oriented), 30° rhomb, equilateral triangle, square |
| Construction     | substitution, with overlap-priority orientation rules |
| Inflation factor | dodecagonal (vertices inflate to dodecagons) |
| Attribution      | Keplerian recurrence; developed by John Savard |

### Prototiles
- **Dodecagon** — three variants: a **neutral** dodecagon with full 12-fold
  symmetry, and two **oriented** dodecagons (the two orientations of a 6-fold
  expansion). A neutral dodecagon decomposes into twelve triangles + twelve
  rhombs; an oriented dodecagon decomposes into squares and triangles (six
  triangles ringed by alternating squares and triangles).
- **30° rhomb** — the dodecagonal thin rhomb. Carries an orientation, always
  unambiguously indicated.
- **Equilateral triangle** and **square** — the fill tiles.

### Construction
One generation: **vertices become dodecagons**, except where vertices are too
close together — which happens at the obtuse angles of the rhombs. Where
uncoloured (unfilled) dodecagons overlap, a dodecagon fills the space *except*
where a rhomb's obtuse angle forces the area to break into other tiles. Some
dodecagons are deliberately broken into smaller shapes purely so the
recurrence **fully preserves the symmetry of each parent shape**.
- Because the rhomb recurrence forces rhombs to occur with obtuse angles
  touching, a **special rule for three adjacent rhombs** is required (the
  two-rhomb case is derivable from the single-rhomb pattern; the three-rhomb
  case is not, and is handled directly). The triangles that fit the gaps
  between such rhombs are included in that recurrence.

### Matching rules
**Overlap-priority rules** resolve which dodecagon orientation fills a space
where unfilled dodecagons from neighbouring pieces overlap:
1. An orientation indicated by the **edge of a dodecagon takes precedence**.
2. Otherwise the orientation indicated by the **majority** of overlapping
   unfilled dodecagons is used.
3. With no indication — no oriented dodecagon present, or a tie — the
   **neutral** dodecagon (full 12-fold symmetry) is used.
Rhombs also carry orientation, but it is always unambiguous.

### Symmetry & aperiodicity
A substitution tiling with overall 12-fold symmetry; **perfect 12-fold about
one centre** when the recurrence is seeded from a dodecagon. A square-triangle
reduction (below) achieves 12-fold only in the statistical sense — a
square-triangle tiling cannot make a finite shape of more than 6-fold
symmetry, but any finite patch occurs in both 90°-rotated orientations, which
is a valid aperiodic 12-fold symmetry.

### Variants & relations
- **First modified tiling** — places dodecagons wherever symmetry permits,
  *reducing* (not eliminating) the broken-up dodecagons. Needs the
  oriented-dodecagon overlap-priority rules above.
- **Second modified tiling** — eliminates the rhomb entirely; the dodecagon
  expansion then has only 6-fold (hexagonal) symmetry, and alternating the two
  oriented expansions recovers 12-fold. This yields a **square-triangle
  tiling** — eliminating the neutral dodecagon also eliminates the rhomb.
  Filling oriented dodecagons with the two orientations of the square-triangle
  decoration *at random* gives the **random Stampfli tiling**.
- **Sixfold-from-recurrence reduction** — treat all neutral dodecagons as
  oriented dodecagons inheriting the orientation of their most recent
  dodecagonal parent, seeded from a dodecagon; replacing oriented dodecagons
  by the square-triangle dodecagon then yields a pure square-triangle tiling.
  This needs one rule change: the recurrence from one dodecagon orientation
  must include *both* orientations of the child dodecagon.
- **Topkapi-scroll decoration** — to keep the 12-fold-ness *visually obvious*,
  keep the rhomb (so build on the **first** modified tiling, not the second),
  and map the square / triangle / rhomb onto Topkapi-scroll girih motifs. A
  neutral-dodecagon recurrence rule whose border-dodecagon orientations are
  given *lowest* priority surrenders reflection symmetry along the twelve axes
  but keeps 12-fold rotational symmetry. A further reduction: when an expanded
  rhomb's obtuse-corner dodecagon would become neutral, use the unmodified
  rhomb recurrence instead (it has fewer rhombs).

### History & decoration
"Keplerian" self-similar recurrence applied to 12-fold symmetry, by analogy
with Savard's octagonal construction. The square-triangle endpoint is the
tiling exhibited in Baake, Grimm & Moody, *What is Aperiodic Order?*. The
decorative target is the square / triangle motif of the Topkapi scroll, which
brings in pentagonal stars and near-octagonal regions.

### Renderer mapping
Not implemented — the primary *substitution*-based candidate for a future
`Family` (the fourth implemented family is the de Bruijn rhomb-square
dodecagonal tiling above). Mapping:
- Prototiles: dodecagon (neutral + 2 oriented), 30° rhomb, equilateral
  triangle, square — a 5-symbol-ish set with a per-dodecagon orientation enum
  {neutral, oriented-A, oriented-B} and a per-rhomb orientation bit.
- Substitution: vertex-to-dodecagon inflation with the three-rhomb special
  case; the overlap-priority rule needs a resolution pass after each
  generation (edge-rule → majority → neutral).
- For a first implementation, prefer the **second modified / square-triangle**
  reduction — only squares and equilateral triangles to mesh, no rhomb, no
  neutral-dodecagon decomposition — accepting statistical (not single-centre)
  12-fold symmetry. The first-modified tiling, which keeps the rhomb for
  visual clarity, is the richer follow-up.
- Ripple shader: the 12-fold wave-sum branch (12 plane waves at 30° steps,
  alongside the 5-fold P3/P2 and 4-fold Chair branches) already exists — the
  de Bruijn dodecagonal family added it — and would be reused as-is.

### References
Johannes Kepler (recurrence technique); Baake, Grimm & Moody, *What is
Aperiodic Order?*; the Topkapi scroll; quadibloc Keplerian-dodecagonal page.
