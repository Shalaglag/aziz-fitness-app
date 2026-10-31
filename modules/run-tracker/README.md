# Run tracker (GPS runs with a route map)

Records an outdoor run from the phone's GPS, draws the route as a map while you run, saves it with km splits, and offers the route in Google Maps and as a GPX file. Extends the cardio module: every finished run is also a `cardio/{date}` session of kind `run`, so Cardio progress, the weekly report and the coach count it.

## What the user sees
- **Train tab: "Outdoor run" card** (under the Cardio card). **▶ Start GPS run** asks the browser for location and shows live time, km and pace with the route drawn as it grows (Pause / Resume, **Finish & save**, Discard). Saved runs for the day list distance, time, pace, climb, the route map with km markers, the splits, a **GPX** download and **Open route in Google Maps ↗** (a walking-directions link along up to 9 points of the route).
- **Import GPX**: when location is blocked where the app runs (an embedded page may not get GPS), export the run from Strava, Garmin, Google Fit or any watch app and import the `.gpx` file. It is saved the same way, marked "imported".
- **Progress tab: "Running" card**: km this week vs last, best pace over a km, longest run, totals, and the last 5 runs with their maps.

## Rules
- A GPS fix is skipped when its accuracy is worse than 35 m, when it implies more than 8 m/s since the last kept fix (a jump), or when it moved under 2.5 m (standing jitter).
- Pace and time are **moving time**: a gap of more than 60 s between fixes (a pause, a traffic light) counts for distance but not time. Pause also stops recording.
- Splits are per km, interpolated where the km line was crossed. Climb is the sum of positive altitude steps.
- Routes are thinned to at most 600 points before saving. No network, no map tiles: the map is drawn from the points (equirectangular projection). Google Maps opens in a new tab from the link.
- The screen is asked to stay awake during a run (`navigator.wakeLock`) when the browser allows it.

## Data
- New collection **`runs/{date}`** = `{date, runs:[{id, date, startAt, km, sec, paceSec, gain, maxKmh, splits:[{km, sec, t}], pts:[[lat, lng, ele|null, tSec]…], source:"gps"|"gpx", name?}]}`.
- **`cardio/{date}`** gets a session `{id:"run-<runId>", kind:"run", min, km, speed, kcal (ACSM estimate from pace and body weight), source:"gps"|"gpx", runId}` through `Cardio.clean` / `Cardio.withSession`. Deleting a run removes both.

## Wiring in the app shell
```js
// COLS gets "runs"; S.docs.runs = {}
html += safeMod("RunTracker", () => RunTracker.cardHTML(view.date, S.docs));          // Train, after Cardio
html += safeMod("RunTracker", () => RunTracker.progressHTML(S.docs, {today: TODAY}));  // Progress, after Cardio progress
// click delegate, before the data-act chain
if (RunTracker.handle(e.target, {docs: S.docs, date: view.date, toast, weightKg: latestKg(),
      put: (c, id, doc) => put(c, id, doc, {quiet: true}), rerender: () => render()})) return;
```
The live card updates itself every second by element id (`RunTracker.tick()`); the host only re-renders on start, pause, finish and discard. `RunTracker.summary(docs, {today})` gives one plain-text line for reports.

## API
`css`, `haversine(a, b)`, `accept(prev, p, accuracy)`, `stats(pts)`, `thin(pts, max)`, `svg(pts, {w, h, splits})`, `mapsLink(pts)`, `gpx(run)`, `parseGPX(text)`, `runs(doc)`, `withRun(doc, run, date)`, `withoutRun(doc, id, date)`, `makeRun(pts, startAtMs, extra)`, `toSession(run, {weightKg})`, `live()`, `onPosition(pos)`, `tick()`, `start(ctx)`, `finish(ctx)`, `importGPX(text, ctx, dateHint)`, `history(runsMap)`, `cardHTML(date, docs, live?)`, `progressHTML(docs, {today})`, `summary(docs, {today})`, `handle(el, ctx)`.

## Tests
`node --test modules/run-tracker/run-tracker.test.js` (9 tests: distance maths, the fix filter, stats and splits with pauses, thinning / SVG / Maps link, GPX round-trip and a Strava-style file, the Cardio session, a full start → fixes → finish → delete flow with a fake geolocation, blocked GPS, import and progress).
