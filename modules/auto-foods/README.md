# Auto foods (foods that repeat on a schedule)

Idea 24 from the app-ideas list (MacroFactor-style scheduled foods). Adonis every day and Gatorade 1 L on training days are added to the day as **planned rows to confirm** the first time the day is opened. Nothing counts until the row is ticked; removing the row skips that day.

## Files
- `auto-foods.js`: plain JS, no imports, no network. Browser global `AutoFoods` or CommonJS.
- `auto-foods.test.js`: `node --test modules/auto-foods/auto-foods.test.js` (12 tests).

## Rules it keeps
- **Pending, never eaten.** Rows are `eaten:false`, so macro bars, TrendTDEE, BudgetRecovery and DailyScore ignore them until Aziz ticks them.
- **Once per day.** `days/{date}.auto = {ruleId: "added"|"skipped"}` remembers what was done, so a deleted row is not re-added and a tick is not undone by a re-render. A food already on the day with the same name (or the same drink key) is claimed instead of duplicated.
- **No back-filling.** Past days are never touched; only today and future days get rows.
- **Drinks go through SuppDrinks.** A rule with `drink:"gatorade"` plans through `SuppDrinks.planDrink`, so the row carries the drink tag, counts as fluid once confirmed, and respects the label-first rule (an unlabelled drink is left for the Drinks card to ask about).
- **Supplements stay in SuppDrinks.** The card says so; this module never writes `supps` or `suppLog`.

## Data
- `prefs/main.autoFoods = {id: {id, name, slot, kcal, p, c, f, est, when, drink, off, created}}`, `when` one of `daily | training | rest | saturday | friday`. `prefs/main.autoFoodsSeeded = true` once the two defaults were written, so deleting them all doesn't bring them back.
- `days/{date}.auto` as above; auto rows carry `auto: ruleId`.

## API
| Function | What it does |
|---|---|
| `seed(prefs)` | New prefs with the Adonis + Gatorade defaults, or `null` if already seeded. |
| `plan(day, prefs, {date, today, training, type}, {uid, planDrink})` | Adds every due rule the day hasn't seen. Returns `{day, added, changed}`; never mutates. |
| `onRemove(day, item)` / `onRestore(day, item)` | Mark the rule skipped / added again for that day. |
| `apply(action, data, prefs, day)` | `toggle`, `del`, `from` (rule from a food row by id), `save` (form). Returns `{prefs?, day?, toast?}`. |
| `html(rules, {day, training, type, hasDrinks})`, `readForm(document)` | The Food-tab card (`data-af` buttons, `data-form="af-save"`). |
| `status(rule, day, ctx)`, `due(rule, ctx)`, `adherence(getDay, date, prefs, n)` | Helpers for the card and the coach. |

## Wiring in the app shell (done in build/shell.html)
1. `autoFoodsTick()` at the start of `render()`: seeds prefs once, then runs `plan` for the viewed date and saves quietly when rows were added. It waits until the `days` and `prefs` collections have synced so an empty day is never written over the server copy.
2. Food tab: `AutoFoods.html(...)` under Saved meals; food rows show "auto".
3. `delfood` calls `onRemove`, its Undo calls `onRestore`.
4. Click `[data-af]` and submit `af-save` go through `AutoFoods.apply`.
