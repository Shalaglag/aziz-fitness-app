# Trend compare

Overlay any two logged series on one chart (the MacroFactor "compare" idea) with a plain-language correlation note. Lives on the Progress tab after the Strength card.

## Series
Built from the app's own collections, one point per day, dates after `today` dropped:

| key | label | unit | source |
|---|---|---|---|
| `trend` | Trend weight | kg | `opts.trend` (TrendTDEE.series) or an EWMA 0.1 of `weights` |
| `weight` | Scale weight | kg | `weights/{date}.kg` |
| `kcal` | Calories eaten | kcal | `days/{date}.food` rows marked eaten |
| `protein` | Protein eaten | g | same, `p` |
| `steps` | Steps | steps | `days/{date}.steps` (number or `{count}`) |
| `sleep` | Sleep | h | `days/{date}.sleep` |
| `cardio` | Cardio minutes | min | `cardio/{date}.sessions[].min` |
| `lift:<key>` | Est. 1RM · lift | kg/lb | `opts.lifts` (StrengthAnalytics.analyze().lifts) or Epley on `workouts/{date}.sets` |

## API
- `TrendCompare.css` – inject once; uses the app tokens (`--accent` for A, `--protein` for B).
- `TrendCompare.series(docs, {today, trend, lifts})` → `[{key, label, unit, points:[{date, v}], lift?}]`.
- `TrendCompare.correlate(a, b, {today, range})` → `{n, r, strength: none|weak|moderate|strong, dir: same|opposite, note}`. Pearson r on same-day pairs; needs 7 pairs (`MIN_PAIRS`), otherwise `r` is null and the note says why. The note always says it is a same-day link, not cause.
- `TrendCompare.chart(a, b, {today, range})` → SVG. A on the left axis, B on the right, each scaled to its own range; dots on sparse series; bigger dot on the last point.
- `TrendCompare.html(docs, {today, trend, lifts, a, b, range, pick, onPick})` → `<section class="card tc-card">` with two series pickers, a range picker (14 / 28 / 90 days / all time, `RANGES`), the chart and the note. Defaults: trend weight vs steps, last 28 days. The pickers re-draw the card body themselves (one document `change` listener); `onPick({a,b,range})` is called after each change so the host can persist it, and `pick` seeds the first render. Needs at least two logged series, otherwise shows a hint.
- `TrendCompare.summary(docs, opts)` → one line for the coach or a chat.

## In the app
Shell `tcOpts()` passes `trendSeries()`, `StrengthAnalytics.analyze(...).lifts`, and persists picks in `prefs/main.trendCompare` (quiet put, no re-render).

## Tests
`node --test modules/trend-compare/trend-compare.test.js`
