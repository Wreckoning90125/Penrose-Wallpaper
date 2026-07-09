package com.penrose.wallpaper

import android.app.WallpaperManager
import android.content.Context
import android.service.wallpaper.WallpaperService
import android.util.Log
import android.view.Choreographer
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.WindowManager
import com.penrose.wallpaper.audio.AudioPlaybackService
import com.penrose.wallpaper.preset.SettingsSnapshotStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.atan2
import kotlin.math.hypot

/**
 * Live wallpaper entry point. One Engine per visible surface (preview + home).
 *
 * Threading model:
 *   - Framework callbacks (onCreate / surfaceCreated / onTouchEvent /
 *     onOffsetsChanged / etc.) arrive on the main thread.
 *   - Every NativeBridge call is funnelled through [session]
 *     ([RendererSession]) — a single-thread coroutine dispatcher
 *     that privately owns the renderer's `nativePtr`. Main-thread
 *     code never reads the pointer; it only describes intent.
 *   - SettingsStore listeners fire on the main thread; we
 *     submit the applySettings call to the dispatcher.
 */
class PenroseWallpaperService : WallpaperService() {

    override fun onCreateEngine(): Engine = PenroseEngine()

    private inner class PenroseEngine
        : Engine(),
          Choreographer.FrameCallback {

        private val session = RendererSession("PenroseRender")
        private val engineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

        private var visible = false

        private lateinit var settingsStore: SettingsStore
        private lateinit var workingSettingsStore: SettingsStore
        private var settingsReady = false
        private val wallpaperSettingsListener = SettingsStore.Listener { key ->
            onWallpaperSettingChanged(key)
        }
        private val workingSettingsListener = SettingsStore.Listener { key ->
            if (key == Settings.KEY_AUDIO_ACTIVE) updateChoreographer()
        }

        private var rippleAmount = 0f
        private var rippleMode = 0
        private var panMode = 0
        private var lightChoreoAmount = 0f
        private var lightChoreoSource = 0f
        private var graphWantsLoop = false

        private val choreographer: Choreographer by lazy { Choreographer.getInstance() }
        private var frameCallbackPosted = false
        private var startFrameNanos = 0L

        // ---- Gesture state (main thread only) ---------------------------
        private var p0Id = -1; private var p0x = 0f; private var p0y = 0f
        private var p1Id = -1; private var p1x = 0f; private var p1y = 0f
        private var pinchDist = 0f
        private var pinchAngle = 0f
        // Pinch / pan gestures update the renderer immediately; on touch
        // release we read the live view back and persist it to settings so the
        // next session opens at the same zoom / rotation.
        private var gestureTouched = false
        // True from ACTION_DOWN through ACTION_UP/CANCEL. Arms the
        // Choreographer so the renderer pulls touch state at vsync rate
        // instead of fielding per-event drawFrame posts that would queue
        // behind FIFO present.
        private var gestureActive = false

        // -----------------------------------------------------------------

        override fun onCreate(surfaceHolder: SurfaceHolder) {
            super.onCreate(surfaceHolder)
            setOffsetNotificationsEnabled(true)
            setTouchEventsEnabled(true)

            val (screenW, screenH) = currentScreenSize()
            try {
                WallpaperManager.getInstance(this@PenroseWallpaperService)
                    .suggestDesiredDimensions(screenW, screenH)
            } catch (e: Exception) {
                Log.w(TAG, "suggestDesiredDimensions failed", e)
            }

            session.start(assets, resources.displayMetrics.density, TAG)
            engineScope.launch {
                val wallpaperStore = withContext(Dispatchers.IO) {
                    SettingsStore.openWallpaper(this@PenroseWallpaperService)
                }
                val workingStore = withContext(Dispatchers.IO) {
                    SettingsStore.openWorking(this@PenroseWallpaperService)
                }
                settingsStore = wallpaperStore
                workingSettingsStore = workingStore
                settingsReady = true
                settingsStore.registerListener(wallpaperSettingsListener)
                workingSettingsStore.registerListener(workingSettingsListener)
                pushSettingsFromStore()
                session.submit { ptr ->
                    loadGraphFromStore(ptr)
                    NativeBridge.drawFrame(ptr)
                }
            }
        }

        private fun currentScreenSize(): Pair<Int, Int> {
            val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val bounds = wm.currentWindowMetrics.bounds
            return bounds.width() to bounds.height()
        }

        override fun onSurfaceCreated(holder: SurfaceHolder) {
            super.onSurfaceCreated(holder)
            val surface = holder.surface
            session.submit { ptr ->
                NativeBridge.surfaceCreated(ptr, surface)
                // Pick up whatever modulation graph the in-app editor /
                // a preset has written. Wallpaper service never edits
                // the graph itself, so this is read-only — no
                // corresponding save path on destroy.
                if (settingsReady) loadGraphFromStore(ptr)
            }
        }

        /**
         * Render-thread only. Reads the graph captured by Apply as Wallpaper
         * into the active Renderer's Graph via the JNI bridge.
         */
        private fun loadGraphFromStore(ptr: Long) {
            var nextGraphWantsLoop = false
            try {
                val json = SettingsSnapshotStore.storedGraphJson(settingsStore)
                if (!NativeBridge.graphLoad(ptr, json)) {
                    Log.w(TAG, "graph load failed")
                } else {
                    nextGraphWantsLoop = NativeBridge.graphNeedsFrameLoop(ptr)
                }
            } catch (e: Exception) {
                Log.w(TAG, "graph load failed", e)
            }
            engineScope.launch {
                graphWantsLoop = nextGraphWantsLoop
                updateChoreographer()
            }
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            // Re-query the screen window every time the surface resizes so the
            // fit-to-screen math sees the current orientation. Rotation fires
            // onSurfaceChanged with the new surface dims; the WindowManager
            // bounds already reflect the post-rotation configuration by then.
            // Drawing unconditionally here keeps the wallpaper buffer in sync
            // with the surface — important on the lockscreen, where the engine
            // may not be visible but the system still presents the buffer.
            val (screenW, screenH) = currentScreenSize()
            session.submit { ptr ->
                NativeBridge.surfaceChanged(ptr, width, height)
                NativeBridge.surfaceGeometry(ptr, width, height, screenW, screenH)
                NativeBridge.drawFrame(ptr)
            }
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            super.onSurfaceDestroyed(holder)
            disarmChoreographer()
            session.submitBlocking { ptr ->
                NativeBridge.surfaceDestroyed(ptr)
            }
        }

        override fun onVisibilityChanged(isVisible: Boolean) {
            super.onVisibilityChanged(isVisible)
            visible = isVisible
            if (isVisible && settingsReady) {
                session.submit { ptr -> NativeBridge.drawFrame(ptr) }
            }
            updateChoreographer()
        }

        override fun onOffsetsChanged(
            xOffset: Float, yOffset: Float,
            xOffsetStep: Float, yOffsetStep: Float,
            xPixelOffset: Int, yPixelOffset: Int,
        ) {
            val shouldDraw = visible
            val effectiveXPixelOffset = if (panMode == 2 && xPixelOffset == 0 && xOffsetStep > 0f) {
                val (screenW, _) = currentScreenSize()
                val pageCount = (1f / xOffsetStep).toInt().coerceAtLeast(1) + 1
                -(xOffset.coerceIn(0f, 1f) * screenW * (pageCount - 1) + 0.5f).toInt()
            } else {
                xPixelOffset
            }
            session.submit { ptr ->
                NativeBridge.setPageOffset(ptr, xOffset, effectiveXPixelOffset)
                if (shouldDraw) NativeBridge.drawFrame(ptr)
            }
        }

        override fun onTouchEvent(event: MotionEvent) {
            super.onTouchEvent(event)
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    p0Id = event.getPointerId(0)
                    p0x = event.x; p0y = event.y
                    gestureActive = true
                    updateChoreographer()
                }
                MotionEvent.ACTION_POINTER_DOWN -> {
                    if (p1Id == -1) {
                        val ix = event.actionIndex
                        p1Id = event.getPointerId(ix)
                        p1x = event.getX(ix); p1y = event.getY(ix)
                        pinchDist = hypot(p1x - p0x, p1y - p0y).coerceAtLeast(1f)
                        pinchAngle = atan2(p1y - p0y, p1x - p0x)
                    }
                }
                MotionEvent.ACTION_MOVE -> {
                    val i0 = event.findPointerIndex(p0Id)
                    val i1 = if (p1Id == -1) -1 else event.findPointerIndex(p1Id)
                    if (i1 >= 0 && i0 >= 0) {
                        val nx0 = event.getX(i0); val ny0 = event.getY(i0)
                        val nx1 = event.getX(i1); val ny1 = event.getY(i1)
                        val newDist = hypot(nx1 - nx0, ny1 - ny0).coerceAtLeast(1f)
                        val newAngle = atan2(ny1 - ny0, nx1 - nx0)
                        val scale = newDist / pinchDist
                        val rotDelta = newAngle - pinchAngle
                        // Update state only; the Choreographer drives drawFrame
                        // at vsync. Posting drawFrame per touch event would
                        // queue redundant renders behind FIFO present and lag
                        // the gesture by frame-count × vsync interval.
                        session.submit { ptr ->
                            NativeBridge.touchPinch(ptr, scale, rotDelta)
                        }
                        pinchDist = newDist
                        pinchAngle = newAngle
                        p0x = nx0; p0y = ny0
                        p1x = nx1; p1y = ny1
                        gestureTouched = true
                    } else if (i0 >= 0) {
                        val nx = event.getX(i0); val ny = event.getY(i0)
                        val dx = nx - p0x
                        val dy = ny - p0y
                        session.submit { ptr ->
                            NativeBridge.touchMove(ptr, dx, dy)
                        }
                        p0x = nx; p0y = ny
                        gestureTouched = true
                    }
                }
                MotionEvent.ACTION_POINTER_UP -> {
                    val ix = event.actionIndex
                    val id = event.getPointerId(ix)
                    if (id == p1Id) { p1Id = -1 }
                    else if (id == p0Id) {
                        p0Id = p1Id; p0x = p1x; p0y = p1y
                        p1Id = -1
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    p0Id = -1; p1Id = -1
                    gestureActive = false
                    updateChoreographer()
                    if (gestureTouched) {
                        gestureTouched = false
                        commitViewToSettings()
                    }
                }
            }
        }

