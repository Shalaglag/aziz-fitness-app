# Protein gap closer

Shows how much protein and kcal are left today and suggests the smallest add (in kcal) that gets protein to 160 g without going over 2,000 kcal. Dislikes are never suggested.

- `protein-gap.js`: pure logic, no DOM, no network. Browser global `window.ProteinGap` or CommonJS.
- `protein-gap.test.js`: `node --test modules/protein-gap/protein-gap.test.js`

## API

- `remaining(food, {basis})` → `{totals, kcalLeft, proteinLeft, proteinToMax}`. `food` is `days/{date}.food`. `basis: "plan"` (default) counts eaten + planned items; `"eaten"` counts only ticked items.
- `suggest(food, opts)` → `remaining(...)` plus `status`, `best`, `alternatives` (up to 2), `skipped` (names removed as dislikes).
  - `status`: `met` (already ≥160 g), `closable`, `partial` (nothing closes it under 2,000 kcal; `best` is the most protein that fits, with `short`), `no-room`.
  - `best`: `{items:[{id,name,servings,kcal,p,c,f,est}], add, after:{kcal,p}, short}`.
  - opts: `dislikes` (strings, e.g. `prefs/main.dislikes`, substring match like the app), `never` (meal-preferences entries; defaults to the snack/fish/sandwich never rules), `extra` (more candidates `{name,kcal,p,c,f,max?}`, e.g. today's menu), `exclude` (ids or names), `maxItems` (3), `targets`.
- `summary(res)` → one line, e.g. "20 g protein and 300 kcal left. Add Dymatize ISO100 scoop (in water): +25 g protein, +120 kcal (ends at 165 g, 1820 kcal)."
- `toFoodItems(res.best)` → planned items with slot `add`, ready to push into `days/{date}.food`.

## Candidates

ISO100 scoop (est. 120 kcal / 25 g), low-fat milk 250 ml (est.), an extra Adonis, 2 boiled eggs (est.), and the Nutreeze snack menu. Kinder Protein Ball, Popcorn and Blueberry Muffin are removed by the never list. Ranking: least kcal, then fewer servings, then less protein overshoot.

## Where it goes

Food tab (and the Today summary), under the macro bars: show `summary()` and an "Add to today" button that appends `toFoodItems(best)`. Pass `dislikes: S.docs.prefs.main?.dislikes`.
