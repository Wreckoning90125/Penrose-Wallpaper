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
                    "-DANDROID_PLATFORM=android-36",
                )
                cppFlags += "-std=c++20"
            }
        }
    }

    buildFeatures {
        buildConfig = false
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

    sourceSets {
        getByName("main") {
            // Generated SPIR-V is staged under build/generated/shaders/shaders/*.spv;
            // mounting the parent as an asset srcDir gives runtime paths of
            // "shaders/tile.vert.spv" etc, which is what the C++ side opens.
            assets.srcDirs(layout.buildDirectory.dir("generated/shaders"))
        }
    }

    packaging {
        // SPIR-V blobs ship as raw assets; do not let aapt try to compress them.
        jniLibs.useLegacyPackaging = false
    }

    androidResources {
        noCompress.add("spv")
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

// AGP 9 removed the legacy `kotlinOptions { jvmTarget = "..." }` block in favour
// of the kotlin-gradle-plugin's own DSL. The bytecode target stays at 17 — that's
// where Android's runtime support stops without desugaring tricks. Gradle itself
// runs on JDK 25 (latest LTS) per the CI workflow; only the *emitted* bytecode
// is pinned here.
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.preference.ktx)
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
        val out = outputDir.get().asFile
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
val shaderOutDir = layout.buildDirectory.dir("generated/shaders/shaders")

// Locate the NDK via environment vars instead of AGP internals. Both CI and
// Android Studio set one of these; if not, we fall back to the canonical
// `${ANDROID_SDK_ROOT}/ndk/${ndkVersion}` path.
fun resolveNdkPath(): String {
    System.getenv("ANDROID_NDK_HOME")?.let { if (File(it).isDirectory) return it }
    System.getenv("ANDROID_NDK_ROOT")?.let { if (File(it).isDirectory) return it }
    val sdkRoot = System.getenv("ANDROID_SDK_ROOT") ?: System.getenv("ANDROID_HOME")
    if (sdkRoot != null) {
        val candidate = File(sdkRoot, "ndk/${libs.versions.ndk.get()}")
        if (candidate.isDirectory) return candidate.absolutePath
    }
    error("Cannot locate Android NDK. Set ANDROID_NDK_HOME or install ndk;${libs.versions.ndk.get()} via sdkmanager.")
}

val compileShaders = tasks.register<CompileShadersTask>("compileShaders") {
    group = "build"
    description = "Compile GLSL shaders to SPIR-V via glslc."

    sourceRoot.set(shaderSrcDir)
    sources.from(
        shaderSrcDir.asFileTree.matching {
            include("**/*.vert", "**/*.frag", "**/*.comp")
        }
    )
    outputDir.set(shaderOutDir)
    targetEnv.set("vulkan1.4")

    val osName = System.getProperty("os.name").lowercase()
    val hostTag = when {
        osName.contains("linux")   -> "linux-x86_64"
        osName.contains("mac")     -> "darwin-x86_64"
        osName.contains("windows") -> "windows-x86_64"
        else -> error("Unsupported host OS: $osName")
    }
    val glslcName = if (osName.contains("windows")) "glslc.exe" else "glslc"
    glslcPath.set(File(resolveNdkPath(), "shader-tools/$hostTag/$glslcName").absolutePath)
}

// Wire shader compile into the normal build graph so a plain `assembleDebug`
// produces SPIR-V assets without any extra step.
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }
    .configureEach { dependsOn(compileShaders) }
tasks.matching { it.name.startsWith("package") && it.name.endsWith("Assets") }
    .configureEach { dependsOn(compileShaders) }
