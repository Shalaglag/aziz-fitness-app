# Cardio (treadmill) tracking

Logs each cardio session (speed, incline, minutes, distance, heart rate, how it felt) next to lifting, and shows progression on the Progress tab. Built for the 30 min treadmill walk after every lift, but works for an outdoor walk, bike, elliptical, rower or stair climber too.

Preview: `preview.html` (example data, saving only changes the page).

## What the user sees
- **Train tab (and Today, optional): "Cardio after lifting" card.** Type, minutes, speed, incline, distance, avg/max heart rate, machine calories, and Easy / Steady / Hard. The form is filled from the last session of the usual type (else from `prefs/main.cardio`), and nothing is saved until **Save session** is tapped. Saved sessions show as rows with Edit and ✕.
- **Progress tab: "Cardio progress" card.** Last 7 days (sessions, minutes vs the prior week, km, metres climbed), "cardio after lifting on X of Y lift days", a chart of intensity per session (speed + incline in METs) with average heart rate on top, the heart-rate change at the same setting ("132 → 124 bpm: same work, lower heart rate"), a progression tip, and the last 8 sessions.

## Rules (nothing is invented)
- **Distance:** typed, or speed × minutes when left blank (stored with `kmCalc: true`, shown as "≈").
- **Calories:** the machine's number when typed. Otherwise an ACSM walking/running estimate from speed, incline and the latest weigh-in, only for treadmill/walk (`kcalSrc: "est"`, shown as "≈ … est."). For context only: never added to the food budget.
- **Progression tip** (never applied by itself): after 3 full-length sessions at the same treadmill setting in the last 3 weeks that were clearly easy (all heart rates 5+ bpm below the easy-zone top, or all rated Easy), suggest +1 incline (up to 12), then +0.3 km/h. A Hard rating, a short session or heart rate over the top holds the setting. With no heart rate and no ratings, it asks for one of them.
- **Easy-zone top:** `prefs/main.cardio.hrCeiling`, else 70% of (220 − age) from `prefs/main.cardio.age` or `prefs/main.profile.age`, else none (heart-rate rule off).
- **Old days:** a day that only has the treadmill checkbox ticked counts as a session in "X of Y lift days" and the session count, but not in minutes or km.

## Data
- New collection **`cardio/{date}`** = `{date, sessions:[{id, kind, min, speed, incline, km, kmCalc, hrAvg, hrMax, kcal, kcalSrc, effort, at, source, loggerId}]}`. `kind` ∈ treadmill, walk, bike, elliptical, rower, stairs; `effort` 1 Easy, 2 Steady, 3 Hard; `source` "manual" or "logger".
- **`days/{date}.treadmill` stays a boolean.** `handle` sets it true when a treadmill session is saved and false when the last one is deleted, so DailyScore, the weekly report and the Today checklist keep working. Ticking the checkbox by hand still works.
- **`prefs/main.cardio`** (optional): `{kind, min, speed, incline, hrCeiling, age}`, the usual session. Default `{kind:"treadmill", min:30}`; set Aziz's `{speed:4.0, incline:3}` from his plan when wiring.
- Lift days come from `lb_workouts` (finished full-logger workouts with a lifted set) first, then `workouts/{date}` (Quick log), Rest skipped.

## Wiring in the app shell
`cardio.js` defines `Cardio` (plain JS, no imports, no network). Inline it and inject `Cardio.css` once. `docs` = `S.docs` (needs `cardio`, `days`, `workouts`, `lb_workouts`, `prefs`).

```js
// load: add "cardio" to the collections the shell lists/syncs.
// prefs default, once: if(!S.docs.prefs.main.cardio) put("prefs","main",{...prefs, cardio:{kind:"treadmill",min:30,speed:4.0,incline:3}})

// Train tab: replace the "30 min treadmill" checkbox row with
html += `<div id="cdoHost">${Cardio.cardHTML(d, S.docs, cardioOpts)}</div>`;
// Progress tab, after Trend weight:
html += Cardio.progressHTML(S.docs, { today: TODAY });

// delegated click handler, before the data-act chain
if (Cardio.handle(e.target, { docs: S.docs, toast, weightKg: latestKg(),
      put: (c, id, doc) => { cardioOpts = {}; put(c, id, doc); },      // save / delete
      rerender: o => { cardioOpts = o; render(); } })) return;          // Edit / Cancel

// WorkoutLogger onFinish(workout, rec): store treadmill minutes/km from the logger
const got = Cardio.fromLogger(workout);
if (got.length) { const d = got[0].date, before = S.docs.cardio[d];
  const doc = Cardio.mergeLogger(before, got, d); put("cardio", d, doc, {quiet:true});
  put("days", d, Cardio.treadmillFlag(getDay(d), doc, before), {quiet:true}); }
```
`Cardio.summary(S.docs, {today})` gives plain-text lines for the weekly report, the 14-day review and the AI coach.

## API
`css`, `KINDS`, `planFrom(prefsMain)`, `hrCeiling(plan, prefsMain)`, `mets(speed, incline)`, `estKcal(session, kg)`, `clean(input, {weightKg})` → `{ok, session, errors}`, `sessions(doc)`, `withSession(doc, s, date)`, `withoutSession(doc, id, date)`, `treadmillFlag(day, doc, before)`, `fromLogger(workout)`, `mergeLogger(doc, sessions, date)`, `history(cardioMap)`, `liftDates(docs)`, `analyze(docs, {today})`, `cardHTML(date, docs, {editId})`, `progressHTML(docs, {today})`, `summary(docs, {today})`, `handle(el, ctx)`.

## Tests
`TZ=Asia/Kuwait node --test modules/cardio/cardio.test.js` (13 tests: validation, distance and calorie rules, the treadmill flag, logger import and merge, lift days from both logs, weekly totals, progression tips, heart-rate trend, card HTML, and the save/edit/delete handler).
