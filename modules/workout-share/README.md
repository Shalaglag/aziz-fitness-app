# Workout share (WhatsApp text + image card)

Turns a finished Liftbook workout into a WhatsApp-ready text and a PNG card (sets, volume, PRs), and shares both with the Web Share API. Plain JS, no imports, no network, generic (nothing of Aziz's numbers inside). Idea 30 from the app-ideas list (Strong's "share workout").

## Files
- `workout-share.js`: the module (`window.WorkoutShare`, `expose: ["WorkoutShare"]` in `build/modules.json`).
- `workout-share.test.js`: `node --test modules/workout-share/workout-share.test.js` (runs `draw` against a recording 2D context, no browser needed).

## API
```js
const sum = WorkoutShare.summarize(workoutDoc, getEx); // getEx(exId) -> {name, cat, unit}
WorkoutShare.text(sum, { footer });                   // "🏋️ *Push A* — Sun 25 Oct\n⏱ 58 min · 📦 3,997 kg · 🔢 11 sets · 🏆 1 PR\n\n🏆 *Bench Press (Barbell)* 3 × 8 @ 80 kg\n…"
WorkoutShare.layout(sum, { width: 1080, maxExercises: 12, footer }); // pure: {width, height, rows}
WorkoutShare.draw(sum, { canvas, theme, width, footer });            // paints the card, returns the canvas
await WorkoutShare.share(sum, { canvas, filename, title, footer });  // 'shared' | 'shared-text' | 'cancelled' | 'copied' | 'saved' | 'failed'
WorkoutShare.compact(sets, unit);                                     // "3 × 8 @ 80 kg" or "95×10, 95×9 kg" or "8, 6 reps"
```
- `summarize` counts working sets only (warm-ups are counted separately, sets with `done: false` or no numbers are skipped), converts lb to kg for volume, lists every set that carries `pr: [...]`.
- `text` uses WhatsApp bold (`*…*`), one line per exercise with the compact set string, a "New records" list, the workout notes, and an optional footer.
- `draw` is a 1080 px wide card: accent bar, name, date, four tiles (duration, volume kg, sets, records), one row per exercise (★ and green when it holds a PR), a records list, footer. Colours come from `opts.theme` or, in a page, from the app's CSS tokens (`--bg --surface --ink --muted --accent --good --line`); the fallback is a dark card.
- `share` tries `navigator.share({files:[png], text})`, then text-only share, then copies the text and downloads the PNG.

## In the app
The logger (`modules/workout-logger`) shows a **Share** button on the "Workout complete" sheet and on every history entry. It opens a sheet with the card preview, "Share…" (Web Share, so WhatsApp appears in the Android sheet), "Copy text" and "Save image", plus a collapsible text preview. The logger looks for `opts.share` or `window.WorkoutShare`; without the module the button copies the plain summary. `opts.shareFooter` adds a footer line to both the text and the card.
