# Exercise swap — integration notes

One-tap swap when a machine is taken, plus a "This hurt" flag that suggests a swap the next time that lift comes up. Plain JS, no imports, no network. Exposes `window.ExerciseSwap`.

## Files
- `exercise-swap.js` — the module (catalog, swap table, avoid list, history linking, hurt flags, bottom-sheet UI). Inline it as-is.
- `preview.html` — standalone preview of the Train tab flow.
- `test.js` — `node modules/exercise-swap/test.js` (11 checks).

## Rules it follows
- Never suggests deadlifts, RDLs, hip thrusts, back extensions or their lookalikes (stiff-leg, rack pulls, good mornings, glute bridges, hyperextensions, glute-ham raises, reverse hypers, pull-throughs, KB swings, Nordics). Enforced by `isAvoided()` on every output, not just by leaving them out of the table.
- Swap order is the "Exercise swaps for avoided lifts" reference: first choice when free, then backups, then lifts used before for that slot, then same-muscle lifts.
- A swap is logged under its own name (so a new number isn't read as a strength drop), and linked to the plan slot it replaced so history stays together.

## Data the shell stores
- `workouts/{date}.swapped = {"<name used>": "<plan name>"}` — written with `linkSwap(workoutDoc, planName, usedName)`. Sets stay under `sets["<name used>"]`.
- `prefs/swaps = {hurt:{<key>:{name,date,note,times}}, log:[{date,session,from,to,reason}]}` — the module's state. Start with `ExerciseSwap.empty()`. All state helpers return a new object; write it back.

## API
```js
ExerciseSwap.options(name, {state, workouts, exclude, limit})  // -> [{name, muscle, equip, loggerId, why, hurt, last:{date,w,r,unit}|null}]
ExerciseSwap.isAvoided(name)                                   // hinge check
ExerciseSwap.canonical(name)                                   // "Hack Squat (Machine)" -> "Hack Squat"
ExerciseSwap.linkSwap(workoutDoc, planName, usedName)          // -> copy with .swapped; planName null to unlink
ExerciseSwap.history(name, workouts)                           // -> [{date, session, name, sets, via:'direct'|'swap', slot}] newest first
ExerciseSwap.lastTime(name, workouts)
ExerciseSwap.flagHurt(state, name, {date, note}) / clearHurt(state, name) / hurtInfo(state, name)
ExerciseSwap.recordSwap(state, {date, session, from, to, reason:'taken'|'hurt'})
ExerciseSwap.pending(sessionExercises, state, {workouts})     // hurt-flagged lifts in this session + suggested swap
ExerciseSwap.openSheet({exercise, state, workouts, exclude, onPick(opt), onHurt(note), onFine()})
ExerciseSwap.renderNotice(el, {exercises, state, workouts, onSwap(exercise, opt), onKeep(exercise)})
```
`workouts` can be an array or the `{id: doc}` map of `workouts/*`. `sessionExercises` accepts names or the shell's `PROGRAM` rows.

## Where it goes (Train tab)
1. A **Swap** button on each exercise row opens `openSheet` with `exclude` = the session's other exercises. `onPick(opt)`: show `opt.name` in that row, log its sets under `opt.name`, `linkSwap(...)` into `workouts/{date}`, and `recordSwap(state, {... reason:'taken'})`.
2. `onHurt(note)` → `state = flagHurt(state, exercise, {note})`. `onFine()` → `clearHurt`.
3. At the top of the session, `renderNotice(el, {exercises: PROGRAM[session], state, workouts, ...})` shows a banner for each lift flagged as hurting, with a one-tap **Swap** to the suggested lift or **Keep** (clears the flag).
4. In the Full logger (Liftbook), `opt.loggerId` is the library id to use in its replace flow (null = add as a custom exercise named `opt.name`).
5. Progress/weekly report: use `history(planName, workouts)` so substitute sessions show under their plan slot, marked `via:'swap'`.

Styling uses the shell tokens (`--surface --sunk --line --ink --muted --accent --warn --bad --display --body --mono --r`). Classes are prefixed `xs-`; the overlay is appended to `document.body` at z-index 1100 (above Liftbook's 1000).
