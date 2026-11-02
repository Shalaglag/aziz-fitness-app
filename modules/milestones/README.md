# Milestones

Small, once-only celebrations: a weight number reached **on the trend** (not a single weigh-in), strength round numbers, workouts logged and food-logging streaks. Works for cut, gain and maintenance plans. Plain JS, no imports, no network. Global `Milestones`.

## Files
- `milestones.js`: the module. `milestones.test.js`: `node --test modules/milestones/milestones.test.js` (5 tests).

## Rules
- **Weight:** each milestone of the saved plan (`prefs/main.goalSetup.result.milestones`) counts when the trend line has been at or past it for 3 consecutive days, dated the first of those days; direction follows the plan. The final one reads "Goal reached".
- **Maintenance plans:** "N weeks steady" every 4 weeks the trend stayed within ±1 kg of the plan weight.
- **Strength:** a lift's est. 1RM (from `StrengthAnalytics.analyze().lifts`) crossing a round number: every 20 kg from 40 (50 lb from 100 for lb lifts). Numbers already held on the first session are skipped.
- **Consistency:** workouts logged in total (10, 25, 50, 100, 150, 200, 300, 500; quick log and the full logger merged by date) and days in a row with food logged (7, 14, 30, 60, 100, 200, 365).
- **Once each:** `seen` (`prefs/main.milestones`, `{id: date}`) is the record. `fresh` = reached in the last 3 days and unseen → one toast. Everything older is marked quietly, so an install with history never gets a burst of old toasts.
- **Display:** a collapsed "Milestones" fold on Today with the latest four and a "Next up" line (next weight number with kilos to go, next workout count, next streak). The pop animation runs only under `prefers-reduced-motion: no-preference`.
- Nothing here changes targets or the plan.

## API
```js
Milestones.detect(docs, {today, plan, trend, lifts, seen, workoutDates}) // {all, fresh, unseen, next}
Milestones.mark(seen, items, today)                                     // new seen map
Milestones.html(R, {today, max})                                        // the card ('' when nothing to show)
Milestones.toastText(item)                                              // "🎯 90 kg on the trend"
Milestones.css
```
`trend` is `TrendTDEE.series(weights, {today})`; `docs` needs `weights`, `days`, `workouts` and optionally `lb_workouts`.

## In the app
`milestonesR()` builds the result each render, `milestonesCard()` renders the fold on Today, and `celebrateMilestones()` (end of `render()`, after sync) toasts the first fresh item and marks all unseen ones in `prefs/main.milestones`.
