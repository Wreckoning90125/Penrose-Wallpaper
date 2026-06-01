# Local Corpus Audit

Date: 2026-05-26
Scope: `.local/**` under `/home/wreckoning90125/Penrose-Wallpaper`.

This is a non-destructive inventory. No local research files were moved or
renamed. I treated "sorting" as classification into usefulness tiers so the
ignored `.local/` source corpus stays intact.

## Method

- Physical files scanned: 375 total, about 985.7 MB.
- Document/archive records cataloged: 181.
- PDF-heavy subset: 147 PDFs, plus one PostScript file, text/Markdown files,
  CMake `*.txt` files, and compressed Zorin source bundles.
- Tools used: `find`, `pdfinfo`, `pdftotext`, `pdfimages`, `pdftoppm`, `strings`,
  `unzip`, and `tar`.
- First pass text extraction used pages 1-20 per PDF. Important scanned PDFs
  with weak text extraction were visually checked from rendered first pages.
- Extraction/cache artifacts were written only under `/tmp/penrose-local-corpus`.
- Post-audit update: `.local/hat-spectre/` was added after the first pass. It
  contains 26 files, about 20 MB, including the Hat and Spectre papers,
  Kaplan's Hat visualizer, Spectre generator assets, and Hat validation code.
  The tier counts below are the original snapshot counts and do not include
  that addendum.

## Tier Key

- `S` - use soon; directly advances tiling families, substitution logic,
  matching/covering rules, or rigorous terminology.
- `A` - useful tiling source, but mostly already covered by current docs.
- `B` - adjacent geometry, rendering, tooling, or decorative/reference value.
- `C` - remote background only.
- `X` - no practical tiling value for this repo.
- `Archive` - compressed source bundle; use on demand rather than indexing as
  primary tiling literature.

Tier counts: A=18, Archive=14, B=19, C=44, S=20, X=66.

## Executive Findings

The corpus is strongest around Harriss/Frettloh rhomb substitutions, de Bruijn
projection/duality, Gummelt decagon coverings, Savard's Quadibloc tiling series,
and Radin pinwheel/local-isomorphism material. That aligns well with the current
`docs/tilings/ROADMAP.md` blockers around heptagonal rhomb closure, dodecagonal
variants, and better algebraic verification.

The Hat/Spectre gap identified in the original pass is now closed under
`.local/hat-spectre/`. The folder contains the Hat paper
(`2303.10798v3.pdf`), Spectre paper (`2305.17743.pdf`), Hat metatile
visualizer source (`hatviz-main/hat.js`), Hat validation scripts, and Spectre
generator assets (`spectre/spectre.js`, `spectre/outlines.svg`).

The Zorin folder is mostly geometry-processing and microstructure material, not
aperiodic tiling literature. It is still worth keeping as an adjacent toolbox for
mesh, subdivision, conformal parameterization, and microstructure optimization,
but it should not drive the next tiling-family implementation.

## Highest-Value Local Sources

- `.local/hat-spectre/2303.10798v3.pdf` plus `hatviz-main/hat.js` and
  `validate/validate/` - Direct Hat/einstein monotile implementation and
  proof-checking source.
- `.local/hat-spectre/2305.17743.pdf` plus `spectre/spectre.js` and
  `spectre/outlines.svg` - Direct Spectre monotile implementation source,
  including the strictly chiral generator.
- `.local/non-periodic-rhomb-substitution-tilings-that-admit-order-n-23ylb3gspa.pdf` - Direct route to Harriss/Goodman-Strauss n-fold rhomb substitutions; use for heptagonal and general n-fold generator work.
- `.local/1409.1828v1.pdf` - Maloney computer-aided n-fold rhomb substitutions; strong input for arbitrary-n and 11-fold experiments.
- `.local/harriss2004.pdf` - Canonical Ammann-Beenker-type substitutions; useful for octagonal substitution variants and algebraic verification.
- `.local/On_Canonical_Substitution_Tilings.pdf` - Harriss thesis-scale source on canonical substitution tilings; mine for exact substitution algebra and proof structure.
- `.local/1-s2.0-S0304397507007876-main.pdf` - Frettloh self-dual cut-and-project tilings; useful for Penrose/Ammann-Beenker duality and acceptance-window notes.
- `.local/0304690v1.pdf` - Inflation rules for Gummelt decorated decagon coverings; direct implementation/spec source for decagon covering mode.
- `.local/gummelt1996.pdf` - Original Gummelt decagon covering paper; direct covering/matching-rule source.
- `.local/steinhardt1996.pdf` - Scanned Nature note on single decagon covering for quasicrystal formation; useful for Gummelt history and physical motivation.
- `.local/SteurerActaCRystA772021.pdf` - Gummelt versus Luck decagon covering comparison; useful for modern decagonal-quasicrystal context and wording.
- `.local/baake1990.pdf` - Scanned fivefold 4-space section paper; important for Penrose/Tubingen cut-and-project derivations despite poor text extraction.
- `.local/1-s2.0-S0019357713000530-main.pdf` - Historical de Bruijn/quasicrystal source; use for pentagrid, dualization, and superspace documentation.
- `.local/A simple example C. Godrbche(~) and of a non-Pisot tiling with five-fold symmetry.pdf` - Godreche-Lancon non-Pisot fivefold binary tiling; direct source for existing binary family and non-Pisot caveats.
- `.local/fields-s.pdf` - Scanned Radin aperiodic tilings/ergodic theory chapter; useful for statistical symmetry and finite-local-rule language.
- `.local/pinwheel.pdf` - Scanned Radin pinwheel paper; primary source for pinwheel substitution and infinite orientation set.
- `.local/radin1994.pdf` - Text-extractable Radin pinwheel paper duplicate/source; use alongside scanned copy.
- `.local/1202.4686.pdf` - Frettloh-Harriss parallelogram worms/orientations; useful for rhomb-tiling validators and finite-orientation claims.
- `.local/Dürer–Kepler–Penrose, the development of pentagon tilings.pdf` - Luck comparison of Durer/Kepler/Penrose pentagon tilings and acceptance domains; useful for pentagonal history and variants.

