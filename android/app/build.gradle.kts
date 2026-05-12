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
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
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

    buildTypes {
        debug { isDebuggable = true }
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
}

// AGP 9 removed the legacy `kotlinOptions { jvmTarget = "..." }` block in favour
// of the kotlin-gradle-plugin's own DSL. JDK 17 is AGP 9.2's documented default
// and minimum, so target the same bytecode version.
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // No runtime deps. Wallpaper service and JNI surface are stdlib-only.
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

    val ndkRoot = android.ndkDirectory
    val hostTag = when {
        org.gradle.internal.os.OperatingSystem.current().isLinux -> "linux-x86_64"
        org.gradle.internal.os.OperatingSystem.current().isMacOsX -> "darwin-x86_64"
        org.gradle.internal.os.OperatingSystem.current().isWindows -> "windows-x86_64"
        else -> error("Unsupported host OS")
    }
    val glslcName = if (org.gradle.internal.os.OperatingSystem.current().isWindows) "glslc.exe" else "glslc"
    glslcPath.set(File(ndkRoot, "shader-tools/$hostTag/$glslcName").absolutePath)
}

// Wire shader compile into the normal build graph so a plain `assembleDebug`
// produces SPIR-V assets without any extra step.
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }
    .configureEach { dependsOn(compileShaders) }
tasks.matching { it.name.startsWith("package") && it.name.endsWith("Assets") }
    .configureEach { dependsOn(compileShaders) }
