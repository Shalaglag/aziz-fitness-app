# Lift goals with a projected date (LiftGoals)

One card for the Train tab: a goal per lift ("Bench Press 100 kg × 1", "Hack Squat 180 kg × 8"), a progress bar on the lift's est. 1RM, the weekly rate and the date the trend reaches the goal. Plain JS, no imports, no network. Global `LiftGoals`.

| Function | Returns |
| --- | --- |
| `LiftGoals.css` | CSS string, inject once (uses the app's tokens) |
| `LiftGoals.empty()` | `{goals: []}`, the shape stored in `prefs/liftGoals` |
| `LiftGoals.add(state, {name, w, r, unit, by})` | new state; `w` in the lift's unit, `r` default 1 (1–20), `by` optional ISO date. One goal per lift: adding again replaces it |
| `LiftGoals.remove(state, id)` | new state |
| `LiftGoals.project(state, lifts, {today})` | one row per goal (see below) |
| `LiftGoals.html(state, lifts, {today, names})` | the `.card`; `names` adds plan lifts not logged yet to the picker |
| `LiftGoals.handle(el, {state, root})` | `{state, toast}` for a click on `[data-lg]` (add / remove), else `null` |
| `LiftGoals.onChange(el)` | picker change: shows the "Other lift" input, sets the unit to the lift's |

`lifts` is `StrengthAnalytics.analyze(docs, opts).lifts` (or the whole result): `{name, unit, points:[{date, e1rm}]}`. Goals match lifts by a case- and punctuation-insensitive name key, so "bench press barbell" finds "Bench Press (Barbell)".

## Method

- **Target:** the goal load × reps is turned into an est. 1RM with Epley (1 rep = the load itself), in kg internally; lb goals convert at 0.45359237. Reps above 20 are not accepted.
- **Progress:** best session est. 1RM ÷ target, 0–100%. Reached when any session meets the target (date shown).
- **Date:** least-squares line through the est. 1RM of every session in the last 56 days, needing 3+ sessions spanning 14+ days. Rate = slope × 7. The gap is taken from the fitted value today, not from one good or bad day. Status `early` before that, `stalled` when the rate is ≤ +0.05 kg/wk or the date is more than 2 years out, `none` when the lift was never logged.
- **Target date (optional):** `needPerWeek` = gap ÷ weeks left; `onTrack` = projected date ≤ target date.

## Wiring in the app

```js
// prefs/liftGoals holds the state
const lgState = () => S.docs.prefs.liftGoals || LiftGoals.empty();
const lgLifts = () => window.StrengthAnalytics ? StrengthAnalytics.analyze(S.docs, strengthOpts()).lifts : [];
// Train tab
safeMod("LiftGoals", () => LiftGoals.html(lgState(), lgLifts(), { today: TODAY, names: MAIN_LIFTS }));
// click
const r = LiftGoals.handle(e.target, { state: lgState() }); if (r) { put("prefs", "liftGoals", r.state); if (r.toast) toast(r.toast); }
// change
LiftGoals.onChange(e.target);
```

Tests: `node --test modules/lift-goals/lift-goals.test.js`.