## What This Can Push Forward

1. Harriss/Goodman-Strauss and Maloney rhomb substitutions should move ahead of
   speculative new families if the goal is to exploit what is already local.
   `non-periodic-rhomb...pdf`, `1409.1828v1.pdf`, and `On_Canonical...pdf`
   are the practical source stack for a rhomb-packing closure solver and for
   n-fold substitution experiments.
2. Gummelt decagon covering can be made much more exact. The local corpus has
   the original covering paper, Jeong's inflation rules, Steinhardt/Jeong's
   physical motivation, Steurer's modern comparison, and a Greg Egan visual
   page. This is enough to specify a real covering mode rather than treating it
   as just another Penrose decoration.
3. The existing de Bruijn/multigrid docs can be upgraded with a real superspace
   record. `baake1990.pdf`, `1-s2.0-S0019357713000530-main.pdf`, and
   `1-s2.0-S0304397507007876-main.pdf` give the local source chain for the
   higher-dimensional lattice, duality, and acceptance-window side.
4. Pinwheel/local-isomorphism terminology can be tightened. The scanned and
   text-extractable Radin papers are enough to distinguish statistical symmetry,
   local isomorphism, finite local complexity, and infinite orientations without
   relying on secondary summaries.
5. Savard is valuable as a diagram/prose cross-check, but most Savard-derived
   family structure already appears in `docs/tilings/`. Use it to verify details
   and illustrations, not as the only source for new implementation.

## Missing Docs To Mirror Next

For tilings, the Hat/Spectre mirror is now present. The next useful mirrors are
primary Socolar-Taylor material and square-triangle / Shield / Socolar papers or
assets, because those are the remaining near-term roadmap families.

For Android/Vulkan, see `docs/platform/android-vulkan.md`. That file records
the current AGP/NDK/API/Kotlin/Vulkan pins, official update sources, and
repo-specific refresh checklist; this tiling audit should not become the
platform-docs home.

## Archive Notes

The compressed Zorin source bundles contain some README/docs material, but most
are large geometry-processing code archives. They should be indexed separately
only if we decide to mine geometry algorithms. The extracted
`.local/Zorin/microstructures-master/` tree is the only archive that is already
expanded and worth reading locally today.

## Root `.local/` Files

