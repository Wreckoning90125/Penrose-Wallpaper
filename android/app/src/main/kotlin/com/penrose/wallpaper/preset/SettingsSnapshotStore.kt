package com.penrose.wallpaper.preset

import android.content.Context
import android.util.AtomicFile
import com.penrose.wallpaper.Settings
import com.penrose.wallpaper.SettingsSnapshot
import com.penrose.wallpaper.SettingsStore
import com.penrose.wallpaper.StoredSetting
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Deferred

internal data class UserPreset(
    val id: String,
    val name: String,
    val file: File,
)

internal object SettingsSnapshotStore {
    private const val USER_PRESETS_DIR = "user_presets"
    private const val EMPTY_GRAPH = "{\"nodes\":[],\"links\":[]}"
    private val presetFileLock = Any()

    fun storedGraphJson(settings: SettingsStore): String =
        settings.snapshot().stringOrNull(Settings.KEY_GRAPH_JSON) ?: EMPTY_GRAPH

    suspend fun saveWallpaperSnapshot(context: Context, workingSettings: SettingsStore, graphJson: String?) {
        workingSettings.awaitPendingWrites()
        val source = workingSettings.snapshot().values
        val graph = graphText(workingSettings, graphJson)
        SettingsStore.openWallpaper(context).updateAwait(Settings.KEY_GRAPH_REVISION) {
            clear()
            for ((key, value) in source) {
                if (
                    key == Settings.KEY_AUDIO_ACTIVE
                    || key == Settings.KEY_GRAPH_JSON
                    || key == Settings.KEY_GRAPH_REVISION
                ) continue
                this[key] = value
            }
            this[Settings.KEY_GRAPH_JSON] = StoredSetting.StringValue(graph)
            this[Settings.KEY_GRAPH_REVISION] = StoredSetting.LongValue(System.currentTimeMillis())
        }
    }

    suspend fun saveWorkingGraph(settings: SettingsStore, graphJson: String) {
        settings.updateAwait(Settings.KEY_GRAPH_REVISION) {
            this[Settings.KEY_GRAPH_JSON] = StoredSetting.StringValue(canonicalGraphText(graphJson))
            this[Settings.KEY_GRAPH_REVISION] = StoredSetting.LongValue(System.currentTimeMillis())
        }
    }

    fun saveWorkingGraphAsync(settings: SettingsStore, graphJson: String): Deferred<Unit> =
        settings.updateAsync(Settings.KEY_GRAPH_REVISION) {
            this[Settings.KEY_GRAPH_JSON] = StoredSetting.StringValue(canonicalGraphText(graphJson))
            this[Settings.KEY_GRAPH_REVISION] = StoredSetting.LongValue(System.currentTimeMillis())
        }

    suspend fun updateWorkingSettingsAndGraph(
        settings: SettingsStore,
        graphJson: String?,
        writeSettings: MutableMap<String, StoredSetting>.() -> Unit,
    ) {
        val graph = graphJson?.let { canonicalGraphText(it) }
        settings.updateAwait(if (graph == null) null else Settings.KEY_GRAPH_REVISION) {
            writeSettings()
            if (graph != null) {
                this[Settings.KEY_GRAPH_JSON] = StoredSetting.StringValue(graph)
                this[Settings.KEY_GRAPH_REVISION] = StoredSetting.LongValue(System.currentTimeMillis())
            }
        }
    }

    suspend fun saveUserPreset(
        context: Context,
        settings: SettingsStore,
        name: String,
        graphJson: String?,
    ): UserPreset {
        settings.awaitPendingWrites()
        val cleanName = name.trim().ifEmpty { timestampName() }
        val id = cleanName
            .lowercase(Locale.US)
            .replace(Regex("[^a-z0-9._-]+"), "-")
            .trim('-')
            .ifEmpty { timestampId() }
        val body = JSONObject()
            .put("name", cleanName)
            .put("created_at", System.currentTimeMillis())
            .put("settings", encodeSettings(settings.snapshot()))
            .put("graph", JSONObject(graphText(settings, graphJson)))
        return synchronized(presetFileLock) {
            val file = uniquePresetFile(context, id)
            writeJson(body, file)
            UserPreset(file.nameWithoutExtension, cleanName, file)
        }
    }

