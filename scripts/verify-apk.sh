#!/usr/bin/env bash
# =============================================================================
# Post-build verification of the Penrose release APK.
#
# Runs in CI after the build job publishes the APK artifact; also runnable
# locally:
#     scripts/verify-apk.sh path/to/penrose.apk
#
# Every check is gating — a failure exits non-zero so a broken APK turns
# CI red instead of reaching a device. The checks inspect the artifact the
# toolchain actually emitted, which the source-level build cannot:
#
#   1. Signature      — apksigner verifies the APK.
#   2. Manifest       — package id, min/target SDK, the wallpaper + audio
#                       services, the live-wallpaper and Vulkan features,
#                       the media foreground-service permission.
#   3. Payload        — libpenrose.so for every shipped ABI, the four
#                       compiled SPIR-V shader blobs, every bundled preset.
#   4. Shader blobs   — each .spv begins with the SPIR-V magic word.
#   5. JNI linkage    — every `external fun` declared in NativeBridge.kt
#                       has a matching Java_* symbol exported by
#                       libpenrose.so. A missing one is an
#                       UnsatisfiedLinkError that would crash the app the
#                       first time Kotlin calls into native code.
# =============================================================================
set -euo pipefail

APK="${1:-}"
if [ -z "$APK" ] || [ ! -f "$APK" ]; then
    echo "usage: verify-apk.sh <path-to-apk>" >&2
    exit 2
fi
APK="$(cd "$(dirname "$APK")" && pwd)/$(basename "$APK")"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fails=0
ok()  { printf '  ok    %s\n' "$*"; }
bad() { printf '  FAIL  %s\n' "$*"; fails=$((fails + 1)); }

echo "== penrose APK verification =="
echo "  apk   $APK"
echo "  size  $(stat -c%s "$APK") bytes"

# ---- locate SDK tools -------------------------------------------------------
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
find_tool() {
    local p
    p="$(command -v "$1" 2>/dev/null || true)"
    if [ -z "$p" ] && [ -n "$SDK" ]; then
        p="$(ls "$SDK"/build-tools/*/"$1" 2>/dev/null | sort -V | tail -1 || true)"
    fi
    echo "$p"
}
AAPT2="$(find_tool aapt2)"
APKSIGNER="$(find_tool apksigner)"

# ---- 1. signature -----------------------------------------------------------
echo "-- signature"
if [ -z "$APKSIGNER" ]; then
    bad "apksigner not found (set ANDROID_HOME)"
elif "$APKSIGNER" verify "$APK" >/dev/null 2>&1; then
    ok "apksigner verify"
else
    bad "apksigner verify"
fi

# ---- 2. manifest ------------------------------------------------------------
echo "-- manifest"
if [ -z "$AAPT2" ]; then
    bad "aapt2 not found (set ANDROID_HOME)"
else
    badging="$("$AAPT2" dump badging "$APK" 2>/dev/null || true)"
    xmltree="$("$AAPT2" dump xmltree --file AndroidManifest.xml "$APK" 2>/dev/null || true)"
    has_badging()    { grep -qF -- "$1" <<<"$badging" && ok "$2" || bad "$2 ($1)"; }
    has_badging_re() { grep -qE -- "$1" <<<"$badging" && ok "$2" || bad "$2 (/$1/)"; }
    has_xml()        { grep -qF -- "$1" <<<"$xmltree" && ok "$2" || bad "$2 ($1)"; }
    has_badging    "package: name='com.penrose.wallpaper'"              "package id"
    # aapt2 labels the min-SDK line 'minSdkVersion' on current build-tools
    # and 'sdkVersion' on older ones — accept either.
    has_badging_re "(minSdkVersion|sdkVersion):'36'"                    "minSdk 36"
    has_badging    "targetSdkVersion:'36'"                              "targetSdk 36"
    has_badging "uses-feature: name='android.software.live_wallpaper'"  "live-wallpaper feature"
    has_badging "uses-feature: name='android.hardware.vulkan.version'"  "Vulkan feature"
    has_badging "uses-permission: name='android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'" \
                                                                        "media FGS permission"
    has_xml "com.penrose.wallpaper.PenroseWallpaperService"             "wallpaper service"
    has_xml "com.penrose.wallpaper.audio.AudioPlaybackService"          "audio service"
fi

# ---- 3. payload -------------------------------------------------------------
echo "-- payload"
unzip -Z1 "$APK" > "$WORK/entries.txt"
has_entry() { grep -qxF -- "$1" "$WORK/entries.txt" && ok "$1" || bad "missing $1"; }
for abi in arm64-v8a x86_64; do
    has_entry "lib/$abi/libpenrose.so"
done
shaders="fill.vert fill.frag border.vert border.frag"
for s in $shaders; do
    has_entry "assets/shaders/$s.spv"
done
for p in "$REPO_ROOT"/android/app/src/main/assets/presets/*.json; do
    has_entry "assets/presets/$(basename "$p")"
done

# ---- 4. shader blobs --------------------------------------------------------
echo "-- shader blobs"
for s in $shaders; do
    if unzip -p "$APK" "assets/shaders/$s.spv" > "$WORK/$s.spv" 2>/dev/null \
       && [ -s "$WORK/$s.spv" ]; then
        # SPIR-V magic 0x07230203, little-endian on disk = 03 02 23 07.
        magic="$(od -An -tx1 -N4 "$WORK/$s.spv" | tr -s ' ' | sed 's/^ //;s/ $//')"
        if [ "$magic" = "03 02 23 07" ]; then
            ok "$s.spv (SPIR-V)"
        else
            bad "$s.spv bad magic [$magic]"
        fi
    else
        bad "$s.spv unreadable or empty"
    fi
done

# ---- 5. JNI linkage ---------------------------------------------------------
echo "-- JNI symbols"
NB="$REPO_ROOT/android/app/src/main/kotlin/com/penrose/wallpaper/NativeBridge.kt"
so="$WORK/libpenrose.so"
if [ ! -f "$NB" ]; then
    bad "NativeBridge.kt not found at $NB"
elif ! unzip -p "$APK" "lib/arm64-v8a/libpenrose.so" > "$so" 2>/dev/null || [ ! -s "$so" ]; then
    bad "libpenrose.so (arm64-v8a) not extractable from the APK"
else
    exported="$(nm -D --defined-only "$so" 2>/dev/null | awk '{print $NF}' || true)"
    mapfile -t funcs < <(grep -oE 'external fun [A-Za-z0-9]+' "$NB" | awk '{print $3}')
    if [ "${#funcs[@]}" -eq 0 ]; then
        bad "no 'external fun' declarations parsed from NativeBridge.kt"
    fi
    for fn in "${funcs[@]}"; do
        # NativeBridge method names are camelCase with no underscores, so
        # the JNI symbol is the plain Java_<class>_<method> short form.
        sym="Java_com_penrose_wallpaper_NativeBridge_$fn"
        if grep -qxF -- "$sym" <<<"$exported"; then
            ok "$fn"
        else
            bad "JNI symbol absent: $sym (declared 'external fun $fn')"
        fi
    done
fi

# ---- result -----------------------------------------------------------------
echo
if [ "$fails" -ne 0 ]; then
    echo "RESULT: $fails check(s) FAILED"
    exit 1
fi
echo "RESULT: all APK checks passed"
