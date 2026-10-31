# Strength & muscle analytics (StrengthAnalytics)

One card for the Progress tab: strength during the cut, a chart for every lift, weekly sets per muscle with training frequency, and muscle-group balance. Plain JS, no imports, no network. Global `StrengthAnalytics`.

| Function | Returns |
| --- | --- |
| `StrengthAnalytics.css` | CSS string, inject once (uses the app's tokens) |
| `StrengthAnalytics.html(docs, opts)` | one `.card` for the Progress tab; its lift picker redraws itself |
| `StrengthAnalytics.analyze(docs, opts)` | `{lifts, weeks, muscles, balance, cut, unmapped, notes, sessions}` |
| `StrengthAnalytics.summary(docs, opts)` | plain text for a chat or the AI coach |
| `StrengthAnalytics.unitsFrom(PROGRAM)` | `{name: "kg"\|"lb"}` from the app's PROGRAM tuples |
| `StrengthAnalytics.musclesFor(name)` | `{primary, secondary}` muscle ids, or `null` when unknown |
| `StrengthAnalytics.e1rm(kg, reps)` | Epley estimate |
| `StrengthAnalytics.targetFor(id, setTargets, volume)` | `{lo, hi, custom}` or `null` (no default for small muscles) |
| `StrengthAnalytics.adjustTargets(setTargets, id, dir, volume)` | new overrides object: `dir` +1/−1 shifts by `STEP`, 0 resets |

## Data it reads

- `docs.lb_workouts` (the full logger's workouts, array or `{id: doc}`) first: warm-ups and unchecked sets dropped, each set converted with its exercise's `unit` (lb → kg). Optional `docs.lb_exercises` gives names for custom exercises.
- `docs.workouts/{date}.sets` for everything else: Quick log, Strong imports and days before the logger. On a day both have, a lift the logger has is taken from the logger only, so the sets the logger merges into `workouts/{date}` are not counted twice. Sets without a `unit` use `opts.units[name]`, else kg.
- `docs.weights/{date}.kg` for body weight at the cut start and now.
- Logger exercise ids map to the plan names the shell uses ("Incline DB Press", "Lat Pulldown, Wide"...), so one lift stays one series whichever screen logged it.

## Options

`today`, `cutStart` (else `targets.start`), `targets` (an `AppTargets.resolve(...)` object), `units`, `mainLifts` (listed first and used for the cut check), `names` / `library` (extra logger id → name), `muscles` (overrides for unknown lifts), `volume` `{lo, hi}` (default 10–20), `weeks` (default 8). `setTargets` `{muscleId: {lo, hi}}` per-muscle target ranges that override `volume`; `onTargets(next)` is called when the user taps ▼ ▲ (shift the range by `STEP` = 2 sets) or ↺ (back to default) and should persist `next`. Without `onTargets` the card is read-only. Nothing about Aziz is hard-coded: the cut start comes from the profile.

## Method

- **Est. 1RM:** Epley, best working set per session. 1–12 reps exact formula, 13–20 marked `~`, above 20 or with no load no estimate (the set still counts toward volume). PR = beats every earlier session.
- **Sets per muscle:** rolling 7-day windows ending today. Primary muscle = 1 set, helper muscle = ½ (rows → biceps and rear delts, presses → triceps and front delts). Cardio is skipped; unknown names are listed, never guessed. Target range per muscle (default 10–20 sets/week for the 9 major muscles, any muscle can get its own) compared with the 4-week average: the bar turns amber **under**, green **on target**, red **over**.
- **Frequency:** days per week each muscle got direct sets, 4-week average.
- **Balance:** push (chest, front delts, triceps) vs pull (back, rear delts, biceps), quads vs hamstrings, front vs rear delts, and upper vs lower for reference. "Leans" past 1.5 : 1.
- **Strength during the cut:** per lift, baseline = best of the 2 sessions just before the cut start (within 21 days), else the first 2 in its first week; current = best of the 2 latest sessions (latest within 21 days and 14+ days after baseline). Up ≥ +2.5%, down ≤ −5%, else held. Also e1RM per kg of body weight. Before day 14, or with fewer than 3 lifts, it says "Too early". It never changes calories or targets.

## Wiring in the app

```js
document.head.insertAdjacentHTML("beforeend", "<style>" + StrengthAnalytics.css + "</style>");
// lb_workouts / lb_exercises: read once from the db (the logger's collections), keep in S.lb
const strengthOpts = () => ({ targets: APP_TARGETS /* AppTargets.resolve(prefs.main.profile, PLAN) */,
  cutStart: S.docs.prefs.main?.profile?.start, units: StrengthAnalytics.unitsFrom(PROGRAM), mainLifts: MAIN_LIFTS,
  setTargets: S.docs.prefs.main?.setTargets, onTargets: t => put("prefs", "main", { ...S.docs.prefs.main, setTargets: t }, { quiet: true }) });
// Progress tab, after the trend card:
const strength = window.StrengthAnalytics ? StrengthAnalytics.html({ ...S.docs, lb_workouts: S.lb?.workouts, lb_exercises: S.lb?.exercises }, strengthOpts()) : "";
```

The coach / 14-day review can call `StrengthAnalytics.summary(...)` or `analyze(...).cut` with the same arguments.

Tests: `node --test modules/strength-analytics/strength-analytics.test.js`. Preview with made-up example data: `preview.html`.
