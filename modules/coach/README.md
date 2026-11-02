# 14-day progress review + patterns (Coach)

Two rule-based cards on Progress → Reviews: a **14-day review** that says whether the plan is working, and **Patterns in your logs**. Plain JS, no imports, no network, no Claude, no API key. Global `Coach` (name kept so saved data and wiring stay the same).

**The AI coach was removed on Nov 2, 2026** (Aziz: hard to run and little use). The "Ask Claude" button and chat panel, quick questions, Claude context/prompt, proposed actions and the `/api/coach` server function are gone. Old chat history in `chats/main` is left in the data and backups, untouched.

## What it reads
`S.docs` as the app has it: `weights/{date}.kg`, `days/{date}.food[]` (only `eaten:true` items count; `est` items are flagged), `days/{date}.sleep`, `.steps`, `workouts/{date}` (`session`, `sets`, `effort`, `deload`), `lb_workouts` + `lb_exercises` from the full logger, `prefs/main.profile`, `prefs/main.dietBreak`, `prefs/main.dislikes`.

Per the gap audit: targets come from **AppTargets** (pass `targets: AppTargets.resolve(profile, PLAN)`); nothing personal is hard-coded, and a missing target stays null (cards say "No calorie target set" instead of guessing). Workouts read **`lb_workouts` first** (working sets only, `done !== false`, **lb converted to kg** per exercise `unit`), then `workouts/{date}.sets` for dates the logger has nothing for. Effort/deload always come from `workouts/{date}`. Review periods are 14-day blocks from `targets.start` (profile start, Oct 25 → Nov 7 is block 1).

## The 14-day review
- **Window:** the latest finished 14-day block; while the first block is running it shows "day X of 14". Today is left out (half-logged). Arrows step through earlier blocks.
- **Checks:** weight pace (least-squares slope on raw weigh-ins, % of body weight a week, week-1 vs week-2 averages), calories (days within ±band of the day's target, Fridays left out of adherence but their average shown), protein (avg, days at the minimum), training (sessions, working sets, avg effort), strength (best Epley e1RM in week 2 vs the 7 days before it; up > +1%, down < −2%), sleep.
- **Needs** 6+ weigh-ins with 2+ in each week and 7+ days with food eaten; otherwise it lists what's missing.
- **Goal plan:** pass `plan` (`prefs/main.goalSetup` from GoalSetup). The review then judges the pace in the plan's direction: a cut or gain plan sets the band to 0.6–1.5 × the chosen % of body weight a week (clamped 0.2–1.2; `rules.paceLo/paceHi` still override), a maintain plan uses ±0.3 kg a week (`on-track` steady, `drift` → *suggest* a 50–100 kcal nudge when eating was on target, `adherence` otherwise). A gain that is too fast suggests fewer calories; a stalled gain suggests more. Every review carries `basis`: "Based on your plan (…), N kcal and 14 days of logs: n weigh-ins, n food days, n sessions" (or "your targets" without a plan), shown under the card.
- **Verdicts:** `on-track` (pace within 0.5–1%/wk → keep), `slow` (0.25–0.5% → hold one more period), `stalled` (< 0.25% with ≥70% on-target days and ≥70% days logged → *suggest* −150 kcal, not below `rules.floor`, or more steps), `adherence` (low pace but adherence is the issue → no calorie change), `too-fast` (> 1%: first two weeks = water, keep; later → *suggest* +150), `diet-break` (4+ break days in the block), `not-enough-data`.
- **Tips** with their evidence: protein short, several lifts dropping, EffortDeload nudge (pass `effort`), sleep under 7 h, many estimated foods.
- **Never silently changes targets.** A change recommendation carries `change: {key:"profile.cutKcal", from, to}`; the card shows a "Use N kcal" button only if the host passes `onApply`, and the module calls it only on a tap.

## Patterns in your logs (insights)
`Coach.insights(docs, opts)` works out up to 3 insights locally, each only with enough data: new PRs this week, strength falling on 2+ lifts (3 sessions down), protein under the minimum on half the logged days, effort 4–5 on 3 of the last 4 sessions, lifts after short sleep vs full nights (3+ each, 8 weeks), weight-loss pace slowing (14 vs 14 days), recovery check-ins improving, volume imbalance (from `opts.strength`), protein on rest vs training days (28 days), and the weekday that runs over target. `opts.seen` (`{id: date}`) hides an id for `repeatDays` (7). `Coach.insightsHtml` renders the card; dismiss calls `opts.onDismiss(id)` (the app stores `prefs/main.coachSeen`),

## API
```js
Coach.css
Coach.targets(docs, opts)              // resolved targets + coaching rules
Coach.periods(docs, {today, targets})  // [{from, end, to, partial}]
Coach.review(docs, opts)               // {period, verdict, headline, checks[], recs[], missing[], numbers, basis}
Coach.reviewHtml(docs, opts)           // Progress card
Coach.summary(review)                  // copyable text
Coach.liftHistory(docs, today)         // per-lift recent sessions, best e1RM, PR flag
Coach.insights(docs, opts) / Coach.insightsHtml(docs, opts)
Coach.bind(document, { getDocs, render, today, targets, rules, plan, kcalTarget, onApply, onDismiss })
```
`opts`: `today`, `targets` (AppTargets object), `rules` (`{floor, step, band, paceLo, paceHi}`; defaults 1800 / 150 / 150 / 0.5 / 1.0), `kcalTarget(date)` (the app's per-day target, e.g. diet-break days), `plan` (the saved goal plan `{answers, result, at}`), `effort` (EffortDeload.analyze result), `tdee` (TrendTDEE.estimate result), `strength` (StrengthAnalytics.analyze, for the balance insight), `seen` (insight ids → date), `from` (a block start).

## Wiring in the app
```js
Coach.bind(document, { getDocs: () => S.docs, render, today: () => TODAY, targets: () => APPT, rules: () => ({ floor: KCAL_FLOOR }), kcalTarget,
  plan: () => S.docs.prefs.main?.goalSetup || null,
  onDismiss: id => { /* prefs/main.coachSeen[id] = TODAY */ },
  onApply: ch => { /* two taps, then prefs/main.profile.cutKcal = ch.to */ } });
// Progress → Reviews:
html += Coach.insightsHtml(S.docs, { ...coachOpts(), seen: S.docs.prefs.main?.coachSeen || {} }) + Coach.reviewHtml(S.docs, coachOpts());
```
`S.docs` must include `lb_workouts` and `lb_exercises` for the logger's sessions to count. Only wire `onApply` if `profile.cutKcal` actually drives the day target; otherwise leave it out and the suggestion shows without a button.

Tests: `node --test modules/coach/coach.test.js` (22 cases).