        /**
         * Read the renderer's live view back and persist it. The
         * SettingsStore listener will fire and re-push settings on the
         * render thread; the values are already in `view_` so the round-trip
         * is a no-op visually.
         */
        private fun commitViewToSettings() {
            if (!settingsReady) return
            val out = session.query { ptr ->
                val out = FloatArray(4)
                NativeBridge.readView(ptr, out)
                out
            } ?: return
            try {
                queueViewSaveToProfiles(out)
            } catch (e: Exception) {
                Log.w(TAG, "view save failed", e)
            }
        }

        private fun queueViewSaveToProfiles(out: FloatArray) {
            val wallpaperWrite = Settings.saveViewAsync(settingsStore, out[0], out[1], out[2], out[3])
            wallpaperWrite.invokeOnCompletion { cause ->
                if (cause != null) {
                    Log.w(TAG, "wallpaper view save failed", cause)
                    return@invokeOnCompletion
                }
                try {
                    val workingWrite = Settings.saveViewAsync(workingSettingsStore, out[0], out[1], out[2], out[3])
                    workingWrite.invokeOnCompletion { workingCause ->
                        if (workingCause != null) Log.w(TAG, "working view save failed", workingCause)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "working view save failed", e)
                }
            }
        }

        override fun onDestroy() {
            disarmChoreographer()
            if (settingsReady) {
                settingsStore.unregisterListener(wallpaperSettingsListener)
                workingSettingsStore.unregisterListener(workingSettingsListener)
            }
            engineScope.cancel()
            session.shutdown()
            super.onDestroy()
        }

