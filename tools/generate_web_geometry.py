#!/usr/bin/env python3
"""Generate browser geometry assets from the Android tiling atlas."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ATLAS = ROOT / "atlas" / "tiling_atlas.json"
OUT_DIR = ROOT / "web" / "public" / "generated" / "atlas"
EXPORTER_SRC = ROOT / "tools" / "export_tiling_geometry.cpp"
TILING_SRC = ROOT / "android" / "app" / "src" / "main" / "cpp" / "tiling" / "penrose.cpp"
TILING_HEADER = ROOT / "android" / "app" / "src" / "main" / "cpp" / "tiling" / "penrose.h"
CPP_INCLUDE = ROOT / "android" / "app" / "src" / "main" / "cpp"
EXPORTER_BIN = ROOT / ".cache" / "tiling_geometry_exporter"


def merged_settings(category: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    settings: dict[str, Any] = {}
    settings.update(category.get("defaults", {}))
    settings.update(item.get("settings", {}))
    return settings


def setting_int(settings: dict[str, Any], key: str, default: int) -> int:
    value = settings.get(key, default)
    return int(value)


def build_exporter() -> None:
    EXPORTER_BIN.parent.mkdir(parents=True, exist_ok=True)
    sources = [EXPORTER_SRC, TILING_SRC, TILING_HEADER]
    if EXPORTER_BIN.exists():
        bin_mtime = EXPORTER_BIN.stat().st_mtime
        if all(src.stat().st_mtime <= bin_mtime for src in sources):
            return

    subprocess.run(
        [
            "g++",
            "-std=c++20",
            "-O2",
            "-Wall",
            "-Wextra",
            "-I",
            str(CPP_INCLUDE),
            str(EXPORTER_SRC),
            str(TILING_SRC),
            "-o",
            str(EXPORTER_BIN),
        ],
        cwd=ROOT,
        check=True,
    )


def write_geometry(target_id: str, settings: dict[str, Any]) -> str:
    family = setting_int(settings, "family", 0)
    seed = setting_int(settings, "seed", 0)
    generation = setting_int(settings, "generation", 0)
    filename = f"{target_id}.ptg"
    output = OUT_DIR / filename
    subprocess.run(
        [
            str(EXPORTER_BIN),
            str(family),
            str(seed),
            str(generation),
            str(output),
        ],
        cwd=ROOT,
        check=True,
    )
    return filename


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    atlas = json.loads(ATLAS.read_text(encoding="utf-8"))
    categories = atlas.get("categories", [])
    targets = [
        (category, item, merged_settings(category, item))
        for category in categories
        for item in category.get("items", [])
    ]

    if args.dry_run:
        print(f"web geometry plan: {len(categories)} categories, {len(targets)} targets")
        return

    build_exporter()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.ptg"):
        old.unlink()

    manifest = {
        "version": atlas.get("version", 1),
        "updated": atlas.get("updated", ""),
        "categories": [],
    }

    for category in categories:
        out_category = {
            "id": category["id"],
            "label": category["label"],
            "sources": category.get("sources", []),
            "items": [],
        }
        for item in category.get("items", []):
            settings = merged_settings(category, item)
            geometry_file = write_geometry(item["id"], settings)
            out_category["items"].append(
                {
                    "id": item["id"],
                    "name": item["name"],
                    "settings": settings,
                    "geometry": geometry_file,
                    "bytes": os.path.getsize(OUT_DIR / geometry_file),
                }
            )
        manifest["categories"].append(out_category)

    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"web geometry generated: {len(categories)} categories, {len(targets)} targets")


if __name__ == "__main__":
    main()
