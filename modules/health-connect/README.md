# Health Connect → Water card (WaterH auto-sync)

Flow: **WaterH bottle → WaterH app → Android Health Connect → this app**. The app reads
`HydrationRecord`s with the official Health Connect client, read-only, one permission, no network, no
third-party service. It does not matter which app wrote the record: WaterH, Samsung Health, Hydro Coach or a
manual entry in Health Connect all land in the same place.

## Is WaterH actually writing to Health Connect?
No, not directly (Aziz checked Nov 1, 2026: WaterH is not in Health Connect → App permissions and there was
no Hydration data). WaterH is connected to **Fitbit** instead (Fitbit lists WaterH with food and water logs).
Possible route: WaterH → Fitbit / Google Health cloud → Fitbit / Google Health app → Health Connect.
- Google's help page for the Google Health app (the Fitbit app was renamed in May 2026) lists Hydration in
  both the read and write columns for Health Connect. Fitbit community posts from Jan 2026 said Fitbit did not
  offer a water write permission then, so this depends on the app version on the phone.
- The legacy Fitbit Web API (which partner apps like WaterH used) is being retired in Sept 2026 and partner
  apps must reconnect; Fitbit's "partner apps may need reconnecting" notice is that. If WaterH has not moved
  to the new Google Health API, the WaterH → Fitbit link may stop working.
- Not verified on Aziz's phone yet. The one-time test is in the in-app guide and below. Records arriving
  through Fitbit carry Fitbit / Google Health as their origin; the module doesn't filter on origin, so they
  count. A sip that appears twice from two apps with the same time and ml is skipped as a mirror.
- If the route doesn't work, the paste / file box (`modules/waterh-sync`) stays the daily path.

## Files
- `health-connect.js`: all the logic (plain script, `window.HealthConnectSync`, no DOM at module level).
- `health-connect.test.js`: `node --test modules/health-connect/health-connect.test.js` (13 tests with a
  simulated Health Connect: new record, re-sync, correction, deletion, manual water untouched, restart,
  expired token, offline, missing permission / Health Connect / plugin, overlap, zones, throttle, UI).
- `android/HealthConnectPlugin.kt`: the Capacitor plugin (Kotlin, ~150 lines), copied into the Android project.

## Data
`days/{date}.waterh = { ml, at, source: "health-connect", records: { [hcId]: {ml, s, e, o, m} } }`
- `ml` is the sum of the records; every consumer that already reads `waterh.ml` (water card, Drinks
  `totalFluid`, dashboard, coach) keeps working unchanged.
- `records` is keyed by the Health Connect record id: the same id twice is a no-op, an upsert with a changed
  volume replaces, a `DeletionChange` removes and the sum is rebuilt. Stored in the day doc, so it survives a
  reinstall and is shared with the PC copy.
- A record whose start, end and ml equal another record's from a different app is a mirror and is skipped.
  Records written by this app's own package are ignored (we never write, belt and braces).
- `water` (the +250 ml taps) and the Drinks card (`food` rows with `slot:"Drink"`) are never touched. Total
  fluids = water + waterh.ml + confirmed drinks, as before.
- Device-local state in `localStorage["aziz-hc-sync"]`: `{token, lastSyncAt, lastError, lastCount, firstSyncAt}`.
  The change token is only meaningful on the phone that issued it, so it is deliberately not synced.

## Sync algorithm
1. `probe()`: `isAvailable()` then `checkPermissions()`.
2. No token → `readHydration(last 14 days)` → upsert per day → `getChangesToken()`.
3. Token → `getChanges(token)` loop (`hasMore`) → upserts / deletes grouped by local day → store `nextToken`.
4. Token expired (unused for 30 days) → full re-read of 30 days; ids that vanished from Health Connect inside
   the window are treated as deletions; dedupe by id means nothing doubles.
5. Each touched day is one `put("days", date, day, {quiet:true})` so it goes through the pending-writes outbox
   and reaches Firestore when there is signal. Puts happen before the token is saved: if the app dies in
   between, the next sync replays the same changes, which are idempotent.
6. `autoSync()` runs on open, resume (`visibilitychange`, `focus`, `pageshow`) and never prompts; it is throttled
   to once a minute. `syncNow()` (the button) prompts for permission if needed.

## Android permissions and background reading
- Manifest: `android.permission.health.READ_HYDRATION` only. Health Connect requires a privacy-policy
  rationale activity (below) or the permission sheet does not open.
- Health Connect lets an app read only while it is in the foreground. Background reading needs the extra
  `READ_HEALTH_DATA_IN_BACKGROUND` permission (Android 14+/Health Connect 2024+) plus a WorkManager job; the
  bottle only reaches Health Connect when the WaterH app has talked to it over Bluetooth anyway, so "open
  WaterH, then open this app" is the real cadence and the on-open sync covers it. Background sync is a
  follow-up if Aziz wants it after the device test.
- Samsung phones: Health Connect is built into Settings on One UI 6 / Android 14 and newer; older phones install
  it from Play. Samsung Health does not sync hydration through Health Connect, so WaterH must write directly.

## Android wiring (done, in `android/`)
- `android/app/src/main/java/com/azizfitness/app/HealthConnectPlugin.kt`: compiled copy of `android/HealthConnectPlugin.kt`
  in this folder (edit here, copy there; the module test fails if they differ).
- `MainActivity.java`: `registerPlugin(HealthConnectPlugin.class)` before `super.onCreate`.
- `AndroidManifest.xml`: `READ_HYDRATION`, `<queries>` for `com.google.android.apps.healthdata`, the
  `ACTION_SHOW_PERMISSIONS_RATIONALE` intent filter on MainActivity (Android 13 and older) and the
  `VIEW_PERMISSION_USAGE` activity-alias (Android 14+, without it the permission sheet never opens).
- `app/build.gradle`: `androidx.health.connect:connect-client:1.1.0` + `kotlinx-coroutines-android`;
  `variables.gradle` minSdk 24 → 26 (connect-client's floor; Android 8.0+).
- Plugin methods are `hasHydrationAccess` / `requestHydrationAccess`, not `checkPermissions` /
  `requestPermissions`, because Capacitor's Plugin base class already defines those two.
- When Health Connect opens the app from its "why does this app need access" link, the app simply opens.
  What it reads: hydration only, shown on the Water card, stored in Aziz's own Firestore account, nowhere else.

## Shell wiring (done in build/shell.html)
- `hcSync = HealthConnectSync.create({plugin: window.Capacitor?.Plugins?.HealthConnect, getDay, put, storage: localStorage, onChange: render})`.
- Water card: `hcSync.html(day)` (status dot, last sync, Allow access / Sync now / settings) above the old
  Sync WaterH paste box, `hcSync.guideHTML()` as the setup guide.
- Clicks: `hcsync` → `syncNow()` + toast; `hcperm` → `requestAccess()`; `hcsettings` → `openSettings()`.
- `autoSync()` on load and on `visibilitychange`/`focus`/`pageshow` next to `refreshToday()`.
- Without the plugin (web, PC) the block says auto-sync lives in the Android app and the paste box remains.

## Device test (not done yet, needs Aziz's Samsung)
1. Install the APK, open the Water card → Allow access → allow Hydration.
2. Drink from the bottle, open WaterH so it reads the bottle, confirm the sip appears in Health Connect → Data → Hydration.
3. Open this app: the status line should show the record count and litres; Sync now should report "0 new" the second time.
4. Edit / delete the record in Health Connect, sync again: the total should follow.
5. Tap +250 ml by hand: the bottle figure must not change and the total must be bottle + manual.
