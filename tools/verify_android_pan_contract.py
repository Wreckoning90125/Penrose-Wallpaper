#!/usr/bin/env python3
"""Verify Android pan modes stay spatial, not generation-growth based."""

from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    print(f"[android-pan-contract] {message}", file=sys.stderr)
    raise SystemExit(1)


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def pan_entries() -> list[str]:
    tree = ET.parse(ROOT / "android/app/src/main/res/values/arrays.xml")
    for array in tree.getroot().findall("string-array"):
        if array.attrib.get("name") == "pan_mode_entries":
            return [item.text or "" for item in array.findall("item")]
    fail("pan_mode_entries is missing")


def main() -> None:
    entries = pan_entries()
    if entries != ["Locked", "Free pan", "Endless"]:
        fail(f"pan_mode_entries must be Locked/Free pan/Endless, got {entries}")

    renderer_cpp = text("android/app/src/main/cpp/renderer/renderer.cpp")
    renderer_h = text("android/app/src/main/cpp/renderer/renderer.h")
    renderer_geometry = text("android/app/src/main/cpp/renderer/renderer_geometry.cpp")
    graph_h = text("android/app/src/main/cpp/graph/graph.h")
    graph_cpp = text("android/app/src/main/cpp/graph/graph.cpp")
    graph_jni = text("android/app/src/main/cpp/graph/graph_jni.cpp")
    native_bridge = text("android/app/src/main/kotlin/com/penrose/wallpaper/NativeBridge.kt")
    service_kt = text("android/app/src/main/kotlin/com/penrose/wallpaper/PenroseWallpaperService.kt")
    settings_h = text("android/app/src/main/cpp/settings.h")

    touch_move = re.search(
        r"void Renderer::touchMove\(float dx, float dy\) \{(?P<body>.*?)\n\}",
        renderer_cpp,
        re.S,
    )
    if not touch_move:
        fail("Renderer::touchMove body not found")
    body = touch_move.group("body")
    if "considerGrowth" in body or "effectiveGeneration_" in body or "panAccumPx_" in body:
        fail("touchMove must not grow generation or accumulate growth distance")
    if "view_.panX" not in body or "view_.panY" not in body:
        fail("touchMove must update the persisted live pan transform")
    if "requestGeometryWindowRebuildForPan" not in body:
        fail("touchMove must request thresholded geometry-window rebuilds")
    if "rebuildGeometryForPan()" in body:
        fail("touchMove must not synchronously rebuild geometry on every move event")

    if "void Renderer::rebuildGeometryForPan()" not in renderer_cpp:
        fail("Renderer::rebuildGeometryForPan is missing")
    if "void Renderer::requestGeometryWindowRebuildForPan()" not in renderer_cpp:
        fail("Renderer::requestGeometryWindowRebuildForPan is missing")
    set_page = re.search(
        r"void Renderer::setPageOffset\(float xOffset, int xPixelOffset\) \{(?P<body>.*?)\n\}",
        renderer_cpp,
        re.S,
    )
    if not set_page:
        fail("Renderer::setPageOffset body not found")
    page_body = set_page.group("body")
    if "geometryPagePanX_" not in page_body or "geometryPagePanValid_" not in page_body:
        fail("Endless page pan must compare against the geometry window's last built xPixelOffset")
    if "rebuildThreshold" not in page_body or "std::abs(pagePanX_ - geometryPagePanX_)" not in page_body:
        fail("Endless page pan must threshold geometry rebuilds instead of rebuilding on every pixel offset")
    if "requestGeometryWindowRebuildForPan" not in page_body:
        fail("Endless page pan must use the shared thresholded geometry rebuild request")
    if "const float pagePanX = (settings_.panMode == 2) ? pagePanX_ : 0.0f;" not in renderer_cpp:
        fail("Endless page pan must remain a live view-transform input every frame")
    if "windowTilesForView" not in renderer_geometry:
        fail("renderer geometry must filter generated tiles through a viewport window")
    if "currentTiles_.size(), fullTiles.size()" not in renderer_geometry:
        fail("buildGeometry must track windowed tile count against full source count")
    if "pagePanX_" not in renderer_geometry:
        fail("windowed geometry must include launcher xPixelOffset page pan")
    if (
        "geometryViewPanX_ = view_.panX" not in renderer_geometry
        or "geometryViewPanY_ = view_.panY" not in renderer_geometry
        or "geometryPagePanX_ = pagePanX_" not in renderer_geometry
        or "geometryPagePanValid_ = true" not in renderer_geometry
    ):
        fail("successful geometry builds must record the view pan and xPixelOffset used for the active tile window")
    if "effectiveXPixelOffset" not in service_kt or "xPixelOffset == 0" not in service_kt or "xOffsetStep > 0f" not in service_kt:
        fail("Endless pan must derive a fallback pixel offset from xOffset when launchers report xPixelOffset=0")
    if "lightChoreoWantsLoop" not in service_kt or "lightChoreoAmount > 0f" not in service_kt:
        fail("Android choreographer must stay armed for clock/beat light choreography, not only ripple/audio/touch")
    if "graphNeedsFrameLoop" not in native_bridge or "graphNeedsFrameLoop" not in graph_jni:
        fail("Android must expose native graph frame-loop intent to Kotlin")
    if "needsFrameLoop" not in graph_h or "Graph::needsFrameLoop" not in graph_cpp:
        fail("native graph must report whether wired time/beat/page targets need continuous frames")
    if "graphWantsLoop" not in service_kt or "NativeBridge.graphNeedsFrameLoop(ptr)" not in service_kt:
        fail("Android choreographer must include native graph loop intent instead of only stored slider values")
    if "graphWantsLoop = false" not in service_kt:
        fail("Android service must clear graph loop intent when graph load/reset is unavailable or rejected")
    if "familyInfo(family).cls.ringChebyshev" not in renderer_geometry:
        fail("Android topology fields must use the same radial/Chebyshev tile-ring metric as web")
    if "maxTopologyX" not in renderer_geometry or "maxTopologyY" not in renderer_geometry or "maxTopologyR" not in renderer_geometry:
        fail("Android topology rings must normalize by active tile-centroid extents")
    if "* 0.12f" in renderer_geometry:
        fail("Android topology fields must not use an arbitrary world-scale radial multiplier")

    stale_tokens = [
        ("renderer.cpp", renderer_cpp),
        ("renderer.h", renderer_h),
        ("settings.h", settings_h),
    ]
    for name, content in stale_tokens:
        if "Generative" in content:
            fail(f"{name} still documents a Generative pan mode")
        if "bump" in content and "generation" in content:
            fail(f"{name} still describes generation-bumping pan")

    if "considerGrowth" in renderer_h:
        fail("Renderer should not expose considerGrowth for pan mode")

    print("[android-pan-contract] OK: Android pan mode is spatial, not generation-growth based")


if __name__ == "__main__":
    main()
