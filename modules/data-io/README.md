# Your data: imports, backups and restore

One card for the Guide tab that backs up the whole app to a single file, restores it (or the older Liftbook / browser-save files), imports history from other apps, and exports spreadsheets. Plain JS, no imports, no network.

## Files
- `data-io.js`: the module (`window.DataIO`). Inline it as-is, after `StrongCSV`, `Steps` and `WaterH`.
- `data-io.test.js`: `TZ=Asia/Kuwait node --test modules/data-io/data-io.test.js` (18 tests: backup round-trip, merge/replace restore, migrations, every importer, CSV exports).
- `preview.html`: the card with sample data in memory and one-tap sample files. Open it next to `../strong-sync/`.

## What it does
- **Backup**: every collection in the snapshot goes into `fitness-backup-YYYY-MM-DD.json` (`{format:"aziz-fitness-backup", schema:1, exported, counts, collections}`), including the logger's `lb_*` collections and `cardio`. An in-progress workout (`lb_meta/active`) is left out. Photo images live in the artifact's asset store, so only the `photos` records are in the file. `prefs/main.lastBackup` is stamped; the card says how old the last backup is and nudges after 7 days (`DUE_DAYS`). The shell uses `backupStatus(prefs.main)` to show the same nudge on Today with a one-tap download.
- **Restore**, always previewed first:
  - *Add to what I have* (default): adds missing records and fills empty fields; food lists are joined by item id; nothing you have is overwritten.
  - *Replace everything*: the backup wins and records not in it are removed (only in collections the backup contains). A backup of the current data downloads first.
- **Migrations**: reads schema-1 backups, the shell's own browser save (`localStorage["aziz-cut"]`, schema 0) and Liftbook backups (`liftbook-backup-*.json` → `lb_*`). A newer-schema file is refused with "update the app first". Bad records (no valid date, impossible weight, food without calories) are dropped with a warning instead of failing the whole file. Add `MIGRATIONS[1]` when the shape changes.
- **Imports** (the type is detected from the file):

| Source | Goes to | Notes |
|---|---|---|
| Strong CSV | `workouts/{date}` | through `StrongCSV.toWorkouts`, manual sets kept |
| Hevy CSV | `workouts/{date}` | rewritten as a Strong CSV so name matching, session guess and kg/lb are the same; `source:"hevy"` |
| Any workout CSV (date, exercise, weight, reps, optional unit/set type) | `workouts/{date}` | `source:"csv"` |
| MyFitnessPal Nutrition Summary, Cronometer servings or daily totals, any food CSV | `days/{date}.food` | items `imp:<source>:<date>:<n>`; past days `eaten:true`, today and later `eaten:false` (planned); re-import replaces, never doubles; missing calories worked out from macros only when all three are there, marked `est:true` |
| Scale / weight CSV or JSON (Renpho, Samsung Health, Garmin, Health Connect, any `date,weight`) | `weights/{date}` | earliest reading per day (the morning weigh-in); lb/st converted; days you logged by hand keep your number |
| Measurements CSV (waist, chest, hips, neck, arms, thighs, calf, body fat; cm or in) | `lb_measures` (`{id:type-date, type, value, date:noon ms}`) | a weight column also goes to `weights` |
| Steps exports (all formats `steps.js` reads) | `days/{date}.steps` | via `Steps.parseSteps/applySteps` |
| Water exports and `WATERH` lines | `days/{date}.waterh` | via `WaterH.parseWaterH/applyWaterH` |
| Apple Health `export.xml`, Health Connect long CSV (`time,type,value`) | weights + steps + water together | |

Ambiguous dates like `03/04/2026` are read day/month (pass `dateOrder:"mdy"` to flip) and the preview says how many there were. Exercises not in the program are saved under their own names and listed.

- **CSV exports**: daily summary (eaten kcal/protein, planned kcal, water, steps, sleep, weight, workout, plus calorie and protein targets when passed), weigh-ins, food log, workouts.

## Wiring in the app shell
Add `"cardio"` (and any new collection) to `COLS` so it is in the snapshot. Host div on the Guide tab, mounted once like the logger:
```html
<div id="dioHost"></div>
```
```js
let dioInst=null;
function syncDataCard(){
  const host=document.getElementById("dioHost"); host.hidden = view.tab!=="guide";
  if(view.tab!=="guide" || S.mode==="loading" || !window.DataIO) return;
  if(dioInst){ dioInst.refresh(); return; }
  const lbCols=["lb_workouts","lb_templates","lb_exercises","lb_measures","lb_meta"];
  const lbCache={};                                   // the logger's collections aren't in S.docs
  const loadLb=async()=>{ if(!S.db) return; for(const c of lbCols){ const qs=await S.db.collection(c).get(); lbCache[c]=Object.fromEntries(qs.docs.map(d=>[d.id,d.data()])); } };
  loadLb();
  dioInst = DataIO.mount(host, {
    snapshot: () => Object.assign(clone(S.docs), clone(lbCache)),
    put: async (c,id,doc) => { if(COLS.includes(c)) await put(c,id,doc,{quiet:true}); else { (lbCache[c]=lbCache[c]||{})[id]=doc; if(S.db) await S.db.collection(c).doc(id).set(doc); } },
    remove: async (c,id) => { if(COLS.includes(c)) await remove(c,id); else { delete (lbCache[c]||{})[id]; if(S.db) await S.db.collection(c).doc(id).delete(); } },
    download: async (filename,data) => { const dl = await window.claude.use("downloads").catch(()=>null); if(dl) return dl.save({filename,data}); },
    program: PROGRAM, rotation: ROTATION, deps: { StrongCSV, Steps, WaterH },
    today: () => TODAY, kcalTarget: d => kcalTarget(d), proteinMin: targets.proteinMin,
    onDone: () => { render(); loadLb(); }   // the logger re-reads lb_* on its next mount/refresh
  });
}
```
Call `syncDataCard()` at the end of `render()`. Targets come from `AppTargets` (`targets.proteinMin`) and the shell's `kcalTarget(date)`; the module has no numbers of its own. The `downloads` capability is already declared (v6). If the logger is already mounted, tell it to reload after a restore that touched `lb_*`, or reload the page.

The existing "Import from Strong", steps and WaterH cards can stay; this card is the one place that handles every file.

## API
`makeBackup(snapshot, {now, appVersion})`, `backupFilename(now)`, `readBackup(textOrObj)`, `planRestore(backup, current, {mode})`, `detect(text, filename)`, `importText(text, opts)`, `applyPlan(plan, {put, remove})`, `toCsv(snapshot, what, {kcalTarget, proteinMin})`, `backupStatus(prefsMain, {now, dueDays})` → `{lastBackup, ageDays, due, label}`, `mount(host, opts)`. A plan is `{kind, label, mode, writes:[{col,id,doc}], deletes:[{col,id}], counts, lines, warnings, range}`; nothing is saved until `applyPlan`. `mount` re-plans against fresh data right before applying, so changes synced from the phone in between aren't lost.

## Connections
An Artifact can't reach Health Connect, Apple Health, Strong, Hevy, MyFitnessPal or Cronometer directly (no APIs from inside the app, and network is blocked). Every connection is a file the phone exports and you pick here; the card's "What can I import?" lists where each app hides its export.
