#!/usr/bin/env python3
"""Run clang-tidy for project sources and skip CMake FetchContent dependencies."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


SOURCE_SUFFIXES = {".c", ".cc", ".cpp", ".cxx", ".m", ".mm"}


def tidy_source(args: list[str]) -> str | None:
    for arg in args:
        if arg == "--":
            break
        path = Path(arg)
        if path.suffix.lower() in SOURCE_SUFFIXES:
            return arg.replace("\\", "/")
    return None


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: clang_tidy_project_filter.py <clang-tidy> [clang-tidy args...]", file=sys.stderr)
        return 2
    real_tidy = sys.argv[1]
    args = sys.argv[2:]
    source = tidy_source(args)
    if source is not None and "_deps" in Path(source).parts:
        return 0
    return subprocess.call([real_tidy, *args])


if __name__ == "__main__":
    raise SystemExit(main())
