package com.penrose.wallpaper.preset

import androidx.annotation.DrawableRes
import com.penrose.wallpaper.R
import com.penrose.wallpaper.Settings

/**
 * A built-in material + lighting bundle. Selecting one is a one-shot apply:
 * its values are written straight into SharedPreferences, the sliders
 * re-bind to show them, and the preset is then done — there is no stored
 * "active preset" state, no toggle. The user tunes the sliders from there.
 * (User-saveable presets are a separate, later feature.)
 *
 * `thumbnailRes` is the baked PNG drawable rendered from these same
 * `values` by `tools/bake_preset_thumbnails.py`, so the picker shows the
 * preset's character instead of a name only. Re-bake if values change.
 *
 * `values` maps a SeekBarPreference key to its integer slider position, in
 * the same units the slider stores — see preferences_material.xml.
 */
internal data class MaterialPreset(
    val name: String,
    @DrawableRes val thumbnailRes: Int,
    val values: Map<String, Int>,
)

internal object MaterialPresets {

    // Bundle the thirteen slider values + the five per-preset
    // characteristic-colour overrides. Sheen RGB is in the same
    // 0..100 integer space the SeekBar would use; iridescent thickness
    // is plain nm. Defaults at the bottom match MaterialParams so a
    // preset that omits them produces the same look the slider defaults
    // would. Keep values in sync with tools/bake_preset_thumbnails.py.
    private fun bundle(
        roughness: Int, metalness: Int, iridescence: Int, sheen: Int,
        clearcoat: Int, anisotropy: Int, emissive: Int, relief: Int,
        angle: Int, elevation: Int, intensity: Int, warmth: Int, ambient: Int,
        sheenColorR: Int = 100, sheenColorG: Int = 97, sheenColorB: Int = 92,
        iridThickMin: Int = 280, iridThickMax: Int = 560,
        roughMod: Int = 0, metalMod: Int = 0,
    ): Map<String, Int> = mapOf(
        Settings.KEY_MAT_ROUGHNESS to roughness,
        Settings.KEY_MAT_METALNESS to metalness,
        Settings.KEY_MAT_IRIDESCENCE to iridescence,
        Settings.KEY_MAT_SHEEN to sheen,
        Settings.KEY_MAT_CLEARCOAT to clearcoat,
        Settings.KEY_MAT_ANISOTROPY to anisotropy,
        Settings.KEY_MAT_EMISSIVE to emissive,
        Settings.KEY_MAT_RELIEF to relief,
        Settings.KEY_LIGHT_ANGLE to angle,
        Settings.KEY_LIGHT_ELEVATION to elevation,
        Settings.KEY_LIGHT_INTENSITY to intensity,
        Settings.KEY_LIGHT_WARMTH to warmth,
        Settings.KEY_LIGHT_AMBIENT to ambient,
        Settings.KEY_MAT_SHEEN_COLOR_R to sheenColorR,
        Settings.KEY_MAT_SHEEN_COLOR_G to sheenColorG,
        Settings.KEY_MAT_SHEEN_COLOR_B to sheenColorB,
        Settings.KEY_MAT_IRID_THICK_MIN to iridThickMin,
        Settings.KEY_MAT_IRID_THICK_MAX to iridThickMax,
        Settings.KEY_MAT_ROUGH_MOD to roughMod,
        Settings.KEY_MAT_METAL_MOD to metalMod,
    )

    val all: List<MaterialPreset> = listOf(
        // Matte: warm-white sheen, default thin-film range (preset has 0
        // iridescence so the range only matters cosmetically).
        MaterialPreset("Matte", R.drawable.preset_matte, bundle(
            roughness = 85, metalness = 0, iridescence = 0, sheen = 20,
            clearcoat = 0, anisotropy = 0, emissive = 30, relief = 90,
            angle = 230, elevation = 55, intensity = 100, warmth = 55, ambient = 30)),
        // Ceramic: slightly warm sheen, default thin-film.
        MaterialPreset("Ceramic", R.drawable.preset_ceramic, bundle(
            roughness = 35, metalness = 0, iridescence = 5, sheen = 25,
            clearcoat = 60, anisotropy = 0, emissive = 35, relief = 110,
            angle = 230, elevation = 60, intensity = 110, warmth = 52, ambient = 22,
            sheenColorR = 100, sheenColorG = 96, sheenColorB = 90)),
        // Pearl: cool opal sheen + a thin (250-400 nm) thin-film band
        // that puts the Belcour-Barla colour in the teal/violet region.
        MaterialPreset("Pearl", R.drawable.preset_pearl, bundle(
            roughness = 30, metalness = 20, iridescence = 90, sheen = 60,
            clearcoat = 50, anisotropy = 0, emissive = 40, relief = 100,
            angle = 220, elevation = 55, intensity = 100, warmth = 45, ambient = 25,
            sheenColorR = 96, sheenColorG = 98, sheenColorB = 100,
            iridThickMin = 250, iridThickMax = 400)),
        // Brushed metal: silvery sheen; iridescence is low so default
        // range is fine.
        MaterialPreset("Brushed metal", R.drawable.preset_brushed_metal, bundle(
            roughness = 40, metalness = 95, iridescence = 10, sheen = 10,
            clearcoat = 10, anisotropy = 95, emissive = 25, relief = 105,
            angle = 235, elevation = 50, intensity = 120, warmth = 50, ambient = 18,
            sheenColorR = 100, sheenColorG = 99, sheenColorB = 95)),
        // Lacquer: warm sheen, narrow mid-band thin-film (warm shifts).
        MaterialPreset("Lacquer", R.drawable.preset_lacquer, bundle(
            roughness = 15, metalness = 10, iridescence = 20, sheen = 15,
            clearcoat = 100, anisotropy = 0, emissive = 45, relief = 115,
            angle = 225, elevation = 62, intensity = 115, warmth = 60, ambient = 18,
            sheenColorR = 100, sheenColorG = 92, sheenColorB = 82,
            iridThickMin = 320, iridThickMax = 520)),
        // Oil-slick: cool green-tinted sheen + a wide 380-700 nm range
        // that cycles the Belcour-Barla colour across the full visible
        // spectrum (green / blue / violet / magenta).
        MaterialPreset("Oil-slick", R.drawable.preset_oil_slick, bundle(
            roughness = 25, metalness = 60, iridescence = 100, sheen = 40,
            clearcoat = 70, anisotropy = 30, emissive = 70, relief = 100,
            angle = 240, elevation = 48, intensity = 110, warmth = 50, ambient = 20,
            sheenColorR = 85, sheenColorG = 95, sheenColorB = 78,
            iridThickMin = 380, iridThickMax = 700)),
    )
}
