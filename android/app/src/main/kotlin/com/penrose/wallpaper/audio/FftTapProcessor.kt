package com.penrose.wallpaper.audio

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Passthrough Media3 [AudioProcessor] that taps the PCM stream as it
 * flows through the audio sink. Each input buffer is downmixed to mono
 * float samples and handed to [onPcm]; the buffer is then copied to the
 * output verbatim so playback continues unchanged.
 *
 * Runs on Media3's audio thread. The callback should be lock-free
 * (writing to an SPSC ring buffer in our case).
 */
@OptIn(UnstableApi::class)
internal class FftTapProcessor(
    private val onPcm: (samples: FloatArray, frames: Int, sampleRate: Int) -> Unit,
) : BaseAudioProcessor() {

    private var pcmEncoding: Int = C.ENCODING_PCM_16BIT
    private var channelCount: Int = 2
    private var sampleRate: Int = 48000
    private val scratch: FloatArray = FloatArray(4096)

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        pcmEncoding = inputAudioFormat.encoding
        channelCount = inputAudioFormat.channelCount.coerceAtLeast(1)
        sampleRate = inputAudioFormat.sampleRate
        return inputAudioFormat
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val bytes = inputBuffer.remaining()
        if (bytes == 0) return

        val output = replaceOutputBuffer(bytes)

        val bytesPerSample = when (pcmEncoding) {
            C.ENCODING_PCM_16BIT -> 2
            C.ENCODING_PCM_FLOAT -> 4
            C.ENCODING_PCM_8BIT -> 1
            else -> {
                output.put(inputBuffer)
                output.flip()
                return
            }
        }
        val frames = (bytes / bytesPerSample) / channelCount
        if (frames <= 0) {
            output.put(inputBuffer)
            output.flip()
            return
        }
        val dup = inputBuffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)
        when (pcmEncoding) {
            C.ENCODING_PCM_16BIT -> {
                val sb = dup.asShortBuffer()
                val inv = 1.0f / (channelCount.toFloat() * 32768f)
                var remaining = frames
                while (remaining > 0) {
                    val chunk = minOf(remaining, scratch.size)
                    for (f in 0 until chunk) {
                        var sum = 0
                        for (c in 0 until channelCount) sum += sb.get().toInt()
                        scratch[f] = sum * inv
                    }
                    onPcm(scratch, chunk, sampleRate)
                    remaining -= chunk
                }
            }
            C.ENCODING_PCM_FLOAT -> {
                val fb = dup.asFloatBuffer()
                val inv = 1.0f / channelCount.toFloat()
                var remaining = frames
                while (remaining > 0) {
                    val chunk = minOf(remaining, scratch.size)
                    for (f in 0 until chunk) {
                        var sum = 0f
                        for (c in 0 until channelCount) sum += fb.get()
                        scratch[f] = sum * inv
                    }
                    onPcm(scratch, chunk, sampleRate)
                    remaining -= chunk
                }
            }
            C.ENCODING_PCM_8BIT -> {
                val inv = 1.0f / (channelCount.toFloat() * 128f)
                var remaining = frames
                while (remaining > 0) {
                    val chunk = minOf(remaining, scratch.size)
                    for (f in 0 until chunk) {
                        var sum = 0
                        for (c in 0 until channelCount) sum += ((dup.get().toInt() and 0xff) - 128)
                        scratch[f] = sum * inv
                    }
                    onPcm(scratch, chunk, sampleRate)
                    remaining -= chunk
                }
            }
        }

        output.put(inputBuffer)
        output.flip()
    }
}
