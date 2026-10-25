# Photo or text food logger ("Log from a photo or description")

A Food tab card: Aziz snaps a photo and/or types what he ate, Claude estimates kcal/P/C/F through the
Artifact `sample` capability, every number stays editable, and only "Add" writes to `days/{date}.food`
with `est: true` (so the item shows "· estimate" and the weekly report flags the day).

- `photo-food.js`: the module (`PhotoFood`), plain JS, no imports or network. API is in the header comment.
- `photo-food.test.js`: `node --test modules/photo-food/photo-food.test.js` (prompt, parsing/cleaning, food items, slot guess).
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