| Tier | Score | Pages | Path                                                                                           | File-level analysis                                                                                                              |
| ---- | ----: | ----: | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A    |    55 |     2 | `.local/Gummelt — Greg Egan.pdf`                                                               | Interactive-page printout for Gummelt visuals; useful as visual/UX reference, not primary math.                                  |
| A    |     0 |     1 | `.local/patch (1).pdf`                                                                         | One-page generated tiling image; useful as visual reference/sample output.                                                       |
| A    |     0 |     1 | `.local/patch.pdf`                                                                             | One-page generated tiling image; useful as visual reference/sample output.                                                       |
| C    |    15 |    25 | `.local/1601.02569v13.PDF`                                                                     | Hopf/quaternion background; remote unless the app grows topological visual modes.                                                |
| C    |     4 |     9 | `.local/Hongwan_Liu-Hopf_fibration.PDF`                                                        | Hopf/quaternion background; remote unless the app grows topological visual modes.                                                |
| S    |   542 |    14 | `.local/non-periodic-rhomb-substitution-tilings-that-admit-order-n-23ylb3gspa.pdf`             | Direct route to Harriss/Goodman-Strauss n-fold rhomb substitutions; use for heptagonal and general n-fold generator work.        |
| S    |   505 |    39 | `.local/harriss2004.pdf`                                                                       | Canonical Ammann-Beenker-type substitutions; useful for octagonal substitution variants and algebraic verification.              |
| S    |   487 |    12 | `.local/1-s2.0-S0304397507007876-main.pdf`                                                     | Frettloh self-dual cut-and-project tilings; useful for Penrose/Ammann-Beenker duality and acceptance-window notes.               |
| S    |   449 |       | `.local/Notes_260521_145517-tilings-10-3.txt`                                                  | Extracted Tilings and Patterns section 10.3 on Penrose P1/P2/P3; useful for concise canonical Penrose reference.                 |
| S    |   421 |    17 | `.local/1409.1828v1.pdf`                                                                       | Maloney computer-aided n-fold rhomb substitutions; strong input for arbitrary-n and 11-fold experiments.                         |
| S    |   409 |    22 | `.local/1-s2.0-S0019357713000530-main.pdf`                                                     | Historical de Bruijn/quasicrystal source; use for pentagrid, dualization, and superspace documentation.                          |
| S    |   407 |   161 | `.local/On_Canonical_Substitution_Tilings.pdf`                                                 | Harriss thesis-scale source on canonical substitution tilings; mine for exact substitution algebra and proof structure.          |
| S    |   400 |     7 | `.local/0304690v1.pdf`                                                                         | Inflation rules for Gummelt decorated decagon coverings; direct implementation/spec source for decagon covering mode.            |
| S    |   366 |    17 | `.local/gummelt1996.pdf`                                                                       | Original Gummelt decagon covering paper; direct covering/matching-rule source.                                                   |
| S    |   337 |    14 | `.local/A simple example C. Godrbche(~) and of a non-Pisot tiling with five-fold symmetry.pdf` | Godreche-Lancon non-Pisot fivefold binary tiling; direct source for existing binary family and non-Pisot caveats.                |
| S    |   229 |     5 | `.local/Dürer–Kepler–Penrose, the development of pentagon tilings.pdf`                         | Luck comparison of Durer/Kepler/Penrose pentagon tilings and acceptance domains; useful for pentagonal history and variants.     |
| S    |   215 |     9 | `.local/1202.4686.pdf`                                                                         | Frettloh-Harriss parallelogram worms/orientations; useful for rhomb-tiling validators and finite-orientation claims.             |
| S    |   207 |     7 | `.local/SteurerActaCRystA772021.pdf`                                                           | Gummelt versus Luck decagon covering comparison; useful for modern decagonal-quasicrystal context and wording.                   |
| S    |   164 |    43 | `.local/radin1994.pdf`                                                                         | Text-extractable Radin pinwheel paper duplicate/source; use alongside scanned copy.                                              |
| S    |   116 |     6 | `.local/radin1992.pdf`                                                                         | Radin-Wolff local-isomorphism text source; useful for recurrence/local-isomorphism definitions.                                  |
| S    |    25 |     6 | `.local/local-isomorphism-s.pdf`                                                               | Scanned Radin-Wolff local-isomorphism paper; useful for recurrence/local-isomorphism terminology.                                |
| S    |    25 |    42 | `.local/pinwheel.pdf`                                                                          | Scanned Radin pinwheel paper; primary source for pinwheel substitution and infinite orientation set.                             |
| S    |     0 |    52 | `.local/baake1990.pdf`                                                                         | Scanned fivefold 4-space section paper; important for Penrose/Tubingen cut-and-project derivations despite poor text extraction. |
| S    |     0 |    21 | `.local/fields-s.pdf`                                                                          | Scanned Radin aperiodic tilings/ergodic theory chapter; useful for statistical symmetry and finite-local-rule language.          |
| S    |     0 |     3 | `.local/steinhardt1996.pdf`                                                                    | Scanned Nature note on single decagon covering for quasicrystal formation; useful for Gummelt history and physical motivation.   |
| X    |    10 |    89 | `.local/thesis.pdf`                                                                            | Parallel ray-tracing thesis; renderer-history curiosity, not tiling.                                                             |
| X    |     8 |    84 | `.local/2211.04464v2.pdf`                                                                      | Category theory; no practical tiling/rendering use for this repo.                                                                |
| X    |     2 |       | `.local/isug95.ps`                                                                             | PostScript ray-tracing paper/source; not useful for tiling beyond renderer-history curiosity.                                    |
| X    |     1 |  1386 | `.local/Johnson_Yau_ring_categories.PDF`                                                       | Category theory; no practical tiling/rendering use for this repo.                                                                |
| X    |     0 |   476 | `.local/2002.06055v3.pdf`                                                                      | Category theory; no practical tiling/rendering use for this repo.                                                                |

## `JGSavard/` Files

