#!/usr/bin/env python3
"""Validate the shared tiling atlas used by Android."""

from __future__ import annotations

import json
import re
import struct
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ATLAS = ROOT / "atlas" / "tiling_atlas.json"
ANDROID_BUILD = ROOT / "android" / "app" / "build.gradle.kts"
COUNT_DIR = ROOT / ".cache" / "atlas-count-check"
EXPORTER = ROOT / "tools" / "generate_web_geometry.py"
WEB_FAMILIES = ROOT / "web" / "src" / "tiling" / "families.ts"
WEB_GEOMETRY = ROOT / "web" / "src" / "tiling" / "geometry.ts"
NATIVE_TILING = ROOT / "android" / "app" / "src" / "main" / "cpp" / "tiling" / "penrose.cpp"
MAX_INITIAL_TILES = 600

FAMILY_MAX_SEED = {
    0: 3,
    1: 1,
    2: 2,
    3: 2,
    4: 2,
    5: 2,
    6: 2,
    7: 1,
    8: 1,
    9: 0,
    10: 1,
    11: 3,
    12: 8,
    13: 1,
    14: 3,
    15: 51,
    16: 0,
    17: 6,
    18: 5,
}

FAMILY_MAX_GEN = {
    2: 7,
    4: 6,
    9: 7,
    10: 7,
    11: 4,
    12: 3,
    13: 10,
    14: 5,
    15: 8,
    16: 8,
    17: 7,
    18: 8,
}

PREF_SCHEMA = {
    "family": str,
    "seed": str,
    "generation": int,
    "preset": str,
    "color_count": int,
    "color_mode": str,
    "color_spread": int,
    "color_spectral": int,
    "border_on": bool,
    "border_join": str,
    "border_width": int,
    "border_fill": int,
    "border_point": int,
    "border_gap": int,
    "border_l": int,
    "border_c": int,
    "border_h": int,
    "border_a": int,
    "edge_profile_width": int,
    "edge_profile_glow": int,
    "edge_profile_l": int,
    "edge_profile_c": int,
    "edge_profile_h": int,
    "bg_mode": str,
    "bg_l": int,
    "bg_c": int,
    "bg_h": int,
    "field_relief": int,
    "field_color": int,
    "field_undulate": int,
    "field_freq": int,
    "field_undulate_freq": int,
    "field_speed": int,
    "pan_mode": str,
    "view_zoom": float,
    "view_rotation": float,
    "view_pan_x": float,
    "view_pan_y": float,
    "brightness": int,
    "field_displace": int,
    "mat_roughness": int,
    "mat_metalness": int,
    "mat_sheen": int,
    "mat_clearcoat": int,
    "mat_anisotropy": int,
    "mat_iridescence": int,
    "mat_emissive": int,
    "mat_relief": int,
    "ornament_style": int,
    "ornament_amount": int,
    "ornament_width": int,
    "ornament_density": int,
    "ornament_phase": int,
    "ornament_twist": int,
    "surface_contour_amount": int,
    "surface_contour_source": int,
    "surface_contour_spacing": int,
    "surface_contour_width": int,
    "surface_contour_phase": int,
    "surface_contour_l": int,
    "surface_contour_c": int,
    "surface_contour_h": int,
    "light_angle": int,
    "light_elevation": int,
    "light_intensity": int,
    "light_warmth": int,
    "light_ambient": int,
    "mat_sheen_color_r": int,
    "mat_sheen_color_g": int,
    "mat_sheen_color_b": int,
    "mat_irid_thick_min": int,
    "mat_irid_thick_max": int,
    "mat_rough_mod": int,
    "mat_metal_mod": int,
    "projection": str,
    "hyp_scale": int,
    "hyp_boost_x": int,
    "hyp_boost_y": int,
    "hyp_border_subdiv": int,
    "hyp_fill_subdiv": int,
}

STRING_VALUES = {
    "family": {str(v) for v in range(max(FAMILY_MAX_SEED) + 1)},
    "seed": {str(v) for v in range(52)},
    "preset": {str(v) for v in range(12)},
    "color_mode": {"0", "1", "2", "3"},
    "bg_mode": {"0", "1"},
    "border_join": {"0", "1", "2"},
    "pan_mode": {"0", "1", "2"},
    "projection": {"0", "1"},
}

