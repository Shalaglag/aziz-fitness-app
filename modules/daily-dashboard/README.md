# Daily dashboard and calendar

Feature 11 of the app plan: one card at the top of Today with everything for the day, plus a month calendar for the whole app (not just lifts). Plain JS, no imports, no network. Global `DailyDashboard`.

- `daily-dashboard.js`: the module.
- `daily-dashboard.test.js`: tests, run with `node modules/daily-dashboard/daily-dashboard.test.js` (20 cases).
- `apply-patch.js`: inlines it into the app. `node modules/daily-dashboard/apply-patch.js app/index.html [out.html]`. Each step is an exact-text swap and stops if the app has drifted.

## What Aziz sees

**Today at a glance** (top of Today, follows the shared date picker). A scoreboard (Aziz picked it Nov 2, 2026):

- Calorie strip: the day's target split by meal slot, eaten solid, planned hatched, with "plan leaves …" (tap: Food).
- Four big numbers: kcal left (red when over), protein to go ("Hit" once reached), water with a +250 ml button, weight with change and 7-day average ("Not logged" with the last reading when missing).
- Workout row: session, sets / exercises / minutes / cardio once logged, sleep, readiness and last effort underneath, Start / Done / Pick button (tap: Train). Recovery flags (short sleep, a 9–10 effort in the last 2 days, 4+ lifting days in a row, low readiness) show under it.
- "Your day ›" (`data-act="dd-day"`) opens Progress → Your day.

**Your day** (`dayHtml`, Progress → Your day): the day as a timeline. Weigh-in and sleep, each meal slot with its items, and the workout placed at its time (`opts.trainTime(date)` → "15:30", from the phone reminders); a Now box with kcal and protein left and water squares sits before the first open step on today; past days end with a Total and mark what was missed. `day(docs, date, opts)` returns the same as data.

**Calendar** (under the daily score). Each day shows the session (filled = lifted, orange label = a chosen session with nothing logged, grey = planned from the rotation) and dots for weigh-in, calories on target / over / under, protein hit, water hit. Arrows change month; tapping a day opens it in every tab. The footer totals the month.

## Rules

- Calories and protein left count only food ticked as eaten. Planned items appear separately ("plan leaves …").
- Targets come from `opts.targets` (an `AppTargets.resolve()` object). The day's calorie target (`opts.kcalTarget`, diet break / budget recovery) wins over `targets.kcal`. No target set means the tile says so; nothing falls back to built-in numbers.
- Workouts read the full logger's `lb_workouts` first (working sets only, warm-ups and unfinished sets skipped), then `workouts/{date}`.
- Cardio: `days/{date}.treadmill` or a `cardio/{date}` doc counts; minutes come from `cardio/{date}.durationMin` when present.
- Future days project the rotation one step per day from the last chosen session, skipping free weekdays (Friday by default).
- Missing data reads as missing. Nothing is estimated.

## Plugging into the app

`apply-patch.js` does all of this:

```js
function ddOpts(){ return {today:TODAY, selected:view.date, targets:ddTargets(), kcalTarget:kcalTarget,
  waterGoal:(d,training)=>training?3500:3000, rotation:ROTATION, sessionFor:x=>sessionFor(x),
  exerciseCount:s=>(PROGRAM[s]||[]).length||null, lbWorkouts:S.docs.lb_workouts,
  readiness:window.RecoveryFatigue?(x=>RecoveryFatigue.readiness(S.docs,{date:x})):undefined}; }
// Today: first thing
DailyDashboard.glanceHtml(S.docs, view.date, ddOpts())
// Today: after DailyScore
DailyDashboard.calendarHtml(S.docs, view.calYm || view.date.slice(0,7), ddOpts())
// click handler on main
caldate  -> view.date = el.dataset.d; view.calYm = null; render()
calmonth -> view.calYm = el.dataset.ym; render()
dd-focus -> focus #<data-target> (wkg, sleepH)
```

`ddTargets()` uses `AppTargets.resolve(prefs.main.profile, plan)` when AppTargets is inlined, else the shell's `TARGET`. Styles: add `"DailyDashboard"` to the list of modules whose `.css` is injected.

Data only: `glance(docs, date, opts)` and `month(docs, ym, opts)` return plain objects (for the AI coach or the 14-day review).