| Tier | Score | Pages | Path                                                                                           | File-level analysis                                                                                             |
| ---- | ----: | ----: | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A    |   343 |    14 | `.local/JGSavard/Penrose Tilings.pdf`                                                          | Savard P1/P2/P3 page; already heavily represented in docs but still useful for diagrams and prose cross-checks. |
| A    |   304 |    12 | `.local/JGSavard/The Geometry Junkyard_ Tilings.pdf`                                           | Eppstein tilings index printout; useful as discovery bibliography and terminology index.                        |
| A    |   195 |     7 | `.local/JGSavard/The Binary Tiling.pdf`                                                        | Savard binary tiling page; useful for rhomb marking and non-Pisot family cross-checks.                          |
| A    |   187 |     4 | `.local/JGSavard/The Geometry Junkyard_ Penrose Tiling.pdf`                                    | Eppstein Penrose page printout; useful as concise external cross-check.                                         |
| A    |   179 |     8 | `.local/JGSavard/Basic Tilings_ The 17 Wallpaper Groups.pdf`                                   | Periodic wallpaper baseline; useful for contrast docs and symmetry vocabulary.                                  |
| A    |   150 |     5 | `.local/JGSavard/More Dodecagonal Tilings.pdf`                                                 | Dodecagonal rhomb/square family notes; useful for de Bruijn dodecagonal and square-triangle variants.           |
| A    |   122 |     5 | `.local/JGSavard/The Socolar Tiling.pdf`                                                       | Savard Socolar/butterfly page; useful for roadmap square-triangle/shield/Socolar work.                          |
| A    |   117 |     4 | `.local/JGSavard/More Pentagonal Tilings.pdf`                                                  | Savard Keplerian/pentagonal variants; useful for pentagonal-keplerian doc cross-checks.                         |
| A    |   114 |     8 | `.local/JGSavard/Pentagonal Tilings from the Islamic World.pdf`                                | Islamic/Penrose adaptation page; useful for pentagonal-islamic doc cross-checks.                                |
| A    |   113 |     4 | `.local/JGSavard/Heptagonal Tilings.pdf`                                                       | Heptagonal attempts and dualization notes; useful for heptagonal family docs.                                   |
| A    |   101 |    10 | `.local/JGSavard/About QuasiTiler version 3.0.pdf`                                             | QuasiTiler manual/page; useful if resurrecting projection tooling or QuasiTiler comparisons.                    |
| A    |   100 |     3 | `.local/JGSavard/The Ammann-Beenker Tiling.pdf`                                                | Ammann-Beenker page; useful for octagonal recurrence/matching-rule cross-checks.                                |
| A    |    99 |     5 | `.local/JGSavard/Under the Green Star.pdf`                                                     | Heptagonal rhomb recurrence exploration; useful but informal.                                                   |
| A    |    67 |     2 | `.local/JGSavard/The Pinwheel Tiling.pdf`                                                      | Savard pinwheel page; useful as quick secondary source.                                                         |
| A    |    64 |     7 | `.local/JGSavard/Octagonal Tesselations.pdf`                                                   | Savard octagonal recurrence page; useful for octagonal variants and terminology.                                |
| B    |    81 |    15 | `.local/JGSavard/Co-ordinates and Distances.pdf`                                               | Polyhedron coordinate math; useful only for exact geometry helpers, not tiling rules.                           |
| B    |    79 |     3 | `.local/JGSavard/More Tilings.pdf`                                                             | Periodic/ornamental examples; useful as contrast and decorative reference.                                      |
| B    |    64 |    10 | `.local/JGSavard/The Johnson Solids.pdf`                                                       | Solid geometry background; remote use for 3D decoration, not planar tiling logic.                               |
| B    |    43 |     2 | `.local/JGSavard/The 2-Regular Tilings.pdf`                                                    | Periodic semiregular tiling baseline; useful for contrast only.                                                 |
| C    |    42 |     9 | `.local/JGSavard/The Archimedean Solids.pdf`                                                   | Periodic/solid geometry baseline only.                                                                          |
| C    |    37 |     4 | `.local/JGSavard/Shadows from the Fifth Dimension.pdf`                                         | Superspace intuition for Penrose; secondary background.                                                         |
| C    |    36 |     9 | `.local/JGSavard/Molecular Models.pdf`                                                         | Geometry background only.                                                                                       |
| C    |    20 |     3 | `.local/JGSavard/Pentagons and Stars Alone_.pdf`                                               | Pentagonal decorative variant; low because short, but keep as secondary history.                                |
| C    |    18 |     4 | `.local/JGSavard/The Archimedian Duals, or the Catalan Solids.pdf`                             | Periodic/solid geometry baseline only.                                                                          |
| C    |    13 |     5 | `.local/JGSavard/A Systematic Survey.pdf`                                                      | Likely Savard general math page; minor geometry only.                                                           |
| C    |    10 |     3 | `.local/JGSavard/The Golden Ratio and Friends.pdf`                                             | Golden-ratio background only; not a tiling source.                                                              |
| C    |     8 |     4 | `.local/JGSavard/Filling Space with Polyhedra.pdf`                                             | 3D tessellation background; remote.                                                                             |
| C    |     7 |    30 | `.local/JGSavard/Featured Images.pdf`                                                          | Mostly image gallery; minor decorative reference.                                                               |
| C    |     5 |     6 | `.local/JGSavard/The Fourth Dimension.pdf`                                                     | General 4D background; use only for superspace intuition.                                                       |
| C    |     3 |     5 | `.local/JGSavard/A Cryptographic Compendium.pdf`                                               | Not tiling; cryptography background only.                                                                       |
| C    |     2 |     9 | `.local/JGSavard/Sphere Packing.pdf`                                                           | Mostly packing, not app tiling; remote geometry background.                                                     |
| C    |     1 |     7 | `.local/JGSavard/Groups, Rings, and Fields.pdf`                                                | Algebra background only.                                                                                        |
| C    |     0 |     3 | `.local/JGSavard/Polycube Puzzles.pdf`                                                         | Not planar tiling; 3D puzzle background.                                                                        |
| X    |    18 |    17 | `.local/JGSavard/Dice of Other Shapes.pdf`                                                     | Mostly not tiling; only shape vocabulary.                                                                       |
| X    |    15 |    14 | `.local/JGSavard/Hexagonal Three-Dimensional Chess.pdf`                                        | Game geometry only; not tiling rules.                                                                           |
| X    |    10 |     7 | `.local/JGSavard/Changing the Base.pdf`                                                        | Mostly arithmetic; ignore keyword false positives.                                                              |
| X    |     8 |    12 | `.local/JGSavard/Squaring the Circle.pdf`                                                      | Not tiling; classical geometry.                                                                                 |
| X    |     7 |     6 | `.local/JGSavard/Dice of Still More Shapes.pdf`                                                | Mostly not tiling; only shape vocabulary.                                                                       |
| X    |     7 |     8 | `.local/JGSavard/The Adams-Gougenheim-Lee Conformal Projection of the World on an Ellipse.pdf` | Not tiling; map projection.                                                                                     |
| X    |     6 |     8 | `.local/JGSavard/Photo Section.pdf`                                                            | Mostly images/general Savard context.                                                                           |
| X    |     5 |     9 | `.local/JGSavard/More Shapes for Dice.pdf`                                                     | Mostly not tiling; only shape vocabulary.                                                                       |
| X    |     5 |     7 | `.local/JGSavard/The Next Steps in Calculating Pi.pdf`                                         | Not tiling; pi/history.                                                                                         |
| X    |     3 |     3 | `.local/JGSavard/Pi, Circles, and Other Round Things.pdf`                                      | Not tiling; pi/history.                                                                                         |
| X    |     3 |     8 | `.local/JGSavard/Still More About Pi.pdf`                                                      | Not tiling; pi/history.                                                                                         |
| X    |     2 |     3 | `.local/JGSavard/Mysteries of the Dodecahedron.pdf`                                            | Savard page is off-topic for tiling implementation.                                                             |
| X    |     1 |     6 | `.local/JGSavard/A few more interesting facts.pdf`                                             | General trivia; not tiling.                                                                                     |
| X    |     1 |     4 | `.local/JGSavard/First Steps in Calculating Pi.pdf`                                            | Not tiling; pi/history.                                                                                         |
| X    |     1 |     6 | `.local/JGSavard/Infinity.pdf`                                                                 | Not tiling.                                                                                                     |
| X    |     1 |     4 | `.local/JGSavard/SlideRule/How Did a Slide Rule Work_.pdf`                                     | Not tiling; slide-rule reference.                                                                               |
| X    |     1 |     2 | `.local/JGSavard/Still more interesting facts.pdf`                                             | General trivia; not tiling.                                                                                     |
| X    |     1 |    15 | `.local/JGSavard/The Mersenne Twister.pdf`                                                     | Not tiling; RNG.                                                                                                |
| X    |     0 |    11 | `.local/JGSavard/A Limitation of Color Photography.pdf`                                        | Not tiling; photography.                                                                                        |
| X    |     0 |     3 | `.local/JGSavard/A Magical Set of Dice.pdf`                                                    | Not tiling; dice/probability.                                                                                   |
| X    |     0 |     3 | `.local/JGSavard/Change Ringing.pdf`                                                           | Not tiling; change ringing.                                                                                     |
| X    |     0 |     8 | `.local/JGSavard/Diophantus at the Printer's Shop.pdf`                                         | Not tiling; number theory.                                                                                      |
| X    |     0 |     6 | `.local/JGSavard/e to i times pi equals minus one.pdf`                                         | Not tiling; pi/history.                                                                                         |
| X    |     0 |    14 | `.local/JGSavard/From Gold Coins to Cadmium Light.pdf`                                         | Not tiling.                                                                                                     |
| X    |     0 |    10 | `.local/JGSavard/Gauge is Not Scale.pdf`                                                       | Not tiling.                                                                                                     |
| X    |     0 |     3 | `.local/JGSavard/Handy Conversion Tables.pdf`                                                  | Not tiling.                                                                                                     |
| X    |     0 |     6 | `.local/JGSavard/Infinite Ordinals.pdf`                                                        | Not tiling; set theory.                                                                                         |
| X    |     0 |     5 | `.local/JGSavard/Introduction.pdf`                                                             | General site intro; not useful for tiling.                                                                      |
| X    |     0 |    20 | `.local/JGSavard/It Shares an Application With Chromium Dioxide.pdf`                           | Not tiling.                                                                                                     |
| X    |     0 |     1 | `.local/JGSavard/Large Cardinals.pdf`                                                          | Not tiling; set theory.                                                                                         |
| X    |     0 |     5 | `.local/JGSavard/Magic Squares.pdf`                                                            | Not tiling.                                                                                                     |
| X    |     0 |     4 | `.local/JGSavard/More About SOMA.pdf`                                                          | Not tiling; puzzle/polycube.                                                                                    |
| X    |     0 |     7 | `.local/JGSavard/SlideRule/Advanced Manipulations.pdf`                                         | Not tiling; slide-rule reference.                                                                               |
| X    |     0 |     7 | `.local/JGSavard/SlideRule/Designing a Slide Rule.pdf`                                         | Not tiling; slide-rule reference.                                                                               |
| X    |     0 |     5 | `.local/JGSavard/SlideRule/Duplex Rule Arrangements.pdf`                                       | Not tiling; slide-rule reference.                                                                               |
| X    |     0 |     9 | `.local/JGSavard/SlideRule/Special Scales.pdf`                                                 | Not tiling; slide-rule reference.                                                                               |
| X    |     0 |    12 | `.local/JGSavard/SlideRule/Types of Slide Rules.pdf`                                           | Not tiling; slide-rule reference.                                                                               |
| X    |     0 |     3 | `.local/JGSavard/Strange Ways to Write Fractions.pdf`                                          | Not tiling; fractions.                                                                                          |
| X    |     0 |     5 | `.local/JGSavard/The Gamma Function.pdf`                                                       | Not tiling; special functions.                                                                                  |
| X    |     0 |     4 | `.local/JGSavard/The Halting Problem, and Gödel's Theorem.pdf`                                 | Not tiling; computability.                                                                                      |
| X    |     0 |     5 | `.local/JGSavard/The Hyperbolic Trig Functions.pdf`                                            | Savard page is off-topic for tiling implementation.                                                             |
| X    |     0 |     8 | `.local/JGSavard/The Korean Typewriter.pdf`                                                    | Not tiling.                                                                                                     |
| X    |     0 |     2 | `.local/JGSavard/The Lucky Numbers.pdf`                                                        | Not tiling.                                                                                                     |
| X    |     0 |     7 | `.local/JGSavard/The Mandelbrot Function.pdf`                                                  | Not tiling; fractals only.                                                                                      |
| X    |     0 |     3 | `.local/JGSavard/The Mikusiński Variations.pdf`                                                | Not tiling.                                                                                                     |
| X    |     0 |    11 | `.local/JGSavard/The Musical Scale.pdf`                                                        | Not tiling; music/math.                                                                                         |
| X    |     0 |     4 | `.local/JGSavard/The Riemann Zeta Function.pdf`                                                | Not tiling; number theory.                                                                                      |
| X    |     0 |     1 | `.local/JGSavard/Two Mathematical Identities.pdf`                                              | Not tiling; identities.                                                                                         |

