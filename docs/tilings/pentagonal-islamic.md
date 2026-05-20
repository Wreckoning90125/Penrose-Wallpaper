# Pentagonal tilings — Islamic girih

The historical 5-fold strand: a periodic decorated-rhomb motif from Islamic
art, and the Darb-e-Imam shrine pattern whose girih construction embodies a
substitution recurrence centuries before Penrose.

Source: `quadibloc.com/math` Islamic-tilings page.

---

## Islamic decorated-rhomb tiling

**Summary.** A conventional *periodic* Islamic strapwork motif on a single
thick rhomb; significant because adding a thin rhomb lets the same decoration
ride an aperiodic (Penrose or binary) rhomb arrangement.

| Property         | Value |
|------------------|-------|
| Symmetry order   | periodic |
| Symmetry type    | periodic |
| Aperiodic        | no |
| Prototiles       | 1 (thick rhomb) in the base tiling; 2 with the added thin rhomb |
| Construction     | direct (periodic), then re-laid on an aperiodic substrate |
| Inflation factor | n/a |
| Attribution      | Islamic decorative tradition; aperiodic adaptation via Craig Kaplan |

### Prototiles
Base tiling: one **thick rhomb** carrying interlaced knot/strapwork (a green
strapwork field with red/cyan accents and black triangular corner fills). The
aperiodic adaptation adds a decorated **thin rhomb**, giving the standard
Penrose rhomb pair — thick 72°/108°, thin 36°/144° — chosen precisely for
Penrose compatibility.

### Construction
The base tiling is periodic — a single-rhomb translational unit cell, no
recurrence. The point of the page is that the *decoration* can be carried
onto an aperiodic substrate without changing the motif.

### Matching rules
The strapwork must continue across shared edges (the knotwork must connect).
No formal arrows or colours.

### Symmetry & aperiodicity
Not aperiodic — periodic single-rhomb unit cell. Presented as a periodic
motif that *anticipates* aperiodic rhomb tilings.

### Variants & relations
- Thick+thin decorated pair → carry the motif onto the **Penrose tiling**
  (`pentagonal-penrose.md`) or a **binary tiling such as Mikulla–Roth**
  (`pentagonal-binary.md`).
- Craig Kaplan's Quasitiler-modified version: built from a simpler tiling of
  the same basic geometry, usable on the Penrose tiling the same way.

### History & decoration
Islamic girih / strapwork tradition; a historical periodic design that
prefigures aperiodic rhomb tilings.

### Renderer mapping
Not a tiling system to implement — a **decoration layer**. The renderer
already emits P3 rhombs; an "Islamic girih" skin would be a per-rhomb
strapwork texture/SDF keyed to rhomb type and edge orientation, drawn over
the existing `Family::P3` geometry. No new `Family`.

### References
Craig Kaplan (Quasitiler adaptation); Roger Penrose; Mikulla–Roth; quadibloc.

---

## Darb-e-Imam girih tiling

**Summary.** The girih pattern on the Darb-e-Imam shrine, Isfahan. Its
construction embodies a self-similar recurrence on decagonal girih tiles —
quasicrystalline in principle, centuries before Penrose — though the executed
wall pattern is itself periodic.

| Property         | Value |
|------------------|-------|
| Symmetry order   | 5-fold (girih tiles); the executed pattern is periodic (wallpaper group cmm) |
| Symmetry type    | periodic (as executed); statistical 5-fold achievable in principle |
| Aperiodic        | not-forced (the recurrence *could* yield it; the shrine does not) |
| Prototiles       | girih set — 10-point star, pentagon, "overlapping-pentagon", kite, bow-tie |
| Construction     | substitution (girih recurrence), anchored on corner stars |
| Inflation factor | decagonal (multiples of 36°) |
| Attribution      | Darb-e-Imam shrine, Isfahan; analysed by Peter J. Lu (2007) |

### Prototiles
The conventional decagonal girih set (all angles multiples of 36°):
- **10-point star** — sits at the *vertices* of the component shapes; the
  recurrence is organised around these stars.
- **Pentagon** — regular.
- **Overlapping-pentagon piece** — two overlapping/paired pentagons.
- **Kite**.
- **Bow-tie** (elongated hexagon / "bobbin").
On the shrine these render in only light and dark: pentagon and
overlapping-pentagon both white; kite and bow-tie both black.

### Construction
A two-level recurrence: each prototile subdivides into smaller copies of the
same set, **anchored on the 10-point stars at the component shapes'
vertices**. The exact recurrence bounds of a tile are found by drawing
straight lines connecting the centres of its corner stars — and those lines
are physically present in the shrine design.
- **Pentagon recurrence** — irreducibly **asymmetric**: the children do not
  carry the pentagon's own 5-fold symmetry; the overlapping-pentagon piece
  must sit between the two stars along each long side, so the sides cannot be
  rotated to symmetrise it.
- **Bow-tie recurrence** — not exhibited on the surviving shrine; a
  conjectured one must replace **four corner stars** with component shapes
  (an overlap case) and works provided those replacements take precedence
  over neighbours' stars.

### Matching rules
- **Light/dark alternation.** Light pieces touch only dark pieces and vice
  versa — this parity makes the asymmetric pentagon recurrence resolvable.
- **Star-override priority.** Where corner stars of adjacent shapes overlap,
  component-shape replacements override neighbours' stars, letting the
  recurrence extend indefinitely.

### Symmetry & aperiodicity
The girih set *with its recurrence* can in principle generate a genuinely
quasicrystalline pattern with overall 5-fold symmetry. But the pattern
actually executed on the shrine is a **periodic** design (wallpaper group
cmm); there is no evidence the historical makers took the conceptual leap to
infinite recursion. Hence **aperiodic: not-forced**.

### Variants & relations
The diagram-colouring (five distinct colours) is a presentation variant of
the shrine's two-tone (light/dark) execution. Savard reconstructs the
periodic "upper-level pattern" from a doorway-corner fragment in Lu's Figure
3 and an archway photograph.

### History & decoration
Darb-e-Imam shrine and mosque, Isfahan, Iran. Documented by **Peter J. Lu**,
*Science*, 23 February 2007, arguing the pattern is genuinely quasicrystalline
and predates Penrose. A related Dürer-type pentagonal design exists in a
royal palace in Fez, Morocco. Recurrence-boundary lines through the star
centres are part of the genuine design.

### Renderer mapping
Not implemented. A girih `Family` would carry the most state of any pentagonal
system — five prototiles, light/dark parity, star-override priority, an
asymmetric pentagon rule. If pursued, model it as a 5-symbol substitution
with a per-tile light/dark bit and an explicit overlap-priority pass. Treat
as a long-horizon decorative family, well after the dodecagonal work.

### References
Peter J. Lu, *Science*, 23 Feb 2007 (and Figure 3); Roger Penrose; Johannes
Kepler; Albrecht Dürer; quadibloc.
