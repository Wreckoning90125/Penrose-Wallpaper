#include "audio/audio_analyzer.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <ctime>

namespace penrose {

namespace {

constexpr float kPi = 3.14159265358979323846f;

inline uint64_t monotonicNs() {
    timespec ts{};
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1'000'000'000ull
         + static_cast<uint64_t>(ts.tv_nsec);
}

inline int log2int(int n) {
    int b = 0;
    while ((1 << b) < n) ++b;
    return b;
}

} // namespace

AudioAnalyzer::AudioAnalyzer() {
    initStaticTables();
    computeBandRanges();
}

void AudioAnalyzer::initStaticTables() {
    // Hann window — softens spectral leakage from the rectangular slice.
    for (int i = 0; i < kFftSize; ++i) {
        window_[i] = 0.5f * (1.0f - std::cos(2.0f * kPi * i / (kFftSize - 1)));
    }
    // Bit-reversal lookup for in-place Cooley-Tukey.
    const int bits = log2int(kFftSize);
    for (int i = 0; i < kFftSize; ++i) {
        int r = 0;
        for (int b = 0; b < bits; ++b) {
            if (i & (1 << b)) r |= 1 << (bits - 1 - b);
        }
        bitRev_[i] = r;
    }
    // Twiddle factors for the first half-revolution.
    for (int i = 0; i < kFftSize / 2; ++i) {
        const float a = -2.0f * kPi * i / kFftSize;
        twiddleCos_[i] = std::cos(a);
        twiddleSin_[i] = std::sin(a);
    }
}

void AudioAnalyzer::computeBandRanges() {
    // 8 log-spaced bands across the audible spectrum, capped at Nyquist.
    // Endpoints in Hz, chosen so each band spans roughly an octave: sub-
    // bass, bass, low-mid, mid, high-mid, presence, brilliance, air.
    static constexpr float edgesHz[kBands + 1] = {
        30.0f, 70.0f, 150.0f, 320.0f, 700.0f,
        1600.0f, 3500.0f, 8000.0f, 16000.0f,
    };
    const float binHz = static_cast<float>(sampleRate_) / kFftSize;
    const int maxBin = kFftSize / 2;
    for (int b = 0; b < kBands; ++b) {
        int lo = std::clamp(static_cast<int>(edgesHz[b]     / binHz), 1, maxBin);
        int hi = std::clamp(static_cast<int>(edgesHz[b + 1] / binHz), lo + 1, maxBin);
        bandLo_[b] = lo;
        bandHi_[b] = hi;
    }
}

void AudioAnalyzer::configure(int sampleRate) {
    if (sampleRate <= 0) return;
    sampleRate_ = sampleRate;
    computeBandRanges();
    // Reset the ring + smoothers on stream change so the visualizer
    // doesn't fade a previous track into the new one.
    std::memset(ring_, 0, sizeof(ring_));
    std::memset(bandsSmoothed_, 0, sizeof(bandsSmoothed_));
    beatSmoothed_ = 0.0f;
    energyHistory_ = 0.0f;
    writeIdx_.store(0, std::memory_order_release);
}

void AudioAnalyzer::pushPcm(const float* samples, int count) {
    if (!samples || count <= 0) return;
    uint32_t w = writeIdx_.load(std::memory_order_relaxed);
    for (int i = 0; i < count; ++i) {
        ring_[w & (kRingSamples - 1)] = samples[i];
        ++w;
    }
    writeIdx_.store(w, std::memory_order_release);
    lastPushNs_.store(monotonicNs(), std::memory_order_relaxed);
}

void AudioAnalyzer::quiesce() {
    std::lock_guard<std::mutex> g(analyzeMutex_);
    quiesceUnlocked();
}

void AudioAnalyzer::quiesceUnlocked() {
    for (int b = 0; b < kBands; ++b) bandsSmoothed_[b] *= 0.85f;
    beatSmoothed_ *= 0.85f;
}

void AudioAnalyzer::snapshot(float (&outBands)[kBands], float& outBeat) const {
    // Held under analyzeMutex_ to keep the 8-band vector + beat scalar
    // self-consistent against a concurrent analyzeFrame on another
    // render thread.
    std::lock_guard<std::mutex> g(analyzeMutex_);
    for (int b = 0; b < kBands; ++b) outBands[b] = bandsSmoothed_[b];
    outBeat = beatSmoothed_;
}

void AudioAnalyzer::fftRadix2(float* re, float* im) const {
    // In-place bit-reverse permutation.
    for (int i = 0; i < kFftSize; ++i) {
        int j = bitRev_[i];
        if (i < j) {
            std::swap(re[i], re[j]);
            std::swap(im[i], im[j]);
        }
    }
    // Butterflies. At each stage of size `m`, twiddle step through the
    // precomputed half-revolution table.
    for (int m = 2; m <= kFftSize; m <<= 1) {
        const int half = m >> 1;
        const int twStep = kFftSize / m;
        for (int k = 0; k < kFftSize; k += m) {
            for (int j = 0; j < half; ++j) {
                const int tw = j * twStep;
                const float wr = twiddleCos_[tw];
                const float wi = twiddleSin_[tw];
                const int a = k + j;
                const int b = a + half;
                const float tr = wr * re[b] - wi * im[b];
                const float ti = wr * im[b] + wi * re[b];
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] = re[a] + tr;
                im[a] = im[a] + ti;
            }
        }
    }
}

