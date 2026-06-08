package com.penrose.wallpaper

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Choreographer
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import com.penrose.wallpaper.preset.SettingsSnapshotStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot

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
                           SettingsStore.Listener,
                           Choreographer.FrameCallback {

    // Registered as a lifecycle observer; ON_DESTROY auto-fires
    // session.shutdown(). The graph-save path still reads from the
    // renderer before shutdown drains the executor.
    private val session = RendererSession("PenroseFull")
        .also { lifecycle.addObserver(it) }

    private lateinit var settingsStore: SettingsStore
    private var settingsListenerRegistered = false

    private val choreographer: Choreographer by lazy { Choreographer.getInstance() }
    private var frameCallbackPosted = false
    private var startFrameNanos = 0L

    private var showGraphOnStart: Boolean = false
    private var touchRouteGraph = false
    private var graphEditorStopHandled = false

    // True once surfaceCreated has loaded the graph snapshot. onStop only
    // persists the graph when this is set — otherwise an activity that
    // is stopped before the surface ever came up would save the empty
    // default graph straight over the user's saved one. Main-thread only.
    private var graphLoadedFromStore: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        showGraphOnStart = intent?.getBooleanExtra(EXTRA_SHOW_GRAPH, false) ?: false

        lifecycleScope.launch {
            settingsStore = withContext(Dispatchers.IO) {
                SettingsStore.openWorking(this@FullScreenActivity)
            }
            initializePreview()
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                registerSettingsListener()
            }
        }
    }

    private fun initializePreview() {
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
                val graphClose = session.query { ptr ->
                    if (NativeBridge.graphIsVisible(ptr)) {
                        val json = NativeBridge.graphSave(ptr)
                        if (json.isBlank()) {
                            GraphCloseAction.SaveFailed
                        } else {
                            NativeBridge.graphSetVisible(ptr, false)
                            NativeBridge.drawFrame(ptr)
                            GraphCloseAction.Save(json)
                        }
                    } else {
                        GraphCloseAction.NavigateBack
                    }
                } ?: GraphCloseAction.NavigateBack
                when (graphClose) {
                    is GraphCloseAction.Save -> queueGraphSave(graphClose.graphJson)
                    GraphCloseAction.SaveFailed -> {
                        Log.w(TAG, "graph save failed")
                        Toast.makeText(
                            this@FullScreenActivity,
                            R.string.graph_save_failed_toast,
                            Toast.LENGTH_SHORT,
                        ).show()
                    }
                    GraphCloseAction.NavigateBack -> {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
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
                    graphLoadedFromStore = loadGraphFromStore(ptr)
                    if (showGraphOnStart) NativeBridge.graphSetVisible(ptr, true)
                }
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
    }

    override fun onStart() {
        super.onStart()
        registerSettingsListener()
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
    private var viewP0Id = -1; private var viewP0x = 0f; private var viewP0y = 0f
    private var viewP1Id = -1; private var viewP1x = 0f; private var viewP1y = 0f
    private var viewPinchDist = 0f
    private var viewPinchAngle = 0f
    private var viewGestureTouched = false
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
    private val uiHandler = Handler(Looper.getMainLooper())

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
            touchRouteGraph = session.query { ptr -> NativeBridge.graphIsVisible(ptr) } ?: false
        }
        if (touchRouteGraph) {
            forwardTouchToSession(event)
            if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
                touchRouteGraph = false
            }
            return super.onTouchEvent(event) || true
        }
        handlePreviewTransformEvent(event)
        return true
    }

    private fun handlePreviewTransformEvent(event: MotionEvent) {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                viewP0Id = event.getPointerId(0)
                viewP0x = event.x
                viewP0y = event.y
                viewP1Id = -1
                viewGestureTouched = false
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                if (viewP1Id == -1) {
                    val ix = event.actionIndex
                    viewP1Id = event.getPointerId(ix)
                    viewP1x = event.getX(ix)
                    viewP1y = event.getY(ix)
                    viewPinchDist = hypot(viewP1x - viewP0x, viewP1y - viewP0y).coerceAtLeast(1f)
                    viewPinchAngle = atan2(viewP1y - viewP0y, viewP1x - viewP0x)
                }
            }
            MotionEvent.ACTION_MOVE -> {
                val i0 = event.findPointerIndex(viewP0Id)
                val i1 = if (viewP1Id == -1) -1 else event.findPointerIndex(viewP1Id)
                if (i1 >= 0 && i0 >= 0) {
                    val nx0 = event.getX(i0)
                    val ny0 = event.getY(i0)
                    val nx1 = event.getX(i1)
                    val ny1 = event.getY(i1)
                    val newDist = hypot(nx1 - nx0, ny1 - ny0).coerceAtLeast(1f)
                    val newAngle = atan2(ny1 - ny0, nx1 - nx0)
                    val scale = newDist / viewPinchDist
                    val rotDelta = newAngle - viewPinchAngle
                    if (
                        viewGestureTouched
                        || abs(newDist - viewPinchDist) >= touchSlopPx
                        || abs(rotDelta) * viewPinchDist >= touchSlopPx
                    ) {
                        session.submit { ptr -> NativeBridge.touchPinch(ptr, scale, rotDelta) }
                        viewPinchDist = newDist
                        viewPinchAngle = newAngle
                        viewP0x = nx0; viewP0y = ny0
                        viewP1x = nx1; viewP1y = ny1
                        viewGestureTouched = true
                    }
                } else if (i0 >= 0) {
                    val nx = event.getX(i0)
                    val ny = event.getY(i0)
                    val dx = nx - viewP0x
                    val dy = ny - viewP0y
                    if (viewGestureTouched || dx * dx + dy * dy >= touchSlopPx * touchSlopPx) {
                        session.submit { ptr -> NativeBridge.touchMove(ptr, dx, dy) }
                        viewP0x = nx
                        viewP0y = ny
                        viewGestureTouched = true
                    }
                }
            }
            MotionEvent.ACTION_POINTER_UP -> {
                val id = event.getPointerId(event.actionIndex)
                if (id == viewP1Id) {
                    viewP1Id = -1
                } else if (id == viewP0Id) {
                    viewP0Id = viewP1Id
                    viewP0x = viewP1x
                    viewP0y = viewP1y
                    viewP1Id = -1
                }
            }
            MotionEvent.ACTION_UP -> {
                viewP0Id = -1
                viewP1Id = -1
                if (viewGestureTouched) {
                    viewGestureTouched = false
                    commitPreviewViewToSettings()
                } else {
                    finish()
                }
            }
            MotionEvent.ACTION_CANCEL -> {
                viewP0Id = -1
                viewP1Id = -1
                if (viewGestureTouched) {
                    viewGestureTouched = false
                    commitPreviewViewToSettings()
                }
            }
        }
    }

    private fun commitPreviewViewToSettings() {
        val out = session.query { ptr ->
            val out = FloatArray(4)
            NativeBridge.readView(ptr, out)
            out
        } ?: return
        persistView(out)
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

    override fun onSettingChanged(key: String?) {
        session.submit { ptr ->
            pushSettingsNow(ptr)
            if (key == Settings.KEY_GRAPH_REVISION) loadGraphFromStore(ptr)
            NativeBridge.drawFrame(ptr)
        }
    }

    override fun onStop() {
        val closeGraphEditor = showGraphOnStart && !isChangingConfigurations() && !isFinishing()
        var graphSave: Deferred<Unit>? = null
        if (graphLoadedFromStore && showGraphOnStart) {
            val json = readGraphFromRenderer()
            if (json != null) graphSave = queueGraphSave(json)
        }
        unregisterSettingsListener()
        super.onStop()
        // The node editor does not survive backgrounding: resuming a
        // half-torn-down ImGui + Vulkan editor surface was unreliable
        // (blank canvas, or a crash back to the menu). Finish it
        // after the graph transaction completes, so reopening from the
        // menu restores it into a clean, freshly-built editor.
        // Consistent and intentional: leaving the editor closes it. A
        // configuration change (rotation) is exempt — that is an
        // activity recreate, not the user leaving.
        if (closeGraphEditor && !graphEditorStopHandled) {
            graphEditorStopHandled = true
            val save = graphSave
            if (save != null) {
                save.invokeOnCompletion {
                    uiHandler.post {
                        if (!isDestroyed) finish()
                    }
                }
            } else {
                finish()
            }
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
        super.onDestroy()
    }

    /**
     * Graph state lives in the working settings store.
     * Unlike the audio URI (which belongs to the running service), the
     * user's hand-built modulation graph is meaningful work that should
     * survive across launches. Render-thread only.
     */
    private fun loadGraphFromStore(ptr: Long): Boolean {
        try {
            val json = SettingsSnapshotStore.storedGraphJson(settingsStore)
            return NativeBridge.graphLoad(ptr, json)
        } catch (e: Exception) {
            Log.w(TAG, "graph load failed", e)
        }
        return false
    }

    private fun readGraphFromRenderer(): String? =
        try {
            session.query { ptr ->
                NativeBridge.graphSave(ptr)
            }
                ?.takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            Log.w(TAG, "graph save failed", e)
            null
        }

    private fun queueGraphSave(graphJson: String): Deferred<Unit>? {
        if (graphJson.isBlank()) return null
        if (!::settingsStore.isInitialized) return null
        return try {
            SettingsSnapshotStore.saveWorkingGraphAsync(settingsStore, graphJson).also { save ->
                save.invokeOnCompletion { cause ->
                    if (cause != null) Log.w(TAG, "graph save failed", cause)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "graph save failed", e)
            null
        }
    }

    private fun persistView(out: FloatArray) {
        if (!::settingsStore.isInitialized) return
        try {
            Settings.saveViewAsync(settingsStore, out[0], out[1], out[2], out[3])
        } catch (e: Exception) {
            Log.w(TAG, "view save failed", e)
        }
    }

    private fun currentScreenSize(): Pair<Int, Int> {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val bounds = wm.currentWindowMetrics.bounds
        return bounds.width() to bounds.height()
    }

    private sealed class GraphCloseAction {
        data class Save(val graphJson: String) : GraphCloseAction()
        object SaveFailed : GraphCloseAction()
        object NavigateBack : GraphCloseAction()
    }

    /** Render-thread only. */
    private fun pushSettingsNow(ptr: Long) {
        val s = settingsStore.settings()
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
