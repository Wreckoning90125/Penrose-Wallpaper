# Pentagonal tilings — the Penrose family

The three Penrose tilings (P1, P2, P3) plus the two structures that overlay
them (Ammann bars, decapods). All have 5-fold character and golden-ratio
geometry; all are genuinely aperiodic. P2 and P3 are the renderer's two
implemented pentagonal families.

Source: `quadibloc.com/math/penrose.htm` and linked pages.

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
| Inflation factor | golden-ratio family (φ per generation) |
| Attribution      | Roger Penrose |

### Prototiles
Six tiles, expressible as decorated pentagon / star / boat / diamond shapes.
The substitution bookkeeping labels them A = blue-green pentagon, B = yellow
pentagon, C = green pentagon, D = boat, E = star, F = diamond. The drawn
tiles carry interior pentagons/stars/boats positioned only to shape the
outline (per Kepler-tiling rules, **not** Penrose rules); the operative
constraint is the edge decoration.

### Construction
One generation of the substitution (parent → child counts):

| Parent | Children |
|--------|----------|
| A | 1A, 5B |
| B | 1A, 3B, 2C, 3F |
| C | 1A, 1B, 4C, 2F |
| D | 3C, 3D, 1E |
| E | 5C, 5D, 1E |
| F | 1C, 1D, 1F |

Two recurrence schemes exist. The **first-order** rule is *not* a true
recurrence — it leaves the diamond (F) orientation unspecified. The
**second-order** rule fully determines diamond orientation and is the one to
use. Iterating from a single A pentagon, generation tile-counts grow
A: 1, 1, 6, 36, 231, 1586, … with limiting tile-frequency ratios numerically
A:B:C:D:E:F = 1 : 2.17288 : 3.94273 : 1.115611 : 0.5134249 : 2.024296.

### Matching rules
Edge-shape-derived rules, shown as colours on the elementary shapes. Even the
largest legal clusters cannot be assembled by geometric fit alone — the
colour/edge rules must be obeyed. These rules force aperiodicity.

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
Not implemented and not recommended as a `Family`. Six prototiles with
colour-coded edge rules is far more state than the renderer's substitution
engine carries for P2/P3. If ever wanted, model it as a 6-symbol substitution
matrix (table above) with a per-tile orientation field; the second-order rule
is mandatory or diamonds float.

### References
Roger Penrose (original set); external archive of Penrose's original six
tiles; quadibloc `penrose.htm`.

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
frequencies; quadibloc `penrose.htm`.

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
