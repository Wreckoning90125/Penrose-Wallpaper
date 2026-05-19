package com.penrose.wallpaper

import android.app.Application
import android.content.pm.ApplicationInfo
import android.os.StrictMode

/**
 * Process-wide setup. Two jobs:
 *
 *  1. Wire the native crash handler before any Activity or Service
 *     runs, so signals raised by Renderer / ImGui / Vulkan land in
 *     logcat (tag `PenroseCrash`) AND `filesDir/crash.log`. Without
 *     this, NDK crashes either disappear into Android's tombstone-only
 *     path (requires root or `adb bugreport`) or fall through
 *     unattributed.
 *  2. Enable StrictMode on debuggable builds — Google's curated set of
 *     runtime self-checks. Logs (not crashes) on disk I/O / network
 *     from the main thread, leaked Closeables, leaked broadcast
 *     receivers, unsafe intent launches. Logs only (`penaltyLog`) so
 *     the warning is visible in logcat but doesn't kill the app.
 *
 * To pull a crash on a release build:
 *   adb logcat -s PenroseCrash:* Penrose:*
 *   adb shell run-as com.penrose.wallpaper cat files/crash.log
 *
 * To see StrictMode warnings:
 *   adb logcat -s StrictMode:*
 */
class PenroseApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        // filesDir is /data/data/com.penrose.wallpaper/files. The native
        // side creates crash.log on first crash and appends on subsequent
        // ones. Deletable from the app's storage settings if it ever
        // grows unwieldy.
        NativeBridge.installCrashHandler(filesDir.absolutePath)

        // FLAG_DEBUGGABLE is set on the `debug` build type and unset on
        // `release`; using applicationInfo instead of BuildConfig keeps
        // us from re-enabling Gradle's buildConfig generation just for
        // this one bool.
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (debuggable) {
            StrictMode.setThreadPolicy(
                StrictMode.ThreadPolicy.Builder()
                    .detectAll()
                    .penaltyLog()
                    .build()
            )
            StrictMode.setVmPolicy(
                StrictMode.VmPolicy.Builder()
                    .detectLeakedClosableObjects()
                    .detectLeakedRegistrationObjects()
                    .detectLeakedSqlLiteObjects()
                    .detectFileUriExposure()
                    .penaltyLog()
                    .build()
            )
        }
    }
}
