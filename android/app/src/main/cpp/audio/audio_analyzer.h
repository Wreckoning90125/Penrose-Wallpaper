#pragma once

#include <atomic>
#include <cstdint>
#include <mutex>
#include <vector>

namespace penrose {

// Real-time audio band analyzer. The audio thread (a Media3 AudioProcessor
// in our case) calls pushPcm with the raw PCM stream as it flows through
// the player. The render thread calls analyzeFrame once per vsync, which
// windows the most recent FFT-sized slice, runs an in-place radix-2 FFT,
// folds the magnitudes into 8 octave-spaced bands, and feeds them through
// asymmetric attack/release smoothers. A simple energy-spike detector
// raises the `beat` value to 1.0 on transients and decays.
//
// The instance is process-wide (see globalAudioAnalyzer below) so the
// foreground AudioPlaybackService and every Renderer share one analyzer.
//
// Threading contract:
//   - pushPcm: any thread (single producer in practice — the Media3
//     audio thread). Lock-free; writes ring_ and writeIdx_.
//   - analyzeFrame: any render thread. analyzeMutex_ serialises
//     concurrent callers (both the wallpaper service AND an in-app
//     preview Renderer live in the same process and each ticks
//     per-vsync).
//   - snapshot: any render thread. Reads smoothed bands + beat
//     under analyzeMutex_ so concurrent analyzeFrame can't tear
//     the float[8] mid-FFT and leak NaN/Inf into shader uniforms
//     (with -ffast-math, NaN propagation is UB-adjacent).
//   - quiesce / configure: any thread; both take analyzeMutex_.
class AudioAnalyzer {
public:
    static constexpr int kFftSize = 1024;
    static constexpr int kBands = 8;
    static constexpr int kRingSamples = kFftSize * 4;

    AudioAnalyzer();

    // Reconfigure for a new playback stream. Resets ring state and
    // smoothers; pickRange picks log-spaced band boundaries from the
    // updated Nyquist limit.
    void configure(int sampleRate);

    // Audio thread. Append `count` mono float samples; multi-channel
    // streams should be downmixed by the caller. Returns immediately,
    // never blocks.
    void pushPcm(const float* samples, int count);

    // Render thread. Pulls the most recent kFftSize samples from the ring,
    // runs the FFT, updates `bands_` and `beat_`. `dtSeconds` controls
    // smoothing rates (longer dt → larger per-call decay).
    void analyzeFrame(float dtSeconds);

    // Snapshot the smoothed bands + beat under analyzeMutex_. Both
    // outputs are in the 0..1 range under typical content; transient
    // peaks above 1 get soft-clipped by the smoother. See the threading
    // contract at the top of this header for why a snapshot is needed
    // instead of returning raw pointers.
    void snapshot(float (&outBands)[kBands], float& outBeat) const;

    // Mark the stream as silent (no playback). Drives bands toward 0.
    void quiesce();

private:
    void initStaticTables();
    void computeBandRanges();
    void fftRadix2(float* re, float* im) const;
    // Unlocked body of quiesce — for analyzeFrame's early-return path
    // when it's already holding analyzeMutex_.
    void quiesceUnlocked();

    int sampleRate_ = 48000;

    alignas(64) float ring_[kRingSamples] = {};
    std::atomic<uint32_t> writeIdx_ = 0;

    // Scratch buffers reused across analyze calls.
    float scratchRe_[kFftSize] = {};
    float scratchIm_[kFftSize] = {};
    float window_[kFftSize] = {};
    int bitRev_[kFftSize] = {};
    float twiddleCos_[kFftSize / 2] = {};
    float twiddleSin_[kFftSize / 2] = {};

    // Band range = [loBin, hiBin) into the magnitude spectrum.
    int bandLo_[kBands] = {};
    int bandHi_[kBands] = {};

    // Smoothing state. Mutated by analyzeFrame and read by bands()/beat().
    // Two Renderer instances (the wallpaper service and an in-app preview
    // both live in the same process) can call analyzeFrame concurrently;
    // analyzeMutex_ serialises the RMW so they don't shred each other's
    // smoothed values with -ffast-math optimisations downstream.
    float bandsSmoothed_[kBands] = {};
    float beatSmoothed_ = 0.0f;
    float energyHistory_ = 0.0f;
    mutable std::mutex analyzeMutex_;

    // Stream-active sentinel: time since last pushPcm. Beyond a small
    // window we treat the source as silent.
    std::atomic<uint64_t> lastPushNs_ = 0;
};

// Process-wide analyzer. The AudioPlaybackService feeds it from its
// AudioProcessor tap; both the wallpaper engine and the in-app preview
// renderer read from the same instance, so the wallpaper continues to
// react to audio that started in the in-app settings UI.
AudioAnalyzer& globalAudioAnalyzer();

} // namespace penrose
