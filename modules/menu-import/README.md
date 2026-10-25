# Menu import + meal optimiser ("Plan my day from a menu")

Feature 3 of Aziz's spec: upload a restaurant or meal-prep menu, read each item's macros, and pick the best
**2 meals + 2 snacks + Adonis** for the day's targets (2,000 kcal and 160–170 g protein by default), leaving out
never-pick foods and flagging any number that needs a check.

| File | What it is |
|---|---|
| `menu-import.js` | The module (`MenuImport`): parser, PDF text reader, image prompt, optimiser wrapper and the Food tab card. Plain JS, no imports, no network of its own. API in the header comment. |
| `menu-import.test.js` | `node --test modules/menu-import/menu-import.test.js`. The two real-PDF tests run when `pdfjs-dist@3.11.174` is installed (`npm i --no-save pdfjs-dist@3.11.174`), otherwise they skip. |
| `apply-to-app.js` | Inlines the module into the single-file app: `node modules/menu-import/apply-to-app.js app/index.html [out.html]`. Also re-inlines the updated picker engine. |
| `preview.html` | The card on its own, saving to this browser. Open it next to `samples/`. |
| `samples/` | `table-menu.pdf` (table page with sections and prices, plus a two-column salad page) and `scanned-menu.pdf` (image only, no text). |

## How a menu is read
1. **PDF with text** (most restaurant and meal-prep PDFs): pdf.js reads the text layer in the browser. Rows are rebuilt from text positions, two-column pages are read left column first. No Claude call, and the numbers are exactly the printed ones.
2. **Scanned PDF or screenshots**: the pages are sent to Claude through the app's `sample` capability (already declared with images since v10). Claude is told to copy numbers and use `null` for anything it can't read, never to estimate.
3. **Pasted text** or the Nutreeze Menu Reader's Copy JSON also work.

The parser understands one item per line (`Name 650 55 60 20`, `Name — 607 kcal | 67 P | 60 C | 11 F`), tables with a header row in any column order, name/description/number blocks, section headings (Mains, Snacks, Desserts, Salads, Drinks...), KD prices, decimal commas and duplicates.

## What gets flagged (needsCheck)
- a number is missing or unreadable (it stays empty; kcal is never calculated for you, the hint only shows 4P+4C+9F),
- kcal is more than 15% off 4P+4C+9F (same rule as the Menu Reader),
- columns weren't labelled and the order had to be guessed,
- Claude said it wasn't sure, or the item was listed twice with different numbers.

Each flagged item has an **OK** button (numbers match the menu) and every number is editable. Items with a missing number are left out of the optimiser until filled in. "Only use checked numbers" leaves out every unconfirmed item; otherwise they can be picked but the plan says which numbers aren't confirmed, and planned items from them are marked as estimates.

## Optimiser
`MenuImport.optimize(items, NutreezePicker, opts)` runs the existing picker engine over every meal pair and snack pair:
- meals = the menu's `meal` items (salads and soups join when there are fewer than 2),
- snacks = the menu's own `snack` items when there are 2+, else the fixed Nutreeze snack list,
- Adonis on by default (toggle on the card), Gatorade on training days, Saturday eggs as before,
- never-pick: one check, `MenuImport.makeBanned(engine, prefs/main.dislikes)` = the picker's built-in rules plus the dislikes matched as whole words (same rule as `MealPrefs.classify`),
- targets: `opts.targets` takes an AppTargets object; the app hook passes `AppTargets.forKcal(resolve(profile), kcalTarget(date))` when AppTargets is inlined, else `{kcal: kcalTarget(date)}`. The engine's 2,000 / 160–170 numbers are only the fallback.

"Plan this day" writes the picks as **planned** items (`eaten:false`); only ticked items count.

## Engine changes (`tools/meal-picker/picker-engine.js`)
`pick()` takes two new options, both optional so the standalone picker and the current app keep working:
`snacks` (a menu's snacks; replaces the fixed list when 2+ are given) and `targets` (AppTargets shape or `{kcal, proteinMin, proteinMax, fat:[lo,hi], carbs:[lo,hi]}`). Verdict text now uses the targets instead of "2,000"/"160 g". New exports: `targetsFrom`, `snackCat`. The Oct 27 sample still gives 1,970 kcal | 164 P.

## App data
New synced collection `menus/{date}` in the Nutreeze menu format (`docs/nutreeze-menu-format.md`) plus `source` (`pdf`, `pdf-image`, `image`, `text`), `confirmed` and `skip` per item.
