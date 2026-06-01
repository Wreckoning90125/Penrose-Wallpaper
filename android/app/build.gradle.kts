import org.gradle.api.DefaultTask
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.gradle.process.ExecOperations
import java.io.File
import javax.inject.Inject

plugins {
    // AGP 9 ships Kotlin support built-in; the org.jetbrains.kotlin.android
    // plugin is no longer applied separately. See:
    // https://developer.android.com/build/migrate-to-built-in-kotlin
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.penrose.wallpaper"
    compileSdk = libs.versions.compileSdk.get().toInt()
    ndkVersion = libs.versions.ndk.get()

    defaultConfig {
        applicationId = "com.penrose.wallpaper"
        minSdk = libs.versions.minSdk.get().toInt()
        targetSdk = libs.versions.targetSdk.get().toInt()
        versionCode = 1
        versionName = "0.1.0"

        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }

        externalNativeBuild {
            cmake {
                arguments += listOf(
                    "-DANDROID_STL=c++_static",
                    "-DANDROID_PLATFORM=latest",
                )
                if (project.findProperty("penroseTidy")?.toString() == "true") {
                    arguments += "-DPENROSE_TIDY=ON"
                }
                cppFlags += "-std=c++20"
            }
        }
    }

    buildFeatures {
        buildConfig = false
    }

    // Android Lint runs Google's manifest, resource, Kotlin, and security
    // checks. CI also ratchets the SARIF report through
    // ci/static_analysis_baseline.json, so critical findings stay at zero
    // and noncritical findings must keep moving down.
    //
    // No `baseline` file: Lint's baseline workflow CREATES the file
    // on first run and ABORTS the build asking you to re-run, which
    // is fine for desktop but breaks every clean CI. If we ever want
    // baselining, generate it locally with
    //     gradle lintRelease -Dlint.baselines.continue=true
    // and check the resulting `lint-baseline.xml` into source control.
    lint {
        abortOnError = true
        warningsAsErrors = false
        checkReleaseBuilds = true
        sarifReport = true
        htmlReport = true
        ignoreTestSources = true
        // Suppress the bogus OldTargetApi warning — targetSdk=36 (the
        // current target API level) is being flagged because Lint's
        // bundled API metadata in AGP 9.2 doesn't recognise API 36 as
        // the latest yet. Re-enable when AGP catches up. Keeping this
        // here documents the suppression rather than burying it in a
        // baseline file.
        disable.add("OldTargetApi")
        // Resource shrinking needs R8 keep-rule work for JNI names first;
        // keep the explicit release-build choice out of code-scanning noise.
        disable.add("NotShrinkingResources")
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    androidResources {
        noCompress.add("spv")
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(layout.projectDirectory.dir("../../atlas").asFile)
        }
    }

    // A debug keystore is checked into the repo at app/debug.keystore. The
    // standard Android debug keystore password ("android") is universal and
    // not a security boundary — committing it just keeps the signing identity
    // stable across CI runs so a re-installed APK doesn't trip Android's
    // "uninstall first" guard. This is NOT suitable for Play Store releases.
    signingConfigs {
        // `debug` is an AGP-built-in config; override its file location and
        // pin the well-known passwords so CI doesn't depend on ~/.android/.
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            isDebuggable = true
            signingConfig = signingConfigs.getByName("debug")

            // Native sanitizers — debug only. UBSan is cheap (a few %
            // overhead) and catches signed-overflow, null-deref,
            // shift-out-of-range, function-pointer-cast mismatches.
            // HWAddressSanitizer is Google's recommended aarch64
            // sanitizer (lower overhead than ASan, catches linear AND
            // non-linear OOB + use-after-free); the AGP knob
            // ANDROID_SANITIZE=hwaddress wires both the clang flag and
            // the wrap.sh runtime setup. Caller flips
            // `-PpenroseSanitize=hwaddress|address|undefined|off` from
            // the gradle CLI; default `undefined` because HWASan needs
            // a userdebug or fully-debuggable build to attach the
            // wrap.sh path and not every CI runner has that.
            val sanitizer = project.findProperty("penroseSanitize")?.toString() ?: "undefined"
            if (sanitizer != "off") {
                externalNativeBuild {
                    cmake {
                        // ANDROID_SANITIZE is the AGP-blessed knob; clang
                        // flags + linker flags + libclang_rt are all
                        // wired automatically. `undefined` enables UBSan;
                        // `hwaddress` enables HWASan; `address` enables
                        // ASan (use only when you actually need it —
                        // ~2x memory).
                        arguments += "-DANDROID_SANITIZE=$sanitizer"
                    }
                }
            }
        }
        release {
            // Keep R8 off for now — we don't have keep-rules for the JNI
            // surface yet and shrinking would silently rename `external fun`
            // entry points, breaking the C++ lookup.
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("debug")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.preference.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.material)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.common)
    implementation(libs.media3.session)
}

