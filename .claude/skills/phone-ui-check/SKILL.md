---
name: phone-ui-check
description: Use after any visible UI change to verify the screen at phone widths (360–412 px), light and dark, with at most one screenshot for Aziz.
---

# Phone UI check

Every UI thread repeated this (layout, polish, food redesign, goal setup, colours, glance, Nippard,
Nov 1–7 2026). The app is Android-only; test phone-first.

## Steps
1. Build first: `node build/build.js`. The phone tests open the built `app/index.html` in Chromium.
2. Run the whole-app phone checks: `node --test tests/app-phone.test.js` (360×800 and 390×844,
   every tab, no page errors, no sideways scroll). Playwright and Chromium are preinstalled in the
   cloud container; do not run `playwright install`.
3. Screenshot (one at most, only for a visual change): `SHOT=/mnt/project-files/fitness-app/<topic>/<name>-360px.png node --test tests/app-phone.test.js`,
   or a short Playwright script at 360 and 412 px, light and dark, `deviceScaleFactor: 2`.
   Save under `/mnt/project-files/fitness-app/<topic>/` and attach it to the reply.
4. Check by eye: text not clipped, nothing wraps into four lines, the same icon style everywhere
   (line icons, not emoji), dark mode readable, reduced-motion respected, empty states present.
5. Overlays/sheets: `role="dialog"` with a close button (`data-a="closeSheet"`, `data-close` or
   `aria-label="Close"`) so the Android back button closes them, or register `AndroidShell.onBack(fn)`.
6. Keep Aziz's chosen defaults: bottom bar + More (side menu stays an option), soft cards, Ring food
   look, line icons. Do not re-open those choices.

## Completion check
- `tests/app-phone.test.js` green at both sizes.
- One screenshot saved and attached (or "no visual change" stated).
- New overlay closes with the back button.
