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

The aggregate gate runs `quality:web`, `quality:native`, and `quality:android`.
Those cover:

- `js:policy`: rejects owned `.js`, `.jsx`, `.mjs`, and `.cjs` files.
- `ts:policy`: rejects `any`, `unknown`, and `as` in owned TypeScript.
- `typecheck`: `tsc --noEmit`.
- `atlas:verify`: validates `atlas/tiling_atlas.json`.
- `border:verify`: proves the per-tile border rings stay inside their tiles and
  remain single-coverage across the supported join controls.
- `tilings:verify`: compiles and runs the host tiling verifier.
- `shaders:validate`: compiles GLSL to SPIR-V and runs `spirv-val`.
- `cpp:tidy`: runs clang-tidy through the native tiling/export sources.
- `web:build`: builds the Three WebGPU app.
- `graph:contract`: checks graph schema wiring and renderer contract invariants.

## Android from WSL2

The WSL2 side is responsible for fast validation:

```bash
java -version
clang-tidy --version
glslangValidator --version
spirv-val --version
npm run quality:local
```

When the Android SDK is visible in WSL2, build the installable release APK
with the committed wrapper (pinned to Gradle 9.4.1 with a verified
`distributionSha256Sum`, so no local Gradle install is needed):

```bash
cd android
./gradlew --no-daemon --stacktrace assembleRelease
```

The Windows SDK install can remain the device-build authority.

> Footnote: a standalone Gradle 9.4.1 install still works
> (`gradle --no-daemon --stacktrace assembleRelease` from `android/`), and is
> what CI provisions via `gradle/actions/setup-gradle`. The wrapper is the
> preferred local entry point.

## Release signing

Release builds sign with a personal key when `android/keystore.properties`
exists, and fall back to the committed debug keystore when it does not — so
CI and fresh clones build exactly as before, with zero signing secrets.

Generate the keystore once (any machine with a JDK), outside the repository:

```bash
keytool -genkey -v \
  -keystore "$HOME/.android/penrose-release.keystore" \
  -alias penrose -keyalg RSA -keysize 2048 -validity 10000
```

**This key is the app's permanent identity.** Android updates install only when
signed by the same key: lose it and existing installs can never be updated;
leak it and anyone can impersonate the app. Back it up somewhere safe, never
commit it, and do not reuse a key from another app.

Then create `android/keystore.properties` (git-ignored; a relative `storeFile`
resolves against `android/`, but an absolute path outside the repo is
recommended):

```properties
storeFile=/home/<you>/.android/penrose-release.keystore
storePassword=<store password>
keyAlias=penrose
keyPassword=<key password>
```

Gradle picks the file up automatically for the release variant:

```bash
cd android
./gradlew --no-daemon --stacktrace assembleRelease
```

Verify the signature on the produced APK before distributing it:

```bash
apksigner verify --print-certs \
  android/app/build/outputs/apk/release/app-release.apk
```

`apksigner` ships in the SDK's `build-tools/<version>/`. The certificate DN
and digests should match your release key, not the debug keystore's
`androiddebugkey`.

### Release: local-sign-and-upload

This is a public repository, so CI never signs with a release key and carries
no signing secrets by design; its `assembleRelease` artifacts stay debug-signed
sideload builds. A real release is produced locally:

1. Build the signed APK with `assembleRelease` (keystore.properties present).
2. Verify it with `apksigner verify --print-certs`.
3. Tag and attach it to a GitHub release with a lightweight tag:

```bash
git tag v0.1.0
git push origin v0.1.0
gh release create v0.1.0 android/app/build/outputs/apk/release/app-release.apk
```
