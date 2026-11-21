package com.azizfitness.app

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import java.io.File

/**
 * Outdoor-run GPS that keeps recording with the screen locked (modules/run-tracker, Nov 21 2026).
 *
 * The web view's navigator.geolocation stops as soon as the app goes to the background, so a run lost every
 * metre covered while the phone was locked. This foreground service (type "location", started while the app is
 * open, so no background-location permission is needed) listens to the GPS once a second and appends each fix
 * to filesDir/run_gps.csv ("lat,lng,alt,acc,timeMs"). The web app reads the fixes with RunGps.read({since})
 * whenever it runs and filters them itself (RunTracker.accept), so nothing depends on the web view being awake.
 * State (running, startAt, paused, pausedTotal) lives in SharedPreferences "run_gps", so a run survives the web
 * view or the whole process being restarted (START_STICKY + RunTracker.recover). An ongoing, silent notification
 * with a chronometer shows while it records; tapping it opens Mizan.
 * Source of truth: modules/run-tracker/android/; the copy next to MainActivity must be identical (a test checks).
 */
class RunGpsService : Service(), LocationListener {
    companion object {
        const val CHANNEL = "run_gps_v1"
        const val NOTIF_ID = 7010
        const val PREFS = "run_gps"
        private val lock = Any()
        private var fixes: ArrayList<DoubleArray>? = null
        @Volatile var gpsOff = false

        fun file(ctx: Context) = File(ctx.filesDir, "run_gps.csv")
        fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        /** All fixes of the current run (loaded from the file once after a process restart). */
        fun all(ctx: Context): ArrayList<DoubleArray> = synchronized(lock) {
            fixes ?: ArrayList<DoubleArray>().also { list ->
                val f = file(ctx)
                if (f.exists()) f.forEachLine { line ->
                    val p = line.split(",")
                    if (p.size >= 5) try {
                        list.add(doubleArrayOf(p[0].toDouble(), p[1].toDouble(), p[2].toDoubleOrNull() ?: Double.NaN, p[3].toDouble(), p[4].toDouble()))
                    } catch (_: NumberFormatException) {}
                }
                fixes = list
            }
        }

        fun slice(ctx: Context, from: Int): List<DoubleArray> = synchronized(lock) {
            val a = all(ctx)
            if (from < a.size) ArrayList(a.subList(from, a.size)) else ArrayList()
        }

        fun clear(ctx: Context) = synchronized(lock) { fixes = ArrayList(); file(ctx).delete() }

        fun add(ctx: Context, fix: DoubleArray) = synchronized(lock) {
            all(ctx).add(fix)
            val alt = if (fix[2].isNaN()) "" else fix[2].toString()
            try { file(ctx).appendText("${fix[0]},${fix[1]},$alt,${fix[3]},${fix[4].toLong()}\n") } catch (_: Exception) {}
        }
    }

    private var wake: PowerManager.WakeLock? = null
    private var listening = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val p = prefs(this)
        if (!p.getBoolean("running", false)) { stopSelf(); return START_NOT_STICKY }
        try {
            startForegroundCompat(notification(p.getLong("startAt", System.currentTimeMillis()) + p.getLong("pausedTotal", 0), p.getBoolean("paused", false)))
        } catch (e: Exception) {
            // Android may refuse a location service restarted from the background; the run state stays, and
            // RunGps.status() starts the service again the next time Mizan is opened.
            stopSelf(); return START_NOT_STICKY
        }
        listen()
        return START_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun listen() {
        if (listening) return
        val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        try {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper())
            listening = true
            gpsOff = !lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
        } catch (e: SecurityException) { gpsOff = true } catch (e: IllegalArgumentException) { gpsOff = true }
        if (wake == null) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mizan:run-gps").apply { setReferenceCounted(false); acquire(6 * 3600 * 1000L) }
        }
    }

    override fun onLocationChanged(loc: Location) {
        gpsOff = false
        if (prefs(this).getBoolean("paused", false)) return
        add(this, doubleArrayOf(loc.latitude, loc.longitude, if (loc.hasAltitude()) loc.altitude else Double.NaN,
            if (loc.hasAccuracy()) loc.accuracy.toDouble() else 99.0, loc.time.toDouble()))
    }

    override fun onProviderEnabled(provider: String) { gpsOff = false }
    override fun onProviderDisabled(provider: String) { gpsOff = true }
    @Deprecated("Deprecated in Java") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

    override fun onDestroy() {
        try { (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(this) } catch (_: Exception) {}
        listening = false
        try { wake?.release() } catch (_: Exception) {}
        wake = null
        super.onDestroy()
    }

    private fun startForegroundCompat(n: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        else startForeground(NOTIF_ID, n)
    }

    private fun notification(since: Long, paused: Boolean): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            val ch = NotificationChannel(CHANNEL, "Outdoor run GPS", NotificationManager.IMPORTANCE_LOW)
            ch.description = "Shows while Mizan records an outdoor run, so the GPS keeps working with the screen locked"
            ch.setSound(null, null); ch.enableVibration(false)
            nm.createNotificationChannel(ch)
        }
        val open = packageManager.getLaunchIntentForPackage(packageName) ?: Intent(this, MainActivity::class.java)
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pi = PendingIntent.getActivity(this, 10, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(if (paused) "Run paused" else "Recording your run")
            .setContentText("GPS keeps going with the screen locked. Tap to open Mizan.")
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setWhen(since).setShowWhen(true).setUsesChronometer(!paused)
            .setContentIntent(pi)
            .build()
    }
}
