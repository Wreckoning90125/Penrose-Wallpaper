# Einstein monotiles

Single-prototile aperiodic disk tilings: the Smith-Myers-Kaplan-Goodman-Strauss
Hat and Spectre families. These are not rotational-symmetry families; they are
included because they are now first-class renderer families.

## Hat monotile

**Summary.** The Hat is the first aperiodic monotile in the modern "einstein"
sense: one topological disk tile, with no added matching-rule markings, whose
tilings are all non-periodic. Its tilings necessarily mix reflected and
unreflected copies.

| Property         | Value |
|------------------|-------|
| Symmetry order   | none |
| Symmetry type    | none |
| Aperiodic        | yes |
| Prototiles       | 1 - the 13-vertex Hat polykite |
| Construction     | substitution (H/T/P/F metatile hierarchy) |
| Inflation factor | metatile hierarchy; renderer uses generation-normalized patches |
| Attribution      | David Smith, Joseph Samuel Myers, Craig S. Kaplan, Chaim Goodman-Strauss |

### Prototiles
One 13-vertex polykite built on the kite grid. In renderer coordinates the
outline is the `hat_outline` polygon from Kaplan's `hatviz` source, with both
orientations allowed.

### Construction
Kaplan's `hatviz` code starts from four metatiles, H, T, P, and F. Each
generation constructs a super-patch from those four metatiles, then cuts that
patch back into new H/T/P/F metatiles. The renderer ports that construction
directly and emits the leaf Hat polygons for the selected seed metatile.

### Matching rules
None as extra edge colors or arrows. The forcing is geometric: every legal Hat
tiling clusters into the metatile hierarchy used by the construction.

### Symmetry & aperiodicity
The tilings are non-periodic through the forced hierarchy. The Hat is chiral as
a polygon, but every Hat tiling uses both reflected and unreflected copies.

### Variants & relations
The Hat belongs to the Smith-Myers-Kaplan-Goodman-Strauss continuum of
combinatorially equivalent polykites. The Spectre below is a later chiral
relative.

### History & decoration
Published in 2024 after the 2023 preprint. It resolved the long-running search
for an aperiodic monotile, while leaving open the stricter no-reflections
version answered by the Spectre.

### Renderer mapping
Implemented as `Family::Hat` (enum index 11). Seeds are H, T, P, and F
metatiles. `generateHat` ports Craig S. Kaplan's Hat visualizer generator,
normalizes the emitted patch to the unit disk, and caps at generation 5
(54,289 Hat tiles for the H seed).

### References
Smith, Myers, Kaplan, and Goodman-Strauss, "An aperiodic monotile,"
*Combinatorial Theory* 4(1), 2024; arXiv:2303.10798. Implementation source:
Craig S. Kaplan's public Hat visualizer.

## Spectre monotile

**Summary.** The Spectre is a strictly chiral aperiodic monotile: it tiles
aperiodically using translations and rotations only, and even if reflections are
permitted its tilings remain homochiral.

| Property         | Value |
|------------------|-------|
| Symmetry order   | none |
| Symmetry type    | none |
| Aperiodic        | yes |
| Prototiles       | 1 - the 14-vertex straight-edged Spectre / Tile(1,1) |
| Construction     | substitution (nine labelled supertiles) |
| Inflation factor | supertile hierarchy; renderer uses generation-normalized patches |
| Attribution      | David Smith, Joseph Samuel Myers, Craig S. Kaplan, Chaim Goodman-Strauss |

### Prototiles
One 14-vertex equilateral polygon in the straight-edged `spectre.js` generator
coordinates. The paper also defines curved-edge Spectres; the renderer uses the
straight polygonal Tile(1,1)/Spectre form because the tiling core is polygonal.

### Construction
Kaplan's generator has nine labelled supertile states: Gamma, Delta, Theta,
Lambda, Xi, Pi, Sigma, Phi, and Psi. Each generation replaces a labelled
supertile with a patch of seven or eight labelled children using fixed affine
placements. The renderer ports those placements directly and emits the leaf
Spectre polygons.

### Matching rules
None as extra edge colors or arrows. The hierarchy is forced by the Spectre
geometry; the labels are construction states, not multiple prototiles.

### Symmetry & aperiodicity
The Spectre is strictly chiral: tilings use one chirality and remain
non-periodic. This is the stronger version of the monotile result that the Hat
does not satisfy.

### Variants & relations
The generator also exposes hat-dominant and turtle-dominant equivalent shapes,
plus curved Spectre variants. The renderer currently implements the straight
Spectre polygon only.

### History & decoration
Published as the follow-up to the Hat result. The Spectre resolves the practical
and mathematical concern that the Hat requires reflected copies.

### Renderer mapping
Implemented as `Family::Spectre` (enum index 12). Seeds are the nine generator
labels Gamma, Delta, Theta, Lambda, Xi, Pi, Sigma, Phi, and Psi.
`generateSpectre` ports Kaplan's public Spectre generator, normalizes the
emitted patch to the unit disk, and caps at generation 5 (about 30k-35k tiles,
depending on seed).

### References
Smith, Myers, Kaplan, and Goodman-Strauss, "A chiral aperiodic monotile,"
*Combinatorial Theory* 4(2), 2024; arXiv:2305.17743. Implementation source:
Kaplan's public Spectre generator.
