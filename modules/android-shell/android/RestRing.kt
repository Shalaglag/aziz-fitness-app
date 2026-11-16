package com.azizfitness.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * The "rest is over" sound, played natively so music ducks under it (Aziz, Nov 14 2026: "dim the music a little,
 * sound the notification, then the music comes back on").
 *
 * - `play` lowers the media volume to about a third (music keeps playing), plays `res/raw/rest_<sound>.wav` on
 *   the notification sound, then brings the media volume back. Audio focus "may duck" was tried first (Nov 14) but
 *   YouTube Music pauses on it instead of dipping.
 * - `arm` sets an exact alarm for the rest's end; RestRingReceiver rings even with the phone locked and the web
 *   view asleep, and posts a quiet "Rest is over" notification (the bell itself comes from `play`, not the channel).
 * - Each rest end rings once (`claim`): whichever of the alarm and the in-app timer gets there first plays it.
 * Used by RestTimerPlugin (ring / arm / disarm / duck) and RestRingReceiver. Source of truth for the copy in
 * android/app/src/main/java; modules/android-shell/android-shell.test.js checks they are identical.
 */
object RestRing {
    const val ACTION = "com.azizfitness.app.REST_RING"
    const val OVER_ID = 7001
    const val OVER_CHANNEL = "rest_over_v2"
    private const val DIP_MS = 220L
    private const val GIVE_BACK_MS = 250L
    private const val MAX_MS = 20000L
    private const val DIM_TO = 0.35
    private const val RESTORE_STEP_MS = 120L

    @Volatile var foreground = false
    @Volatile private var rungEnd = 0L
    @Volatile var armedEnd = 0L
    private val main = Handler(Looper.getMainLooper())

    /** True the first time a given rest end asks to ring (end 0 = a preview, always rings). */
    @Synchronized fun claim(end: Long): Boolean {
        if (end > 0 && end == rungEnd) return false
        if (end > 0) rungEnd = end
        return true
    }

    fun rawId(ctx: Context, sound: String?): Int {
        val s = (sound ?: "").filter { it.isLetterOrDigit() }.lowercase()
        val name = if (s.isEmpty() || s == "restdone" || s == "custom") "rest_done" else "rest_$s"
        val id = ctx.resources.getIdentifier(name, "raw", ctx.packageName)
        return if (id != 0) id else R.raw.rest_done
    }

    private fun pending(ctx: Context, end: Long, sound: String, silent: Boolean, flags: Int): PendingIntent? {
        val i = Intent(ctx, RestRingReceiver::class.java).setAction(ACTION)
            .putExtra("end", end).putExtra("sound", sound).putExtra("silent", silent)
        return PendingIntent.getBroadcast(ctx, OVER_ID, i, flags or PendingIntent.FLAG_IMMUTABLE)
    }

    /** Schedules the ring for `end`. Returns "exact", or "inexact" when Android refuses exact alarms. */
    fun arm(ctx: Context, end: Long, sound: String, silent: Boolean): String {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = pending(ctx, end, sound, silent, PendingIntent.FLAG_UPDATE_CURRENT)!!
        armedEnd = end
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        return try {
            if (exact) { am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, end, pi); "exact" }
            else { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, end, pi); "inexact" }
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, end, pi); "inexact"
        }
    }

    fun disarm(ctx: Context) {
        armedEnd = 0L
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        pending(ctx, 0, "", false, PendingIntent.FLAG_NO_CREATE)?.let { am.cancel(it); it.cancel() }
    }

    fun cancelOver(ctx: Context) = NotificationManagerCompat.from(ctx).cancel(OVER_ID)

    /** The visible "Rest is over" heads-up. Its channel has no sound (play() rings), only a buzz. */
    fun postOver(ctx: Context) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(OVER_CHANNEL) == null) {
            val ch = NotificationChannel(OVER_CHANNEL, "Rest is over", NotificationManager.IMPORTANCE_HIGH)
            ch.description = "Pops up when your rest ends. The rest sound plays over your music, which dips for a moment."
            ch.setSound(null, null)
            ch.enableVibration(true)
            ch.vibrationPattern = longArrayOf(0, 200, 100, 200)
            ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            nm.createNotificationChannel(ch)
        }
        val open = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val openPi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(ctx, OVER_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("Rest is over")
            .setContentText("Back to the next set.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setTimeoutAfter(60000)
            .setContentIntent(openPi)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(OVER_ID, n) } catch (e: SecurityException) { }
    }

    private fun attrs(usage: Int): AudioAttributes = AudioAttributes.Builder()
        .setUsage(usage)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

    /**
     * Turns the media volume down to about a third and returns a function that brings it back in small steps.
     * No audio focus is asked for: YouTube Music pauses on a "may duck" focus loss (Aziz, Nov 16 2026: "it's
     * stopping music then starting it"), so the volume is lowered directly and the music never stops.
     * The volume is put back only if nobody changed it meanwhile.
     */
    private fun dimMusic(am: AudioManager): () -> Unit {
        if (am.isVolumeFixed) return {}
        val s = AudioManager.STREAM_MUSIC
        val before = try { am.getStreamVolume(s) } catch (e: Exception) { return {} }
        val low = maxOf(1, Math.round(before * DIM_TO).toInt())
        if (low >= before) return {}
        try { am.setStreamVolume(s, low, 0) } catch (e: Exception) { return {} }
        return {
            val steps = 4
            for (k in 1..steps) {
                main.postDelayed({
                    try {
                        val now = am.getStreamVolume(s)
                        val prev = low + (before - low) * (k - 1) / steps
                        if (now == prev) am.setStreamVolume(s, low + (before - low) * k / steps, 0)
                    } catch (e: Exception) { }
                }, RESTORE_STEP_MS * k)
            }
        }
    }

    /** The user's own sound plays in the web view on the media stream, so it is not dimmed; nothing to do. */
    @Suppress("UNUSED_PARAMETER")
    fun duck(ctx: Context, ms: Long) { }

    /**
     * Plays the rest sound. With music playing, the bell plays on the notification sound (its own volume) while the
     * media volume dips, then the music comes back up. On silent / vibrate, or with the notification volume at 0,
     * it plays on the media stream mixed over the music, undimmed. `done` runs once, always.
     */
    fun play(ctx: Context, sound: String?, done: () -> Unit = {}): Boolean {
        val app = ctx.applicationContext
        val am = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        // A phone call holds the audio: stay quiet, the notification still shows.
        if (am.mode == AudioManager.MODE_IN_CALL || am.mode == AudioManager.MODE_IN_COMMUNICATION) { done(); return false }
        val music = am.isMusicActive
        val overMusic = music && am.ringerMode == AudioManager.RINGER_MODE_NORMAL &&
            (try { am.getStreamVolume(AudioManager.STREAM_NOTIFICATION) } catch (e: Exception) { 0 }) > 0
        val usage = if (overMusic) AudioAttributes.USAGE_NOTIFICATION_EVENT else AudioAttributes.USAGE_MEDIA
        val mp = try { MediaPlayer.create(app, rawId(app, sound), attrs(usage), am.generateAudioSessionId()) } catch (e: Exception) { null }
        if (mp == null) { done(); return false }
        val restore = if (overMusic) dimMusic(am) else ({})
        var finished = false
        val finish = Runnable {
            if (!finished) {
                finished = true
                try { mp.release() } catch (e: Exception) { }
                main.postDelayed({ restore(); main.postDelayed({ done() }, RESTORE_STEP_MS * 5) }, GIVE_BACK_MS)
            }
        }
        mp.setOnCompletionListener { main.post(finish) }
        mp.setOnErrorListener { _, _, _ -> main.post(finish); true }
        main.postDelayed({ try { if (!finished) mp.start() } catch (e: Exception) { finish.run() } }, if (overMusic) DIP_MS else 0L)
        main.postDelayed(finish, MAX_MS)
        return true
    }
}
