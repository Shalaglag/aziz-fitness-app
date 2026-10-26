# Calorie cycling: eat more on lift days

Same calories for the week, more on the days you lift, less on rest days. Protein and fat never move; carbs carry the swing. Generic: every number comes from the AppTargets object and the saved state.

## Files
- `calorie-cycling.js`: global `CalorieCycling`, plain JS, no imports or network.
- `calorie-cycling.test.js`: `node --test modules/calorie-cycling/calorie-cycling.test.js` (12 tests).

## State (host stores `prefs/main.cycling`)
`{on:false, delta:150, trainDays:[0,1,2,3,4,6]}` by default: off, +150 kcal on a lift day, every weekday but Friday lifts. `delta` steps by 50 between 50 and 400.

## The rule
- Lift day = base + delta. Rest day = base − delta × nTrain / nRest, rounded so the 7 days sum exactly to base × 7.
- A rest day never drops more than 300 kcal below base; delta is capped (and the card says so). With 6 lift days and 1 rest day that caps delta at +50.
- Carbs: ±delta/4 g on the plan range. Protein and fat unchanged.
- `opts.training(date)` lets the host answer true/false for a date (a logged workout or logged rest day); `null` falls back to the weekday pattern.

## API
```js
CalorieCycling.css
CalorieCycling.defaults(opts) / normalize(state, opts)
CalorieCycling.plan(targets, state, opts)          // {on, base, weekKcal, nTrain, nRest, delta, restDelta, trainKcal, restKcal, trainCarbs, restCarbs, clamped, reason}
CalorieCycling.isTraining(date, state, opts)
CalorieCycling.target(targets, date, state, opts)  // {kcal, kind:"train"|"rest"|"flat", delta, carbsLo, carbsHi}
CalorieCycling.apply(state, action, opts)          // on | off | more | less | day:<0-6>
CalorieCycling.html(targets, state, opts)          // card; buttons carry data-cc-action
```
`targets` is `AppTargets.resolve(...)` (needs `kcal`; `carbsLo/carbsHi` optional).

## In the app
Card at the bottom of the Food tab. `kcalTarget(date)` uses the cycled target as its base (diet break still wins; budget-recovery cuts still apply on top, floor base − 150). The Food verdict says "Lift day: target 2,150 (+150 kcal, carbs)" or the rest-day equivalent. Macro bars, DailyScore, Coach, DailyDashboard and ProteinGap all read `kcalTarget`, so they follow.
