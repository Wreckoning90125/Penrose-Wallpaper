package com.penrose.wallpaper

import android.content.Context
import android.os.Bundle
import android.util.Log
import android.view.Choreographer
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewConfiguration
import android.view.WindowManager
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import com.penrose.wallpaper.preset.SettingsSnapshotStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot

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
                         SettingsStore.Listener,
                         Choreographer.FrameCallback {

    // Registered as a lifecycle observer in onCreate; ON_DESTROY auto-
    // fires session.shutdown() (see RendererSession.onDestroy).
    private val session = RendererSession("PenrosePreview")
        .also { lifecycle.addObserver(it) }

    private lateinit var settingsStore: SettingsStore
    private var settingsListenerRegistered = false
    private var pendingInitialSheet = false

    private val choreographer: Choreographer by lazy { Choreographer.getInstance() }
    private var frameCallbackPosted = false
    private var startFrameNanos = 0L

    // Single-tap-up detector used while the sheet is dismissed: tapping
    // the preview brings the sheet back. Drag / pinch gestures are handled
    // below and persisted at touch-end like the wallpaper Engine path.
    private val previewTapDetector by lazy {
        GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onSingleTapUp(e: MotionEvent): Boolean {
                showSettingsSheetIfHidden()
                return true
            }
        })
    }

    private var p0Id = -1; private var p0x = 0f; private var p0y = 0f
    private var p1Id = -1; private var p1x = 0f; private var p1y = 0f
    private var pinchDist = 0f
    private var pinchAngle = 0f
    private var previewGestureTouched = false
    private var loadedWorkingGraphJson: String? = null
    private val touchSlopPx: Float by lazy {
        ViewConfiguration.get(this).scaledTouchSlop.toFloat()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        pendingInitialSheet = savedInstanceState == null

        lifecycleScope.launch {
            settingsStore = withContext(Dispatchers.IO) {
                SettingsStore.openWorking(this@SettingsActivity)
            }
            initializePreview()
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                registerSettingsListener()
                maybeShowInitialSheet()
            }
        }
    }

    private fun initializePreview() {
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
                    loadGraphFromStore(ptr)
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

    override fun onStart() {
        super.onStart()
        registerSettingsListener()
        maybeShowInitialSheet()
    }

    override fun onStop() {
        unregisterSettingsListener()
        super.onStop()
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

    private fun showSettingsSheetIfHidden() {
        if (!lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return
        if (supportFragmentManager.isStateSaved) return
        if (supportFragmentManager.findFragmentByTag(TAG_SHEET) != null) return
        SettingsBottomSheetDialogFragment()
            .show(supportFragmentManager, TAG_SHEET)
    }

    private fun maybeShowInitialSheet() {
        if (!pendingInitialSheet) return
        if (!lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return
        if (supportFragmentManager.isStateSaved) return
        pendingInitialSheet = false
        showSettingsSheetIfHidden()
    }

    override fun onResume() {
        super.onResume()
        if (!::settingsStore.isInitialized) return
        syncWorkingGraphFromStore()
    }

    private fun currentScreenSize(): Pair<Int, Int> {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val bounds = wm.currentWindowMetrics.bounds
        return bounds.width() to bounds.height()
    }

    override fun onSettingChanged(key: String?) {
        session.submit { ptr ->
            pushSettingsNow(ptr)
            if (key == Settings.KEY_GRAPH_REVISION) loadGraphFromStore(ptr)
            NativeBridge.drawFrame(ptr)
        }
    }

    /** Render-thread only. */
    private fun pushSettingsNow(ptr: Long) {
        val s = settingsStore.settings()
        val (ints, floats) = s.toNative()
        NativeBridge.applySettings(ptr, ints, floats)
    }

    /**
     * Read the working graph snapshot into the active Renderer.
     * Render-thread only.
     */
    private fun loadGraphFromStore(ptr: Long) {
        try {
            val json = SettingsSnapshotStore.storedGraphJson(settingsStore)
            if (json == loadedWorkingGraphJson) return
            if (NativeBridge.graphLoad(ptr, json)) {
                loadedWorkingGraphJson = json
            } else {
                Log.w(TAG, "graph load failed")
            }
        } catch (e: Exception) {
            Log.w(TAG, "graph load failed", e)
        }
    }

    private fun syncWorkingGraphFromStore() {
        session.submit { ptr ->
            loadGraphFromStore(ptr)
            NativeBridge.drawFrame(ptr)
        }
    }

    /**
     * Public hook called by the preset-loader before it commits the
     * preset's graph JSON to the settings store. The caller always passes a
     * concrete JSON string ({"nodes":[],"links":[]} for presets that
     * have no graph block) so this method only needs the graphLoad
     * path.
     */
    fun applyPresetGraph(json: String): Boolean =
        session.query { ptr ->
            val loaded = NativeBridge.graphLoad(ptr, json)
            if (loaded) loadedWorkingGraphJson = json
            NativeBridge.drawFrame(ptr)
            loaded
        } ?: false

    fun currentGraphJson(): String? =
        session.query { ptr ->
            NativeBridge.graphSave(ptr)
        }?.takeIf { it.isNotBlank() }

    fun commitPreviewViewToSettings() {
        val out = session.query { ptr ->
            val out = FloatArray(4)
            NativeBridge.readView(ptr, out)
            out
        } ?: return
        persistView(out)
    }

    suspend fun commitPreviewViewToSettingsAwait() {
        val out = session.query { ptr ->
            val out = FloatArray(4)
            NativeBridge.readView(ptr, out)
            out
        } ?: return
        if (!::settingsStore.isInitialized) return
        Settings.saveView(settingsStore, out[0], out[1], out[2], out[3])
    }

    fun resetPreviewView() {
        val out = session.query { ptr ->
            NativeBridge.resetView(ptr)
            val out = FloatArray(4)
            NativeBridge.readView(ptr, out)
            NativeBridge.drawFrame(ptr)
            out
        } ?: return
        persistView(out)
    }

    private fun persistView(out: FloatArray) {
        if (!::settingsStore.isInitialized) return
        try {
            Settings.saveViewAsync(settingsStore, out[0], out[1], out[2], out[3])
        } catch (e: Exception) {
            Log.w(TAG, "view save failed", e)
        }
    }

    override fun onDestroy() {
        // session.shutdown() is wired through the lifecycle observer
        // registered in the field initializer — Lifecycle fires
        // RendererSession.onDestroy on ON_DESTROY, no explicit call
        // needed here.
        disarmChoreographer()
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
        if (supportFragmentManager.findFragmentByTag(TAG_SHEET) == null) {
            previewTapDetector.onTouchEvent(event)
            handlePreviewTransformEvent(event)
            return true
        }

        return super.dispatchTouchEvent(event)
    }

    private fun handlePreviewTransformEvent(event: MotionEvent) {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                p0Id = event.getPointerId(0)
                p0x = event.x
                p0y = event.y
                p1Id = -1
                previewGestureTouched = false
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                if (p1Id == -1) {
                    val ix = event.actionIndex
                    p1Id = event.getPointerId(ix)
                    p1x = event.getX(ix)
                    p1y = event.getY(ix)
                    pinchDist = hypot(p1x - p0x, p1y - p0y).coerceAtLeast(1f)
                    pinchAngle = atan2(p1y - p0y, p1x - p0x)
                }
            }
            MotionEvent.ACTION_MOVE -> {
                val i0 = event.findPointerIndex(p0Id)
                val i1 = if (p1Id == -1) -1 else event.findPointerIndex(p1Id)
                if (i1 >= 0 && i0 >= 0) {
                    val nx0 = event.getX(i0)
                    val ny0 = event.getY(i0)
                    val nx1 = event.getX(i1)
                    val ny1 = event.getY(i1)
                    val newDist = hypot(nx1 - nx0, ny1 - ny0).coerceAtLeast(1f)
                    val newAngle = atan2(ny1 - ny0, nx1 - nx0)
                    val scale = newDist / pinchDist
                    val rotDelta = newAngle - pinchAngle
                    if (
                        previewGestureTouched
                        || abs(newDist - pinchDist) >= touchSlopPx
                        || abs(rotDelta) * pinchDist >= touchSlopPx
                    ) {
                        session.submit { ptr -> NativeBridge.touchPinch(ptr, scale, rotDelta) }
                        pinchDist = newDist
                        pinchAngle = newAngle
                        p0x = nx0; p0y = ny0
                        p1x = nx1; p1y = ny1
                        previewGestureTouched = true
                    }
                } else if (i0 >= 0) {
                    val nx = event.getX(i0)
                    val ny = event.getY(i0)
                    val dx = nx - p0x
                    val dy = ny - p0y
                    if (previewGestureTouched || dx * dx + dy * dy >= touchSlopPx * touchSlopPx) {
                        session.submit { ptr -> NativeBridge.touchMove(ptr, dx, dy) }
                        p0x = nx
                        p0y = ny
                        previewGestureTouched = true
                    }
                }
            }
            MotionEvent.ACTION_POINTER_UP -> {
                val ix = event.actionIndex
                val id = event.getPointerId(ix)
                if (id == p1Id) {
                    p1Id = -1
                } else if (id == p0Id) {
                    p0Id = p1Id
                    p0x = p1x
                    p0y = p1y
                    p1Id = -1
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                p0Id = -1
                p1Id = -1
                if (previewGestureTouched) {
                    previewGestureTouched = false
                    commitPreviewViewToSettings()
                }
            }
        }
    }

    private companion object {
        const val TAG = "PenroseSettings"
        const val TAG_SHEET = "settings_sheet"
    }
}
