# Cromwell kite-rhombus-trapezium

Peter Cromwell's kite-rhombus-trapezium tiling is a connected subgraph of the
Robinson triangle graph. Cromwell classifies Robinson graph edges into two long
edge classes (red, blue) and two short edge classes (green, black); selecting
red + green + black and omitting blue produces the kite, rhombus and trapezium
faces.

The app generator follows that construction directly:

- run Cromwell's wide/tall Robinson triangle recursion;
- advance two Robinson deflations per app generation, matching the phi squared
  inflation factor listed for KRT;
- emit the bounded quadrilateral faces of the red + green + black planar graph.

This is intentionally not a hand-drawn replacement table copied from the
decorated Bielefeld image. The implementation is the undecorated graph-derived
tiling described in Cromwell's paper. The public seeds expose three KRT
supertile crops (kite, rhombus and trapezium) plus a fivefold star patch derived
from the same Robinson graph. The atlas uses the star seed so Cromwell appears
as a Penrose-class quasiperiodic structure with visible layers, not as an
arbitrary off-axis crop.

The curated atlas render uses Type colour mode with three geometric shape buckets
for kite, rhombus and trapezium faces. It is not yet a Bielefeld-colour
reproduction; that source image carries four visual states, so matching it should
preserve that state explicitly rather than guessing from shape alone.

References:

- Peter R. Cromwell, "From Substitution Tilings to Geometric Patterns in Islamic
  Styles", 2022.
- Tilings Encyclopedia, "Cromwell Kite-Rhombus-Trapezium".
