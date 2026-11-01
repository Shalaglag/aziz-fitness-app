# Workout logger (Liftbook) with Gym mode

The Strong-style logger behind the app's Train tab, now with a Gym mode for the live workout. Plain JS, no imports, no network. This is the canonical copy of the module: it already includes the form cues patch (`modules/form-cues/workout-logger.patch`), so inline `workout-logger.js` as-is in place of the old logger block in `app/index.html`.

## Files
- `workout-logger.js`: the whole module (`window.WorkoutLogger`).
- `preview.html`: standalone build with the form cues module and guide data inlined. Open it, start Push A.
- `gym-mode.test.js`: `node modules/workout-logger/gym-mode.test.js`.

## Gym mode
Live workouts open in Gym mode by default. "List view" in the header switches to the full table (the choice is remembered in `lb_meta/settings.gym`).

- One set at a time: exercise name, set chips (tap to jump, `+` adds a set), "Set 2 of 3" / "Warm-up 1".
- Big −/+ steppers for every field. Weight steps by equipment: 2 kg dumbbells, 2.5 kg barbell/machine/cable, 5 lb in lb, or the exercise's own saved step (see Machine settings). Weight steps snap to that grid (61 → 62.5, not 63.5). Reps ±1. Tap the number to type.
- Previous-set comparison: "Last time 90 kg × 8 · RIR 1" (or the plan target when there's no history), with live chips for the weight, rep and est. 1RM change, and "Record if you hit this" before you lift.
- RIR chips 0 / 1 / 2 / 3 / 4+ on working sets of weighted lifts (tap again to clear). Stored as `rir` on the set.
- Big "Done" button: fills blanks from last time, flags records (green banner), starts the rest timer, moves to the next set.
- Supersets run A1 → B1 → A2 → B2; the rest timer starts only after the round. Uneven set counts finish on the longer exercise.
- Rest countdown is large in Gym mode, with ±15 s, Skip and "Up next: exercise · set · last time".
- Demo (opens the built-in animation from `opts.anim`; no external links), How to (exercise sheet), Rest, Plates, and the collapsed form cues panel.
- Reopening a workout picks up after the furthest checked set, so skipped warm-ups don't pull you back.
- Wake lock, beep and vibration settings are the existing ones.

## Rest timer look and sound
Settings → Workout (app) or Tools → Settings (logger) pick both; stored in `lb_meta/settings` as `restStyle` and `restSound`.
- `restStyle`: `bar` Loading bar (default) · `half` Half circle · `ring` Full circle, full screen like Strong · `fill` Screen fill (the colour drains down the screen) · `plates` Plates off the bar (2.5 → 20 kg plates come off as rest runs down) · `blocks` Blocks (10 segments). Full-screen looks are a `role="dialog"` with Minimise (also the Android back button), which drops to the bar for that rest.
- `restSound`: a `GymSounds.REST_SOUNDS` id (default `restDone`, the Strong-style bell). The `lb:rest` event carries it as `detail.sound` so the Android notification rings the same sound.
- `--p` (rest left, 0–1) on `.lb-rest` drives every look; the last 10 s pulse. `WorkoutLogger.previewRest(sec)` starts a rest (Settings "Try it"); `WorkoutLogger.restStyles` lists the looks.

## Machine settings and weight steps
- Every exercise keeps `memo` (seat height, pin, grips…) and an optional `step` + `stepUnit` (the smallest jump its stack or rack allows). Edit them from the exercise sheet (Edit) or, while logging, from the ⚙ line under the exercise name in Gym mode and the list view ("Add seat, pin or weight step" when empty). Saved as an override in `lb_exercises/{exId}`; library exercises without a saved step use the equipment default.
- `step` drives the Gym steppers, the "All sets hit 12, try X next" hint and `warmSets(w, unit, bar, step)`. A step saved in kg is converted (to 0.25 lb) when the exercise is logged in lb, and vice versa.
- Plate calculator: when the weight can't be made from the plate list it says "Load 97.5 or 100 instead" (`loadableUp(perSide, unit)` finds the next total you can load).
- Exercise About tab shows the weight step tile ("default" when no step is saved).

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
Data shape is unchanged apart from the optional `rir` on sets and the optional `step`/`stepUnit` on exercise overrides, so no migration is needed. Pure helpers are exposed for tests as `WorkoutLogger.gym` (`gymOrder`, `nextPending`, `resumePoint`, `restAfter`, `compareSets`, `weightStep`, `bumpVal`, `snapStep`, `stepWeight`, `warmSets`, `loadableUp`).

## Host settings (v45)

`WorkoutLogger.settings()` returns a copy of the logger settings; `WorkoutLogger.setSettings({gym, unit, restCompound, restIso, sound, vibrate, wake, rpe, rir})` merges, saves to `lb_meta/settings` and re-renders the home screen. The app's Settings screen uses these. Gym mode is off by default since v45: live workouts open in the Strong-style List view.

## Host hooks (v47)
`mount(el, opts)` also takes `title` (an `<h1>` above the section tabs), `hideTabs` (tab keys left out of the nav; `show(k)` still opens them) and `adaptStart(info)`: called when a template starts with `{name, exercises:[{exId, name, sets}]}` (working sets only); return `{exercises:[{from, exId?, name, sets?, note?}], suffix?}` to change the list (unknown names become custom exercises, `sets` trims working sets, `suffix` is appended to the workout name) or `null` to leave it. The app uses it for Travel workout and Short on time. In a live workout an exercise with no machine settings shows "Machine settings" in its ••• menu instead of a line; once every warm-up set is ticked they collapse to one "N warm-up sets done · show" line.

## Collapsed demos and List view default (v48)
Exercise demos (ExerciseAnim) no longer auto-play: the live list, the Gym card and the About sheet show a small "▶ Demo" toggle (`demoSlot(id)`); tapping it mounts the player, "Hide" removes it. Open state lives in the `demoOpen` set for the session only. The first time the logger loads after this version it switches to the Strong-style List view once (`settings.listOnce`); the Gym/List switch stays the user's afterwards.
