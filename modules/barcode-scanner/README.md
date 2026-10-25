# Barcode food scanner

Scan a packaged food's barcode, look it up on [Open Food Facts](https://world.openfoodfacts.org), pick the grams and add it as a row in `days/{date}.food[]`. Products Open Food Facts doesn't know (common for local Kuwait barcodes) can be entered once from the label and fill in by themselves on every later scan.

- `barcode-food.js`: the module (`BarcodeFood`). Plain JS, no imports. Its only network call is the Open Food Facts lookup, made through an injectable `fetch`.
- `preview.html`: standalone page that mounts the card. Open it in Chrome on Android to try the camera.
- `test/`: `node --test modules/barcode-scanner/test/barcode-food.test.js` (no install needed).

## How scanning works

| Way in | Where it works |
|---|---|
| **Scan with camera** (live video + `BarcodeDetector`) | Chrome on Android. Needs camera permission; may be blocked inside a claude.ai Artifact frame, in which case the card says so. |
| **Photo of barcode** (`<input type=file capture>` + `BarcodeDetector`) | Chrome on Android, including inside an Artifact: it opens the phone's camera app, no camera permission needed. |
| **Type the number** | Everywhere, including Chrome on Windows, which has no `BarcodeDetector`. |

Codes are checked (EAN-8, UPC-A, EAN-13, GTIN-14 check digit) before any lookup.

## Lookup and fallbacks

1. The **library** first: products already looked up or entered by hand.
2. Open Food Facts `GET /api/v2/product/{code}.json`, 8 s timeout. Found products are saved to the library.
3. Not found, or the network is blocked: a short form for the label's per-100 g numbers (kcal, protein, carbs, fat, optional serving). Saved to the library, so the next scan is instant.

Missing macros from Open Food Facts, or kcal derived from kJ or from macros, mark the row `est: true`.

## Food row it produces

```js
{ name: "Almarai Labneh (30 g)", slot: "Snack", kcal: 60, p: 2, c: 1.2, f: 5.1,
  eaten: true, est: false, barcode: "6281007031233", grams: 30 }
```

Same shape as the app's rows (`{id,name,slot,kcal,p,c,f,eaten,est}`, the app adds `id`) plus `barcode` and `grams`. Grams default to one serving when Open Food Facts lists one, otherwise 100 g.

## Plugging it into the app (Food tab)

```js
// once, after the app's CSS
document.head.append(Object.assign(document.createElement("style"), { textContent: BarcodeFood.CSS }));

// the app re-renders tabs with innerHTML, so mount into a host that survives renders (like #lbHost),
// or call destroy()/mount again after each Food render
BarcodeFood.mount(document.getElementById("bfHost"), {
  onAdd: item => addFood(item),          // addFood adds the id; item.eaten overrides its default
  slot: "Snack",
  library: {                              // sync remembered products across phone and computer
    get: code => S.docs.barcodes?.[code] || null,
    put: (code, product) => put("barcodes", code, product, { quiet: true }),
  },
});
```

New collection: `barcodes/{code}` = `{code, name, brand, quantity, per100:{kcal,p,c,f}, serving:{g,label}|null, missing:[], derived, source:"off"|"manual"}`. Without a `library` option it falls back to `localStorage` (`barcodeFood.library`).

**Network in the Artifact.** This account's Artifacts have no network capability to declare, so the claude.ai page may block the call to Open Food Facts. The card then goes straight to the "enter the label numbers" form and still works; the local copy (`app/index.html` opened in a browser) and any normal web host can reach Open Food Facts.

Open Food Facts data is open (ODbL). Their API asks for a descriptive User-Agent from server apps; browsers can't set one, which is fine for personal use at this volume.