INT_RANGES = {
    "generation": (0, 10),
    "color_count": (2, 18),
    "color_spread": (0, 100),
    "color_spectral": (0, 100),
    "border_width": (0, 600),
    "border_l": (0, 100),
    "border_c": (0, 37),
    "border_h": (0, 359),
    "border_a": (0, 100),
    "edge_profile_width": (0, 100),
    "edge_profile_glow": (0, 100),
    "edge_profile_l": (0, 100),
    "edge_profile_c": (0, 37),
    "edge_profile_h": (0, 359),
    "bg_l": (0, 100),
    "bg_c": (0, 37),
    "bg_h": (0, 359),
    "field_relief": (0, 100),
    "field_color": (0, 100),
    "field_freq": (0, 100),
    "field_undulate_freq": (0, 100),
    "field_speed": (0, 200),
    "brightness": (0, 200),
    "field_displace": (0, 100),
    "mat_roughness": (0, 100),
    "mat_metalness": (0, 100),
    "mat_sheen": (0, 200),
    "mat_clearcoat": (0, 100),
    "mat_anisotropy": (0, 100),
    "mat_iridescence": (0, 100),
    "mat_emissive": (0, 200),
    "mat_relief": (0, 200),
    "ornament_style": (0, 4),
    "ornament_amount": (0, 100),
    "ornament_width": (0, 100),
    "ornament_density": (0, 100),
    "ornament_phase": (0, 100),
    "ornament_twist": (0, 100),
    "surface_contour_amount": (0, 100),
    "surface_contour_source": (0, 7),
    "surface_contour_spacing": (1, 64),
    "surface_contour_width": (1, 50),
    "surface_contour_phase": (0, 100),
    "surface_contour_l": (0, 100),
    "surface_contour_c": (0, 40),
    "surface_contour_h": (0, 360),
    "light_angle": (0, 360),
    "light_elevation": (0, 90),
    "light_intensity": (0, 200),
    "light_warmth": (0, 100),
    "light_ambient": (0, 100),
    "mat_sheen_color_r": (0, 100),
    "mat_sheen_color_g": (0, 100),
    "mat_sheen_color_b": (0, 100),
    "mat_irid_thick_min": (100, 800),
    "mat_irid_thick_max": (100, 800),
    "mat_rough_mod": (0, 100),
    "mat_metal_mod": (0, 100),
    "hyp_scale": (0, 100),
    "hyp_boost_x": (0, 100),
    "hyp_boost_y": (0, 100),
    "hyp_border_subdiv": (1, 32),
    "hyp_fill_subdiv": (1, 8),
}


def setting_int(settings: dict[str, object], key: str, default: int) -> int:
    value = settings.get(key, default)
    return int(value)


def check_settings_shape(settings: dict[str, object], context: str) -> None:
    for key, value in settings.items():
        expected = PREF_SCHEMA.get(key)
        if expected is None:
            raise SystemExit(f"{context}: unknown setting key {key}")
        if expected is float:
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise SystemExit(f"{context}: setting {key} must be numeric")
            continue
        if expected is int:
            if not isinstance(value, int) or isinstance(value, bool):
                raise SystemExit(f"{context}: setting {key} must be int")
            lo, hi = INT_RANGES.get(key, (-10**9, 10**9))
            if value < lo or value > hi:
                raise SystemExit(f"{context}: setting {key}={value} outside {lo}..{hi}")
            continue
        if not isinstance(value, expected):
            raise SystemExit(f"{context}: setting {key} must be {expected.__name__}")
        allowed = STRING_VALUES.get(key)
        if allowed is not None and value not in allowed:
            raise SystemExit(f"{context}: setting {key}={value} not in {sorted(allowed)}")


