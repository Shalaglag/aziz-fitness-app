# Daily score and streak

One score out of 100 for each day, plus a streak of good days. Plain JS, no imports or network, so the app can inline it.

- `daily-score.js`: the module (`DailyScore`).
- `daily-score.test.js`: tests, run with `node modules/daily-score/daily-score.test.js`.
- `preview.html`: sample card at phone width.

## How a day is scored

| Part | Points | Full marks |
|---|---|---|
| Protein | 25 | 160 g eaten (partial from 120 g) |
| Calories | 20 | 1,850–2,150 kcal eaten (partial up to 300 kcal outside). Skipped on Friday, the free day. |
| Water | 15 | 3.5 L on training days, 3 L otherwise (manual water plus WaterH bottle) |
| Training + treadmill | 15 | Sets logged (10) and treadmill done (5). Rest days and Fridays get full marks. |
| Supplements | 10 | Creatine, omega-3, D3, magnesium (2.5 each) |
| Sleep | 15 | 7 h or more (partial from 5 h). Only counted once `days/{date}.sleep` is logged. |

Only food ticked as eaten counts. When sleep is not logged, the score is scaled from the other parts.

A **good day** is 80 or more with no part at zero. The **streak** counts good days in a row from Oct 25, 2026. Today only joins once it reaches a good day, so an unfinished day never breaks the streak.

## Plugging into the app

```js
document.head.insertAdjacentHTML("beforeend", "<style>" + DailyScore.css + "</style>");
// On the Today tab, as a card:
DailyScore.html(S.docs, view.date, { today: todayISO(), sessionFor: d => sessionFor(d)?.session });
// Data only:
DailyScore.score(S.docs, date, { session })     // {score, good, parts:[{key,label,got,max,ok,detail}]}
DailyScore.streak(S.docs, today, { sessionFor }) // {current, best, todayGood, last7}
```

`sessionFor` lets a planned rotation Rest day count as rest even without a workout entry.

Optional sleep input: store hours slept the night before as `days/{date}.sleep` (a number, e.g. 7.5). A small "Sleep last night (h)" field on the Today checklist is enough.
