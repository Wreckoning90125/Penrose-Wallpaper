package com.penrose.wallpaper

import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.HandlerThread
import android.service.wallpaper.WallpaperService
import android.util.Log
import android.view.MotionEvent
import android.view.SurfaceHolder
import kotlin.math.hypot
import kotlin.math.atan2

/**
 * Live wallpaper entry point. One Engine per visible surface (preview + home).
 *
 * Threading:
 *   - Framework callbacks (onCreate/surfaceCreated/onTouchEvent/etc.) arrive on
 *     the main thread.
 *   - Vulkan work runs on a dedicated HandlerThread per Engine. Touch and
 *     visibility changes are dispatched there via `renderHandler.post {}`.
 *   - SharedPreferences listener fires on the main thread; we post the
 *     applySettings call to the render thread.
 */
class PenroseWallpaperService : WallpaperService() {

    override fun onCreateEngine(): Engine = PenroseEngine()

    private inner class PenroseEngine
        : Engine(),
          SharedPreferences.OnSharedPreferenceChangeListener {

        private val renderThread = HandlerThread("PenroseRender").apply { start() }
        private val renderHandler = Handler(renderThread.looper)

        private var nativePtr: Long = 0L
        private var visible = false

        private val prefs: SharedPreferences =
            getSharedPreferences(Settings.PREFS_NAME, Context.MODE_PRIVATE)

        // ---- Gesture state (main thread only) ---------------------------
        private var p0Id = -1; private var p0x = 0f; private var p0y = 0f
        private var p1Id = -1; private var p1x = 0f; private var p1y = 0f
        private var pinchDist = 0f
        private var pinchAngle = 0f

        // -----------------------------------------------------------------

        override fun onCreate(surfaceHolder: SurfaceHolder) {
            super.onCreate(surfaceHolder)
            setOffsetNotificationsEnabled(false)
            setTouchEventsEnabled(true)
            prefs.registerOnSharedPreferenceChangeListener(this)

            renderHandler.post {
                nativePtr = NativeBridge.create(assets)
                if (nativePtr == 0L) {
                    Log.e(TAG, "native renderer failed to initialise")
                    return@post
                }
                pushSettingsNow()
            }
        }

        override fun onSurfaceCreated(holder: SurfaceHolder) {
            super.onSurfaceCreated(holder)
            val surface = holder.surface
            renderHandler.post {
                if (nativePtr != 0L) NativeBridge.surfaceCreated(nativePtr, surface)
            }
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            renderHandler.post {
                if (nativePtr != 0L) {
                    NativeBridge.surfaceChanged(nativePtr, width, height)
                    if (visible) NativeBridge.drawFrame(nativePtr)
                }
            }
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            super.onSurfaceDestroyed(holder)
            renderHandler.runWithBarrier {
                if (nativePtr != 0L) NativeBridge.surfaceDestroyed(nativePtr)
            }
        }

        override fun onVisibilityChanged(isVisible: Boolean) {
            super.onVisibilityChanged(isVisible)
            visible = isVisible
            renderHandler.post {
                if (nativePtr != 0L) {
                    NativeBridge.visibilityChanged(nativePtr, isVisible)
                    if (isVisible) NativeBridge.drawFrame(nativePtr)
                }
            }
        }

        override fun onTouchEvent(event: MotionEvent) {
            super.onTouchEvent(event)
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    p0Id = event.getPointerId(0)
                    p0x = event.x; p0y = event.y
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
                        val midX = (nx0 + nx1) * 0.5f
                        val midY = (ny0 + ny1) * 0.5f
                        renderHandler.post {
                            if (nativePtr != 0L) {
                                NativeBridge.touchPinch(nativePtr, midX, midY, scale, rotDelta)
                                if (visible) NativeBridge.drawFrame(nativePtr)
                            }
                        }
                        pinchDist = newDist
                        pinchAngle = newAngle
                        p0x = nx0; p0y = ny0
                        p1x = nx1; p1y = ny1
                    } else if (i0 >= 0) {
                        val nx = event.getX(i0); val ny = event.getY(i0)
                        val px = p0x; val py = p0y
                        renderHandler.post {
                            if (nativePtr != 0L) {
                                NativeBridge.touchMove(nativePtr, nx, ny, px, py)
                                if (visible) NativeBridge.drawFrame(nativePtr)
                            }
                        }
                        p0x = nx; p0y = ny
                    }
                }
                MotionEvent.ACTION_POINTER_UP -> {
                    val ix = event.actionIndex
                    val id = event.getPointerId(ix)
                    if (id == p1Id) { p1Id = -1 }
                    else if (id == p0Id) {
                        // promote pointer 1 to pointer 0
                        p0Id = p1Id; p0x = p1x; p0y = p1y
                        p1Id = -1
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    p0Id = -1; p1Id = -1
                }
            }
        }

        override fun onDestroy() {
            prefs.unregisterOnSharedPreferenceChangeListener(this)
            renderHandler.runWithBarrier {
                if (nativePtr != 0L) {
                    NativeBridge.destroy(nativePtr)
                    nativePtr = 0L
                }
            }
            renderThread.quitSafely()
            super.onDestroy()
        }

        override fun onSharedPreferenceChanged(sp: SharedPreferences?, key: String?) {
            renderHandler.post {
                if (nativePtr != 0L) {
                    pushSettingsNow()
                    if (visible) NativeBridge.drawFrame(nativePtr)
                }
            }
        }

        private fun pushSettingsNow() {
            val s = Settings.load(prefs)
            val (ints, floats) = s.toNative()
            NativeBridge.applySettings(nativePtr, ints, floats)
        }
    }

    private fun Handler.runWithBarrier(block: () -> Unit) {
        val lock = Object()
        var done = false
        post {
            try { block() } finally {
                synchronized(lock) { done = true; lock.notifyAll() }
            }
        }
        synchronized(lock) { while (!done) lock.wait() }
    }

    private companion object { const val TAG = "PenroseWallpaper" }
}
