package com.penrose.wallpaper

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * App launcher shim. Opens [SettingsActivity] — the in-app preview +
 * editor — instead of firing the system live-wallpaper picker
 * directly. The user explicitly invokes the wallpaper picker via the
 * "Apply as wallpaper" action inside SettingsActivity, so launching
 * the app no longer silently triggers a wallpaper change.
 */
class LauncherActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(Intent(this, SettingsActivity::class.java))
        finish()
    }
}
