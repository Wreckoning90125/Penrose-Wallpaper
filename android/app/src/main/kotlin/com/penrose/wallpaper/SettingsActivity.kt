package com.penrose.wallpaper

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.util.Log
import android.view.Choreographer
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.WindowManager
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import java.io.File

/**
 * In-app preview host. A live-rendering [SurfaceView] fills the activity
 * window; the settings bottom-sheet is shown on first launch and can be
 * dismissed (swipe down, back, or tap-outside) to reveal the bare
 * preview. From the preview-only state a single tap re-opens the
 * settings sheet; the system back button finishes the activity.
 *
 * All native-renderer work is funnelled through [session]
 * ([RendererSession]) — there are no @Volatile pointers, no manual
 * HandlerThread, and no `runWithBarrier` barriers. The session owns
 * the pointer; this Activity only describes intent ("on tap, push a
 * touch event"; "on surfaceCreated, attach the surface"; "on
 * destroy, save and tear down").
 */
class SettingsActivity : AppCompatActivity(),
                         SharedPreferences.OnSharedPreferenceChangeListener,
                         Choreographer.FrameCallback {

    // Registered as a lifecycle observer in onCreate; ON_DESTROY auto-
    // fires session.shutdown() (see RendererSession.onDestroy).
    private val session = RendererSession("PenrosePreview")
        .also { lifecycle.addObserver(it) }

    private val prefs: SharedPreferences by lazy {
        getSharedPreferences(Settings.PREFS_NAME, Context.MODE_PRIVATE)
    }

    private val choreographer: Choreographer by lazy { Choreographer.getInstance() }
    private var frameCallbackPosted = false
    private var startFrameNanos = 0L

    // Single-tap-up detector used while the sheet is dismissed: tapping
    // the preview brings the sheet back. Drag / multi-touch / pinch are
    // not gestures we have a use for in the preview area today, so the
    // detector only intercepts single-finger taps and forwards
    // everything else through dispatchTouchEvent unchanged.
    private val previewTapDetector by lazy {
        GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onSingleTapUp(e: MotionEvent): Boolean {
                showSettingsSheetIfHidden()
                return true
            }
        })
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        // Bootstrap the native renderer. Fire-and-forget: the dispatcher's
        // FIFO order guarantees any subsequent session.submit blocks
        // (surfaceCreated, settings, choreographer) see a valid pointer.
        session.start(assets, resources.displayMetrics.density, TAG)

        val surfaceView = findViewById<SurfaceView>(R.id.preview_surface)
        surfaceView.holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                val surface = holder.surface
                session.submit { ptr ->
                    NativeBridge.surfaceCreated(ptr, surface)
                    pushSettingsNow(ptr)
                    loadGraphFromDisk(ptr)
                }
                // Choreographer methods require a Looper on the calling
                // thread; the render dispatcher is a bare Thread with no
                // Looper. Arm here on main (SurfaceHolder.Callback fires
                // on the thread the holder was created on — main thread
                // for a SurfaceView). The render submit above queues
                // before any frame callback fires (FIFO), so doFrame's
                // own session.submit lands after surfaceCreated.
                armChoreographer()
            }

            override fun surfaceChanged(holder: SurfaceHolder, format: Int, w: Int, h: Int) {
                val (sw, sh) = currentScreenSize()
                session.submit { ptr ->
                    NativeBridge.surfaceChanged(ptr, w, h)
                    NativeBridge.surfaceGeometry(ptr, w, h, sw, sh)
                    NativeBridge.drawFrame(ptr)
                }
            }

            override fun surfaceDestroyed(holder: SurfaceHolder) {
                disarmChoreographer()
                // Block briefly so Vulkan releases the Android surface
                // before SurfaceHolder reclaims it. Without the barrier
                // the native swapchain races with surface destruction
                // and the renderer logs vkAcquireNextImage failures on
                // the very next frame in some lifecycles.
                session.submitBlocking { ptr ->
                    NativeBridge.surfaceDestroyed(ptr)
                }
            }
        })

        prefs.registerOnSharedPreferenceChangeListener(this)

        if (savedInstanceState == null) {
            SettingsBottomSheetDialogFragment()
                .show(supportFragmentManager, TAG_SHEET)
        }

        // Back from preview-only state finishes the activity. When the
        // sheet is showing, its own back-key listener handles back —
        // this callback's isEnabled gates only the preview-only case.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // If the sheet's still up, the dialog already consumed
                // the press; we never get here. We get here only when
                // the sheet is dismissed → user wants out.
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
            }
        })
    }

    private fun showSettingsSheetIfHidden() {
        if (supportFragmentManager.findFragmentByTag(TAG_SHEET) != null) return
        SettingsBottomSheetDialogFragment()
            .show(supportFragmentManager, TAG_SHEET)
    }

    private fun currentScreenSize(): Pair<Int, Int> {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val bounds = wm.currentWindowMetrics.bounds
        return bounds.width() to bounds.height()
    }

    override fun onSharedPreferenceChanged(sp: SharedPreferences?, key: String?) {
        session.submit { ptr ->
            pushSettingsNow(ptr)
            NativeBridge.drawFrame(ptr)
        }
    }

    /** Render-thread only. */
    private fun pushSettingsNow(ptr: Long) {
        val s = Settings.load(prefs)
        val (ints, floats) = s.toNative()
        NativeBridge.applySettings(ptr, ints, floats)
    }

    /**
     * Read filesDir/modulation_graph.json (written by PresetStore or by
     * FullScreenActivity's save path) into the active Renderer. Render-
     * thread only.
     */
    private fun loadGraphFromDisk(ptr: Long) {
        val f = File(filesDir, "modulation_graph.json")
        if (!f.exists()) return
        try {
            val json = f.readText()
            NativeBridge.graphLoad(ptr, json)
        } catch (e: Exception) {
            Log.w(TAG, "graph load failed", e)
        }
    }

    /**
     * Public hook called by the preset-loader after it has written
     * the preset's graph JSON to disk. The caller always passes a
     * concrete JSON string ({"nodes":[],"links":[]} for presets that
     * have no graph block) so this method only needs the graphLoad
     * path.
     */
    fun applyPresetGraph(json: String) {
        session.submit { ptr ->
            NativeBridge.graphLoad(ptr, json)
            NativeBridge.drawFrame(ptr)
        }
    }

    override fun onDestroy() {
        // session.shutdown() is wired through the lifecycle observer
        // registered in the field initializer — Lifecycle fires
        // RendererSession.onDestroy on ON_DESTROY, no explicit call
        // needed here.
        disarmChoreographer()
        prefs.unregisterOnSharedPreferenceChangeListener(this)
        super.onDestroy()
    }

    // ---- Choreographer-driven render clock ----

    private fun armChoreographer() {
        if (frameCallbackPosted) return
        frameCallbackPosted = true
        startFrameNanos = 0L
        choreographer.postFrameCallback(this)
    }

    private fun disarmChoreographer() {
        if (!frameCallbackPosted) return
        frameCallbackPosted = false
        choreographer.removeFrameCallback(this)
    }

    override fun doFrame(frameTimeNanos: Long) {
        if (!frameCallbackPosted) return
        if (startFrameNanos == 0L) startFrameNanos = frameTimeNanos
        val tSeconds = (frameTimeNanos - startFrameNanos) / 1_000_000_000f
        session.submit { ptr ->
            NativeBridge.tick(ptr, tSeconds)
            NativeBridge.drawFrame(ptr)
        }
        if (frameCallbackPosted) choreographer.postFrameCallback(this)
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        // Extract event payload synchronously on the main thread (MotionEvent
        // is recycled by the framework after this returns) and post a value
        // copy to the render dispatcher. The previous code read a
        // @Volatile pointer and called pushTouchEvent inline on main —
        // a TOCTOU window in which the render thread could free the
        // renderer before JNI dereferenced it.
        forwardTouchToSession(event)

        // When the sheet is not showing, a single tap on the preview
        // surface brings it back. The detector consumes single-tap-up
        // only; everything else flows through to super (so the dialog
        // can still handle drags / outside taps when it IS showing).
        if (supportFragmentManager.findFragmentByTag(TAG_SHEET) == null) {
            previewTapDetector.onTouchEvent(event)
        }
        return super.dispatchTouchEvent(event)
    }

    private fun forwardTouchToSession(event: MotionEvent) {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                val idx = event.actionIndex
                val x = event.getX(idx); val y = event.getY(idx)
                session.submit { ptr ->
                    NativeBridge.pushTouchEvent(ptr, PHASE_DOWN, idx, x, y)
                }
            }
            MotionEvent.ACTION_MOVE -> {
                val count = event.pointerCount
                val xs = FloatArray(count) { event.getX(it) }
                val ys = FloatArray(count) { event.getY(it) }
                session.submit { ptr ->
                    for (i in 0 until count) {
                        NativeBridge.pushTouchEvent(ptr, PHASE_MOVE, i, xs[i], ys[i])
                    }
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                val idx = event.actionIndex
                val x = event.getX(idx); val y = event.getY(idx)
                session.submit { ptr ->
                    NativeBridge.pushTouchEvent(ptr, PHASE_UP, idx, x, y)
                }
            }
            MotionEvent.ACTION_CANCEL -> {
                val count = event.pointerCount
                val xs = FloatArray(count) { event.getX(it) }
                val ys = FloatArray(count) { event.getY(it) }
                session.submit { ptr ->
                    for (i in 0 until count) {
                        NativeBridge.pushTouchEvent(ptr, PHASE_CANCEL, i, xs[i], ys[i])
                    }
                }
            }
        }
    }

    private companion object {
        const val TAG = "PenroseSettings"
        const val TAG_SHEET = "settings_sheet"
        const val PHASE_DOWN = 0
        const val PHASE_MOVE = 1
        const val PHASE_UP   = 2
        const val PHASE_CANCEL = 3
    }
}
