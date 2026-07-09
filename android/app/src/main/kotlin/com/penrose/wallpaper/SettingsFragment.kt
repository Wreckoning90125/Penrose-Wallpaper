package com.penrose.wallpaper

import android.app.WallpaperManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.HapticFeedbackConstants
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.GridView
import android.widget.ImageView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.widget.TooltipCompat
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.preference.ListPreference
import androidx.preference.Preference
import androidx.preference.PreferenceFragmentCompat
import androidx.preference.SeekBarPreference
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.penrose.wallpaper.atlas.AtlasCategory
import com.penrose.wallpaper.atlas.AtlasStore
import com.penrose.wallpaper.atlas.AtlasTarget
import com.penrose.wallpaper.audio.AudioControlsPreference
import com.penrose.wallpaper.audio.AudioPlaybackService
import com.penrose.wallpaper.preset.MaterialPreset
import com.penrose.wallpaper.preset.MaterialPresets
import com.penrose.wallpaper.preset.PresetStore
import com.penrose.wallpaper.preset.SettingsSnapshotStore
import com.penrose.wallpaper.preset.toStoredSetting
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Settings UI hosted inside the BottomSheetDialogFragment. The root
 * screen holds only the Actions block plus nav rows; each row swaps in
 * a category-specific XML so the sheet never becomes a single long
 * scroll. All audio-reactive modulation lives in the C++ node graph
 * reachable from the "Node editor" action.
 */
