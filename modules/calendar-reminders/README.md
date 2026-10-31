# Phone calendar reminders

One downloadable `.ics` file built from the app's own schedule, so the phone's calendar (Google or Samsung on Android) rings even when the app is closed: morning weigh-in, training (Sun–Thu 3:30 pm, Saturday 10 am), water checks, the 14-day calorie review and the supplement schedule. Same idea as `tools/supplements/supplement-reminders.ics`, generated instead of hand-written and following whatever Aziz changes in the app.

## Files
- `calendar-reminders.js`: plain JS, no imports, no network. Browser global `CalendarReminders` or CommonJS.
- `calendar-reminders.test.js`: `node --test modules/calendar-reminders/calendar-reminders.test.js` (10 tests: event set, weekday alignment, settings fallbacks, ics validity and folding, escaping, stable ids, apply, html, readForm).

## API
- `DEFAULTS` and `settings(prefsMain)`: `prefs/main.reminders = {weigh, weighTime, train, trainTime, trainDays, satOn, satTime, water, waterTimes[], review, reviewTime, supps}`. Bad times fall back to the defaults.
- `events(settings, ctx)`: the reminder list. `ctx = {from: today, review: STRICT.to, supps: SuppDrinks.plan(prefs)}`. Weekly series start on the first listed weekday on or after `from`, so DTSTART is itself an occurrence. The review is one event with an alert the day before; it is left out once the date has passed.
- `ics(events, {tz, stamp, tag})`: RFC 5545 text, CRLF, lines folded at 75 octets, text escaped, `VTIMEZONE` for Asia/Kuwait (UTC+3, no DST), one `VALARM` per alarm offset. UIDs are `cr-<key>-<fromDate>@aziz-cut-tracker`, so re-importing a file downloaded the same day replaces the events instead of doubling them.
- `build(prefsMain, ctx)` → `{filename: cut-reminders-YYYY-MM-DD.ics, text, count}`.
- `css`, `html(prefsMain, ctx)` (the Guide card), `readForm(root)`, `apply(action, data, prefsMain, ctx)` → `{prefs?, toast?, download?}` for actions `save`, `download`, `water-add`, `water-less`.

## Wiring in the app shell
Guide tab, after "Your numbers":
```js
${safeMod("CalendarReminders",()=>CalendarReminders.html(S.docs.prefs.main||{}, crCtx()))}
```
```js
function crCtx(){ const p=S.docs.prefs.main||{}; return {from:TODAY, review:STRICT.to, supps: window.SuppDrinks?SuppDrinks.plan(p):[], now:new Date()}; }
const cr=e.target.closest("[data-cr]");
if(cr && window.CalendarReminders){ const r=CalendarReminders.apply(cr.dataset.cr, CalendarReminders.readForm(document), S.docs.prefs.main||{}, crCtx()); if(r.prefs) put("prefs","main",r.prefs); if(r.download) dioDownload(r.download.filename, r.download.text); if(r.toast) toast(r.toast); return; }
```
Add `"CalendarReminders"` to the list of modules whose `css` is injected. The download goes through the existing `downloads` capability (`dioDownload`).
