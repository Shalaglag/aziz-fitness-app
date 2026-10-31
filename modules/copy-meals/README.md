# Copy meals (copy food to another day)

MacroFactor-style copy/paste for the food log: copy one row, several, or a whole day's food to another date (optionally into one slot), or pull another day's food into the selected day.

- `copy-meals.js`: plain JS, no imports or network. Browser global `window.CopyMeals`, or CommonJS.
- `copy-meals.test.js`: `node --test modules/copy-meals/copy-meals.test.js`

## Data

No new collection. Reads and writes `days/{date}.food[]` only. A copy is a fresh row (new `id`, `eaten:false` unless "Mark as eaten", `est`/`drink` kept) appended to the target day. Rows already on the target with the same name and slot are skipped so a double tap does nothing.

## API

| Function | What it does |
|---|---|
| `select(day, ids)` | Rows of a day by id; `ids` null = the whole day. |
| `copyToDay(target, items, {uid, slot, eaten, allowDuplicates})` | Returns `{day, added, skipped}`. `slot` is `'keep'` (default) or a slot name. Never mutates input. |
| `copyDay(source, target, opts)` | `copyToDay(target, source.food, opts)`. |
| `removeIds(day, ids)` | The undo of a copy. |
| `summary(result, dateLabel)` | Toast text, e.g. "Copied 3 items to tomorrow (1 already there)". |
| `targets(date, {back})` | Quick dates: Tomorrow, In 2 days, Next <weekday> (plus Yesterday / Last <weekday> with `back`). |
| `recentWithFood(days, date, {n, before})` | Nearby dates that have food, newest first. |
| `addDays`, `fmt(date, today)`, `weekday`, `isDate` | Timezone-safe ISO date helpers. |
| `cardHTML(day, {today, days, open})` | The Food tab card, a collapsed `<details data-keep="cm">`. |
| `readForm(root)` | `{ids, date, slot, eaten, from}` from the card's controls. `setDate(root, date)` and `selectAll(root, on)` are the chip helpers. |

## In the app

The card sits under "Today's food" on the Food tab. Shell wiring (`build/shell.html`):

- Click `cm-copy` (`data-go="1"` also jumps to the target date): copies the ticked rows to the date in the picker, with an Undo toast that removes the copied rows again.
- Click `cm-pull` (`data-date` on the chips, otherwise the "from" date input): copies that day's food onto the selected day.
- Click `cm-date` sets the date picker; `cm-all` ticks or unticks every row.
