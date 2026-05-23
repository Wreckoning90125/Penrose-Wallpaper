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

    private fun bundle(
        roughness: Int, metalness: Int, iridescence: Int, sheen: Int,
        clearcoat: Int, anisotropy: Int, emissive: Int, relief: Int,
        angle: Int, elevation: Int, intensity: Int, warmth: Int, ambient: Int,
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
    )

    val all: List<MaterialPreset> = listOf(
        MaterialPreset("Matte", R.drawable.preset_matte, bundle(
            roughness = 85, metalness = 0, iridescence = 0, sheen = 20,
            clearcoat = 0, anisotropy = 0, emissive = 30, relief = 90,
            angle = 230, elevation = 55, intensity = 100, warmth = 55, ambient = 30)),
        MaterialPreset("Ceramic", R.drawable.preset_ceramic, bundle(
            roughness = 35, metalness = 0, iridescence = 5, sheen = 25,
            clearcoat = 60, anisotropy = 0, emissive = 35, relief = 110,
            angle = 230, elevation = 60, intensity = 110, warmth = 52, ambient = 22)),
        MaterialPreset("Pearl", R.drawable.preset_pearl, bundle(
            roughness = 30, metalness = 20, iridescence = 90, sheen = 60,
            clearcoat = 50, anisotropy = 0, emissive = 40, relief = 100,
            angle = 220, elevation = 55, intensity = 100, warmth = 45, ambient = 25)),
        MaterialPreset("Brushed metal", R.drawable.preset_brushed_metal, bundle(
            roughness = 45, metalness = 95, iridescence = 10, sheen = 10,
            clearcoat = 10, anisotropy = 90, emissive = 25, relief = 105,
            angle = 235, elevation = 50, intensity = 120, warmth = 50, ambient = 15)),
        MaterialPreset("Lacquer", R.drawable.preset_lacquer, bundle(
            roughness = 15, metalness = 10, iridescence = 20, sheen = 15,
            clearcoat = 100, anisotropy = 0, emissive = 45, relief = 115,
            angle = 225, elevation = 62, intensity = 115, warmth = 60, ambient = 18)),
        MaterialPreset("Oil-slick", R.drawable.preset_oil_slick, bundle(
            roughness = 25, metalness = 60, iridescence = 100, sheen = 40,
            clearcoat = 70, anisotropy = 30, emissive = 70, relief = 100,
            angle = 240, elevation = 48, intensity = 110, warmth = 50, ambient = 20)),
    )
}
