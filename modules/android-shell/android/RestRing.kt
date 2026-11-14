package com.azizfitness.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
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
 * - `play` asks Android for AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK, so YouTube Music / Spotify drop their volume,
 *   waits a moment for the dip, plays `res/raw/rest_<sound>.wav` on the media stream (same volume and earbuds as
 *   the music), then gives focus back and the music comes back up.
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

    private fun attrs(): AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

    private fun focus(am: AudioManager): AudioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attrs())
        .setWillPauseWhenDucked(false)
        .setOnAudioFocusChangeListener({ }, main)
        .build()

    /** Dims other audio for `ms` without playing anything (the in-app custom sound plays itself meanwhile). */
    fun duck(ctx: Context, ms: Long) {
        val am = ctx.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val req = focus(am)
        if (am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_FAILED) return
        main.postDelayed({ am.abandonAudioFocusRequest(req) }, ms.coerceIn(500L, MAX_MS) + GIVE_BACK_MS)
    }

    /** Ducks other audio, plays the rest sound, then lets the music come back. `done` runs once, always. */
    fun play(ctx: Context, sound: String?, done: () -> Unit = {}): Boolean {
        val app = ctx.applicationContext
        val am = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val req = focus(am)
        // FAILED means a phone call holds the audio: stay quiet, the notification still shows.
        if (am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_FAILED) { done(); return false }
        var finished = false
        var mp: MediaPlayer? = null
        val finish = Runnable {
            if (!finished) {
                finished = true
                try { mp?.release() } catch (e: Exception) { }
                main.postDelayed({ am.abandonAudioFocusRequest(req); done() }, GIVE_BACK_MS)
            }
        }
        mp = try { MediaPlayer.create(app, rawId(app, sound), attrs(), am.generateAudioSessionId()) } catch (e: Exception) { null }
        val player = mp ?: run { am.abandonAudioFocusRequest(req); done(); return false }
        player.setOnCompletionListener { main.post(finish) }
        player.setOnErrorListener { _, _, _ -> main.post(finish); true }
        main.postDelayed({ try { if (!finished) player.start() } catch (e: Exception) { finish.run() } }, DIP_MS)
        main.postDelayed(finish, MAX_MS)
        return true
    }
}
