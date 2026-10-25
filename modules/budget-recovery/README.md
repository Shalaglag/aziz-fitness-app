# Over-budget day recovery

When a day ends more than 100 kcal over its target, the app offers a calm way back instead of a crash day.

## What Aziz sees
A "Went over today?" card on Today (or Food) with three choices:
- **Walk it off:** one extra 30-min brisk walk today or tomorrow (~150–200 kcal at ~92 kg, on top of the usual post-lift treadmill). If the surplus is bigger than that, the rest is spread as below. Suggested when the surplus is 200 kcal or less.
- **Spread it:** the surplus comes off the next 3 days (Fridays skipped), at most 150 kcal a day. Suggested above 200 kcal.
- **Let it go:** nothing changes; the weekly average is what counts.

## The rules (from the plan)
- Target 2,000 kcal. Within 100 kcal (the app's own "on target" band) nothing is offered.
- No day ever goes below **1,850 kcal**, even when cuts stack from two bad days. The plan rules out 1,800/1,700/1,500 days.
- Anything above 450 kcal (3 × 150) is let go: one day does not undo a week.
- **Friday is a free day:** a Friday surplus offers nothing, and Fridays never get cut.
- Cuts come from carbs or fat; protein stays at 160 g+.

## For the app thread
`budget-recovery.js` defines `BudgetRecovery` (plain JS, no imports, no network):

| Call | Use |
|---|---|
| `BudgetRecovery.css` | inject once; uses `--line --sunk --ink --muted --accent --accent-ink --warn --r --mono` |
| `plan(date, S.docs.days)` | `{reason, surplus, target, options:{spread, walk}, recommended, text}`; `reason` is `under`, `small`, `friday`, `handled` or `recover` |
| `cardHtml(plan)` | the card, `""` unless `reason === "recover"`; buttons carry `data-recover="walk|spread|skip"` and `data-recover-date` |
| `apply(plan, choice)` | `[{date, patch}]`; deep-merge each patch into `days/{date}` |
| `targetFor(date, S.docs.days)` | that day's kcal target after cuts; use it wherever the app shows 2,000 (Today ring, macro bars, "kcal over" message) |

Suggested wiring:

```js
// Today render, for the selected date (show from the evening on, or once the day is past)
html += BudgetRecovery.cardHtml(BudgetRecovery.plan(date, S.docs.days));

// delegated click
const b = e.target.closest("[data-recover]");
if (b) {
  const d = b.dataset.recoverDate;
  BudgetRecovery.apply(BudgetRecovery.plan(d, S.docs.days), b.dataset.recover).forEach(({ date, patch }) => {
    const cur = S.docs.days[date] || { date, food: [] };
    put("days", date, { ...cur, ...patch, budgetAdj: { ...(cur.budgetAdj || {}), ...(patch.budgetAdj || {}) } });
  });
}

// targets
const kcalTarget = BudgetRecovery.targetFor(date, S.docs.days); // replaces TARGET.kcal for that day
```

New fields: `days/{date}.recovery = {choice, surplus, at}` on the over day, `days/{date}.budgetAdj = {<overDate>: -kcal}` on the days that absorb it.

Tests: `node --test modules/budget-recovery/budget-recovery.test.js` (12 cases: eaten-only totals, on-target band, Friday free day, even spread, walk suggestion, Friday skipped, 150/day cap with the rest let go, stacked cuts held at 1,850, apply output, handled day, Friday target, card buttons).
