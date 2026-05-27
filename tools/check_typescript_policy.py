#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
TS_SUFFIXES = {".ts", ".tsx", ".mts", ".cts"}
SKIP_DIRS = {
    ".cache",
    ".git",
    ".local",
    "dist",
    "node_modules",
}
POLICIES = (
    ("no-any", re.compile(r"\bany\b")),
    ("no-unknown", re.compile(r"\bunknown\b")),
    ("no-as-cast", re.compile(r"\bas\b")),
)


def iter_ts_files() -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob("*"):
        if path.is_dir():
            continue
        if path.suffix not in TS_SUFFIXES:
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        files.append(path)
    return sorted(files)


def main() -> int:
    violations: list[str] = []
    for path in iter_ts_files():
        rel = path.relative_to(ROOT)
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            for name, pattern in POLICIES:
                if pattern.search(line):
                    violations.append(f"{rel}:{line_number}: {name}: {line.strip()}")
    if violations:
        sys.stderr.write("[typescript-policy] violations:\n")
        sys.stderr.write("\n".join(violations))
        sys.stderr.write("\n")
        return 1
    print(f"[typescript-policy] OK: scanned {len(iter_ts_files())} TypeScript file(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
