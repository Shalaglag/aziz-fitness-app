package com.azizfitness.app

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.Uri
import android.view.KeyEvent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Music remote for modules/music-control/music-control.js.
 *
 * `press({key})` sends the same media key press a headset button sends (play, pause, toggle, next, prev, stop)
 * to whichever app is playing (YouTube Music, Spotify, …). No permission, no account: AudioManager
 * .dispatchMediaKeyEvent is public since API 19. Nothing comes back about the track; that would need
 * notification access, which this app deliberately does not ask for.
 * `open({url, pkg})` opens a link in a given app (pkg) and falls back to any handler when that app is missing.
 * `isInstalled({pkg})` says whether an app is on the phone (the package must be listed in <queries> in the manifest).
 *
 * Registered in MainActivity before super.onCreate. This file is the source of truth; the compiled copy lives in
 * android/app/src/main/java/com/azizfitness/app and modules/music-control/music-control.test.js checks they match.
 */
@CapacitorPlugin(name = "MediaKeys")
class MediaKeysPlugin : Plugin() {

    private fun keyCode(key: String?): Int = when (key) {
        "play" -> KeyEvent.KEYCODE_MEDIA_PLAY
        "pause" -> KeyEvent.KEYCODE_MEDIA_PAUSE
        "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
        "prev", "previous" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
        "stop" -> KeyEvent.KEYCODE_MEDIA_STOP
        else -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
    }

    @PluginMethod
    fun press(call: PluginCall) {
        val code = keyCode(call.getString("key"))
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
        val ret = JSObject()
        ret.put("sent", true)
        ret.put("musicActive", am.isMusicActive)
        call.resolve(ret)
    }

    @PluginMethod
    fun isInstalled(call: PluginCall) {
        val pkg = call.getString("pkg") ?: ""
        val ret = JSObject()
        ret.put("installed", installed(pkg))
        call.resolve(ret)
    }

    private fun installed(pkg: String): Boolean {
        if (pkg.isEmpty()) return false
        return try { context.packageManager.getPackageInfo(pkg, 0); true } catch (e: PackageManager.NameNotFoundException) { false }
    }

    @PluginMethod
    fun open(call: PluginCall) {
        val url = call.getString("url") ?: ""
        val pkg = call.getString("pkg") ?: ""
        if (url.isEmpty()) { call.reject("url missing"); return }
        val ret = JSObject()
        if (pkg.isNotEmpty() && installed(pkg)) {
            val inApp = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
                setPackage(pkg)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try {
                activity.startActivity(inApp)
                ret.put("opened", true); ret.put("inApp", true)
                call.resolve(ret); return
            } catch (e: ActivityNotFoundException) { /* fall through to any handler */ }
        }
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) })
            ret.put("opened", true); ret.put("inApp", false)
            call.resolve(ret)
        } catch (e: ActivityNotFoundException) {
            call.reject("nothing can open " + url)
        }
    }
}