## `Zorin/` Files

| Tier    | Score | Pages | Path                                                                              | File-level analysis                                                                                            |
| ------- | ----: | ----: | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Archive |     0 |       | `.local/Zorin/2020-Quad-Foam.zip`                                                 | Source/data bundle corresponding to 2020 Quad-Foam paper; only relevant if mining rhombic microstructure code. |
| Archive |     0 |       | `.local/Zorin/algebraic-contours-main.zip`                                        | Source bundle for algebraic smooth occluding contours; renderer/geometry adjacent only.                        |
| Archive |     0 |       | `.local/Zorin/ConformalIdealDelaunay-master.zip`                                  | Source bundle with README/TeX figures for conformal ideal Delaunay work; adjacent mesh tooling.                |
| Archive |     0 |       | `.local/Zorin/dipole-normal-prop-main.zip`                                        | Source/docs bundle for point-cloud normal orientation; not tiling.                                             |
| Archive |     0 |       | `.local/Zorin/geometric-contact-potential-main.zip`                               | Source/docs bundle for contact potential/polyfem; not tiling.                                                  |
| Archive |     0 |       | `.local/Zorin/hocgv-master.zip`                                                   | Source for high-order continuous geometrical validity; geometry validation adjacent only.                      |
| Archive |     0 |       | `.local/Zorin/illustrate.tar.gz`                                                  | Legacy Illustrate/doc bundle; renderer-history only.                                                           |
| Archive |     0 |       | `.local/Zorin/microstructures-master.zip`                                         | Compressed duplicate of extracted microstructures source; use extracted tree instead.                          |
| Archive |     0 |       | `.local/Zorin/miso-main.zip`                                                      | Small source bundle; no tiling documentation signal.                                                           |
| Archive |     0 |       | `.local/Zorin/nn-benchmark-master.zip`                                            | Benchmark source bundle; not tiling.                                                                           |
| Archive |     0 |       | `.local/Zorin/polyfem-main.zip`                                                   | Large FEM source bundle; only relevant if adding simulation/material tooling.                                  |
| Archive |     0 |       | `.local/Zorin/rigid-ipc-main.zip`                                                 | Rigid-body/contact source bundle; renderer physics adjacent, not tiling.                                       |
| Archive |     0 |       | `.local/Zorin/subdivide20.tar.gz`                                                 | Subdivision code/docs; useful only if adding subdivision/smoothing tools.                                      |
| Archive |     0 |       | `.local/Zorin/topological-offsets-main.zip`                                       | Topological offsets source bundle; geometry tooling adjacent only.                                             |
| B       |   125 |    20 | `.local/Zorin/2020-Quad-Foam.pdf`                                                 | Rhombic microstructure family for irregular lattices; adjacent geometry idea, not an aperiodic tiling source.  |
| B       |    65 |    44 | `.local/Zorin/zorin2006sam.pdf`                                                   | Subdivision-surfaces survey; useful if renderer geometry smoothing/subdivision becomes relevant.               |
| B       |    42 |    16 | `.local/Zorin/2021-Conformal.pdf`                                                 | Discrete conformal equivalence; useful for mesh/parameterization tooling, not tiling rules.                    |
| B       |    36 |    12 | `.local/Zorin/panetta2015et.pdf`                                                  | Elastic texture tilings/microstructures; adjacent procedural material idea.                                    |
| B       |    28 |    14 | `.local/Zorin/2018-Decoupling.pdf`                                                | Mesh-quality-independent simulation; adjacent for geometry validation, not tiling generation.                  |
| B       |    27 |    15 | `.local/Zorin/panetta2017worst.pdf`                                               | Microstructure optimization; adjacent if using tilings as printable/material cells.                            |
| B       |    22 |    16 | `.local/Zorin/2021-RigidIPC.pdf`                                                  | Adjacent geometry/meshing/graphics paper; not a tiling-rule source.                                            |
| B       |    22 |     9 | `.local/Zorin/2025-solidshell.pdf`                                                | Adjacent geometry/meshing/graphics paper; not a tiling-rule source.                                            |
| B       |    21 |    14 | `.local/Zorin/2021-Dipole.pdf`                                                    | Adjacent geometry/meshing/graphics paper; not a tiling-rule source.                                            |
| B       |    21 |    10 | `.local/Zorin/zhou2018quadrangulation.pdf`                                        | Adjacent geometry/meshing/graphics paper; not a tiling-rule source.                                            |
| B       |    20 |    60 | `.local/Zorin/Geometric Computing Lab @ NYU.pdf`                                  | Denis Zorin lab page printout; index to geometry papers, not a tiling source itself.                           |
| B       |    17 |       | `.local/Zorin/microstructures-master/docs/notes.md`                               | Microstructure optimization notes; adjacent, mostly not tiling.                                                |
| B       |    11 |       | `.local/Zorin/microstructures-master/docs/faq.md`                                 | Microstructures FAQ; adjacent geometry/tooling only.                                                           |
| B       |     8 |       | `.local/Zorin/microstructures-master/docs/usage.md`                               | Microstructures CLI usage; useful only if building/borrowing that tooling.                                     |
| B       |     8 |       | `.local/Zorin/microstructures-master/README.md`                                   | Microstructures code README; useful if mining pattern optimization ideas.                                      |
| C       |    18 |    27 | `.local/Zorin/boiermartin2005sbt.pdf`                                             | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    18 |    15 | `.local/Zorin/parilov2008rtr.pdf`                                                 | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    17 |    19 | `.local/Zorin/2025-Positive-Jacobian.pdf`                                         | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    17 |     5 | `.local/Zorin/ying2004smb.pdf`                                                    | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    16 |    10 | `.local/Zorin/campen2016sid.pdf`                                                  | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    15 |    11 | `.local/Zorin/gilureta2016imm.pdf`                                                | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    14 |    12 | `.local/Zorin/kovacs2015dts.pdf`                                                  | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    14 |    20 | `.local/Zorin/zorin2002eps.pdf`                                                   | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    13 |    32 | `.local/Zorin/2021-PhysBench.pdf`                                                 | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    13 |    24 | `.local/Zorin/2025-Contact.pdf`                                                   | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    12 |    10 | `.local/Zorin/2023-Occluding-Contours.pdf`                                        | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    12 |   194 | `.local/Zorin/coursenotes00.pdf`                                                  | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    12 |    10 | `.local/Zorin/martin2004spc.pdf`                                                  | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    12 |     9 | `.local/Zorin/peng2004imt.pdf`                                                    | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    12 |    12 | `.local/Zorin/schaefer2004lcn.pdf`                                                | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    12 |    13 | `.local/Zorin/ying2001tss.pdf`                                                    | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    12 |     4 | `.local/Zorin/zorin1996ism.pdf`                                                   | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    11 |    34 | `.local/Zorin/2002.04143v4.pdf`                                                   | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    11 |     4 | `.local/Zorin/bergou2006qbm.pdf`                                                  | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    11 |    10 | `.local/Zorin/grinspun2006cds.pdf`                                                | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    11 |    10 | `.local/Zorin/tosun2007sou.pdf`                                                   | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    10 |    10 | `.local/Zorin/hertzmann-zorin.pdf`                                                | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    10 |    36 | `.local/Zorin/ying2006h3b.pdf`                                                    | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    10 |    29 | `.local/Zorin/zorin2000ssi.pdf`                                                   | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |    10 |    10 | `.local/Zorin/zorin2006ccc.pdf`                                                   | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |     7 |    23 | `.local/Zorin/2019-GradientDynamics.pdf`                                          | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |     1 |     5 | `.local/Zorin/Rigid-IPC.pdf`                                                      | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| C       |     0 |       | `.local/Zorin/microstructures-master/tests/README.md`                             | Geometry/graphics background; keep only if the renderer or mesh tooling grows into this area.                  |
| X       |    11 |       | `.local/Zorin/microstructures-master/src/lib/isosurface_inflator/CMakeLists.txt`  | Build file from microstructures bundle; not useful as documentation unless building that source tree.          |
| X       |    10 |       | `.local/Zorin/microstructures-master/src/bin/isosurface_inflator/CMakeLists.txt`  | Build file from microstructures bundle; not useful as documentation unless building that source tree.          |
| X       |     5 |       | `.local/Zorin/microstructures-master/CMakeLists.txt`                              | Build file from microstructures bundle; not useful as documentation unless building that source tree.          |
| X       |     3 |       | `.local/Zorin/microstructures-master/src/bin/topology_enumeration/CMakeLists.txt` | Build file from microstructures bundle; not useful as documentation unless building that source tree.          |
| X       |     3 |       | `.local/Zorin/microstructures-master/src/bin/worst_case_stress/CMakeLists.txt`    | Build file from microstructures bundle; not useful as documentation unless building that source tree.          |
| X       |     2 |       | `.local/Zorin/microstructures-master/src/bin/pattern_optimization/CMakeLists.txt` | Build file from microstructures bundle; not useful as documentation unless building that source tree.          |
| X       |     2 |       | `.local/Zorin/microstructures-master/src/bin/simple_api/CMakeLists.txt`           | Build file from microstructures bundle; not useful as documentation unless building that source tree.          |
| X       |     2 |       | `.local/Zorin/microstructures-master/tests/CMakeLists.txt`                        | Build file from microstructures bundle; not useful as documentation unless building that source tree.          |
| X       |     1 |       | `.local/Zorin/microstructures-master/src/bin/CMakeLists.txt`                      | Build file from microstructures bundle; not useful as documentation unless building that source tree.          |
| X       |     1 |       | `.local/Zorin/microstructures-master/src/lib/inflators/CMakeLists.txt`            | Build file from microstructures bundle; not useful as documentation unless building that source tree.          |
| X       |     0 |       | `.local/Zorin/microstructures-master/src/lib/CMakeLists.txt`                      | Build file from microstructures bundle; not useful as documentation unless building that source tree.          |
| X       |     0 |       | `.local/Zorin/microstructures-master/src/lib/optimizers/CMakeLists.txt`           | Build file from microstructures bundle; not useful as documentation unless building that source tree.          |
| X       |     0 |       | `.local/Zorin/microstructures-master/src/lib/pattern_optimization/CMakeLists.txt` | Build file from microstructures bundle; not useful as documentation unless building that source tree.          |
