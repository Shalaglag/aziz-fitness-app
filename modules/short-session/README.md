# Short session

Fits today's gym session into 30, 45 or 60 minutes. Main compounds keep every set; accessories get supersetted, cut to 2 sets, then skipped by priority; the treadmill block scales 30 → 20 → 10 → 0 in between. Shows the estimated duration of the full and the trimmed session. Plain JS, no imports, no network. Exposes `window.ShortSession` (`module.exports` in Node).

## Files
- `short-session.js` — timing model, `plan`, `apply`/`clear`/`slot`, the card.
- `short-session.test.js` — `node --test modules/short-session/short-session.test.js` (uses `../exercise-swap/exercise-swap.js` for muscles).

## Timing model (`TIMING`, minutes)
warm-up 5 · work per set 0.75 · rest 2.5 after a main-lift set, 1.5 after an accessory set, 0.75 inside a superset · 0.5 change-over per exercise · plus the treadmill minutes. A full plan session with 30 min treadmill lands at ~80–90 min.

## Trim order (each step only if the session still doesn't fit)
1. Superset accessories that sit together between main lifts (different muscles paired first).
2. Treadmill 30 → 20.
3. Accessories to 2 sets, lowest priority first (later in the session, and a muscle already worked).
4. Treadmill 20 → 10.
5. Skip accessories by that priority. The treadmill goes to 0 before any first-of-muscle accessory is skipped.
6. Last resort: a main lift down to 2 sets. Never below 2; never skipped. `over` reports any minutes still over.

## API
```js
ShortSession.BUDGETS                         // [30, 45, 60]
ShortSession.plan(exercises, {minutes, mainLifts, cardioMin, swap, timing})
  // -> {minutes, items:[{name, sets, origSets, main, muscle, pair:'A'|null, drop}], cardioMin, cardioOrig, est:{lifting,cardio,total}, full:{...}, steps:[string], over}
ShortSession.estimate(items, {cardioMin})    // items from normalize()
ShortSession.apply(workoutDoc, plan)         // -> copy with .short = {minutes, sets:{name:n}, drop:[names], pairs:[[a,b]], cardioMin, est}
ShortSession.clear(workoutDoc)               // -> copy without .short
ShortSession.active(workoutDoc)              // -> minutes | null
ShortSession.slot(workoutDoc, name)          // -> {sets|null, drop, pair} for one exercise row
ShortSession.cardHtml({session, exercises, minutes, active, open, mainLifts, cardioMin, swap}) // buttons: data-act="ssmin" data-min, "ssapply" data-min, "ssclear"
ShortSession.css                             // inject once
```
`exercises` accepts names or the shell's `PROGRAM` rows `[name, w, reps, sets, unit, note]`. `mainLifts` defaults to the plan's main lifts; `swap` defaults to `window.ExerciseSwap` (falls back to name-based muscles). Sets stay keyed by the plan name, so a travel or manual swap on the same day still works.

## Where it goes (Train tab)
Card under the travel card (`shortCard` in the shell). A minute chip previews the plan (`view.ssMin`); "Use the N min version today" writes `workouts/{date}.short`. Exercise rows read `slot()` for set count, the "Superset A/B" pill and the greyed skipped rows; the cardio card gets `cardioMin` as its target, and 0 swaps it for a "skipped today" card.
