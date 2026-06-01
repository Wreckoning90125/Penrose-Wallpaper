#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHADER_DIR="$ROOT/android/app/src/main/shaders"
OUT_DIR="$ROOT/.cache/shader-validation"

mkdir -p "$OUT_DIR"

status=0
shopt -s nullglob
for shader in "$SHADER_DIR"/*.vert "$SHADER_DIR"/*.frag "$SHADER_DIR"/*.comp; do
  name="$(basename "$shader")"
  out="$OUT_DIR/$name.spv"
  echo "== $name =="
  if glslangValidator -V --target-env vulkan1.3 -I"$SHADER_DIR" "$shader" -o "$out"; then
    spirv-val "$out" || status=1
  else
    status=1
  fi
done

exit "$status"
