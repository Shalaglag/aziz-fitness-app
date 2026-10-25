# Diet breaks

Plans a 1–2 week maintenance break after every 8–12 weeks of cutting (default: 10 weeks at 2,000 kcal, then 2 weeks at maintenance) and tells the app which calorie target applies on any day.

With no data the plan is: cut Oct 25, 2026 → Jan 2, 2027, break Jan 3 → Jan 16 at ~2,800 kcal, cut again from Jan 17, projected 80 kg around Mar 4, 2027 (one break). The dates and goal update as weigh-ins come in.

## Files

- `diet-break.js`: the module (global `DietBreak`, plain JS, no imports or network).
- `diet-break.test.js`: `node modules/diet-break/diet-break.test.js` (14 tests).
- `preview.html`: the card with the app's styles; change the date to see each phase.

## How it works

- **Break calories = maintenance (TDEE).** Uses `TrendTDEE.estimate(docs, {today})` from the trend-weight module when it is inlined (ready from ~Nov 8). Before that it uses its own estimate (eaten kcal minus the weight trend × 7,700, skipping week 1 water loss), and with too little data the plan's ~2,800.
- **Break macros:** protein stays 160 g, fat ~70 g, the extra calories go to carbs.
- **Automatic or manual.** By default (`auto: true`) breaks start on their own on the planned date and `target()` switches the day's goal from 2,000 to maintenance and back. With `auto: false` the target stays 2,000 until Aziz taps **Start break today**; once the planned date passes, the card shows the break as due.
- **Early break:** from week 8 of a block, if raw weigh-ins dropped under 0.2 kg in 2 weeks while eating ≤2,150 kcal, the card suggests starting now. Stalls before week 8 are treated as water.
- **No break before the goal** when the last stretch to 80 kg is shorter than a full block.

## API

```js
DietBreak.css                                // inject once
DietBreak.build(docs, state, {today, tdee})  // full plan object
DietBreak.target(docs, state, date)          // {mode:"cut"|"break"|"maintain", kcal, lo, hi, protein, carbs, fat}
DietBreak.html(docs, state, {today})         // card HTML
DietBreak.apply(state, action, today)        // new state; actions from data-db-action
```

`docs` is `{days, weights}` from the app. `state` is stored by the host at `prefs/main.dietBreak` (`{}` to start): `{blockWeeks, breakWeeks, auto, breaks:[{start,end}]}`; actions `auto:on` / `auto:off` flip the mode.

## Integrating into the app

1. Inline `diet-break.js` (after `trend-tdee.js` if present) and inject `DietBreak.css`.
2. Progress tab: render `DietBreak.html(docs, prefs.dietBreak || {}, {today})`.
3. Delegate clicks on `[data-db-action]`: `prefs.dietBreak = DietBreak.apply(prefs.dietBreak || {}, el.dataset.dbAction, today)`, save `prefs/main`, re-render.
4. Today/Food tabs: replace the fixed 2,000 kcal target with `DietBreak.target(docs, prefs.dietBreak || {}, date).kcal` (and show "Diet break" when `mode === "break"`). Weekly report's on-target range could use the same `lo`/`hi`.
