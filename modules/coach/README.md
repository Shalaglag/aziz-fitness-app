# AI coach + 14-day progress review (Coach)

Two cards that connect the whole app: a **14-day review** that says whether the cut is working, and **Ask your coach**, which answers questions from the logs. Plain JS, no imports, no network of its own. Global `Coach`. Claude is reached only through the `sample` capability the host passes in (the app already declares it for PhotoFood).

## What it reads
`S.docs` as the app has it: `weights/{date}.kg`, `days/{date}.food[]` (only `eaten:true` items count; `est` items are flagged), `days/{date}.sleep`, `.steps`, `workouts/{date}` (`session`, `sets`, `effort`, `deload`), `lb_workouts` + `lb_exercises` from the full logger, `prefs/main.profile`, `prefs/main.dietBreak`, `prefs/main.dislikes`.

Per the gap audit: targets come from **AppTargets** (pass `targets: AppTargets.resolve(profile, PLAN)`); nothing personal is hard-coded, and a missing target stays null (cards say "No calorie target set" instead of guessing). Workouts read **`lb_workouts` first** (working sets only, `done !== false`, **lb converted to kg** per exercise `unit`), then `workouts/{date}.sets` for dates the logger has nothing for. Effort/deload always come from `workouts/{date}`. Review periods are 14-day blocks from `targets.start` (profile start, Oct 25 → Nov 7 is block 1).

## The 14-day review
- **Window:** the latest finished 14-day block; while the first block is running it shows "day X of 14". Today is left out (half-logged). Arrows step through earlier blocks.
- **Checks:** weight pace (least-squares slope on raw weigh-ins, % of body weight a week, week-1 vs week-2 averages), calories (days within ±band of the day's target, Fridays left out of adherence but their average shown), protein (avg, days at the minimum), training (sessions, working sets, avg effort), strength (best Epley e1RM in week 2 vs the 7 days before it; up > +1%, down < −2%), sleep.
- **Needs** 6+ weigh-ins with 2+ in each week and 7+ days with food eaten; otherwise it lists what's missing.
- **Verdicts:** `on-track` (pace within 0.5–1%/wk → keep), `slow` (0.25–0.5% → hold one more period), `stalled` (< 0.25% with ≥70% on-target days and ≥70% days logged → *suggest* −150 kcal, not below `rules.floor`, or more steps), `adherence` (low pace but adherence is the issue → no calorie change), `too-fast` (> 1%: first two weeks = water, keep; later → *suggest* +150), `diet-break` (4+ break days in the block), `not-enough-data`.
- **Tips** with their evidence: protein short, several lifts dropping, EffortDeload nudge (pass `effort`), sleep under 7 h, many estimated foods.
- **Never silently changes targets.** A change recommendation carries `change: {key:"profile.cutKcal", from, to}`; the card shows a "Use N kcal" button only if the host passes `onApply`, and the module calls it only on a tap.

## Ask your coach
- Quick questions ("Is my cut working?", "Why isn't my weight moving?", "Am I eating enough protein?", "Which lifts are stalling?", "What's left today?") are answered **from the numbers, without Claude**, so they always work.
- Free-form questions go to Claude with `Coach.context()` (targets, 7/14/30-day weight averages, last 30 weigh-ins, 14 days of eaten kcal/protein with unlogged days marked `logged:false`, last 14 days of sessions, the review, sleep, dislikes, plus TrendTDEE/EffortDeload results if passed). The prompt forbids inventing numbers, foods or workouts, tells it it cannot change targets, and asks for JSON `{answer, evidence[], missing[], suggestion}`; the card shows the evidence under each answer. If `sample` is unavailable the input is replaced by a note and the quick questions keep working.

## API
```js
Coach.css
Coach.targets(docs, opts)              // resolved targets + coaching rules
Coach.periods(docs, {today, targets})  // [{from, end, to, partial}]
Coach.review(docs, opts)               // {period, verdict, headline, checks[], recs[], missing[], numbers}
Coach.reviewHtml(docs, opts)           // Progress card
Coach.summary(review)                  // copyable text
Coach.context(docs, opts) / Coach.prompt(q, ctx, history) / Coach.parseAnswer(v)
Coach.localAnswer(topic, docs, opts)
Coach.chatHtml(docs, opts)             // "Ask your coach" card (chat state lives in the module)
Coach.bind(document, { getDocs, getSample, render, today, targets, rules, effort, tdee, kcalTarget, onApply })
```
`opts`: `today`, `targets` (AppTargets object), `rules` (`{floor, step, band, paceLo, paceHi}`; defaults 1500 / 150 / 150 / 0.5 / 1.0), `kcalTarget(date)` (the app's per-day target, e.g. diet-break days), `effort` (EffortDeload.analyze result), `tdee` (TrendTDEE.estimate result), `from` (a block start).

## Wiring in the app
```js
document.head.insertAdjacentHTML("beforeend", "<style>" + Coach.css + "</style>");
const coachOpts = () => ({ today: TODAY, targets: APP_TARGETS, rules: { floor: 1800 }, kcalTarget,
  effort: window.EffortDeload ? EffortDeload.analyze(S.docs.workouts, { today: TODAY, dismissedAt: S.docs.prefs.main?.deloadDismissedAt }) : undefined,
  tdee: window.TrendTDEE ? TrendTDEE.estimate(S.docs, { today: TODAY }) : undefined });
Coach.bind(document, { getDocs: () => S.docs, render, today: () => TODAY, targets: () => APP_TARGETS, rules: () => ({ floor: 1800 }), kcalTarget,
  effort: () => coachOpts().effort, tdee: () => coachOpts().tdee,
  getSample: () => window.claude && window.claude.use ? window.claude.use("sample").catch(() => null) : Promise.resolve(null),
  onApply: ch => { if (confirm(`Change your calorie target from ${ch.from} to ${ch.to}?`)) { /* write prefs/main.profile.cutKcal = ch.to, re-resolve targets */ } } });
// Progress tab, top (before the weekly report):
html += Coach.reviewHtml(S.docs, coachOpts());
// Today tab (or Progress, under the review):
html += Coach.chatHtml(S.docs, coachOpts());
```
`S.docs` must include `lb_workouts` and `lb_exercises` for the logger's sessions to count. Only wire `onApply` if `profile.cutKcal` actually drives the day target; otherwise leave it out and the suggestion shows without a button.

Tests: `node --test modules/coach/coach.test.js` (20 cases). Preview with example data: `preview.html`.
