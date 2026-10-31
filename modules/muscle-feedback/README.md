# Muscle feedback → next week's sets (MuscleFeedback)

After a muscle's last set, three quick taps: **pump**, **soreness**, **workload** (1–3 each). They are saved with the day's workout and turn into next week's sets per muscle by RP-style rules, inside the weekly set targets of the Strength card. Plain JS, no imports, no network. Global `MuscleFeedback`.

| Function | Returns |
| --- | --- |
| `MuscleFeedback.css` | CSS string, inject once |
| `MuscleFeedback.cardHtml(workout, date, opts)` | "How did it feel?" card for Train, `""` when nothing was lifted that day |
| `MuscleFeedback.planHtml(docs, opts)` | "Next week's sets" card for Progress |
| `MuscleFeedback.handle(el, docs, date)` | `{collection:"workouts", id, doc}` to save for a tap inside `[data-mf]`, else `null` |
| `MuscleFeedback.plan(docs, opts)` | `{from, to, rows:[{id, label, sets, sessions, delta, next, lo, hi, reason}], rated}` |
| `MuscleFeedback.sessionDelta({pump, soreness, workload})` | `{delta: −2…+2, reason}` for one rated session |
| `MuscleFeedback.musclesTrained(workout, musclesFor)` | primary muscle ids with a logged set |
| `MuscleFeedback.summary(docs, opts)` | plain text for the coach |

## Data

- Writes `workouts/{date}.feedback = { <muscleId>: {pump, soreness, workload, at} }`. Nothing else on the doc is touched; tapping the chosen level again clears it.
- Reads `workouts/{date}.sets` (names → muscles through `opts.musclesFor`, by default `StrengthAnalytics.musclesFor`) and `prefs/main.setTargets` `{muscleId: {lo, hi}}` when passed as `opts.setTargets`.
- This week's sets come from `opts.weekSets`, else `opts.analysis()` (a `StrengthAnalytics.analyze` result, so logger workouts count too), else counted here from `workouts/*` (primary 1, helper ½).

## Scales

| Tap | 1 | 2 | 3 |
| --- | --- | --- | --- |
| Pump | Low | Good | Great |
| Soreness | None | Gone in time for the next session | Still sore |
| Workload | Easy | Hard | Too much |

## Rules

Per rated session: `points = (2 − soreness) + (2 − pump) + (2 − workload)`. Points ≥ 3 → **+2**, 1–2 → **+1**, 0 or −1 → **0**, ≤ −2 → **−1**. Still sore (3) or too much workload (3) never adds sets; both together → **−2**. A muscle rated more than once in the week averages its deltas (rounded).

Next week = this week's sets (rounded) + delta, capped at the target's `hi` when adding and floored at its `lo` when cutting. Muscles without a target use 10–20 for the nine major muscles (chest, back, side/rear delts, biceps, triceps, quads, hamstrings, glutes) and no cap otherwise. Without feedback a muscle stays, and is flagged "under target" / "over target" rather than moved. The window is the last 7 days ending `opts.today`, the same as the Strength card's "this week".

## Wiring in the app

```js
const mfOpts = () => ({ today: TODAY, musclesFor: StrengthAnalytics.musclesFor, setTargets: S.docs.prefs.main?.setTargets,
  analysis: () => StrengthAnalytics.analyze(S.docs, strengthOpts()) });
// Train, after the effort picker:    MuscleFeedback.cardHtml(S.docs.workouts[view.date], view.date, mfOpts())
// Progress, under the Strength card: MuscleFeedback.planHtml(S.docs, mfOpts())
// click: const r = MuscleFeedback.handle(e.target, S.docs, view.date); if (r) { put(r.collection, r.id, r.doc); render(); }
```

Tests: `node --test modules/muscle-feedback/muscle-feedback.test.js`.
