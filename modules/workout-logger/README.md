# Workout logger (Liftbook) with Gym mode

The Strong-style logger behind the app's Train tab, now with a Gym mode for the live workout. Plain JS, no imports, no network. This is the canonical copy of the module: it already includes the form cues patch (`modules/form-cues/workout-logger.patch`), so inline `workout-logger.js` as-is in place of the old logger block in `app/index.html`.

## Files
- `workout-logger.js`: the whole module (`window.WorkoutLogger`).
- `preview.html`: standalone build with the form cues module and guide data inlined. Open it, start Push A.
- `gym-mode.test.js`: `node modules/workout-logger/gym-mode.test.js`.

## Gym mode
Live workouts open in Gym mode by default. "List view" in the header switches to the full table (the choice is remembered in `lb_meta/settings.gym`).

- One set at a time: exercise name, set chips (tap to jump, `+` adds a set), "Set 2 of 3" / "Warm-up 1".
- Big −/+ steppers for every field. Weight steps by equipment: 2 kg dumbbells, 2.5 kg barbell/machine/cable, 5 lb in lb. Reps ±1. Tap the number to type.
- Previous-set comparison: "Last time 90 kg × 8 · RIR 1" (or the plan target when there's no history), with live chips for the weight, rep and est. 1RM change, and "Record if you hit this" before you lift.
- RIR chips 0 / 1 / 2 / 3 / 4+ on working sets of weighted lifts (tap again to clear). Stored as `rir` on the set.
- Big "Done" button: fills blanks from last time, flags records (green banner), starts the rest timer, moves to the next set.
- Supersets run A1 → B1 → A2 → B2; the rest timer starts only after the round. Uneven set counts finish on the longer exercise.
- Rest countdown is large in Gym mode, with ±15 s, Skip and "Up next: exercise · set · last time".
- Demo ↗ (from form cues), How to (exercise sheet), Rest, Plates, and the collapsed form cues panel.
- Reopening a workout picks up after the furthest checked set, so skipped warm-ups don't pull you back.
- Wake lock, beep and vibration settings are the existing ones.

## Other changes
- RIR: shown in history (`RIR 2`), optional "RIR column" in the list view (Settings), carried into the shell record (`sets[name][i].rir`, only when logged).
- Settings: "Open workouts in Gym mode" and "Show an RIR column".
- Body-weight goal reads `opts.targets.goalKg` (AppTargets). With no `targets` passed (standalone preview) it falls back to 80 kg; with `targets.goalKg` null the goal line is hidden.
- Blank sets checked off take last time's numbers converted to the exercise's current unit (before, a lb value could be copied into a kg exercise unchanged).

## Mount
```js
WorkoutLogger.mount(document.getElementById('lbHost'), {
  storage, weights, downloads, onFinish,            // unchanged
  formCues: FormCues.create(window.FORM_GUIDE),     // unchanged, optional
  targets: AppTargets.resolve(prefs.main.profile, PLAN) // new, optional
});
```
Data shape is unchanged apart from the optional `rir` on sets, so no migration is needed. Pure helpers are exposed for tests as `WorkoutLogger.gym` (`gymOrder`, `nextPending`, `resumePoint`, `restAfter`, `compareSets`, `weightStep`, `bumpVal`).
