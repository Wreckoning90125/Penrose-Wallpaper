package com.penrose.wallpaper

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.preference.PreferenceFragmentCompat
import androidx.preference.PreferenceManager

/**
 * Settings UI shown by the wallpaper picker. Backed by the same
 * SharedPreferences file the WallpaperService reads, so a change flips state
 * the next time the picker repaints the preview.
 *
 * We use the "penrose_settings" file (Settings.PREFS_NAME) for both reader
 * and writer — the PreferenceManager normally writes to the default file, so
 * we override it here.
 */
class SettingsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        if (savedInstanceState == null) {
            supportFragmentManager.beginTransaction()
                .replace(R.id.settings_container, SettingsFragment())
                .commit()
        }
        title = getString(R.string.wallpaper_name)
    }

    class SettingsFragment : PreferenceFragmentCompat() {
        override fun onCreatePreferences(savedInstanceState: Bundle?, rootKey: String?) {
            preferenceManager.sharedPreferencesName = Settings.PREFS_NAME
            setPreferencesFromResource(R.xml.preferences, rootKey)
        }
    }
}
