package com.azizfitness.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.SystemClock
import android.widget.RemoteViews
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
 * `start({end, total, title, body})` posts an ongoing, silent notification whose Chronometer counts down to
 * `end` (a Unix ms time) on its own, so it keeps ticking with the app in the background or the screen locked
 * without any updates from the web view. It uses the same notification id (7001) as the "Rest is over"
 * notification that AndroidShell schedules through LocalNotifications, so that one replaces the countdown
 * and rings when the rest ends; `setTimeoutAfter` clears the countdown on its own if that never arrives.
 * Its Skip and +15 s buttons broadcast back to this plugin, which tells the web app ("skip" / "adjust").
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

    override fun load() {
        val r = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                when (intent.action) {
                    ACTION_SKIP -> {
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
        val title = call.getString("title") ?: "Rest"
        val body = call.getString("body") ?: "Next set when it hits 0:00"
        val now = System.currentTimeMillis()
        val leftMs = end - now
        if (leftMs <= 0) { stop(call); return }
        channel()

        // Chronometer bases are on the elapsed-realtime clock, so shift the wall-clock end over.
        val base = SystemClock.elapsedRealtime() + leftMs
        val views = RemoteViews(context.packageName, R.layout.notification_rest)
        views.setTextViewText(R.id.rest_title, title)
        views.setTextViewText(R.id.rest_body, body)
        views.setChronometerCountDown(R.id.rest_clock, true)
        views.setChronometer(R.id.rest_clock, base, null, true)

        val open = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val openPi = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val n = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(views)
            .setCustomBigContentView(views)
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
            .build()
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, n)
            call.resolve(JSObject().put("shown", true))
        } catch (e: SecurityException) {
            call.resolve(JSObject().put("shown", false))
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
        call.resolve()
    }
}
