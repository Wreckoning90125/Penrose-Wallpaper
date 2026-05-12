package com.penrose.wallpaper

import android.app.Activity
import android.app.WallpaperManager
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.widget.Toast

/**
 * No-UI shim that exists only so the wallpaper has a tap target in the app
 * drawer. On launch it fires the system's live-wallpaper preview directly at
 * PenroseWallpaperService, which sidesteps curated picker lists (Samsung
 * OneUI's "Wallpaper services" category is reserved for Samsung-signed
 * services like Dynamic Lockscreen, so third-party live wallpapers never
 * appear in the stock picker — confirmed across OneUI 7/8 community reports
 * through 2025-2026). The activity finishes immediately after starting the
 * intent — control returns to home or the app drawer once the user confirms
 * or cancels in the preview.
 */
class LauncherActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val component = ComponentName(this, PenroseWallpaperService::class.java)
        val intent = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).apply {
            putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
        }
        try {
            startActivity(intent)
        } catch (_: Exception) {
            // Some OEM ROMs strip the live-wallpaper preview activity. Drop the
            // user into our settings screen so the app still goes somewhere.
            startActivity(Intent(this, SettingsActivity::class.java))
            Toast.makeText(this, R.string.launcher_no_picker, Toast.LENGTH_LONG).show()
        }
        finish()
    }
}
