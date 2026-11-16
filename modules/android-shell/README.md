# Android shell glue (modules/android-shell)

Wires the web app to the Capacitor Android wrapper. No-op outside the Android app, so `app/index.html`
still runs in a browser and inside Claude.

- `AndroidShell.init({ isHome, goHome, setTab })` – call once after render is ready. Wires the hardware back button,
  keeps the status bar colour in step with the theme (`data-theme` on `<html>`), and turns the workout
  logger's rest timer into a local notification when the app is in the background.
- `AndroidShell.onBack(fn)` – a module with its own overlay registers `fn`; return `true` when it handled the
  press. Returns an unregister function.
- `AndroidShell.visit(tab, scrollY)` – the host calls it on every render; a tab change records the tab being
  left and its scroll position (history stack, max 30).
- Back order: registered handler → visible `[role="dialog"]`'s close button → previously visited tab
  (`setTab(tab, scrollY)`) → Today tab → minimise the app.
- `AndroidShell.notifyAt(id, whenMs, title, body)` / `AndroidShell.cancel(id)` – local notifications
  (`@capacitor/local-notifications`, asks permission on first use).
- Events consumed: `lb:workout` / `lb:workout-stop` (the running workout: `{name, start, exercise, set, next, done, total,
  look}`, from workout-logger's `saveActive`) keep a persistent Strong-style workout notification (`AndroidShell.liveWorkout(d)`);
  `lb:rest` (`detail: {end, total, sound, look}`) and `lb:rest-stop`, fired on `window` by workout-logger
  and the shell Quick log, turn it into the live countdown (`AndroidShell.liveRest(d)`,
  Kotlin plugin `RestTimer` in `android/RestTimerPlugin.kt` + the `android/notification_rest*.xml` layouts, copied into
  the  Android project; a test checks the copies match). `detail.look` picks the look (`AndroidShell.LOOKS`: big, clock,
  bar, plain, endsAt; the logger's `restNotify` setting). Buttons: **Complete set** / **Rest** between rests
  (`lb:workout-complete`, `lb:rest-start`), **−15 s** / **+15 s** / **Skip** during one (`lb:rest-adjust` {d}, `lb:rest-skip`). Its **+15 s** / **Skip** buttons come back as `lb:rest-adjust`
  (`detail: {d}`) / `lb:rest-skip` on `window`.
- Background buttons (Nov 16 2026): the web view sleeps while the app is in the background, so the plugin acts on
  the buttons itself first. `show()` carries `complete: {rest, sound, body, sub}` (`AndroidShell.completePlan`, from
  the logger's `workoutInfo().after`); **Complete set** switches to that rest at once, arms the ring and queues
  `{at, end}`; −15 / +15 / Skip move the native rest and the queued end. `RestTimer.takePending()` returns and clears the
  queue; `AndroidShell.takeQueued()` replays it as `lb:workout-complete` `{at, end}` on the button event, on App
  `resume` and at start. The logger's `completeFromShade(d)` ticks the set with a rest ending at `d.end` (none when it
  is past or 0), holding it until its data has loaded.
- Rest-over sound (Nov 14 2026, `android/RestRing.kt` + `android/RestRingReceiver.kt`): `lb:rest` arms an exact native
  alarm (`RestTimer.arm({end, sound, silent})`, `USE_EXACT_ALARM`) instead of the LocalNotifications one, and
  `GymSounds.setNative(AndroidShell.ringRest)` sends every rest sound to `RestTimer.ring({sound, end, ms})`. With music
  playing, the native player lowers the media volume to about a third (no audio focus: YouTube Music pauses on a
  "may duck" focus loss, Nov 16), plays `res/raw/rest_<id>.wav` on the notification sound, then steps the media
  volume back up. On silent/vibrate it plays on the media stream, mixed in, undimmed. Each rest end rings once (whichever of the alarm and the
  in-app timer is first); the locked phone also gets a quiet "Rest is over" heads-up (channel `rest_over_v2`, buzz
  only). Skipping early disarms. The user's own sound plays in the web view, undimmed. "Beep when rest
  ends" off = buzz only. On silent/vibrate with no music, a locked phone only buzzes.
- `<html class="android-app">` is set inside the app; CSS can use it for native-only tweaks.

Tests: `node --test modules/android-shell/android-shell.test.js`. The Android project itself is in `android/`;
see `docs/ANDROID.md`.
