# Daily steps

Steps per day for the Today tab: type the count by hand, or import an export from Health Connect or from the step app itself (Samsung Health, Fitbit, Garmin, Google Fit, Apple Health). Aziz is on Android, so Health Connect is the main hub. A goal card shows the count, a progress bar, what's left, and the 7-day average.

## Files
- `steps.js`: plain ES module, no imports, no network. Inline it the same way as `waterh-import.js` (strip `export`, wrap in an IIFE, expose `window.Steps`).
- `steps.test.mjs`: `node --test modules/steps/steps.test.mjs` (11 tests; the file pins `TZ=Asia/Kuwait` itself because zoned timestamps go to the local day; on Windows set `TZ` in the shell or the zone test skips).
- `samples/`: one example export per supported app, used by the tests.

## Data
- `days/{date}.steps = {count, at, source}`, where source is `"manual"`, `"csv"` or `"line"`. `stepCount(day)` also reads a bare number.
- `prefs/main.stepGoal` (default 10,000; `stepGoal(prefs)` clamps bad values).
- Importing a day again replaces its count, so syncing twice never double counts.
- Health Connect record exports list phone and watch separately. Records are summed per source and the day takes the biggest source, so phone + watch are never added together.
- Timestamps with a zone (`...Z`, `+03:00`) are moved to the device's local day before grouping.

## Exports
`parseSteps(text, now?) → [{date, steps, source}]`, `setSteps(day, n, source?, now?)`, `addSteps(day, delta, now?)`, `applySteps(day, row, now?)`, `stepCount(day)`, `stepGoal(prefs)`, `stepProgress(day, goal)`, `weekSteps(getDay, date, goal)`, `stepsCardHTML(day, {goal, week})`, `DEFAULT_GOAL`.

## Wiring in the app shell
Card, next to the Water card on Today:
```js
const goal = Steps.stepGoal(prefs);
html += Steps.stepsCardHTML(day, { goal, week: Steps.weekSteps(getDay, date, goal) });
```
Click handler (`data-act`):
```js
else if(a==="stepsadd"){ put("days", date, Steps.addSteps(getDay(date), +t.dataset.n)); }
else if(a==="stepsset"){ const n=Steps.parseSteps(document.getElementById("stepsInput").value)[0]; if(n) put("days", date, Steps.setSteps(getDay(date), n.steps)); }
else if(a==="stepsimport"){ applyStepsText(document.getElementById("stepsText").value); }
else if(a==="stepsgoal"){ prefs.stepGoal=Steps.stepGoal({stepGoal:document.getElementById("stepsGoalInput").value}); put("prefs","main",prefs); }
```
Change handler: `#stepsFile` → read the file as text → `applyStepsText(text)`, where
```js
function applyStepsText(text){
  const rows=Steps.parseSteps(text);
  if(!rows.length) return toast("No step counts found");
  rows.forEach(r=>put("days", r.date, Steps.applySteps(getDay(r.date), r), {quiet:true}));
  render(); toast(rows.length===1 ? `Steps: ${rows[0].steps.toLocaleString()} on ${fmt(rows[0].date)}` : `Steps imported for ${rows.length} days`);
}
```
Note: the bare-number path of `parseSteps` dates the count *today*; for the Set button use the selected `date` as above.

## Supported apps and formats
The format is detected from the file; there is no app picker. `STEP_SOURCES` holds the how-to text the card shows for each.

| App | Best route | Direct file it reads |
|---|---|---|
| Any app that syncs to Health Connect (Google Fit, Fitbit, Samsung Health, Garmin, Mi Fitness, Zepp, Oura, …) | Turn on Health Connect sync in the app, export Steps with a Health Connect exporter app | Exporter CSV: daily `Date,Steps`, records `start_time,end_time,count,data_origin`, or long `time,type,value` |
| Samsung Health | Settings → Download personal data | `com.samsung.shealth.step_daily_trend.*.csv` (uses the combined row), or `com.samsung.health.step_count.*.csv` (UTC times + `time_offset`) |
| Fitbit | Data export / Google Takeout → Fitbit | `steps-YYYY-MM-DD.json` (per-minute, summed), account export CSV (`Activities` section) |
| Garmin Connect | Web → Reports → Steps → Export | Report CSV `,Actual,Goal`, or `UDSFile_*.json` (`calendarDate`, `totalSteps`) |
| Google Fit | Google Takeout → Fit | `Daily activity metrics.csv` (`Step count`) |
| Apple Health | Export All Health Data | `export.xml` |

Zip files must be unzipped first (no decompression in the module). Menu names in these apps move around between versions; the file formats are what the parser keys on.

## Day to day on Android
Typing the number from the phone's step widget is quickest. Use a file import for back-fill or a weekly catch-up.
