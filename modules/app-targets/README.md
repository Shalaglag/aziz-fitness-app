# AppTargets: one source for calories, macros, goal weight and the review window

Plain JS, no imports, no network. Inline `app-targets.js` (exposes `window.AppTargets`).

## Why
2,000 kcal / 160 g protein / 80 kg used to be hard-coded in NutreezePicker, ProteinGap, DailyScore, WeeklyReport, BudgetRecovery, Ramadan, the shell's `TARGET` and the logger's `GOAL_KG`. Editing "Your numbers" (`prefs/main.profile`) only reached DietBreak and GoalDate. With this module every card reads the same object.

## Use in the app
```js
const PLAN = { kcal: 2000, kcalLo: 1850, kcalHi: 2150, proteinMin: 160, proteinMax: 170,
               fatLo: 55, fatHi: 70, carbsLo: 180, carbsHi: 220, goalKg: 80, start: '2026-10-25' };
const targets = AppTargets.resolve(prefs.main.profile, PLAN);       // after prefs load / on "Your numbers" save
const today   = AppTargets.forKcal(targets, kcalTarget(date));      // diet-break / budget-recovery day target
```
Pass `targets` (or the relevant numbers) into each module's options instead of its constants. New modules (coach, 14-day review, PDF optimiser, dashboard) must read targets from here.

## API
- `resolve(profile, defaults)` → `{kcal, kcalLo, kcalHi, proteinMin, proteinMax, fatLo, fatHi, carbsLo, carbsHi, goalKg, maintenance, start, reviewDays, reviewDate, source}`. `source.<field>` is `profile`, `default`, `derived` or `none`, so a card can say where a number came from. Missing everywhere → `null`, never a made-up number.
- `forKcal(targets, kcal)` → copy with a different day calorie target; ±150 band, carbs re-derived, protein unchanged.
- `lastDays(today, n)` → `{from, to}` inclusive.
- `reviewWindow(targets, today)` → `{from, to, day, days, done, notStarted}` for the strict-tracking review (start + 14 days, Oct 25 → Nov 7 by default).
- `validate(profile)` → `{clean, errors:[{field,msg}]}` for the "Your numbers" form.

Rules: profile protein = minimum, max = +10 g; profile fat = midpoint of ±7.5 g; carbs keep the plan range unless a profile number changed, then fill the remaining calories (±20 g).

## Tests
`node modules/app-targets/app-targets.test.js`
