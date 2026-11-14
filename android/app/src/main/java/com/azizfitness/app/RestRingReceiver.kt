package com.azizfitness.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioManager

/**
 * Fires at a rest's end (RestRing.arm), also with the phone locked and the web view asleep. Shows "Rest is over"
 * when the app is not on screen, and plays the rest sound with the music ducked (RestRing.play). A rest end the
 * in-app timer already rang is skipped. With the phone on silent or vibrate and no music playing, it only buzzes.
 * Source of truth for the copy in android/app/src/main/java (checked by modules/android-shell/android-shell.test.js).
 */
class RestRingReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != RestRing.ACTION) return
        val end = intent.getLongExtra("end", 0L)
        if (!RestRing.claim(end)) return
        RestRing.armedEnd = 0L
        if (!RestRing.foreground) RestRing.postOver(ctx)
        if (intent.getBooleanExtra("silent", false)) return
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (!RestRing.foreground && am.ringerMode != AudioManager.RINGER_MODE_NORMAL && !am.isMusicActive) return
        val result = goAsync()
        RestRing.play(ctx, intent.getStringExtra("sound")) { result.finish() } // done() runs once, also on failure
    }
}
