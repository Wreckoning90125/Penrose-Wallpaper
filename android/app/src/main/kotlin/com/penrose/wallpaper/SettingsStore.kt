package com.penrose.wallpaper

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStoreFile
import androidx.preference.PreferenceDataStore
import java.util.concurrent.CopyOnWriteArraySet
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first

internal sealed class StoredSetting {
    data class BoolValue(val value: Boolean) : StoredSetting()
    data class FloatValue(val value: Float) : StoredSetting()
    data class IntValue(val value: Int) : StoredSetting()
    data class LongValue(val value: Long) : StoredSetting()
    data class StringValue(val value: String) : StoredSetting()
}

internal data class SettingsSnapshot(
    val values: Map<String, StoredSetting>,
) {
    fun contains(key: String): Boolean = values.containsKey(key)

    fun boolean(key: String, default: Boolean): Boolean =
        when (val value = values[key]) {
            is StoredSetting.BoolValue -> value.value
            else -> default
        }

    fun float(key: String, default: Float): Float =
        when (val value = values[key]) {
            is StoredSetting.FloatValue -> value.value
            is StoredSetting.IntValue -> value.value.toFloat()
            is StoredSetting.LongValue -> value.value.toFloat()
            else -> default
        }

    fun int(key: String, default: Int): Int =
        when (val value = values[key]) {
            is StoredSetting.IntValue -> value.value
            is StoredSetting.LongValue -> value.value.toInt()
            else -> default
        }

    fun long(key: String, default: Long): Long =
        when (val value = values[key]) {
            is StoredSetting.LongValue -> value.value
            is StoredSetting.IntValue -> value.value.toLong()
            else -> default
        }

    fun string(key: String, default: String): String =
        when (val value = values[key]) {
            is StoredSetting.StringValue -> value.value
            else -> default
        }

    fun stringOrNull(key: String): String? =
        when (val value = values[key]) {
            is StoredSetting.StringValue -> value.value
            else -> null
        }
}

internal class SettingsStore private constructor(
    context: Context,
    name: String,
) {
    fun interface Listener {
        fun onSettingChanged(key: String?)
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val dataStore: DataStore<Preferences> = PreferenceDataStoreFactory.create(
        scope = scope,
        produceFile = { context.preferencesDataStoreFile(name) },
    )
    private val mainHandler = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<Listener>()
    private val lock = Any()
    private var current = SettingsSnapshot(emptyMap())
    private var ready = false

    fun snapshot(): SettingsSnapshot = synchronized(lock) { current }

    fun settings(): Settings = Settings.load(snapshot())

    fun isReady(): Boolean = synchronized(lock) { ready }

    suspend fun awaitReady(): SettingsStore {
        if (isReady()) return this
        val initial = snapshotFromPreferences(dataStore.data.first())
        synchronized(lock) {
            if (!ready) {
                current = initial
                ready = true
            }
        }
        return this
    }

    fun openAsync(onReady: (SettingsStore) -> Unit) {
        scope.async { awaitReady() }.invokeOnCompletion { cause ->
            if (cause != null) {
                Log.e(TAG, "settings open failed", cause)
            } else {
                mainHandler.post { onReady(this) }
            }
        }
    }

    fun registerListener(listener: Listener) {
        listeners.add(listener)
    }

    fun unregisterListener(listener: Listener) {
        listeners.remove(listener)
    }

    fun putAsync(key: String, value: StoredSetting): Deferred<Unit> =
        enqueueWrite(key) { preferences -> preferences.putSetting(key, value) }

    fun removeAsync(key: String): Deferred<Unit> =
        enqueueWrite(key) { preferences -> preferences.removeSetting(key) }

    fun updateAsync(changedKey: String? = null, write: MutableMap<String, StoredSetting>.() -> Unit): Deferred<Unit> =
        enqueueWrite(changedKey) { preferences ->
            val values = snapshotFromPreferences(preferences).values.toMutableMap()
            values.write()
            preferences.clear()
            for ((key, value) in values) preferences.putSetting(key, value)
        }

    suspend fun updateAwait(changedKey: String? = null, write: MutableMap<String, StoredSetting>.() -> Unit) {
        appendWrite(changedKey) { preferences ->
            val values = snapshotFromPreferences(preferences).values.toMutableMap()
            values.write()
            preferences.clear()
            for ((key, value) in values) preferences.putSetting(key, value)
        }.await()
    }

    suspend fun awaitPendingWrites() {
        val tail = synchronized(writeQueueLock) { writeTail }
        tail?.await()
    }

    private val writeQueueLock = Any()
    private var writeTail: Deferred<Unit>? = null

    private fun enqueueWrite(changedKey: String?, mutate: (MutablePreferences) -> Unit): Deferred<Unit> {
        val task = appendWrite(changedKey, mutate)
        task.invokeOnCompletion { cause ->
            if (cause != null) Log.e(TAG, "settings write failed", cause)
        }
        return task
    }

    private fun appendWrite(
        changedKey: String?,
        mutate: (MutablePreferences) -> Unit,
    ): Deferred<Unit> =
        synchronized(writeQueueLock) {
            val previous = writeTail
            val task = scope.async {
                try {
                    previous?.await()
                } catch (_: Exception) { }
                val next = dataStore.edit { preferences -> mutate(preferences) }
                publishSnapshot(next, changedKey)
            }
            writeTail = task
            task
        }

    private fun publishSnapshot(next: Preferences, changedKey: String?) {
        synchronized(lock) {
            current = snapshotFromPreferences(next)
            ready = true
        }
        notifyListeners(changedKey)
    }

    private fun notifyListeners(key: String?) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            for (listener in listeners) listener.onSettingChanged(key)
            return
        }
        mainHandler.post {
            for (listener in listeners) listener.onSettingChanged(key)
        }
    }

    private fun MutablePreferences.putSetting(key: String, value: StoredSetting) {
        removeSetting(key)
        when (value) {
            is StoredSetting.BoolValue -> this[booleanPreferencesKey(key)] = value.value
            is StoredSetting.FloatValue -> this[floatPreferencesKey(key)] = value.value
            is StoredSetting.IntValue -> this[intPreferencesKey(key)] = value.value
            is StoredSetting.LongValue -> this[longPreferencesKey(key)] = value.value
            is StoredSetting.StringValue -> this[stringPreferencesKey(key)] = value.value
        }
    }

    private fun MutablePreferences.removeSetting(key: String) {
        remove(booleanPreferencesKey(key))
        remove(floatPreferencesKey(key))
        remove(intPreferencesKey(key))
        remove(longPreferencesKey(key))
        remove(stringPreferencesKey(key))
    }

    companion object {
        private const val TAG = "PenroseSettingsStore"
        private const val WALLPAPER_STORE_NAME = "penrose_wallpaper_snapshot"

        private var workingStore: SettingsStore? = null
        private var wallpaperStore: SettingsStore? = null

        fun working(context: Context): SettingsStore =
            synchronized(this) {
                workingStore ?: SettingsStore(
                    context.applicationContext,
                    Settings.PREFS_NAME,
                ).also { workingStore = it }
            }

        suspend fun openWorking(context: Context): SettingsStore =
            working(context).awaitReady()

        fun wallpaper(context: Context): SettingsStore =
            synchronized(this) {
                wallpaperStore ?: SettingsStore(
                    context.applicationContext,
                    WALLPAPER_STORE_NAME,
                ).also { wallpaperStore = it }
            }

        suspend fun openWallpaper(context: Context): SettingsStore =
            wallpaper(context).awaitReady()
    }
}

