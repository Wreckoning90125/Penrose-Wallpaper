#include "audio/audio_analyzer.h"
#include "crash_handler.h"
#include "log.h"
#include "renderer/renderer.h"
#include "settings.h"

#include <algorithm>

#include <android/asset_manager.h>
#include <android/asset_manager_jni.h>
#include <android/native_window.h>
#include <android/native_window_jni.h>
#include <jni.h>

using namespace penrose;

namespace {

inline Renderer* asRenderer(jlong ptr) { return reinterpret_cast<Renderer*>(ptr); }

// Decode a Settings struct from the flat int/float arrays the Kotlin side
// passes us. Layout (ints / floats):
//   ints:   [family, seedIdx, generation, preset, colorCount, colorMode,
//            borderOn, bgMode, rippleMode, panMode, rippleKind]
//   floats: [borderWidth, borderL, borderC, borderH, borderAlpha,
//            bgL, bgC, bgH, rippleAmount,
//            zoom, rotation, panX, panY,
//            brightness, depthAmount, rippleSpeed,
//            custom_0_L, custom_0_C, custom_0_H, ..., custom_9_L, custom_9_C, custom_9_H]
constexpr int kIntCount = 11;
constexpr int kFloatCount = 13 + 3 + 3 * kMaxColors;

Settings decodeSettings(const jint* ints, const jfloat* floats) {
    Settings s{};
    int fam = ints[0]; if (fam < 0 || fam > 2) fam = 0;
    s.family = static_cast<Family>(fam);
    s.seedIdx = ints[1];
    s.generation = ints[2];
    int preset = ints[3]; if (preset < 0 || preset >= kPresetCount) preset = (int)Preset::Gold;
    s.preset = static_cast<Preset>(preset);
    s.colorCount = ints[4];
    int mode = ints[5]; if (mode < 0 || mode > 2) mode = 0;
    s.colorMode = static_cast<ColorMode>(mode);
    s.borderOn = (ints[6] != 0);
    int bg = ints[7]; if (bg < 0 || bg > 1) bg = 0;
    s.bgMode = static_cast<BackgroundMode>(bg);
    int rm = ints[8]; if (rm < 0 || rm > 2) rm = 0;
    s.rippleMode = rm;
    int pm = ints[9]; if (pm < 0 || pm > 1) pm = 0;
    s.panMode = pm;
    int rk = ints[10]; if (rk < 0 || rk > 2) rk = 0;
    s.rippleKind = rk;

    s.borderWidth = floats[0];
    s.borderColor = { floats[1], floats[2], floats[3] };
    s.borderAlpha = floats[4];
    s.bgColor = { floats[5], floats[6], floats[7] };
    s.rippleAmount = floats[8];
    s.zoom = floats[9];
    s.rotation = floats[10];
    s.panX = floats[11];
    s.panY = floats[12];
    s.brightness = floats[13];
    s.depthAmount = floats[14];
    s.rippleSpeed = floats[15];
    int base = 16;
    for (int i = 0; i < kMaxColors; ++i) {
        s.customOklch[i] = { floats[base + 3 * i + 0],
                             floats[base + 3 * i + 1],
                             floats[base + 3 * i + 2] };
    }
    return s;
}

} // namespace

