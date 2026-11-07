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

## Swipe left to delete a set (Nov 3)
- Every set row in the list view sits in `.lb-setwrap` over a red Delete panel. Drag it left 40 px or more and it stays open showing **Delete** (tap to remove the set); drag past half the row and the set is deleted on release. A tap elsewhere or a re-render closes it. Vertical drags scroll as before (`touch-action: pan-y`).
- The other ways stay: the set-tag sheet's "Delete this set", and the × button when editing a template.
- `WorkoutLogger.swipe.swipeDecision(dx, dy, width)` → `none | reveal | delete`; tests in `swipe-delete.test.js`.

## Hold and drag to reorder exercises (Nov 7)
- In the list view (live workout and template editing), hold an exercise's name row ~0.4 s: the list folds to names only, the held one follows the finger (the list scrolls near the edges), let go to drop it. A tap still opens the exercise; moving the finger before the hold just scrolls. Gym mode is unchanged.
- The exercise object moves whole, so its sets, notes, rest and superset tag go with it. Move up / Move down stay in the ••• menu.
- `WorkoutLogger.reorder.dropIndex(mids, from, y)` and `moveItem(arr, from, to)`; tests in `reorder.test.js` and the touch check in `tests/app-phone.test.js`.

## Rest timer look and sound
Settings → Workout (app) or Tools → Settings (logger) pick both; stored in `lb_meta/settings` as `restStyle` and `restSound`.
- `restStyle`: `bar` Loading bar (default) · `half` Half circle · `ring` Full circle, full screen like Strong · `fill` Screen fill (the colour drains down the screen) · `plates` Plates off the bar (2.5 → 20 kg plates come off as rest runs down) · `blocks` Blocks (10 segments). Full-screen looks are a `role="dialog"` with Minimise (also the Android back button), which drops to the bar for that rest.
- `restSound`: a `GymSounds.REST_SOUNDS` id (default `restDone`, the Strong-style bell). The `lb:rest` event carries it as `detail.sound` so the Android notification rings the same sound.
- `--p` (rest left, 0–1) on `.lb-rest` drives every look; the last 10 s pulse. `WorkoutLogger.previewRest(sec)` starts a rest (Settings "Try it"); `WorkoutLogger.restStyles` lists the looks. Settings changed before the saved ones finish loading (the host's Settings screen can be tapped while a long history loads) are held and laid on top once loaded (`WorkoutLogger.mergeSettings(defaults, saved, early)`, `settings-load.test.js`); nothing is written until then, so an early tap can't save defaults over the rest. In Gym mode the bigger rest panel styling applies only to the inline looks, so Full circle and Screen fill look the same as in the List view.

Rest between sets (Strong-style, v82): in the List view a thin line with the rest time sits under every set (not cardio). Tap it to type any time (`1:45`, `105` seconds, `2m`, `2.5` minutes; under 10 = minutes; `0`/empty = off), with quick picks, "All sets of this exercise" and "Use this every time". A set's own time is saved as optional `set.rest` (seconds, `-1` = off) and carried into templates; `WorkoutLogger.setRestOf(e, s)` = `s.rest || exercise rest`. The line under the set that started the rest counts down in place (`rest.at = [ei, si]`); tapping it while it runs also offers −15/+15/Skip, and Save restarts it at the new time. The exercise "Rest" link uses the same typed sheet. `WorkoutLogger.parseRest(text)` → seconds or null. The default rests in the app Settings and logger Settings are typed m:ss fields, not fixed chips.

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
`mount(el, opts)` also takes `title` (an `<h1>` above the section tabs), `hideTabs` (tab keys left out of the nav; `show(k)` still opens them) and `adaptStart(info)`: called when a template starts with `{name, exercises:[{exId, name, sets}]}` (working sets only); return `{exercises:[{from, exId?, name, sets?, note?}], suffix?}` to change the list (unknown names become custom exercises, `sets` trims working sets, `suffix` is appended to the workout name) or `null` to leave it. The app uses it for Travel workout and Short on time. In a live workout an exercise with no machine settings shows "Machine settings" in its ••• menu instead of a line; ticked sets (warm-ups included) always stay visible.

## Collapsed demos and List view default (v48)
Exercise demos (ExerciseAnim) no longer auto-play: the live list, the Gym card and the About sheet show a small "▶ Demo" toggle (`demoSlot(id)`); tapping it mounts the player, "Hide" removes it. Open state lives in the `demoOpen` set for the session only. The first time the logger loads after this version it switches to the Strong-style List view once (`settings.listOnce`); the Gym/List switch stays the user's afterwards.

## Exercise list rows (Nov 1)
Exercises tab and the add-exercise picker use Strong-style rows: a picture from `opts.anim.thumb(id)` (letter circle when it returns null or the file fails to load), the name, the body part, and the number of finished workouts that include it. A Sort select switches A–Z (letter headings) and Most done (bands 50+, 20–49, 10–19, 1–9, not done yet).

## Strong import (v65)
`WorkoutLogger.parseStrong(text, {unit, existing})` is pure: Strong CSV (either layout) → `{workouts:[{doc, action}], newExercises}` with `action` add / update (same workout imported before) / skip (a workout logged in the app that day). `importStrong(text, opts)` applies it (waits for the logger's data to load; uses `storage.putMany(col, docs)` when the host provides it, so the app sends Firestore batches) and returns `{added, updated, skipped, newEx}`. Strong names Aziz uses are aliased to library ids in `STRONG_ALIASES`; unknown names become custom exercises. Program lb exercises are stored in lb. The app's Settings › Data and backup › Import from Strong calls it, and Tools › Your data › Import Strong CSV uses the same path.

Finish with unchecked sets: the confirm sheet offers "Finish and check remaining (n)" (ticks every unchecked set that has numbers or last time’s placeholder, flags records, no rest timer, then the usual finish/template-update flow), "Finish anyway" (unchecked sets are dropped) and "Go back". `WorkoutLogger.fillRemaining(exercises, fields, ex, ph, prev, match, onDone)` is the pure part; `finish-check.test.js` covers it.

Cancel / end a workout: the Finish sheet has "Cancel workout (save nothing)", Gym mode has a "Cancel workout" button under the set navigation, and the Train page shows "Finish workout" / "End workout" under the Resume bar while a workout is hidden (`barFinish` opens it and runs Finish; `barEnd` opens it and asks). All cancel paths go through the "Cancel this workout?" confirm (`askDiscard` → `cancelLiveFromSheet`), which clears only the live workout; saved workouts are never touched. The list view keeps its inline Cancel workout at the bottom.

## Never lose a finished workout (Nov 7)
- `put('workouts', w)` writes the workout to the localStorage journal `lb_unsaved` first and removes it only when the store confirms that exact copy (`WorkoutLogger.journalStore(localStorage)` → `list / add / drop(id, savedCopy)`). `loadAll`, the `online` event and returning to the foreground replay the journal (`replayJournal`), so an interrupted or failed save is retried instead of dropped.
- `recoverLocal()`: when the logger mounts with host storage, workouts (plus custom exercises, measurements and templates the person used) still sitting in the `lb:` localStorage fallback from an earlier device-only session are put into the host store, then the local copies are cleared. The host must not mount the logger before it knows which storage it has (the app waits for `storeReady`).
- Finish saves the workout immediately; "Your numbers differ from the template" is asked on the Workout complete sheet (`finishUpdTpl` / `finishKeepTpl`), never before the save.
- `WorkoutLogger.freshStart(doc, now)`: a live workout started on an earlier day with no set ticked gets `start = now` at its first tick, so it is dated the day it was really done.

## Up next without a built-in programme (Nov 7)
No templates are seeded for a new account. `WorkoutLogger.planNext(templates, workouts, rotOverride)` → `{idx, name, list, last, rest}` or `null`: the Push / Pull / Lower rotation (with Rest days) only when all six of those templates exist; otherwise the person's templates in folder/order sequence, cycling within the folder (programme) of the last finished workout. The Workout tab's "Up next" card, Skip to next, and the app's Today page (`sessionFor`, which reads `lb_templates`) all use it. Tests: `plan-next.test.js`.