class SettingsFragment : PreferenceFragmentCompat(),
                         SettingsStore.Listener {

    private var currentScreen: ScreenKey = ScreenKey.Main
    private var applyingAtlasTarget = false
    private lateinit var settingsStore: SettingsStore
    private var settingsListenerRegistered = false

    private enum class ScreenKey(val resId: Int) {
        Main(R.xml.preferences),
        Tiling(R.xml.preferences_tiling),
        Color(R.xml.preferences_color),
        Borders(R.xml.preferences_borders),
        Motion(R.xml.preferences_motion),
        Projection(R.xml.preferences_projection),
        Material(R.xml.preferences_material),
        Background(R.xml.preferences_background),
        Audio(R.xml.preferences_audio),
        CustomPalette(R.xml.preferences_custom_palette),
    }

    private val pickAudio = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri != null) {
            try {
                requireContext().contentResolver.takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (_: SecurityException) { }
            AudioPlaybackService.start(requireContext().applicationContext, uri.toString())
            updateAudioSummary()
            // Service may have just come up. If we were on the Audio
            // screen with no live controller (initial connect failed
            // because the service wasn't running), connect now so the
            // controls row populates from the freshly-started session.
            if (currentScreen == ScreenKey.Audio && mediaController == null) {
                connectMediaController()
            }
        }
    }

    override fun onCreatePreferences(savedInstanceState: Bundle?, rootKey: String?) {
        preferenceScreen = preferenceManager.createPreferenceScreen(requireContext())
        SettingsStore.working(requireContext()).openAsync { store ->
            if (!isAdded) return@openAsync
            settingsStore = store
            preferenceManager.preferenceDataStore = SettingsPreferenceDataStore(store)
            loadScreen(currentScreen)
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                registerSettingsListener()
            }
        }
    }

    private fun loadScreen(screen: ScreenKey) {
        // Release the audio MediaController if we're leaving the Audio
        // screen — its AudioControlsPreference instance is about to be
        // destroyed by setPreferencesFromResource, and we don't want
        // the controller's listener + position poll firing against a
        // stale prefkey lookup.
        if (currentScreen == ScreenKey.Audio && screen != ScreenKey.Audio) {
            releaseMediaController()
        }
        currentScreen = screen
        setPreferencesFromResource(screen.resId, null)
        when (screen) {
            ScreenKey.Main -> bindMainActions()
            ScreenKey.Tiling -> {
                bindBack()
                bindAtlasControls()
                applyFamilySpecificTilingControls(resetSeed = false)
            }
            ScreenKey.Color -> {
                bindBack()
                findPreference<Preference>("nav_custom_palette")?.setOnPreferenceClickListener {
                    loadScreen(ScreenKey.CustomPalette)
                    true
                }
            }
            ScreenKey.Audio -> {
                bindBack()
                bindAudioRowActions()
                updateAudioSummary()
                connectMediaController()
            }
            ScreenKey.Material -> {
                bindBack()
                bindMaterialPresetRow()
            }
            ScreenKey.Borders,
            ScreenKey.Motion,
            ScreenKey.Projection,
            ScreenKey.Background,
            ScreenKey.CustomPalette -> bindBack()
        }
    }

    override fun onResume() {
        super.onResume()
        registerSettingsListener()
        if (currentScreen == ScreenKey.Audio) {
            updateAudioSummary()
            connectMediaController()
        }
    }

    override fun onPause() {
        super.onPause()
        unregisterSettingsListener()
        // Release the audio MediaController so the binder doesn't leak
        // while the fragment is off-screen. The audio service itself
        // keeps playing; only the in-app UI loses its tap into the
        // session until the fragment resumes.
        releaseMediaController()
    }

    private fun registerSettingsListener() {
        if (!::settingsStore.isInitialized || settingsListenerRegistered) return
        settingsStore.registerListener(this)
        settingsListenerRegistered = true
    }

    private fun unregisterSettingsListener() {
        if (!::settingsStore.isInitialized || !settingsListenerRegistered) return
        settingsStore.unregisterListener(this)
        settingsListenerRegistered = false
    }

    override fun onSettingChanged(key: String?) {
        if (applyingAtlasTarget) return
        if (currentScreen == ScreenKey.Tiling && key == Settings.KEY_FAMILY) {
            applyFamilySpecificTilingControls(resetSeed = true)
        }
        if (key != null && key !in atlasSelectionKeys) {
            clearAtlasTargetSelection()
        }
    }

    // -------------------- bindings --------------------

    private fun bindMainActions() {
        findPreference<Preference>("action_apply_wallpaper")?.setOnPreferenceClickListener {
            launchSystemWallpaperPicker()
            true
        }
        findPreference<Preference>("action_full_screen")?.setOnPreferenceClickListener {
            startActivity(Intent(requireContext(), FullScreenActivity::class.java)
                .putExtra(FullScreenActivity.EXTRA_SHOW_GRAPH, false))
            true
        }
        findPreference<Preference>("action_node_editor")?.setOnPreferenceClickListener {
            startActivity(Intent(requireContext(), FullScreenActivity::class.java)
                .putExtra(FullScreenActivity.EXTRA_SHOW_GRAPH, true))
            true
        }
        findPreference<Preference>("action_load_preset")?.setOnPreferenceClickListener {
            showPresetLoaderDialog()
            true
        }
        findPreference<Preference>("action_save_user_preset")?.setOnPreferenceClickListener {
            showSaveUserPresetDialog()
            true
        }
        findPreference<Preference>("action_load_user_preset")?.setOnPreferenceClickListener {
            showUserPresetLoaderDialog()
            true
        }
        findPreference<Preference>("action_delete_user_preset")?.setOnPreferenceClickListener {
            showUserPresetDeleteDialog()
            true
        }
        findPreference<Preference>("action_reset_view")?.setOnPreferenceClickListener {
            (activity as? SettingsActivity)?.resetPreviewView()
            true
        }
        findPreference<Preference>("nav_tiling")?.setOnPreferenceClickListener {
            loadScreen(ScreenKey.Tiling); true
        }
        findPreference<Preference>("nav_color")?.setOnPreferenceClickListener {
            loadScreen(ScreenKey.Color); true
        }
        findPreference<Preference>("nav_borders")?.setOnPreferenceClickListener {
            loadScreen(ScreenKey.Borders); true
        }
        findPreference<Preference>("nav_motion")?.setOnPreferenceClickListener {
            loadScreen(ScreenKey.Motion); true
        }
        findPreference<Preference>("nav_projection")?.setOnPreferenceClickListener {
            loadScreen(ScreenKey.Projection); true
        }
        findPreference<Preference>("nav_material")?.setOnPreferenceClickListener {
            loadScreen(ScreenKey.Material); true
        }
        findPreference<Preference>("nav_background")?.setOnPreferenceClickListener {
            loadScreen(ScreenKey.Background); true
        }
        findPreference<Preference>("nav_audio")?.setOnPreferenceClickListener {
            loadScreen(ScreenKey.Audio); true
        }
    }

    private fun bindAudioRowActions() {
        findPreference<Preference>("audio_file_uri")?.setOnPreferenceClickListener {
            pickAudio.launch(arrayOf("audio/*"))
            true
        }
        findPreference<Preference>("audio_stop")?.setOnPreferenceClickListener {
            AudioPlaybackService.stop(requireContext().applicationContext)
            updateAudioSummary()
            // The service tears down — our controller will see
            // playbackState → STATE_IDLE next tick, but we also clear
            // the visible state immediately so the row doesn't sit
            // showing the last track until the listener fires.
            findPreference<AudioControlsPreference>("audio_controls")
                ?.bind(false, false, null, null, null, 0L, 0L)
            true
        }
    }

    // --- MediaController for the live audio-controls row -----------------
    //
    // A MediaController bound to the running AudioPlaybackService gives the
    // settings UI the same view of playback the system media UI has: title,
    // artist, embedded artwork, play/pause state, position, duration. The
    // controller is connected when the Audio screen comes into the
    // foreground and released on pause / leave-screen so the binder
    // doesn't leak.

    private var mediaController: MediaController? = null
    private var mediaControllerFuture:
        com.google.common.util.concurrent.ListenableFuture<MediaController>? = null
    private val positionPoll = Handler(Looper.getMainLooper())
    private val positionTick = object : Runnable {
        override fun run() {
            pushControllerStateToPref()
            // Half-second cadence matches the SeekBar's per-second
            // granularity without burning the main thread.
            positionPoll.postDelayed(this, 500L)
        }
    }
    private val controllerListener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) { pushControllerStateToPref() }
        override fun onMediaMetadataChanged(metadata: MediaMetadata) { pushControllerStateToPref() }
        override fun onPlaybackStateChanged(playbackState: Int) { pushControllerStateToPref() }
        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int,
        ) { pushControllerStateToPref() }
    }

    private fun connectMediaController() {
        if (mediaController != null || mediaControllerFuture != null) return
        val ctx = requireContext().applicationContext
        val token = SessionToken(ctx, ComponentName(ctx, AudioPlaybackService::class.java))
        val future = MediaController.Builder(ctx, token).buildAsync()
        mediaControllerFuture = future
        future.addListener({
            // If the screen flipped away before connect, drop the result.
            if (mediaControllerFuture !== future) return@addListener
            mediaControllerFuture = null
            val controller = try {
                future.get()
            } catch (_: Exception) {
                // Service not running — bind the empty state on the
                // controls row so the user sees "No file selected".
                findPreference<AudioControlsPreference>("audio_controls")
                    ?.bind(false, false, null, null, null, 0L, 0L)
                null
            } ?: return@addListener
            mediaController = controller
            wireControlsPref(controller)
            controller.addListener(controllerListener)
            pushControllerStateToPref()
            positionPoll.removeCallbacks(positionTick)
            positionPoll.post(positionTick)
        }, ContextCompat.getMainExecutor(ctx))
    }

    private fun releaseMediaController() {
        positionPoll.removeCallbacks(positionTick)
        mediaControllerFuture?.let {
            // If we haven't finished connecting, release the future so
            // the resulting controller (if any) gets cleaned up
            // immediately when it arrives.
            MediaController.releaseFuture(it)
        }
        mediaControllerFuture = null
        mediaController?.let {
            it.removeListener(controllerListener)
            it.release()
        }
        mediaController = null
    }

    private fun wireControlsPref(controller: MediaController) {
        val pref = findPreference<AudioControlsPreference>("audio_controls") ?: return
        pref.onPlayPauseClick = {
            if (controller.isPlaying) controller.pause() else controller.play()
        }
        pref.onSeek = { posMs -> controller.seekTo(posMs) }
    }

    private fun pushControllerStateToPref() {
        val pref = findPreference<AudioControlsPreference>("audio_controls") ?: return
        val c = mediaController
        if (c == null || c.currentMediaItem == null) {
            pref.bind(false, false, null, null, null, 0L, 0L)
            return
        }
        val md = c.mediaMetadata
        val art = md.artworkData?.let { bytes ->
            try { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) } catch (_: Exception) { null }
        }
        val duration = c.duration.let { if (it < 0) 0L else it }
        pref.bind(
            hasTrack      = true,
            isPlaying     = c.isPlaying,
            title         = md.title?.toString(),
            artist        = md.artist?.toString(),
            artworkBitmap = art,
            positionMs    = c.currentPosition.coerceAtLeast(0L),
            durationMs    = duration,
        )
    }

    private fun bindBack() {
        findPreference<Preference>("nav_back")?.setOnPreferenceClickListener {
            loadScreen(ScreenKey.Main)
            true
        }
    }

    private fun bindAtlasControls() {
        val categoryPref = findPreference<ListPreference>(Settings.KEY_ATLAS_CATEGORY) ?: return
        val targetPref = findPreference<ListPreference>(Settings.KEY_ATLAS_TARGET) ?: return
        val snapshot = settingsStore.snapshot()
        val categories = AtlasStore(requireContext()).categories()
        if (categories.isEmpty()) {
            categoryPref.isEnabled = false
            categoryPref.summary = "Atlas unavailable"
            targetPref.isEnabled = false
            targetPref.summary = "Atlas unavailable"
            return
        }

        categoryPref.entries = categories.map { it.label }.toTypedArray()
        categoryPref.entryValues = categories.map { it.id }.toTypedArray()
        categoryPref.isEnabled = true
        targetPref.isEnabled = true

        val savedCategoryId = snapshot.stringOrNull(Settings.KEY_ATLAS_CATEGORY)
        val category = categories.firstOrNull { it.id == savedCategoryId } ?: categories.first()
        categoryPref.value = category.id

        bindAtlasTargetList(targetPref, category, snapshot)

        categoryPref.setOnPreferenceChangeListener { _, value ->
            val nextCategory = categories.firstOrNull { it.id == value as? String }
                ?: return@setOnPreferenceChangeListener false
            val firstTarget = nextCategory.targets.firstOrNull()
                ?: return@setOnPreferenceChangeListener false
            applyAtlasTarget(nextCategory.id, firstTarget)
            false
        }

        targetPref.setOnPreferenceChangeListener { _, value ->
            val nextTarget = category.targets.firstOrNull { it.id == value as? String }
                ?: return@setOnPreferenceChangeListener false
            applyAtlasTarget(category.id, nextTarget)
            false
        }
    }

    private fun bindAtlasTargetList(
        targetPref: ListPreference,
        category: AtlasCategory,
        snapshot: SettingsSnapshot,
    ) {
        targetPref.entries = category.targets.map { it.name }.toTypedArray()
        targetPref.entryValues = category.targets.map { it.id }.toTypedArray()
        if (category.targets.isEmpty()) {
            targetPref.value = null
            targetPref.isEnabled = false
            targetPref.summary = "No targets"
            return
        }
        val savedTargetId = snapshot.stringOrNull(Settings.KEY_ATLAS_TARGET)
        val target = savedTargetId?.let { id -> category.targets.firstOrNull { it.id == id } }
        if (target == null) {
            targetPref.value = null
            targetPref.summary = "Choose target"
            return
        }
        targetPref.value = target.id
        targetPref.summary = "%s"
    }

    private fun applyAtlasTarget(categoryId: String, target: AtlasTarget) {
        applyingAtlasTarget = true
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    settingsStore.updateAwait {
                        this[Settings.KEY_ATLAS_CATEGORY] = StoredSetting.StringValue(categoryId)
                        this[Settings.KEY_ATLAS_TARGET] = StoredSetting.StringValue(target.id)
                        for ((key, value) in target.settings) {
                            this[key] = value.toStoredSetting()
                        }
                    }
                }
                loadScreen(ScreenKey.Tiling)
                Toast.makeText(requireContext(), target.name, Toast.LENGTH_SHORT).show()
            } finally {
                applyingAtlasTarget = false
            }
        }
    }

    private fun clearAtlasTargetSelection() {
        if (!settingsStore.snapshot().contains(Settings.KEY_ATLAS_TARGET)) return
        settingsStore.removeAsync(Settings.KEY_ATLAS_TARGET)
        if (currentScreen == ScreenKey.Tiling) {
            findPreference<ListPreference>(Settings.KEY_ATLAS_TARGET)?.let { targetPref ->
                targetPref.value = null
                targetPref.summary = "Choose target"
            }
        }
    }

    /**
     * The Material-preset row. Opens a 2-column grid of tile thumbnails
     * (see `tools/bake_preset_thumbnails.py` — transparent background,
     * tile-shaped fill). Each cell IS the tile: no label, no
     * rectangular container, no chrome around it. The tile is a
     * keyboard-key whose "hole" is the tile shape, and tapping it
     * applies the preset — a one-shot write to the settings store,
     * the Material screen re-inflates so every slider re-binds to the
     * new values, and the dialog dismisses. There is no stored
     * "active preset" state.
     *
     * The dialog is built with MaterialAlertDialogBuilder so the
     * surface, title, button and corners follow Material 3 styling
     * from the host theme; the cancel button hooks the system's
     * cancel string.
     *
     * Press feedback is @animator/preset_tile_press attached via
     * android:stateListAnimator in preset_picker_item.xml — the tile
     * scales to ~93% on press and springs back, so the cell reads as
     * pressing into the screen. No colour highlight is drawn behind
     * the tile.
     *
     * NOTE: the click listener is wired on each cell View *inside* the
     * adapter (PresetPickerAdapter.onPickClick), NOT on the GridView
     * via setOnItemClickListener. The cell ImageView carries
     * android:clickable="true" so the stateListAnimator can fire on
     * press, but a clickable child consumes the touch event before
     * AdapterView's item-click dispatch sees it — wiring
     * setOnItemClickListener on the GridView is silently dead in this
     * configuration. Do NOT switch back to setOnItemClickListener
     * without also stripping clickable/focusable from the cell layout
     * (which would lose the press animation).
     */
    private fun bindMaterialPresetRow() {
        findPreference<Preference>("material_preset_pick")?.setOnPreferenceClickListener {
            val ctx = requireContext()
            val presets = MaterialPresets.all
            val grid = LayoutInflater.from(ctx)
                .inflate(R.layout.preset_picker_grid, null) as GridView

            val dialog = MaterialAlertDialogBuilder(ctx)
                .setTitle("Material preset")
                .setView(grid)
                .setNegativeButton(android.R.string.cancel, null)
                .show()

            grid.adapter = PresetPickerAdapter(ctx, presets) { which ->
                val preset = presets[which]
                viewLifecycleOwner.lifecycleScope.launch {
                    try {
                        withContext(Dispatchers.IO) {
                            settingsStore.updateAwait {
                                for ((key, value) in preset.values) {
                                    this[key] = StoredSetting.IntValue(value)
                                }
                            }
                        }
                        loadScreen(ScreenKey.Material)
                        Toast.makeText(ctx, preset.name, Toast.LENGTH_SHORT).show()
                        dialog.dismiss()
                    } catch (e: Exception) {
                        Toast.makeText(ctx, R.string.preset_apply_failed_toast, Toast.LENGTH_LONG).show()
                    }
                }
            }
            true
        }
    }

    /**
     * GridView cell adapter: each cell is a single ImageView holding the
     * baked tile thumbnail (transparent background, tile-shaped fill).
     * No on-screen label, no rectangular container — the cell IS the
     * tile.
     *
     * Press feedback is the @animator/preset_tile_press stateListAnimator
     * applied in preset_picker_item.xml: the tile scales to ~93% on
     * press and springs back on release, so a tap reads as physically
     * pressing the key into the screen. No colour highlight, no
     * rectangular ripple — the tile silhouette stays the visible
     * shape throughout. A KEYBOARD_TAP haptic on click pairs the
     * visual with a physical tick.
     *
     * setOnClickListener is wired here on every getView call rather
     * than via GridView.setOnItemClickListener — a clickable child
     * (the ImageView itself, since android:clickable="true") consumes
     * the touch event before AdapterView's item-click dispatch sees
     * it. See bindMaterialPresetRow for the long version.
     *
     * contentDescription + tooltip carry the preset name (screen
     * reader + long-press) since there is no on-screen label.
     */
    private class PresetPickerAdapter(
        ctx: Context,
        private val presets: List<MaterialPreset>,
        private val onPickClick: (Int) -> Unit,
    ) : ArrayAdapter<MaterialPreset>(ctx, R.layout.preset_picker_item, presets) {
        private val inflater = LayoutInflater.from(ctx)

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val image = (convertView as? ImageView)
                ?: inflater.inflate(R.layout.preset_picker_item, parent, false) as ImageView
            val preset = presets[position]
            image.setImageResource(preset.thumbnailRes)
            image.contentDescription = preset.name
            TooltipCompat.setTooltipText(image, preset.name)
            image.setOnClickListener {
                it.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                onPickClick(position)
            }
            return image
        }
    }

    /**
     * Hook the bottom-sheet dialog calls when the system back button
     * fires. Returns true if a sub-settings screen was popped to the main
     * screen (the dialog should stay open); false when we're already
     * on the main screen (the dialog handles back itself by
     * dismissing).
     */
    fun popBackToMainIfNeeded(): Boolean {
        if (currentScreen == ScreenKey.Main) return false
        loadScreen(ScreenKey.Main)
        return true
    }

    private fun launchSystemWallpaperPicker() {
        val ctx = requireContext()
        val host = activity as? SettingsActivity
        val component = ComponentName(ctx, PenroseWallpaperService::class.java)
        val intent = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).apply {
            putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
        }
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    host?.commitPreviewViewToSettingsAwait()
                    SettingsSnapshotStore.saveWallpaperSnapshot(ctx, settingsStore, host?.currentGraphJson())
                }
            } catch (e: Exception) {
                Toast.makeText(ctx, R.string.wallpaper_snapshot_failed_toast, Toast.LENGTH_LONG).show()
                return@launch
            }
            try { startActivity(intent) } catch (_: Exception) {
                Toast.makeText(ctx, R.string.launcher_no_picker, Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun showPresetLoaderDialog() {
        val ctx = requireContext()
        val store = PresetStore(ctx)
        viewLifecycleOwner.lifecycleScope.launch {
            val presets = withContext(Dispatchers.IO) { store.list() }
            if (presets.isEmpty()) {
                Toast.makeText(ctx, "No presets bundled.", Toast.LENGTH_SHORT).show()
                return@launch
            }
            val labels = presets.map { it.name }.toTypedArray()
            AlertDialog.Builder(ctx)
                .setTitle(R.string.preset_load_title)
                .setItems(labels) { _, which ->
                    val preset = presets[which]
                    val host = activity as? SettingsActivity
                    val previousGraph = host?.currentGraphJson()
                    viewLifecycleOwner.lifecycleScope.launch {
                        try {
                            preset.graphJson?.let { graphJson ->
                                val loaded = host?.applyPresetGraph(graphJson) ?: false
                                if (!loaded) throw IllegalStateException("graph load failed for preset ${preset.id}")
                            }
                            withContext(Dispatchers.IO) { store.applyToSettings(preset, settingsStore) }
                            loadScreen(currentScreen)
                            Toast.makeText(ctx, preset.name, Toast.LENGTH_SHORT).show()
                        } catch (e: Exception) {
                            if (preset.graphJson != null && previousGraph != null) host?.applyPresetGraph(previousGraph)
                            Toast.makeText(ctx, R.string.preset_apply_failed_toast, Toast.LENGTH_LONG).show()
                        }
                    }
                }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
        }
    }

    private fun showSaveUserPresetDialog() {
        val ctx = requireContext()
        val input = EditText(ctx).apply {
            setSingleLine(true)
            setText("")
            hint = getString(R.string.preset_save_user_hint)
        }
        MaterialAlertDialogBuilder(ctx)
            .setTitle(R.string.preset_save_user_title)
            .setView(input)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                val host = activity as? SettingsActivity
                val name = input.text.toString()
                viewLifecycleOwner.lifecycleScope.launch {
                    try {
                        val preset = withContext(Dispatchers.IO) {
                            host?.commitPreviewViewToSettingsAwait()
                            SettingsSnapshotStore.saveUserPreset(
                                ctx,
                                settingsStore,
                                name,
                                host?.currentGraphJson(),
                            )
                        }
                        Toast.makeText(ctx, getString(R.string.preset_saved_user_toast, preset.name), Toast.LENGTH_SHORT).show()
                    } catch (e: Exception) {
                        Toast.makeText(ctx, R.string.preset_save_failed_toast, Toast.LENGTH_LONG).show()
                    }
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun showUserPresetLoaderDialog() {
        val ctx = requireContext()
        viewLifecycleOwner.lifecycleScope.launch {
            val presets = withContext(Dispatchers.IO) { SettingsSnapshotStore.listUserPresets(ctx) }
            if (presets.isEmpty()) {
                Toast.makeText(ctx, R.string.preset_no_saved_user_toast, Toast.LENGTH_SHORT).show()
                return@launch
            }
            val labels = presets.map { it.name }.toTypedArray()
            AlertDialog.Builder(ctx)
                .setTitle(R.string.preset_load_user_title)
                .setItems(labels) { _, which ->
                    val preset = presets[which]
                    val host = activity as? SettingsActivity
                    val previousGraph = host?.currentGraphJson()
                    viewLifecycleOwner.lifecycleScope.launch {
                        try {
                            val graphJson = withContext(Dispatchers.IO) { SettingsSnapshotStore.readUserPresetGraph(preset) }
                            val loaded = host?.applyPresetGraph(graphJson) ?: false
                            if (!loaded) throw IllegalStateException("graph load failed for user preset ${preset.id}")
                            withContext(Dispatchers.IO) { SettingsSnapshotStore.loadUserPreset(preset, settingsStore) }
                            loadScreen(currentScreen)
                            Toast.makeText(ctx, preset.name, Toast.LENGTH_SHORT).show()
                        } catch (e: Exception) {
                            if (previousGraph != null) host?.applyPresetGraph(previousGraph)
                            Toast.makeText(ctx, R.string.preset_apply_failed_toast, Toast.LENGTH_LONG).show()
                        }
                    }
                }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
        }
    }

    private fun showUserPresetDeleteDialog() {
        val ctx = requireContext()
        viewLifecycleOwner.lifecycleScope.launch {
            val presets = withContext(Dispatchers.IO) { SettingsSnapshotStore.listUserPresets(ctx) }
            if (presets.isEmpty()) {
                Toast.makeText(ctx, R.string.preset_no_saved_user_toast, Toast.LENGTH_SHORT).show()
                return@launch
            }
            val labels = presets.map { it.name }.toTypedArray()
            AlertDialog.Builder(ctx)
                .setTitle(R.string.preset_delete_user_title)
                .setItems(labels) { _, which ->
                    val preset = presets[which]
                    viewLifecycleOwner.lifecycleScope.launch {
                        val deleted = withContext(Dispatchers.IO) { SettingsSnapshotStore.deleteUserPreset(preset) }
                        if (deleted) {
                            Toast.makeText(ctx, getString(R.string.preset_deleted_user_toast, preset.name), Toast.LENGTH_SHORT).show()
                        }
                    }
                }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
        }
    }

    private fun applyFamilySpecificTilingControls(resetSeed: Boolean) {
        applySeedListForCurrentFamily(resetSeed)
        applyGenerationMaxForCurrentFamily()
    }

    private fun applySeedListForCurrentFamily(resetSeed: Boolean) {
        val seedPref = findPreference<ListPreference>(Settings.KEY_SEED) ?: return
        val familyPref = findPreference<ListPreference>(Settings.KEY_FAMILY) ?: return
        val family = familyPref.value?.toIntOrNull() ?: 0
        val (entriesId, valuesId) = when (family) {
            1 -> R.array.seed_p2_entries to R.array.seed_p2_values
            2 -> R.array.seed_chair_entries to R.array.seed_chair_values
            3 -> R.array.seed_dodeca_entries to R.array.seed_dodeca_values
            4 -> R.array.seed_pinwheel_entries to R.array.seed_pinwheel_values
            5 -> R.array.seed_ammannbeenker_entries to R.array.seed_ammannbeenker_values
            6 -> R.array.seed_heptagonal_entries to R.array.seed_heptagonal_values
            7 -> R.array.seed_binary_entries to R.array.seed_binary_values
            8 -> R.array.seed_tuebingen_entries to R.array.seed_tuebingen_values
            9 -> R.array.seed_p1_entries to R.array.seed_p1_values
            10 -> R.array.seed_danzer_entries to R.array.seed_danzer_values
            11 -> R.array.seed_hat_entries to R.array.seed_hat_values
            12 -> R.array.seed_spectre_entries to R.array.seed_spectre_values
            13 -> R.array.seed_equithirds_entries to R.array.seed_equithirds_values
            14 -> R.array.seed_cromwell_krt_entries to R.array.seed_cromwell_krt_values
            15 -> R.array.seed_gailiunas_spiral_entries to R.array.seed_gailiunas_spiral_values
            16 -> R.array.seed_cairo_entries to R.array.seed_cairo_values
            17 -> R.array.seed_socolar_taylor_entries to R.array.seed_socolar_taylor_values
            18 -> R.array.seed_d4_substitution_entries to R.array.seed_d4_substitution_values
            else -> R.array.seed_p3_entries to R.array.seed_p3_values
        }
        val entries = resources.getStringArray(entriesId)
        val values = resources.getStringArray(valuesId)
        seedPref.entries = entries
        seedPref.entryValues = values
        if (resetSeed || seedPref.value == null || !values.contains(seedPref.value)) {
            seedPref.value = values[0]
        }
    }

    private fun applyGenerationMaxForCurrentFamily() {
        val generationPref = findPreference<SeekBarPreference>(Settings.KEY_GENERATION) ?: return
        val familyPref = findPreference<ListPreference>(Settings.KEY_FAMILY) ?: return
        val family = familyPref.value?.toIntOrNull() ?: 0
        val layeredMonotile = family == 11 || family == 12
        generationPref.title = getString(
            if (layeredMonotile) R.string.tiling_layer_title else R.string.tiling_generation_title
        )
        generationPref.summary = getString(
            if (layeredMonotile) R.string.tiling_layer_summary else R.string.tiling_generation_summary
        )
        val maxGen = when (family) {
            2 -> 7       // Chair
            4 -> 6       // Pinwheel
            9, 10, 17 -> 7   // P1, Danzer, Socolar-Taylor
            13 -> 10     // Equithirds
            12 -> 3      // Spectre
            11 -> 4      // Hat
            14 -> 5      // Cromwell KRT
            15, 16, 18 -> 8  // Gailiunas spirals, Cairo pentagons, experimental D4 square weave
            else -> 8
        }
        generationPref.max = maxGen
        if (generationPref.value > maxGen) {
            generationPref.value = maxGen
        }
    }

    private fun updateAudioSummary() {
        if (currentScreen != ScreenKey.Audio) return
        val pref = findPreference<Preference>("audio_file_uri") ?: return
        val name = AudioPlaybackService.currentDisplayName
        pref.summary = name ?: getString(R.string.audio_file_none)
    }

    private companion object {
        val atlasSelectionKeys = setOf(
            Settings.KEY_ATLAS_CATEGORY,
            Settings.KEY_ATLAS_TARGET,
        )
    }
}
