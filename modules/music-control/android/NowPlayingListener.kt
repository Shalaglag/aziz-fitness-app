package com.azizfitness.app

import android.service.notification.NotificationListenerService

/**
 * Empty notification listener. Android only hands out other apps' media sessions
 * (MediaSessionManager.getActiveSessions) to an app that has a notification listener the user
 * has switched on in Settings › Notification access. This class never reads a notification; it
 * exists so MediaKeysPlugin.nowPlaying() can ask for the song name, artist, cover and play state.
 * Declared in AndroidManifest.xml; the switch is opt-in from Mizan's Settings › Music.
 */
class NowPlayingListener : NotificationListenerService()
