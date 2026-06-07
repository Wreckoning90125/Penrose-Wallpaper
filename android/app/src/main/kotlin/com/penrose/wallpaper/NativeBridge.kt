package com.penrose.wallpaper

import android.content.res.AssetManager
import android.view.Surface

/**
 * Thin JNI surface. All calls operate on an opaque `nativePtr` and must be
 * invoked through [RendererSession], whose single dispatcher owns the native
 * renderer pointer for each host. The native side does not lock.
 */
internal object NativeBridge {

    init { System.loadLibrary("penrose") }

    /**
     * Wire the native signal handler. Idempotent. Pass an absolute path
     * to a writable directory (typically `context.filesDir`); on crash
     * the handler appends a textual backtrace there AND to logcat under
     * the tag `PenroseCrash`. Grab logs with
     *   adb logcat -s PenroseCrash:*
     * or pull the crash log file from
     *   /data/data/com.penrose.wallpaper/files/crash.log
     * (run-as required on user builds).
     */
    external fun installCrashHandler(filesDirAbsolute: String)

    external fun create(assets: AssetManager): Long
    external fun destroy(nativePtr: Long)

    external fun surfaceCreated(nativePtr: Long, surface: Surface)
    external fun surfaceChanged(nativePtr: Long, width: Int, height: Int)
    external fun surfaceDestroyed(nativePtr: Long)
    external fun drawFrame(nativePtr: Long)

    /**
     * Push the current Settings to the renderer. Encoded as two flat arrays:
     *
     *   ints   = [family, seedIdx, generation, preset, colorCount, colorMode,
     *             borderOn, borderJoin, bgMode, rippleMode, panMode, rippleKind,
     *             projection, hypBorderSubdiv, hypFillSubdiv]
     *   floats = [borderWidth, borderFill, borderPoint, borderGap,
     *             borderL, borderC, borderH, borderAlpha,
     *             bgL, bgC, bgH, rippleAmount,
     *             zoom, rotation, panX, panY,
     *             brightness, depthAmount, rippleSpeed,
     *             material sliders, light sliders, material colour sliders,
     *             matRoughMod, matMetalMod, hypScale, hypBoostX, hypBoostY,
     *             followed by custom OKLCH palette triples]
     *
     * Both must match the layout the JNI bridge expects (jni_bridge.cpp).
     */
    external fun applySettings(nativePtr: Long, ints: IntArray, floats: FloatArray)

    /** Pinch gesture: relative scale + rotation delta. */
    external fun touchPinch(nativePtr: Long, scale: Float, rotDelta: Float)

    /** Single-finger drag delta. In Locked pan mode this is ignored. */
    external fun touchMove(nativePtr: Long, dx: Float, dy: Float)

    /** Read back the current live view transform for persistence on touch-end. */
    external fun readView(nativePtr: Long, out: FloatArray)

    external fun resetView(nativePtr: Long)

    /**
     * Advance the ripple animation clock to `tSeconds` (monotonic seconds since
     * the engine's first vsync). Driven by the Choreographer.
     */
    external fun tick(nativePtr: Long, tSeconds: Float)

    /**
     * Report the surface and screen-window dimensions so the renderer can
     * compensate when the wallpaper surface is wider than the visible
     * screen. All dimensions in pixels.
     */
    external fun surfaceGeometry(nativePtr: Long, surfW: Int, surfH: Int,
                                 screenW: Int, screenH: Int)

    /**
     * Push the home-screen horizontal scroll offset (0..1, 0.5 = centered)
     * so the quasicrystal ripple can phase-shift with page swipes.
     */
    external fun setPageOffset(nativePtr: Long, xOffset: Float)

    /** Configure analyzer kernels from Media3's format callback. */
    external fun configureAudio(sampleRate: Int)

    /**
     * Forward PCM samples to the process-wide audio analyzer. Called
     * from the AudioPlaybackService's Media3 AudioProcessor tap.
     * Writes the analyzer's SPSC ring and returns immediately.
     */
    external fun pushAudio(samples: FloatArray, count: Int)

    /**
     * Read the latest analyzer features from the global analyzer. `out`
     * must have length >= 9 for 8 bands + beat; length >= 15 also receives
     * RMS, spectral flux, onset strength, CWT transient, crest factor, and
     * beat confidence.
     * Used by the modulation matrix evaluator each Choreographer frame.
     */
    external fun readAudio(out: FloatArray)

    /** Clear the global analyzer's temporal state after playback stops. */
    external fun clearAudio()

    /** Toggle the ImGui-based node graph editor overlay on/off. */
    external fun graphSetVisible(nativePtr: Long, visible: Boolean)
    external fun graphIsVisible(nativePtr: Long): Boolean
    /** Serialize the current node graph to JSON for profile persistence. */
    external fun graphSave(nativePtr: Long): String
    external fun graphLoad(nativePtr: Long, json: String): Boolean
    external fun graphReset(nativePtr: Long)

    /**
     * Forward a touch event into the ImGui host's lock-free queue. Phase
     * matches penrose::ui::TouchPhase (0=Down, 1=Move, 2=Up, 3=Cancel,
     * 4=LongPress synthetic right-click). Safe to call from the main UI
     * thread.
     */
    external fun pushTouchEvent(nativePtr: Long, phase: Int, pointerIndex: Int,
                                x: Float, y: Float)

    /**
     * Tell the renderer the device's px-per-dp so ImGui can scale its
     * styles to hit ~48dp touch targets on whatever pixel density the
     * surface ended up with. Called once after [create], before the
     * first [drawFrame] (and therefore before ImGui initialises).
     */
    external fun setUiDensity(nativePtr: Long, density: Float)

    /**
     * Forward the system-bar insets (status bar, nav bar, display
     * cutout) from WindowInsets in surface pixels. The node-editor
     * top app bar uses the top inset so its buttons sit below the
     * status bar instead of being clipped behind it. Values must be
     * non-negative; the renderer clamps anything else to 0.
     */
    external fun setSystemInsets(nativePtr: Long, top: Int, bottom: Int,
                                 left: Int, right: Int)
}
