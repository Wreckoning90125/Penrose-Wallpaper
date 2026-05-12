package com.penrose.wallpaper

import android.content.SharedPreferences

/**
 * Strongly-typed projection of our SharedPreferences. Lives entirely in Kotlin;
 * the encoding into the int/float arrays the C++ side reads happens in
 * [toNative]. Keep the order in [toNative] in sync with `decodeSettings()` in
 * cpp/jni_bridge.cpp.
 */
internal data class Settings(
    val family: Int,        // 0=P3, 1=P2, 2=Chair
    val seedIdx: Int,
    val generation: Int,    // clamped per-family by the C++ side
    val preset: Int,        // 0..10 — see C++ enum Preset
    val colorCount: Int,    // 2..10
    val colorMode: Int,     // 0=type, 1=orient, 2=ring
    val borderOn: Boolean,
    val borderWidth: Float,
    val borderL: Float,
    val borderC: Float,
    val borderH: Float,
    val borderAlpha: Float,
    val bgMode: Int,        // 0=solid, 1=match
    val bgL: Float,
    val bgC: Float,
    val bgH: Float,
) {
    fun toNative(): Pair<IntArray, FloatArray> {
        val ints = intArrayOf(
            family, seedIdx, generation, preset, colorCount, colorMode,
            if (borderOn) 1 else 0, bgMode,
        )
        val floats = floatArrayOf(
            borderWidth, borderL, borderC, borderH, borderAlpha,
            bgL, bgC, bgH,
        )
        return ints to floats
    }

    companion object {
        const val PREFS_NAME = "penrose_settings"

        // Keys must stay in sync with res/xml/preferences.xml.
        const val KEY_FAMILY      = "family"
        const val KEY_SEED        = "seed"
        const val KEY_GENERATION  = "generation"
        const val KEY_PRESET      = "preset"
        const val KEY_COLOR_COUNT = "color_count"
        const val KEY_COLOR_MODE  = "color_mode"
        const val KEY_BORDER_ON   = "border_on"
        const val KEY_BORDER_W    = "border_width"
        const val KEY_BORDER_L    = "border_l"
        const val KEY_BORDER_C    = "border_c"
        const val KEY_BORDER_H    = "border_h"
        const val KEY_BORDER_A    = "border_a"
        const val KEY_BG_MODE     = "bg_mode"
        const val KEY_BG_L        = "bg_l"
        const val KEY_BG_C        = "bg_c"
        const val KEY_BG_H        = "bg_h"

        fun load(prefs: SharedPreferences): Settings = Settings(
            family      = prefs.getString(KEY_FAMILY, "0")!!.toIntOrNull() ?: 0,
            seedIdx     = prefs.getString(KEY_SEED, "0")!!.toIntOrNull() ?: 0,
            generation  = prefs.getInt(KEY_GENERATION, 6),
            preset      = prefs.getString(KEY_PRESET, "4")!!.toIntOrNull() ?: 4, // Gold
            colorCount  = prefs.getInt(KEY_COLOR_COUNT, 2),
            colorMode   = prefs.getString(KEY_COLOR_MODE, "0")!!.toIntOrNull() ?: 0,
            borderOn    = prefs.getBoolean(KEY_BORDER_ON, true),
            borderWidth = prefs.getInt(KEY_BORDER_W, 80) / 100f,   // 0..6 stored as 0..600
            borderL     = prefs.getInt(KEY_BORDER_L, 95) / 100f,
            borderC     = prefs.getInt(KEY_BORDER_C,  0) / 100f,
            borderH     = prefs.getInt(KEY_BORDER_H,  0).toFloat(),
            borderAlpha = prefs.getInt(KEY_BORDER_A, 35) / 100f,
            bgMode      = prefs.getString(KEY_BG_MODE, "0")!!.toIntOrNull() ?: 0,
            bgL         = prefs.getInt(KEY_BG_L,   4) / 100f,
            bgC         = prefs.getInt(KEY_BG_C,   0) / 100f,
            bgH         = prefs.getInt(KEY_BG_H, 280).toFloat(),
        )
    }
}
