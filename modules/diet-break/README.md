# Diet breaks

Plans a 1–2 week maintenance break after every 8–12 weeks of cutting and tells the app which calorie target applies on any day. Nothing about one person is built in: it adapts to whoever is using it.

## Files

- `diet-break.js`: the module (global `DietBreak`, plain JS, no imports or network).
- `diet-break.test.js`: `node modules/diet-break/diet-break.test.js` (17 tests).
- `preview.html`: the card with the app's styles; type any weight, goal and calories to see the plan change.

## What adapts

- **Maintenance (TDEE):** `TrendTDEE.estimate()` when that module is inlined; otherwise the person's own logged food minus their weight trend (last 28 days, skipping the first cut week and break days); before there is enough data, `profile.maintenance`, then ~30 kcal per kg of body weight.
- **Cut calories:** `profile.cutKcal`, else the person's own average intake (7+ logged days), else 80% of maintenance.
- **When breaks come:** set by the deficit. 25%+ deficit: every 8 weeks. 15–25%: every 10. Under 15%: every 12. **How long:** 2 weeks at 20%+ deficit, else 1. Sooner/Later and the 1/2-week buttons override this; "Adapt automatically" goes back.
- **Early break:** from week 8, losing under 0.25% of body weight in 2 weeks while eating on target suggests starting the break now. Stalls before week 8 are treated as water.
- **Macros on a break:** `profile.protein`/`fat`, else 1.8 g/kg protein and 0.8 g/kg fat (goal weight, capped at 85% of current); the extra calories go to carbs.
- **Goal:** with `profile.goalKg` it projects the goal date (observed rate after 2 weeks, else the deficit; 0.25–1.25% of body weight a week) and plans no break the last stretch doesn't need. Without a goal it keeps planning breaks ahead.
- **Automatic or manual:** `auto: true` (default) starts planned breaks on their own; `auto: false` keeps the cut target until the person taps **Start break today**.

## API

```js
DietBreak.css                                          // inject once
DietBreak.build(docs, state, {today, tdee, profile})   // full plan object
DietBreak.target(docs, state, date, {profile})         // {mode:"cut"|"break"|"maintain", kcal, lo, hi, protein, carbs, fat}
DietBreak.html(docs, state, {today, profile})          // card HTML
DietBreak.apply(state, action, today, docs, {profile}) // new state; actions from data-db-action
```

- `docs` is `{days, weights}` from the app.
- `profile` (all optional): `{start, startKg, goalKg, cutKcal, protein, fat, maintenance}`. `start` defaults to the first logged day and `startKg` to the first weigh-in. The host app passes the user's own settings here.
- `state` is stored by the host at `prefs/main.dietBreak` (`{}` to start): `{blockWeeks, breakWeeks, auto, breaks:[{start,end}]}`. `null` lengths mean "adapt".

## Integrating into the app

1. Inline `diet-break.js` (after `trend-tdee.js` if present) and inject `DietBreak.css`.
2. Build `profile` from the user's settings (not constants in the module).
3. Render `DietBreak.html(docs, prefs.dietBreak || {}, {today, profile})`.
4. On clicks of `[data-db-action]`: `prefs.dietBreak = DietBreak.apply(prefs.dietBreak || {}, el.dataset.dbAction, today, docs, {profile})`, save, re-render.
5. Use `DietBreak.target(docs, prefs.dietBreak || {}, date, {profile}).kcal` as the day's calorie goal.