void AudioAnalyzer::analyzeFrame(float dtSeconds) {
    // Two Renderer instances can race here in the same process (in-app
    // preview while the wallpaper service is also live), and -ffast-math
    // assumes no NaN/Inf across the smoothed-bands RMW. Serialise to
    // keep the FP state well-defined.
    std::lock_guard<std::mutex> g(analyzeMutex_);

    // If no audio has arrived recently, ease the smoothers toward zero so
    // the visualizer doesn't freeze on the last frame's spectrum.
    const uint64_t nowNs = monotonicNs();
    const uint64_t lastNs = lastPushNs_.load(std::memory_order_relaxed);
    if (lastNs == 0 || nowNs - lastNs > 200'000'000ull) {
        quiesceUnlocked();
        return;
    }

    // Snapshot the most recent kFftSize samples. The audio thread may
    // race a write into the ring while we copy; that produces at most a
    // few replaced samples at the trailing edge, which is inaudible at
    // 60 Hz analysis rate.
    const uint32_t w = writeIdx_.load(std::memory_order_acquire);
    const uint32_t start = w - kFftSize;
    for (int i = 0; i < kFftSize; ++i) {
        scratchRe_[i] = ring_[(start + i) & (kRingSamples - 1)] * window_[i];
        scratchIm_[i] = 0.0f;
    }
    fftRadix2(scratchRe_, scratchIm_);

    // Magnitude in each band, normalized so a full-scale sine wave in the
    // band gives ~1.0. Hann window halves the effective amplitude, hence
    // the 2/N scale.
    const float scale = 2.0f / kFftSize;
    float bandsRaw[kBands] = {};
    for (int b = 0; b < kBands; ++b) {
        float sum = 0.0f;
        for (int i = bandLo_[b]; i < bandHi_[b]; ++i) {
            const float mag = std::sqrt(scratchRe_[i] * scratchRe_[i]
                                      + scratchIm_[i] * scratchIm_[i]);
            sum += mag * scale;
        }
        sum /= static_cast<float>(bandHi_[b] - bandLo_[b]);
        // Mild compression so quiet content still has visible signal —
        // log mapping bunches the dynamic range into a comfortable [0,1].
        bandsRaw[b] = std::log1p(sum * 9.0f) * 0.434f;
        bandsRaw[b] = std::min(1.5f, bandsRaw[b]);
    }

    // Asymmetric smoothing: fast attack so peaks pop, slow release so
    // they linger and read as a sustained pulse rather than a single-
    // frame flash.
    constexpr float kAttackPerFrame  = 0.55f;
    constexpr float kReleasePerFrame = 0.10f;
    for (int b = 0; b < kBands; ++b) {
        const float target = bandsRaw[b];
        const float current = bandsSmoothed_[b];
        const float rate = target > current ? kAttackPerFrame : kReleasePerFrame;
        // Scale rates by dt to stay stable if frame timing varies.
        const float k = std::clamp(rate * dtSeconds * 60.0f, 0.0f, 1.0f);
        bandsSmoothed_[b] = current + (target - current) * k;
    }

    // Energy-based beat: compare current low-band energy to a slow
    // moving average. A spike past 1.4× the mean flags a beat; the
    // smoother lets it shine briefly.
    const float energyNow = bandsRaw[0] + bandsRaw[1] + bandsRaw[2];
    const float histK = std::clamp(0.05f * dtSeconds * 60.0f, 0.0f, 1.0f);
    energyHistory_ += (energyNow - energyHistory_) * histK;
    const float beatTarget = (energyHistory_ > 0.0f && energyNow > energyHistory_ * 1.4f)
                                 ? 1.0f : 0.0f;
    const float beatRate = beatTarget > beatSmoothed_ ? 0.9f : 0.08f;
    const float beatK = std::clamp(beatRate * dtSeconds * 60.0f, 0.0f, 1.0f);
    beatSmoothed_ += (beatTarget - beatSmoothed_) * beatK;
}

AudioAnalyzer& globalAudioAnalyzer() {
    static AudioAnalyzer instance;
    return instance;
}

} // namespace penrose
