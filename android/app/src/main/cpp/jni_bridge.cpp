#include "renderer.h"
#include "log.h"

#include <android/asset_manager.h>
#include <android/asset_manager_jni.h>
#include <android/native_window.h>
#include <android/native_window_jni.h>
#include <jni.h>

using penrose::Renderer;

namespace {
inline Renderer* asRenderer(jlong ptr) { return reinterpret_cast<Renderer*>(ptr); }
}

extern "C" {

JNIEXPORT jlong JNICALL
Java_com_penrose_wallpaper_NativeBridge_create(JNIEnv* env, jobject /*thiz*/, jobject assetMgr) {
    AAssetManager* mgr = AAssetManager_fromJava(env, assetMgr);
    if (!mgr) {
        LOGE("AAssetManager_fromJava returned null");
        return 0;
    }
    auto* r = new Renderer(mgr);
    return reinterpret_cast<jlong>(r);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_destroy(JNIEnv*, jobject, jlong ptr) {
    delete asRenderer(ptr);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_surfaceCreated(JNIEnv* env, jobject, jlong ptr, jobject surface) {
    auto* r = asRenderer(ptr);
    if (!r) return;
    ANativeWindow* window = ANativeWindow_fromSurface(env, surface);
    if (!window) { LOGE("ANativeWindow_fromSurface returned null"); return; }
    // Renderer takes its own reference via ANativeWindow_acquire; release ours.
    bool ok = r->onSurfaceCreated(window);
    ANativeWindow_release(window);
    if (!ok) LOGE("Renderer::onSurfaceCreated failed");
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_surfaceChanged(JNIEnv*, jobject, jlong ptr, jint w, jint h) {
    auto* r = asRenderer(ptr);
    if (r) r->onSurfaceChanged((int)w, (int)h);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_surfaceDestroyed(JNIEnv*, jobject, jlong ptr) {
    auto* r = asRenderer(ptr);
    if (r) r->onSurfaceDestroyed();
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_visibilityChanged(JNIEnv*, jobject, jlong ptr, jboolean visible) {
    auto* r = asRenderer(ptr);
    if (r) r->onVisibilityChanged(visible == JNI_TRUE);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_drawFrame(JNIEnv*, jobject, jlong ptr) {
    auto* r = asRenderer(ptr);
    if (r) r->drawFrame();
}

} // extern "C"
