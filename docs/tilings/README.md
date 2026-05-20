# Tiling documentation

This directory is the **single, authoritative area** for all documentation on
Penrose and quasicrystallographic (aperiodic / substitution) tilings in this
repository. Nothing about tiling theory, prototiles, substitution rules, or
matching rules belongs anywhere else — not in source comments beyond a
one-line pointer, not in the app README, not in scattered notes.

If you are adding tiling documentation, it goes here and it follows the
template below. There are no exceptions.

## Scope

Everything covered here is an *aperiodic*, *substitution*, or otherwise
*non-trivially structured* planar tiling — the family the renderer's tiling
engine draws from. Conventional periodic tilings appear only in
[`periodic-reference.md`](periodic-reference.md), and only as a contrast
baseline.

## The one-area rule

1. All tiling docs live in `docs/tilings/`.
2. One file per **symmetry family** (5-fold, 7-fold, 8-fold, 12-fold,
   periodic). A family file may document several distinct *systems*.
3. Within a file, **every distinct tiling system is one `##` section** that
   follows the Document Template below — verbatim, every section present, in
   order. A system with nothing to say under a heading writes `None.` or
   `n/a` rather than dropping the heading.
4. A new symmetry family means a new file, registered in the Index below.

## Document template

Every system section is structured exactly like this. The property table
comes first; then the eight `###` subsections, in this order, no additions,
no reordering.

```markdown
## <System name>

**Summary.** One or two sentences: what it is and why it matters.

| Property        | Value |
|-----------------|-------|
| Symmetry order  | <n>-fold (or "periodic") |
| Symmetry type   | exact-global / single-centre / statistical / periodic / none |
| Aperiodic       | yes / no / not-forced |
| Prototiles      | <count> — <names> |
| Construction    | substitution / matching-rule / dualization / cut-and-project / direct |
| Inflation factor| <value> or n/a |
| Attribution     | <people / sources> |

### Prototiles
Each shape: name, interior angles, edge-length ratios, decorations.

### Construction
The substitution / recurrence / dualization rule, prototile by prototile.

### Matching rules
Edge arrows, colours, vertex configurations, orientation/priority logic.
`None.` if the system is not matching-rule based.

### Symmetry & aperiodicity
What symmetry the infinite tiling has, and the argument for (a)periodicity.

### Variants & relations
Modified versions; isomorphisms and duals with other systems.

### History & decoration
Kepler, Dürer, Conway, Gardner, Islamic girih, etc.

### Renderer mapping
How this system maps onto the app's substitution engine
(`android/app/src/main/cpp/tiling/`): the `Family` enum, whether it is
implemented, and what a `Family` entry would require.

### References
Every paper, book, and page cited. quadibloc.com/math source page where
applicable.
```

## Controlled vocabulary

These terms have a fixed meaning across all documents here. Use them exactly.

- **Symmetry type — exact-global**: every point of the infinite tiling is a
  centre of the stated rotational symmetry. Possible only for periodic
  tilings of order ≤ 6.
- **Symmetry type — single-centre**: the infinite tiling has exact rotational
  symmetry about *one* distinguished point and no other.
- **Symmetry type — statistical**: no exact rotational centre, but every
  finite patch recurs (in every orientation) infinitely often, so no finite
  observation can fix an orientation. This is *local indistinguishability*
  and is the only n-fold symmetry available to aperiodic tilings for n ∉
  {1,2,3,4,6}. Also called "limited-range" symmetry in the source material.
- **Aperiodic — yes**: the prototile set admits *no* periodic tiling.
- **Aperiodic — not-forced**: the prototiles *can* tile aperiodically, but the
  matching rules as stated also permit a periodic tiling (e.g. the binary
  tiling). A real distinction — flag it.
- **Construction — substitution**: tiles inflate into clusters of (scaled)
  tiles; also called a recurrence or inflation rule. The **inflation factor**
  is the linear scale ratio between a parent tile and its children.
- **Construction — dualization**: the grid / multigrid method of de Bruijn —
  superimpose periodic line/tile grids and take the dual.
- **Construction — cut-and-project**: slice a higher-dimensional periodic
  lattice through an irrational hyperplane (the "acceptance domain").
- φ denotes the golden ratio (1 + √5) / 2.

## Index

| File | Symmetry | Systems documented |
|------|----------|--------------------|
| [`pentagonal-penrose.md`](pentagonal-penrose.md) | 5-fold | Penrose P1 (six-tile), P2 (kite & dart), P3 (rhomb); Ammann bars; decapods |
| [`pentagonal-keplerian.md`](pentagonal-keplerian.md) | 5-fold | Keplerian pentagon/star/boat tilings; boat-eliminated tiling; "pentagons and stars alone" |
| [`pentagonal-binary.md`](pentagonal-binary.md) | 5-fold | Binary tiling; Mikulla–Roth tiling; Robinson & Tübingen triangle tilings; HBS (hexagon-boat-star) tiling |
| [`pentagonal-islamic.md`](pentagonal-islamic.md) | 5-fold | Islamic decorated-rhomb tiling; Darb-e-Imam girih recurrence |
| [`octagonal.md`](octagonal.md) | 8-fold | Ammann–Beenker tiling; Keplerian octagonal tessellation |
| [`dodecagonal.md`](dodecagonal.md) | 12-fold | Socolar (butterfly) tiling; Stampfli 12-star / square-triangle; de Bruijn rhomb-square; ship tiling; Keplerian dodecagonal recurrence |
| [`heptagonal.md`](heptagonal.md) | 7-fold | Keplerian & Dürer-type heptagon attempts; rhomb dualization tilings; Harriss substitution; Danzer sevenfold tiling |
| [`periodic-reference.md`](periodic-reference.md) | periodic | Cairo tiling; conventional periodic tilings and the 17 wallpaper groups (contrast baseline) |

## Conventions

- **Diagrams.** The source PDFs are image-heavy; this documentation is text.
  Where a construction is defined by a diagram, it is described at the
  vertex/edge level in prose. Do not embed binary images in this directory —
  describe, or link to a source.
- **Renderer mapping is mandatory.** Every system says, explicitly, whether
  it is implemented in the renderer and what a `Family` entry would cost. The
  app currently implements four families — P3 and P2 (see
  `pentagonal-penrose.md`), the Chair L-tromino tiling (a 4-fold substitution
  not covered by the source PDFs; documented as a renderer note only), and the
  de Bruijn rhomb-square dodecagonal tiling (see `dodecagonal.md`).
- **Primary source.** Most of this material is synthesised from John Savard's
  tiling series at `http://www.quadibloc.com/math` (page IDs are cited per
  system), cross-checked against the primary academic literature each page
  cites.
