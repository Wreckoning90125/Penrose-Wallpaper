package com.penrose.wallpaper

import android.content.res.AssetManager
import android.view.Surface

/**
 * Thin JNI surface. All calls operate on an opaque `nativePtr` and must be
 * invoked from the same thread per renderer instance (the WallpaperService's
 * render Handler). The native side does not lock.
 */
internal object NativeBridge {

    init { System.loadLibrary("penrose") }

    external fun create(assets: AssetManager): Long
    external fun destroy(nativePtr: Long)

    external fun surfaceCreated(nativePtr: Long, surface: Surface)
    external fun surfaceChanged(nativePtr: Long, width: Int, height: Int)
    external fun surfaceDestroyed(nativePtr: Long)
    external fun visibilityChanged(nativePtr: Long, visible: Boolean)
    external fun drawFrame(nativePtr: Long)

    /**
     * Push the current Settings to the renderer. Encoded as two flat arrays:
     *
     *   ints   = [family, seedIdx, generation, preset, colorCount, colorMode,
     *             borderOn (0/1), bgMode]
     *   floats = [borderWidth, borderL, borderC, borderH, borderAlpha,
     *             bgL, bgC, bgH]
     *
     * Both must match the layout the JNI bridge expects (jni_bridge.cpp).
     */
    external fun applySettings(nativePtr: Long, ints: IntArray, floats: FloatArray)

    external fun touchMove(nativePtr: Long, x: Float, y: Float, prevX: Float, prevY: Float)
    external fun touchPinch(nativePtr: Long, midX: Float, midY: Float, scale: Float, rotDelta: Float)
    external fun resetView(nativePtr: Long)
}
