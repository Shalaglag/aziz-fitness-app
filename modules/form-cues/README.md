# Form cues in the workout logger

Shows technique cues, injury watch-outs, the muscles worked and a demo link for each exercise, inside the workout logger (Liftbook). Data comes from `exercise-form-guide.json` (the form guide, all 32 movements in the Push/Pull/Lower plan). Plain JS, no imports, no network.

## Files
- `form-cues.js`: the module (`window.FormCues`). Inline it as-is.
- `exercise-form-guide.json`: the data. Inline it as `window.FORM_GUIDE = …`.
- `workout-logger.patch`: four small additions to `workout-logger.js` (adds the optional `formCues` mount option).
- `form-cues.test.js`: `node modules/form-cues/form-cues.test.js`.
- `preview.html`: the Liftbook preview with the patch, module and data inlined. Open it, start Push A.

## Where it shows
- **Live workout:** a collapsed "Form cues" bar under each exercise name with the first cue as a preview. Open it for all cues, the top 2 "watch for" mistakes, the safety note, muscle chips (primary filled) and "Watch a demo". It stays open while you log sets.
- **Exercise sheet (tap the name), About tab:** a full "How to do it" section: muscles, equipment, cues, setup, the rep step by step, every injury watch-out, the safety note and the demo link.
- Exercises not in the guide (custom or imported lifts) just show nothing.

## Wiring it into the app
```js
WorkoutLogger.mount(document.getElementById('lbHost'), {
  /* existing storage, weights, downloads, onFinish */
  formCues: FormCues.create(window.FORM_GUIDE)
});
```
The logger injects `formCues.css` once (`#fc-style`) and calls `formCues.attach(document)` to remember which panels are open.

## API
- `FormCues.create(guide)` returns `{ find, inlineHtml, detailHtml, muscles, demoUrl, attach, css, principles, size }`.
- `find(idOrName)` matches logger ids (`bench-press-barbell`), library names, Strong / shell names (`Incline DB Press`, `Side Delts`) and the guide's own ids. Returns `null` when there's no match.
- Demo links: off by default. With `{ demoLinks: true }` an exercise's own `demo` field is shown; there is no search fallback. The app shows its built-in animations (ExerciseAnim) instead.
- Matching: a loose name match only counts when the guide entry was written for the same equipment, so "Seated Row (Machine)" and "Lateral Raise (Machine)" show no cues rather than the cable/dumbbell ones.

Styling uses only the shell tokens (`--line --r --sunk --accent --accent-ink --muted --ink --warn --surface`), classes prefixed `fc-`.
