package com.penrose.wallpaper

import android.app.WallpaperManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.GridView
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.preference.ListPreference
import androidx.preference.Preference
import androidx.preference.PreferenceFragmentCompat
import androidx.preference.SeekBarPreference
import com.penrose.wallpaper.audio.AudioPlaybackService
import com.penrose.wallpaper.preset.MaterialPreset
import com.penrose.wallpaper.preset.MaterialPresets
import com.penrose.wallpaper.preset.PresetStore

/**
 * Settings UI hosted inside the BottomSheetDialogFragment. The root
 * screen holds only the Actions block plus nav rows; each row swaps in
 * a category-specific XML so the sheet never becomes a single long
 * scroll. All audio-reactive modulation lives in the C++ node graph
 * reachable from the "Node editor" action.
 */
class SettingsFragment : PreferenceFragmentCompat(),
                         SharedPreferences.OnSharedPreferenceChangeListener {

    private var currentScreen: ScreenKey = ScreenKey.Main

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
        }
    }

    override fun onCreatePreferences(savedInstanceState: Bundle?, rootKey: String?) {
        preferenceManager.sharedPreferencesName = Settings.PREFS_NAME
        loadScreen(currentScreen)
    }

    private fun loadScreen(screen: ScreenKey) {
        currentScreen = screen
        setPreferencesFromResource(screen.resId, null)
        when (screen) {
            ScreenKey.Main -> bindMainActions()
            ScreenKey.Tiling -> {
                bindBack()
                applySeedListForCurrentFamily()
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
        preferenceManager.sharedPreferences
            ?.registerOnSharedPreferenceChangeListener(this)
        if (currentScreen == ScreenKey.Audio) updateAudioSummary()
    }

    override fun onPause() {
        super.onPause()
        preferenceManager.sharedPreferences
            ?.unregisterOnSharedPreferenceChangeListener(this)
    }

    override fun onSharedPreferenceChanged(sp: SharedPreferences?, key: String?) {
        if (currentScreen == ScreenKey.Tiling && key == Settings.KEY_FAMILY) {
            applySeedListForCurrentFamily()
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
            true
        }
    }

    private fun bindBack() {
        findPreference<Preference>("nav_back")?.setOnPreferenceClickListener {
            loadScreen(ScreenKey.Main)
            true
        }
    }

    /**
     * The Material-preset row. Opens a 2-column grid of preset tile
     * thumbnails (see `tools/bake_preset_thumbnails.py` — transparent
     * background so the dialog reads as clean tiles, not boxed images).
     * The tile itself is the selector — tap a tile to apply that preset.
     * Material's selectableItemBackground gives a ripple on touch so
     * each tile responds like an interactive button. Picking a preset
     * is a one-shot apply: its values are written into SharedPreferences
     * and the Material screen re-inflates so every slider re-binds to
     * the new values. There is no stored "active preset" state.
     */
    private fun bindMaterialPresetRow() {
        findPreference<Preference>("material_preset_pick")?.setOnPreferenceClickListener {
            val ctx = requireContext()
            val presets = MaterialPresets.all
            val grid = LayoutInflater.from(ctx)
                .inflate(R.layout.preset_picker_grid, null) as GridView
            grid.adapter = PresetPickerAdapter(ctx, presets)

            val dialog = AlertDialog.Builder(ctx)
                .setTitle("Material preset")
                .setView(grid)
                .setNegativeButton(android.R.string.cancel, null)
                .show()

            grid.setOnItemClickListener { _, _, which, _ ->
                val prefs = preferenceManager.sharedPreferences
                    ?: return@setOnItemClickListener
                val editor = prefs.edit()
                for ((key, value) in presets[which].values) {
                    editor.putInt(key, value)
                }
                editor.apply()
                loadScreen(ScreenKey.Material)
                Toast.makeText(ctx, presets[which].name, Toast.LENGTH_SHORT).show()
                dialog.dismiss()
            }
            true
        }
    }

    /**
     * GridView cell adapter: each cell is the baked transparent-background
     * thumbnail above the preset name, with selectableItemBackground on
     * the cell root so a tap shows the Material ripple over the tile.
     */
    private class PresetPickerAdapter(
        ctx: Context,
        private val presets: List<MaterialPreset>,
    ) : ArrayAdapter<MaterialPreset>(ctx, R.layout.preset_picker_item, presets) {
        private val inflater = LayoutInflater.from(ctx)
        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val view = convertView
                ?: inflater.inflate(R.layout.preset_picker_item, parent, false)
            val preset = presets[position]
            view.findViewById<ImageView>(R.id.preset_thumbnail)
                .setImageResource(preset.thumbnailRes)
            view.findViewById<TextView>(R.id.preset_name).text = preset.name
            return view
        }
    }

    /**
     * Hook the bottom-sheet dialog calls when the system back button
     * fires. Returns true if a sub-pref-screen was popped to the main
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
        val component = ComponentName(ctx, PenroseWallpaperService::class.java)
        val intent = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).apply {
            putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
        }
        try { startActivity(intent) } catch (_: Exception) {
            Toast.makeText(ctx, R.string.launcher_no_picker, Toast.LENGTH_LONG).show()
        }
    }

    private fun showPresetLoaderDialog() {
        val ctx = requireContext()
        val store = PresetStore(ctx)
        val presets = store.list()
        if (presets.isEmpty()) {
            Toast.makeText(ctx, "No presets bundled.", Toast.LENGTH_SHORT).show()
            return
        }
        val labels = presets.map { it.name }.toTypedArray()
        AlertDialog.Builder(ctx)
            .setTitle(R.string.preset_load_title)
            .setItems(labels) { _, which ->
                val preset = presets[which]
                val prefs = preferenceManager.sharedPreferences ?: return@setItems
                store.applyToPrefs(preset, prefs)
                // Push the graph straight into the host activity's
                // active Renderer too — applyToPrefs only wrote it to
                // filesDir, which the live preview wouldn't reflect
                // until a teardown + relaunch. Only when the preset
                // actually ships a graph: a colours-only preset must
                // leave the user's current graph untouched, both on
                // disk (handled in applyToPrefs) and live here.
                preset.graphJson?.let { graphJson ->
                    (activity as? SettingsActivity)
                        ?.applyPresetGraph(graphJson)
                }
                // Rebuild the prefs UI so SeekBarPreference /
                // ListPreference widgets re-bind to the new pref
                // values instead of showing stale slider positions.
                loadScreen(currentScreen)
                Toast.makeText(ctx, preset.name, Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun applySeedListForCurrentFamily() {
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
            else -> R.array.seed_p3_entries to R.array.seed_p3_values
        }
        val entries = resources.getStringArray(entriesId)
        val values = resources.getStringArray(valuesId)
        seedPref.entries = entries
        seedPref.entryValues = values
        val current = seedPref.value?.toIntOrNull() ?: 0
        if (current >= values.size || seedPref.value == null) {
            seedPref.value = values[0]
        }
    }

    private fun updateAudioSummary() {
        if (currentScreen != ScreenKey.Audio) return
        val pref = findPreference<Preference>("audio_file_uri") ?: return
        val name = AudioPlaybackService.currentDisplayName
        pref.summary = name ?: getString(R.string.audio_file_none)
    }
}
