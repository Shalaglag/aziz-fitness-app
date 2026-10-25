# Daily steps

Steps per day for the Today tab: type the count by hand, or import a Health Connect CSV (Aziz is on Android). A goal card shows the count, a progress bar, what's left, and the 7-day average.

## Files
- `steps.js`: plain ES module, no imports, no network. Inline it the same way as `waterh-import.js` (strip `export`, wrap in an IIFE, expose `window.Steps`).
- `steps.test.mjs`: `TZ=Asia/Kuwait node --test modules/steps/steps.test.mjs` (8 tests).
- `sample-daily.csv`, `sample-health-connect-records.csv`: example exports used by the tests.

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

## Android: getting the CSV
1. Make sure the phone's step counter (Google Fit, Samsung Health, or the watch app) writes Steps to Health Connect: Settings → Health Connect → App permissions.
2. Install a Health Connect exporter (e.g. "Health Data Export" on Play), export **Steps** as CSV, and pick the file in **Import from Health Connect** on the Steps card.
3. Day to day, typing the number from the phone's step widget into the card is quicker.
