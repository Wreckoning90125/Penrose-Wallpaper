#include "log.h"
#include "renderer.h"
#include "settings.h"

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
//            borderOn, bgMode]
//   floats: [borderWidth, borderL, borderC, borderH, borderAlpha,
//            bgL, bgC, bgH]
constexpr int kIntCount = 8;
constexpr int kFloatCount = 8;

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

    s.borderWidth = floats[0];
    s.borderColor = { floats[1], floats[2], floats[3] };
    s.borderAlpha = floats[4];
    s.bgColor = { floats[5], floats[6], floats[7] };
    return s;
}

} // namespace

extern "C" {

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
Java_com_penrose_wallpaper_NativeBridge_visibilityChanged(JNIEnv*, jobject, jlong ptr, jboolean visible) {
    auto* r = asRenderer(ptr); if (r) r->onVisibilityChanged(visible == JNI_TRUE);
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
                                                 jfloat x, jfloat y, jfloat prevX, jfloat prevY) {
    auto* r = asRenderer(ptr); if (r) r->touchMove(x, y, prevX, prevY);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_touchPinch(JNIEnv*, jobject, jlong ptr,
                                                  jfloat midX, jfloat midY,
                                                  jfloat scale, jfloat rotDelta) {
    auto* r = asRenderer(ptr); if (r) r->touchPinch(midX, midY, scale, rotDelta);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_resetView(JNIEnv*, jobject, jlong ptr) {
    auto* r = asRenderer(ptr); if (r) r->resetView();
}

} // extern "C"
