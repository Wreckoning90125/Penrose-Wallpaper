package com.penrose.wallpaper.preset

/**
 * A bundled starting point the user can load into their settings + node
 * graph. Loading a preset writes [staticSettings] into the DataStore-backed
 * settings repository and writes [graphJson] into the same working profile.
 * After load the user owns every value verbatim; nothing tracks "the
 * currently active preset".
 */
internal data class Preset(
    val id: String,
    val name: String,
    val description: String,
    val staticSettings: Map<String, StaticValue>,
    val graphJson: String?,
)

/** Tagged value for static preset settings. */
internal sealed class StaticValue {
    data class IntValue(val v: Int) : StaticValue()
    data class StringValue(val v: String) : StaticValue()
    data class BoolValue(val v: Boolean) : StaticValue()
    data class FloatValue(val v: Float) : StaticValue()
}