internal class SettingsPreferenceDataStore(
    private val store: SettingsStore,
) : PreferenceDataStore() {
    override fun getBoolean(key: String?, defValue: Boolean): Boolean =
        key?.let { store.snapshot().boolean(it, defValue) } ?: defValue

    override fun getFloat(key: String?, defValue: Float): Float =
        key?.let { store.snapshot().float(it, defValue) } ?: defValue

    override fun getInt(key: String?, defValue: Int): Int =
        key?.let { store.snapshot().int(it, defValue) } ?: defValue

    override fun getLong(key: String?, defValue: Long): Long =
        key?.let { store.snapshot().long(it, defValue) } ?: defValue

    override fun getString(key: String?, defValue: String?): String? =
        key?.let { store.snapshot().stringOrNull(it) ?: defValue } ?: defValue

    override fun putBoolean(key: String?, value: Boolean) {
        if (key != null) store.putAsync(key, StoredSetting.BoolValue(value))
    }

    override fun putFloat(key: String?, value: Float) {
        if (key != null) store.putAsync(key, StoredSetting.FloatValue(value))
    }

    override fun putInt(key: String?, value: Int) {
        if (key != null) store.putAsync(key, StoredSetting.IntValue(value))
    }

    override fun putLong(key: String?, value: Long) {
        if (key != null) store.putAsync(key, StoredSetting.LongValue(value))
    }

    override fun putString(key: String?, value: String?) {
        if (key == null) return
        if (value == null) store.removeAsync(key) else store.putAsync(key, StoredSetting.StringValue(value))
    }
}

private fun snapshotFromPreferences(preferences: Preferences): SettingsSnapshot {
    val values = LinkedHashMap<String, StoredSetting>()
    for ((key, value) in preferences.asMap()) {
        val stored = when (value) {
            is Boolean -> StoredSetting.BoolValue(value)
            is Float -> StoredSetting.FloatValue(value)
            is Int -> StoredSetting.IntValue(value)
            is Long -> StoredSetting.LongValue(value)
            is String -> StoredSetting.StringValue(value)
            else -> null
        }
        if (stored != null) values[key.name] = stored
    }
    return SettingsSnapshot(values)
}
