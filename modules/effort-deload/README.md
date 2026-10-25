# Effort rating + deload nudge

After each workout Aziz rates how hard it was from 1 to 10. When effort climbs for two weeks while his lifts stop improving, the app suggests a lighter week.

## What Aziz sees
- **After finishing a workout** (Quick log save or Full logger finish): a "How hard was it?" row of 1–10 buttons. One tap saves it to `workouts/{date}.effort`. Tapping again changes it.
- **On Train (and Today, optional)**: a "Time for a lighter week?" card, only when the rule below fires. It lists the most stalled lifts and says what to do: same exercises, one less set each, about 90% of usual weights, stop 3+ reps before failure, then back to normal loads.

## The rule
Three rolling 7-day windows ending today: C (last 7 days), B (the 7 before), A (the 7 before that).
- **Effort rising:** avg C ≥ avg B ≥ avg A and C is at least 1 point above A, or B and C both average 8.5+.
- **Lifts stalled:** for each lift logged in the last 2 weeks and in the 4 weeks before them, compare best Epley e1RM. Stalled when fewer than a third of those lifts improved by more than 1% (needs 2+ lifts).
- **Needs data:** 2+ rated sessions in B and in C, 1+ in A. Rest days and unrated sessions are ignored.
- **Quiet periods:** no nudge within 21 days of a workout marked `deload: true`, or 14 days after "Not now".

## For the app thread
`effort-deload.js` defines `EffortDeload` (plain JS, no imports, no network):

| Call | Use |
|---|---|
| `EffortDeload.css` | inject once; uses `--line --sunk --ink --muted --accent --accent-ink --warn --r --mono` |
| `pickerHtml(date, current)` | card to show after a workout is saved; buttons carry `data-effort` and `data-effort-date` |
| `withEffort(doc, n)` | copy of a `workouts/{date}` doc with `effort` set (null clears) |
| `analyze(S.docs.workouts, {today, dismissedAt})` | `{nudge, reason, text, weeks, lifts}`; `reason` is one of `deload`, `not-enough-ratings`, `effort-ok`, `not-enough-lifts`, `still-progressing`, `recent-deload`, `dismissed` |
| `nudgeHtml(result)` | the lighter-week card, `""` when no nudge; buttons carry `data-deload="start"` / `"dismiss"` |

Suggested wiring (names from the current app):

```js
// after Quick log save, and inside WorkoutLogger onFinish after put("workouts", ...)
host.innerHTML = EffortDeload.pickerHtml(date, (S.docs.workouts[date] || {}).effort);

// delegated click handler
const b = e.target.closest("[data-effort]");
if (b) { const d = b.dataset.effortDate; put("workouts", d, EffortDeload.withEffort(Object.assign({date: d}, S.docs.workouts[d]), +b.dataset.effort)); }

// Train tab render
const res = EffortDeload.analyze(S.docs.workouts, { today, dismissedAt: S.docs.prefs.main?.deloadDismissedAt });
html += EffortDeload.nudgeHtml(res);

// data-deload="dismiss" -> prefs/main.deloadDismissedAt = today
// data-deload="start"   -> prefs/main.deloadFrom = today, deloadUntil = today + 6 days; workouts saved between them get deload:true
```

New fields: `workouts/{date}.effort` (1–10), `workouts/{date}.deload` (bool), `prefs/main.deloadDismissedAt`, `prefs/main.deloadFrom`, `prefs/main.deloadUntil` (ISO dates). Live in the app since v8..

Tests: `node --test modules/effort-deload/effort-deload.test.js` (12 cases: the nudge firing, still progressing, flat effort, high plateau, too few ratings, rest/unrated ignored, deload and dismiss quiet periods, future dates, picker HTML, empty data).
