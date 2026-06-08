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
// asymmetric attack/release smoothers.
//
// The beat envelope is no longer a naive "current low-band > 1.4× moving
// average" trigger. The new chain is:
//
//   1. SuperFlux onset = HFC-weighted (frequency-emphasised) half-rectified
//      spectral flux. Quiets steady tones, lights up on percussive onsets.
//   2. Z-score normalisation against a rolling mean/variance with
//      asymmetric attack/release so the threshold tracks slowly through
//      loudness changes but pops on a transient.
//   3. BeatDetector — an onset ring buffer feeds an autocorrelation
//      computed every 8 frames; the peak in the [60..200] BPM lag range
//      drives a phase-locked-loop sawtooth (per beat_detect.rs from
//      Prismic Holonomy). The PLL nudges its phase toward the onset
//      moment when an above-threshold onset arrives while confidence is
//      high, so the phase stays locked across tempo wobble.
//   4. Micro CWT — 3 pre-computed Morlet wavelet kernels at 2/5/10 kHz
//      (snare/hat/cymbal range) convolve the raw time window via a
//      strided dot-product. Catches sub-beat percussive flashes the
//      tempo grid alone would miss.
//   5. Final beat scalar = max(PLL flash, clamped CWT flash) →
//      asymmetric smoother (fast attack 0.90/frame, slow release
//      0.10/frame).
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
//     the float[8] mid-FFT and leak NaN/Inf into shader uniforms.
//   - quiesce / configure: any thread; both take analyzeMutex_.
class AudioAnalyzer {
public:
    static constexpr int kFftSize     = 2048;
    static constexpr int kBands       = 8;
    static constexpr int kRingSamples = kFftSize * 4;

    // BPM search window. 60..200 covers the human-musical range and
    // matches the autocorrelation BPM search in beat_detect.rs.
    static constexpr float kMinBpm = 60.0f;
    static constexpr float kMaxBpm = 200.0f;

    // Onset ring buffer length. ~4 seconds at 60 fps — long enough to
    // hold two full BPM periods even at the slowest tempo so the
    // autocorrelation has a clear peak to lock onto.
    static constexpr int kOnsetBufLen = 256;
    static constexpr int kAcfLen      = kOnsetBufLen / 2;

    // Three CWT kernels, targeted at the percussive bands per cwt.rs.
    static constexpr int kCwtKernels = 3;

    struct FeatureSnapshot {
        float bands[kBands] = {};
        float bass = 0.0f;
        float mid = 0.0f;
        float high = 0.0f;
        float beat = 0.0f;
        float rms = 0.0f;
        float spectralFlux = 0.0f;
        float onsetStrength = 0.0f;
        float cwtTransient = 0.0f;
        float crestFactor = 0.0f;
        float beatConfidence = 0.0f;
    };

    AudioAnalyzer();

    // Reconfigure for a new playback stream. Resets ring state, DSP
    // smoothers, the beat tracker and the Morlet kernels (kernel
    // sample-counts depend on the rate).
    void configure(int sampleRate);

    // Audio thread. Append `count` mono float samples; multi-channel
    // streams should be downmixed by the caller. Returns immediately,
    // never blocks.
    void pushPcm(const float* samples, int count);

    // Render thread. Pulls the most recent kFftSize samples from the ring,
    // runs the FFT + SuperFlux + BeatDetector + CWT, updates the smoothed
    // bands and the beat envelope. `dtSeconds` controls smoothing rates
    // and also feeds the fps estimator the beat tracker uses to convert
    // autocorrelation lag to BPM.
    void analyzeFrame(float dtSeconds);

    // Snapshot the latest analyzer features under analyzeMutex_. See the
    // threading contract at the top of this header for why a snapshot is
    // needed instead of returning raw pointers.
    void snapshot(FeatureSnapshot& out) const;

    // Compatibility view for existing shader/graph code that only consumes
    // the smoothed octave bands and beat envelope.
    void snapshot(float (&outBands)[kBands], float& outBeat) const;

    // Mark the stream as silent (no playback). Drives bands toward 0.
    void quiesce();

    // Explicit stop/reset from the playback service. Clears temporal DSP
    // state so a later track starts with fresh onset, CWT, and tempo memory.
    void clear();

private:
    void initStaticTables();
    void computeBandRanges();
    void rebuildCwtKernels();
    void fftRadix2(float* re, float* im) const;
    // Unlocked body of quiesce — for analyzeFrame's early-return path
    // when it's already holding analyzeMutex_.
    void quiesceUnlocked();
    // Wipes mutable DSP state. Called from configure() to give a fresh
    // start to a new playback stream.
    void resetDspStateUnlocked();
    // Parabolic-interpolated peak in [lo,hi] over the autocorrelation
    // buffer. Returns a fractional lag for sub-frame BPM precision.
    float peakLagParabolic(int lo, int hi, float& peakValOut) const;

