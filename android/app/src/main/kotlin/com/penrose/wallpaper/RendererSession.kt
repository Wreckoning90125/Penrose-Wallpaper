package com.penrose.wallpaper

import android.content.res.AssetManager
import android.util.Log
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineName
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.util.concurrent.Executors

/**
 * Single-thread owner of a native [com.penrose.wallpaper.NativeBridge]
 * `Renderer*`. Replaces the hand-rolled
 * `HandlerThread + @Volatile nativePtr + runWithBarrier` pattern that
 * previously appeared (with subtle variations) in SettingsActivity,
 * FullScreenActivity and PenroseWallpaperService.
 *
 * The structural problem we are fixing here is a textbook TOCTOU:
 * the previous code read a `@Volatile Long nativePtr` from the main
 * thread (touch handlers, gesture callbacks), then immediately
 * called a `NativeBridge` function with that pointer value. Between
 * the read and the JNI call, the render thread could run
 * `NativeBridge.destroy(ptr)` and zero the slot — the pointer the
 * main thread captured was already dangling. JNI then dereferenced
 * a freed `Renderer*`. This is a use-after-free, not a data race;
 * `@Volatile` did not (and cannot) fix it.
 *
 * The fix is to make the pointer **strictly thread-local** to the
 * render dispatcher. It is a private field touched only from inside
 * coroutines that run on [dispatcher]. The two ways callers interact
 * with the renderer:
 *
 *   * [submit]         — fire-and-forget. The block runs on the
 *                        render thread when the queue catches up.
 *                        No-op if the session is shut down.
 *   * [submitBlocking] — synchronous. Used for teardown paths that
 *                        must observe completion before the host
 *                        proceeds (e.g. Activity.onDestroy() saving
 *                        graph JSON before the C++ side is freed).
 *
 * `shutdown()` is the one place where the executor itself is torn
 * down. It drains in-flight render-thread work, runs
 * `NativeBridge.destroy(ptr)` exactly once, then cancels the scope
 * and shuts the executor. Any [submit] calls that race against
 * shutdown silently become no-ops.
 *
 * Thread model:
 *   * One executor thread per session. Named for the consumer
 *     (`PenrosePreview`, `PenroseFull`, `PenroseRender`).
 *   * The Kotlin Main dispatcher is **never** used to make
 *     `NativeBridge` calls. Main-thread code only posts blocks here.
 *   * The render thread is the sole serializer: there is no lock,
 *     because there is no concurrency.
 *
 * Lifecycle wiring: implements [DefaultLifecycleObserver] so an
 * Activity can register the session with `lifecycle.addObserver(it)`
 * and the framework fires [shutdown] on `ON_DESTROY` without the
 * Activity having to remember to call it manually. The wallpaper
 * Engine has no Lifecycle and continues to call [shutdown] from its
 * own `onDestroy`.
 */
internal class RendererSession(name: String) : DefaultLifecycleObserver {

    private val executor = Executors.newSingleThreadExecutor { r ->
        // Daemon so a forgotten shutdown doesn't keep the process alive.
        // In practice every consumer wires shutdown() into onDestroy.
        Thread(r, name).apply { isDaemon = true }
    }

    // Single-threaded coroutine dispatcher backed by [executor]. Not
    // exposed publicly: consumers reach the dispatcher only via
    // submit / submitBlocking / query, which always pass the live
    // pointer in. Letting callers schedule onto the dispatcher
    // directly would re-open the door to "I have a pointer" code
    // paths that this class exists to abolish.
    private val dispatcher: CoroutineDispatcher = executor.asCoroutineDispatcher()

    private val supervisor = SupervisorJob()

    // SupervisorJob so one misbehaving submission fails without
    // poisoning the rest. CoroutineName for crash-log readability.
    private val scope = CoroutineScope(dispatcher + supervisor + CoroutineName(name))

    // Touched ONLY from coroutines running on [dispatcher]. Reading or
    // writing from any other thread is incorrect.
    private var nativePtr: Long = 0L

    // Set by shutdown(); checked from inside dispatcher blocks so a
    // submission queued after shutdown does nothing.
    @Volatile private var stopped = false

    /**
     * Queue native renderer construction. Fire-and-forget — the
     * caller submits more work via [submit] immediately afterwards,
     * and FIFO ordering on the single-thread dispatcher guarantees
     * those blocks see a valid pointer. If create fails (JNI
     * bootstrap broken) every subsequent [submit] block silently
     * no-ops because the ptr stays 0.
     *
     * Returns immediately on the caller's thread. Idempotent — call
     * once per session from the host's onCreate.
     */
    fun start(assets: AssetManager, density: Float, tag: String = "RendererSession") {
        scope.launch {
            if (stopped || nativePtr != 0L) return@launch
            nativePtr = NativeBridge.create(assets)
            if (nativePtr == 0L) {
                Log.e(tag, "NativeBridge.create returned null pointer")
                return@launch
            }
            NativeBridge.setUiDensity(nativePtr, density)
        }
    }

    /**
     * Run [block] on the render thread, with the live native pointer
     * passed as an argument. If the session is stopped or the pointer
     * is zero (creation failed), the block is dropped.
     */
    fun submit(block: (Long) -> Unit): Job = scope.launch {
        if (!stopped && nativePtr != 0L) block(nativePtr)
    }

    /**
     * Run [block] on the render thread and block the caller until it
     * completes. The Activity / Engine destroy path needs this so
     * file I/O (graph save) and `NativeBridge.surfaceDestroyed`
     * happen-before the renderer is destroyed.
     *
     * `runBlocking` rather than `lifecycleScope.launch().join()` so
     * teardown is synchronous on the calling thread — usually main,
     * which is fine: the work is bounded (one drawFrame at worst,
     * plus a sub-millisecond JNI hop).
     */
    fun submitBlocking(block: (Long) -> Unit) {
        if (stopped) return
        runBlocking(dispatcher) {
            if (nativePtr != 0L) block(nativePtr)
        }
    }

    /**
     * Synchronously query the renderer. Used for the rare main-thread
     * read paths that need an immediate answer (e.g. "is the graph
     * editor visible right now? should this back press close it?").
     * Returns null if the session is stopped or the renderer hasn't
     * been created — caller treats null as "no, fall through to
     * default behaviour".
     */
    fun <R : Any> query(block: (Long) -> R): R? {
        if (stopped) return null
        return runBlocking(dispatcher) {
            if (nativePtr == 0L) null else block(nativePtr)
        }
    }

    /**
     * Lifecycle hook — fires when an attached [LifecycleOwner]
     * reaches `ON_DESTROY`. Routes through [shutdown] so the
     * lifecycle-wired and the manual call paths converge on the
     * same idempotent teardown.
     */
    override fun onDestroy(owner: LifecycleOwner) {
        shutdown()
    }

    /**
     * Tear down the renderer and the dispatcher. Calls
     * `NativeBridge.destroy(ptr)` on the render thread, cancels the
     * scope so no further submissions land, then shuts the executor.
     * Safe to call multiple times; subsequent calls are no-ops.
     * The wallpaper Engine (not a LifecycleOwner) calls this
     * directly; the Activities reach it through the lifecycle
     * observer.
     */
    fun shutdown() {
        if (stopped) return
        stopped = true
        // Synchronously run destroy on the render thread. If a
        // previous submit is still in flight, runBlocking queues
        // behind it (single-thread executor → FIFO ordering).
        runBlocking(dispatcher) {
            if (nativePtr != 0L) {
                NativeBridge.destroy(nativePtr)
                nativePtr = 0L
            }
        }
        scope.cancel()
        executor.shutdown()
    }
}
