package com.penrose.wallpaper.audio

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import java.nio.ByteBuffer

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
    onSampleRate: (Int) -> Unit,
    onPcmBuffer: (ByteBuffer, Int, Int, Int, Int) -> Unit,
) {
    private val appContext = context.applicationContext
    private val tap = FftTapProcessor(onSampleRate, onPcmBuffer)

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
        exoPlayer.setMediaItem(buildMediaItem(uri))
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

    /**
     * Build a MediaItem whose MediaMetadata is populated from the file's
     * embedded tags (ID3 / MP4) — title, artist, album, and any embedded
     * cover art. Media3's DefaultMediaNotificationProvider reads
     * MediaItem.mediaMetadata to populate the foreground notification,
     * lockscreen controls, and the Quick Settings media tile, so setting
     * these fields here is what makes the system media UI show rich
     * info instead of just the file name.
     *
     * Title falls back to the OpenableColumns DISPLAY_NAME (the human
     * file name from the document/media provider), then to the URI's
     * last path segment as a last resort. Artwork is left null when the
     * file has no embedded picture — DefaultMediaNotificationProvider
     * shows its default music icon in that case.
     */
    private fun buildMediaItem(uri: Uri): MediaItem {
        val mb = MediaMetadata.Builder()
        var title: String? = null
        var artist: String? = null
        var album: String? = null
        var artwork: ByteArray? = null

        val mmr = MediaMetadataRetriever()
        try {
            mmr.setDataSource(appContext, uri)
            title   = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)
            artist  = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
            album   = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)
            artwork = mmr.embeddedPicture
        } catch (_: Exception) {
            // No metadata available — fall through with defaults.
        } finally {
            try { mmr.release() } catch (_: Exception) { }
        }

        if (title.isNullOrBlank()) title = resolveDisplayName(uri) ?: uri.lastPathSegment

        title?.let { mb.setTitle(it) }
        artist?.let { mb.setArtist(it) }
        album?.let { mb.setAlbumTitle(it) }
        artwork?.let {
            mb.setArtworkData(it, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
        }
        mb.setIsBrowsable(false)
        mb.setIsPlayable(true)

        return MediaItem.Builder()
            .setUri(uri)
            .setMediaMetadata(mb.build())
            .build()
    }

    /**
     * Resolve the human file name (e.g. "Track 03.mp3") from a content
     * URI's OpenableColumns. Returns null if the URI isn't an openable
     * content URI or the provider doesn't expose DISPLAY_NAME.
     */
    private fun resolveDisplayName(uri: Uri): String? {
        if (uri.scheme != "content") return null
        return try {
            appContext.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { c ->
                    if (c.moveToFirst()) {
                        val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (idx >= 0) c.getString(idx) else null
                    } else null
                }
        } catch (_: Exception) {
            null
        }
    }
}
