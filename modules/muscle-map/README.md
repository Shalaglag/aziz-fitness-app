# Muscle recovery map

A front/back body diagram coloured by how recovered each muscle is (the Fitbod heat-map idea), shown at the top of Train before choosing a session. Built only from what is already logged: sets per muscle from the workout logger and the Quick log, and the hours since. Plain JS, no imports, no network. Global `MuscleMap`.

It reuses the Strength card's exercise → muscle mapping (`StrengthAnalytics.musclesFor` / `MUSCLES`) so both cards agree on what a lift trains. RecoveryFatigue stays the readiness / sleep / soreness tracker; this module only answers "which muscles are fresh right now".

## What Aziz sees
- **Verdict for the next session** (when the host passes it): *Good to go*, *Train, hold steady* (a primary muscle is 50–79 %) or *Still recovering* (under 50 %), naming the muscles and when they'll be ready.
- **Two figures** (front, back), each muscle filled red → amber → green by % recovered, with a tooltip.
- **List** of the muscles trained in the last 7 days, worst first, with a bar, the %, and "N h ago".
- One line of notes: unmapped exercises, soreness stretch, or "nothing logged".

## Model
Per session, per muscle: hard sets = working sets of lifts with that muscle as primary + ½ for helper muscles (same as the Strength card). Warm-ups (`t:"w"`) and unchecked sets don't count.

- **Dose** = min(1, hard sets / 8). Eight or more hard sets in one session fully fatigues the muscle.
- **Window** = base × (0.6 + hard sets / 10) hours, capped at 1.6 × base. Base 48 h for chest, back, quads, hamstrings, glutes; 36 h for the rest. So 8 sets of bench → chest window 67 h, 4 sets → 48 h; 4 sets of laterals → side delts 36 h.
- Each dose fades linearly over its window; doses from different sessions add up (capped at 1). **Recovered % = 100 × (1 − fatigue)**. Ready ≥ 80 %, recovering 50–79 %, fatigued < 50 %.
- Sessions older than 7 days are ignored. Quick-log days have no clock time and are assumed to end at 18:00.
- If today's check-in (`days/{today}.readiness.soreness`, 5 = not sore) is 1, every window is stretched 25 %; if 2, by 10 %.
- `readyInH`: hours until the muscle is back at 80 %.

Numbers are deliberately simple so the "Why" line on the card is true; they are not a physiology claim.

## API
- `MuscleMap.css` – inject once (uses `--good/--warn/--bad`, `--line`, `--muted`, `--surface`, `--accent-soft`).
- `MuscleMap.analyze(docs, opts)` → `{now, today, muscles:[{id, label, region, pct, status: fresh|ready|recovering|fatigued, statusLabel, sets, lastSets, hoursSince, lastDate, readyInH}], sessions, next, soreness, stretch, notes, fresh}`. `next` = `{name, muscles:[{id, label, pct, role}], verdict: go|ok|wait|unknown, note}` or null.
- `MuscleMap.html(docs, opts)` → `<section class="card mm-card">`.
- `MuscleMap.svg(analysis)` → the two figures only. `MuscleMap.summary(docs, opts)` → plain text for the coach.
- `opts`: `now` (ms), `today`, `nextSession {name, exercises:[names]}`, `names {exId: name}`, `library`, `musclesFor`, `muscles` (per-name overrides), `muscleList`, `windows {large, small}`, `fullSets`.

Reads `lb_workouts` (`start`/`end` ms, `exercises[].exId`, `sets[].t/r/done`), `lb_exercises` (custom names), `workouts/{date}.sets` for dates the logger has no session, `days/{date}.readiness`. Writes nothing.

## In the app
Shell `mmOpts()` passes `nextSession` from `sessionFor(view.date)` + `PROGRAM`, and the card renders in `vTrain()` right after the RecoveryFatigue warnings.

## Tests
`node --test modules/muscle-map/muscle-map.test.js` (8 cases).
