package com.azizfitness.app

import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HydrationRecord
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Health Connect bridge for the Water card (modules/health-connect/health-connect.js).
 * Read-only: one permission (READ_HYDRATION), no writes, no network.
 *
 * Registered in android/app/src/main/java/com/azizfitness/app/MainActivity.java (before super.onCreate).
 * The copy that is compiled lives next to MainActivity; this file is its source of truth and
 * modules/health-connect/health-connect.test.js checks the two are identical.
 *
 * See README.md next to this file for the manifest entries and the Gradle dependency.
 */
@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {

    private val scope = CoroutineScope(Dispatchers.IO)
    private val permissions = setOf(HealthPermission.getReadPermission(HydrationRecord::class))
    private var permissionLauncher: ActivityResultLauncher<Set<String>>? = null
    private var pendingPermissionCall: PluginCall? = null

    override fun load() {
        // The permission sheet is an activity result; register it once the activity exists.
        val contract = PermissionController.createRequestPermissionResultContract()
        permissionLauncher = bridge.activity.registerForActivityResult(contract) { granted ->
            val call = pendingPermissionCall
            pendingPermissionCall = null
            call?.resolve(JSObject().put("granted", granted.containsAll(permissions)))
        }
    }

    private fun client(): HealthConnectClient? =
        if (HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE)
            HealthConnectClient.getOrCreate(context) else null

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val status = when (HealthConnectClient.getSdkStatus(context)) {
            HealthConnectClient.SDK_AVAILABLE -> "available"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "not_installed"
            else -> "not_supported"
        }
        call.resolve(JSObject().put("status", status))
    }

    // Not named checkPermissions/requestPermissions: Capacitor's Plugin base class already has those.
    @PluginMethod
    fun hasHydrationAccess(call: PluginCall) {
        val c = client() ?: return call.resolve(JSObject().put("granted", false))
        scope.launch {
            try {
                val granted = c.permissionController.getGrantedPermissions()
                call.resolve(JSObject().put("granted", granted.containsAll(permissions)))
            } catch (e: Exception) { call.reject(e.message ?: "hasHydrationAccess failed") }
        }
    }

    @PluginMethod
    fun requestHydrationAccess(call: PluginCall) {
        val c = client() ?: return call.resolve(JSObject().put("granted", false))
        scope.launch {
            try {
                if (c.permissionController.getGrantedPermissions().containsAll(permissions)) {
                    call.resolve(JSObject().put("granted", true)); return@launch
                }
                val launcher = permissionLauncher
                if (launcher == null) { call.reject("permission launcher not ready"); return@launch }
                pendingPermissionCall = call
                bridge.activity.runOnUiThread { launcher.launch(permissions) }
            } catch (e: Exception) { call.reject(e.message ?: "requestHydrationAccess failed") }
        }
    }

    private fun recordJson(r: HydrationRecord): JSObject = JSObject()
        .put("id", r.metadata.id)
        .put("startMs", r.startTime.toEpochMilli())
        .put("endMs", r.endTime.toEpochMilli())
        .put("ml", r.volume.inMilliliters)
        .put("origin", r.metadata.dataOrigin.packageName)
        .put("lastModifiedMs", r.metadata.lastModifiedTime.toEpochMilli())
        .put("clientRecordId", r.metadata.clientRecordId)
        .put("startOffsetSec", r.startZoneOffset?.totalSeconds)

    /** readHydration({startMs, endMs}) → {records:[...]}, paging through every record in the range. */
    @PluginMethod
    fun readHydration(call: PluginCall) {
        val c = client() ?: return call.reject("Health Connect unavailable")
        val start = Instant.ofEpochMilli(call.getLong("startMs") ?: 0L)
        val end = Instant.ofEpochMilli(call.getLong("endMs") ?: System.currentTimeMillis())
        scope.launch {
            try {
                val out = JSArray()
                var pageToken: String? = null
                do {
                    val res = c.readRecords(
                        ReadRecordsRequest(HydrationRecord::class, TimeRangeFilter.between(start, end), pageSize = 1000, pageToken = pageToken)
                    )
                    res.records.forEach { out.put(recordJson(it)) }
                    pageToken = res.pageToken
                } while (pageToken != null)
                call.resolve(JSObject().put("records", out))
            } catch (e: SecurityException) { call.reject("permission denied: ${e.message}")
            } catch (e: Exception) { call.reject(e.message ?: "readHydration failed") }
        }
    }

    /** getChangesToken() → {token}: one token, hydration only, so a DeletionChange is always a hydration record. */
    @PluginMethod
    fun getChangesToken(call: PluginCall) {
        val c = client() ?: return call.reject("Health Connect unavailable")
        scope.launch {
            try {
                val token = c.getChangesToken(ChangesTokenRequest(setOf(HydrationRecord::class)))
                call.resolve(JSObject().put("token", token))
            } catch (e: Exception) { call.reject(e.message ?: "getChangesToken failed") }
        }
    }

    /** getChanges({token}) → {changes:[{type:"upsert",record}|{type:"delete",id}], nextToken, hasMore, expired}. */
    @PluginMethod
    fun getChanges(call: PluginCall) {
        val c = client() ?: return call.reject("Health Connect unavailable")
        val token = call.getString("token") ?: return call.resolve(JSObject().put("expired", true).put("changes", JSArray()).put("hasMore", false))
        scope.launch {
            try {
                val res = c.getChanges(token)
                if (res.changesTokenExpired) {
                    call.resolve(JSObject().put("expired", true).put("changes", JSArray()).put("hasMore", false)); return@launch
                }
                val arr = JSArray()
                res.changes.forEach { ch ->
                    when (ch) {
                        is UpsertionChange -> (ch.record as? HydrationRecord)?.let { arr.put(JSObject().put("type", "upsert").put("record", recordJson(it))) }
                        is DeletionChange -> arr.put(JSObject().put("type", "delete").put("id", ch.recordId))
                    }
                }
                call.resolve(JSObject().put("changes", arr).put("nextToken", res.nextChangesToken).put("hasMore", res.hasMore).put("expired", false))
            } catch (e: SecurityException) { call.reject("permission denied: ${e.message}")
            } catch (e: Exception) { call.reject(e.message ?: "getChanges failed") }
        }
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        try {
            val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
            val activity = bridge.activity
            if (intent.resolveActivity(activity.packageManager) != null) activity.startActivity(intent)
            else activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.apps.healthdata")))
            call.resolve()
        } catch (e: Exception) { call.reject(e.message ?: "openSettings failed") }
    }
}
