# Food library (`FoodLib`) and food search (`FoodSearch`)

The shared foundation for food logging (Aziz's Nov 7, 2026 spec, work area 1): one record shape for every source, portion maths with no AI, and one ranked search over all of them. Everything else (recipes, photo and label estimates, the single Add food flow) builds on these records.

- `food-library.js`: pure logic, no network of its own (`FoodLib.usdaSearch` / `offSearch` take an injected `fetch`). Browser global `FoodLib` or CommonJS.
- `food-search.js`: the Search tab of the Add food sheet (`FoodSearch.mount(host, opts)`), owns its DOM so typing survives app re-renders.
- `catalog.json` (`FOOD_CATALOG`): 106 everyday ingredients per 100 g / 100 ml, **typical USDA-based values**. Always shown and logged as *Typical values (estimate)*; a live USDA search gives the source-backed record with its FDC id. Portions only where a weight is known (1 cup cooked rice = 158 g, 1 large egg = 50 g…).
- `restaurants.json` (`FOOD_RESTAURANTS`): published restaurant nutrition per restaurant **and market**. The McDonald's Kuwait block is **empty on purpose** (see "Filling McDonald's Kuwait"): no Kuwait table exists, and values from another country are never used for a Kuwait item.
- Tests: `node --test modules/food-library/food-library.test.js`.

## The record

```js
{ id: "usda:169756",                 // usda:<fdcId> | off:<barcode> | lib:<code> | rest:<restaurant>:<item> | cat:<slug> | recipe:<id>
  kind: "food" | "meal" | "recipe", name, brand, restaurant, market: "KW" | null, prep: "raw" | "cooked" | "as-sold" | null,
  basis: { kind: "per100g" | "per100ml" | "serving", amount, unit, label },
  nutrients: { kcal, p, c, f, fiber, sugar, sodium },   // null = the source gives no value (never silently 0)
  derived: ["kcal"],                                    // kcal was calculated from the macros (flagged, never hidden)
  portions: [{ label: "1 cup", g: 158 }],              // only real conversions from the source
  includes: ["Medium fries", "Medium Coca-Cola"],      // restaurant meals
  source: { kind, id, url, dataType, publishedAt, retrievedAt, note },
  grade: "source" | "user" | "reviewed" | "estimate" }
```

`publishedAt` is the source's own date; `retrievedAt` is when the app fetched it. The Details fold shows both and says that fetching does not make a record newer.

## Portion maths (`FoodLib.scale(rec, amount)`)

`amount` = `{g}` | `{ml}` | `{servings}` | `{portion: label | index, count}`. Linear from the basis; published kcal is kept (never replaced by 4P+4C+9F); unknown nutrients stay `null` and are listed in `unknown`. 200 kcal per 100 g × 150 g = 300 kcal. No invented conversions: grams on a per-100 ml record, ml on a per-100 g record, servings on a per-100 g record, or grams on a meal with no weight all return `null`, and the card says which units the food takes. Raw and cooked are separate records. `FoodLib.parseAmount("150 g" | "250 ml" | "2 servings" | "1.5 cup", rec)` reads what the person typed.

`FoodLib.toRow(rec, scaled, {slot, eaten})` gives a `days/{date}.food` row that copies the numbers at logging time (a later change to the source never rewrites old logs) with `est` set when the grade is estimate, a macro is unknown or kcal was derived, plus `src: {id, kind, grade, basis, unknown}` for the row's own source line.

## Sources and search

| Source | How | Grade |
|---|---|---|
| Bundled catalog | `FoodLib.fromCatalog` | estimate ("Typical values") |
| Your products (`barcodes/{code}`: barcode scans, label scans, hand-entered) | `FoodLib.fromLibrary` | source (Open Food Facts) / user |
| Restaurants (`restaurants.json`) | `FoodLib.fromRestaurant`, `restaurantRecords` | source |
| USDA FoodData Central | `FoodLib.usdaSearch(q, {fetch, base, token, cache})` → the Mizan service `GET /v1/foods?q=` (the data.gov key stays on the server; no AI, no spending; cached a day). Picking a result fetches `GET /v1/food?id=` for household portions. | source |
| Open Food Facts text search | `FoodLib.offSearch(q, {fetch, cache})`, straight from the phone, only when the person presses the button (10 searches a minute per IP; never as-you-type) | source |
| Recipes (work area 2) | `FoodLib.fromRecipe` | user / estimate |

`FoodLib.search(q, records, {favourites, recents, market, limit})` ranks by token and prefix matches (aliases: khubz → bread, laban → yogurt, dajaj → chicken…), prefers cooked unless the query says raw, boosts favourites, recents, your own entries and the KW market, and **never merges** two records because their names look alike: the same rice from USDA and the catalog are two results with their own source lines.

## Personal foods and recipes (work area 2)

- **Save my version** in the review step: correct any record's numbers (per its basis) and save it as a personal product in `barcodes/{my-<slug>}` (`source: "manual"`, grade *Your entry*). The original record stays; search lists your version first; old logs keep the numbers they were logged with.
- **Recipes** (`modules/recipes`, `Recipes`, collection `recipes/{id}`): real ingredients with amounts, servings and an optional finished batch weight. Totals are the sum of the ingredients (numbers copied when each one is added); per serving = totals ÷ servings; per gram only when the finished dish was weighed (2,400 kcal in 1,000 g → 250 g = 600 kcal). Raw weights are never summed into a cooked weight. Ingredients come from the same food search (`FoodSearch` with `onPick`), amounts rescale linearly in the unit they were added with, "Save day as recipe" turns a logged day into a recipe. A recipe is a FoodLib record (`Recipes.toRecord`) so it is searchable and logged by servings or grams through the same review step; it carries *Personal recipe* and "(estimate)" when any ingredient was a typical value or had unknown macros.

## In the app

Add food sheet → **Search** tab (`#flHost`, `mountFoodSearch()` in the shell). Local results appear as you type; **Search USDA** and **Packaged (Open Food Facts)** run on request. Picking a result opens the review: amount box with the record's portion chips, live kcal/P/C/F (unknown macros greyed and named), the source line (grade · basis · prep · includes), **Details** (source, id, published and fetched dates, link), meal slot, Eaten now, **Add**. Favourites (★) live in `prefs/main.foodFavs`, recents in `prefs/main.foodRecents` (last 60), both synced.

## Filling McDonald's Kuwait (gap, Nov 7 2026)

McDonald's Kuwait publishes no usable per-item nutrition: the Kuwait site's nutrition page links only a McDonald's Arabia PDF named `nutrition-info-jeddah-en-new.pdf` ("current as of 2017"), which by its name is the Jeddah (Saudi) table, and the Kuwait product pages carry no protein, carbs or fat. The block therefore has no items. When a Kuwait table appears:

```
pdftotext -layout <kuwait-table>.pdf mcd.txt
node tools/restaurants/import-mcd-arabia.js mcd.txt --dry      # check the parsed rows and the column order
node tools/restaurants/import-mcd-arabia.js mcd.txt            # writes restaurants.json; then node build/build.js
```
A cell printed "-" stays unknown. Meals get `kind: "meal"`; say in `includes` what is in the box. Other restaurants with a published local table (any market) go in the same file as their own block.

## Shell integration (Add food sheet)

`mount` option `onAdd(row)` may return `false` to keep the review step open (the app's duplicate guard does this when the same food was added moments ago). `pickRecord(rec)` opens the review for a record from outside (recipes list, "Fits what's left today" suggestions). The Add button is handled on click with `preventDefault`, so the form submit does not add a second time.
