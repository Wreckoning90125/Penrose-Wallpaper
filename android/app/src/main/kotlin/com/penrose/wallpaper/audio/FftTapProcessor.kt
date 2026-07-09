package com.penrose.wallpaper.audio

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Passthrough Media3 [AudioProcessor] that taps the PCM stream as it flows
 * through the audio sink. Direct input buffers are handed to native code for
 * downmixing into the analyzer ring; heap-backed buffers are downmixed into a
 * reusable direct mono scratch buffer and then handed through the same native
 * direct-buffer path. The original buffer is copied to output verbatim so
 * playback continues unchanged.
 *
 * Runs on Media3's audio thread. The direct-buffer path should stay
 * allocation-free and non-blocking; the heap path keeps work bounded, decodes
 * samples by absolute byte reads, and avoids JNI array pin/copy calls on that
 * thread.
 */
@OptIn(UnstableApi::class)
internal class FftTapProcessor(
    private val onSampleRate: (sampleRate: Int) -> Unit,
    private val onPcmBuffer: (buffer: ByteBuffer, position: Int, bytes: Int, format: Int, channels: Int) -> Unit,
) : BaseAudioProcessor() {
    private companion object {
        const val FORMAT_PCM_16 = 1
        const val FORMAT_PCM_FLOAT = 2
        const val FORMAT_PCM_8 = 3
    }

    private var pcmEncoding: Int = C.ENCODING_PCM_16BIT
    private var channelCount: Int = 2
    private val monoScratch: FloatArray = FloatArray(4096)
    private val monoDirectBytes: ByteBuffer =
        ByteBuffer.allocateDirect(monoScratch.size * java.lang.Float.BYTES).order(ByteOrder.LITTLE_ENDIAN)
    private val monoDirect = monoDirectBytes.asFloatBuffer()

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        pcmEncoding = inputAudioFormat.encoding
        channelCount = inputAudioFormat.channelCount.coerceAtLeast(1)
        onSampleRate(inputAudioFormat.sampleRate)
        return inputAudioFormat
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val bytes = inputBuffer.remaining()
        if (bytes == 0) return

        val output = replaceOutputBuffer(bytes)

        val bytesPerSample: Int
        val format: Int
        when (pcmEncoding) {
            C.ENCODING_PCM_16BIT -> {
                bytesPerSample = 2
                format = FORMAT_PCM_16
            }
            C.ENCODING_PCM_FLOAT -> {
                bytesPerSample = 4
                format = FORMAT_PCM_FLOAT
            }
            C.ENCODING_PCM_8BIT -> {
                bytesPerSample = 1
                format = FORMAT_PCM_8
            }
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
        if (inputBuffer.isDirect) {
            onPcmBuffer(inputBuffer, inputBuffer.position(), frames * channelCount * bytesPerSample, format, channelCount)
        } else {
            pushHeapBuffer(inputBuffer, inputBuffer.position(), frames)
        }

        output.put(inputBuffer)
        output.flip()
    }

    private fun pushMonoScratch(frames: Int) {
        monoDirect.clear()
        monoDirect.put(monoScratch, 0, frames)
        onPcmBuffer(monoDirectBytes, 0, frames * java.lang.Float.BYTES, FORMAT_PCM_FLOAT, 1)
    }

    private fun readPcm16Le(buffer: ByteBuffer, byteIndex: Int): Int {
        val bits = (buffer.get(byteIndex).toInt() and 0xff) or
            ((buffer.get(byteIndex + 1).toInt() and 0xff) shl 8)
        return bits.toShort().toInt()
    }

    private fun readPcmFloatLe(buffer: ByteBuffer, byteIndex: Int): Float {
        val bits = (buffer.get(byteIndex).toInt() and 0xff) or
            ((buffer.get(byteIndex + 1).toInt() and 0xff) shl 8) or
            ((buffer.get(byteIndex + 2).toInt() and 0xff) shl 16) or
            ((buffer.get(byteIndex + 3).toInt() and 0xff) shl 24)
        return java.lang.Float.intBitsToFloat(bits)
    }

    private fun pushHeapBuffer(buffer: ByteBuffer, startByte: Int, frames: Int) {
        when (pcmEncoding) {
            C.ENCODING_PCM_16BIT -> {
                val inv = 1.0f / (channelCount.toFloat() * 32768f)
                var remaining = frames
                var frameBase = startByte
                while (remaining > 0) {
                    val chunk = minOf(remaining, monoScratch.size)
                    for (f in 0 until chunk) {
                        var sum = 0
                        val sampleBase = frameBase + f * channelCount * 2
                        for (c in 0 until channelCount) sum += readPcm16Le(buffer, sampleBase + c * 2)
                        monoScratch[f] = sum * inv
                    }
                    pushMonoScratch(chunk)
                    frameBase += chunk * channelCount * 2
                    remaining -= chunk
                }
            }
            C.ENCODING_PCM_FLOAT -> {
                val inv = 1.0f / channelCount.toFloat()
                var remaining = frames
                var frameBase = startByte
                while (remaining > 0) {
                    val chunk = minOf(remaining, monoScratch.size)
                    for (f in 0 until chunk) {
                        var sum = 0f
                        val sampleBase = frameBase + (f * channelCount * java.lang.Float.BYTES)
                        for (c in 0 until channelCount) {
                            sum += readPcmFloatLe(buffer, sampleBase + (c * java.lang.Float.BYTES))
                        }
                        monoScratch[f] = sum * inv
                    }
                    pushMonoScratch(chunk)
                    frameBase += chunk * channelCount * java.lang.Float.BYTES
                    remaining -= chunk
                }
            }
            C.ENCODING_PCM_8BIT -> {
                val inv = 1.0f / (channelCount.toFloat() * 128f)
                var remaining = frames
                var frameBase = startByte
                while (remaining > 0) {
                    val chunk = minOf(remaining, monoScratch.size)
                    for (f in 0 until chunk) {
                        var sum = 0
                        val sampleBase = frameBase + f * channelCount
                        for (c in 0 until channelCount) sum += ((buffer.get(sampleBase + c).toInt() and 0xff) - 128)
                        monoScratch[f] = sum * inv
                    }
                    pushMonoScratch(chunk)
                    frameBase += chunk * channelCount
                    remaining -= chunk
                }
            }
        }
    }
}
