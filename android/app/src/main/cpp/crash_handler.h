#pragma once

// Native crash handler that runs once at JNI_OnLoad. On SIGSEGV /
// SIGBUS / SIGABRT / SIGILL / SIGFPE the handler walks libunwind to
// produce a textual backtrace, prefixes every line with the tag
// `PenroseCrash`, writes it to logcat, and also appends to
// /data/data/com.penrose.wallpaper/files/crash.log. The handler then
// re-raises the signal with the default disposition so Android's
// tombstone facility still records what it would normally record.
//
// Why this is worth the code:
//   - The user can grep `adb logcat -s PenroseCrash:*` to get the stack
//     of an NDK crash without root, without ndk-stack, without a
//     debugger session.
//   - The on-disk copy survives the process death and can be retrieved
//     via `adb pull /data/data/com.penrose.wallpaper/files/crash.log`
//     or shared from the app once a UI is in place.
//
// Call install() exactly once at process start (see jni_bridge.cpp's
// JNI_OnLoad). filesDir comes from the JNI bridge — Context.getFilesDir
// is the only Android-blessed writable path that doesn't need
// permissions and is reliably the same across all Activities in the
// app.

namespace penrose::crash {

// Wire the handler. Idempotent — subsequent calls are no-ops.
// `filesDirAbsolute` is copied; nullptr disables the on-disk log.
void install(const char* filesDirAbsolute);

} // namespace penrose::crash
