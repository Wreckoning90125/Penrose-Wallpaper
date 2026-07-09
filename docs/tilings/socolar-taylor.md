# Socolar-Taylor tiling

## Taylor-Socolar half-hex substitution

**Summary.** The renderer implements the Taylor-Socolar tiling through the
Akiyama-Lee half-hexagonal substitution. This is the substitution model that is
mutually locally derivable from the marked hexagonal Taylor-Socolar tiling, so
it gives the app a direct hierarchical Taylor-Socolar family without needing a
disconnected component-group tile model.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 6-fold |
| Symmetry type    | statistical / hull-invariant under 60 degree rotations |
| Aperiodic        | yes |
| Prototiles       | 14 geometric half-hex roles, 28 decorated side/bar roles, 168 formal orientation types |
| Construction     | substitution |
| Inflation factor | 2 |
| Attribution      | Joshua Socolar, Joan Taylor; half-hex substitution by Shigeki Akiyama and Jeong-Yup Lee |

### Prototiles

The geometric support is a regular hexagon split along a long diagonal into
left and right half-hexes. In the app's canonical coordinates the two supports
share the segment from `(0, 0)` to `(0, -2)`:

- `L = (0,0), (-sqrt(3)/2,-1/2), (-sqrt(3)/2,-3/2), (0,-2)`.
- `R = (0,0), (0,-2), (sqrt(3)/2,-3/2), (sqrt(3)/2,-1/2)`.

Akiyama and Lee use seven decorated hex classes `A..G`, each split into `L`
and `R`, with barred and unbarred versions. The formal substitution treats the
six rotations of each decorated half-hex as distinct types, giving 168 formal
types for the translation-only substitution system. The app exposes structural
seeds: the generating triad from Akiyama-Lee Figure 1 and a single `A` full-hex
supertile. It does not expose `A..G` as ordinary seed options because changing
only the starting decorated class changes symbolic labels, not the generated
support geometry.

### Construction

Let `omega` be rotation by `pi/3`, `u = (cos(pi/6), sin(pi/6))`, and
`Q = 2 Rot(pi/3) Ref_y`. Akiyama and Lee give a source table for
`Q(SX)_n`, where `S` is one of the seven decorated letters or its barred
version, `X` is `L` or `R`, and `n` is the orientation index.

The app implements the inverse substitution. The default seed is the
Akiyama-Lee generating patch around the origin: a `B` hex, a barred `G` hex,
and an `A` hex meeting at one vertex. The secondary seed is the unbarred `A`
class split into its `L` and `R` halves. Every generation replaces each
half-hex with four smaller half-hexes using the Akiyama-Lee symbol table,
inverse `Q`, and the source's orientation-frame translation vectors. The result
preserves the original seed support at every generation.

### Matching rules

The original Taylor-Socolar monotile uses local markings on a hexagonal tile
to force the hierarchy. The app does not render those markings as matching-rule
decorations; it renders the substitution tiling that carries the same
hierarchical information.

### Symmetry & aperiodicity

Socolar and Taylor force nonperiodicity with their marked hexagonal tile and
its shape-only variants. Akiyama and Lee use the half-hexagonal substitution
tiling to show overlap coincidence and pure point spectrum, and state that the
half-hex substitution tiling is mutually locally derivable from the
Taylor-Socolar tiling.

### Variants & relations

The marked hexagonal monotile, the disconnected two-dimensional shape-only
version, and the three-dimensional connected version are different
presentations of the same Taylor-Socolar hierarchy. The renderer uses the
half-hex substitution presentation because it fits the app's existing polygonal
`Tile` pipeline and color/border/material controls.

### History & decoration

Socolar and Taylor introduced the aperiodic hexagonal tile and its
single-tile variants. Akiyama and Lee later encoded the hierarchy as a
half-hexagonal substitution for dynamical and diffraction analysis.

### Renderer mapping

Implemented as `Family::SocolarTaylor` in
`android/app/src/main/cpp/tiling/penrose.cpp`. The renderer emits ordinary
convex four-vertex half-hex polygons, so web and Android get the same fill,
border join, relief, palette, hyperbolic projection, and material behavior as
other native tiling families. Type mode uses the 28 decorated letter/bar/side
roles; orientation mode remains a separate sixfold geometric classifier.

### References

- Akiyama & Lee 2012 — see `bibliography.md`, *Socolar-Taylor*.
- Socolar & Taylor 2011 and 2012 — see `bibliography.md`, *Catalogue*.
