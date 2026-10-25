# Ramadan mode

Plain-JS module (`ramadan.js`, no imports, no network) that turns a Ramadan date into Aziz's day plan: iftar and suhoor meal slots, training before or after iftar, a water window from sunset to dawn, and supplement timing. Prayer times are computed on the device for Kuwait City (Fajr 18°, Isha 17.5°, Imsak = Fajr − 10 min), so it works offline.

- **Dates:** Ramadan 1448 is expected **Mon 8 Feb → Tue 9 Mar 2027**, Eid on 10 Mar. Kuwait confirms by moon sighting; if it shifts, pass `cfg: { start: "2027-02-09" }` (or `days: 29`).
- **Food is unchanged:** 2,000 kcal, 160–170 g protein, 2 Nutreeze meals + 2 snacks + Adonis (+ Gatorade on training days). Ramadan only moves them.
- **Default schedule (train after iftar):** Iftar at Maghrib = dates + water + Meal 1 + Snack 1 → lift + treadmill 2 h later with Gatorade → Adonis + Snack 2 → Suhoor = Meal 2 finished by Imsak.
- **Train before iftar:** short fasted session 75 min before Maghrib, then Meal 1 + Adonis + Gatorade at iftar, Snack 1 in the evening, Meal 2 + Snack 2 at suhoor.
- **Water:** 3.5 L on training days (incl. the 1 L Gatorade), 3 L on rest days, split into checkpoints between Maghrib and Imsak (front-loaded after iftar, ~30% at suhoor).
- **Supplements:** creatine at iftar, D3 + omega-3 at suhoor, magnesium before sleep.

## API

```js
Ramadan.dayOf("2027-02-10")                 // 3 (0 outside Ramadan)
Ramadan.times("2027-02-10")                 // {imsak:"05:01", fajr:"05:11", ..., maghrib:"17:33", isha:"18:51"}
Ramadan.plan("2027-02-10", { dayType: "training", train: "after-iftar" })
  // {day, fastHours, suhoorBy, slots:[{time,id,label,items,appSlot,note}], water:{from,to,targetMl,checkpoints}, supps, notes}
Ramadan.html(date, opts)                    // Today-tab card, "" outside Ramadan
Ramadan.css                                 // inject once; uses the app's CSS tokens
```

`dayType` uses the app's `pickerDayType()` values (`training`, `rest`, `saturday`, `friday`). `appSlot` is the Food tab slot ("Meal 1", "Meal 2", "Snack") each item belongs in.

## Suggested app wiring

- Today tab: when `Ramadan.dayOf(date)` is non-zero, render `Ramadan.html(date, {dayType: pickerDayType(date), train: prefs.ramadanTrain})` above the usual schedule.
- Store the choice in `prefs/main.ramadanTrain` (`"after-iftar"` default, or `"before-iftar"`), with an optional `prefs/main.ramadanStart` override passed as `cfg.start`.
- Water card: show `plan.water.from`–`plan.water.to` as the drinking window.

Tests: `node --test modules/ramadan/ramadan.test.js`. Preview: open `preview.html`.
