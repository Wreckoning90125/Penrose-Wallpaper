# tools

Host-side utilities. Not shipped in the APK; built and run standalone.

## `verify_tilings.cpp`

Certifies every renderer tiling family against the two properties that define a
correct tiling — area conservation and gap/overlap-free closure — by linking
the production `tiling/penrose.cpp` directly. No figure, screenshot, or
rendered image is consulted.

```
g++ -std=c++17 -O2 -I android/app/src/main/cpp \
    tools/verify_tilings.cpp android/app/src/main/cpp/tiling/penrose.cpp \
    -o /tmp/verify_tilings && /tmp/verify_tilings
```

Exit status is non-zero on failure; run by the `tiling-verify` CI job.

## Why this is the right tool — and why nothing off-the-shelf replaces it

A substitution tiling is correct iff its inflation rule, applied to any tile,
exactly repartitions that tile into prototiles. That is an **algebraic** fact,
provable without ever looking at a picture:

- The prototile edges live in the cyclotomic ring `Z[ζ]` (`ζ = exp(iπ/n)`).
  An inflation by `λ` is valid only if `λ·e` decomposes into a sum of edge
  vectors for every edge `e` — a closure identity in that ring.
- The substitution matrix must be primitive (Perron–Frobenius); its Perron
  eigenvalue is `λ²` and the prototile areas are the matching left
  eigenvector, so area conservation is forced by the algebra.
- The geometric dissection is then pinned down by a finite closure search:
  enumerate the candidate partitions and keep the ones whose pieces are
  prototiles and whose union is the parent with no gap and no overlap.

That is exactly how the `Danzer` family was derived (`heptagonal.md`) — the
solver enumerated every triangulation of each inflated prototile and kept the
ones that close. `verify_tilings.cpp` is the standing regression form of the
same closure check: area conservation across all generations plus a
Monte-Carlo coverage test (every point of the seed region covered exactly once
at the deepest generation).

**The crystallography stack does not apply.** `spglib`, `moyo`, `spgrep`,
`pyxtal`, and `aflow` operate on *periodic* structures: they detect a space
group, Wyckoff positions, and the symmetry of a unit cell. An aperiodic tiling
has **no space group and no unit cell** — fed one, `spglib` reports `P1` or
fails. None of these can certify a substitution rule or its closure; they
answer a different question. There is likewise no pip-installable library that
generates or validates substitution tilings — the field communicates rules
through primary papers (and, regrettably, figures). The closure verifier here
*is* the equivalent tool, kept small and exact rather than imported.

**What this does not yet cover.** The Harriss / Goodman-Strauss *rhomb*
substitutions (`heptagonal.md`) are not volume-hierarchic — their inflated
tiles have dimpled edges and 22–353 children, so the closure search is a
rhomb-packing problem, not the small polygon-triangulation enumeration that
makes the triangle families tractable. Cracking those needs a constraint
solver over rhomb placements (edge-match + interior-vertex-angle = 2π), not a
new dependency. That solver is the next tooling step if those families are
wanted; it is a build task, not an import.
