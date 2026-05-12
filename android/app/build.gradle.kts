import java.io.File

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

    kotlinOptions {
        jvmTarget = "17"
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

dependencies {
    // No runtime deps. Wallpaper service and JNI surface are stdlib-only.
}

// -----------------------------------------------------------------------------
// SPIR-V compilation. We invoke glslc from the NDK shader-tools to convert
// src/main/shaders/*.{vert,frag} into assets/shaders/*.spv at build time.
// The wallpaper loads them from AssetManager at startup, so a clean build is
// all that's needed to pick up shader edits.
// -----------------------------------------------------------------------------
val shaderSrcDir = layout.projectDirectory.dir("src/main/shaders")
val shaderOutDir = layout.buildDirectory.dir("generated/shaders/shaders")

val compileShaders by tasks.registering {
    group = "build"
    description = "Compile GLSL shaders to SPIR-V via glslc."

    val inputs = shaderSrcDir.asFileTree.matching {
        include("**/*.vert", "**/*.frag", "**/*.comp")
    }
    this.inputs.files(inputs)
    this.outputs.dir(shaderOutDir)

    doLast {
        val ndkRoot = android.ndkDirectory
        val hostTag = when {
            org.gradle.internal.os.OperatingSystem.current().isLinux -> "linux-x86_64"
            org.gradle.internal.os.OperatingSystem.current().isMacOsX -> "darwin-x86_64"
            org.gradle.internal.os.OperatingSystem.current().isWindows -> "windows-x86_64"
            else -> error("Unsupported host OS")
        }
        val glslcName = if (org.gradle.internal.os.OperatingSystem.current().isWindows) "glslc.exe" else "glslc"
        val glslc = File(ndkRoot, "shader-tools/$hostTag/$glslcName")
        if (!glslc.exists()) {
            error("glslc not found at $glslc — check ndkVersion in libs.versions.toml")
        }
        val out = shaderOutDir.get().asFile
        out.mkdirs()
        inputs.forEach { src ->
            val rel = src.relativeTo(shaderSrcDir.asFile).path
            val dst = File(out, "$rel.spv")
            dst.parentFile.mkdirs()
            exec {
                commandLine(
                    glslc.absolutePath,
                    "--target-env=vulkan1.4",
                    "-O",
                    "-o", dst.absolutePath,
                    src.absolutePath,
                )
            }
        }
    }
}

// Wire shader compile into the normal build graph so a plain `assembleDebug`
// produces SPIR-V assets without any extra step.
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }
    .configureEach { dependsOn(compileShaders) }
tasks.matching { it.name.startsWith("package") && it.name.endsWith("Assets") }
    .configureEach { dependsOn(compileShaders) }
