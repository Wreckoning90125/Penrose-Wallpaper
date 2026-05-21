# Pentagonal tilings — the Penrose family

The three Penrose tilings (P1, P2, P3), the two structures that overlay them
(Ammann bars, decapods), and the Gummelt single-decagon covering equivalent
to P3. All have 5-fold character and golden-ratio geometry; all are genuinely
aperiodic. P2 and P3 are the renderer's two implemented pentagonal families.

Source: `quadibloc.com/math/penrose.htm` and linked pages; the Gummelt
covering is from the primary literature (Savard's series has no page on it).

---

## Penrose P1 — original six-tile tiling

**Summary.** Roger Penrose's first aperiodic set: six prototiles resembling
pentagons, stars, boats, and a diamond. Historically first; superseded for
practical use by P2 and P3, but the closest of the three to the Keplerian
pentagon/star/boat tilings.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 5-fold |
| Symmetry type    | statistical (single-centre for the Sun/Star seedings) |
| Aperiodic        | yes |
| Prototiles       | 6 — pentagon (×3 colour-roles), five-point star, boat, diamond (thin rhomb) |
| Construction     | substitution + matching-rule |
| Inflation factor | φ² ≈ 2.618 per generation |
| Attribution      | Roger Penrose |

### Prototiles
Six tiles, all of unit edge length and all interior angles a multiple of 36°:
- three regular **pentagons**, geometrically identical and distinguished only
  by matching context — P-5, P-3 and P-2 have respectively 5, 3 and 2 of their
  five edges adjoining other pentagons;
- a **star** — the pentacle, i.e. the {5/2} star polygon (10 edges, alternating
  36° points and 252° reflex vertices);
- a **boat** — a half-pentacle, roughly three-fifths of a star (three of its
  five points);
- a **diamond** — the thin 36°/144° golden rhomb.

### Construction
P1 is a decoration of the P3 rhomb tiling; its linear inflation factor is φ².
A reproducible construction:

1. Generate P3 — the two golden Robinson triangles, **acute** (36°-72°-72°)
   and **obtuse** (108°-36°-36°), under their φ-inflation substitution
   (`subdivideP3`). Take the short side of each triangle as length 1.
2. In every **obtuse** triangle place three regular pentagons of circumradius
   φ⁻² ≈ 0.382: one centred on a 36° corner; one centred on the long side
   (length φ) at fraction φ⁻² of its length from that corner; one centred on a
   short side at fraction φ⁻¹ of its length from the other 36° corner. Each
   pentagon is oriented edge-parallel to the triangle side it sits against, so
   the decorations of two obtuse triangles sharing an edge place coincident
   pentagons.
3. Identify the coincident pentagons. The pentagons then cover the plane
   except for three residual gap shapes — pentacle (star), half-pentacle
   (boat) and thin 36° rhomb (diamond) — which are the other three prototiles.

Equivalently P1 has a direct six-prototile composition: each prototile equals a
patch of smaller P1 tiles scaled up by φ² (Grünbaum & Shephard §10.3).

### Matching rules
Each edge carries one of three projection/indentation profiles (labelled
0, 1, 2); an edge may meet only its own profile. For the three pentagons this
is exactly the P-5/P-3/P-2 context distinction. Geometric fit alone admits
periodic tilings — the edge profiles are what force aperiodicity.

### Symmetry & aperiodicity
Aperiodic — Penrose's first aperiodic set. Forced by the edge-shape matching
rules. As with all Penrose tilings, any finite patch recurs infinitely, so
the infinite tiling is statistically 5-fold; exact rotational symmetry exists
only for special seedings.

### Variants & relations
The most Keplerian-looking of the three Penrose tilings. Relates to P2 by the
exact pentagon/star/boat decomposition; relates to P3 via a separate
correspondence diagram. A large drawn P1 patch is a detail near the centre of
the tiling dual to the infinite "Sun" P2 tiling.

### History & decoration
The six tiles literally resemble Kepler's pentagon, star, and boat. P1 is the
historical bridge between Kepler's decorative pentagon tilings and the
mathematically sharp P2/P3.

### Renderer mapping
Implemented — `Family::P1` (`generateP1` in `tiling/penrose.cpp`), exactly the
Construction recipe above. The P3 substitution is run as a transform recursion
so every obtuse triangle carries an exact frame; its three pentagons are
emitted, coincident pentagons are deduplicated, and the star / boat / diamond
gaps are recovered as the closed loops of un-shared pentagon edges — a 10-edge
loop is a star, a 4-edge loop a diamond, any other a boat. Tiles store `type`
0 = pentagon, 1 = star, 2 = boat, 3 = diamond, with `vcount` up to 10; the
concave star and boat are triangulated from the centroid (`centroidFan`).
`waveSymmetry` 5 is shared with P2/P3. The substitution harness checks the
result is gap-free and overlap-free with every edge shared by at most two
tiles.

### References
Roger Penrose, *Bull. Inst. Math. Appl.* **10** (1974) 266 (the original
six-tile set); Grünbaum & Shephard, *Tilings and Patterns* (1987) §10.3
(the six-prototile composition); quadibloc `penrose.htm`.

---

## Penrose P2 — kite and dart

**Summary.** Two-tile aperiodic set; the renderer's pentagonal family
`Family::P2`. Conway's vertex-type and cartwheel analysis lives here.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 5-fold |
| Symmetry type    | statistical (single-centre for the Sun and Star infinite tilings) |
| Aperiodic        | yes |
| Prototiles       | 2 — kite, dart |
| Construction     | substitution + matching-rule |
| Inflation factor | φ |
| Attribution      | Roger Penrose; vertex names by J. H. Conway |

### Prototiles
Kite and dart — both quadrilaterals cut from a 72°/108° rhombus using the
golden geometry of the pentagon. Each carries colour markings (the matching
rule). Kite : dart area ratio → φ; the count ratio in the infinite tiling
also tends to φ.

### Construction
A substitution (inflation) relation exists. In it, **each dart is split in
half** — every dart is bisected by the recurrence — which makes the rule
visually confusing but well-defined. A recurrence also exists for the P3
rhomb pair, so P2 and P3 are related at multiple relative scales.

### Matching rules
Coloured edge markings must match across shared edges. Exactly **seven legal
vertex configurations**, named by Conway: Sun, Star, Ace, Deuce, Jack, Queen,
King. (Note: some published vertex-type diagrams draw the King vertex
illegally — verify against Conway.)

### Symmetry & aperiodicity
Aperiodic. Any finite patch recurs infinitely often in every kite-and-dart
tiling — "from the finite point of view there is only one Penrose tiling" —
yet there are uncountably many distinct infinite P2 tilings. The Sun and Star
infinite tilings have exact 5-fold symmetry about their single centre.
Crucially, the patch-reappearance distance is bounded by a low multiple of
the patch size (unlike Keplerian tilings — see `pentagonal-keplerian.md`).

### Variants & relations
Relates to P1 by the pentagon/star/boat decomposition; relates to P3 — but
**not** by the naive isomorphism the shared pentagon/star background
suggests; the true correspondence appears at a different relative scale
(proven by the differing Ammann-bar spacing, below). The cartwheel (next) and
decapods (below) are P2 structures.

### History & decoration
Conway named the cartwheel and the seven vertex types. Popularised by Martin
Gardner, *Scientific American*, January 1977. The kite and dart can
themselves be built from pentagons, stars, and decagons.

### Renderer mapping
Implemented — `Family::P2` in `android/app/src/main/cpp/tiling/penrose.cpp`.
The renderer drives it by generation count; the ripple shader treats P2 as
5-fold (same branch as P3).

### References
Roger Penrose; J. H. Conway (cartwheel, vertex names, decapods); Martin
Gardner, *Scientific American*, Jan 1977; quadibloc `penrose.htm`.

---

## Penrose P3 — rhombus tiling

**Summary.** Two golden rhombs; the renderer's default pentagonal family
`Family::P3`. The simplest Penrose prototile set.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 5-fold |
| Symmetry type    | statistical |
| Aperiodic        | yes |
| Prototiles       | 2 — thick (fat) rhomb, thin (narrow) rhomb |
| Construction     | substitution + matching-rule |
| Inflation factor | φ |
| Attribution      | Roger Penrose |

### Prototiles
Two golden rhombs, equal edge length: **thick** 72°/108°, **thin** 36°/144°.

### Construction
A substitution relation exists for the rhomb pair, relating P3 to P2 at
several relative scales. Each rhomb inflates into a cluster of thick and thin
rhombs scaled by φ.

P3 is equivalently the **de Bruijn dualization** of a *pentagrid* — five
superimposed grids of equally spaced parallel lines, the grid normals 72°
apart, each grid k carrying a real shift γₖ (k = 0..4). Every grid
intersection dualizes to a rhomb whose edges are orthogonal to the two
crossing lines; a 36° crossing yields a thin rhomb, a 72° crossing a thick
one. de Bruijn (1981) proved the dual obeys the Penrose matching rules
exactly when Σγₖ is an integer.

### Matching rules
Edge rules (conventionally arrows, two arrow types) force aperiodicity.
**Eight** distinct legal vertex types occur (versus seven for P2). In the
closed-form frequency table the thick-rhomb / Ace-equivalent vertex has
frequency φ⁶.

### Symmetry & aperiodicity
Aperiodic; statistical 5-fold. Background pentagons/stars/boats drawn on P3
diagrams *are* arranged with Penrose symmetry — a corresponding Penrose
tiling could be derived from them — but, unlike P2, those background shapes
are not themselves organised by the underlying tiling.

### Variants & relations
Related to P2 and P1. The P2↔P3 relation is **not** the naive one: Ammann-bar
spacing differs between P2 and P3 even when pentagons/stars are drawn at the
same scale, proving the real isomorphism sits at a different relative scale.

Equal-shift pentagrids (all γₖ equal) give the exactly-symmetric Penrose
tilings. **SUN** (Σγ = 1) and **STAR** (Σγ = 2) are the only two with a centre
of full tenfold symmetry; **CARTWHEEL** (all shifts 0) has a lower-symmetry
centre — ten triangular sectors bordered by Conway worms, enclosing an
alternating SUN/STAR sequence of central regions whose radii grow by φ. These
three correspond to the renderer's `SeedP3` Sun, Star and Cartwheel seeds.
Equal-shift pentagrids whose Σγ is non-integer give the *generalized* Penrose
tilings — fivefold, but not governed by the Penrose matching rules.

### History & decoration
The decorated-rhomb Islamic motif (see `pentagonal-islamic.md`) is built to
sit on a P3 rhomb arrangement, carrying girih strapwork onto an aperiodic
substrate.

### Renderer mapping
Implemented — `Family::P3`, the renderer's default family. Two-rhomb
substitution by generation count. The quasicrystal ripple shader uses a
5-wave sum for P3 (and P2).

### References
Roger Penrose; external page tabulating the eight rhomb vertex-type limit
frequencies; N. G. de Bruijn, "Algebraic theory of Penrose's non-periodic
tilings of the plane", *Nederl. Akad. Wetensch. Proc. Ser. A* **84** (*Indag.
Math.* **43**) (1981) 38–66 (the pentagrid / dualization construction);
quadibloc `penrose.htm`.

