# Recovery & fatigue tracker

Feature 7 of the app plan: sleep, soreness, energy, joint discomfort, a daily readiness score, and fatigue warnings built from real performance trends (lifts, effort ratings, sleep, check-ins). Plain JS, no imports, no network. Global `RecoveryFatigue`.

It builds on what the app already has: hours slept come from the existing Today sleep input (`days/{date}.sleep`), lifts from the full logger first (`lb_workouts`, lb converted to kg) and the Quick log (`workouts/{date}.sets`) for dates the logger doesn't cover, effort from EffortDeload (`workouts/{date}.effort`), the lighter week from `prefs/main.deloadFrom/deloadUntil`, and the readiness advice wording comes from the sleep-recovery guide's morning check. It never changes calorie or training targets, and missing data is shown as missing.

## What Aziz sees
- **Today:** a "Recovery check-in" card. Tap 1–5 for sleep quality, soreness (5 = not sore) and energy, and tap a joint to mark it mild → moderate → sharp → off. A readiness score (0–100) and verdict appear as soon as anything is logged: *Ready to push*, *Train, hold steady*, or *Go easier today*, with "Why this score".
- **Train (top):** a warning card only when something is off, each with the numbers behind it.
- **Progress:** 7-day averages, a 14-day readiness line and the current fatigue level.

## Rules
**Readiness** (weights rescale to whatever was logged): sleep last night 25 (5 h → target), 3-night sleep 10, quality 15, soreness 15, energy 15, joints 10. Green ≥ 75, red < 50. Red also when sleep < 5.5 h or any joint is sharp; green drops to amber when sleep is under the minimum.

**Fatigue warnings** (last 2 weeks):
| Warning | Fires when |
|---|---|
| Lifts are slipping | 2+ lifts, and at least half of lifts trained in the last 10 days, are 3%+ below the best of their previous 3 sessions (Epley e1RM, 6-week window) or dropped 2 sessions in a row. Muted during a lighter week; deload sessions are ignored. |
| Workouts feel harder | Average effort this week is 1+ point above the 2 weeks before (2+ ratings in each). |
| Sleep is running short | 4+ nights logged this week and the average is under the minimum, or half the nights are. |
| Soreness isn't clearing / Energy has been low | 3+ of the last 5 check-ins at 1–2. |
| Joint keeps bothering you | Same joint 3+ times in 10 days, or sharp in the last 7. Points to Swap in Quick log and a physio if it's sharp, worsening, or lasts 2+ weeks. |
| **Fatigue is building** | 2+ of the signals above at once. Sleep first, then a lighter week if it persists. Never "eat less". |

Defaults: `sleepMin` 7 h, `sleepTarget` 8 h (from the sleep guide), overridable per call (e.g. from `prefs/main.profile`). AppTargets has no sleep fields yet; no calorie, protein or weight targets are used here.

## Data
New field only: `days/{date}.readiness = {quality, soreness, energy, joints:{shoulder|elbow|wrist|neck|lowerBack|hip|knee|ankle: 1|2|3}, at}`. Not `.recovery`: BudgetRecovery owns `days/{date}.recovery` for its "Went over?" card. The whole day doc is copied and only `readiness` changes, so no migration is needed.

## For the app thread
```js
document.head.insertAdjacentHTML("beforeend", "<style>" + RecoveryFatigue.css + "</style>");
const rfOpts = { sleepMin: S.docs.prefs.main?.profile?.sleepMin, sleepTarget: S.docs.prefs.main?.profile?.sleepTarget };
// Today, under the checklist (it already has the sleep hours input)
html += RecoveryFatigue.checkinHtml(S.docs, { date: view.date, ...rfOpts });
// Train, top (next to the EffortDeload nudge)
html += RecoveryFatigue.warningsHtml(RecoveryFatigue.fatigue(S.docs, rfOpts));
// Progress, after TrendTDEE
html += RecoveryFatigue.html(S.docs, rfOpts);
// delegated click handler on main (data-rf, not data-recover: BudgetRecovery owns that)
const rfw = RecoveryFatigue.handle(e.target, S.docs, view.date);
if (rfw) { put(rfw.collection, rfw.id, rfw.doc, { quiet: true }); return; }
```
`RecoveryFatigue.summary(S.docs)` returns plain text for the AI coach / 14-day review. `readiness`, `fatigue` and `series` return data objects for other modules.

Tests: `node --test modules/recovery-fatigue/recovery-fatigue.test.js` (14 cases). Preview with example data: `preview.html` (buttons work, in memory only).
