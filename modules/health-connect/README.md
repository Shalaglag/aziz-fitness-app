# Health Connect → Water card (WaterH auto-sync)

Flow: **WaterH bottle → WaterH app → Android Health Connect → this app**. The app reads
`HydrationRecord`s with the official Health Connect client, read-only, one permission, no network, no
third-party service. It does not matter which app wrote the record: WaterH, Samsung Health, Hydro Coach or a
manual entry in Health Connect all land in the same place.

## Is WaterH actually writing to Health Connect?
Not confirmed. WaterH's site, FAQ and Play listing (v3.5.1, Oct 2025) do not mention Health Connect,
Google Fit or Samsung Health; the earlier note in `modules/waterh-sync/README.md` was an assumption. The setup
guide in the app therefore starts with the check Aziz has to do once on his phone:

1. WaterH app → Profile / Settings → look for *Health Connect*, *Google Fit* or *Connected apps* and switch it on.
2. Health Connect → **App permissions**: WaterH must be listed with *Hydration* allowed.

If WaterH is listed, auto-sync works end to end. If it is not, WaterH does not write to Health Connect on that
phone and the fallbacks are: (a) WaterH's own export (History → reports) pasted / picked into the existing
Sync WaterH box (`modules/waterh-sync`), (b) a Health Connect-writing water app that WaterH can push to (none
known), or (c) asking WaterH support for Health Connect support. Nothing in this module pretends otherwise:
the status line says "no bottle records today yet" until a record really arrives.

## Files
- `health-connect.js`: all the logic (plain script, `window.HealthConnectSync`, no DOM at module level).
- `health-connect.test.js`: `node --test modules/health-connect/health-connect.test.js` (13 tests with a
  simulated Health Connect: new record, re-sync, correction, deletion, manual water untouched, restart,
  expired token, offline, missing permission / Health Connect / plugin, overlap, zones, throttle, UI).
- `android/HealthConnectPlugin.kt`: the Capacitor plugin (Kotlin, ~150 lines). The Android thread copies it
  into `android/app/src/main/java/com/azizfitness/app/` and registers it.

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

## Wiring for the Android thread
`android/app/build.gradle`:
```gradle
dependencies {
    implementation "androidx.health.connect:connect-client:1.1.0-alpha12"
    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1"
}
```
`AndroidManifest.xml` (inside `<manifest>` and `<application>`):
```xml
<uses-permission android:name="android.permission.health.READ_HYDRATION" />
<queries>
  <package android:name="com.google.android.apps.healthdata" />
</queries>
<!-- inside <application>: the rationale screen Health Connect opens from its permission sheet -->
<activity-alias
    android:name="ViewPermissionUsageActivity"
    android:exported="true"
    android:targetActivity=".MainActivity"
    android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
  <intent-filter>
    <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />
    <category android:name="android.intent.category.HEALTH_PERMISSIONS" />
  </intent-filter>
</activity-alias>
<activity android:name=".MainActivity" ...>
  <intent-filter>
    <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
  </intent-filter>
</activity>
```
`MainActivity.kt`: `registerPlugin(HealthConnectPlugin::class.java)` before `super.onCreate(...)`.
Rationale text (shown when Health Connect opens the app with that action): the app reads hydration only to
show it on the Water card; it is stored in the user's own Firestore account and nowhere else.

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
