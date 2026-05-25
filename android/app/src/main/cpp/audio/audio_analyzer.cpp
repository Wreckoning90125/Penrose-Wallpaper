#include "audio/audio_analyzer.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <ctime>

namespace penrose {

namespace {

constexpr float kPi = 3.14159265358979323846f;

// Standard Morlet central frequency (cwt.rs uses the same).
constexpr float kMorletOmega0 = 5.0f;

// Per-kernel half-length clamp. Matches the [32,128] half-length window
// from MorletKernel::new in cwt.rs — keeps every kernel under ~257
// taps so the strided convolution stays cheap on the render thread.
constexpr int kCwtHalfMin = 32;
constexpr int kCwtHalfMax = 128;

// Stride for CWT convolution — we want the peak magnitude over the
// window, not every sample, so a 4-tap stride saves 75% of the work
// (transient peaks are several samples wide).
constexpr int kCwtStride = 4;

// SuperFlux uses a frequency-weighted half-rectified spectral flux —
// every positive bin difference is multiplied by (bin_index + 1) so
// percussive transients up at snare/hat frequencies stand out from
// the bass sustain. Linear bin weighting is the variant the reference
// (Prismic Holonomy lib.rs:1715, "SuperFlux: weight by frequency bin
// index"). The weighting is applied inline (just `* (i + 1)`) — no
// pow call per bin per frame.

// RollingStat asymmetry — fast attack, slow release. Same constants
// the Prismic-Holonomy RollingStat ships with in lib.rs.
constexpr float kStatAttack  = 0.20f;
constexpr float kStatRelease = 0.01f;

// PLL gain and BPM smoothing — straight from beat_detect.rs.
constexpr float kPllGain   = 0.05f;
constexpr float kBpmSmooth = 0.95f;

// Autocorrelation is heavy (O(N²)) so we only refresh every 8 onset
// pushes. ~135 ms at 60 fps — fast enough to re-lock on a tempo change
// within a beat or two, cheap enough to stay invisible at vsync.
constexpr int kAcfInterval = 8;

// Onset Z-score that counts as a "real" onset for PLL correction.
// 0.5 std-devs above the mean is the same threshold beat_detect.rs uses.
constexpr float kPllOnsetThreshold = 0.5f;
// Minimum tracker confidence (autocorr peak height) below which the
// PLL ignores onsets entirely — prevents free-running on silence.
constexpr float kPllConfThreshold  = 0.2f;

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

// Welford-style asymmetric EMA update of mean + variance, then return a
// 0..1+ normalisation. Matches RollingStat::update + RollingStat::normalize
// from lib.rs but specialised for our two scalar streams (onset, CWT).
// The returned value is a clipped z-score scaled so a +2σ excursion sits
// near 1.0 — perfect for "this frame had a transient" gating.
inline float updateAndZ(float value, float& avg, float& var) {
    const float delta = value - avg;
    const float alpha = delta > 0.0f ? kStatAttack : kStatRelease;
    avg += delta * alpha;
    const float delta2 = value - avg;
    var += (delta * delta2 - var) * alpha;
    if (var < 0.0f) var = 0.0f;
    const float std = std::sqrt(var);
    if (std < 1e-6f) return 0.0f;
    const float z = (value - avg) / std;
    // 0.5× scale: +2σ → 1.0, +4σ → 2.0 (caller clamps).
    return std::max(0.0f, z * 0.5f);
}

} // namespace

AudioAnalyzer::AudioAnalyzer() {
    initStaticTables();
    computeBandRanges();
    rebuildCwtKernels();
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

void AudioAnalyzer::rebuildCwtKernels() {
    // Three Morlet wavelets targeted at the percussive sweet spots.
    // The kernel scale `a` maps an audio frequency to a wavelet width
    // via a = omega_0 * sample_rate / (2π · f_target); the kernel
    // covers ±3σ where σ = a, clamped to [kCwtHalfMin, kCwtHalfMax]
    // so the convolution stays cheap. Normalisation π^(-1/4)/√a is the
    // standard L²-energy term — keeps response magnitudes comparable
    // across scales.
    static constexpr float kTargetHz[kCwtKernels] = {
        2000.0f,   // snare / clap
        5000.0f,   // hi-hat attack
        10000.0f,  // cymbal shimmer
    };
    const float sr = static_cast<float>(sampleRate_);
    for (int k = 0; k < kCwtKernels; ++k) {
        const float fTarget = kTargetHz[k];
        const float a = (kMorletOmega0 * sr) / (2.0f * kPi * fTarget);
        const int halfRaw = static_cast<int>(std::ceil(3.0f * a));
        const int half    = std::clamp(halfRaw, kCwtHalfMin, kCwtHalfMax);
        const int len     = 2 * half + 1;
        cwtKernelLen_[k] = len;
        cwtRe_[k].assign(len, 0.0f);
        cwtIm_[k].assign(len, 0.0f);
        const float norm  = std::pow(kPi, -0.25f) / std::sqrt(a);
        const float hf    = static_cast<float>(half);
        for (int i = 0; i < len; ++i) {
            const float t        = (static_cast<float>(i) - hf) / a;
            const float gaussian = std::exp(-0.5f * t * t);
            const float phase    = kMorletOmega0 * t;
            cwtRe_[k][i] = norm * gaussian * std::cos(phase);
            cwtIm_[k][i] = norm * gaussian * std::sin(phase);
        }
    }
}

void AudioAnalyzer::configure(int sampleRate) {
    if (sampleRate <= 0) return;
    std::lock_guard<std::mutex> g(analyzeMutex_);
    sampleRate_ = sampleRate;
    computeBandRanges();
    rebuildCwtKernels();
    resetDspStateUnlocked();
}

void AudioAnalyzer::resetDspStateUnlocked() {
    std::memset(ring_,             0, sizeof(ring_));
    std::memset(prevMag_,          0, sizeof(prevMag_));
    std::memset(onsetBuf_,         0, sizeof(onsetBuf_));
    std::memset(acf_,              0, sizeof(acf_));
    std::memset(bandsSmoothed_,    0, sizeof(bandsSmoothed_));
    onsetIdx_     = 0;
    bpm_          = 120.0f;
    rawBpm_       = 120.0f;
    beatPhase_    = 0.0f;
    beatConf_     = 0.0f;
    periodFrames_ = 60.0f * 60.0f / 120.0f;
    fpsEma_       = 60.0f;
    beatSmoothed_ = 0.0f;
    onsetAvg_     = 0.0f;
    onsetVar_     = 0.0f;
    cwtAvg_       = 0.0f;
    cwtVar_       = 0.0f;
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

float AudioAnalyzer::peakLagParabolic(int lo, int hi, float& peakValOut) const {
    int   bestLag = lo;
    float bestVal = -1.0f;
    for (int lag = lo; lag <= hi; ++lag) {
        if (acf_[lag] > bestVal) {
            bestVal = acf_[lag];
            bestLag = lag;
        }
    }
    peakValOut = bestVal;
    // Parabolic interpolation around the peak for sub-frame BPM precision.
    // Skip if we hit the search-window edge (no neighbour on one side).
    if (bestLag > lo && bestLag < hi) {
        const float y0 = acf_[bestLag - 1];
        const float y1 = acf_[bestLag];
        const float y2 = acf_[bestLag + 1];
        const float denom = 2.0f * (2.0f * y1 - y0 - y2);
        if (std::fabs(denom) > 1e-12f) {
            return static_cast<float>(bestLag) + (y0 - y2) / denom;
        }
    }
    return static_cast<float>(bestLag);
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

    // Track the actual analysis rate. The autocorrelation tempo tracker
    // converts lag-in-frames to BPM via fps * 60 / lag, so it has to
    // know how fast analyzeFrame is being called. The EMA absorbs
    // single-vsync hiccups without yanking the tempo estimate.
    if (dtSeconds > 1e-4f && dtSeconds < 0.1f) {
        const float instFps = 1.0f / dtSeconds;
        fpsEma_ = fpsEma_ * 0.9f + instFps * 0.1f;
    }

    // Snapshot the most recent kFftSize samples. The audio thread may
    // race a write into the ring while we copy; that produces at most a
    // few replaced samples at the trailing edge, which is inaudible at
    // 60 Hz analysis rate.
    const uint32_t w = writeIdx_.load(std::memory_order_acquire);
    const uint32_t start = w - kFftSize;
    // Keep the un-windowed copy for the CWT (Morlet kernels already
    // taper themselves; a second Hann taper would attenuate the snare
    // hit we're trying to detect).
    float rawWindow[kFftSize];
    for (int i = 0; i < kFftSize; ++i) {
        const float s = ring_[(start + i) & (kRingSamples - 1)];
        rawWindow[i] = s;
        scratchRe_[i] = s * window_[i];
        scratchIm_[i] = 0.0f;
    }
    fftRadix2(scratchRe_, scratchIm_);

    // -------- Spectral magnitudes, SuperFlux onset, and 8 bands --------
    // Magnitude in each band, normalized so a full-scale sine wave in the
    // band gives ~1.0. Hann window halves the effective amplitude, hence
    // the 2/N scale. Aggregate by RMS within the band (energy domain) so
    // a single loud bin doesn't dominate over a wide ridge.
    const float scale = 2.0f / static_cast<float>(kFftSize);
    const int   nMag  = kFftSize / 2;
    float bandSumSq[kBands] = {};
    float bandCount[kBands] = {};

    // SuperFlux onset = sum over bins of max(0, mag_i - prevMag_i) *
    // (i + 1). The HFC weighting tilts onset sensitivity toward
    // percussive content where transients live.
    float superFlux = 0.0f;

    for (int i = 1; i < nMag; ++i) {
        const float re = scratchRe_[i];
        const float im = scratchIm_[i];
        const float mag = std::sqrt(re * re + im * im) * scale;

        const float diff = mag - prevMag_[i];
        if (diff > 0.0f) {
            superFlux += diff * static_cast<float>(i + 1);
        }
        prevMag_[i] = mag;

        // Map this bin into its band (linear scan — band edges are
        // sorted, and we visit bins in order, so a running pointer
        // would be marginally faster but this is already 512 cmps
        // per frame which is nothing).
        for (int b = 0; b < kBands; ++b) {
            if (i >= bandLo_[b] && i < bandHi_[b]) {
                bandSumSq[b] += mag * mag;
                bandCount[b] += 1.0f;
                break;
            }
        }
    }

    float bandsRaw[kBands] = {};
    for (int b = 0; b < kBands; ++b) {
        const float meanSq = bandCount[b] > 0.0f
                             ? bandSumSq[b] / bandCount[b]
                             : 0.0f;
        const float rms    = std::sqrt(meanSq);
        // Mild log compression so quiet content still reads as visible
        // signal — same shape as the previous analyzer so existing
        // graph configurations keep their feel.
        float v = std::log1p(rms * 9.0f) * 0.434f;
        bandsRaw[b] = std::min(1.5f, v);
    }

    // -------- Adaptive normalisation of onset & CWT --------
    // Z-score against an asymmetrically-tracked rolling mean+variance.
    // Result is ~0 on the typical loudness floor, ~1 on a clean transient.
    const float onsetZ = updateAndZ(superFlux, onsetAvg_, onsetVar_);
    const float onsetStrength = std::min(2.0f, onsetZ);

    // -------- BeatDetector: autocorrelation tempo + PLL phase ----------
    // 1) Push the latest onset into the ring.
    onsetBuf_[onsetIdx_] = onsetStrength;
    onsetIdx_ = (onsetIdx_ + 1) % kOnsetBufLen;

    // 2) Every kAcfInterval frames, recompute the autocorrelation and
    //    re-extract the BPM. The full ACF is O(N²) (~32K ops at N=256)
    //    which is fine on a render thread when amortised every 8 frames
    //    (~4K ops per frame).
    if ((onsetIdx_ % kAcfInterval) == 0) {
        const int n = kOnsetBufLen;
        float mean = 0.0f;
        for (int i = 0; i < n; ++i) mean += onsetBuf_[i];
        mean /= static_cast<float>(n);
        float var = 0.0f;
        for (int i = 0; i < n; ++i) {
            const float d = onsetBuf_[i] - mean;
            var += d * d;
        }
        if (var < 1e-12f) {
            std::memset(acf_, 0, sizeof(acf_));
        } else {
            const float invVar = 1.0f / var;
            for (int lag = 0; lag < kAcfLen; ++lag) {
                float sum = 0.0f;
                const int loop = n - lag;
                for (int i = 0; i < loop; ++i) {
                    const int ia = (onsetIdx_ + i)       % n;
                    const int ib = (onsetIdx_ + i + lag) % n;
                    const float a = onsetBuf_[ia] - mean;
                    const float b = onsetBuf_[ib] - mean;
                    sum += a * b;
                }
                acf_[lag] = sum * invVar;
            }

            // Find the dominant lag inside the [60..200 BPM] window.
            const float fps = fpsEma_ > 1.0f ? fpsEma_ : 60.0f;
            const int minLag = std::max(1,
                static_cast<int>(std::floor(fps * 60.0f / kMaxBpm)));
            const int maxLag = std::min(kAcfLen - 1,
                static_cast<int>(std::ceil (fps * 60.0f / kMinBpm)));
            if (minLag < maxLag) {
                float peakVal = 0.0f;
                const float lagF = peakLagParabolic(minLag, maxLag, peakVal);
                if (lagF > 0.5f) {
                    rawBpm_ = fps * 60.0f / lagF;
                }
                bpm_ = kBpmSmooth * bpm_ + (1.0f - kBpmSmooth) * rawBpm_;
                bpm_ = std::clamp(bpm_, kMinBpm, kMaxBpm);
                periodFrames_ = fps * 60.0f / bpm_;
                beatConf_ = std::clamp(peakVal, 0.0f, 1.0f);
            }
        }
    }

    // 3) Advance the PLL phase. The phase ramps 0→1 once per beat;
    //    when a strong onset arrives during a confident lock, the
    //    phase is nudged toward the nearest beat boundary so any
    //    accumulated drift is corrected.
    bool beatBoundary = false;
    if (periodFrames_ >= 1.0f) {
        const float phaseInc = 1.0f / periodFrames_;
        beatPhase_ += phaseInc;
        if (onsetStrength > kPllOnsetThreshold && beatConf_ > kPllConfThreshold) {
            const float phaseErr = (beatPhase_ < 0.5f)
                                   ? -beatPhase_
                                   :  1.0f - beatPhase_;
            beatPhase_ += phaseErr * kPllGain * onsetStrength;
        }
        if (beatPhase_ >= 1.0f) {
            beatPhase_  -= 1.0f;
            beatBoundary = true;
        }
        if (beatPhase_ < 0.0f) beatPhase_ += 1.0f;
        beatPhase_ = std::clamp(beatPhase_, 0.0f, 0.99999f);
    }

    // -------- CWT transient flash --------
    // Three Morlet kernels at 2/5/10 kHz catch the sub-beat percussion
    // (hat ticks between bass kicks, snare ghost notes, cymbal shimmer)
    // that the FFT bands smear together. Strided dot-product gives the
    // peak magnitude across the window.
    float cwtPeak = 0.0f;
    for (int k = 0; k < kCwtKernels; ++k) {
        const int klen = cwtKernelLen_[k];
        if (klen <= 0 || kFftSize < klen) continue;
        const float* kre = cwtRe_[k].data();
        const float* kim = cwtIm_[k].data();
        const int positions = kFftSize - klen + 1;
        float maxMagSq = 0.0f;
        for (int pos = 0; pos < positions; pos += kCwtStride) {
            float sumRe = 0.0f, sumIm = 0.0f;
            for (int j = 0; j < klen; ++j) {
                const float s = rawWindow[pos + j];
                sumRe += s * kre[j];
                sumIm += s * kim[j];
            }
            const float magSq = sumRe * sumRe + sumIm * sumIm;
            if (magSq > maxMagSq) maxMagSq = magSq;
        }
        const float mag = std::sqrt(maxMagSq);
        if (mag > cwtPeak) cwtPeak = mag;
    }
    const float cwtZ = updateAndZ(cwtPeak, cwtAvg_, cwtVar_);
    const float cwtStrength = std::min(2.0f, cwtZ);

    // -------- Final composition --------
    // Band asymmetric smoothing: fast attack so peaks pop, slow release
    // so they linger and read as a sustained pulse rather than a single-
    // frame flash. Rates are scaled by dt so behaviour stays the same
    // across variable vsync timing.
    constexpr float kBandAttack  = 0.55f;
    constexpr float kBandRelease = 0.10f;
    const float dt60 = std::clamp(dtSeconds * 60.0f, 0.0f, 2.0f);
    for (int b = 0; b < kBands; ++b) {
        const float target = bandsRaw[b];
        const float current = bandsSmoothed_[b];
        const float rate = target > current ? kBandAttack : kBandRelease;
        const float k = std::clamp(rate * dt60, 0.0f, 1.0f);
        bandsSmoothed_[b] = current + (target - current) * k;
    }

    // Beat envelope: instantaneous flash on either signal — PLL beat
    // boundary OR a strong off-beat percussive transient. Smooth with
    // fast attack so it pops, slow release so it lingers a few frames
    // (matches the legacy beat scalar's feel so existing graph wiring
    // keeps the same character but tracks far more accurately).
    const float beatFlash = beatBoundary ? 1.0f : 0.0f;
    const float transient = std::min(1.0f, cwtStrength * 0.7f);
    const float beatTarget = std::max(beatFlash, transient);
    const float beatRate   = beatTarget > beatSmoothed_ ? 0.90f : 0.10f;
    const float beatK      = std::clamp(beatRate * dt60, 0.0f, 1.0f);
    beatSmoothed_ += (beatTarget - beatSmoothed_) * beatK;
}

AudioAnalyzer& globalAudioAnalyzer() {
    static AudioAnalyzer instance;
    return instance;
}

} // namespace penrose
