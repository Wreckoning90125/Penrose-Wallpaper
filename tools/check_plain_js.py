#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
JS_SUFFIXES = {".js", ".jsx", ".mjs", ".cjs"}
SKIP_DIRS = {
    ".cache",
    ".git",
    ".gradle",
    ".local",
    "build",
    "dist",
    "node_modules",
}


def owned_js_files() -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob("*"):
        if path.is_dir() or path.suffix not in JS_SUFFIXES:
            continue
        rel = path.relative_to(ROOT)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        files.append(rel)
    return sorted(files)


def main() -> int:
    violations = owned_js_files()
    if violations:
        sys.stderr.write("[plain-js-policy] JavaScript files are not part of the owned source tree:\n")
        sys.stderr.write("\n".join(str(path) for path in violations))
        sys.stderr.write("\n")
        return 1
    print("[plain-js-policy] OK: owned source tree has no plain JavaScript files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
