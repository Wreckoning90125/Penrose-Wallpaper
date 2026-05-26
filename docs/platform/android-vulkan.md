# Android / Vulkan platform notes

Checked: 2026-05-26.

This repo is pinned to a current AGP/NDK/API lane, and the details are easy to
forget because they live across Gradle, CMake, shader compilation, GitHub
Actions, and Vulkan runtime code. Use this file as the refresh checklist before
changing `android/gradle/libs.versions.toml`, `android/app/build.gradle.kts`,
or the renderer pipeline.

## Current pins

| Item | Repo value | Where |
|------|------------|-------|
| Android Gradle Plugin | `9.2.0` | `android/gradle/libs.versions.toml` |
| Gradle in CI | `9.4.1` | `.github/workflows/android.yml`, `.github/workflows/codeql.yml` |
| NDK | `29.0.14206865` | `android/gradle/libs.versions.toml`, CI SDK install |
| compile/target/min SDK | `36` | `android/gradle/libs.versions.toml` |
| CMake | `3.22.1` | `android/app/build.gradle.kts`, CI SDK install |
| JVM bytecode target | `17` | `android/app/build.gradle.kts` |
| Shader target env | `vulkan1.3` | `android/app/build.gradle.kts` |

## What matters

- AGP 9.2 supports max API level 36.1 and lists Gradle 9.4.1, SDK Build Tools
  36.0.0, default NDK 28.2.13676358, and JDK 17 in its compatibility table.
  The repo intentionally overrides the default NDK to r29.
- NDK r29 (`29.0.14206865`) is the pinned stable NDK. Android's NDK page also
  lists r27d (`27.3.13750724`) as the latest LTS, which is useful if r29
  regresses device Vulkan behavior.
- AGP 9 has built-in Kotlin. Do not re-add `org.jetbrains.kotlin.android`;
  the module uses AGP's built-in Kotlin support and the `kotlin {}` compiler
  options block.
- Target SDK 36 means Android 16 behavior changes matter, especially
  edge-to-edge enforcement, predictive back behavior, and large-screen
  orientation/resizability rules.
- Vulkan shader compilation is ahead-of-time. The repo compiles GLSL to SPIR-V
  with NDK `shader-tools/.../glslc`, then packages `assets/shaders/*.spv`.
  NDK Shaderc is a release-time snapshot, so run `glslc --help` from the
  pinned NDK before assuming a newer target env or flag is supported.
- The renderer currently targets Vulkan 1.3 SPIR-V even if runtime Vulkan
  negotiation on a device can expose newer Vulkan versions.
- The border pipeline deliberately pads `BorderVertex` to 32 bytes. Do not
  shrink it back to 20 bytes without retesting on mobile Vulkan drivers.
- The Android build workflow and CodeQL workflow both need `security-events:
  write` for SARIF/code-scanning upload. Fork PRs can still warn; the Android
  workflow keeps SARIF upload `continue-on-error: true`.

## Official update sources

Check these pages when bumping versions or debugging platform behavior:

- Android Gradle Plugin release notes:
  https://developer.android.com/build/releases/gradle-plugin
- AGP built-in Kotlin migration:
  https://developer.android.com/build/migrate-to-built-in-kotlin
- Android NDK downloads and revision history:
  https://developer.android.com/ndk/downloads
- Android 16 behavior changes for target SDK 36:
  https://developer.android.com/about/versions/16/behavior-changes-16
- Android Vulkan getting started:
  https://developer.android.com/ndk/guides/graphics/getting-started
- Android Vulkan shader compilers and `glslc`:
  https://developer.android.com/ndk/guides/graphics/shader-compilers
- Khronos Vulkan specification:
  https://docs.vulkan.org/spec/latest/index.html
- Khronos Vulkan Guide, especially layers, vertex input, synchronization,
  shader layout, and pipeline cache:
  https://github.khronos.org/Vulkan-Site/guide/latest/

## Local refresh checklist

1. Compare AGP, Gradle, SDK Build Tools, JDK, and default NDK against the AGP
   compatibility table.
2. Check whether the pinned NDK still matches the intended stable/LTS tradeoff.
3. Run the shader task or Android build with the pinned NDK and confirm `glslc`
   accepts the configured `--target-env`.
4. Recheck Android 16/API 36 behavior notes when changing target SDK,
   Activity/window handling, back navigation, or large-screen behavior.
5. If touching Vulkan vertex layouts, preserve explicit `offsetof(...)`
   attribute offsets and retest any non-vec4-multiple stride on device before
   merging.
6. If CI logs show `Resource not accessible by integration`, inspect workflow
   `permissions:` first, then check whether the run came from a fork PR.
