# Plan check: the two-week re-check and the weekly "vs plan" line

Plain JS, no imports, no network. Inline `plan-check.js` (exposes `window.PlanCheck`). Generic: reads the saved goal plan (`prefs/main.goalSetup`, from [goal-setup](../goal-setup/README.md)), the current targets (AppTargets) and the trend estimate (TrendTDEE). Ships no numbers of its own.

## What it does
- **Re-check, every two weeks.** 14+ days after the plan (or the last decision) and once TrendTDEE is ready (14+ days, 10+ logged food days, 8+ weigh-ins), it compares the *estimated* maintenance from the logs with the formula's number, recomputes the plan at the same pace through `GoalSetup.compute(answers, {maintenance})`, and offers **Use N kcal / Keep / Ask again in a week**. Under 100 kcal of difference it says "keep" and offers no change. It waits, saying why, when food is logged on fewer than 65 % of days or the burn range is wider than ±250 kcal. Always "estimate", never "real burn". Nothing changes without a tap; applying moves calories, maintenance, protein, fat and floor only, keeping the start date, start weight and goal.
- **Weekly report line.** `weekLine` compares the two-week trend change (one-week when that is all there is, 4+ weigh-ins needed) with the plan's pace: on plan (60–150 % of it), slower, faster, not moving, or steady/drifting for a maintenance plan. Every line says a single week never changes targets and does not claim water as the cause.

## API
- `recheck(docs, {today, plan, targets, tdee, compute})` → `{status:'none'|'waiting'|'ready'|'decided', reasons, since, nextAt, estimate:{kcal,lo,hi,trendNow}, formulaTdee, currentKcal, proposed, delta, verdict:'keep'|'offer', window}`
- `decide(plan, R, 'apply'|'keep'|'later', today)` → `{plan, profile|null}` to store
- `html(R, {canApply})` → the Progress card (`data-pc` buttons)
- `weekLine(docs, {today, plan, trend})` → `[cls, label, text]` for `WeeklyReport.html(docs, {planLine})`
- `css`

## In the app
Shell: `planCheck()`, `planDecide()`, `planWeekLine()`, `planCheckNudge()` (Today note with "See it" when ready), card at the top of Progress → Reviews, `tdeeOpts()` now passes `start: START.date` so the trend window begins at the plan's start. Stored in `prefs/main.goalSetup.recheck = {at, decision, estimate, estimateLo, estimateHi, from?, to?, nextAt?}`.

## Tests
`node --test modules/plan-check/plan-check.test.js` (uses the real TrendTDEE and GoalSetup). Phone walk-through in `tests/app-phone.test.js` ("plan check").
