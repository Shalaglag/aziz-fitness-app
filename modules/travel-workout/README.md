# Travel workout

Turns today's gym session into a dumbbell, band or bodyweight version: one move per plan slot, same muscle, reps adjusted for the kit. Reuses ExerciseSwap for the plan lift's muscle, its dumbbell swaps and `linkSwap`, so travel sets log under their own name and still show in the plan lift's history. Plain JS, no imports, no network. Exposes `window.TravelWorkout` (`module.exports` in Node).

## Files
- `travel-workout.js` — kits, the travel catalog (≈80 moves), `convert`, `apply`/`clear`, the card.
- `travel-workout.test.js` — `node --test modules/travel-workout/travel-workout.test.js` (requires `../exercise-swap/exercise-swap.js`).

## Rules
- Never a hip hinge: deadlifts, RDLs, stiff-leg, rack pulls, good mornings, hip thrusts, glute bridges, back extensions, hyperextensions, glute-ham raises, Nordics, reverse hypers, pull-throughs, swings, supermans. Every output passes `ExerciseSwap.isAvoided` plus this module's own `isAvoided`; the test checks the whole catalog.
- Hamstrings are knee flexion only (band leg curls, towel/sliding leg curls, prone DB leg curl). Rear delts with dumbbells use the seated chest-on-knees fly, not a standing bent-over row.
- Kits: `dumbbell` = Dumbbell + Bodyweight fills (hotel gym), `band` = Band + Bodyweight fills (door anchor), `bodyweight` = Bodyweight only.
- Order per slot: the plan lift itself if it already fits the kit (DB Curl with dumbbells) → ExerciseSwap's ranked swaps that use the kit's equipment → this catalog by muscle (kit equipment first, then bodyweight). No move is used twice in a session.
- Reps: dumbbells keep the plan reps as a range (8 → 8–12). Bands and bodyweight use the move's own range, never lower than the plan's reps. Timed moves (planks, wall sit) carry `reps.seconds = true`.

## API
```js
TravelWorkout.KITS                                  // [{id, label, equip:[...], hint}]
TravelWorkout.convert(exercises, {kit, swap, workouts}) // -> [{plan, name, muscle, equip, reps:{lo,hi,seconds?}, sets, cue, loggerId, via:'plan'|'swap'|'travel', missing}]
TravelWorkout.apply(workoutDoc, items, kit)         // -> copy with .travel = {kit, map:{used: plan}} and .swapped links (replaces earlier swaps for those slots)
TravelWorkout.clear(workoutDoc)                     // -> copy without the travel links (manual swaps made later survive)
TravelWorkout.active(workoutDoc)                    // -> kit id | null
TravelWorkout.isAvoided(name, swap?)                // hinge check (own list + ExerciseSwap's)
TravelWorkout.cardHtml({session, exercises, kit, active, open, swap, workouts}) // Train card; buttons: data-act="twkit" data-kit, "twapply" data-kit, "twclear"
TravelWorkout.css                                   // inject once
```
`exercises` accepts names or the shell's `PROGRAM` rows `[name, w, reps, sets, unit, note]`. `swap` defaults to `window.ExerciseSwap`.

## Where it goes (Train tab)
Card between the session hero and the exercise list (`travelCard` in the shell). Tapping a kit chip previews the conversion (`view.twKit`); "Use this version today" calls `apply` on `workouts/{date}` so the existing swap plumbing shows each travel move "instead of" its plan lift and logs its sets. "Back to the gym plan" calls `clear`.
