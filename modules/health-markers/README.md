# Health markers

Idea 29 from the app-ideas list (MacroFactor / Strong style "custom measurements"): track any number that isn't weight, food or lifts. Resting heart rate, blood pressure, waist, body fat, a blood test. Each marker has a unit, an optional reference range, a history and a chart.

## Files
- `health-markers.js`: plain JS, no imports, no network. Browser global `HealthMarkers` or CommonJS.
- `health-markers.test.js`: `node --test modules/health-markers/health-markers.test.js` (9 tests).

## Rules it keeps
- **Nothing is diagnosed.** A value outside the marker's own range gets a "Low"/"High" pill and a note in the toast; nothing else changes. Presets ship with common adult reference ranges that the user can edit or clear when adding the marker.
- **Blood pressure is one marker.** Kind `bp` is typed as `120/80`; systolic is `v`, diastolic `v2`. Both lines are charted. "High" when systolic is above the range or diastolic is above 65% of the systolic cut-off (85 for the default 130).
- **No invented values.** The 90-day average, low and high only count readings in the window; the chart falls back to the last 12 readings when the window is empty so an old lab result still shows.
- **Deleting a marker takes two taps**, since it removes the history too. Removing a single entry is one tap.

## Data
- `markers/{id}` (new synced collection, in the shell's `COLS` so backups and restores include it):
  `{id, name, unit, kind:"num"|"bp", low, high, decimals, preset, createdAt, entries:[{id, date, v, v2?, note?, at}]}`
- `id` is `slug(name)-uid`. One doc per marker; logging a value rewrites that doc (entries are small).
- Nothing is written to `days` or `prefs`.

## Wiring in the app shell (done in v27)
1. `"markers"` in `COLS`; `HealthMarkers` in the CSS-injection list.
2. Progress tab, after Cardio: `HealthMarkers.html(S.docs, {today, date, ...hmOpts})`.
3. Click handler: `HealthMarkers.handle(e.target, {docs:S.docs, date, toast, uid, put, remove, rerender})`, where `put`/`remove` clear `hmOpts` and `rerender(o)` sets `hmOpts=o` and renders. Buttons carry `data-hm="add"|"add-marker"|"open"|"close"|"log"|"del-entry"|"del-marker"`.
4. A `change` listener on `[data-hm-sel]` calls `HealthMarkers.onPresetChange(select)` to fill name/unit/range from the preset.
5. Coach / reports: `HealthMarkers.summary(S.docs, {today})` gives one line per marker with a reading.
