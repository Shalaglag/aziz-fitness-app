package com.azizfitness.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.text.DateFormat
import java.util.Date
import org.json.JSONArray
import org.json.JSONObject

/**
 * Strong-style workout notification for modules/android-shell/android-shell.js.
 *
 * `show({title, body, sub, look, workout, start, end, total})` posts one ongoing, silent notification:
 *  - workout view (`end` = 0): a chronometer counting up from `start` (the workout's elapsed time), the current
 *    exercise and set in `body`, the next exercise in `sub`, and "Complete set" / "Rest" buttons;
 *  - rest view (`end` > now): the chronometer counts down to `end` on its own, with "−15 s" / "+15 s" / "Skip".
 *    When the rest ends this plugin flips back to the workout view by itself (a Handler, so it works while the
 *    web view's timers are throttled in the background). With `workout` false (Quick log) the countdown clears
 *    itself through `setTimeoutAfter` instead.
 * The notification id (7002) differs from the "Rest is over" one AndroidShell schedules via LocalNotifications
 * (7001), so the end sound shows as its own dismissable notification and the workout one stays.
 * The buttons broadcast back to this plugin, which tells the web app ("skip", "adjust" {seconds}, "complete", "rest").
 * `look` (the logger's restNotify setting) picks the rest layout: big (default, time large on the right), clock
 * (time only), bar (time over a loading bar refreshed once a second while the process lives), plain (standard
 * notification, countdown in the header), endsAt (plain plus the clock time the rest ends).
 *
 * The rest-over sound (Nov 14 2026): `arm({end, sound, silent})` / `disarm()` set and clear the exact alarm that rings
 * at the rest's end with the phone locked, and `ring({sound, end, ms})` rings now from the in-app timer; both duck the
 * music (RestRing). `ring` with sound "custom" only ducks for `ms` while the web view plays the user's own file.
 *
 * Background buttons (Nov 16 2026): the web view does not run while the app is in the background, so a button that
 * only told the web app waited until the app was opened. Now the buttons act here first. `show` carries
 * `complete: {rest, sound, body, sub}` (what "Complete set" leads to, from the logger): pressing it switches the
 * notification to that rest at once, arms the rest-over ring, and queues {at, end} in SharedPreferences. −15 / +15 /
 * Skip move the native rest (and the queued end) the same way. The web app gets "complete" {queued: true} and on
 * that event, on resume and at start it calls `takePending()` to tick the set with those times, exactly once.
 * Registered in MainActivity before super.onCreate. The compiled copy lives next to MainActivity;
 * this file is the source of truth and modules/android-shell/android-shell.test.js checks they are identical.
 */
@CapacitorPlugin(name = "RestTimer")
class RestTimerPlugin : Plugin() {

    companion object {
        const val NOTIFICATION_ID = 7002
        const val CHANNEL_ID = "rest_live_v1"
        const val ACTION_SKIP = "com.azizfitness.app.REST_SKIP"
        const val ACTION_ADD = "com.azizfitness.app.REST_ADD"
        const val ACTION_COMPLETE = "com.azizfitness.app.WORKOUT_COMPLETE"
        const val ACTION_REST = "com.azizfitness.app.WORKOUT_REST"
        const val PREFS = "rest_timer"
        const val PENDING = "pending_complete"
    }

    /** What "Complete set" leads to: the rest after it (s, 0 = none) and the workout view's lines for the next set. */
    private data class After(val rest: Int, val sound: String, val body: String, val sub: String)

    private data class Shown(val title: String, val body: String, val sub: String, val look: String,
                             val workout: Boolean, val start: Long, val end: Long, val total: Int,
                             val name: String = "Workout", val sound: String = "restDone", val silent: Boolean = false,
                             val after: After? = null)

    private var receiver: BroadcastReceiver? = null
    private val handler = Handler(Looper.getMainLooper())
    private var tick: Runnable? = null
    private var current: Shown? = null

