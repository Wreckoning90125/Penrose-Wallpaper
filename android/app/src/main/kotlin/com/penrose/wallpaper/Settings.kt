package com.penrose.wallpaper

import android.content.SharedPreferences

/**
 * Strongly-typed projection of our SharedPreferences, encoded into the
 * int/float arrays the C++ renderer reads in `decodeSettings()`
 * (jni_bridge.cpp). All modulation lives in the C++ node graph; this
 * struct only carries the user's slider baselines into the renderer.
 */
internal class Settings(
    val family: Int,
    val seedIdx: Int,
    val generation: Int,
    val preset: Int,
    val colorCount: Int,
    val colorMode: Int,
    val borderOn: Boolean,
    val borderWidth: Float,
    val borderL: Float,
    val borderC: Float,
    val borderH: Float,
    val borderAlpha: Float,
    val bgMode: Int,
    val bgL: Float,
    val bgC: Float,
    val bgH: Float,
    val rippleAmount: Float,
    val rippleMode: Int,
    val rippleSpeed: Float,
    val rippleKind: Int,
    val panMode: Int,
    val zoom: Float,
    val rotation: Float,
    val panX: Float,
    val panY: Float,
    val brightness: Float,
    val depthAmount: Float,
    val matRoughness: Float,
    val matMetalness: Float,
    val matSheen: Float,
    val matClearcoat: Float,
    val matAnisotropy: Float,
    val matIridescence: Float,
    val matEmissive: Float,
    val matRelief: Float,
    val lightAngle: Float,
    val lightElevation: Float,
    val lightIntensity: Float,
    val lightWarmth: Float,
    val lightAmbient: Float,
    val customOklch: FloatArray,
) {
    fun toNative(): Pair<IntArray, FloatArray> {
        val ints = intArrayOf(
            family, seedIdx, generation, preset, colorCount, colorMode,
            if (borderOn) 1 else 0, bgMode, rippleMode, panMode, rippleKind,
        )
        val baseFloats = floatArrayOf(
            borderWidth, borderL, borderC, borderH, borderAlpha,
            bgL, bgC, bgH, rippleAmount,
            zoom, rotation, panX, panY,
            brightness, depthAmount, rippleSpeed,
            matRoughness, matMetalness, matSheen, matClearcoat,
            matAnisotropy, matIridescence, matEmissive, matRelief,
            lightAngle, lightElevation, lightIntensity, lightWarmth, lightAmbient,
        )
        val floats = FloatArray(baseFloats.size + customOklch.size)
        baseFloats.copyInto(floats)
        customOklch.copyInto(floats, baseFloats.size)
        return ints to floats
    }

    companion object {
        const val PREFS_NAME = "penrose_settings"

        // Tiling / palette / border keys
        const val KEY_FAMILY        = "family"
        const val KEY_SEED          = "seed"
        const val KEY_GENERATION    = "generation"
        const val KEY_PRESET        = "preset"
        const val KEY_COLOR_COUNT   = "color_count"
        const val KEY_COLOR_MODE    = "color_mode"
        const val KEY_BORDER_ON     = "border_on"
        const val KEY_BORDER_W      = "border_width"
        const val KEY_BORDER_L      = "border_l"
        const val KEY_BORDER_C      = "border_c"
        const val KEY_BORDER_H      = "border_h"
        const val KEY_BORDER_A      = "border_a"
        const val KEY_BG_MODE       = "bg_mode"
        const val KEY_BG_L          = "bg_l"
        const val KEY_BG_C          = "bg_c"
        const val KEY_BG_H          = "bg_h"
        const val KEY_RIPPLE_AMOUNT = "ripple_amount"
        const val KEY_RIPPLE_MODE   = "ripple_mode"
        const val KEY_RIPPLE_SPEED  = "ripple_speed"
        const val KEY_RIPPLE_KIND   = "ripple_kind"
        const val KEY_PAN_MODE      = "pan_mode"
        const val KEY_ZOOM          = "view_zoom"
        const val KEY_ROTATION      = "view_rotation"
        const val KEY_PAN_X         = "view_pan_x"
        const val KEY_PAN_Y         = "view_pan_y"
        const val KEY_BRIGHTNESS    = "brightness"
        const val KEY_DEPTH_AMOUNT  = "depth_amount"

        // Physical-material slider bases. SeekBarPreference stores 0..N
        // integers; load() divides by 100. The modulation graph drives
        // these on top of the stored base.
        const val KEY_MAT_ROUGHNESS   = "mat_roughness"
        const val KEY_MAT_METALNESS   = "mat_metalness"
        const val KEY_MAT_SHEEN       = "mat_sheen"
        const val KEY_MAT_CLEARCOAT   = "mat_clearcoat"
        const val KEY_MAT_ANISOTROPY  = "mat_anisotropy"
        const val KEY_MAT_IRIDESCENCE = "mat_iridescence"
        const val KEY_MAT_EMISSIVE    = "mat_emissive"
        const val KEY_MAT_RELIEF      = "mat_relief"

        // Lighting rig slider bases. Angle / elevation are stored as plain
        // degrees; the other three as 0..N integers divided by 100.
        const val KEY_LIGHT_ANGLE     = "light_angle"
        const val KEY_LIGHT_ELEVATION = "light_elevation"
        const val KEY_LIGHT_INTENSITY = "light_intensity"
        const val KEY_LIGHT_WARMTH    = "light_warmth"
        const val KEY_LIGHT_AMBIENT   = "light_ambient"

        // Bumped by PresetStore.applyToPrefs whenever a preset writes a
        // fresh modulation_graph.json, and by the node editor when it
        // saves an edited graph. Read-only signal — listeners observe the
        // value change and reload the graph from disk. Decoupling "static
        // settings drift" from "graph file changed" means slider drags
        // don't trip a full graph teardown.
        const val KEY_GRAPH_REVISION = "_graph_revision"

        // Set true by AudioPlaybackService while a track is playing, false
        // when it stops. Read-only signal — the wallpaper engine arms its
        // per-frame render loop while audio is active so the modulation
        // graph keeps evaluating and audio-reactive output stays live even
        // when no time-based ripple would otherwise drive the loop.
        const val KEY_AUDIO_ACTIVE = "_audio_active"

        // Must equal kMaxColors in cpp/color/color.h — the native float
        // array layout (jni_bridge kFloatCount) depends on the match.
        const val CUSTOM_SLOTS  = 16

        fun customSlotKey(slot: Int, channel: Char): String = "custom_${slot}_${channel}"

        private val defaultCustomOklch = floatArrayOf(
            0.18f, 0.02f, 280.0f,
            0.78f, 0.13f,  80.0f,
            0.65f, 0.18f,  30.0f,
            0.65f, 0.18f, 120.0f,
            0.65f, 0.18f, 210.0f,
            0.65f, 0.18f, 300.0f,
            0.50f, 0.10f,  60.0f,
            0.50f, 0.10f, 150.0f,
            0.50f, 0.10f, 240.0f,
            0.50f, 0.10f, 330.0f,
            0.70f, 0.15f,   0.0f,
            0.70f, 0.15f,  45.0f,
            0.40f, 0.08f, 180.0f,
            0.40f, 0.08f, 270.0f,
            0.85f, 0.06f, 100.0f,
            0.30f, 0.05f, 320.0f,
        )

        // All pref reads go through safeStr / safeInt / safeBool /
        // safeFloat so a SharedPreferences entry stored under one type
        // but later read as another (a real possibility if a build
        // ever changes the type of a key in place) returns the default
        // instead of throwing ClassCastException at launch.
        private fun safeStr(prefs: SharedPreferences, key: String, default: String): String =
            try { prefs.getString(key, default) ?: default } catch (_: ClassCastException) { default }
        private fun safeInt(prefs: SharedPreferences, key: String, default: Int): Int =
            try { prefs.getInt(key, default) } catch (_: ClassCastException) { default }
        private fun safeBool(prefs: SharedPreferences, key: String, default: Boolean): Boolean =
            try { prefs.getBoolean(key, default) } catch (_: ClassCastException) { default }
        private fun safeFloat(prefs: SharedPreferences, key: String, default: Float): Float =
            try { prefs.getFloat(key, default) } catch (_: ClassCastException) { default }

        fun load(prefs: SharedPreferences): Settings {
            val custom = FloatArray(3 * CUSTOM_SLOTS)
            for (i in 0 until CUSTOM_SLOTS) {
                val defL = defaultCustomOklch[3 * i + 0]
                val defC = defaultCustomOklch[3 * i + 1]
                val defH = defaultCustomOklch[3 * i + 2]
                custom[3 * i + 0] = safeInt(prefs, customSlotKey(i, 'L'), (defL * 100f).toInt()) / 100f
                custom[3 * i + 1] = safeInt(prefs, customSlotKey(i, 'C'), (defC * 100f).toInt()) / 100f
                custom[3 * i + 2] = safeInt(prefs, customSlotKey(i, 'H'), defH.toInt()).toFloat()
            }
            return Settings(
                family       = safeStr(prefs, KEY_FAMILY, "0").toIntOrNull() ?: 0,
                seedIdx      = safeStr(prefs, KEY_SEED, "0").toIntOrNull() ?: 0,
                generation   = safeInt(prefs, KEY_GENERATION, 6),
                preset       = safeStr(prefs, KEY_PRESET, "4").toIntOrNull() ?: 4,
                colorCount   = safeInt(prefs, KEY_COLOR_COUNT, 2),
                colorMode    = safeStr(prefs, KEY_COLOR_MODE, "0").toIntOrNull() ?: 0,
                borderOn     = safeBool(prefs, KEY_BORDER_ON, true),
                borderWidth  = safeInt(prefs, KEY_BORDER_W, 80) / 100f,
                borderL      = safeInt(prefs, KEY_BORDER_L, 95) / 100f,
                borderC      = safeInt(prefs, KEY_BORDER_C,  0) / 100f,
                borderH      = safeInt(prefs, KEY_BORDER_H,  0).toFloat(),
                borderAlpha  = safeInt(prefs, KEY_BORDER_A, 35) / 100f,
                bgMode       = safeStr(prefs, KEY_BG_MODE, "0").toIntOrNull() ?: 0,
                bgL          = safeInt(prefs, KEY_BG_L,   4) / 100f,
                bgC          = safeInt(prefs, KEY_BG_C,   0) / 100f,
                bgH          = safeInt(prefs, KEY_BG_H, 280).toFloat(),
                rippleAmount = safeInt(prefs, KEY_RIPPLE_AMOUNT, 30) / 100f,
                rippleMode   = safeStr(prefs, KEY_RIPPLE_MODE, "0").toIntOrNull() ?: 0,
                rippleSpeed  = safeInt(prefs, KEY_RIPPLE_SPEED, 100) / 100f,
                rippleKind   = safeStr(prefs, KEY_RIPPLE_KIND, "0").toIntOrNull() ?: 0,
                panMode      = safeStr(prefs, KEY_PAN_MODE, "0").toIntOrNull() ?: 0,
                zoom         = safeFloat(prefs, KEY_ZOOM, 1.0f),
                rotation     = safeFloat(prefs, KEY_ROTATION, 0.0f),
                panX         = safeFloat(prefs, KEY_PAN_X, 0.0f),
                panY         = safeFloat(prefs, KEY_PAN_Y, 0.0f),
                brightness   = safeInt(prefs, KEY_BRIGHTNESS, 100) / 100f,
                depthAmount  = safeInt(prefs, KEY_DEPTH_AMOUNT, 30) / 100f,
                matRoughness   = safeInt(prefs, KEY_MAT_ROUGHNESS, 50) / 100f,
                matMetalness   = safeInt(prefs, KEY_MAT_METALNESS, 40) / 100f,
                matSheen       = safeInt(prefs, KEY_MAT_SHEEN, 35) / 100f,
                matClearcoat   = safeInt(prefs, KEY_MAT_CLEARCOAT, 45) / 100f,
                matAnisotropy  = safeInt(prefs, KEY_MAT_ANISOTROPY, 40) / 100f,
                matIridescence = safeInt(prefs, KEY_MAT_IRIDESCENCE, 45) / 100f,
                matEmissive    = safeInt(prefs, KEY_MAT_EMISSIVE, 60) / 100f,
                matRelief      = safeInt(prefs, KEY_MAT_RELIEF, 105) / 100f,
                lightAngle     = safeInt(prefs, KEY_LIGHT_ANGLE, 230).toFloat(),
                lightElevation = safeInt(prefs, KEY_LIGHT_ELEVATION, 55).toFloat(),
                lightIntensity = safeInt(prefs, KEY_LIGHT_INTENSITY, 100) / 100f,
                lightWarmth    = safeInt(prefs, KEY_LIGHT_WARMTH, 50) / 100f,
                lightAmbient   = safeInt(prefs, KEY_LIGHT_AMBIENT, 22) / 100f,
                customOklch  = custom,
            )
        }

        fun saveView(
            prefs: SharedPreferences,
            zoom: Float, rotation: Float, panX: Float, panY: Float,
        ) {
            prefs.edit()
                .putFloat(KEY_ZOOM, zoom)
                .putFloat(KEY_ROTATION, rotation)
                .putFloat(KEY_PAN_X, panX)
                .putFloat(KEY_PAN_Y, panY)
                .apply()
        }
    }
}
