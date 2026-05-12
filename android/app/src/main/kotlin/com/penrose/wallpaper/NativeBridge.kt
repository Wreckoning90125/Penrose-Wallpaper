package com.penrose.wallpaper

import android.content.res.AssetManager
import android.view.Surface

/**
 * Thin JNI surface. Every entry point takes an opaque `nativePtr` returned by
 * [create] so the native side can hang multiple renderer instances off the
 * same library (one per WallpaperService.Engine).
 *
 * All methods are expected to be invoked from a single thread per renderer
 * (the WallpaperService's render Handler). The native side does not lock.
 */
internal object NativeBridge {

    init { System.loadLibrary("penrose") }

    /** Creates a renderer. Returns 0L on failure. */
    external fun create(assets: AssetManager): Long

    /** Releases the renderer. Must be called from the same thread that calls draw. */
    external fun destroy(nativePtr: Long)

    /** New ANativeWindow available; renderer (re)creates instance/device/swapchain. */
    external fun surfaceCreated(nativePtr: Long, surface: Surface)

    /** Surface geometry changed; renderer recreates the swapchain. */
    external fun surfaceChanged(nativePtr: Long, width: Int, height: Int)

    /**
     * Surface is going away. Renderer must wait for GPU idle and tear down
     * everything that references the ANativeWindow before returning.
     */
    external fun surfaceDestroyed(nativePtr: Long)

    /** Visibility changes drive rendering on/off (battery-friendly). */
    external fun visibilityChanged(nativePtr: Long, visible: Boolean)

    /** Render exactly one frame. No-op if surface isn't ready. */
    external fun drawFrame(nativePtr: Long)
}
