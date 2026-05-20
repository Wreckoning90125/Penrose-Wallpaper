package com.penrose.wallpaper

import android.content.DialogInterface
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import androidx.fragment.app.commit
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.bottomsheet.BottomSheetDialogFragment

/**
 * Glass bottom sheet that hosts [SettingsFragment]. Sized to ~55% of
 * screen height at rest, expandable to 90%. The dialog applies a 20 dp
 * window blur (API 31+) so the wallpaper behind shows through as
 * frosted glass; combined with the ~55% opaque tint baked into
 * `Widget.Penrose.BottomSheet` the effect lands at "glass over
 * wallpaper".
 *
 * Back-button behaviour:
 *   - On a sub-pref-screen, back asks SettingsFragment to navigate to
 *     the main screen and the dialog stays open.
 *   - On the main screen, back dismisses the dialog. The host
 *     SettingsActivity then keeps showing the wallpaper preview with
 *     a small "Settings" affordance; it does NOT finish.
 *
 * Dismiss behaviour (back-on-main, drag-down, or tap-outside) only
 * closes the dialog. Returning to the sheet is the host activity's
 * job — see [SettingsActivity].
 */
class SettingsBottomSheetDialogFragment : BottomSheetDialogFragment() {

    override fun getTheme(): Int = R.style.Theme_Penrose_BottomSheet

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View = inflater.inflate(R.layout.bottom_sheet_settings, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        if (childFragmentManager.findFragmentById(R.id.prefs_container) == null) {
            childFragmentManager.commit {
                add(R.id.prefs_container, SettingsFragment())
            }
        }
    }

    override fun onStart() {
        super.onStart()
        val dialog = dialog as? BottomSheetDialog ?: return

        // Peek = ~55% of screen height; expanded = ~90%. User gets the
        // glass overlay covering roughly the bottom half by default and
        // can drag up for the full list.
        val dm = resources.displayMetrics
        val peek = (dm.heightPixels * 0.55f).toInt()
        val expanded = (dm.heightPixels * 0.90f).toInt()
        dialog.behavior.peekHeight = peek
        dialog.behavior.state = BottomSheetBehavior.STATE_COLLAPSED
        dialog.findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)
            ?.layoutParams
            ?.height = expanded

        dialog.window?.apply {
            // Translucent host activity has no chrome of its own, so the
            // dialog window draws directly onto the wallpaper. Behind-
            // blur frosts the wallpaper where the sheet's tint is
            // semi-transparent. minSdk = 36 so this is unconditional.
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setBackgroundBlurRadius(20)
            addFlags(WindowManager.LayoutParams.FLAG_BLUR_BEHIND)
            attributes = attributes.apply {
                blurBehindRadius = 20
                dimAmount = 0.25f
            }
        }

        // Intercept the system back key so a back press on a sub-pref-
        // screen unwinds the in-sheet navigation instead of nuking the
        // whole dialog. Only when we're already on the main screen do
        // we let the default (dismiss) fire.
        dialog.setOnKeyListener { _, keyCode, event ->
            if (keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
                val prefs = childFragmentManager.findFragmentById(R.id.prefs_container)
                        as? SettingsFragment
                if (prefs != null && prefs.popBackToMainIfNeeded()) {
                    return@setOnKeyListener true
                }
            }
            false
        }
    }

    override fun onDismiss(dialog: DialogInterface) {
        super.onDismiss(dialog)
        // Intentionally NOT calling activity?.finish(). The activity
        // hosts a live wallpaper preview behind the sheet; dismissing
        // the sheet should reveal the preview, not exit the app. The
        // activity owns its own back-button policy: see
        // SettingsActivity.onBackPressedDispatcher.
    }
}
