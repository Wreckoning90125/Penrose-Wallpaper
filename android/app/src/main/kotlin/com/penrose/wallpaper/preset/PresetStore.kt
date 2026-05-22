package com.penrose.wallpaper.preset

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.core.content.edit
import com.penrose.wallpaper.Settings
import org.json.JSONObject

/**
 * Loads bundled starter presets from `assets/presets/`. A preset captures
 * two pieces of state:
 *
 *   - `settings`: static SharedPreferences values (e.g. `ripple_kind`,
 *     `border_width`) the preset forces. Loaded into prefs directly.
 *   - `graph`: serialized C++ node graph JSON. Written to
 *     `filesDir/modulation_graph.json`; the renderer's graphLoad picks
 *     it up on next surface bring-up.
 *
 * Loading has no ongoing state — once applied, those values ARE the
 * user's settings + graph. The user is free to edit any slot or rewire
 * any node afterward.
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
     * Writes preset.staticSettings into [prefs]. If — and only if — the
     * preset ships a graph block, the persisted modulation graph is
     * overwritten with it. A colours-only / sliders-only preset leaves
     * the user's hand-built graph completely alone: loading such a
     * preset must never wipe a graph the user spent time wiring.
     */
    fun applyToPrefs(preset: Preset, prefs: SharedPreferences) {
        // Write the graph JSON to disk FIRST (before the revision bump)
        // so a listener reacting to the bump reads the new graph. A
        // preset with no graph block does not touch the file at all.
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
            // Bump the revision only when the graph file actually
            // changed — a slider-only preset must not make listeners
            // reload (and thereby reset) an unchanged graph.
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
        val staticJson = obj.optJSONObject("settings") ?: JSONObject()
        val staticSettings = mutableMapOf<String, StaticValue>()
        val keys = staticJson.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            val v = staticJson.get(k)
            staticSettings[k] = when (v) {
                is Int     -> StaticValue.IntValue(v)
                is Long    -> StaticValue.IntValue(v.toInt())
                is Double  -> StaticValue.FloatValue(v.toFloat())
                is Boolean -> StaticValue.BoolValue(v)
                is String  -> StaticValue.StringValue(v)
                else -> continue
            }
        }
        val graphJson = obj.optJSONObject("graph")?.toString()
        return Preset(id, name, desc, staticSettings, graphJson)
    }

    private companion object {
        const val ASSETS_DIR = "presets"
        const val TAG = "PresetStore"
    }
}
