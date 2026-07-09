# tools

Host-side utilities. These are not app runtime code; they either generate checked
assets or verify contracts across the web and Android implementations.

## Inventory and ownership

| Tool | Scope | Purpose |
|---|---|---|
| `generate_web_geometry.py` | web generated data | Converts the native tiling catalogue into compact browser geometry before Vite dev/build. |
| `verify_atlas.py` | shared atlas data | Validates `atlas/tiling_atlas.json`. |
| `verify_border_joins.mts` | web geometry | Headless proof for the per-tile border ring tessellator. |
| `check_graph_contract.mts` | web graph/render | Checks graph schema wiring and renderer contract invariants. |
| `check_typescript_policy.mts` | web/source policy | Rejects forbidden TypeScript escape hatches in owned source. |
| `check_plain_js.py` | web/source policy | Keeps owned source out of plain JavaScript. |
| `validate_shaders.sh` | Android Vulkan | Compiles and validates GLSL/SPIR-V shader assets. |
| `run_clang_tidy.sh` | Android/native | Runs clang-tidy over native tiling/export sources. |
| `check_native_build.sh` | Android/native | Compiles the full native renderer (`libpenrose.so`) with the CI-pinned NDK toolchain via CMake+Ninja — the local equivalent of CI's `buildCMakeDebug`. Mandatory before committing any `android/app/src/main/cpp/` change. |
| `verify_tilings.cpp` | shared/native tiling | Links the production C++ tiling core and checks area, sampled coverage, overlap, and finite chamber topology. |
| `tiling_dsymbols.h` | shared/native tiling | Extracts a finite chamber graph and canonical vertex-configuration classes from generated tile patches. |
| `export_tiling_geometry.cpp` | shared/native tiling | Host exporter used by web geometry generation. |
| `bake_preset_thumbnails.py` | Android assets | Bakes preset thumbnail metadata for the Android picker. |
| `static_analysis_ratchet.py` | Android CI | Enforces the native/static-analysis warning budget. |

The directory is intentionally mixed because several checks bridge Android's C++
tiling source and the web viewer. Keep tool names explicit about their scope;
don't add ad-hoc browser probes here — browser/debug artifacts belong under
`output/playwright/` and long-running dev-server helpers belong under
`scripts/dev/`.

## `verify_tilings.cpp`

Checks every renderer tiling family against generated-patch invariants by
linking the production `tiling/penrose.cpp` directly. No figure, screenshot, or
rendered image is consulted.

- Seed-region substitution generators preserve area across generations.
- Seed-region generators preserve sampled coverage at the deepest generation;
  finite patch generators run sampled overlap checks.
- Every generated patch is converted to a finite chamber graph with one chamber
  per tile-edge endpoint. The verifier checks the Delaney-set involutions
  `op0`, `op1`, `op2`, the non-adjacent commutator `op0 op2 = op2 op0`, face
  orbit count, overfull geometric edges, and interior vertex angle sums.
- The same chamber graph emits canonical local vertex-configuration classes,
  reported as `dset F/E/V/C` in the verifier output.

```
g++ -std=c++20 -O2 -I android/app/src/main/cpp \
    tools/verify_tilings.cpp android/app/src/main/cpp/tiling/penrose.cpp \
    -o /tmp/verify_tilings && /tmp/verify_tilings
```

Exit status is non-zero on failure; run by the `tiling-verify` CI job.

## Why this is the right local check

A substitution tiling is correct iff its inflation rule, applied to any tile,
exactly repartitions that tile into prototiles. That target is algebraic and
figure-free:

- The prototile edges live in the cyclotomic ring `Z[ζ]` (`ζ = exp(iπ/n)`).
  An inflation by `λ` is valid only if `λ·e` decomposes into a sum of edge
  vectors for every edge `e` — a closure identity in that ring.
- The substitution matrix must be primitive (Perron–Frobenius); its Perron
  eigenvalue is `λ²` and the prototile areas are the matching left
  eigenvector, so area conservation is forced by the algebra.
- The geometric dissection is then pinned down by a finite closure search:
  enumerate the candidate partitions and keep the ones whose pieces are
  prototiles and whose union is the parent with no gap and no overlap.

That is how the `Danzer` family was derived (`heptagonal.md`) — the solver
enumerated triangulations of each inflated prototile and kept the ones that
close. `verify_tilings.cpp` is the standing regression form of those checks:
area conservation where the generator preserves a seed region, randomized
coverage/overlap sampling, and a figure-free chamber-graph check over the
actual edge/vertex topology of the generated patch.

**The crystallography stack does not apply.** `spglib`, `moyo`, `spgrep`,
`pyxtal`, and `aflow` operate on *periodic* structures: they detect a space
group, Wyckoff positions, and the symmetry of a unit cell. An aperiodic tiling
has **no space group and no unit cell** — fed one, `spglib` reports `P1` or
fails. Those tools answer a different question. This verifier stays small and
local because it checks the tile generators this app actually ships instead of
trying to infer a periodic structure that does not exist.

**What this does not yet cover.** The Harriss / Goodman-Strauss *rhomb*
substitutions (`heptagonal.md`) are not volume-hierarchic — their inflated
tiles have dimpled edges and 22–353 children, so the closure search is a
rhomb-packing problem, not the small polygon-triangulation enumeration that
makes the triangle families tractable. Cracking those needs a constraint
solver over rhomb placements (edge-match + interior-vertex-angle = 2π) or an
explicit coordinate reconstruction that the verifier can check against the
same constraints. That is a build task, not an import.