---

## Ammann bars

**Summary.** Not a tiling — a system of straight lines crossing a Penrose
tiling that exposes its hidden long-range order; an alternative formulation
of the matching rules.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 5-fold (five families of parallel lines) |
| Symmetry type    | statistical |
| Aperiodic        | yes (the gap sequence is non-periodic) |
| Prototiles       | n/a — line segments, not tiles |
| Construction     | substitution (on the gap sequence) |
| Inflation factor | φ |
| Attribution      | Robert Ammann |

### Prototiles
None. Straight segments crossing tiles align into unbroken lines spanning the
whole tiling, in five parallel families.

### Construction
Consecutive parallel bars are separated by Long or Short gaps. The gap
sequence is generated by the substitution **L → LS, S → L** applied to every
gap each generation: S; L; LS; LSL; LSLLS; LSLLSLSL; … The limiting infinite
strings are the **musical sequences**; consecutive gap lengths stand in ratio
φ.

### Matching rules
The requirement that the bars form unbroken straight lines *is itself* a
restatement of the Penrose matching rules. On P1 the bars cross pentagon
sides through their midpoints (parallel to those sides); they meet kite,
dart, and rhomb sides at right angles.

### Symmetry & aperiodicity
The non-repeating L/S musical sequence with golden-ratio gap spacing is
direct evidence of aperiodic long-range (quasiperiodic) order.

