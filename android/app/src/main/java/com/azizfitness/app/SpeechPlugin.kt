package com.azizfitness.app

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Native speech-to-text for modules/voice-log/voice-log.js ("Log by voice", "Say what you ate").
 *
 * The WebView's SpeechRecognition can't reach the microphone inside the app, so the app uses Android's own
 * SpeechRecognizer (Google speech services on the phone). Asks for RECORD_AUDIO the first time.
 *   start({ lang }) -> resolves { text } when the user stops talking; rejects with a code voice-log understands
 *                      (not-allowed, no-speech, network, audio-capture, service-not-allowed, busy, error)
 *   stop()          -> stop listening now (start then resolves with what was heard)
 *   event "partial" -> { text } while the user is still talking
 *
 * Registered in MainActivity before super.onCreate. The compiled copy lives next to MainActivity;
 * this file is the source of truth and modules/voice-log/voice-log.test.js checks they are identical.
 */
@CapacitorPlugin(
    name = "Speech",
    permissions = [Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO])]
)
class SpeechPlugin : Plugin() {

    private var recognizer: SpeechRecognizer? = null
    private var active: PluginCall? = null

    @PluginMethod
    fun available(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("available", SpeechRecognizer.isRecognitionAvailable(context))
                .put("permission", getPermissionState("microphone").toString())
        )
    }

    @PluginMethod
    fun start(call: PluginCall) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermission")
            return
        }
        begin(call)
    }

    @PermissionCallback
    private fun micPermission(call: PluginCall) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) begin(call)
        else call.reject("Microphone permission denied", "not-allowed")
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        activity.runOnUiThread {
            try { recognizer?.stopListening() } catch (e: Exception) { }
            call.resolve()
        }
    }

    private fun begin(call: PluginCall) {
        activity.runOnUiThread {
            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                call.reject("No speech service on this phone", "service-not-allowed")
                return@runOnUiThread
            }
            finishActive(null, "busy")
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("lang") ?: "en-US")
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
                // Lifters pause between numbers ("sixty ... for ten, ten, eight"): wait a little longer.
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L)
            }
            val r = SpeechRecognizer.createSpeechRecognizer(context)
            recognizer = r
            active = call
            r.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
                override fun onPartialResults(partialResults: Bundle?) {
                    val t = first(partialResults)
                    if (t.isNotEmpty()) notifyListeners("partial", JSObject().put("text", t))
                }
                override fun onResults(results: Bundle?) {
                    finishActive(first(results), null)
                }
                override fun onError(error: Int) {
                    finishActive(null, code(error))
                }
            })
            r.startListening(intent)
        }
    }

    private fun first(b: Bundle?): String =
        b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim() ?: ""

    private fun code(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER -> "network"
        SpeechRecognizer.ERROR_AUDIO -> "audio-capture"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy"
        else -> "error"
    }

    /** Settle the pending start() once and release the recognizer. */
    private fun finishActive(text: String?, errorCode: String?) {
        val call = active
        active = null
        val r = recognizer
        recognizer = null
        try { r?.destroy() } catch (e: Exception) { }
        if (call == null) return
        if (errorCode != null) call.reject("Speech: $errorCode", errorCode)
        else call.resolve(JSObject().put("text", text ?: ""))
    }

    override fun handleOnDestroy() {
        finishActive(null, "error")
        super.handleOnDestroy()
    }
}
