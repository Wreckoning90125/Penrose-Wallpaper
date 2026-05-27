package com.penrose.wallpaper.audio

import android.content.Context
import android.graphics.Bitmap
import android.util.AttributeSet
import android.view.View
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.SeekBar
import android.widget.TextView
import androidx.preference.Preference
import androidx.preference.PreferenceViewHolder
import com.penrose.wallpaper.R
import java.util.Locale

/**
 * Rich "now-playing" preference row: album art + title + artist +
 * play/pause + scrubber. The widget itself is dumb — the host fragment
 * pushes state via [bind] each time the underlying [MediaController]
 * reports new data, and wires play/pause + scrub actions back through
 * [onPlayPauseClick] and [onSeek].
 *
 * Persistence is off — the preference is purely UI for the live
 * playback state. Hides the standard preference icon slot via
 * isIconSpaceReserved=false so the album art inside the layout owns
 * the leading edge.
 */
class AudioControlsPreference @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : Preference(context, attrs) {

    /** True when the controller reports active playback. */
    var isPlaying: Boolean = false
    /** Track title; null shows a "No file selected" placeholder. */
    var title: String? = null
    /** Track artist; hides the artist row when null/blank. */
    var artist: String? = null
    /** Embedded album art bitmap; falls back to the music-note icon. */
    var artworkBitmap: Bitmap? = null
    /** Playback position in ms, 0 if no track loaded. */
    var positionMs: Long = 0L
    /** Track duration in ms, 0 means unknown / not loaded. */
    var durationMs: Long = 0L
    /** True when a track is loaded; gates play/pause + scrub enable. */
    var hasTrack: Boolean = false

    /** Fragment hooks this to toggle play / pause on the controller. */
    var onPlayPauseClick: (() -> Unit)? = null
    /** Fragment hooks this to seek to a new position (ms) on the controller. */
    var onSeek: ((Long) -> Unit)? = null

    private var isScrubbing: Boolean = false

    init {
        layoutResource = R.layout.pref_audio_controls
        isPersistent = false
        isSelectable = false
        isIconSpaceReserved = false
    }

    /**
     * Bulk-update the visible state in one call and refresh the
     * preference. Called from the fragment whenever the MediaController
     * reports new data (state change, metadata change, or per-half-second
     * position tick).
     */
    fun bind(
        hasTrack: Boolean,
        isPlaying: Boolean,
        title: String?,
        artist: String?,
        artworkBitmap: Bitmap?,
        positionMs: Long,
        durationMs: Long,
    ) {
        this.hasTrack = hasTrack
        this.isPlaying = isPlaying
        this.title = title
        this.artist = artist
        this.artworkBitmap = artworkBitmap
        this.positionMs = positionMs
        this.durationMs = durationMs
        notifyChanged()
    }

    override fun onBindViewHolder(holder: PreferenceViewHolder) {
        super.onBindViewHolder(holder)
        val art       = holder.findViewById(R.id.audio_art) as ImageView
        val titleView = holder.findViewById(R.id.audio_title) as TextView
        val artistRow = holder.findViewById(R.id.audio_artist) as TextView
        val playPause = holder.findViewById(R.id.audio_play_pause) as ImageButton
        val scrubber  = holder.findViewById(R.id.audio_scrub) as SeekBar
        val posView   = holder.findViewById(R.id.audio_position) as TextView
        val durView   = holder.findViewById(R.id.audio_duration) as TextView

        // Album art uses the default icon when embedded artwork is absent.
        if (artworkBitmap != null) {
            art.setImageBitmap(artworkBitmap)
            art.scaleType = ImageView.ScaleType.CENTER_CROP
        } else {
            art.setImageResource(R.drawable.ic_audio_default)
            art.scaleType = ImageView.ScaleType.CENTER_INSIDE
        }

        // Title + artist.
        titleView.text = title
            ?: context.getString(R.string.audio_file_none)
        artistRow.text = artist ?: ""
        artistRow.visibility = if (artist.isNullOrBlank()) View.GONE else View.VISIBLE

        // Play / pause button.
        playPause.isEnabled = hasTrack
        playPause.alpha = if (hasTrack) 1f else 0.4f
        playPause.setImageResource(
            if (isPlaying) R.drawable.ic_audio_pause else R.drawable.ic_audio_play
        )
        playPause.contentDescription = context.getString(
            if (isPlaying) R.string.audio_pause_desc else R.string.audio_play_desc
        )
        playPause.setOnClickListener { onPlayPauseClick?.invoke() }

        // Scrubber. SeekBar progress is in seconds (Int range); we lose
        // sub-second precision on the slider but gain headroom for very
        // long tracks (Int max ≈ 68 years).
        scrubber.isEnabled = hasTrack && durationMs > 0
        scrubber.max = (durationMs / 1000L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        if (!isScrubbing) {
            scrubber.progress = (positionMs / 1000L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        }
        scrubber.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                if (fromUser && seekBar != null) {
                    // Update the position label live while the user drags
                    // so the time follows the thumb without waiting for
                    // the next half-second poll.
                    posView.text = formatMs(progress * 1000L)
                }
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {
                isScrubbing = true
            }
            override fun onStopTrackingTouch(seekBar: SeekBar?) {
                isScrubbing = false
                seekBar?.let { onSeek?.invoke(it.progress * 1000L) }
            }
        })

        // Time labels.
        posView.text = formatMs(if (isScrubbing) scrubber.progress * 1000L else positionMs)
        durView.text = formatMs(durationMs)
    }

    private fun formatMs(ms: Long): String {
        val totalSec = (ms / 1000L).coerceAtLeast(0L)
        val minutes = totalSec / 60L
        val seconds = totalSec % 60L
        return String.format(Locale.US, "%d:%02d", minutes, seconds)
    }
}
