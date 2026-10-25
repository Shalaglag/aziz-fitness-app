# Drinks and supplements

Feature 8 of the spec: water, Gatorade, Pocari Sweat, whey, creatine, vitamin D3, omega-3 and magnesium on one Today card, with drink calories and a supplement schedule. Nothing counts until Aziz taps it.

## Files
- `supps-drinks.js`: plain JS, no imports, no network. Browser global `SuppDrinks` or CommonJS.
- `supps-drinks.test.js`: `node --test modules/supps-drinks/supps-drinks.test.js` (12 tests).
- `preview.html`: the card wired to an in-memory day, open it next to `../theme/`.

## Rules it keeps
- **Confirm to count.** A planned drink is a food row with `eaten:false`. Macro bars, TrendTDEE, BudgetRecovery and DailyScore already skip uneaten rows, so a planned Gatorade is never counted until "Drank it". Logging a drink that is already planned confirms that row instead of adding a second one.
- **Supplements only on a tap.** Today shows Due / Later; a past day with no tap shows "Not logged", never "missed" and never "taken".
- **No invented nutrition.** Gatorade (240 kcal / 60 g carbs per 1 L, the app's existing estimate) and Pocari Sweat (125 kcal / 31 g carbs per 500 ml, common label) are flagged `est` until Aziz saves his own label. Whey has no default: it can't be logged until the scoop's kcal and protein are saved once.
- **DailyScore unchanged.** `days/{date}.supps` stays `{key: bool}` with the same four keys (creatine, omega, d3, mag), so the score's denominator doesn't move. Whey and Pocari are drinks, not supplements. A custom supplement added in the schedule writes its own key, which DailyScore ignores.
- **Targets.** The module has no kcal/protein targets of its own; drink kcal flow into the existing food totals, which read AppTargets.

## Data
- Drinks with calories: rows in `days/{date}.food` with `slot:"Drink"` and `drink:{key, ml}`, plus `at` when confirmed. Storing them in `food` (not a separate list) means every calorie consumer counts them once with no changes.
- Hydration: `totalFluid(day) = water + waterh.ml + confirmed drink ml`. Replace `totalWater(day)` in the Water card with it.
- Supplements: `days/{date}.supps = {key: true|false}` (unchanged) and new `days/{date}.suppLog = {key: {at, skipped?}}`.
- Prefs: `prefs/main.drinks = {key: {name, ml, kcal, p, c, f, est:false, labelAt}}` (label overrides and custom drinks) and `prefs/main.suppPlan = {key: {name, dose, time "HH:MM", with, on}}`.
- Default schedule (from the supplement box): creatine 5 g 2 pm with Meal 1; D3 4,000 IU and omega-3 8:30 pm with Meal 2; magnesium 10:30 pm before bed.
- `migrateDay(day)` tags old `"Gatorade 1 L"` food rows as drinks without changing their eaten state. Idempotent.

## Wiring in the app shell
1. Inline the file, inject `SuppDrinks.css` once.
2. In `getDay(d)`, run the result through `SuppDrinks.migrateDay(day, prefs)`.
3. Today tab: render `SuppDrinks.html(day, prefs, {date:d, today:TODAY, training})` and drop the four supplement checkboxes from the Checklist card (keep treadmill and sleep there).
4. Water card: show `SuppDrinks.totalFluid(day)` instead of `totalWater(day)`, and change the note "Use the buttons above for Gatorade" to point at the Drinks card so Gatorade isn't added twice.
5. "Add Adonis + Gatorade" on Food: add Adonis as now, and Gatorade via `SuppDrinks.planDrink(day, "gatorade", prefs, {uid}).day` so it carries the drink tag.
6. Click handler:
```js
const sd = e.target.closest("[data-sd]");
if (sd) {
  const a = sd.dataset.sd, data = Object.assign({}, sd.dataset, /save$/.test(a) ? SuppDrinks.readForm(document, sd.dataset.key) : {});
  const r = SuppDrinks.apply(a, data, getDay(d), S.docs.prefs.main || {}, {uid});
  if (r.day) saveDay(r.day);
  if (r.prefs) put("prefs", "main", r.prefs);
  if (r.toast) toast(r.toast);
  if (r.open) { const det = document.querySelector(".sd-card details"); if (det) det.open = true; }
  return;
}
```
7. Food tab: rows with `slot:"Drink"` can render in their own group (or with Fixed). They tick like any food row.
8. Coach / 14-day review: `SuppDrinks.adherence(getDay, date, prefs, 14)` and `SuppDrinks.summary(getDay, date, prefs)`.