    fun listUserPresets(context: Context): List<UserPreset> {
        return synchronized(presetFileLock) {
            val dir = userPresetDir(context)
            val files = dir.listFiles { file -> file.isFile && file.extension == "json" }
                ?: return@synchronized emptyList()
            files.sortedBy { it.name }.mapNotNull { file ->
                val body = try {
                    JSONObject(readTextAtomic(file))
                } catch (_: Exception) {
                    return@mapNotNull null
                }
                val name = body.optString("name", file.nameWithoutExtension)
                UserPreset(file.nameWithoutExtension, name, file)
            }
        }
    }

    suspend fun loadUserPreset(preset: UserPreset, settings: SettingsStore) {
        val body = synchronized(presetFileLock) {
            JSONObject(readTextAtomic(preset.file))
        }
        val presetSettings = body.getJSONObject("settings")
        val graphJson = body.getJSONObject("graph").toString()
        val audioActive = settings.snapshot().boolean(Settings.KEY_AUDIO_ACTIVE, false)
        updateWorkingSettingsAndGraph(settings, graphJson) {
            clear()
            decodeSettings(presetSettings, this)
            if (audioActive) this[Settings.KEY_AUDIO_ACTIVE] = StoredSetting.BoolValue(true)
        }
    }

    fun readUserPresetGraph(preset: UserPreset): String =
        synchronized(presetFileLock) {
            JSONObject(readTextAtomic(preset.file)).getJSONObject("graph").toString()
        }

    fun deleteUserPreset(preset: UserPreset): Boolean =
        synchronized(presetFileLock) {
            AtomicFile(preset.file).delete()
            !preset.file.exists()
        }

    private fun encodeSettings(settings: SettingsSnapshot): JSONObject {
        val out = JSONObject()
        for ((key, value) in settings.values) {
            if (
                key == Settings.KEY_AUDIO_ACTIVE
                || key == Settings.KEY_GRAPH_JSON
                || key == Settings.KEY_GRAPH_REVISION
            ) continue
            out.put(key, encodeValue(value))
        }
        return out
    }

    private fun decodeSettings(settings: JSONObject, values: MutableMap<String, StoredSetting>) {
        val keys = settings.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val item = settings.getJSONObject(key)
            when (item.getString("type")) {
                "boolean" -> values[key] = StoredSetting.BoolValue(item.getBoolean("value"))
                "float" -> values[key] = StoredSetting.FloatValue(item.getDouble("value").toFloat())
                "int" -> values[key] = StoredSetting.IntValue(item.getInt("value"))
                "long" -> values[key] = StoredSetting.LongValue(item.getLong("value"))
                "string" -> values[key] = StoredSetting.StringValue(item.getString("value"))
            }
        }
    }

    private fun encodeValue(value: StoredSetting): JSONObject {
        val out = JSONObject()
        return when (value) {
            is StoredSetting.BoolValue -> out.put("type", "boolean").put("value", value.value)
            is StoredSetting.FloatValue -> out.put("type", "float").put("value", value.value.toDouble())
            is StoredSetting.IntValue -> out.put("type", "int").put("value", value.value)
            is StoredSetting.LongValue -> out.put("type", "long").put("value", value.value)
            is StoredSetting.StringValue -> out.put("type", "string").put("value", value.value)
        }
    }

    private fun writeJson(graph: JSONObject, target: File) {
        writeTextAtomic(graph.toString(), target)
    }

    private fun writeTextAtomic(text: String, target: File) {
        target.parentFile?.mkdirs()
        val atomic = AtomicFile(target)
        var stream: FileOutputStream? = null
        try {
            stream = atomic.startWrite()
            stream.write(text.toByteArray(Charsets.UTF_8))
            atomic.finishWrite(stream)
            stream = null
        } catch (e: Exception) {
            atomic.failWrite(stream)
            throw e
        }
    }

    private fun readTextAtomic(source: File): String =
        AtomicFile(source).openRead().use { stream ->
            stream.readBytes().toString(Charsets.UTF_8)
        }

    private fun graphText(settings: SettingsStore, graphJson: String?): String =
        if (graphJson.isNullOrBlank()) storedGraphJson(settings) else canonicalGraphText(graphJson)

    private fun canonicalGraphText(graphJson: String): String =
        JSONObject(graphJson).toString()

    private fun userPresetDir(context: Context): File =
        File(context.filesDir, USER_PRESETS_DIR).also { it.mkdirs() }

    private fun uniquePresetFile(context: Context, baseId: String): File {
        val dir = userPresetDir(context)
        var file = File(dir, "$baseId.json")
        var suffix = 2
        while (file.exists()) {
            file = File(dir, "$baseId-$suffix.json")
            suffix += 1
        }
        return file
    }

    private fun timestampName(): String =
        SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date())

    private fun timestampId(): String =
        SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())

}
