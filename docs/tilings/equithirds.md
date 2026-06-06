# Equithirds

Bill Kalahurka's Equithirds substitution is included from the Bielefeld Tilings
Encyclopedia entry `substitution/equithirds`.

The implementation uses the two triangle prototiles shown in the source rule:

- type 0: an equilateral triangle,
- type 1: a 30-30-120 wide triangle,
- inflation factor `sqrt(3)`,
- type 0 deflates into three type 1 triangles meeting at the centroid,
- type 1 deflates into two type 1 triangles plus one type 0 triangle.

`tools/verify_tilings.cpp` gates both seeds through area conservation, coverage
equivalence, and Equithirds-specific side-ratio checks so the two prototile
shapes cannot silently drift.
