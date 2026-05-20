package com.penrose.wallpaper.audio

import android.content.Intent
import android.net.Uri
import androidx.annotation.OptIn
import androidx.core.net.toUri
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.penrose.wallpaper.NativeBridge

/**
 * Foreground service hosting the file-playback ExoPlayer wrapped in a
 * Media3 MediaSession. Two reasons we go through MediaSessionService
 * instead of a vanilla foreground service:
 *
 *   1. The system surfaces us as a real media source — we appear in
 *      Quick Settings media controls, route headset buttons, integrate
 *      with audio focus, and don't clash with other media apps.
 *   2. Media3 handles the foreground notification itself (media-style
 *      with play/pause/skip), so playback continues across activity
 *      lifecycles (closing the settings sheet, opening the full-screen
 *      preview, returning to the home screen) and the wallpaper engine
 *      keeps reading from the same global analyzer.
 *
 * Activity-side control goes through onStartCommand with simple actions
 * (PLAY url / STOP) — we don't need the full MediaController dance for
 * a single-file player.
 */
@OptIn(UnstableApi::class)
class AudioPlaybackService : MediaSessionService() {

    private var player: AudioFilePlayer? = null
    private var session: MediaSession? = null
    private var lastUri: String? = null

    companion object {
        const val ACTION_PLAY = "com.penrose.wallpaper.audio.PLAY"
        const val EXTRA_URI   = "uri"

        // Display-only mirror of what the service is currently playing.
        // In-memory state owned by the running service — not persisted to
        // SharedPreferences, never re-loaded on app launch. When the
        // service dies or is stopped, this clears and the settings UI
        // shows "No file selected" again.
        @Volatile var currentDisplayName: String? = null
            private set
        @Volatile var currentUri: String? = null
            private set

        fun start(context: android.content.Context, uri: String) {
            val i = Intent(context, AudioPlaybackService::class.java).apply {
                action = ACTION_PLAY
                putExtra(EXTRA_URI, uri)
            }
            context.startForegroundService(i)
        }

        fun stop(context: android.content.Context) {
            // stopService doesn't trip API 26+'s "started a foreground-type
            // service from the background" guard and doesn't expect a
            // startForeground call within 5s. If the service isn't running
            // this is a no-op; if it is, onDestroy runs cleanup. We mirror
            // the UI state immediately so the summary updates without
            // racing the actual service teardown.
            currentDisplayName = null
            currentUri = null
            context.stopService(Intent(context, AudioPlaybackService::class.java))
        }
    }

    override fun onCreate() {
        super.onCreate()
        val p = AudioFilePlayer(this) { samples, frames, rate ->
            NativeBridge.pushAudio(samples, frames, rate)
        }
        player = p
        session = MediaSession.Builder(this, p.exoPlayer).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_PLAY) {
            val uri = intent.getStringExtra(EXTRA_URI)
            if (uri != null && uri != lastUri) {
                lastUri = uri
                currentUri = uri
                val parsed = uri.toUri()
                currentDisplayName = parsed.lastPathSegment
                player?.play(parsed)
            } else if (uri != null) {
                player?.resume()
            }
        }
        return super.onStartCommand(intent, flags, startId)
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // User swiped the app away. Tear down playback so we don't leave
        // a foreground notification hanging when the activity is gone.
        // pauseAllPlayersAndStopSelf transitions out of foreground cleanly
        // and lets onDestroy run the rest of the cleanup.
        lastUri = null
        currentUri = null
        currentDisplayName = null
        player?.stop()
        NativeBridge.clearAudio()
        pauseAllPlayersAndStopSelf()
    }

    override fun onDestroy() {
        lastUri = null
        currentUri = null
        currentDisplayName = null
        session?.release()
        session = null
        player?.release()
        player = null
        NativeBridge.clearAudio()
        super.onDestroy()
    }
}
