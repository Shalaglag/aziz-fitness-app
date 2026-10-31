# Android shell glue (modules/android-shell)

Wires the web app to the Capacitor Android wrapper. No-op outside the Android app, so `app/index.html`
still runs in a browser and inside Claude.

- `AndroidShell.init({ isHome, goHome })` – call once after render is ready. Wires the hardware back button,
  keeps the status bar colour in step with the theme (`data-theme` on `<html>`), and turns the workout
  logger's rest timer into a local notification when the app is in the background.
- `AndroidShell.onBack(fn)` – a module with its own overlay registers `fn`; return `true` when it handled the
  press. Returns an unregister function.
- Back order: registered handler → visible `[role="dialog"]`'s close button → Today tab → minimise the app.
- `AndroidShell.notifyAt(id, whenMs, title, body)` / `AndroidShell.cancel(id)` – local notifications
  (`@capacitor/local-notifications`, asks permission on first use).
- Events consumed: `lb:rest` (`detail: {end, total}`) and `lb:rest-stop`, fired on `window` by workout-logger.
- `<html class="android-app">` is set inside the app; CSS can use it for native-only tweaks.

Tests: `node --test modules/android-shell/android-shell.test.js`. The Android project itself is in `android/`;
see `docs/ANDROID.md`.
