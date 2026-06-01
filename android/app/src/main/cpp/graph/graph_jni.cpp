// JNI bridge for graph + ImGui control.
//
// Kotlin reaches into the C++ graph through a single Renderer instance
// (the existing `nativePtr` exposed by NativeBridge). These free functions
// route to that Renderer's owned Graph / ImGuiHost / GraphUi. Keeping the
// bridge in graph/ rather than jni_bridge.cpp prevents the main JNI file
// from growing every time we add a graph API.

#include "graph/graph.h"
#include "graph/graph_ui.h"
#include "renderer/renderer.h"
#include "ui/imgui_host.h"

#include <jni.h>

using namespace penrose;

namespace {
inline Renderer* asRenderer(jlong ptr) { return reinterpret_cast<Renderer*>(ptr); } // NOLINT(performance-no-int-to-ptr)
}

extern "C" {

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_graphSetVisible(JNIEnv*, jobject, jlong ptr, jboolean visible) {
    auto* r = asRenderer(ptr); if (!r) return;
    r->graphUi().setVisible(visible == JNI_TRUE);
}

JNIEXPORT jboolean JNICALL
Java_com_penrose_wallpaper_NativeBridge_graphIsVisible(JNIEnv*, jobject, jlong ptr) {
    auto* r = asRenderer(ptr); if (!r) return JNI_FALSE;
    return r->graphUi().visible() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jstring JNICALL
Java_com_penrose_wallpaper_NativeBridge_graphSave(JNIEnv* env, jobject, jlong ptr) {
    auto* r = asRenderer(ptr); if (!r) return env->NewStringUTF("");
    const std::string text = r->graph().toJson();
    return env->NewStringUTF(text.c_str());
}

JNIEXPORT jboolean JNICALL
Java_com_penrose_wallpaper_NativeBridge_graphLoad(JNIEnv* env, jobject, jlong ptr, jstring jjson) {
    auto* r = asRenderer(ptr); if (!r || !jjson) return JNI_FALSE;
    const char* utf = env->GetStringUTFChars(jjson, nullptr);
    if (!utf) return JNI_FALSE;
    std::string text(utf);
    env->ReleaseStringUTFChars(jjson, utf);
    const bool ok = r->graph().fromJson(text);
    if (ok) r->graphUi().onGraphReloaded();
    return ok ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_graphReset(JNIEnv*, jobject, jlong ptr) {
    auto* r = asRenderer(ptr); if (!r) return;
    r->graph().resetToDefault();
    r->graphUi().onGraphReloaded();
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_pushTouchEvent(JNIEnv*, jobject, jlong ptr,
                                                      jint phase, jint pointerIndex,
                                                      jfloat x, jfloat y) {
    auto* r = asRenderer(ptr); if (!r) return;
    // Range-check the phase enum at the trust boundary so a garbage jint
    // (negative or out-of-range) can't land in the ring as undefined.
    if (phase < 0 || phase > 4) return;
    if (pointerIndex < 0 || pointerIndex > 255) return;
    ui::TouchEvent ev{};
    ev.phase = static_cast<ui::TouchPhase>(phase);
    ev.pointerIndex = static_cast<uint8_t>(pointerIndex);
    ev.x = x;
    ev.y = y;
    r->imGuiHost().queueTouchEvent(ev);
}

} // extern "C"
