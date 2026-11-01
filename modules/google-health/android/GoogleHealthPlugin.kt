package com.azizfitness.app

import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Google Health (Fitbit) water log reader for the Water card (modules/google-health/google-health.js).
 * Read-only: one scope (googlehealth.nutrition.readonly). Sign-in uses Google Play services'
 * AuthorizationClient, so the APK holds no client secret: Google matches the app by package name +
 * signing-key SHA-1 against the Android OAuth client in Aziz's Google Cloud project.
 * HTTP goes only to https://health.googleapis.com/v4/users/me/dataTypes/<type>/dataPoints.
 *
 * Source of truth: modules/google-health/android/GoogleHealthPlugin.kt. The compiled copy lives next to
 * MainActivity (registered there); modules/google-health/google-health.test.js checks they match.
 */
@CapacitorPlugin(name = "GoogleHealth")
class GoogleHealthPlugin : Plugin() {

    private val scope = CoroutineScope(Dispatchers.IO)
    private val scopes = listOf(Scope("https://www.googleapis.com/auth/googlehealth.nutrition.readonly"))
    private var consentLauncher: ActivityResultLauncher<IntentSenderRequest>? = null
    private var pendingCall: PluginCall? = null

    override fun load() {
        consentLauncher = bridge.activity.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { ar ->
            val call = pendingCall
            pendingCall = null
            if (call == null) return@registerForActivityResult
            try {
                val res = Identity.getAuthorizationClient(bridge.activity).getAuthorizationResultFromIntent(ar.data)
                val token = res.accessToken
                call.resolve(JSObject().put("granted", token != null).put("token", token))
            } catch (e: Exception) {
                call.resolve(JSObject().put("granted", false).put("error", e.message ?: "cancelled"))
            }
        }
    }

    /** authorize({interactive}) → {granted, token?}. interactive:false never shows UI. */
    @PluginMethod
    fun authorize(call: PluginCall) {
        val interactive = call.getBoolean("interactive", false) ?: false
        val request = AuthorizationRequest.builder().setRequestedScopes(scopes).build()
        Identity.getAuthorizationClient(bridge.activity).authorize(request)
            .addOnSuccessListener { result ->
                if (result.hasResolution()) {
                    val pi = result.pendingIntent
                    val launcher = consentLauncher
                    if (!interactive || pi == null || launcher == null) {
                        call.resolve(JSObject().put("granted", false).put("needsConsent", true))
                    } else {
                        pendingCall = call
                        launcher.launch(IntentSenderRequest.Builder(pi.intentSender).build())
                    }
                } else {
                    val token = result.accessToken
                    call.resolve(JSObject().put("granted", token != null).put("token", token))
                }
            }
            .addOnFailureListener { e -> call.reject(e.message ?: "authorize failed") }
    }

    /** get({path, query, token}) → {status, body}. Only Google Health dataPoints paths are allowed. */
    @PluginMethod
    fun get(call: PluginCall) {
        val path = call.getString("path") ?: ""
        val token = call.getString("token") ?: return call.reject("missing token")
        if (!Regex("^v4/users/me/dataTypes/[a-z-]+/dataPoints$").matches(path)) return call.reject("path not allowed")
        val query = call.getObject("query") ?: JSObject()
        val qs = query.keys().asSequence().joinToString("&") { k ->
            URLEncoder.encode(k, "UTF-8") + "=" + URLEncoder.encode(query.optString(k), "UTF-8")
        }
        scope.launch {
            var conn: HttpURLConnection? = null
            try {
                conn = URL("https://health.googleapis.com/$path" + (if (qs.isEmpty()) "" else "?$qs")).openConnection() as HttpURLConnection
                conn.requestMethod = "GET"
                conn.connectTimeout = 15000
                conn.readTimeout = 20000
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.setRequestProperty("Accept", "application/json")
                val status = conn.responseCode
                val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
                call.resolve(JSObject().put("status", status).put("body", body))
            } catch (e: Exception) {
                // status 0 = no connection; the JS side waits and retries later
                call.resolve(JSObject().put("status", 0).put("body", e.message ?: "network error"))
            } finally {
                conn?.disconnect()
            }
        }
    }
}
