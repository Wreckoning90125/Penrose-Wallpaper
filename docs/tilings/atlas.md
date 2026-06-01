# Shared tiling atlas

`atlas/tiling_atlas.json` is the public source of truth for curated render
targets. The Android live wallpaper packages it as an asset and exposes it from
the Tiling screen.

The atlas is intentionally not a mirror of any external gallery. It names
families, seeds, color modes, material baselines, and projection settings that
this app can render. Category and target labels use "look", "style", or
"projection" where the current renderer is making an app-side visual target
rather than claiming a separate prototile implementation.

## Categories

Each category currently ships 10 targets:

- Penrose and golden-rule decorations: P3, P2, P1, Binary, Tuebingen.
- Ammann-Beenker and octagonal windows: Ammann-Beenker, Dodecagonal,
  Heptagonal.
- Chair, domino, and polyomino hierarchies: Chair, P2, Dodecagonal.
- Pinwheel and dense orientations: Pinwheel, Danzer, Heptagonal.
- Binary, Tuebingen, and stepped-boundary looks: Binary, Tuebingen, P3, P2,
  Ammann-Beenker.
- Curve-styled substitution targets: P2, Chair, P3, Dodecagonal, Pinwheel,
  Danzer.
- Dodecagonal and square-triangle matching-rule looks: Dodecagonal,
  Ammann-Beenker, Heptagonal.
- Poincare-disk and horocycle-style projections: Binary, P3, P2,
  Ammann-Beenker, Dodecagonal, Danzer.
- Hat and Spectre metatile targets: Spectre, Hat.

The Tiling screen groups these targets by category. Selecting a target writes
its settings into the same preferences used by the manual controls: family,
seed, generation, color mode, material baselines, and projection parameters.
Audio/reactivity starter presets remain independent and reusable across every
tiling target.

## Validation

Run:

```bash
python3 tools/verify_atlas.py
```

The check enforces category count, at least 10 targets per category, unique
target ids, family/seed/generation bounds, setting-key schema, and both
Android asset packaging linkage to the shared JSON.
