# Back to maintenance (ReverseDiet)

Plans the climb from the cut calories back up to maintenance once the trend weight reaches the goal, one weekly step at a time, and checks the trend before every step. Nothing about one person is built in: goal, cut calories, maintenance and macros come from the host's profile and logs.

Files: `reverse-diet.js` (plain JS, no imports, global `ReverseDiet`), `reverse-diet.test.js` (`node --test modules/reverse-diet/reverse-diet.test.js`).

## Rules
- **Trigger:** the trend weight (EWMA 0.1 with gaps interpolated, same line as TrendTDEE and GoalDate; pass `opts.trend` to share it) crosses `profile.goalKg`. `auto: true` (module default) starts the reverse that day; the app passes `auto: false`, so the card offers **Start the reverse today** and the cut target stays until the user taps it.
- **Maintenance:** `opts.tdee` from `TrendTDEE.estimate()` when ready, else `profile.maintenance`, else about 31 kcal per kg of goal weight (28–34 range).
- **Steps:** from `profile.cutKcal` (else the 28-day average intake) to maintenance in weekly steps of 100–150 kcal, 2–10 weeks, rounded to 50, the last week landing exactly on maintenance. The plan is locked in state at Start so a changing estimate does not move it.
- **Drift check** at every completed week: trend more than 1 % of goal weight above the goal → hold that step; more than 2 % above → step back one week; otherwise step up. Checks are recomputed from the weigh-ins, so nothing is stored but the start.
- **Macros on the way up:** `profile.protein`/`fat`, else 1.8 g/kg and 0.9 g/kg of goal weight; the rest is carbs.
- **At maintenance:** target = locked maintenance; a drift of more than 2 % either way is called out on the card.

## API
```js
ReverseDiet.css                                            // inject once
ReverseDiet.plan(docs, state, {today, profile, tdee, trend}) // {status:"off"|"cutting"|"ready"|"reverse"|"maintain", kcalToday, steps, checks, ...}
ReverseDiet.target(docs, state, date, opts)                // {mode:"cut"|"reverse"|"maintain", kcal, lo, hi, protein, carbs, fat, week, weeks}
ReverseDiet.html(docs, state, opts)                        // the card
ReverseDiet.apply(state, action, today, docs, opts)        // start | cancel | auto | manual | faster | slower
```
`docs` is `{days, weights}`. `state` lives at `prefs/main.reverseDiet` (`{}` to start): `{auto, started, startKg, fromKcal, toKcal, weeks, stepKcal, toSource}`. `profile` is `{goalKg, cutKcal, maintenance, protein, fat}`, all optional.

## In the app
Card on Progress after Diet breaks. `kcalTarget(date)` uses the reverse target (mode `reverse` or `maintain`) before the diet break and budget adjustments, so macro bars and the verdict follow the step. Clicks on `[data-rd-action]` go through `apply` and save `prefs/main.reverseDiet` with `auto:false`.