### Variants & relations
Distinct bar systems exist for P1, P2, and P3 — and the spacings differ
between P2 and P3, which is the proof that the P2↔P3 isomorphism is not the
naive one.

### History & decoration
Robert Ammann; the L/S strings are called musical sequences.

### Renderer mapping
Not a tiling — no `Family`. Useful as a *validation overlay*: rendering the
five bar families over a generated P2/P3 patch and checking the bars stay
unbroken is a cheap correctness check on the substitution output.

### References
Robert Ammann; quadibloc `penrose.htm`.

---

## Decapods

**Summary.** Not a tiling — a forced central defect in P2. Ten shallow
triangles around a point; 60 of the 62 arrangements force a single rigid
tiling out to infinity.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 10-fold (around the defect) |
| Symmetry type    | single-centre |
| Aperiodic        | n/a — a defect, not a tiling |
| Prototiles       | conceptually 10 shallow triangles |
| Construction     | direct (a forced central hole) |
| Inflation factor | n/a |
| Attribution      | J. H. Conway / Penrose literature |

### Prototiles
Ten shallow ("flat") triangles around a centre. In kite-and-dart terms the
empty decapod is a ten-pointed star hole ringed by ten rays of wide and
narrow bow-ties.

### Construction
Not a substitution tile — a decapod is a central hole from which a tiling
propagates outward.

