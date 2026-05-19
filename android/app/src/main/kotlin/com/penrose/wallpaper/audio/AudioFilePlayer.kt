package com.penrose.wallpaper.audio

import android.content.Context
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink

/**
 * Wraps an [ExoPlayer] configured with a [FftTapProcessor] in the audio
 * sink chain so PCM frames reach the native analyzer as a side effect
 * of normal playback. The player handles audio focus itself (so other
 * apps duck/pause as expected) and the wrapping [AudioPlaybackService]
 * hosts a MediaSession around it for the system media controls.
 *
 * The underlying [exoPlayer] is exposed for the MediaSession to bind to.
 */
@OptIn(UnstableApi::class)
internal class AudioFilePlayer(
    context: Context,
    onPcm: (FloatArray, Int, Int) -> Unit,
) {
    private val appContext = context.applicationContext
    private val tap = FftTapProcessor(onPcm)

    private val renderersFactory = object : DefaultRenderersFactory(appContext) {
        override fun buildAudioSink(
            context: Context,
            enableFloatOutput: Boolean,
            enableAudioTrackPlaybackParams: Boolean,
        ): AudioSink {
            return DefaultAudioSink.Builder(context)
                .setAudioProcessors(arrayOf<AudioProcessor>(tap))
                .build()
        }
    }

    val exoPlayer: ExoPlayer = ExoPlayer.Builder(appContext, renderersFactory).build().apply {
        repeatMode = Player.REPEAT_MODE_ALL
        // handleAudioFocus = true makes ExoPlayer behave like a well-formed
        // media app: it requests focus on play, ducks transient losses, and
        // pauses on permanent loss. This is what makes us play nicely with
        // other audio apps instead of stomping their playback.
        setAudioAttributes(
            AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .setUsage(C.USAGE_MEDIA)
                .build(),
            /* handleAudioFocus = */ true,
        )
    }

    fun play(uri: Uri) {
        exoPlayer.setMediaItem(MediaItem.fromUri(uri))
        exoPlayer.prepare()
        exoPlayer.playWhenReady = true
    }

    fun pause() { exoPlayer.playWhenReady = false }
    fun resume() { exoPlayer.playWhenReady = true }

    fun stop() {
        exoPlayer.stop()
        exoPlayer.clearMediaItems()
    }

    fun release() {
        exoPlayer.release()
    }
}
