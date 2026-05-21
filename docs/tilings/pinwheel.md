# Pinwheel tiling — substitution with infinitely many orientations

The Conway–Radin pinwheel: a single right triangle whose substitution drives
its tiles into infinitely many orientations, so the tiling has no rotational
symmetry of any finite order. It is implemented as one of the renderer's
`Family` entries.

---

## Conway–Radin pinwheel

**Summary.** A single 1:2:√5 right triangle that substitutes into five copies
of itself at 1/√5 scale; because the substitution turns by an irrational
angle, tiles appear in infinitely many orientations — the first aperiodic
prototile set proven to need rotations, not just translations, to describe
its tilings.

| Property         | Value |
|------------------|-------|
| Symmetry order   | none — tiles occur in infinitely many orientations |
| Symmetry type    | statistical |
| Aperiodic        | yes |
| Prototiles       | 1 — a 1:2:√5 right triangle (both chiralities used) |
| Construction     | substitution |
| Inflation factor | √5 |
| Attribution      | J. H. Conway (tessellation); Charles Radin (forced tiling) |

### Prototiles
One right triangle with legs 1 and 2 and hypotenuse √5. Placed with vertices
(0,0), (2,0), (2,1), the right angle (90°) sits at (2,0), the small angle
**S** = arctan(1/2) ≈ 26.565° at (0,0), and the medium angle **M** =
arctan(2) ≈ 63.435° at (2,1). The three interior angles are all distinct, so
the three vertices and three edges are each labelled S, M or L by size — the
vertex label is the size of its angle, with S < M < L = 90°. Both the
triangle and its mirror image occur; the substitution alphabet is these two
chiralities.

### Construction
One deflation replaces a triangle by **five** triangles, each similar to it at
scale 1/√5. Take the prototile as the level-0 triangle. Its level-1 expansion
is the √5-times-larger triangle with vertices (−2,1), (2,−1), (3,1) — sides
√5 : 2√5 : 5 — partitioned into five level-0-sized children:

| Child | Vertices (S, L, M corners) |
|-------|----------------------------|
| A | (−2,1), (0,1), (0,0) |
| B | (2,1), (0,1), (0,0) |
| C | (0,0), (2,0), (2,1) |
| D | (0,0), (2,0), (2,−1) |
| E | (2,−1), (2,1), (3,1) |

Child C reproduces the unscaled prototile; A and B are mirror images of the
other three. The five children partition the parent with no gap and no
overlap — five tiles of area 1 fill the parent of area 5. Counting the two
chiralities, the substitution matrix is

    M = [ 2  3 ]
        [ 3  2 ]

— each triangle expands into 2 copies of its own chirality and 3 of the
mirror — with leading eigenvalue 5, so the linear inflation factor is √5.

The substitution carries the small angle S through a turn of arctan(1/2). By
Niven's theorem arctan(1/2) is an irrational multiple of π, so iterating the
substitution never returns a tile to a previous orientation.

### Matching rules
The pinwheel is built by the substitution above and carries no edge arrows.
Radin (1994) separately constructs a finite set of **marked** prototiles whose
local matching rules force exactly the tilings with the hierarchical
substitution structure — this is what proves the bare triangle a genuine
aperiodic set. The marks are three vertex marks μ_S, μ_M, μ_L (one per
vertex, named for its angle); each records, for every triangle edge meeting
that vertex, the size and type of the highest-level triangle that edge
completes, together with sign variables that propagate the nesting. The
encoding is intricate and occupies most of Radin's paper. Unlike the kite and
dart — whose equivalent finite-type alphabet is recoverable from patches of a
fixed size — the pinwheel admits no such fixed-radius rule (Radin 1996); the
rotations make the marking genuinely more complex.

### Symmetry & aperiodicity
Aperiodic — no periodic tiling is possible. Uniquely among the classical
aperiodic sets the pinwheel's tiles occur in **infinitely many orientations**:
the tiling has no rotational symmetry of any finite order, and analysing it
requires the full Euclidean group, not just the translation subgroup.

The orientations are uniformly distributed around the circle — shown by
applying Weyl's criterion to a family of matrices M(m) assembled from the
substitution's rotations (Radin 1995, *Space tilings and substitutions*). The
*count* of distinct orientations nonetheless grows only slowly: among the 5ᵏ
tiles of a level-k supertile the number of distinct orientations is below k⁶
— logarithmic in the tile count — because rotations in the plane commute. (The
substitution harness sees 13 distinct hypotenuse directions in a level-6
patch of 15625 tiles, the count rising at every generation.)

Because every finite patch still recurs, in every orientation, infinitely
often, the tiling is statistically isotropic. The substitution tiling space
is uniquely ergodic — every pinwheel tiling has identical patch frequencies;
and unlike the Penrose tiling space (which decomposes into a circle's worth
of components, one per orientation class spaced 2π/10 apart) the pinwheel
space is itself a single such component. This supports a genuinely new kind
of symmetry, **statistical rotational symmetry** (Radin 1995, *Symmetry and
tilings*): the frequency
density of any patch, measured over intervals of orientation, is
rotation-invariant — and that is a property of one individual tiling, not of
an ensemble. Every pinwheel tiling also has the **local isomorphism
property** — each patch recurs within a bounded distance d(P) that is
independent of which tiling is examined. Radin & Wolff (1992) proved this
property is universal in two senses: any prototile set that tiles space
admits a tiling that has it, and for a uniquely ergodic system it holds for
all but a measure-zero set of tilings (with d(P) then independent of the
tiling). The diffraction spectrum is circularly symmetric.

