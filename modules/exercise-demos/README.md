# Exercise demos

One demo registry for every exercise in the app (113 workout-logger exercises + 11 swap-only ones), keyed by the logger's exercise id. Plain JS, no imports, no network.

A demo shows in the app only when **all** of these hold:
- the item's `status` is `verified` and it has `checkedBy` and `checkedAt` (a person watched it),
- the entry's `equipment` equals the logger library category for that id (a cable clip never covers a machine or dumbbell lift),
- no item on the entry is marked `incorrect`,
- the URL is https, or a local `.mp4`/`.webm` clip published with the app (videos also need `licence`).

Otherwise the Demo button is a YouTube search that keeps the equipment words ("Seated Row Machine proper form") and is labelled "Search demos ↗".

## Files
- `demos.json`: the registry (`window.EXERCISE_DEMOS` in the app). Seeded with no URLs.
- `exercise-demos.js`: `window.ExerciseDemos`.
- `exercise-demos.test.js`: `node --test modules/exercise-demos/exercise-demos.test.js`.

## Data
```json
"seated-row-machine": {
  "name": "Seated Row (Machine)", "equipment": "Machine", "muscle": "Back", "pattern": "Horizontal pull", "priority": 3,
  "aliases": ["exact alternative names only"], "note": "matching caveat",
  "items": [{ "kind": "link|video", "url": "https://… or demos/x.mp4", "angle": "front|side|null", "title": "", "source": "channel or library",
              "licence": "needed for video files", "status": "verified|review|incorrect|replace", "checkedBy": "Aziz", "checkedAt": "2026-10-26", "note": "" }]
}
```
Entry status is derived: `incorrect` if any item is marked incorrect, `verified` if a checked item passes the equipment check, then `replace`, then `review`, else `missing`. Priority: 1 plan, 2 swap option, 3 library, 4 avoided in the plan.

To verify a link: watch it, confirm the equipment, start and finish positions, a full rep with full range of motion and a clear angle, then set `status: "verified"`, `checkedBy`, `checkedAt`.

## API
`ExerciseDemos.create(data, { library })` (library = `WorkoutLogger.library`) returns
`{ id, entry, status, verified, best(id, angle), candidates, link(id, name), summary, validate, sheetHtml(id, name), searchUrl, css, size }`.
- `id()` resolves an id, an exact name or a listed alias. No fuzzy matching.
- `link()` returns `{ href, label, verified }` for the Demo button.
- `validate()` lists problems (missing library ids, equipment mismatch, unchecked "verified", bad URLs, one URL shared by different equipment, videos without a licence). The test suite requires it to be empty.

## In the app
`WorkoutLogger.mount(host, { …, demos: ExerciseDemos.create(window.EXERCISE_DEMOS, { library: WorkoutLogger.library }) })`. Gym mode shows the Demo button for every exercise; the exercise sheet's About tab gets a "Demo video" section (checked videos, then "Found, not checked yet", then a search). FormCues is created with `{ demoLinks: false }` so its own search link isn't shown twice.
