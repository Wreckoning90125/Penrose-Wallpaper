package com.penrose.wallpaper.preset

import android.util.Log
import com.penrose.wallpaper.Settings
import org.json.JSONObject

internal object StaticSettingsParser {
    fun parse(staticJson: JSONObject, source: String): MutableMap<String, StaticValue> {
        val staticSettings = mutableMapOf<String, StaticValue>()
        val keys = staticJson.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val expected = prefSchema[key]
            if (expected == null) {
                Log.w(TAG, "ignoring unknown setting $key in $source")
                continue
            }
            val value = staticJson.get(key)
            val parsed = when (expected.type) {
                PrefType.Int -> (value as? Number)?.toInt()
                    ?.takeIf { expected.intRange?.contains(it) ?: true }
                    ?.let { StaticValue.IntValue(it) }
                PrefType.String -> (value as? String)
                    ?.takeIf { expected.allowedStrings?.contains(it) ?: true }
                    ?.let { StaticValue.StringValue(it) }
                PrefType.Bool -> (value as? Boolean)?.let { StaticValue.BoolValue(it) }
                PrefType.Float -> (value as? Number)?.toFloat()?.let { StaticValue.FloatValue(it) }
            }
            if (parsed == null) {
                Log.w(TAG, "ignoring invalid setting $key=$value in $source")
                continue
            }
            staticSettings[key] = parsed
        }
        return staticSettings
    }

    private enum class PrefType { Int, String, Bool, Float }
    private data class PrefSpec(
        val type: PrefType,
        val intRange: IntRange? = null,
        val allowedStrings: Set<String>? = null,
    )

    private const val TAG = "StaticSettingsParser"

    private fun intRange(min: Int, max: Int) = PrefSpec(PrefType.Int, min..max)
    private fun stringSet(vararg values: String) = PrefSpec(PrefType.String, allowedStrings = values.toSet())
    private fun stringRange(min: Int, max: Int) = PrefSpec(
        PrefType.String,
        allowedStrings = (min..max).map { it.toString() }.toSet(),
    )
    private val bool = PrefSpec(PrefType.Bool)
    private val float = PrefSpec(PrefType.Float)

    private val prefSchema = mapOf(
        Settings.KEY_FAMILY to stringRange(0, 16),
        Settings.KEY_SEED to stringRange(0, 51),
        Settings.KEY_GENERATION to intRange(0, 8),
        Settings.KEY_PRESET to stringSet("0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"),
        Settings.KEY_COLOR_COUNT to intRange(2, 18),
        Settings.KEY_COLOR_MODE to stringSet("0", "1", "2"),
        Settings.KEY_BORDER_ON to bool,
        Settings.KEY_BORDER_W to intRange(0, 600),
        Settings.KEY_BORDER_JOIN to stringSet("0", "1", "2"),
        Settings.KEY_BORDER_FILL to intRange(0, 100),
        Settings.KEY_BORDER_POINT to intRange(0, 100),
        Settings.KEY_BORDER_GAP to intRange(0, 100),
        Settings.KEY_BORDER_L to intRange(0, 100),
        Settings.KEY_BORDER_C to intRange(0, 37),
        Settings.KEY_BORDER_H to intRange(0, 359),
        Settings.KEY_BORDER_A to intRange(0, 100),
        Settings.KEY_BG_MODE to stringSet("0", "1"),
        Settings.KEY_BG_L to intRange(0, 100),
        Settings.KEY_BG_C to intRange(0, 37),
        Settings.KEY_BG_H to intRange(0, 359),
        Settings.KEY_RIPPLE_AMOUNT to intRange(0, 100),
        Settings.KEY_RIPPLE_MODE to stringSet("0", "1", "2"),
        Settings.KEY_RIPPLE_SPEED to intRange(10, 300),
        Settings.KEY_RIPPLE_KIND to stringSet("0", "1", "2"),
        Settings.KEY_PAN_MODE to stringSet("0", "1"),
        Settings.KEY_ZOOM to float,
        Settings.KEY_ROTATION to float,
        Settings.KEY_PAN_X to float,
        Settings.KEY_PAN_Y to float,
        Settings.KEY_BRIGHTNESS to intRange(0, 100),
        Settings.KEY_DEPTH_AMOUNT to intRange(0, 100),
        Settings.KEY_MAT_ROUGHNESS to intRange(0, 100),
        Settings.KEY_MAT_METALNESS to intRange(0, 100),
        Settings.KEY_MAT_SHEEN to intRange(0, 100),
        Settings.KEY_MAT_CLEARCOAT to intRange(0, 100),
        Settings.KEY_MAT_ANISOTROPY to intRange(0, 100),
        Settings.KEY_MAT_IRIDESCENCE to intRange(0, 100),
        Settings.KEY_MAT_EMISSIVE to intRange(0, 100),
        Settings.KEY_MAT_RELIEF to intRange(0, 200),
        Settings.KEY_LIGHT_ANGLE to intRange(0, 360),
        Settings.KEY_LIGHT_ELEVATION to intRange(0, 90),
        Settings.KEY_LIGHT_INTENSITY to intRange(0, 200),
        Settings.KEY_LIGHT_WARMTH to intRange(0, 100),
        Settings.KEY_LIGHT_AMBIENT to intRange(0, 100),
        Settings.KEY_MAT_SHEEN_COLOR_R to intRange(0, 100),
        Settings.KEY_MAT_SHEEN_COLOR_G to intRange(0, 100),
        Settings.KEY_MAT_SHEEN_COLOR_B to intRange(0, 100),
        Settings.KEY_MAT_IRID_THICK_MIN to intRange(100, 800),
        Settings.KEY_MAT_IRID_THICK_MAX to intRange(100, 800),
        Settings.KEY_MAT_ROUGH_MOD to intRange(0, 100),
        Settings.KEY_MAT_METAL_MOD to intRange(0, 100),
        Settings.KEY_PROJECTION to stringSet("0", "1"),
        Settings.KEY_HYP_SCALE to intRange(0, 100),
        Settings.KEY_HYP_BOOST_X to intRange(0, 100),
        Settings.KEY_HYP_BOOST_Y to intRange(0, 100),
        Settings.KEY_HYP_BORDER_SUBDIV to intRange(1, 32),
        Settings.KEY_HYP_FILL_SUBDIV to intRange(1, 8),
    )
}
