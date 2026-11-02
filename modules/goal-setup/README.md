# Goal setup: the questionnaire that sets calories, macros and a timeline

Plain JS, no imports, no network. Inline `goal-setup.js` (exposes `window.GoalSetup`). Generic: it ships no plan numbers, and the host decides when a result is applied.

## What it does
Five full-screen steps (About you → Activity → Goal → Pace or date → Your plan), each with an inline SVG illustration and slide/rise animations (off under `prefers-reduced-motion`). Opens first for a brand-new install, again from Settings → Your numbers → Goal setup, and is offered after a weigh-in that moved 1+ kg from the weight the plan was built on. Nothing changes until the person taps **Use these numbers**; the last step compares the new numbers with the current ones.

## Method (shown in the app under "How this is worked out")
| Piece | Rule | Source |
| --- | --- | --- |
| Resting energy | 10·kg + 6.25·cm − 5·age + 5 (men) / − 161 (women) | Mifflin-St Jeor 1990 |
| Maintenance | × 1.2 / 1.375 / 1.55 / 1.725 / 1.9 | standard activity factors |
| Fat-loss pace | Gentle 0.35 %, Regular 0.5 %, Aggressive 0.75 %, Extreme 1 % of body weight a week | Helms 2014 (0.5–1 %), Garthe 2011 (0.7 % kept strength better than 1.4 %) |
| Gain pace | Lean 0.25 %, Regular 0.4–0.5 % a week | Iraki 2019 |
| Energy per kg | 7,700 kcal | the app's shared figure |
| Safety floor | 1,500 (men) / 1,200 (women) kcal, and never more than a 30 % deficit; the pace slows to fit and says so | |
| Protein | cut 2.0, muscle 2.0, bulk 1.8, maintain 1.6 g/kg; above BMI 30 the weight at BMI 30 is used | Morton 2018 (1.6–2.2 g/kg) |
| Fat | 25 % of calories, at least 0.6 g/kg; carbs fill the rest (protein drops toward 1.6 g/kg if carbs would go under 50 g) | |
| Timeline | linear at the weekly rate from today's weight; 5 kg (10 kg when 20+ kg to go) milestones with dates | |
| Date mode | the rate the date needs; above 1 %/wk (loss) or 0.5 %/wk (gain) it warns and gives the earliest realistic date | |

For Aziz (91.9 kg, 172 cm, 29, Active) the floor works out at 2,012 kcal, so the maths reproduces his "never below 2,000" rule by itself.

## API
- `compute(answers, {today})` → `{ok, errors, bmr, tdee, kcal, floor, floored, deficit, protein, fat, carbs, proteinPerKg, ratePct, rateKgWk, weeks, endDate, milestones:[{kg,date,final}], warnings, notes, profile}`. `profile` is ready for `prefs/main.profile` (`start, startKg, goalKg, cutKcal, maintenance, protein, fat, kcalFloor`) so AppTargets carries it to every card. Never throws.
- `validate(answers)` → `{clean, errors:[{field,msg}]}`.
- `needsRerun(saved, kg)` → true when `kg` is 1+ kg from `saved.answers.kg`.
- `compactHtml(saved, {today, kg})` → one-line projection for gain/maintain goals (GoalDate keeps the cut).
- `open({answers, today, existing:{profile,targets}, firstRun, onBack, onApply(result, answers), onSkip, onClose})` → `{el, close, state}`. A `role="dialog"` with an `aria-label="Close"` button, so the Android back button closes it; pass `onBack: fn => AndroidShell.onBack(fn)` to step back first.
- `css`, `ACTIVITY`, `GOALS`, `PACES`, `SOURCES`.

`answers = {sex, age, heightCm, kg, activity, goal:'cut'|'maintain'|'bulk'|'muscle', mode:'pace'|'date', pace, targetKg?, endDate?}`.

## In the app
Saved as `prefs/main.goalSetup = {answers, result, at}` (or `{skipped:true, at}`); applying also writes `prefs/main.profile`. Shell glue: `openGoalSetup`, `maybeFirstRunSetup` (end of `render()`), `offerGoalSetup` (weigh-in and Your numbers save), `goalLine()`, and `KCAL_FLOOR` follows `profile.kcalFloor`.

## Tests
`node --test modules/goal-setup/goal-setup.test.js` (maths, floors, date mode, validation, rerun). The walk-through on a 360 px phone is in `tests/app-phone.test.js` ("goal setup").

## Optional lift-day calorie shift
`open({cycling:{available, on}})` adds a checkbox to the result step (off by default, or the current setting when re-running): "Shift calories to lift days". It is passed back as `answers.cycling` (boolean) on apply; the host turns `prefs/main.cycling.on` on or off (the CalorieCycling module keeps the weekly total and protein/fat unchanged, so exercise calories are never added on top).

## Optional body fat and waist
The About step has an optional block: body fat % with the method it was measured with (`BF_METHODS`: smart scale ±6 points, calipers ±4, DEXA/Bod Pod ±3, visual ±6) and waist in cm. `answers.bodyFatPct/bodyFatMethod/bodyFatAt` and `answers.waistCm/waistAt` are stored; `open()` stamps the date on apply whenever the value or method changed, so re-running with the same value keeps the original date. `compute()` then returns `body` `{pct, method, methodLabel, pm, at, leanKg, fatKg, bmrKatch, bmrMifflin, tdeeLo, tdeeHi, waistCm, waistAt, whtr}`, averages Mifflin with Katch-McArdle for maintenance (`tdeeSource: 'bodyfat'`), shows the error band as a range ("treat it as a range, not a reading"), and sets protein from lean mass (2.6 g/kg, inside 1.6–2.4 g/kg of body weight) for cut and muscle goals. Waist changes no number: the note gives the waist-to-height ratio with the 0.5 marker and says waist alone is not a body-fat measurement. Nothing predicts a future body-fat value. The host logs both into Health markers.
