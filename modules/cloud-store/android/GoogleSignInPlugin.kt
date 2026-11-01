package com.azizfitness.app

import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * "Continue with Google" for the sign-in sheet (modules/cloud-store/cloud-store.js).
 * Shows Android's own Google account chooser (Credential Manager) and returns a Google ID token, which
 * the web side hands to Firebase Auth (signInWithCredential), so a person who signs in with Google gets
 * the same Firebase account and Firestore data as with email. No client secret in the APK: Google
 * matches the app by package name + signing-key SHA-1 against the Android OAuth client of the Firebase
 * project, and the Web client ID comes from app/cloud-config.js (googleClientId).
 *
 * Source of truth: modules/cloud-store/android/GoogleSignInPlugin.kt. The compiled copy lives next to
 * MainActivity (registered there); modules/cloud-store/cloud-store.test.js checks they match.
 */
@CapacitorPlugin(name = "GoogleSignIn")
class GoogleSignInPlugin : Plugin() {

    private val scope = CoroutineScope(Dispatchers.Main)

    /** signIn({clientId}) → {idToken, email?, name?}. Rejects with code cancelled | no-account | not-set-up | failed. */
    @PluginMethod
    fun signIn(call: PluginCall) {
        val clientId = call.getString("clientId")?.trim().orEmpty()
        if (clientId.isEmpty()) {
            call.reject("missing clientId", "not-set-up")
            return
        }
        val activity = bridge.activity
        val option = GetSignInWithGoogleOption.Builder(clientId).build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        val manager = CredentialManager.create(activity)
        scope.launch {
            try {
                val cred = manager.getCredential(activity, request).credential
                if (cred is CustomCredential && cred.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                    val g = GoogleIdTokenCredential.createFrom(cred.data)
                    call.resolve(JSObject().put("idToken", g.idToken).put("email", g.id).put("name", g.displayName))
                } else {
                    call.reject("unexpected credential type", "failed")
                }
            } catch (e: GetCredentialCancellationException) {
                call.reject("cancelled", "cancelled")
            } catch (e: NoCredentialException) {
                call.reject(e.message ?: "no Google account on this phone", "no-account")
            } catch (e: GetCredentialException) {
                // Typically "Developer console is not set up correctly" = SHA-1 / OAuth client missing.
                call.reject(e.message ?: "sign-in failed", "failed")
            } catch (e: Exception) {
                call.reject(e.message ?: "sign-in failed", "failed")
            }
        }
    }
}