extern "C" {

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_installCrashHandler(JNIEnv* env, jobject,
                                                            jstring filesDir) {
    // Idempotent — only the first call wires the handler.
    if (!filesDir) {
        penrose::crash::install(nullptr);
        return;
    }
    const char* path = env->GetStringUTFChars(filesDir, nullptr);
    penrose::crash::install(path);
    env->ReleaseStringUTFChars(filesDir, path);
}

JNIEXPORT jlong JNICALL
Java_com_penrose_wallpaper_NativeBridge_create(JNIEnv* env, jobject, jobject assetMgr) {
    AAssetManager* mgr = AAssetManager_fromJava(env, assetMgr);
    if (!mgr) { LOGE("AAssetManager_fromJava returned null"); return 0; }
    return reinterpret_cast<jlong>(new Renderer(mgr));
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_destroy(JNIEnv*, jobject, jlong ptr) {
    delete asRenderer(ptr);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_surfaceCreated(JNIEnv* env, jobject, jlong ptr, jobject surface) {
    auto* r = asRenderer(ptr); if (!r) return;
    ANativeWindow* window = ANativeWindow_fromSurface(env, surface);
    if (!window) { LOGE("ANativeWindow_fromSurface returned null"); return; }
    bool ok = r->onSurfaceCreated(window);
    ANativeWindow_release(window);
    if (!ok) LOGE("Renderer::onSurfaceCreated failed");
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_surfaceChanged(JNIEnv*, jobject, jlong ptr, jint w, jint h) {
    auto* r = asRenderer(ptr); if (r) r->onSurfaceChanged((int)w, (int)h);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_surfaceDestroyed(JNIEnv*, jobject, jlong ptr) {
    auto* r = asRenderer(ptr); if (r) r->onSurfaceDestroyed();
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_drawFrame(JNIEnv*, jobject, jlong ptr) {
    auto* r = asRenderer(ptr); if (r) r->drawFrame();
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_applySettings(JNIEnv* env, jobject, jlong ptr,
                                                     jintArray ints, jfloatArray floats) {
    auto* r = asRenderer(ptr); if (!r) return;
    if (env->GetArrayLength(ints) < kIntCount || env->GetArrayLength(floats) < kFloatCount) {
        LOGE("applySettings: bad array length");
        return;
    }
    jint* iPtr = env->GetIntArrayElements(ints, nullptr);
    jfloat* fPtr = env->GetFloatArrayElements(floats, nullptr);
    Settings s = decodeSettings(iPtr, fPtr);
    env->ReleaseIntArrayElements(ints, iPtr, JNI_ABORT);
    env->ReleaseFloatArrayElements(floats, fPtr, JNI_ABORT);
    r->onSettingsChanged(s);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_touchMove(JNIEnv*, jobject, jlong ptr,
                                                 jfloat dx, jfloat dy) {
    auto* r = asRenderer(ptr); if (r) r->touchMove(dx, dy);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_touchPinch(JNIEnv*, jobject, jlong ptr,
                                                  jfloat scale, jfloat rotDelta) {
    auto* r = asRenderer(ptr); if (r) r->touchPinch(scale, rotDelta);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_readView(JNIEnv* env, jobject, jlong ptr, jfloatArray out) {
    auto* r = asRenderer(ptr); if (!r) return;
    if (env->GetArrayLength(out) < 4) return;
    float values[4] = { 1.0f, 0.0f, 0.0f, 0.0f };
    r->readView(&values[0], &values[1], &values[2], &values[3]);
    env->SetFloatArrayRegion(out, 0, 4, values);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_resetView(JNIEnv*, jobject, jlong ptr) {
    auto* r = asRenderer(ptr); if (r) r->resetView();
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_tick(JNIEnv*, jobject, jlong ptr, jfloat tSeconds) {
    auto* r = asRenderer(ptr); if (r) r->tick(tSeconds);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_surfaceGeometry(JNIEnv*, jobject, jlong ptr,
                                                       jint surfW, jint surfH,
                                                       jint screenW, jint screenH) {
    auto* r = asRenderer(ptr);
    if (r) r->surfaceGeometry((int)surfW, (int)surfH, (int)screenW, (int)screenH);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_setPageOffset(JNIEnv*, jobject, jlong ptr, jfloat xOffset) {
    auto* r = asRenderer(ptr); if (r) r->setPageOffset(xOffset);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_setUiDensity(JNIEnv*, jobject, jlong ptr, jfloat density) {
    auto* r = asRenderer(ptr); if (r) r->setUiDensity(density);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_setSystemInsets(JNIEnv*, jobject, jlong ptr,
                                                       jint top, jint bottom,
                                                       jint left, jint right) {
    auto* r = asRenderer(ptr); if (r) r->setSystemInsets(top, bottom, left, right);
}

// Audio analyzer JNI entry points. The analyzer is a process-wide
// singleton (penrose::globalAudioAnalyzer), so these calls take no
// Renderer pointer — anything in the app/service can feed PCM or read
// the latest bands.
JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_pushAudio(JNIEnv* env, jobject,
                                                 jfloatArray samples, jint count,
                                                 jint sampleRate) {
    if (!samples || count <= 0) return;
    const jint len = env->GetArrayLength(samples);
    const int n = std::min(static_cast<int>(count), static_cast<int>(len));
    // Reconfigure on rate change. Each producer (the audio thread) maps
    // to a single AudioProcessor instance, so the static-local lastRate
    // tracking is sufficient — no cross-thread races to worry about.
    static int lastRate = 0;
    if (sampleRate > 0 && sampleRate != lastRate) {
        penrose::globalAudioAnalyzer().configure(sampleRate);
        lastRate = sampleRate;
    }
    jfloat* p = env->GetFloatArrayElements(samples, nullptr);
    penrose::globalAudioAnalyzer().pushPcm(p, n);
    env->ReleaseFloatArrayElements(samples, p, JNI_ABORT);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_readAudio(JNIEnv* env, jobject, jfloatArray out) {
    if (!out) return;
    constexpr int kSlots = AudioAnalyzer::kBands + 1; // 8 bands + beat
    if (env->GetArrayLength(out) < kSlots) return;
    float bands[AudioAnalyzer::kBands];
    float beat = 0.0f;
    penrose::globalAudioAnalyzer().snapshot(bands, beat);
    float values[kSlots];
    for (int i = 0; i < AudioAnalyzer::kBands; ++i) values[i] = bands[i];
    values[AudioAnalyzer::kBands] = beat;
    env->SetFloatArrayRegion(out, 0, kSlots, values);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_clearAudio(JNIEnv*, jobject) {
    penrose::globalAudioAnalyzer().quiesce();
}

} // extern "C"