// -----------------------------------------------------------------------------
// SPIR-V compilation. We invoke glslc from the NDK shader-tools to convert
// src/main/shaders/*.{vert,frag} into assets/shaders/*.spv at build time.
// Implemented as a proper typed task so the configuration cache (default-on
// in Gradle 9) accepts it: no Project references at execution time, all
// process invocation goes through the injected ExecOperations.
// -----------------------------------------------------------------------------
abstract class CompileShadersTask @Inject constructor(
    private val execOps: ExecOperations
) : DefaultTask() {

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sources: ConfigurableFileCollection

    // Header files (*.glsl) pulled in via #include from the shaders above.
    // They are not compiled standalone, but editing one must invalidate
    // every dependent .vert/.frag — declaring them as a separate
    // @InputFiles collection lets Gradle track their content without
    // feeding them to glslc.
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val headers: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Internal
    abstract val sourceRoot: DirectoryProperty

    @get:Internal
    abstract val glslcPath: Property<String>

    @get:Internal
    abstract val targetEnv: Property<String>

    @TaskAction
    fun run() {
        val glslc = File(glslcPath.get())
        if (!glslc.exists()) {
            error("glslc not found at $glslc — check ndkVersion in libs.versions.toml")
        }
        val root = sourceRoot.get().asFile
        // AGP assigns outputDir via the Variant API's wiredWith hook and merges
        // its contents into the APK's assets root. Nesting under "shaders/"
        // keeps runtime paths like "shaders/tile.vert.spv" intact.
        val out = File(outputDir.get().asFile, "shaders")
        out.mkdirs()
        sources.forEach { src ->
            val rel = src.relativeTo(root).path
            val dst = File(out, "$rel.spv")
            dst.parentFile.mkdirs()
            execOps.exec {
                commandLine(
                    glslc.absolutePath,
                    "--target-env=${targetEnv.get()}",
                    "-O",
                    "-o", dst.absolutePath,
                    src.absolutePath,
                )
            }
        }
    }
}

val shaderSrcDir = layout.projectDirectory.dir("src/main/shaders")

// Locate the NDK pinned in libs.versions.toml. We deliberately check the
// version-pinned path under ${ANDROID_SDK_ROOT}/ndk/<version> *before* the
// ANDROID_NDK_HOME / ANDROID_NDK_ROOT env vars, because the GitHub Actions
// ubuntu-latest image preinstalls an older NDK (e.g. 27.x) and exports it
// via those env vars. Without this ordering, glslc gets pulled from the wrong
// NDK and rejects newer flags like `--target-env=vulkan1.4`.
fun resolveNdkPath(): String {
    val pinned = libs.versions.ndk.get()
    val sdkRoot = System.getenv("ANDROID_SDK_ROOT") ?: System.getenv("ANDROID_HOME")
    if (sdkRoot != null) {
        val candidate = File(sdkRoot, "ndk/$pinned")
        if (candidate.isDirectory) return candidate.absolutePath
    }
    System.getenv("ANDROID_NDK_HOME")?.let { if (File(it).isDirectory) return it }
    System.getenv("ANDROID_NDK_ROOT")?.let { if (File(it).isDirectory) return it }
    error("Cannot locate Android NDK $pinned. Install via `sdkmanager ndk;$pinned` or set ANDROID_NDK_HOME.")
}

fun glslcExecutable(): String {
    val osName = System.getProperty("os.name").lowercase()
    val hostTag = when {
        osName.contains("linux")   -> "linux-x86_64"
        osName.contains("mac")     -> "darwin-x86_64"
        osName.contains("windows") -> "windows-x86_64"
        else -> error("Unsupported host OS: $osName")
    }
    val glslcName = if (osName.contains("windows")) "glslc.exe" else "glslc"
    return File(resolveNdkPath(), "shader-tools/$hostTag/$glslcName").absolutePath
}

androidComponents {
    onVariants { variant ->
        val taskName = "compile${variant.name.replaceFirstChar { it.uppercase() }}Shaders"
        val compileShaders = tasks.register<CompileShadersTask>(taskName) {
            group = "build"
            description = "Compile GLSL shaders to SPIR-V via glslc for ${variant.name}."

            sourceRoot.set(shaderSrcDir)
            sources.from(
                shaderSrcDir.asFileTree.matching {
                    include("**/*.vert", "**/*.frag", "**/*.comp")
                }
            )
            headers.from(
                shaderSrcDir.asFileTree.matching {
                    include("**/*.glsl")
                }
            )
            // SPIR-V target env. NDK 29's bundled glslc/shaderc snapshot
            // predates Vulkan 1.4 support, so the only accepted Vulkan values
            // top out at vulkan1.3. The runtime still negotiates Vulkan 1.4 on
            // the C++ side — this only gates which SPIR-V capabilities glslc
            // will emit, and our shaders use nothing past 1.3-level features.
            targetEnv.set("vulkan1.3")
            glslcPath.set(glslcExecutable())
        }
        variant.sources.assets?.addGeneratedSourceDirectory(
            compileShaders,
            CompileShadersTask::outputDir,
        )
    }
}
