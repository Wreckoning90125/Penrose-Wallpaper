#!/usr/bin/env bash
# Compile the full native renderer library with the same NDK toolchain CI uses.
#
# This is the local stand-in for CI's assembleDebug native step: it configures
# android/app/src/main/cpp directly against the NDK's CMake toolchain (no
# Gradle, no Android SDK) and ninja-builds libpenrose.so for one ABI. Any
# compile error CI's buildCMakeDebug task would hit shows up here first.
#
# The build directory is kept under .cache/ so reruns are incremental —
# a no-op check takes about a second.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NDK_VERSION="29.0.14206865" # keep in sync with .github/workflows/android.yml + libs.versions.toml

candidates=(
    "${ANDROID_NDK_HOME:-}"
    "$HOME/.local/share/android-ndk/android-ndk-r29"
    "$HOME/Android/Sdk/ndk/$NDK_VERSION"
    "/usr/local/lib/android/sdk/ndk/$NDK_VERSION"
)
NDK=""
for c in "${candidates[@]}"; do
    if [[ -n "$c" && -f "$c/build/cmake/android.toolchain.cmake" ]]; then
        NDK="$c"
        break
    fi
done
if [[ -z "$NDK" ]]; then
    echo "error: Android NDK with CMake toolchain not found." >&2
    echo "Fix: set ANDROID_NDK_HOME, or download the Linux NDK CI pins:" >&2
    echo "  curl -L -o /tmp/ndk.zip https://dl.google.com/android/repository/android-ndk-r29-linux.zip" >&2
    echo "  mkdir -p ~/.local/share/android-ndk && unzip -q /tmp/ndk.zip -d ~/.local/share/android-ndk" >&2
    exit 1
fi

found_version="$(sed -n 's/^Pkg\.Revision = //p' "$NDK/source.properties" 2>/dev/null || true)"
if [[ "$found_version" != "$NDK_VERSION" ]]; then
    echo "warning: local NDK is $found_version, CI pins $NDK_VERSION — diagnostics may drift" >&2
fi

# With PENROSE_TIDY=1, mirror CI's clang-tidy job as well: build with
# -DPENROSE_TIDY=ON using the NDK's clang-tidy, capture the diagnostics, and
# enforce the same static-analysis budget (tools/static_analysis_ratchet.py)
# that CI's "Enforce total static-analysis budget" step applies.
TIDY="${PENROSE_TIDY:-0}"
ABI="${PENROSE_NATIVE_ABI:-arm64-v8a}"
SUFFIX=""
EXTRA_ARGS=()
if [[ "$TIDY" == "1" ]]; then
    SUFFIX="-tidy"
    EXTRA_ARGS+=(-DPENROSE_TIDY=ON)
    export PATH="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin:$PATH"
fi
BUILD_DIR="$ROOT/.cache/native-build/$ABI$SUFFIX"
CONFIGURE_LOG="$ROOT/.cache/native-build/configure-$ABI$SUFFIX.log"
TIDY_LOG="$ROOT/.cache/native-build/clang-tidy-$ABI.log"
mkdir -p "$ROOT/.cache/native-build"

# Mirror the externalNativeBuild arguments in android/app/build.gradle.kts.
if ! cmake -S "$ROOT/android/app/src/main/cpp" -B "$BUILD_DIR" -G Ninja \
    -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI="$ABI" \
    -DANDROID_PLATFORM=latest \
    -DANDROID_STL=c++_static \
    -DCMAKE_BUILD_TYPE=Debug \
    "${EXTRA_ARGS[@]}" \
    > "$CONFIGURE_LOG" 2>&1; then
    cat "$CONFIGURE_LOG" >&2
    echo "error: CMake configure failed (log: $CONFIGURE_LOG)" >&2
    exit 1
fi

if [[ "$TIDY" == "1" ]]; then
    # Incremental runs only re-tidy files ninja rebuilds. That is sound while
    # every prior run passed (unchanged files are already proven clean), but
    # after a failure the flagged file compiles anyway and would be skipped on
    # the next run — so a missing success marker forces a full rebuild.
    MARKER="$BUILD_DIR/.tidy-clean"
    CLEAN_ARG=()
    [[ -f "$MARKER" ]] || CLEAN_ARG=(--clean-first)
    rm -f "$MARKER"
    cmake --build "$BUILD_DIR" "${CLEAN_ARG[@]}" 2>&1 | tee "$TIDY_LOG"
    python3 "$ROOT/tools/static_analysis_ratchet.py" --clang-tidy-log "$TIDY_LOG"
    touch "$MARKER"
else
    cmake --build "$BUILD_DIR"
fi
echo "native build OK: $ABI$SUFFIX (NDK $found_version)"