    int sampleRate_ = 48000;

    static_assert(std::atomic<uint32_t>::is_always_lock_free,
                  "Audio sample ring requires lock-free uint32 atomics");
    alignas(64) std::atomic<uint32_t> ring_[kRingSamples] = {};
    std::atomic<uint32_t> writeIdx_{0};

    // Scratch + static tables for the FFT.
    float scratchRe_[kFftSize]      = {};
    float scratchIm_[kFftSize]      = {};
    float window_[kFftSize]         = {};
    float windowSum_                = 0.0f;
    int   bitRev_[kFftSize]         = {};
    float twiddleCos_[kFftSize / 2] = {};
    float twiddleSin_[kFftSize / 2] = {};

    // Magnitude history for spectral flux.
    float prevMag_[kFftSize / 2] = {};

    // Onset ring buffer for the autocorrelation tempo tracker.
    float onsetBuf_[kOnsetBufLen] = {};
    int   onsetIdx_               = 0;
    float acf_[kAcfLen]           = {};

    // Beat-tracker state (autocorrelation + PLL — matches beat_detect.rs).
    float fpsEma_       = 60.0f;
    float bpm_          = 120.0f;
    float rawBpm_       = 120.0f;
    float beatPhase_    = 0.0f;
    float beatConf_     = 0.0f;
    float periodFrames_ = 60.0f * 60.0f / 120.0f;

    // 3 pre-computed complex Morlet wavelet kernels for CWT-based
    // transient detection (snare / hat / cymbal). Sample counts depend
    // on sample_rate so the kernels get rebuilt by configure().
    std::vector<float> cwtRe_[kCwtKernels];
    std::vector<float> cwtIm_[kCwtKernels];
    int                cwtKernelLen_[kCwtKernels] = {};

    // Adaptive normalisation for onset + CWT — asymmetric attack/release
    // tracking of mean & variance (Welford-style, exponential),
    // matching the RollingStat in lib.rs.
    float onsetAvg_ = 0.0f, onsetVar_ = 0.0f;
    float cwtAvg_   = 0.0f, cwtVar_   = 0.0f;

    // Per-band auto-normalisation state. Each band tracks its own
    // rolling min / max / avg with asymmetric attack/release, so a
    // band that's intrinsically quiet (brilliance: 3500-8000 Hz,
    // sparse in most music) still maps to its own 0..1 envelope
    // rather than reading as 0..0.1 of the global scale.
    // Matches RollingStat::update + normalize in the Prismic-Holonomy
    // reference (lib.rs:165-225). Initial range chosen so the first
    // few frames of audio don't all clamp to 0.
    struct BandStat {
        float minVal = 1e-6f;
        float maxVal = 0.01f;
        float avgVal = 0.0f;
    };
    BandStat bandStats_[kBands] = {};

    // Band range = [loBin, hiBin) into the magnitude spectrum.
    int bandLo_[kBands] = {};
    int bandHi_[kBands] = {};
    int webBandLo_[3] = {};
    int webBandHi_[3] = {};

    // Smoothing state. Mutated by analyzeFrame and read by snapshot.
    float bandsSmoothed_[kBands] = {};
    float bass_                  = 0.0f;
    float mid_                   = 0.0f;
    float high_                  = 0.0f;
    float beatSmoothed_          = 0.0f;
    float rms_                   = 0.0f;
    float spectralFlux_          = 0.0f;
    float onsetStrength_         = 0.0f;
    float cwtTransient_          = 0.0f;
    float crestFactor_           = 0.0f;
    mutable std::mutex analyzeMutex_;

    // Stream-active sentinel: time since last pushPcm. Beyond a small
    // window we treat the source as silent.
    std::atomic<uint64_t> lastPushNs_{0};
    uint32_t lastAnalyzedWriteIdx_ = 0;
    uint64_t lastAnalyzeNs_ = 0;
    bool haveAnalyzedSlice_ = false;
};

// Process-wide analyzer. The AudioPlaybackService feeds it from its
// AudioProcessor tap; both the wallpaper engine and the in-app preview
// renderer read from the same instance, so the wallpaper continues to
// react to audio that started in the in-app settings UI.
AudioAnalyzer& globalAudioAnalyzer();

} // namespace penrose