### Matching rules
There are exactly **62** decapod arrangements. One is the legal cartwheel
centre; one more forms a cartwheel-equivalent shape; the remaining **60 are
imperfections**.

### Symmetry & aperiodicity
Each of the 60 imperfect decapods *forces a single unique infinite tiling* —
a modified cartwheel with some rays reversed. This is the opposite of a true
Penrose patch (which admits uncountably many continuations): a decapod
imperfection collapses all freedom.

### Variants & relations
62 arrangements: 1 cartwheel centre, 1 cartwheel-equivalent, 60 forcing
imperfections. Closely tied to Conway's cartwheel analysis of P2.

### History & decoration
Conway. A decapod is exactly what you get by mis-orienting the ten rays of
bow-ties around a cartwheel centre — an easy drawing mistake to make.

### Renderer mapping
Not a `Family`. Relevant as a *failure mode*: if the renderer's P2
substitution ever seeds or accumulates an illegal central cluster, the result
is a decapod-forced tiling, not a true Penrose tiling. A seed-validity check
guards against it.

### References
J. H. Conway; Martin Gardner, *Scientific American*, Jan 1977; quadibloc
`penrose.htm`.

---

## Gummelt decagon covering

**Summary.** A single marked decagon that, allowed to overlap copies of
itself under one overlap rule, forces a structure equivalent to the Penrose
P3 rhomb tiling — the first proof that *one* prototile suffices to force the
quasiperiodic plane, and a model for how quasicrystals grow from a single
repeating atomic cluster.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 10-fold (decagon prototile; resolves to 5-fold P3) |
| Symmetry type    | statistical |
| Aperiodic        | yes |
| Prototiles       | 1 — one marked (decorated) regular decagon |
| Construction     | covering — overlapping marked decagons |
| Inflation factor | φ |
| Attribution      | Petra Gummelt; Penrose-equivalence by P. J. Steinhardt & H.-C. Jeong |

### Prototiles
One regular decagon, edge length equal to the Penrose rhomb edge, carrying a
fixed decoration — Gummelt's marking, a set of shaded regions (rendered as
two colours in Egan's applet). Equivalently the decagon is inscribed with a
large Penrose **fat rhomb**, or with a **Jack** (a star of four darts, two
clockwise and two counter-clockwise, one pair overlapping). The shaded
regions *are* the overlap rule; the decagon is otherwise unmarked.

