package com.penrose.wallpaper.atlas

import android.content.Context
import android.util.Log
import com.penrose.wallpaper.preset.StaticSettingsParser
import com.penrose.wallpaper.preset.StaticValue
import org.json.JSONObject

internal data class AtlasCategory(
    val id: String,
    val label: String,
    val targets: List<AtlasTarget>,
)

internal data class AtlasTarget(
    val id: String,
    val name: String,
    val settings: Map<String, StaticValue>,
)

internal class AtlasStore(private val context: Context) {
    fun categories(): List<AtlasCategory> {
        val text = try {
            context.assets.open(ATLAS_ASSET).use { it.bufferedReader().readText() }
        } catch (e: Exception) {
            Log.w(TAG, "atlas load failed", e)
            return emptyList()
        }

        return try {
            val out = mutableListOf<AtlasCategory>()
            val root = JSONObject(text)
            val categories = root.optJSONArray("categories") ?: return emptyList()
            for (i in 0 until categories.length()) {
                val category = categories.optJSONObject(i) ?: continue
                val categoryId = category.optString("id", "category_$i")
                val categoryLabel = category.optString("label", categoryId)
                val defaults = StaticSettingsParser.parse(
                    category.optJSONObject("defaults") ?: JSONObject(),
                    "$ATLAS_ASSET:$categoryId/defaults",
                )
                val targets = mutableListOf<AtlasTarget>()
                val items = category.optJSONArray("items") ?: continue
                for (j in 0 until items.length()) {
                    val item = items.optJSONObject(j) ?: continue
                    val itemId = item.optString("id", "item_$i$j")
                    val settings = defaults.toMutableMap()
                    settings.putAll(
                        StaticSettingsParser.parse(
                            item.optJSONObject("settings") ?: JSONObject(),
                            "$ATLAS_ASSET:$itemId/settings",
                        )
                    )
                    targets.add(
                        AtlasTarget(
                            id = itemId,
                            name = item.optString("name", itemId),
                            settings = settings,
                        )
                    )
                }
                out.add(AtlasCategory(categoryId, categoryLabel, targets))
            }
            out
        } catch (e: Exception) {
            Log.w(TAG, "atlas parse failed", e)
            emptyList()
        }
    }

    private companion object {
        const val ATLAS_ASSET = "tiling_atlas.json"
        const val TAG = "AtlasStore"
    }
}
