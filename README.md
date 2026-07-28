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

That gate composes the web, native, and Android gates: no owned plain JavaScript
files, TypeScript policy, typecheck, atlas validation, border-join verification, tiling
verification, shader validation, clang-tidy, the WebGPU build, and the
graph/render contract.

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

The committed debug keystore signs CI artifacts for direct install. A personal
release uses either a complete `PENROSE_RELEASE_*` runtime environment or an
ignored `android/keystore.properties`; environment input takes precedence.
Gradle falls back to the debug keystore when neither is present. CI never
signs with a release key and carries no signing secrets by design — this is a
public repository. Releases are local-sign-and-upload: build and verify the
signed APK locally, then attach it to a GitHub release. See
[`docs/platform/dev-build.md`](docs/platform/dev-build.md) for the keystore
recipe, verification, and upload flow.
