# Nutrition label scanner ("Scan a nutrition label")

A Food tab card for packaged foods the barcode lookup misses (most local Kuwait products): photograph the nutrition facts panel, Claude copies the numbers through the Artifact `sample` capability (images), every field stays editable, and **Save** stores the product as a custom food. It also fills in the labels the plan still owes: Gatorade, ISO100, milk and eggs.

- `label-scan.js`: the module (`LabelScan`). Plain JS, no imports, no network of its own. API in the header comment.
- `label-scan.test.js`: `node --test modules/label-scan/label-scan.test.js`

## What it does

1. **Photograph the label** (`<input type=file capture>`, so it opens the phone camera; no camera permission needed). The photo is downscaled to 1600 px JPEG and sent with `LabelScan.prompt()`: copy exactly, never estimate, `null` when unreadable, kJ to kcal, per 100 g/ml and per serving when both are printed.
2. **Review**: product, brand, per-100 (g or ml) kcal/P/C/F, serving amount and name, optional barcode, the "Is this a label the plan still needs?" picker (auto-selected when the name matches Gatorade, ISO100, milk or eggs). Flags: missing fields, kcal more than 15% off 4P+4C+9F, per-100 derived from the serving column.
3. **Save food** / **Save + add one serving**. "Type it in" opens the same form empty, so the card works without `sample`.
4. **Your foods from labels**: every `source:"label"` or `"manual"` product in the library, newest first, with one-tap **+ Add** (one serving, or 100 g/ml).

## Data

- Library record, same collection and shape as the barcode scanner (`barcodes/{code}`), plus `basis` and `labelAt`:
  `{code, name, brand, quantity:"", basis:"g"|"ml", per100:{kcal,p,c,f}, serving:{g,label}|null, missing:[], derived, source:"label", labelAt}`.
  `code` is the barcode when Claude read it, else `lbl-<brand-name slug>`. Scanning the barcode later finds the product at once.
- Food row: `{name:"KDD Low fat milk (250 ml)", slot, kcal, p, c, f, eaten:false, est, barcode, grams}` (`est` only when a field was left blank or derived).
- Owed labels, `LabelScan.owedUpdate(prefs, key, product, {drinkLabel})` on `prefs/main`:
  - `labels[key] = {name, brand, code, per, basis, kcal, p, c, f, est, at}`: per bottle (label quantity or 1 L) for Gatorade, per scoop for ISO100, per 250 ml for milk, per serving for eggs.
  - `open.gatorade = true` ticks the "Still to send" item on Guide.
  - Gatorade also goes through the host's `drinkLabel` hook (`SuppDrinks.saveDrinkLabel`), so the Drinks card stops saying "check label".
  - `LabelScan.fixedOverride(fixedItem, prefs.labels)` gives the shell's Gatorade and ISO100 quick-add items the saved numbers with `est:false`. Eggs and milk are not overridden (the Saturday eggs item is a composite breakfast).

## Plugging it in

```js
document.head.append(Object.assign(document.createElement("style"), { textContent: LabelScan.CSS }));
LabelScan.mount(document.getElementById("lsHost"), {   // after each Food render, like BarcodeFood
  getSample: () => window.claude.use("sample").catch(() => null),
  library: { all: () => S.docs.barcodes, get: c => S.docs.barcodes[c], put: (c, p) => put("barcodes", c, p) },
  prefs: () => S.docs.prefs.main, savePrefs: p => put("prefs", "main", p),
  drinkLabel: SuppDrinks.saveDrinkLabel, onAdd: addFood, toast, slot: "Extra",
});
```
The app must declare `sample: {images: true}` (it already does for the photo logger). Without a `library` option the module falls back to `localStorage` (`labelScan.library`).
