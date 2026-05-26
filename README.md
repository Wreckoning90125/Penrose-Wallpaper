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
before starting Vite. Production build:

```bash
npm run web:build
npm run web:preview
```

## Android

CI builds with Gradle 9.4.1, AGP 9.2.0, SDK 36, NDK 29, Vulkan 1.3 shader
targets, CodeQL, Android Lint, clang-tidy, shader validation, APK payload
verification, and dependency review.
