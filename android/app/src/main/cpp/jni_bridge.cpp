#include "audio/audio_analyzer.h"
#include "crash_handler.h"
#include "log.h"
#include "renderer/renderer.h"
#include "settings.h"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>

#include <android/asset_manager.h>
#include <android/asset_manager_jni.h>
#include <android/native_window.h>
#include <android/native_window_jni.h>
#include <jni.h>

using namespace penrose;

namespace {

inline Renderer* asRenderer(jlong ptr) { return reinterpret_cast<Renderer*>(ptr); } // NOLINT(performance-no-int-to-ptr)

constexpr int kAudioPcm16 = 1;
constexpr int kAudioPcmFloat = 2;
constexpr int kAudioPcm8 = 3;

int audioBytesPerSample(int format) {
    switch (format) {
        case kAudioPcm16: return 2;
        case kAudioPcmFloat: return 4;
        case kAudioPcm8: return 1;
        default: return 0;
    }
}

float audioSampleAt(const uint8_t* p, int format) {
    switch (format) {
        case kAudioPcm16: {
            const auto bits = static_cast<uint16_t>(p[0])
                | static_cast<uint16_t>(static_cast<uint16_t>(p[1]) << 8);
            return static_cast<float>(static_cast<int16_t>(bits)) * (1.0f / 32768.0f);
        }
        case kAudioPcmFloat: {
            float v = 0.0f;
            std::memcpy(&v, p, sizeof(float));
            return v;
        }
        case kAudioPcm8:
            return static_cast<float>((static_cast<int>(p[0]) & 0xff) - 128) * (1.0f / 128.0f);
        default:
            return 0.0f;
    }
}

void pushInterleavedPcmToAnalyzer(const uint8_t* bytes, int byteCount, int format, int channels) {
    const int bytesPerSample = audioBytesPerSample(format);
    if (!bytes || byteCount <= 0 || bytesPerSample <= 0 || channels <= 0) return;
    const int frameBytes = bytesPerSample * channels;
    if (frameBytes <= 0) return;
    const int frames = byteCount / frameBytes;
    if (frames <= 0) return;

    constexpr int kChunkFrames = 1024;
    std::array<float, kChunkFrames> mono{};
    int frame = 0;
    while (frame < frames) {
        const int chunk = std::min(kChunkFrames, frames - frame);
        for (int f = 0; f < chunk; ++f) {
            const auto frameOffset =
                static_cast<std::ptrdiff_t>(frame + f) * static_cast<std::ptrdiff_t>(frameBytes);
            const uint8_t* src = bytes + frameOffset;
            float sum = 0.0f;
            for (int c = 0; c < channels; ++c) {
                const auto sampleOffset =
                    static_cast<std::ptrdiff_t>(c) * static_cast<std::ptrdiff_t>(bytesPerSample);
                sum += audioSampleAt(src + sampleOffset, format);
            }
            mono[f] = sum / static_cast<float>(channels);
        }
        penrose::globalAudioAnalyzer().pushPcm(mono.data(), chunk);
        frame += chunk;
    }
}

// Decode a Settings struct from the flat int/float arrays the Kotlin side
// passes us. Layout (ints / floats):
//   ints:   [family, seedIdx, generation, preset, colorCount, colorMode,
//            borderOn, borderJoin, bgMode, rippleMode, panMode, rippleKind,
//            projection, hypBorderSubdiv, hypFillSubdiv]
//   floats: [borderWidth, borderFill, borderPoint, borderGap,
//            borderL, borderC, borderH, borderAlpha,
//            bgL, bgC, bgH, rippleAmount,
//            zoom, rotation, panX, panY,
//            brightness, depthAmount, rippleSpeed,
//            matRoughness, matMetalness, matSheen, matClearcoat,
//            matAnisotropy, matIridescence, matEmissive, matRelief,
//            lightAngle, lightElevation, lightIntensity, lightWarmth, lightAmbient,
//            matSheenColorR, matSheenColorG, matSheenColorB,
//            matIridThickMin, matIridThickMax,
//            matRoughMod, matMetalMod,
//            hypScale, hypBoostX, hypBoostY,
//            custom_0_L, custom_0_C, custom_0_H, ..., custom_N_L, custom_N_C, custom_N_H]
constexpr int kIntCount   = 15;
constexpr int kFloatCount = 19 + 8 + 5 + 5 + 2 + 3 + 3 * kMaxColors;

Settings decodeSettings(const jint* ints, const jfloat* floats) {
    Settings s{};
    int fam = ints[0]; if (fam < 0 || fam >= kFamilyCount) fam = 0;
    s.family = static_cast<Family>(fam);
    s.seedIdx = ints[1];
    s.generation = ints[2];
    int preset = ints[3]; if (preset < 0 || preset >= kPresetCount) preset = (int)Preset::Gold;
    s.preset = static_cast<Preset>(preset);
    s.colorCount = ints[4];
    int mode = ints[5]; if (mode < 0 || mode > 2) mode = 0;
    s.colorMode = static_cast<ColorMode>(mode);
    s.borderOn = (ints[6] != 0);
    int join = ints[7]; if (join < 0 || join > 2) join = 0;
    s.borderJoin = join;
    int bg = ints[8]; if (bg < 0 || bg > 1) bg = 0;
    s.bgMode = static_cast<BackgroundMode>(bg);
    int rm = ints[9]; if (rm < 0 || rm > 2) rm = 0;
    s.rippleMode = rm;
    int pm = ints[10]; if (pm < 0 || pm > 1) pm = 0;
    s.panMode = pm;
    int rk = ints[11]; if (rk < 0 || rk > 2) rk = 0;
    s.rippleKind = rk;
    int pj = ints[12]; if (pj < 0 || pj > 1) pj = 0;
    s.projection = static_cast<Projection>(pj);
    int bsub = ints[13]; if (bsub < 1) bsub = 1; if (bsub > 32) bsub = 32;
    s.hypBorderSubdiv = bsub;
    int fsub = ints[14]; if (fsub < 1) fsub = 1; if (fsub > 8)  fsub = 8;
    s.hypFillSubdiv = fsub;

    s.borderWidth = floats[0];
    s.borderFill = floats[1];
    s.borderPoint = floats[2];
    s.borderGap = floats[3];
    s.borderColor = { floats[4], floats[5], floats[6] };
    s.borderAlpha = floats[7];
    s.bgColor = { floats[8], floats[9], floats[10] };
    s.rippleAmount = floats[11];
    s.zoom = floats[12];
    s.rotation = floats[13];
    s.panX = floats[14];
    s.panY = floats[15];
    s.brightness = floats[16];
    s.depthAmount = floats[17];
    s.rippleSpeed = floats[18];
    s.matRoughness   = floats[19];
    s.matMetalness   = floats[20];
    s.matSheen       = floats[21];
    s.matClearcoat   = floats[22];
    s.matAnisotropy  = floats[23];
    s.matIridescence = floats[24];
    s.matEmissive    = floats[25];
    s.matRelief      = floats[26];
    s.lightAngle     = floats[27];
    s.lightElevation = floats[28];
    s.lightIntensity = floats[29];
    s.lightWarmth    = floats[30];
    s.lightAmbient   = floats[31];
    s.matSheenColorR  = floats[32];
    s.matSheenColorG  = floats[33];
    s.matSheenColorB  = floats[34];
    s.matIridThickMin = floats[35];
    s.matIridThickMax = floats[36];
    s.matRoughMod     = floats[37];
    s.matMetalMod     = floats[38];
    s.hypScale        = floats[39];
    s.hypBoostX       = floats[40];
    s.hypBoostY       = floats[41];
    int base = 42;
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
// the latest analyzer features.
JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_configureAudio(JNIEnv*, jobject, jint sampleRate) {
    penrose::globalAudioAnalyzer().configure(static_cast<int>(sampleRate));
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_pushAudioBuffer(JNIEnv* env, jobject,
                                                       jobject buffer,
                                                       jint position,
                                                       jint byteCount,
                                                       jint format,
                                                       jint channels) {
    if (!buffer || position < 0 || byteCount <= 0 || channels <= 0) return;
    auto* base = static_cast<uint8_t*>(env->GetDirectBufferAddress(buffer));
    const jlong capacity = env->GetDirectBufferCapacity(buffer);
    if (!base || capacity <= 0) return;
    const auto start = static_cast<jlong>(position);
    const auto count = static_cast<jlong>(byteCount);
    if (start > capacity || count > capacity - start) return;
    pushInterleavedPcmToAnalyzer(base + position, byteCount, format, channels);
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_readAudio(JNIEnv* env, jobject, jfloatArray out) {
    if (!out) return;
    constexpr int kBaseSlots = AudioAnalyzer::kBands + 1; // 8 bands + beat
    constexpr int kFeatureSlots = kBaseSlots + 9; // RMS, flux, onset, CWT, crest, confidence, bass, mid, high
    const int len = env->GetArrayLength(out);
    if (len < kBaseSlots) return;
    AudioAnalyzer::FeatureSnapshot snap{};
    penrose::globalAudioAnalyzer().snapshot(snap);
    float values[kFeatureSlots] = {};
    for (int i = 0; i < AudioAnalyzer::kBands; ++i) values[i] = snap.bands[i];
    values[AudioAnalyzer::kBands] = snap.beat;
    if (len >= kFeatureSlots) {
        values[kBaseSlots + 0] = snap.rms;
        values[kBaseSlots + 1] = snap.spectralFlux;
        values[kBaseSlots + 2] = snap.onsetStrength;
        values[kBaseSlots + 3] = snap.cwtTransient;
        values[kBaseSlots + 4] = snap.crestFactor;
        values[kBaseSlots + 5] = snap.beatConfidence;
        values[kBaseSlots + 6] = snap.bass;
        values[kBaseSlots + 7] = snap.mid;
        values[kBaseSlots + 8] = snap.high;
        env->SetFloatArrayRegion(out, 0, kFeatureSlots, values);
    } else {
        env->SetFloatArrayRegion(out, 0, kBaseSlots, values);
    }
}

JNIEXPORT void JNICALL
Java_com_penrose_wallpaper_NativeBridge_clearAudio(JNIEnv*, jobject) {
    penrose::globalAudioAnalyzer().clear();
}

} // extern "C"
