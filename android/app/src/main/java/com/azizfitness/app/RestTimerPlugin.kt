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
import java.text.DateFormat
import java.util.Date
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Live rest countdown in the notification shade, Strong-style (modules/android-shell/android-shell.js).
 *
 * `start({end, total, title, body, look})` posts an ongoing, silent notification whose Chronometer counts down to
 * `end` (a Unix ms time) on its own, so it keeps ticking with the app in the background or the screen locked
 * without any updates from the web view. It uses the same notification id (7001) as the "Rest is over"
 * notification that AndroidShell schedules through LocalNotifications, so that one replaces the countdown
 * and rings when the rest ends; `setTimeoutAfter` clears the countdown on its own if that never arrives.
 * Its Skip and +15 s buttons broadcast back to this plugin, which tells the web app ("skip" / "adjust").
 * `look` (the logger's restNotify setting) picks the layout: big (default, time large on the right), clock (time
 * only), bar (time over a loading bar, which this plugin refreshes once a second while the process lives),
 * plain (standard notification, countdown in the header), endsAt (plain plus the clock time the rest ends).
 *
 * Registered in MainActivity before super.onCreate. The compiled copy lives next to MainActivity;
 * this file is the source of truth and modules/android-shell/android-shell.test.js checks they are identical.
 */
@CapacitorPlugin(name = "RestTimer")
class RestTimerPlugin : Plugin() {

    companion object {
        const val NOTIFICATION_ID = 7001
        const val CHANNEL_ID = "rest_live_v1"
        const val ACTION_SKIP = "com.azizfitness.app.REST_SKIP"
        const val ACTION_ADD = "com.azizfitness.app.REST_ADD"
    }

    private var receiver: BroadcastReceiver? = null
    private val handler = Handler(Looper.getMainLooper())
    private var barTick: Runnable? = null

    override fun load() {
        val r = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                when (intent.action) {
                    ACTION_SKIP -> {
                        stopBar()
                        NotificationManagerCompat.from(ctx).cancel(NOTIFICATION_ID)
                        notifyListeners("skip", JSObject())
                    }
                    ACTION_ADD -> notifyListeners("adjust", JSObject().put("seconds", intent.getIntExtra("seconds", 15)))
                }
            }
        }
        val filter = IntentFilter().apply { addAction(ACTION_SKIP); addAction(ACTION_ADD) }
        ContextCompat.registerReceiver(context, r, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        receiver = r
    }

    override fun handleOnDestroy() {
        stopBar()
        receiver?.let { try { context.unregisterReceiver(it) } catch (e: Exception) { } }
        receiver = null
    }

    private fun channel() {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val ch = NotificationChannel(CHANNEL_ID, "Rest countdown", NotificationManager.IMPORTANCE_LOW)
        ch.description = "Shows the rest timer counting down"
        ch.setSound(null, null)
        ch.enableVibration(false)
        ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        nm.createNotificationChannel(ch)
    }

    private fun broadcast(action: String, code: Int, seconds: Int = 0): PendingIntent {
        val i = Intent(action).setPackage(context.packageName).putExtra("seconds", seconds)
        return PendingIntent.getBroadcast(context, code, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    @PluginMethod
    fun start(call: PluginCall) {
        val end = call.getLong("end") ?: return call.reject("end (ms) is required")
        val total = (call.getInt("total") ?: 0).coerceAtLeast(0)
        val title = call.getString("title") ?: "Rest"
        val body = call.getString("body") ?: "Next set when it hits 0:00"
        val look = call.getString("look") ?: "big"
        stopBar()
        if (end - System.currentTimeMillis() <= 0) { stop(call); return }
        channel()
        val shown = post(end, total, title, body, look)
        if (shown && look == "bar") {
            val tick = object : Runnable {
                override fun run() {
                    if (end - System.currentTimeMillis() <= 0) { barTick = null; return }
                    post(end, total, title, body, look)
                    handler.postDelayed(this, 1000)
                }
            }
            barTick = tick
            handler.postDelayed(tick, 1000)
        }
        call.resolve(JSObject().put("shown", shown))
    }

    private fun stopBar() {
        barTick?.let { handler.removeCallbacks(it) }
        barTick = null
    }

    /** Builds and posts the countdown in the chosen look. Returns false when notifications are not allowed. */
    private fun post(end: Long, total: Int, title: String, body: String, look: String): Boolean {
        val now = System.currentTimeMillis()
        val leftMs = end - now
        if (leftMs <= 0) return false
        // Chronometer bases are on the elapsed-realtime clock, so shift the wall-clock end over.
        val base = SystemClock.elapsedRealtime() + leftMs

        val open = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val openPi = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val b = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(title)
            .setContentText(body)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setWhen(end)
            .setShowWhen(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openPi)
            .setTimeoutAfter(leftMs + 2000)
            .addAction(0, "+15 s", broadcast(ACTION_ADD, 1, 15))
            .addAction(0, "Skip", broadcast(ACTION_SKIP, 2))

        when (look) {
            "plain" -> { }
            "endsAt" -> {
                val at = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(end))
                b.setContentText("Ends at $at")
                b.setStyle(NotificationCompat.BigTextStyle().bigText("Ends at $at · $body"))
            }
            "clock" -> {
                val v = RemoteViews(context.packageName, R.layout.notification_rest_clock)
                v.setChronometerCountDown(R.id.rest_clock, true)
                v.setChronometer(R.id.rest_clock, base, null, true)
                b.setStyle(NotificationCompat.DecoratedCustomViewStyle()).setCustomContentView(v).setCustomBigContentView(v)
            }
            "bar" -> {
                val v = RemoteViews(context.packageName, R.layout.notification_rest_bar)
                v.setTextViewText(R.id.rest_title, title)
                v.setChronometerCountDown(R.id.rest_clock, true)
                v.setChronometer(R.id.rest_clock, base, null, true)
                val totalMs = if (total > 0) total * 1000L else leftMs
                val frac = (leftMs.toDouble() / totalMs).coerceIn(0.0, 1.0)
                v.setProgressBar(R.id.rest_bar, 1000, (frac * 1000).toInt(), false)
                b.setStyle(NotificationCompat.DecoratedCustomViewStyle()).setCustomContentView(v).setCustomBigContentView(v)
            }
            else -> {
                val v = RemoteViews(context.packageName, R.layout.notification_rest)
                v.setTextViewText(R.id.rest_title, title)
                v.setTextViewText(R.id.rest_body, body)
                v.setChronometerCountDown(R.id.rest_clock, true)
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

    @PluginMethod
    fun stop(call: PluginCall) {
        stopBar()
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
        call.resolve()
    }
}
