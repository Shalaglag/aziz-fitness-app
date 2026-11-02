# Google Health (Fitbit) → Water card

WaterH writes every sip to **Fitbit**. Fitbit / Google Health does not pass water on to Android Health
Connect on Aziz's phone (tested Nov 1, 2026: Health Connect returned 0 hydration records while the Fitbit
app showed 452 ml). So the app reads the Fitbit water log directly from the **Google Health API**, the
Fitbit Web API's successor (the legacy Fitbit Web API is switched off on Nov 2, 2026).

```
GET https://health.googleapis.com/v4/users/me/dataTypes/hydration-log/dataPoints
    ?filter=hydration_log.interval.civil_start_time >= "YYYY-MM-DD"&pageSize=1000
    (hydration-log is a session type: Google filters it only on civil start time. If Google still answers 400,
    the module reads unfiltered, newest first, stops at the window edge and remembers that.)
Authorization: Bearer <token for https://www.googleapis.com/auth/googlehealth.nutrition.readonly>
```

## Files
- `google-health.js`: `GoogleHealthWater` (parse, dedupe, sync, Water card block). Reuses
  `HealthConnectSync.applyRecords/removeRecords/currentRecords` with `source: "google-health"`.
- `google-health.test.js`: `node --test modules/google-health/google-health.test.js` (simulated API).
- `android/GoogleHealthPlugin.kt`: Capacitor plugin `GoogleHealth`, compiled copy in
  `android/app/src/main/java/com/azizfitness/app/`, registered in `MainActivity`.
  `authorize({interactive})` uses Google Play services' `AuthorizationClient` (no client secret in the APK);
  `get({path, query, token})` only calls `health.googleapis.com/v4/users/me/dataTypes/*/dataPoints`.
  Gradle: `com.google.android.gms:play-services-auth:21.3.0`.

## Data
`days/{date}.waterh = {ml, at, source: "google-health", records: {"gh:<dataPointId>": {ml, s, e, o, m}}}`.
`water` (manual taps) and Drinks are never touched. First sync back-fills 14 days; each later sync
re-reads the last 3 days and makes each day match Fitbit exactly (edits and deletions follow, ids never
double). A day with no Fitbit logs is never written, so a pasted WaterH figure on it survives.
Device-local state: `localStorage["aziz-gh-sync"]`.

Sync runs on open / resume / back online (at most every 10 min, never shows UI) and on **Sync Fitbit now**.
A 401 triggers one silent re-authorize. Errors shown in plain words: not linked to Google Health,
API not enabled, no internet, access refused.

## One-time Google Cloud setup (Aziz, on a PC, free)
1. https://console.cloud.google.com → create a project, e.g. "aziz-fitness" (the Firebase one is fine too).
2. APIs & Services → Library → **Google Health API** → Enable.
3. APIs & Services → OAuth consent screen (Google Auth Platform): User type **External**, app name
   "Aziz Fitness", your Gmail as support + developer email. **Audience → Test users → add your Gmail.**
   Data Access → Add scope `https://www.googleapis.com/auth/googlehealth.nutrition.readonly`.
   Optional: Audience → **Publish app** (stays unverified, up to 100 users) so Google doesn't ask you to
   re-approve every 7 days.
4. Credentials → Create credentials → OAuth client ID → type **Android**:
   - Package name: `com.azizfitness.app`
   - SHA-1: `B4:AD:41:67:BA:DD:77:D4:CB:3F:05:A3:C5:D9:E4:2F:E2:AB:DB:89` (the app's signing key)
5. Your Fitbit must be on a Google account in the Google Health (Fitbit) app (it is, since the app shows
   your water).

Then on the phone: update the app → Water card → **Connect Fitbit / Google Health** → pick your Google
account → Continue past "unverified app" → Allow.

## How fast it updates (Nov 2, 2026)
- On open, resume, focus and back online: re-check the last 3 days, at most every 15 s.
- While the app is on screen: `autoSync({live:true})` re-reads today only, every 15 s (the shell ticks every 5 s and the
  module throttles). Only a real change re-renders the screen, then the Water fluid rises and a toast says the new total.
- After a non-network error (401/403/400…) auto and live back off to once per 5 minutes; offline does not back off.
- Per-second updates are not possible from here: the sip has to travel bottle → WaterH app (Bluetooth, when WaterH is
  open or syncs in the background) → Fitbit cloud → Google Health API. The app sees it within 15 s of Fitbit having it.
- While Fitbit is connected, Health Connect water yields (`yieldTo` option of HealthConnectSync), so the two never
  overwrite each other's records.
