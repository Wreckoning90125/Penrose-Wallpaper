package com.penrose.wallpaper

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.os.Handler
import android.util.Log
import android.view.Choreographer
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.WindowManager
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File

/**
 * Full-bleed live preview, optionally with the ImGui node-graph editor
 * overlaid on top. Renders the same Vulkan scene as [SettingsActivity]
 * but takes the whole screen so the user can watch the wallpaper
 * without UI chrome.
 *
 * All native-renderer work is funnelled through [session]
 * ([RendererSession]). The pointer is owned by the dispatcher thread;
 * no main-thread NativeBridge calls.
 */
class FullScreenActivity : AppCompatActivity(),
                           SharedPreferences.OnSharedPreferenceChangeListener,
                           Choreographer.FrameCallback {

    // Registered as a lifecycle observer; ON_DESTROY auto-fires
    // session.shutdown(). The graph-save submitBlocking still needs
    // an explicit call from onDestroy below because it has to happen-
    // before shutdown drains the executor.
    private val session = RendererSession("PenroseFull")
        .also { lifecycle.addObserver(it) }

    private val prefs: SharedPreferences by lazy {
        getSharedPreferences(Settings.PREFS_NAME, Context.MODE_PRIVATE)
    }

    private val choreographer: Choreographer by lazy { Choreographer.getInstance() }
    private var frameCallbackPosted = false
    private var startFrameNanos = 0L

    private var showGraphOnStart: Boolean = false

    // True once surfaceCreated has queued loadGraphFromDisk. onStop only
    // persists the graph when this is set — otherwise an activity that
    // is stopped before the surface ever came up would save the empty
    // default graph straight over the user's saved one. Main-thread only.
    private var graphLoadedFromDisk: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        showGraphOnStart = intent?.getBooleanExtra(EXTRA_SHOW_GRAPH, false) ?: false

        // Bootstrap the native renderer. Fire-and-forget: the dispatcher's
        // FIFO order guarantees subsequent session.submit blocks see a
        // valid pointer.
        session.start(assets, resources.displayMetrics.density, TAG)

        // Back button:
        //   - If the node editor is open, close the editor and stay in
        //     this activity so the user lands back on the wallpaper
        //     preview rather than the previous Activity.
        //   - Otherwise fall through to the default (which finishes the
        //     activity → returns to SettingsActivity in the back stack).
        //
        // The visibility check is a synchronous render-thread query
        // ([RendererSession.query]) — main thread no longer reads the
        // native pointer directly.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val handled = session.query { ptr ->
                    if (NativeBridge.graphIsVisible(ptr)) {
                        NativeBridge.graphSetVisible(ptr, false)
                        true
                    } else {
                        false
                    }
                } ?: false
                if (!handled) {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        val surfaceView = findViewById<SurfaceView>(R.id.preview_surface)
        // Forward system-bar insets to the native renderer so the
        // node-editor toolbar can sit below the status bar / cutout
        // rather than be clipped behind it. The listener fires once
        // on attach and again on any inset change (notch enter/exit,
        // IME show/hide, fold). We re-submit on each fire because
        // the editor reads the latest value every frame.
        ViewCompat.setOnApplyWindowInsetsListener(surfaceView) { _, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                WindowInsetsCompat.Type.displayCutout()
            )
            val top = bars.top; val bottom = bars.bottom
            val left = bars.left; val right = bars.right
            session.submit { ptr ->
                NativeBridge.setSystemInsets(ptr, top, bottom, left, right)
            }
            insets
        }
        surfaceView.holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                val surface = holder.surface
                session.submit { ptr ->
                    NativeBridge.surfaceCreated(ptr, surface)
                    pushSettingsNow(ptr)
                    loadGraphFromDisk(ptr)
                    if (showGraphOnStart) NativeBridge.graphSetVisible(ptr, true)
                }
                graphLoadedFromDisk = true
                // Choreographer.postFrameCallback must be called from a
                // thread with a Looper. SurfaceHolder.Callback fires on
                // main; do the arming here, not inside session.submit
                // (the render dispatcher has no Looper).
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
                session.submitBlocking { ptr ->
                    NativeBridge.surfaceDestroyed(ptr)
                }
            }
        })

        prefs.registerOnSharedPreferenceChangeListener(this)
    }

    // Multi-touch state: ImGui drives a single mouse cursor, so we track ONE
    // "primary" pointer at a time and only forward its events. When the
    // primary finger lifts but other fingers remain on the screen, we
    // promote the next live pointer to primary instead of releasing the
    // mouse button — otherwise a two-finger unwind would cancel an
    // in-progress drag mid-link.
    private var primaryPointerId: Int = MotionEvent.INVALID_POINTER_ID
    private var longPressArmed: Boolean = false
    private var longPressDownX: Float = 0f
    private var longPressDownY: Float = 0f
    private val longPressRunnable = Runnable {
        // 500ms of no significant movement → synthetic right-click at the
        // touch-down point. The C++ ring translates this into ImGui's
        // button-1 down+up pair which imgui-node-editor reads as the
        // "open context menu" gesture (the user-facing tap-and-hold spawn
        // menu requirement).
        if (longPressArmed) {
            val x = longPressDownX; val y = longPressDownY
            longPressArmed = false
            session.submit { ptr ->
                NativeBridge.pushTouchEvent(ptr, PHASE_LONG_PRESS, 0, x, y)
            }
        }
    }
    private val touchSlopPx: Float by lazy {
        android.view.ViewConfiguration.get(this).scaledTouchSlop.toFloat()
    }
    private val uiHandler = Handler(android.os.Looper.getMainLooper())

    override fun onTouchEvent(event: MotionEvent): Boolean {
        forwardTouchToSession(event)
        // The full-screen view dismisses on a single-finger tap-up so the
        // user can return to the settings activity; once the node editor
        // is visible, dismissing this way is replaced by an in-overlay
        // close button to avoid confusing tap collisions. The visibility
        // gate is a synchronous render-thread query.
        if (event.actionMasked == MotionEvent.ACTION_UP &&
            event.pointerCount == 1) {
            val graphVisible = session.query { ptr ->
                NativeBridge.graphIsVisible(ptr)
            } ?: false
            if (!graphVisible) {
                finish()
                return true
            }
        }
        return super.onTouchEvent(event) || true
    }

    private fun forwardTouchToSession(event: MotionEvent) {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val idx = event.actionIndex
                primaryPointerId = event.getPointerId(idx)
                val x = event.getX(idx); val y = event.getY(idx)
                session.submit { ptr ->
                    NativeBridge.pushTouchEvent(ptr, PHASE_DOWN, 0, x, y)
                }
                armLongPress(x, y)
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                // Secondary fingers are tracked only so we can promote one
                // to primary if the current primary lifts. They do not
                // generate ImGui events.
            }
            MotionEvent.ACTION_MOVE -> {
                if (primaryPointerId == MotionEvent.INVALID_POINTER_ID) return
                val idx = event.findPointerIndex(primaryPointerId)
                if (idx < 0) return
                val x = event.getX(idx); val y = event.getY(idx)
                checkLongPressMovement(x, y)
                session.submit { ptr ->
                    NativeBridge.pushTouchEvent(ptr, PHASE_MOVE, 0, x, y)
                }
            }
            MotionEvent.ACTION_POINTER_UP -> {
                val liftedId = event.getPointerId(event.actionIndex)
                if (liftedId == primaryPointerId) {
                    // Primary lifted while other fingers remain — promote
                    // the next still-down pointer instead of releasing.
                    val replacement = (0 until event.pointerCount)
                        .firstOrNull { it != event.actionIndex }
                    if (replacement != null) {
                        primaryPointerId = event.getPointerId(replacement)
                        val x = event.getX(replacement); val y = event.getY(replacement)
                        session.submit { ptr ->
                            NativeBridge.pushTouchEvent(ptr, PHASE_MOVE, 0, x, y)
                        }
                    }
                }
            }
            MotionEvent.ACTION_UP -> {
                val idx = event.actionIndex
                val x = event.getX(idx); val y = event.getY(idx)
                cancelLongPress()
                session.submit { ptr ->
                    NativeBridge.pushTouchEvent(ptr, PHASE_UP, 0, x, y)
                }
                primaryPointerId = MotionEvent.INVALID_POINTER_ID
            }
            MotionEvent.ACTION_CANCEL -> {
                cancelLongPress()
                session.submit { ptr ->
                    NativeBridge.pushTouchEvent(ptr, PHASE_CANCEL, 0, 0f, 0f)
                }
                primaryPointerId = MotionEvent.INVALID_POINTER_ID
            }
        }
    }

    private fun armLongPress(x: Float, y: Float) {
        cancelLongPress()
        longPressDownX = x; longPressDownY = y; longPressArmed = true
        uiHandler.postDelayed(longPressRunnable, LONG_PRESS_MS)
    }

    private fun cancelLongPress() {
        if (longPressArmed) {
            uiHandler.removeCallbacks(longPressRunnable)
            longPressArmed = false
        }
    }

    private fun checkLongPressMovement(x: Float, y: Float) {
        if (!longPressArmed) return
        val dx = x - longPressDownX; val dy = y - longPressDownY
        if (dx * dx + dy * dy > touchSlopPx * touchSlopPx) cancelLongPress()
    }

    override fun onSharedPreferenceChanged(sp: SharedPreferences?, key: String?) {
        session.submit { ptr ->
            pushSettingsNow(ptr)
            NativeBridge.drawFrame(ptr)
        }
    }

    override fun onStop() {
        // Persist the modulation graph here, while the renderer is fully
        // alive and healthy — NOT during onDestroy's teardown. Only the
        // node editor (showGraphOnStart) can have changed the graph; the
        // plain preview never edits it, so it has nothing to save. Also
        // skipped if the surface never came up, which would write the
        // empty default graph over the user's real one. Render-thread
        // only: graphSave walks the node map handler_.update() mutates.
        if (graphLoadedFromDisk && showGraphOnStart) {
            session.submitBlocking { ptr ->
                saveGraphToDiskOnRenderThread(ptr)
            }
            // Announce the new graph: bump the revision so the running
            // wallpaper engine reloads the file it was just handed.
            // Without this, edits made in the editor never reached the
            // live wallpaper — only a preset load bumped the revision.
            prefs.edit()
                .putLong(Settings.KEY_GRAPH_REVISION, System.currentTimeMillis())
                .apply()
        }
        super.onStop()
        // The node editor does not survive backgrounding: resuming a
        // half-torn-down ImGui + Vulkan editor surface was unreliable
        // (blank canvas, or a crash back to the menu). Finish it
        // instead — the graph was just saved above, so reopening from
        // the menu restores it into a clean, freshly-built editor.
        // Consistent and intentional: leaving the editor closes it. A
        // configuration change (rotation) is exempt — that is an
        // activity recreate, not the user leaving.
        if (showGraphOnStart && !isChangingConfigurations() && !isFinishing()) {
            finish()
        }
    }

    override fun onDestroy() {
        // Defuse any pending long-press timer first — its runnable
        // captures the session and would otherwise fire up to
        // LONG_PRESS_MS after destroy. The graph itself was already
        // persisted in onStop; session.shutdown() is fired by the
        // lifecycle observer during super.onDestroy() below.
        cancelLongPress()
        uiHandler.removeCallbacksAndMessages(null)
        disarmChoreographer()
        prefs.unregisterOnSharedPreferenceChangeListener(this)
        super.onDestroy()
    }

    /**
     * Graph state lives in `filesDir/modulation_graph.json` — written
     * on destroy, read on create. Unlike the audio URI (which belongs
     * to the running service), the user's hand-built modulation graph
     * is meaningful work that should survive across launches. Render-
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
     * Render-thread only. Reads the graph state out of the C++
     * Renderer (handler_.getNodes() iteration) and writes it to
     * filesDir/modulation_graph.json.
     */
    private fun saveGraphToDiskOnRenderThread(ptr: Long) {
        try {
            val json = NativeBridge.graphSave(ptr)
            File(filesDir, "modulation_graph.json").writeText(json)
        } catch (e: Exception) {
            Log.w(TAG, "graph save failed", e)
        }
    }

    private fun currentScreenSize(): Pair<Int, Int> {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val bounds = wm.currentWindowMetrics.bounds
        return bounds.width() to bounds.height()
    }

    /** Render-thread only. */
    private fun pushSettingsNow(ptr: Long) {
        val s = Settings.load(prefs)
        val (ints, floats) = s.toNative()
        NativeBridge.applySettings(ptr, ints, floats)
    }

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
            // The C++ side reads bands + beat from the analyzer, walks
            // the node graph, and writes final clamped output values back
            // into settings_. Kotlin just drives the frame clock here.
            NativeBridge.tick(ptr, tSeconds)
            NativeBridge.drawFrame(ptr)
        }
        if (frameCallbackPosted) choreographer.postFrameCallback(this)
    }

    companion object {
        const val EXTRA_SHOW_GRAPH = "show_graph"
        private const val TAG = "PenroseFullScreen"
        private const val PHASE_DOWN       = 0
        private const val PHASE_MOVE       = 1
        private const val PHASE_UP         = 2
        private const val PHASE_CANCEL     = 3
        private const val PHASE_LONG_PRESS = 4
        private const val LONG_PRESS_MS    = 500L
    }
}
