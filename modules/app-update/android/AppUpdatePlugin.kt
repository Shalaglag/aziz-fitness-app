package com.azizfitness.app

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.UnknownHostException
import java.security.MessageDigest

/**
 * In-app updates for modules/app-update/app-update.js.
 *
 * Reads the private GitHub release with a read-only key the user pasted (passed in per call, never
 * stored here), downloads the APK into the app's cache, checks that it is this app, newer, and signed
 * with the same certificate as the installed app, then opens Android's installer (the user confirms).
 *
 * Registered in MainActivity before super.onCreate. The compiled copy lives next to MainActivity;
 * this file is the source of truth and modules/app-update/app-update.test.js checks they are identical.
 */
@CapacitorPlugin(name = "AppUpdate")
class AppUpdatePlugin : Plugin() {

    private fun installed(flags: Int): PackageInfo =
        context.packageManager.getPackageInfo(context.packageName, flags)

    private fun code(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()

    private val sigFlags: Int =
        if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES

    private fun certs(info: PackageInfo?): Set<String> {
        if (info == null) return emptySet()
        val sigs = if (Build.VERSION.SDK_INT >= 28) {
            val s = info.signingInfo ?: return emptySet()
            if (s.hasMultipleSigners()) s.apkContentsSigners else s.signingCertificateHistory
        } else @Suppress("DEPRECATION") info.signatures
        val md = MessageDigest.getInstance("SHA-256")
        return sigs?.map { sig -> md.digest(sig.toByteArray()).joinToString("") { "%02x".format(it) } }?.toSet() ?: emptySet()
    }

    @PluginMethod
    fun info(call: PluginCall) {
        val p = installed(0)
        call.resolve(JSObject().put("versionCode", code(p)).put("versionName", p.versionName ?: ""))
    }

    @PluginMethod
    fun canInstall(call: PluginCall) {
        val ok = Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()
        call.resolve(JSObject().put("allowed", ok))
    }

    @PluginMethod
    fun openInstallSettings(call: PluginCall) {
        val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
        call.resolve()
    }

    /** GET the release JSON with the user's key. Resolves {status, body} so the JS side words the errors. */
    @PluginMethod
    fun latest(call: PluginCall) {
        val token = call.getString("token") ?: ""
        val url = call.getString("url") ?: return call.reject("missing url")
        Thread {
            try {
                val c = URL(url).openConnection() as HttpURLConnection
                c.connectTimeout = 15000; c.readTimeout = 15000
                c.setRequestProperty("Accept", "application/vnd.github+json")
                c.setRequestProperty("User-Agent", "AzizFitness-Updater")
                if (token.isNotEmpty()) c.setRequestProperty("Authorization", "Bearer $token")
                val status = c.responseCode
                val body = (if (status in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
                c.disconnect()
                call.resolve(JSObject().put("status", status).put("body", body))
            } catch (e: UnknownHostException) {
                call.reject("offline", "offline", e)
            } catch (e: IOException) {
                call.reject("offline", "offline", e)
            }
        }.start()
    }

    /**
     * Download the release asset (GitHub answers with a redirect to a signed file URL; the key is only
     * sent to api.github.com), then check package name, version and signing certificate.
     */
    @PluginMethod
    fun download(call: PluginCall) {
        val token = call.getString("token") ?: ""
        val start = call.getString("url") ?: return call.reject("missing url")
        val minVersion = (call.getDouble("minVersion") ?: 0.0).toLong()
        Thread {
            val dir = File(context.cacheDir, "updates").apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() }
            val out = File(dir, "aziz-fitness.apk")
            try {
                var url = URL(start)
                var conn: HttpURLConnection? = null
                for (hop in 0 until 6) {
                    val c = url.openConnection() as HttpURLConnection
                    c.instanceFollowRedirects = false
                    c.connectTimeout = 15000; c.readTimeout = 30000
                    c.setRequestProperty("Accept", "application/octet-stream")
                    c.setRequestProperty("User-Agent", "AzizFitness-Updater")
                    if (token.isNotEmpty() && url.host == "api.github.com") c.setRequestProperty("Authorization", "Bearer $token")
                    val status = c.responseCode
                    if (status in 300..399) {
                        val loc = c.getHeaderField("Location"); c.disconnect()
                        if (loc == null) break
                        url = URL(url, loc); continue
                    }
                    if (status !in 200..299) {
                        c.disconnect()
                        return@Thread call.reject("http $status", "http", null, JSObject().put("status", status))
                    }
                    conn = c; break
                }
                val c = conn ?: return@Thread call.reject("too many redirects", "http")
                val total = c.contentLengthLong
                var done = 0L; var lastPing = 0L
                c.inputStream.use { input ->
                    out.outputStream().use { o ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf); if (n < 0) break
                            o.write(buf, 0, n); done += n
                            if (done - lastPing > 256 * 1024) {
                                lastPing = done
                                notifyListeners("progress", JSObject().put("done", done).put("total", total))
                            }
                        }
                    }
                }
                c.disconnect()
                notifyListeners("progress", JSObject().put("done", done).put("total", total))

                val pm = context.packageManager
                val apk = pm.getPackageArchiveInfo(out.path, sigFlags)
                    ?: return@Thread fail(out, call, "not an app file", "invalid")
                if (apk.packageName != context.packageName) return@Thread fail(out, call, "different app", "invalid")
                val newCode = code(apk)
                if (newCode < minVersion) return@Thread fail(out, call, "build $newCode is not newer", "not-newer")
                // Same signing key as the installed app, or Android would refuse the update (and data could not carry over).
                apk.applicationInfo?.let { it.sourceDir = out.path; it.publicSourceDir = out.path }
                val mine = certs(installed(sigFlags))
                val theirs = certs(apk)
                if (mine.isNotEmpty() && theirs.isNotEmpty() && mine.intersect(theirs).isEmpty())
                    return@Thread fail(out, call, "signed with a different key", "signature")
                call.resolve(JSObject().put("path", out.path).put("versionCode", newCode))
            } catch (e: UnknownHostException) {
                fail(out, call, "offline", "offline")
            } catch (e: IOException) {
                fail(out, call, e.message ?: "download failed", "offline")
            }
        }.start()
    }

    private fun fail(f: File, call: PluginCall, msg: String, code: String) {
        f.delete(); call.reject(msg, code)
    }

    @PluginMethod
    fun install(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("missing path")
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls())
            return call.reject("install not allowed", "install-not-allowed")
        val f = File(path)
        if (!f.exists()) return call.reject("file missing", "invalid")
        val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", f)
        val i = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
        call.resolve()
    }
}
