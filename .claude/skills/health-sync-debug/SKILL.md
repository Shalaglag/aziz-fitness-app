---
name: health-sync-debug
description: Use when water or steps stop updating in Mizan (WaterH bottle, Fitbit/Google Health, Health Connect) to find which hop broke before changing any code.
---

# Health sync debug (water and steps)

Diagnosed three times Nov 1–3 2026 (thread "Sync WaterH water through Fitbit"). The chain is long and
each hop has its own delay, so find the broken hop first.

## The chain
bottle → WaterH app (Bluetooth) → Fitbit cloud → Google Health API → `modules/google-health`
(`GoogleHealthWater`, Kotlin `GoogleHealthPlugin`, scope `googlehealth.nutrition.readonly`) → day
field `waterh` (source `google-health`, records `gh:<id>`). Health Connect (`modules/health-connect`)
yields for water while Fitbit is connected; it still supplies steps (`READ_STEPS`). Manual paste/file
box (`modules/waterh-sync`) always stays as fallback. Live poll: today re-read every 15 s while the
app is visible, 15 s throttle on open/resume, 5 min back-off after non-network errors (PR #121).

## Steps
1. Read the Water card status line Aziz sends (last sync time, logs read, new). "Fitbit connected,
   read N logs, 0 new" with no entries today means the app is fine and nothing reached Fitbit.
2. Ask one question: does the Fitbit / Google Health app show today's water?
   - No → WaterH → Fitbit link is broken (WaterH's Fitbit page opened blank after the legacy Fitbit
     API shutdown on Nov 2 2026). Fix is on WaterH's side: update WaterH, reconnect Fitbit, or
     contact WaterH support. Aziz chose to WAIT (Nov 3), no screen-reader workaround. No app change.
   - Yes → our side. Check `403 access_denied` (Gmail must be a test user in the Google Cloud
     project, or the OAuth app published), `400` (hydration logs are sessions: filter by
     `civil_start_time` date, not timestamps), and the Android client SHA-1 in Google Cloud.
3. Dead ends, do not retry: Health Connect hydration from WaterH (returns 0; WaterH does not write
   it); per-second updates (three cloud hops, impossible); legacy Fitbit Web API (off Nov 2 2026).
4. Any code change follows `ship-app-change`; test with Aziz's phone and record his yes/no.

## Completion check
- Broken hop named with evidence (status line, Fitbit app screenshot or API error).
- Aziz told the one action on his side, or a PR merged for an app-side cause.
