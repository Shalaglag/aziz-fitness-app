# Trend weight + calorie burn (TrendTDEE)

A card for the Progress tab that smooths daily weigh-ins into a trend weight and, once there are 14+ days of data, estimates Aziz's real calorie burn (TDEE) from what was eaten versus how the weight moved. It feeds the Nov 7 calorie review.

Plain JS, no imports, no network. Global `TrendTDEE`.

| Function | Returns |
| --- | --- |
| `TrendTDEE.css` | CSS string, inject once (uses the app's tokens) |
| `TrendTDEE.series(weights, {today})` | `[{date, kg, trend}]`, one row per day from the first weigh-in to today; `kg` is null on days with no weigh-in |
| `TrendTDEE.estimate(docs, {today})` | `{status, ready, trendNow, trendDelta7, from, to, days, foodDays, weighIns, intakeAvg, rateKgWk, tdee, tdeeLo, tdeeHi, suggest:{lo,hi,keep}, readyOn, reviewOpen, notes}` |
| `TrendTDEE.html(docs, {today})` | one `.card` for the Progress tab |
| `TrendTDEE.summary(docs, {today})` | plain text to paste into a chat |

`docs` is the app's `S.docs` (`weights/{date}.kg`, `days/{date}.food[]` with `kcal` and `eaten`). `today` defaults to the device's local date.

## Method

- **Trend:** EWMA with alpha 0.1, seeded at the first weigh-in. Missing days are filled by straight-line interpolation between weigh-ins; after the last weigh-in the trend holds flat.
- **Burn:** average eaten kcal over logged days, minus the weight slope × 7,700 kcal/kg. The slope is a least-squares fit on raw weigh-ins (no EWMA lag) over the last 28 days, ending yesterday so a half-logged today never counts. The "likely" range is ± one standard error of the slope (capped at ±600 kcal).
- **Ready when:** 14+ days in the window, 10+ days with eaten food, 8+ weigh-ins. With the cut starting Oct 25, the first estimate is Nov 8, right after the Nov 7 review date.
- **Suggestion:** intake for 0.5–0.8 kg/week (the plan band), rounded to 50, never below 1,700. Before Nov 8 it only previews and says to hold 2,000.
- **Notes it raises:** unlogged days left out (usually Fridays), days with estimated items, first week of the cut in the window (water drop reads high), wide range.

## Wiring in the app

```js
document.head.insertAdjacentHTML("beforeend", "<style>" + TrendTDEE.css + "</style>");
// in the Progress render, after the weekly report:
const trend = window.TrendTDEE ? TrendTDEE.html(S.docs) : "";
```

Other modules can reuse it: GoalDate can pass `TrendTDEE.series(S.docs.weights)` as its trend, and DietBreak can take `E.ready ? {kcal: E.tdee, lo: E.tdeeLo, hi: E.tdeeHi} : null` from `TrendTDEE.estimate(S.docs)`.

Tests: `node --test modules/trend-tdee/trend-tdee.test.js`. Preview with example data: `preview.html`.
