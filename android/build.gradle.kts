plugins {
    // AGP 9 has built-in Kotlin support, so we no longer apply
    // org.jetbrains.kotlin.android as a top-level plugin alias.
    alias(libs.plugins.android.application) apply false
}