### Construction
A *covering*, not a tiling: copies of the one marked decagon are laid down so
that they may overlap. The overlap rule — two decagons may overlap only where
their shaded regions coincide (shaded-on-shaded), equivalently only over an
area at least a specified hexagonal region — admits exactly two overlap
types, a small **A-overlap** and a large **B-overlap**. An infinite
arrangement obeying the rule is a *Gummelt covering*. The covering is
self-similar: an inflation step replaces each decagon by five smaller
decagons (edge 1/φ), and iterating it generates the covering.

### Matching rules
The overlap rule is itself the matching rule, enforced by *region overlap*
rather than edge arrows. Gummelt showed exactly **nine** local "surrounding"
configurations of a decagon occur in a valid covering (Jeong's type-1 … type-9
decagons); these map onto the **eleven** Penrose-arrow-legal ways of
surrounding a fat rhomb, which completes the equivalence with the P3 matching
rules. Steinhardt & Jeong further showed the rule can be *discarded
altogether*: maximising the density of a chosen tile cluster (their cluster
**C** — 9 fat + 4 thin rhombi, density 1/(3φ+1)) yields the Penrose tiling,
since P3 uniquely maximises that density.

### Symmetry & aperiodicity
A Gummelt covering is structurally equivalent to a Penrose P3 tiling:
inscribe each decagon with its fat rhomb / Jack and the covering resolves
into P3, the thin rhombs automatically filling the gaps. It is therefore
aperiodic and statistically 10-fold symmetric in exactly the sense P3 is.
Gummelt's theorem — the marked decagon plus overlap rule admits only
quasiperiodic coverings — is the first proof that a *single* prototile can
force quasiperiodicity.

### Variants & relations
- Direct equivalence with **P3** (above); by a change of inscribed marking,
  with **P2**.
- **Quasi-unit-cell (QUC)** reading: the decagon is an overlapping unit cell —
  like a crystal unit cell, but neighbours overlap and share material. Jeong
  (2003) proved every decagonal-QUC model equals a rhombus-Penrose-tile model
  with fourfold-deflated super-tiles.
- Relaxing the overlap rule yields **random tilings** (Gummelt & Bandt).
- 3-D generalisation: decagonal prisms / overlapping polytopes, used to model
  real decagonal quasicrystals such as Al–Ni–Co.

### History & decoration
Petra Gummelt (1996, *Geometriae Dedicata*) introduced the overlapping-decagon
covering with an elaborate proof. Steinhardt & Jeong (1996, *Nature*) gave a
simpler Penrose-equivalence proof and the density-maximisation principle,
arguing it explains *why* quasicrystals form: if the decagon represents an
energetically preferred atomic cluster, free-energy minimisation maximises
its density and so forces quasiperiodicity. The quasi-unit-cell picture was
later tested experimentally against Al–Ni–Co decagonal quasicrystals.

### Renderer mapping
Not implemented, and not a natural `Family`: a covering is not a tiling — the
decagons overlap — so it does not fit the renderer's disjoint-tile-list
model. Because the covering resolves exactly to P3, the cheapest faithful
realisation is a **decoration mode on `Family::P3`** — generate the P3 tiling
as now, then overlay one decagon per fat rhomb — rather than a new generator.

### References
- P. Gummelt, "Penrose tilings as coverings of congruent decagons,"
  *Geometriae Dedicata* 62 (1996) 1–17.
- P. J. Steinhardt & H.-C. Jeong, "A simpler approach to Penrose tiling with
  implications for quasicrystal formation," *Nature* 382 (1996) 431–433.
- H.-C. Jeong & P. J. Steinhardt, "Constructing Penrose-like tilings from a
  single prototile…," *Phys. Rev. B* 55 (1997) 3520–3532.
- H.-C. Jeong, "Inflation rule for Gummelt coverings with decorated
  decagons…," arXiv:cond-mat/0304690 (2003).
- E. A. Lord & S. Ranganathan, "The Gummelt decagon as a 'quasi-unit cell',"
  *Acta Cryst. A* 57 (2001) 531–539.
- G. Egan, "Gummelt" applet, `gregegan.net/APPLETS/06/06.html`.
