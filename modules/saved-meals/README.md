# Saved meals (one-tap combos)

Save a food combo, like a usual Nutreeze day, and add it back to any day with one tap.

- `saved-meals.js`: plain JS, no imports or network. Browser global `window.SavedMeals`, or CommonJS.
- `saved-meals.test.js`: `node --test modules/saved-meals/saved-meals.test.js`
- `apply-patch.js`: inlines the module into the app and wires the card. `node modules/saved-meals/apply-patch.js app/index.html`
- `preview.png`: the card on the Food tab at phone width.

## Data

New synced collection `meals`, one doc per combo:

```
meals/{id}: { id, name, items:[{name,slot,kcal,p,c,f,est}], created, lastUsed, uses }
```

Items are `days/{date}.food[]` entries without `id` and `eaten`. Adding a combo writes fresh items into `days/{date}.food` as planned (`eaten:false`) with new ids.

## API

| Function | What it does |
|---|---|
| `fromItems(food, {name, onlyEaten, existing})` | Combo from a day's food. Name defaults to the two meals ("French Tacos Chicken + Chicken Biryani"); id is a unique slug. |
| `applyToDay(day, combo, {uid, eaten, mode, allowDuplicates})` | Returns `{day, added, skipped}`. Skips items already on the day (same name + slot) so a double tap does nothing. `mode:"replace"` drops the day's planned items and keeps eaten ones. Never mutates input. |
| `markUsed(combo)` | Bumps `uses` and `lastUsed`; the list sorts most used first. |
| `sorted(meals)`, `totals(items)`, `rename`, `parse(json)` | Helpers. |
| `cardHTML(meals, {day})` | The Food tab card, using the app's `data-act` / `data-form` conventions. |

## What the patch changes in the app

1. Inlines `saved-meals.js` in its own `<script>` before the main script.
2. Adds `"meals"` to `COLS` and `S.docs`.
3. Renders `SavedMeals.cardHTML(S.docs.meals,{day})` on the Food tab, right under the add form.
4. Click: `meal-add` (one tap adds the combo to the selected date and bumps its usage), `meal-del` (tap twice to delete).
5. Submit: `meal-save` saves the selected day's food under the typed name (or the suggested one).

Tested end to end in Chromium against both the repo copy and the published copy: save a day, add it to the next day, tap again (no duplicates), delete.