### Variants & relations
- **Sadun's generalised pinwheels** (Sadun 1998) replace the 1:2 right
  triangle with other right triangles. A right triangle with integer legs p
  and q decomposes into p² + q² similar copies; the standard pinwheel is the
  p,q = 1,2 case (1 + 4 = 5). When the acute angle arctan(p/q) is an
  irrational multiple of π the tiling again has infinitely many orientations;
  when it is rational the construction yields a substitution tiling of any
  prescribed finite rotational order. Sadun also admits variants using copies
  of the triangle at more than one size.
- **Pinwheel fractal.** Iterating the Conway five-copy division of the
  triangle T but *discarding the middle triangle* at every step leaves a
  fractal — the "pinwheel fractal" — of Hausdorff dimension
  d = ln4 / ln√5 = log₅16 ≈ 1.7227.
- **Quaquaversal tiling** (Conway & Radin 1998) is the three-dimensional
  analogue: a single prism inflates into eight copies, the inflation
  including rotations by 2π/4 and 2π/3 about perpendicular axes. There the
  multiplicity of orientations comes from the *non-commutativity* of those
  rotations rather than from an irrational angle, and the orientation count
  grows algebraically rather than logarithmically; the relevant rotation
  group is the free product C₃ ∗ C₃.
- **Isoperimetric "roundness"** (Radin & Sadun 1996): travelling only along
  pinwheel triangle edges, two points a Euclidean distance N apart are joined
  by a path of length N + o(N) — the discrete isoperimetric problem has,
  asymptotically, a circle for its solution. This makes the pinwheel vertex
  set an attractive grid for planar numerical models in which rotational
  symmetry matters.

### History & decoration
Conway's substitution tessellation arose from a specific question. In late
1990 Radin sought an aperiodic prototile set whose tilings use infinitely
many orientations and knew of none; Filippo Cesi supplied a first example —
a four-letter square-and-rectangle substitution that must be started from its
largest tile. In spring 1991 John Conway, visiting Austin, produced the
pinwheel substitution within hours. Finding matching rules that force it took
Radin roughly two further years (Radin 1994). The tiling is named for the
pinwheel toy whose blades turn about a stick, and is the standard textbook
example of a tiling with a circularly symmetric diffraction pattern.

Federation Square in Melbourne uses the pinwheel tiling across its
sandstone, zinc and glass façades: a triangular tile groups into 5-tile
panels, which in turn group into mega-panels. The Atrium there uses a
"3-dimensionalised" pinwheel grid as a portal frame.

### Renderer mapping
Implemented — `Family::Pinwheel` (`subdividePinwheel` / `seedPinwheel` in
`tiling/penrose.cpp`). Each tile is a triangle stored as its [S, L, M]
corners; `subdividePinwheel` applies the five-child rule above through the
unique affine map carrying the canonical parent (−2,1), (2,−1), (3,1) onto
the stored triangle, so reflected tiles need no special handling. `type`
records chirality (0/1) and feeds the two-bucket Type colouring;
`waveSymmetry` is 0, selecting the shader's isotropic radial ripple — the
pinwheel has no preferred axis, so the directional plane-wave sums used by
the 5/8/12/14-fold families do not apply. Seeds: `Square` (four triangles),
`Triangle` (one), `Rectangle` (a 2:1 pair). Generation is capped at 6 (growth
is 5× per step). The substitution harness confirms exact 5ᵏ tile counts,
conserved total area, every child a 1:2:√5 triangle, no overlap, every edge
shared by at most two tiles, and an orientation count that strictly grows
with each generation.

### References
- C. Radin, "The pinwheel tilings of the plane," *Annals of Mathematics* (2)
  **139** (1994) 661–702.
- C. Radin & M. Wolff, "Space tilings and local isomorphism," *Geometriae
  Dedicata* **42** (1992) 355–360.
- C. Radin, "Aperiodic tilings, ergodic theory, and rotations," in *The
  Mathematics of Long-Range Aperiodic Order* (R. V. Moody, ed.), Kluwer
  (1997) 499–519.
- C. Radin, "Space tilings and substitutions," *Geometriae Dedicata* **55**
  (1995) 257–264.
- C. Radin, "Symmetry and tilings," *Notices of the AMS* **42** (1995) 26–31.
- C. Radin, "Miles of tiles," in *Ergodic Theory of Zᵈ-actions*, London Math.
  Soc. Lecture Note Series **228**, Cambridge University Press (1996)
  237–258.
- C. Radin & L. Sadun, "The isoperimetric problem for pinwheel tilings,"
  *Communications in Mathematical Physics* **177** (1996) 255–263.
- L. Sadun, "Some generalizations of the pinwheel tiling," *Discrete &
  Computational Geometry* **20** (1998) 79–110.
- J. H. Conway & C. Radin, "Quaquaversal tilings and rotations," *Inventiones
  Mathematicae* **132** (1998) 179–188.
- J. H. Conway — the underlying substitution tessellation (unpublished).
