package com.azizfitness.app

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.ComponentName
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.provider.Settings
import android.util.Base64
import android.view.KeyEvent
import androidx.core.app.NotificationManagerCompat
import java.io.ByteArrayOutputStream
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
 * `hasAccess()` / `requestAccess()` / `nowPlaying()`: the song name, artist, a small cover and the play state of the
 * active media session. Android only shares that with an app whose notification listener (NowPlayingListener) the
 * user switched on in Settings › Notification access, so this is opt-in: `requestAccess` opens that settings page
 * and `nowPlaying` answers `{access:false}` until it is granted. The listener itself reads nothing.
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

    private fun listenerOn(): Boolean =
        NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)

    @PluginMethod
    fun hasAccess(call: PluginCall) {
        val ret = JSObject(); ret.put("access", listenerOn()); call.resolve(ret)
    }

    @PluginMethod
    fun requestAccess(call: PluginCall) {
        try {
            activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) })
            val ret = JSObject(); ret.put("opened", true); call.resolve(ret)
        } catch (e: ActivityNotFoundException) { call.reject("no notification access settings") }
    }

    /** The session that is playing, else the first one with a title. */
    private fun pickSession(list: List<MediaController>): MediaController? {
        val titled = list.filter { it.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)?.isNotEmpty() == true }
        return titled.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING } ?: titled.firstOrNull() ?: list.firstOrNull()
    }

    private fun artBase64(meta: MediaMetadata?): String? {
        val bmp: Bitmap = meta?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART) ?: meta?.getBitmap(MediaMetadata.METADATA_KEY_ART)
            ?: meta?.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON) ?: return null
        val side = 96
        val scaled = if (bmp.width > side || bmp.height > side) {
            val k = side.toFloat() / maxOf(bmp.width, bmp.height)
            Bitmap.createScaledBitmap(bmp, maxOf(1, (bmp.width * k).toInt()), maxOf(1, (bmp.height * k).toInt()), true)
        } else bmp
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, 72, out)
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    @PluginMethod
    fun nowPlaying(call: PluginCall) {
        val ret = JSObject()
        if (!listenerOn()) { ret.put("access", false); call.resolve(ret); return }
        ret.put("access", true)
        try {
            val msm = context.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
            val sessions = msm.getActiveSessions(ComponentName(context, NowPlayingListener::class.java))
            val c = pickSession(sessions)
            if (c == null) { ret.put("session", false); call.resolve(ret); return }
            val m = c.metadata
            ret.put("session", true)
            ret.put("pkg", c.packageName)
            ret.put("title", m?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: "")
            ret.put("artist", m?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: m?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST) ?: "")
            ret.put("album", m?.getString(MediaMetadata.METADATA_KEY_ALBUM) ?: "")
            ret.put("playing", c.playbackState?.state == PlaybackState.STATE_PLAYING)
            if (call.getBoolean("art", true) == true) artBase64(m)?.let { ret.put("art", it) }
            call.resolve(ret)
        } catch (e: SecurityException) {
            ret.put("access", false); call.resolve(ret)
        }
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
