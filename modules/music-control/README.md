# Music controls (modules/music-control)

A small remote for the YouTube Music app (or whatever is playing) inside Mizan. Mizan never plays music itself,
never reads the user's library and asks for no permission. Settings › Music: on/off, where it shows, playlist link.

- `MusicControl.init({ get, set, toast })` – `get()` returns the saved settings, `set(obj)` stores them (the shell keeps
  them in `prefs/main.music`). Settings: `{ on: true, look: 'strip' | 'icon' | 'workout', playlist: '' }`.
- `MusicControl.LOOKS` – `[[key, label], …]` for the Settings picker. `strip` (default): a slim bar under the header
  (main app and live workout), collapsed to a small "Music" tab. `icon`: a note button in the header (after the date
  arrows; left of the mic in a workout) that opens a compact panel (`role="dialog"`, so the back button closes it).
  `workout`: a row above the rest timer on the live workout screen only, collapsed to a round button bottom-left.
- `MusicControl.mountHeader(iconSlot, stripSlot)` – the shell calls it on every render with `#musicHead` and `#musicStrip`.
- `MusicControl.mountWorkout(liveEl)` – workout-logger calls it after painting `.lb-live-head`; it adds its own
  elements inside the live screen and keeps the workout row above `.lb-rest` (MutationObserver on the rest host).
- `MusicControl.bind(document)` – one delegated handler for `[data-mc]`: `toggle`, `close`, `prev`, `pp` (play/pause),
  `next`, `playlist`, `open`, `hide` (turns the feature off), `settings` (fires `mc:settings` on window; the shell opens
  Settings and focuses the playlist field).
- `MusicControl.press(key)` / `open(url)` – Android: Capacitor plugin `MediaKeys` (`android/MediaKeysPlugin.kt`,
  copied into `android/app/src/main/java/com/azizfitness/app/`, registered in MainActivity; the test checks the copy).
  `press` sends a headset-style media key (AudioManager.dispatchMediaKeyEvent, no permission); `open` aims the link at
  `com.google.android.apps.youtube.music` (listed in `<queries>`) and falls back to any app. In a browser: toast / new tab.
- `MusicControl.validPlaylist(url)` – only youtube.com, music.youtube.com and youtu.be links are kept.
- Expanded/collapsed is remembered per device (`localStorage` `mz-music-open`). Nothing plays when the app opens.
- Limits: no track name or playing state (that needs notification access, deliberately not requested). The free
  YouTube Music app stops when it leaves the screen; keeping music going behind Mizan needs Premium.

Tests: `node --test modules/music-control/music-control.test.js`.
