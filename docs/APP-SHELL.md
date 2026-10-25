# Aziz Cut Tracker: the app shell

Live app: https://claude.ai/artifact/EBaguVa4wy8ED9pyxJuT8T (single-file HTML Artifact, vanilla JS, no framework).
Owner thread: "Build fitness plan app for phone and web".

## How it is built
- One HTML file. Tabs: Today, Train, Food, Progress, Guide. A shared date picker drives every tab.
- Data: the Artifact `db` capability, synced across Aziz's phone and computer. Falls back to localStorage when db is unavailable.
- Collections (all keyed by ISO date `YYYY-MM-DD` unless noted):
  - `days/{date}`: `{date, food:[{id,name,slot,kcal,p,c,f,eaten,est}], water (ml), supps:{creatine,omega,d3,mag}, treadmill}`
  - `weights/{date}`: `{date, kg}`
  - `workouts/{date}`: `{date, session:"Push A"|…|"Rest", idx:0–7 (rotation position), sets:{"<exercise name>":[{w,r}]}}`
  - `prefs/main`: `{dislikes:[string], open:{<key>:bool}}`

## CSS tokens already in use (map themes to these)
`--bg --surface --sunk --line --ink --muted --accent --accent-ink --protein --carbs --fat --good --warn --bad --display --body --mono --r`
Light on bare `:root`, dark under `prefers-color-scheme` and `[data-theme="dark"]`.

## Integrating a module from another thread
- Artifacts cannot read each other's databases, so a standalone artifact's data does not flow into the app automatically.
- The way in is code: plain-JS modules with no imports or network calls that I can inline (e.g. `meal-preferences.js`, `progression.js`, `friday-estimates.js`, JSON data files).
- To propose one, message this thread with the file path, its exported function(s), and the screen it belongs on.

## Source
Current published source: /mnt/project-files/fitness-app/app/aziz-cut-tracker.html (read-only copy; the app thread publishes it).

## Integrated so far
- v2 (Oct 25): Plate theme kit tokens + motion.css + motion.js (accent picker in Guide, synced via `prefs/main.accent`; light/dark follows the device/Claude app because the viewer owns `data-theme`). Meal picker engine (`NutreezePicker`) as a "Pick my meals" card on the Food tab, using `prefs/main.dislikes` as extraBans.
- v3 (Oct 25): WeeklyReport module at the top of the Progress tab (week nav + copy summary).
- v4: weekly report "Too early" fix re-inlined.
- v5: StrongCSV "Import from Strong" card on Train (+ "Other exercises logged" for unmatched names). WaterH sync in the Water card on Today (paste line or file; clipboard reading is blocked inside Artifacts). `days/{date}.waterh = {ml, at, source}`; total water = water + waterh.ml.
- v6: WorkoutLogger (Liftbook) as "Full logger" mode on Train, mounted once in #lbHost; db-backed lb_* collections; onFinish merges into workouts/{date} and days treadmill; downloads capability declared for its CSV/JSON export.
- v7: WorkoutLogger re-inlined with plan exercise names in shellRecord.
- v8: EffortDeload (effort picker under Train when the day has logged sets; lighter-week nudge at top of Train; `workouts/{date}.effort`, `.deload`; `prefs/main.deloadFrom/deloadUntil/deloadDismissedAt`; workouts saved inside the window get `deload:true`). SavedMeals via apply-patch.js (new synced `meals` collection, card under the add form on Food).
- v9: BudgetRecovery ("Went over?" card on Today for past days or after 6 pm; kcalTarget(date) = targetFor() drives macro bars and verdict), Steps card next to Water (`days/{date}.steps`, `prefs/main.stepGoal`), DailyScore under the Today hero, sleep hours input in the Today checklist (`days/{date}.sleep`), GoalDate (compact line under weigh-in, card on Progress after Weight trend), Ramadan card on Today when `Ramadan.dayOf(date) > 0` (`prefs/main.ramadanTrain`, `prefs/main.ramadanStart`).
- DietBreak: on hold pending Aziz's decision (it raises calories to maintenance on its own from Jan 3, 2027).
- v10: TrendTDEE card after the weekly report on Progress (its series also feeds GoalDate). FormCues + FORM_GUIDE with workout-logger.patch applied to the inlined logger (formCues mount option). PhotoFood card on Food via apply-to-app.py; capabilities now `{db, downloads, sample:{images:true}}`.
- Note for logger changes: the inlined logger = workout-logger/workout-logger.js + form-cues/workout-logger.patch. Ship logger updates with the patch already applied, or tell me.
- v11: ProteinGap note under the Food macro bars once both meals are in ("Add to this day" adds planned Extra items). BarcodeFood mounted into #bcHost after each Food render (new synced `barcodes` collection; Open Food Facts fetch is blocked by the Artifact CSP, so it falls back to the label form). Steps re-inlined (more export sources). ExerciseSwap in Quick log: Swap / Back to plan per exercise, hurt notice at top (`prefs/swaps`, `workouts/{date}.swapped`).
- v12: ProgressPhotos mounted once in #ppHost under the Progress tab (refresh on each Progress open); `photos/{date}` collection; `assets` capability added (photos stay in this private artifact).
