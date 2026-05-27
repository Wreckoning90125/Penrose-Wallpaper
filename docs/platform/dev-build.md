# Development and build commands

## WebGPU preview

```bash
npm ci
npm run web:dev
```

`web:dev` starts the owned Vite server on `0.0.0.0:5174`. It exits cleanly if
that server is already running for this repo. Use the alternate port when two
instances are useful:

```bash
npm run web:dev:alt
```

Production build and preview:

```bash
npm run web:build
npm run web:preview
```

## Local quality gate

```bash
npm run quality:local
```

The gate runs:

- `js:policy`: rejects owned `.js`, `.jsx`, `.mjs`, and `.cjs` files.
- `ts:policy`: rejects `any`, `unknown`, and `as` in owned TypeScript.
- `typecheck`: `tsc --noEmit`.
- `atlas:verify`: validates `atlas/tiling_atlas.json`.
- `tilings:verify`: compiles and runs the host tiling verifier.
- `shaders:validate`: compiles GLSL to SPIR-V and runs `spirv-val`.
- `cpp:tidy`: runs clang-tidy through the native tiling/export sources.
- `web:build`: builds the Three WebGPU app.

## Android from WSL2

The WSL2 side is responsible for fast validation:

```bash
java -version
clang-tidy --version
glslangValidator --version
spirv-val --version
npm run quality:local
```

When the Android SDK is visible in WSL2, build the installable release APK:

```bash
cd android
gradle --no-daemon --stacktrace assembleRelease
```

The Windows SDK install can remain the device-build authority. Keep the signing
key outside the repository, then point a local `android/keystore.properties` at
that key before making a personally signed release artifact.
