# Gap audit: Aziz's 12-feature spec vs. the app (v14, Oct 25 2026)

Checked against the live app source (`fitness-app/app/aziz-cut-tracker.html`, v14), the modules in `fitness-app/`, and open PRs #1–15 on Shalaglag/aziz-fitness-app.

Status key: **Done** = works today, **Partial** = some of it exists, **Missing** = nothing yet. "Thread" = which new thread owns the missing part.

| # | Feature | Status | What already works | What is missing | Thread |
|---|---|---|---|---|---|
| 1 | AI coach | Missing | `sample` capability is declared (used by photo food), so the app can already call Claude | Coach that reads days/weights/workouts, explains why, cites data, refuses to invent missing data | AI coach + 14-day review |
| 2 | Advanced workout tracker | Done (gaps) | Liftbook logger: templates, rotation, warm-up/drop/failure sets, supersets, auto rest timer, PRs, est. 1RM, swaps, form cues, double progression, Strong import | **RIR** (only RPE, and it is off by default); reusable program editor exists as templates | Smart gym mode (RIR) |
| 3 | Smart meal planner | Partial | NutreezePicker picks 2 meals + 2 snacks + Adonis around 2,000 kcal / 160 g; Menu Reader reads screenshots; banned/needsCheck flags | **PDF upload** (restaurant/meal-prep), generic menus beyond Nutreeze, a true optimiser over any menu | PDF meal optimiser |
| 4 | Weight-loss intelligence | Done (gaps) | Trend weight + adaptive TDEE, 7-day weekly report, goal date, diet breaks (manual only), never auto-lowers calories | Explicit 14/30-day averages and a **plateau flag** shown in one place; calorie adherence % over 14/30 days | AI coach + 14-day review |
| 5 | Muscle & strength analytics | Partial | Per-exercise charts, records, weekly sets per muscle, main-lift drop flag (inside the logger) | Muscle-group balance, frequency per muscle, "strength change during the cut" summary, analytics outside the logger | Strength analytics |
| 6 | Progress photos | Done (gaps) | Front/side/back, aligned before/after slider, timelapse, private `assets` storage; 13 measurements in the logger | Measurements live in the logger (`lb_measures`) and photos in `photos/{date}`; nothing shows them side by side | (polish, this thread flags it) |
| 7 | Recovery & fatigue | Partial | Sleep hours on Today, effort rating + deload nudge, "this hurt" swap flag | **Soreness, energy, joint discomfort, readiness score**, fatigue warning from performance trend | Recovery & fatigue |
| 8 | Hydration & supplements | Partial | Water + WaterH bottle sync; supplements checkboxes: creatine, omega-3, vitamin D, magnesium | **Whey, Pocari Sweat**, drink calories, supplement schedule/times; drinks must stay unconfirmed until ticked | Supplements & drinks |
| 9 | Smart gym mode | Partial | Live workout screen with Previous column, rest timer ±15 s, wake lock, form cues | **Big-button single-exercise screen**, quick ±2.5 kg / ±1 rep, previous-set comparison per set, distraction-free layout | Smart gym mode |
| 10 | Cardio | Partial | `treadmill` is a true/false per day; logger has a Treadmill exercise with km/min | **Speed, incline, duration, distance, heart rate**, cardio progression chart | Cardio tracking |
| 11 | Calendar & daily dashboard | Partial | Today tab (food, macros, water, steps, sleep, checklist, daily score); logger history calendar | One-screen dashboard with today's workout + meals + remaining kcal/protein + weigh-in + recovery; a calendar for the whole app (not just lifts) | Daily dashboard |
| 12 | Imports, backups, connections | Partial | Strong CSV, steps exports (Health Connect, Samsung, Garmin, Fitbit, Apple), WaterH, logger CSV/JSON backup | **Whole-app backup/restore** (days, weights, workouts, prefs, meals, photos index); nutrition import (MyFitnessPal/Cronometer CSV) | Imports & backups |

Spec rules that are already respected: planned vs eaten (`food[].eaten`, picker adds items as `eaten:false`), no automatic calorie cuts (diet break `auto:false`, budget recovery only suggests), estimates flagged (`est`, `needsCheck`), dark mode + accent themes, data synced via `db`.

## Cross-feature consistency problems (fix once, shared by everything)

1. **Targets are hard-coded in 7 places.** 2,000 kcal and 160 g protein are constants in NutreezePicker, ProteinGap, DailyScore, WeeklyReport, BudgetRecovery, Ramadan and the shell's `TARGET`; 80 kg is a constant in the logger (`GOAL_KG`). The Guide's "Your numbers" card (`prefs/main.profile`) only reaches DietBreak and GoalDate. Changing your numbers today would leave most cards on the old values. **Fix:** `modules/app-targets/app-targets.js` (this thread) resolves one targets object from the profile; each module takes it as an option. New threads should read targets from it, never hard-code.
2. **Dislikes live in three places with three matching rules.** `prefs/main.dislikes` (substring match), the Meal Preferences artifact (whole-word, with `except`), and NutreezePicker's built-in `NEVER` list. The PDF optimiser must use one list. **Fix:** treat `prefs/main.dislikes` + picker `NEVER` as the source, matched with `MealPrefs.classify` rules (whole word), and have the optimiser call one `isBanned(name)`.
3. **Two workout logs.** Quick log writes `workouts/{date}.sets`; the full logger writes `lb_workouts` and merges a summary into `workouts/{date}`. Analytics, coach and review must read `lb_workouts` when present (it has set types, RPE, units) and fall back to `workouts/{date}`.
4. **Units.** DB lifts are logged in lb in the logger, kg everywhere else. Any analytics must convert using `unit` on each set.
5. **Treadmill is a boolean.** The cardio thread should keep `days/{date}.treadmill` truthy for the daily score and weekly report, and store details in a new `cardio/{date}` collection rather than changing the boolean's type.
6. **Supplement keys.** DailyScore counts `days/{date}.supps` keys `creatine, omega, d3, mag`. Adding whey/Pocari should go into a separate `drinks` list (with kcal, counted only when confirmed) so the score's denominator doesn't silently change.
7. **Backups only cover the logger.** The logger's JSON backup has no `days`, `weights`, `prefs`, `meals`, `barcodes`, `photos`. A whole-app backup should include the logger's `lb_*` collections too, so there's one file.
8. **14-day window.** Strict tracking is Oct 25 → Nov 7 (`REVIEW = "2026-11-07"` is hard-coded in BudgetRecovery and the weekly report). The 14-day review should take its window from `prefs/main.profile.start` + 14 days, via app-targets.

## Polish items for existing features

- RPE column is off by default; the spec asks for RIR. Offer RIR (RIR = 10 − RPE) as the column label, stored as `rpe` so history stays valid.
- Body weight goal in the logger (`GOAL_KG = 80`) should come from the profile's `goalKg`.
- Measurements (logger) and photos (Progress) should link: show the waist value under each photo day.
- Barcode is limited by the Artifact network rules (Open Food Facts is blocked), so it falls back to the label form. That's expected, not a bug.
