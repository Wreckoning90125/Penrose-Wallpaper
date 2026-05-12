package com.penrose.wallpaper

import android.content.res.AssetManager
import android.os.Handler
import android.os.HandlerThread
import android.service.wallpaper.WallpaperService
import android.util.Log
import android.view.Surface
import android.view.SurfaceHolder

/**
 * Live wallpaper entry point. Android creates one [Engine] per visible surface
 * (often two — preview pane + real home screen). Each Engine owns its own
 * native renderer instance; they don't share Vulkan state.
 *
 * Threading: the renderer runs on a dedicated [HandlerThread] so the main
 * thread is never blocked on GPU work or vkAcquireNextImageKHR. Lifecycle
 * callbacks from the framework arrive on the main thread and are dispatched
 * to the render thread via [renderHandler].
 */
class PenroseWallpaperService : WallpaperService() {

    override fun onCreateEngine(): Engine = PenroseEngine()

    private inner class PenroseEngine : Engine() {

        private val renderThread = HandlerThread("PenroseRender").apply { start() }
        private val renderHandler = Handler(renderThread.looper)

        private var nativePtr: Long = 0L
        private var currentSurface: Surface? = null
        private var lastWidth = 0
        private var lastHeight = 0
        private var visible = false

        override fun onCreate(surfaceHolder: SurfaceHolder) {
            super.onCreate(surfaceHolder)
            setOffsetNotificationsEnabled(false)
            setTouchEventsEnabled(false)
            renderHandler.post {
                nativePtr = NativeBridge.create(assets)
                if (nativePtr == 0L) Log.e(TAG, "native renderer failed to initialise")
            }
        }

        override fun onSurfaceCreated(holder: SurfaceHolder) {
            super.onSurfaceCreated(holder)
            val surface = holder.surface
            currentSurface = surface
            renderHandler.post {
                if (nativePtr != 0L) NativeBridge.surfaceCreated(nativePtr, surface)
            }
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            lastWidth = width
            lastHeight = height
            renderHandler.post {
                if (nativePtr != 0L) NativeBridge.surfaceChanged(nativePtr, width, height)
                // Render-on-demand: kick a single frame after every layout change.
                if (nativePtr != 0L && visible) NativeBridge.drawFrame(nativePtr)
            }
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            super.onSurfaceDestroyed(holder)
            // Tear down GPU state synchronously so the Surface isn't reused
            // by the framework while Vulkan still has it bound.
            renderHandler.runWithBarrier {
                if (nativePtr != 0L) NativeBridge.surfaceDestroyed(nativePtr)
            }
            currentSurface = null
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

        override fun onDestroy() {
            renderHandler.runWithBarrier {
                if (nativePtr != 0L) {
                    NativeBridge.destroy(nativePtr)
                    nativePtr = 0L
                }
            }
            renderThread.quitSafely()
            super.onDestroy()
        }
    }

    /**
     * Submit a Runnable to a Handler and block until it has executed.
     * Used for teardown paths where the framework would otherwise race us
     * to recycle the Surface.
     */
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