        private fun onWallpaperSettingChanged(key: String?) {
            if (!settingsReady) return
            // Preset-apply bumps the `_graph_revision` long; sliders /
            // dropdowns don't. Only reload the JSON on the revision
            // bump — otherwise every slider drag (60 Hz) would do a
            // full graph teardown + rebuild on the render thread.
            val isGraphChange = key == Settings.KEY_GRAPH_REVISION
            pushSettingsFromStore()
            if (isGraphChange) {
                session.submit { ptr -> loadGraphFromStore(ptr) }
            }
            if (visible) {
                session.submit { ptr -> NativeBridge.drawFrame(ptr) }
            }
        }

        /**
         * Main thread: read settings, mirror ripple state to fields used by
         * [updateChoreographer], submit the JNI applySettings call to
         * the render dispatcher, and update Choreographer arming. Split
         * across threads on purpose — Choreographer requires a Looper,
         * the dispatcher thread has none.
         */
        private fun pushSettingsFromStore() {
            if (!settingsReady) return
            val s = settingsStore.settings()
            rippleAmount = s.rippleAmount
            rippleMode = s.rippleMode
            panMode = s.panMode
            lightChoreoAmount = s.lightChoreoAmount
            lightChoreoSource = s.lightChoreoSource
            val (ints, floats) = s.toNative()
            session.submit { ptr ->
                NativeBridge.applySettings(ptr, ints, floats)
            }
            updateChoreographer()
        }

        // ----------- Choreographer-driven render loop ---------------------

        private fun updateChoreographer() {
            // Arm whenever the wallpaper needs a per-frame eval: an
            // active gesture, the time-term of the ripple, or audio
            // playback (skipping it entirely while everything is quiet
            // keeps the wallpaper from burning vsyncs on a static image).
            val rippleWantsLoop = rippleAmount > 0f &&
                (rippleMode == RIPPLE_MODE_TIME || rippleMode == RIPPLE_MODE_TIME_PAGE)
            // While a track plays the modulation graph must keep being
            // evaluated, or the home-screen wallpaper freezes on a stale
            // frame and shows no audio reactivity. currentUri is the
            // audio service's in-memory truth (it clears when the
            // service or process dies, so it can't get stuck), and the
            // service's KEY_AUDIO_ACTIVE DataStore write is what wakes
            // workingSettingsListener -> updateChoreographer when
            // playback starts or stops.
            val audioActive = AudioPlaybackService.currentUri != null
            val lightChoreoWantsLoop = lightChoreoAmount > 0f && lightChoreoSource != 1f
            val wantLoop = visible && (gestureActive || rippleWantsLoop || audioActive || lightChoreoWantsLoop || graphWantsLoop)
            if (wantLoop) armChoreographer() else disarmChoreographer()
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
            val drawing = visible
            session.submit { ptr ->
                if (!drawing) return@submit
                NativeBridge.tick(ptr, tSeconds)
                NativeBridge.drawFrame(ptr)
            }
            if (frameCallbackPosted) choreographer.postFrameCallback(this)
        }
    }

    private companion object {
        const val TAG = "PenroseWallpaper"
        const val RIPPLE_MODE_TIME = 0
        const val RIPPLE_MODE_PAGE = 1
        const val RIPPLE_MODE_TIME_PAGE = 2
        const val PAN_MODE_ENDLESS = 2
    }
}
