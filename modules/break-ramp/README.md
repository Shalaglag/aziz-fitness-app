# Lighter weights after a break

When a lift has not been done for 7+ days, the app suggests easing back in instead of picking up where the last session left off: about 90% of the pre-break working weights first, 95% next time, then normal double progression. A break of 28+ days ramps over three sessions (80%, 90%, 95%). Based on the Fitbod-style "reduce after time off" idea from the Reddit ideas search.

## What Aziz sees
- **Gym mode / Quick log**: a one-line note above the set, "Back after 9 days · 90% today: 70×8, 70×8 kg (session 1 of 2)". The suggested weights are the pre-break weights times the factor, rounded **down** to the equipment step (2.5 kg machine/barbell, 2 kg dumbbells, 5 lb). Reps stay the same.
- **Train**: a "Go lighter today" card listing every lift that is in its ramp today, with the top weight to use, the percentage and the days off.

## The rule
No state is stored. For each lift the module sorts its sessions newest first and walks back until it finds a gap of 7+ days:
- The gap is between today and the last session → **session 1** of the ramp (90%, or 80% for a 28+ day gap).
- One session already done since the gap → **session 2** (95%, or 90%). Percentages are always of the last **pre-break** session, never of the reduced one.
- All ramp sessions done → `ramp:false, reason:"ramp-done"`; progression is back to normal.
- Sessions with no weighted working set are ignored (warm-ups, unchecked sets, cardio).

## For the app thread
`break-ramp.js` defines `BreakRamp` (plain JS, no imports, no network). Add `{ "file": "modules/break-ramp/break-ramp.js", "expose": ["BreakRamp"] }` to `build/modules.json` (it is in, before the logger).

| Call | Use |
|---|---|
| `BreakRamp.css` | inject once; uses `--line --sunk --muted --accent --r --mono` |
| `plan(history, {today, step, minDays})` | `history = [{date, sets:[{w,r}]}]` → `{ramp, stage, of, factor, gapDays, base, sets, text}` or `{ramp:false, reason}` |
| `fromShell(S.docs.workouts, name)` | history for one exercise from `workouts/{date}.sets[name]` |
| `fromLogger(lbWorkouts, exId, {excludeId})` | history from `lb_workouts` docs (drops warm-ups and unchecked sets; pass the live workout's id as `excludeId`) |
| `analyzeShell(S.docs.workouts, {today, names, step})` | `{lifts:[{name, …plan}], count}`; `names` defaults to every lift ever logged, pass today's plan exercises to limit it |
| `noteHtml(plan, unit)` | the one-line note, `""` when no ramp |
| `cardHtml(result, unit)` | the Train card, `""` when no lift ramps |

Suggested wiring:

```js
// Train tab, above the session's exercises (names = today's planned lifts)
html += BreakRamp.cardHtml(BreakRamp.analyzeShell(S.docs.workouts, { today, names: todaysLifts }));

// Quick log, per exercise: the suggested weights become the placeholders
const p = BreakRamp.plan(BreakRamp.fromShell(S.docs.workouts, name), { today, step: 2.5 });
if (p.ramp) { html += BreakRamp.noteHtml(p); placeholders = p.sets; }

// WorkoutLogger Gym mode (inside gymCmpHtml, after the "Last time" line), when the host passes opts.breakRamp = BreakRamp:
const p = opts.breakRamp.plan(opts.breakRamp.fromLogger(workouts(), e.exId, { excludeId: E.doc.id }), { today: Date.now(), step: weightStep(ex, e.unit) });
out += opts.breakRamp.noteHtml(p, e.unit);   // and use p.sets[k].w as the weight placeholder for working set k
```

Tests: `node --test modules/break-ramp/break-ramp.test.js` (11 cases: no history, no break, 7-day boundary, stage 1 and 2 percentages of the pre-break session, ramp done, 28-day three-step ramp, unordered/future dates, shell and logger readers, HTML helpers).
