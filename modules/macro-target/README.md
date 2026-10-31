# Log by target macro

Type what you want from a food and the card works out the grams, then logs it as a food row. The MacroFactor-style "I want 40 g protein from chicken" flow (NEXT-WORK / Reddit idea 25).

- `macro-target.js`: pure logic + card. Browser global `window.MacroTarget` or CommonJS. No network.
- `macro-target.test.js`: `node --test modules/macro-target/macro-target.test.js`

## Phrasings

| Input | Result |
|---|---|
| `40 g protein of grilled chicken` | 129 g grilled chicken breast (213 kcal, 40 P) |
| `300 kcal rice` | 231 g cooked white rice |
| `50 g carbs from oats` | 75 g oats |
| `20 g fat avocado` | 133 g avocado |
| `150 g salmon` | plain weight, scaled from per-100 g |

The macro word can sit before or after the number. Grams with no macro word is a weight; a bare number with no unit defaults to protein.

## API

- `parse(text)` → `{amount, macro: "p"|"c"|"f"|"kcal"|"g", query, unit}` or `null` without a number.
- `find(query, {foods, extra})` → `{food, candidates}`. Alias and token match against `FOODS` (per-100 g catalog of ~40 common foods) plus any `extra` per-100 g entries.
- `gramsFor(food, macro, amount)` → grams, or `null` when the food has none of that macro.
- `scale(food, grams)` → `{name: "Grilled chicken breast, 129 g", kcal, p, c, f, grams, est: true}`.
- `solve(text, {custom, foods, extra})` → `{ok, parsed, food, grams, item, note, candidates}` or `{ok:false, parsed, reason, candidates}`. `custom = {name?, kcal, p, c, f}` per 100 g replaces the catalog match (food not in the list); kcal is filled from macros when blank.
- `summary(res)` → one line.
- `html(date)`, `bind(root, {date, render, onAdd(date, items)})`, `css`. State lives in the module so the app's re-renders keep the typed text and result.

## Where it goes

Food tab, under the Add food card. `onAdd` receives food rows (`name, kcal, p, c, f, grams, est, slot, eaten`) ready for `days/{date}.food` after the app adds an `id`.

## Catalog

Typical label / USDA figures per 100 g cooked (dry for oats, ml for milk and laban). All rows are marked `est: true`. Edit `FOODS` to add or correct an entry.
