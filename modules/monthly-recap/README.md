# Monthly recap card

One month of the cut on one card: kg lost, workouts, PRs, best streak of good days, protein hit rate and cardio, with a **Save as image** button that renders a 1080×1080 PNG through the Artifact `downloads` capability (falls back to showing the image inline so it can be long-pressed and saved on a phone). Plain JS, no imports or network, never writes anything.

- `monthly-recap.js`: the module (`MonthlyRecap`).
- `monthly-recap.test.js`: `node --test modules/monthly-recap/monthly-recap.test.js`

## What it counts (month = 1st → last day, never past today)

| Tile | Source |
|---|---|
| kg lost | Last weigh-in in the 7 days before the month (else the first in the month) → last weigh-in in the month |
| workouts | Distinct days with logged sets: `lb_workouts` (finished, non-warm-up, done sets) first, then `workouts/{date}.sets` |
| PRs | `StrengthAnalytics.analyze` points flagged `pr` inside the month (reuse). Without it: Epley on `workouts/{date}`, kg assumed, first-ever session never a PR |
| best streak | Longest run of `DailyScore.score(...).good` days in the month; an unfinished today never breaks the run |
| protein hit | Days with eaten food where protein ≥ `targets.proteinMin` (160 g default) |
| cardio | `cardio/{date}.sessions` (count, minutes, km) plus `days/{date}.treadmill` ticks on days with no cardio doc |

## API

```js
MonthlyRecap.compute(docs, opts)   // {ym, label, from, to, complete, empty, weight:{start,end,delta,n}, workouts:{count,sets}, cardio:{sessions,minutes,km}, protein:{logged,hit,pct,avg,target}, score:{available,bestStreak,currentStreak,goodDays,avg}, prs:[{name,date,e1rm,from,main,unit}], prCount}
MonthlyRecap.html(docs, opts)      // Progress card: ‹ › month nav (data-mr-month), 6 tiles, PR list, Save as image (data-mr-save), Copy summary (data-mr-copy), [data-mr-preview] holder
MonthlyRecap.summary(recap)        // plain text for the clipboard
MonthlyRecap.svg(recap, {name, footer, colors})  // the share card as SVG
MonthlyRecap.toPng(svg)            // Promise<Blob>, browser only
MonthlyRecap.save(recap, {downloads, name})      // -> {saved:true} | {saved:false, blob, url} | {saved:false, cancelled:true}
MonthlyRecap.months(docs, {today, start})        // months offered by the nav
```

`opts`: `today`, `ym` ("YYYY-MM"), `targets` (AppTargets object or `date => targets`), `sessionFor(date)`, `units`/`mainLifts` (forwarded to StrengthAnalytics), `strength`/`score` (module overrides, default `window.StrengthAnalytics` / `window.DailyScore`), `start` (cut start), `name` (title line on the image).

## In the app

Progress tab, after the Strength card. The shell keeps the chosen month in `view.mrYm`; `data-mr-save` calls `MonthlyRecap.save(MonthlyRecap.compute(S.docs, mrOpts()), {name})` and shows the PNG inline when the downloads capability is unavailable or declined.
