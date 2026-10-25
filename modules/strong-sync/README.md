# Strong sync (CSV import)

Strong has no public API, and its Apple Health / Health Connect link only shares the workout's time and calories, not sets, reps or weights. Its CSV export is the only way to get the full workout out, so the app imports that file.

## Aziz's steps (about 20 seconds after a workout)
1. Strong > Profile (or Settings) > **Export Strong Data** > CSV. On iPhone choose **Save to Files**; on Android save to Downloads.
2. In the app, Train tab > **Import from Strong** > pick `strong.csv`.
3. Re-importing the whole history every time is fine: each day's Strong exercises are replaced, not doubled, and sets you typed in the app for other exercises are kept.

## For the app thread
- `strong-csv.js` exposes `StrongCSV.toWorkouts(csvText, {program: PROGRAM, rotation: ROTATION, existing: S.docs.workouts, unit: "kg"})` -> `{docs:{date: workoutDoc}, report}`. Write each doc with `put("workouts", date, doc)`.
- Docs keep the existing shape `{date, session, idx, sets:{name:[{w,r}]}}` plus `source:"strong"` and `strong:{title, durationMin, importedAt}`.
- Weights are converted to each exercise's program unit (lb for Incline DB, DB OHP, DB Curl, Front Raise). Warm-ups dropped.
- Session comes from the Strong workout title ("Push A" etc.), otherwise the best overlap with PROGRAM.
- `report.unmatched` lists Strong exercise names that matched nothing; they are saved under their Strong name. Show them so Aziz can rename in Strong, or extend `StrongCSV.ALIASES`.
- Tested on both Strong export layouts: `sample-strong-old.csv` (comma, "Weight") and `sample-strong-new.csv` (semicolon, "Weight (kg)", "Duration (sec)").