def exported_tile_count(item_id: str, family: int, seed: int, generation: int) -> int:
    COUNT_DIR.mkdir(parents=True, exist_ok=True)
    path = COUNT_DIR / f"{item_id}.ptg"
    subprocess.run(
        [
            "python3",
            str(EXPORTER),
            "--live",
            str(family),
            str(seed),
            str(generation),
            str(path),
        ],
        cwd=ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    magic, exported_family, exported_seed, exported_generation, tile_count = struct.unpack(
        "<4sIIII",
        path.read_bytes()[:20],
    )
    if magic != b"PTG1":
        raise SystemExit(f"{item_id}: generated geometry has bad magic")
    if (exported_family, exported_seed, exported_generation) != (family, seed, generation):
        raise SystemExit(f"{item_id}: generated geometry header does not match atlas settings")
    return tile_count


def regex_int(path: Path, pattern: str, context: str) -> int:
    match = re.search(pattern, path.read_text(encoding="utf-8"), re.S)
    if match is None:
        raise SystemExit(f"could not find {context} in {path}")
    return int(match.group(1))


def check_einstein_metadata_caps() -> None:
    expected = {11: 4, 12: 3, 18: 8}
    web_family_patterns = {
        11: r"'11':\s*\{.*?maxGeneration:\s*(\d+)",
        12: r"'12':\s*\{.*?maxGeneration:\s*(\d+)",
        18: r"'18':\s*\{.*?maxGeneration:\s*(\d+)",
    }
    native_patterns = {
        11: r"/\*\s*Hat\s*\*/\s*\{\s*(\d+)",
        12: r"/\*\s*Spectre\s*\*/\s*\{\s*(\d+)",
        18: r"/\*\s*D4Substitution\s*\*/\s*\{\s*(\d+)",
    }
    for family, max_gen in expected.items():
        if FAMILY_MAX_GEN.get(family) != max_gen:
            raise SystemExit(f"verify_atlas FAMILY_MAX_GEN[{family}]={FAMILY_MAX_GEN.get(family)} != {max_gen}")
        web_family = regex_int(WEB_FAMILIES, web_family_patterns[family], f"web family {family} maxGeneration")
        web_geometry = regex_int(
            WEB_GEOMETRY,
            rf"FAMILY_MAX_GENERATION_BY_ID[\s\S]*?\[{family},\s*(\d+)\]",
            f"web geometry {family} max generation",
        )
        native = regex_int(NATIVE_TILING, native_patterns[family], f"native family {family} maxGen")
        if web_family != max_gen or web_geometry != max_gen or native != max_gen:
            raise SystemExit(
                f"family {family}: max generation drift; expected {max_gen}, "
                f"web families={web_family}, web geometry={web_geometry}, native={native}"
            )


def main() -> None:
    check_einstein_metadata_caps()
    atlas = json.loads(ATLAS.read_text(encoding="utf-8"))
    categories = atlas.get("categories", [])
    if len(categories) != 10:
        raise SystemExit(f"expected 10 categories, found {len(categories)}")

    ids: set[str] = set()
    total_items = 0
    for category in categories:
        label = category["label"]
        defaults = category.get("defaults", {})
        check_settings_shape(defaults, f"{label}/defaults")
        items = category.get("items", [])
        if len(items) < 10:
            raise SystemExit(f"{label}: expected at least 10 items, found {len(items)}")
        for item in items:
            item_id = item["id"]
            if item_id in ids:
                raise SystemExit(f"duplicate item id: {item_id}")
            ids.add(item_id)
            check_settings_shape(item.get("settings", {}), item_id)
            settings = {**defaults, **item.get("settings", {})}
            family = setting_int(settings, "family", 0)
            seed = setting_int(settings, "seed", 0)
            generation = setting_int(settings, "generation", 0)
            if family not in FAMILY_MAX_SEED:
                raise SystemExit(f"{item_id}: bad family {family}")
            if seed < 0 or seed > FAMILY_MAX_SEED[family]:
                raise SystemExit(f"{item_id}: seed {seed} invalid for family {family}")
            max_gen = FAMILY_MAX_GEN.get(family, 8)
            if generation < 0 or generation > max_gen:
                raise SystemExit(f"{item_id}: generation {generation} exceeds {max_gen}")
            tile_count = exported_tile_count(item_id, family, seed, generation)
            if tile_count > MAX_INITIAL_TILES:
                raise SystemExit(
                    f"{item_id}: initial generation exports {tile_count} tiles; "
                    f"limit is {MAX_INITIAL_TILES}"
                )
            total_items += 1

    build_text = ANDROID_BUILD.read_text(encoding="utf-8")
    if "../../atlas" not in build_text:
        raise SystemExit("android build does not package atlas/")

    print(f"atlas ok: {len(categories)} categories, {total_items} targets")


if __name__ == "__main__":
    main()
