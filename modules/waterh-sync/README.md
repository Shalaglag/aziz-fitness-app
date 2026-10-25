# WaterH → Aziz Cut Tracker

## What WaterH allows
- No public API or web login data feed. The bottle talks to the WaterH app over Bluetooth only.
- The app **writes** water to Apple Health on iPhone (it does not read back), and to Google Fit / Health Connect on Android.
- It has a "reports" export in History, format undocumented (meant for sharing with a doctor).
- A Claude Artifact can't read Apple Health or Health Connect directly, so the phone has to hand the number over.

## The bridge
`waterh-import.js` (plain ES module, no network) parses whatever the phone hands over:
- a Shortcut line `WATERH 2026-10-25 2350 mL` (one line per day; the latest line for a day wins),
- a bare number (today, in ml; numbers under 20 are read as litres),
- a CSV from Health Connect exporters / Health Auto Export (wide `Date,Water (ml)` or long `time,type,value,unit`),
- Apple Health's full `export.xml` (all `HKQuantityTypeIdentifierDietaryWater` records), good for back-filling.

Exports: `parseWaterH(text, now?) → [{date, ml, source}]`, `applyWaterH(day, row, now?) → day`, `totalWater(day)`.

Data model: the day doc gets `waterh: {ml, at, source}`. `water` stays the manual counter for non-bottle drinks (Gatorade, shakes). Total = `water + waterh.ml`. Re-syncing a day replaces the WaterH figure, so it never double counts.

## iPhone: one-tap Shortcut ("Sync WaterH")
One-time:
1. WaterH app → Settings → Apple Health → turn on, allow it to write Water.
2. Health app → Browse → Nutrition → Water → set unit to mL (optional; the importer also reads L and fl oz).
3. Shortcuts app → + → add these actions:
   1. **Find Health Samples** where *Type* is *Water* and *Start Date* is *Today*.
   2. **Calculate Statistics**: *Sum* of *Health Samples*.
   3. **Format Date**: *Current Date*, custom format `yyyy-MM-dd`.
   4. **Text**: `WATERH [Formatted Date] [Statistics]` (tap to insert the two variables; Statistics brings its unit, e.g. `2350 mL`).
   5. **Copy to Clipboard**: *Text*.
   6. **Open URLs**: `https://claude.ai/artifact/EBaguVa4wy8ED9pyxJuT8T`
4. Name it "Sync WaterH", add to Home Screen (or Settings → Accessibility → Touch → Back Tap).

Daily: tap the Shortcut. The app opens; in the Water card's **Sync WaterH bottle** section, long-press the box → Paste → **Apply**. (Artifacts can't read the clipboard on their own, so the paste is one manual step.)

## Android
1. WaterH app → Settings → enable Google Fit / Health Connect.
2. Quick daily way: type the amount WaterH shows (e.g. `2.35 L` or `2350`) into the Sync WaterH bottle box → Apply.
3. Bulk/back-fill: a Health Connect exporter (e.g. "Health Data Export" on Play) → Hydration → CSV → pick the file with the file picker in the Sync WaterH bottle section.
