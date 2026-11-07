# Photo or text food logger ("Log from a photo or description")

A Food tab card: Aziz snaps a photo and/or types (or speaks) what he ate, Claude names the components with a
gram guess each, every component is priced from the food library (`FoodLib`: catalog, USDA cache, personal foods,
recipes) × grams, only unmatched components keep Claude's own numbers ("AI estimate"), every number stays
editable, and only "Add" writes to `days/{date}.food` with `est: true`, `grams` and
`src:{kind:"photo"|"describe", portionEst, matched, grade}`.

Two ways to reach Claude (`bind` options):
- `readService(kind, {images, text, weightG, signal})` → `{text, costUsd}`: the Mizan service's `POST /v1/read`
  (kinds `plate` with a photo, `describe` without). This is the Android path; the prompt and the API key live on the
  server (`worker/src/core.js`), the photo is sent once and never stored, each call is counted against the shared
  spending cap and the daily scan allowance (`scan_limit`). `showCost()` true shows the measured cost per call.
- `getSample()`: the claude.ai page's `sample` capability (free). Used only when `readService` is absent.
Neither → the card hides and manual logging still works. Capped or offline → a plain sentence, manual logging unaffected.

Review card: weight field ("Known total weight"), Claude's one follow-up question with an answer box (re-estimate),
per-item grams (rescale from the record or from Claude's guess), source line ("Rice, white, cooked · typical values
(estimate) · 150 g" or "AI estimate"), "use AI numbers" / "use database numbers", drop, "+ Add a missed ingredient"
(a blank editable row). No accuracy percentages are shown; portion guesses are marked.

- `photo-food.js`: the module (`PhotoFood`), plain JS, no imports or network. API is in the header comment.
- `photo-food.test.js`: `node --test modules/photo-food/photo-food.test.js` (prompt, parsing/cleaning, library match + rescale, food items, slot guess).
- `apply-to-app.py`: inlines the module into the single-file app: `python3 apply-to-app.py app.html [out.html]`.
  It adds the script, puts the card under "Add a Nutreeze meal or extra" (above "Pick my meals"), and binds it at boot.

## Publishing
The app must declare `sample` with images, alongside what it already has:
`capabilities: {db: {}, downloads: true, sample: {images: true}}`.
Aziz gets one consent prompt the first time he presses Estimate. If `sample` is unavailable (not granted,
signed out, older app), the card hides itself and the manual form still works. Without image support,
the photo button hides and text descriptions still work.

## Behaviour
- Photos are downscaled to 1600 px JPEG before sending.
- Claude is told to copy Nutreeze label numbers exactly when readable (confidence "From label"), otherwise estimate,
  with Kuwait/Nutreeze context. Items whose kcal disagree with 4P+4C+9F by more than 25% get a "check the numbers" note.
- Slot defaults to Meal 1, then Meal 2, then Extra based on what the day already has; "Eaten" is ticked by default.
- Multiple items can be added separately (untick any to skip) or "As one entry".
- Tested end to end in Chromium on a phone-width viewport against the Oct 25 app with a mocked `sample`.
