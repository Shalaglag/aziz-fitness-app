# Food log (planned vs eaten)

Live page: https://claude.ai/artifact/FLvBap9dWfQeQxDjJxtNm7 — source: `food-log.html` in this folder.

Data lives in the artifact's db, collection `days`, one document per date (`YYYY-MM-DD`):

```
{ date, dayType: "training"|"rest"|"saturday"|"friday", noAdonis: bool, updatedAt,
  items: [{ id, key?, name, slot: "breakfast"|"meal1"|"meal2"|"snack"|"fixed"|"extra",
            kcal:[lo,hi], p:[lo,hi], c:[lo,hi], f:[lo,hi], est: bool, note,
            status: "planned"|"eaten"|"skipped", at? }] }
```

Rules (plan sections 12–13): only `eaten` counts toward intake; `planned` is shown but not counted;
skipped items stay visible (never dropped silently); ranges are used when unsure.
`key` marks fixed items (adonis, gatorade, eggs) so day-type and "No Adonis today" toggles can find them.
Other threads (e.g. the meal picker) can write a day's picks here as `planned` items.