    override fun load() {
        val r = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                when (intent.action) {
                    ACTION_SKIP -> { skipNative(); notifyListeners("skip", JSObject()) }
                    ACTION_ADD -> { val d = intent.getIntExtra("seconds", 15); adjustNative(d); notifyListeners("adjust", JSObject().put("seconds", d)) }
                    ACTION_COMPLETE -> notifyListeners("complete", JSObject().put("queued", completeNative()))
                    ACTION_REST -> notifyListeners("rest", JSObject())
                }
            }
        }
        val filter = IntentFilter().apply { addAction(ACTION_SKIP); addAction(ACTION_ADD); addAction(ACTION_COMPLETE); addAction(ACTION_REST) }
        ContextCompat.registerReceiver(context, r, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        receiver = r
    }

    override fun handleOnResume() { RestRing.foreground = true }
    override fun handleOnPause() { RestRing.foreground = false }

    override fun handleOnDestroy() {
        stopTick()
        receiver?.let { try { context.unregisterReceiver(it) } catch (e: Exception) { } }
        receiver = null
    }

    private fun channel() {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val ch = NotificationChannel(CHANNEL_ID, "Workout and rest countdown", NotificationManager.IMPORTANCE_LOW)
        ch.description = "Shows the workout and the rest timer counting down"
        ch.setSound(null, null)
        ch.enableVibration(false)
        ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        nm.createNotificationChannel(ch)
    }

    private fun broadcast(action: String, code: Int, seconds: Int = 0): PendingIntent {
        val i = Intent(action).setPackage(context.packageName).putExtra("seconds", seconds)
        return PendingIntent.getBroadcast(context, code, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun prefs() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun pending(): JSONArray = try { JSONArray(prefs().getString(PENDING, "[]")) } catch (e: Exception) { JSONArray() }

    @Synchronized private fun queue(at: Long, end: Long) {
        val a = pending(); a.put(JSONObject().put("at", at).put("end", end))
        prefs().edit().putString(PENDING, a.toString()).apply()
    }

    /** −15 / +15 / Skip after a queued tick: the web app must start that rest with the moved end. */
    @Synchronized private fun moveQueuedEnd(oldEnd: Long, newEnd: Long) {
        val a = pending(); if (a.length() == 0) return
        val last = a.getJSONObject(a.length() - 1)
        if (last.optLong("end") != oldEnd) return
        last.put("end", newEnd)
        prefs().edit().putString(PENDING, a.toString()).apply()
    }

    /** Sets ticked from the notification that the web app has not applied yet, oldest first; clears the queue. */
    @PluginMethod
    @Synchronized
    fun takePending(call: PluginCall) {
        val a = pending()
        prefs().edit().remove(PENDING).apply()
        val out = JSArray()
        for (i in 0 until a.length()) out.put(a.getJSONObject(i))
        call.resolve(JSObject().put("items", out))
    }

    /** "Complete set": go straight to the rest (or the next set) here. False when the web app has to decide. */
    private fun completeNative(): Boolean {
        val cur = current ?: return false
        val a = cur.after ?: return false
        val now = System.currentTimeMillis()
        if (!cur.workout || cur.end > now) return false
        val end = if (a.rest >= 5) now + a.rest * 1000L else 0L
        queue(now, end)
        if (end > 0) {
            try { RestRing.arm(context, end, a.sound, cur.silent) } catch (e: Exception) { }
            display(cur.copy(title = "Rest timer", body = a.body, sub = a.sub, end = end, total = a.rest, sound = a.sound, after = null))
        } else {
            display(cur.copy(body = a.body, sub = a.sub, end = 0, total = 0, after = null))
        }
        return true
    }

    private fun adjustNative(d: Int) {
        val cur = current ?: return
        val now = System.currentTimeMillis()
        if (cur.end <= now) return
        val end = maxOf(now, cur.end + d * 1000L)
        if (end <= now) { skipNative(); return }
        val left = ((end - now + 999) / 1000).toInt()
        moveQueuedEnd(cur.end, end)
        try { RestRing.arm(context, end, cur.sound, cur.silent) } catch (e: Exception) { }
        display(cur.copy(end = end, total = maxOf(cur.total, left, 1)))
    }

    private fun skipNative() {
        val cur = current ?: return
        val now = System.currentTimeMillis()
        if (cur.end <= now) return
        moveQueuedEnd(cur.end, now)
        try { RestRing.disarm(context); RestRing.cancelOver(context) } catch (e: Exception) { }
        if (cur.workout) display(cur.copy(title = cur.name, end = 0, total = 0))
        else { stopTick(); current = null; NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID) }
    }

    @PluginMethod
    fun show(call: PluginCall) {
        val c = call.getObject("complete")
        val s = Shown(
            title = call.getString("title") ?: "Workout",
            body = call.getString("body") ?: "",
            sub = call.getString("sub") ?: "",
            look = call.getString("look") ?: "big",
            workout = call.getBoolean("workout") ?: false,
            start = call.getLong("start") ?: 0L,
            end = call.getLong("end") ?: 0L,
            total = (call.getInt("total") ?: 0).coerceAtLeast(0),
            name = call.getString("name") ?: "Workout",
            sound = call.getString("sound") ?: "restDone",
            silent = call.getBoolean("silent") ?: false,
            after = if (c == null) null else After(
                rest = c.optInt("rest", 0), sound = c.optString("sound", "restDone"),
                body = c.optString("body", ""), sub = c.optString("sub", "")
            )
        )
        val now = System.currentTimeMillis()
        if (!s.workout && s.end <= now) { stop(call); return }
        call.resolve(JSObject().put("shown", display(s)))
    }

    /** Posts `s` and keeps it current: the bar look ticks, and a rest flips back to the workout view at its end. */
    private fun display(s: Shown): Boolean {
        stopTick()
        val now = System.currentTimeMillis()
        channel()
        current = s
        val shown = post(s)
        if (shown && s.end > now) {
            // Keep the bar look moving, and flip to the workout view (or let the timeout clear a bare rest) at the end.
            val t = object : Runnable {
                override fun run() {
                    val cur = current ?: return
                    if (cur.end <= System.currentTimeMillis()) {
                        tick = null
                        if (cur.workout) { current = cur.copy(end = 0, total = 0, title = if (cur.title == "Rest timer") cur.name else cur.title); post(current!!) }
                        return
                    }
                    if (cur.look == "bar") post(cur)
                    handler.postDelayed(this, 1000)
                }
            }
            tick = t
            handler.postDelayed(t, 1000)
        }
        return shown
    }

    /** Older name kept for the web side: a bare rest countdown. */
    @PluginMethod
    fun start(call: PluginCall) = show(call)

    private fun stopTick() {
        tick?.let { handler.removeCallbacks(it) }
        tick = null
    }

    private fun text(title: String, body: String, sub: String): String =
        listOf(body, sub).filter { it.isNotBlank() }.joinToString(" · ").ifBlank { title }

    /** Builds and posts the notification in its current state. Returns false when notifications are not allowed. */
    private fun post(s: Shown): Boolean {
        val now = System.currentTimeMillis()
        val resting = s.end > now
        val leftMs = s.end - now
        // Chronometer bases are on the elapsed-realtime clock, so shift the wall-clock times over.
        val base = if (resting) SystemClock.elapsedRealtime() + leftMs
                   else SystemClock.elapsedRealtime() - (now - (if (s.start > 0) s.start else now))

        val open = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val openPi = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val line = text(s.title, s.body, s.sub)

        val b = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(s.title)
            .setContentText(line)
            .setUsesChronometer(true)
            .setChronometerCountDown(resting)
            .setWhen(if (resting) s.end else (if (s.start > 0) s.start else now))
            .setShowWhen(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openPi)
        if (resting) {
            b.addAction(0, "−15 s", broadcast(ACTION_ADD, 3, -15))
             .addAction(0, "+15 s", broadcast(ACTION_ADD, 1, 15))
             .addAction(0, "Skip", broadcast(ACTION_SKIP, 2))
            if (!s.workout) b.setTimeoutAfter(leftMs + 2000)
        } else {
            b.addAction(0, "Complete set", broadcast(ACTION_COMPLETE, 4))
             .addAction(0, "Rest", broadcast(ACTION_REST, 5))
        }

        val look = if (resting) s.look else (if (s.look == "plain" || s.look == "endsAt") "plain" else "big")
        when (look) {
            "plain" -> { }
            "endsAt" -> {
                val at = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(s.end))
                b.setContentText("Ends at $at")
                b.setStyle(NotificationCompat.BigTextStyle().bigText("Ends at $at · $line"))
            }
            "clock" -> {
                val v = RemoteViews(context.packageName, R.layout.notification_rest_clock)
                v.setChronometerCountDown(R.id.rest_clock, true)
                v.setChronometer(R.id.rest_clock, base, null, true)
                b.setStyle(NotificationCompat.DecoratedCustomViewStyle()).setCustomContentView(v).setCustomBigContentView(v)
            }
            "bar" -> {
                val v = RemoteViews(context.packageName, R.layout.notification_rest_bar)
                v.setTextViewText(R.id.rest_title, line)
                v.setChronometerCountDown(R.id.rest_clock, true)
                v.setChronometer(R.id.rest_clock, base, null, true)
                val totalMs = if (s.total > 0) s.total * 1000L else leftMs
                val frac = (leftMs.toDouble() / totalMs).coerceIn(0.0, 1.0)
                v.setProgressBar(R.id.rest_bar, 1000, (frac * 1000).toInt(), false)
                b.setStyle(NotificationCompat.DecoratedCustomViewStyle()).setCustomContentView(v).setCustomBigContentView(v)
            }
            else -> {
                val v = RemoteViews(context.packageName, R.layout.notification_rest)
                v.setTextViewText(R.id.rest_title, if (resting) s.title else (if (s.body.isNotBlank()) s.body else s.title))
                v.setTextViewText(R.id.rest_body, if (resting) line else (if (s.sub.isNotBlank()) s.sub else s.title))
                v.setChronometerCountDown(R.id.rest_clock, resting)
                v.setChronometer(R.id.rest_clock, base, null, true)
                b.setStyle(NotificationCompat.DecoratedCustomViewStyle()).setCustomContentView(v).setCustomBigContentView(v)
            }
        }
        return try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, b.build())
            true
        } catch (e: SecurityException) {
            false
        }
    }

    /** Rings at `end` even if the web view is asleep (exact alarm). Resolves {mode: "exact" | "inexact"}. */
    @PluginMethod
    fun arm(call: PluginCall) {
        val end = call.getLong("end") ?: 0L
        if (end <= System.currentTimeMillis()) { call.resolve(JSObject().put("mode", "none")); return }
        val mode = RestRing.arm(context, end, call.getString("sound") ?: "restDone", call.getBoolean("silent") ?: false)
        call.resolve(JSObject().put("mode", mode))
    }

    /** A skipped or cancelled rest: no alarm, and no "Rest is over" left on screen. */
    @PluginMethod
    fun disarm(call: PluginCall) {
        RestRing.disarm(context)
        RestRing.cancelOver(context)
        call.resolve()
    }

    /** The in-app timer reached 0 (or a Settings preview, end 0): ring now with the music ducked, once per rest. */
    @PluginMethod
    fun ring(call: PluginCall) {
        val end = call.getLong("end") ?: 0L
        val sound = call.getString("sound") ?: "restDone"
        if (!RestRing.claim(end)) { call.resolve(JSObject().put("played", false).put("again", true)); return }
        if (end > 0 && end == RestRing.armedEnd) RestRing.disarm(context)
        if (end > 0 && !RestRing.foreground) RestRing.postOver(context)
        if (sound == "custom") {
            RestRing.duck(context, (call.getInt("ms") ?: 3000).toLong())
            call.resolve(JSObject().put("played", false).put("ducked", true))
            return
        }
        val played = RestRing.play(context, sound)
        call.resolve(JSObject().put("played", played))
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        stopTick()
        current = null
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
        call.resolve()
    }
}
