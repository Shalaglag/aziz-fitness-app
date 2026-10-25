# Goal date to 80 kg

Projects the date Aziz reaches 80 kg from his weight trend, with milestones at 90, 85 and 80 kg. Meant for the Progress tab (full card) and the Today tab (one line).

Files: `goal-date.js` (plain JS, no imports, global `GoalDate`), `goal-date.test.js` (`node modules/goal-date/goal-date.test.js`), `preview.html` (open in a browser, example data).

## How it works
- **Trend:** EWMA, alpha 0.1, on a daily series with gaps filled by linear interpolation. Same smoothing as the trend weight module (`TrendTDEE.series`); pass that series as `opts.trend` and both features share one trend line.
- **Rate:** least-squares slope on raw weigh-ins over the last 28 days (the EWMA lags), anchored at the last weigh-in's trend value.
- **Before there is enough data** (5+ weigh-ins across 14+ days, so from about Nov 8): dates use the plan pace of 0.5–0.8 kg a week and say so.
- **Range:** slope ± one standard error, shown as "likely Feb 22 – Mar 5, 2027".
- **Stalled:** no date when the 28-day or the last-14-day rate is under 0.1 kg a week.
- **Water note:** losing faster than 1.2 kg a week in the first 4 weeks says the date will likely move later.
- **Milestones** count as reached when the trend (not a single weigh-in) crosses them.

## API
```js
GoalDate.css                                   // inject once; uses the app's tokens
GoalDate.project(S.docs.weights, {today, trend}) // {status, current, ratePerWeek, goalDate, range, weeksLeft, pctDone, milestones, note}
GoalDate.html(S.docs.weights, {today, trend})    // Progress card body
GoalDate.compact(S.docs.weights, {today, trend}) // Today line ("" when no weigh-ins)
```
`status` is `empty`, `plan`, `trend`, `stalled` or `reached`.

## Wiring into the app
```js
document.head.insertAdjacentHTML("beforeend", "<style>" + GoalDate.css + "</style>");
const gdOpts = () => ({ today: TODAY, trend: window.TrendTDEE ? TrendTDEE.series(S.docs.weights, { today: TODAY }) : undefined });
// Progress tab, next to the "Weight trend" card:
`<div class="card"><h3>Goal date</h3>${GoalDate.html(S.docs.weights, gdOpts())}</div>`
// Today tab, under the weight input:
GoalDate.compact(S.docs.weights, gdOpts())
```
