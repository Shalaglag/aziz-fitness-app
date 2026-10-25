# Nutreeze daily menu data format

Written by the "Read Nutreeze menu screenshots" thread. The **Nutreeze Menu Reader** page reads Aziz's daily menu screenshots and saves one record per menu date. The meal picker and the app should read this record instead of re-reading screenshots.

## Where it lives

- Page: https://claude.ai/artifact/FyGb1AVp2D9HT39mpUyJV4 (private to Aziz).
- Stored in the Menu Reader artifact's shared database (read it with ArtifactData on that URL), collection `menus`, one document per date: `menus/2026-10-27`.
- Every saved menu can also be exported from the page as `nutreeze-menu-YYYY-MM-DD.json` with the same shape.

## Getting a menu into the meal picker

A page can't read another artifact's database, so the hand-off is the export: on the Menu Reader press **Copy JSON** (or Download JSON) and paste it into the menu box of the meal picker (https://claude.ai/artifact/XCZwySGP2UYQpZ6wGjFsFa). The picker uses `section: "meal"` items, skips `banned`, rejects null numbers and warns on `needsCheck`. Claude sessions can still read saved menus directly with ArtifactData.

## Shape

```json
{
  "date": "2026-10-27",
  "updatedAt": "2026-10-25T13:05:00.000Z",
  "screenshotsRead": 3,
  "notes": "Grapes row partly cut off",
  "items": [
    {
      "name": "Buffalo Chicken with Sweet Potato",
      "section": "meal",
      "kcal": 496, "protein": 65, "carbs": 41, "fat": 8,
      "banned": false, "bannedReason": null,
      "liked": true,
      "needsCheck": false
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `section` | `meal`, `snack`, `salad`, `soup`, `drink` or `other`, as shown on the Nutreeze tab |
| `kcal`, `protein`, `carbs`, `fat` | Numbers exactly as printed on the screenshot. `null` when unreadable; never estimated |
| `banned` | `true` when the item is on Aziz's never-pick list (plan section 6). The picker must skip these |
| `bannedReason` | Which rule matched, e.g. `"fish or seafood"` or `"Never pick: Chicken Shawarma"` |
| `liked` | Matches the likes list; `French Tacos Chicken` is the favourite |
| `needsCheck` | A number is missing, or kcal is more than 15% off 4·P + 4·C + 9·F. Aziz has to confirm it |

Aziz can edit any value and toggle `banned` on the page before saving, so the saved record is the one he checked.

## Rules the picker should keep

- Adonis (192 / 22 / 11.4 / 6.2) and Gatorade 1 L (~240 / 0 / ~60 / 0) are fixed items and are not part of this record.
- The fixed snack menu (plan section 7) still applies when no snack items were read for a date.
- Skip any item with `banned: true`, and warn when picking an item with `needsCheck: true`.
