package com.penrose.wallpaper.preset

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.core.content.edit
import com.penrose.wallpaper.Settings
import org.json.JSONObject

/**
 * Loads bundled starter presets from `assets/presets/`. These presets are
 * reusable audio/reactivity/material starts; tiling target selection lives in
 * the Tiling screen and uses `AtlasStore`.
 */
internal class PresetStore(private val context: Context) {

    fun list(): List<Preset> {
        val out = mutableListOf<Preset>()
        val names = try {
            context.assets.list(ASSETS_DIR) ?: emptyArray()
        } catch (e: Exception) {
            Log.w(TAG, "asset listing failed", e); return out
        }
        for (file in names.filter { it.endsWith(".json") }.sorted()) {
            try {
                val text = context.assets.open("$ASSETS_DIR/$file")
                    .use { it.bufferedReader().readText() }
                parse(file, text)?.let(out::add)
            } catch (e: Exception) {
                Log.w(TAG, "failed to load preset $file", e)
            }
        }
        return out
    }

    /**
     * Writes preset.staticSettings into [prefs]. If the preset ships a graph
     * block, the persisted modulation graph is overwritten with it.
     */
    fun applyToPrefs(preset: Preset, prefs: SharedPreferences) {
        val graphJson = preset.graphJson
        if (graphJson != null) {
            try {
                java.io.File(context.filesDir, "modulation_graph.json")
                    .writeText(graphJson)
            } catch (e: Exception) {
                Log.w(TAG, "graph write failed for preset ${preset.id}", e)
            }
        }
        prefs.edit {
            for ((key, value) in preset.staticSettings) {
                when (value) {
                    is StaticValue.IntValue    -> putInt(key, value.v)
                    is StaticValue.StringValue -> putString(key, value.v)
                    is StaticValue.BoolValue   -> putBoolean(key, value.v)
                    is StaticValue.FloatValue  -> putFloat(key, value.v)
                }
            }
            if (graphJson != null) {
                putLong(Settings.KEY_GRAPH_REVISION, System.currentTimeMillis())
            }
        }
    }

    private fun parse(filename: String, json: String): Preset? {
        val obj = JSONObject(json)
        val id = obj.optString("id", filename.removeSuffix(".json"))
        val name = obj.optString("name", id)
        val desc = obj.optString("description", "")
        val staticSettings = StaticSettingsParser.parse(
            obj.optJSONObject("settings") ?: JSONObject(),
            filename,
        )
        val graphJson = obj.optJSONObject("graph")?.toString()
        return Preset(id, name, desc, staticSettings, graphJson)
    }

    private companion object {
        const val ASSETS_DIR = "presets"
        const val TAG = "PresetStore"
    }
}
