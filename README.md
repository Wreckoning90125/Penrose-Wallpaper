# Penrose Wallpaper

Android live wallpaper with a Vulkan renderer, physical material controls, and
a Vite/Three WebGPU catalogue viewer that serves the same generated tiling
targets.

## Web

```bash
npm ci
npm run web:dev
```

`web:dev` generates compact browser geometry from the Android C++ tiling core
before starting the owned Vite server on port `5174`. A second local server can
run on `5274`:

```bash
npm run web:dev:alt
```

Production build and preview:

```bash
npm run web:build
npm run web:preview
```

Local quality gate:

```bash
npm run quality:local
```

That gate enforces no owned plain JavaScript files, TypeScript policy,
typecheck, atlas validation, render health probes, tiling verification,
shader validation, clang-tidy, and the WebGPU build.

Graph and renderer regression rules live in
[`docs/platform/control-graph-regressions.md`](docs/platform/control-graph-regressions.md).
The Three r184 TSL post-FX boundary is documented in
[`docs/render/tsl-post-fx-model.md`](docs/render/tsl-post-fx-model.md).

## Android

CI builds with Gradle 9.4.1, AGP 9.2.0, SDK 36, NDK 29, Vulkan 1.3 shader
targets, CodeQL, Android Lint, clang-tidy, shader validation, APK payload
verification, and dependency review.

Local release build:

```bash
cd android
gradle --no-daemon --stacktrace assembleRelease
```

The committed debug keystore signs CI artifacts for direct install. For a
personal release key, create `android/keystore.properties` outside source
control and wire its values into `android/app/build.gradle.kts` before building
the release variant.
