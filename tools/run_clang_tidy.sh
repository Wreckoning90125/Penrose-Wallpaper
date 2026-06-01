#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/.cache/clang-tidy.log"
CHECKS="bugprone-*,concurrency-*,cppcoreguidelines-pro-type-static-cast-downcast,performance-*,readability-misleading-indentation,-bugprone-easily-swappable-parameters,-bugprone-narrowing-conversions"
SOURCES=(
  "$ROOT/tools/export_tiling_geometry.cpp"
  "$ROOT/android/app/src/main/cpp/tiling/penrose.cpp"
)

mkdir -p "$ROOT/.cache"
: > "$LOG"

status=0
for source in "${SOURCES[@]}"; do
  rel="${source#"$ROOT"/}"
  echo "== $rel ==" | tee -a "$LOG"
  clang-tidy "$source" \
    --quiet \
    "-checks=$CHECKS" \
    -- \
    -std=c++20 \
    -I "$ROOT/android/app/src/main/cpp" \
    2>&1 | sed '/^[0-9][0-9]* warnings generated\.$/d' | tee -a "$LOG" || status=1
done

python3 "$ROOT/tools/static_analysis_ratchet.py" --clang-tidy-log "$LOG"
exit "$status"
