package com.azizfitness.app

import android.Manifest
import android.content.Intent
import android.location.LocationManager
import android.content.Context
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONArray
import org.json.JSONObject

/**
 * Web side of RunGpsService (see that file). Used by modules/run-tracker/run-tracker.js on Android only.
 *   start({startAt})        -> asks for location if needed, clears the last run's fixes, starts the service
 *   read({since})           -> {fixes:[[lat, lng, alt|null, acc, timeMs]...], next, running, paused, gpsOff}
 *   pause({at}) / resume({pausedTotal})
 *   status()                -> {running, startAt, paused, pausedAt, pausedTotal, count}
 *   stop()                  -> stops the service (the fixes stay until the next start)
 * Registered in MainActivity before super.onCreate.
 */
@CapacitorPlugin(
    name = "RunGps",
    permissions = [Permission(alias = "location", strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION])]
)
class RunGpsPlugin : Plugin() {
    private fun prefs() = RunGpsService.prefs(context)

    @PluginMethod
    fun start(call: PluginCall) {
        if (getPermissionState("location") != PermissionState.GRANTED) { requestPermissionForAlias("location", call, "permDone"); return }
        begin(call)
    }

    @PermissionCallback
    private fun permDone(call: PluginCall) {
        if (getPermissionState("location") == PermissionState.GRANTED) begin(call)
        else call.reject("Location blocked. Allow Location for Mizan in Android Settings › Apps › Mizan › Permissions.", "denied")
    }

    private fun begin(call: PluginCall) {
        val startAt = call.getLong("startAt") ?: System.currentTimeMillis()
        RunGpsService.clear(context)
        prefs().edit().putBoolean("running", true).putLong("startAt", startAt).putBoolean("paused", false)
            .putLong("pausedAt", 0).putLong("pausedTotal", 0).apply()
        try {
            ContextCompat.startForegroundService(context, Intent(context, RunGpsService::class.java))
        } catch (e: Exception) {
            prefs().edit().putBoolean("running", false).apply()
            call.reject("Couldn't start background GPS: " + e.message, "start"); return
        }
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        call.resolve(JSObject().put("started", true).put("gpsOff", !lm.isProviderEnabled(LocationManager.GPS_PROVIDER)))
    }

    @PluginMethod
    fun read(call: PluginCall) {
        val since = (call.getInt("since") ?: 0).coerceAtLeast(0)
        val out = JSArray()
        val snapshot = RunGpsService.slice(context, since)
        for (f in snapshot) {
            val a = JSONArray()
            a.put(f[0]); a.put(f[1]); if (f[2].isNaN()) a.put(JSONObject.NULL) else a.put(f[2]); a.put(f[3]); a.put(f[4].toLong())
            out.put(a)
        }
        val p = prefs()
        call.resolve(JSObject().put("fixes", out).put("next", since + snapshot.size).put("running", p.getBoolean("running", false))
            .put("paused", p.getBoolean("paused", false)).put("gpsOff", RunGpsService.gpsOff))
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        prefs().edit().putBoolean("paused", true).putLong("pausedAt", call.getLong("at") ?: System.currentTimeMillis()).apply()
        refresh(); call.resolve()
    }

    @PluginMethod
    fun resume(call: PluginCall) {
        prefs().edit().putBoolean("paused", false).putLong("pausedTotal", call.getLong("pausedTotal") ?: 0L).apply()
        refresh(); call.resolve()
    }

    @PluginMethod
    fun status(call: PluginCall) {
        val p = prefs()
        refresh() // the app is open now: make sure the service runs if Android stopped it while the app was away
        call.resolve(JSObject().put("running", p.getBoolean("running", false)).put("startAt", p.getLong("startAt", 0))
            .put("paused", p.getBoolean("paused", false)).put("pausedAt", p.getLong("pausedAt", 0))
            .put("pausedTotal", p.getLong("pausedTotal", 0)).put("count", RunGpsService.all(context).size))
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        prefs().edit().putBoolean("running", false).apply()
        context.stopService(Intent(context, RunGpsService::class.java))
        call.resolve()
    }

    /** Re-posts the notification (paused / recording) through the running service. */
    private fun refresh() {
        if (!prefs().getBoolean("running", false)) return
        try { ContextCompat.startForegroundService(context, Intent(context, RunGpsService::class.java)) } catch (_: Exception) {}
    }
}
