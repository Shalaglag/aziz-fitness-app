// node --test modules/data-io/data-io.test.js   (TZ=Asia/Kuwait for the zoned-timestamp cases)
const test = require("node:test");
const assert = require("node:assert/strict");
const DataIO = require("./data-io.js");
const StrongCSV = require("../strong-sync/strong-csv.js");

const PROGRAM = {
  "Push A": [["Bench Press (Barbell)", 60, "8-10", 3, "kg"], ["Incline DB Press", 50, "8-10", 3, "lb"], ["Lateral Raise (Cable)", 10, "12-15", 3, "kg"]],
  "Pull A": [["Lat Pulldown, Wide", 55, "8-10", 3, "kg"], ["Seated Row (Cable)", 50, "8-10", 3, "kg"]],
};
const ROTATION = ["Push A", "Pull A", "Rest"];
// Minimal stand-ins with the same contract as steps.js / waterh-import.js
const Steps = {
  parseSteps: t => [...t.matchAll(/^STEPS (\d{4}-\d{2}-\d{2}) (\d+)/gm)].map(m => ({ date: m[1], steps: +m[2], source: "line" })),
  applySteps: (day, r) => Object.assign({}, day, { steps: { count: r.steps, source: r.source } }),
};
const WaterH = {
  parseWaterH: t => [...t.matchAll(/^WATERH (\d{4}-\d{2}-\d{2}) (\d+)/gm)].map(m => ({ date: m[1], ml: +m[2], source: "line" })),
  applyWaterH: (day, r) => Object.assign({}, day, { waterh: { ml: r.ml, source: r.source } }),
};
const deps = { StrongCSV, Steps, WaterH };

const snapshot = () => ({
  days: { "2026-10-24": { date: "2026-10-24", food: [{ id: "a", name: "Chicken bowl", slot: "Meal 1", kcal: 650, p: 55, c: 60, f: 18, eaten: true }], water: 1500, supps: { creatine: true }, treadmill: false } },
  weights: { "2026-10-24": { date: "2026-10-24", kg: 92.4 }, "2026-10-25": { date: "2026-10-25", kg: 92.1 } },
  workouts: { "2026-10-24": { date: "2026-10-24", session: "Push A", idx: 0, sets: { "Bench Press (Barbell)": [{ w: 60, r: 9 }] } } },
  prefs: { main: { dislikes: ["mushroom"], profile: { goalKg: 80 } } },
  meals: { m1: { id: "m1", name: "Usual lunch" } },
  lb_workouts: { w1: { id: "w1", name: "Push A", start: 1, exercises: [] } },
  lb_meta: { settings: { id: "settings", rest: 120 }, active: { id: "active", workout: { id: "x" } } },
  cardio: { "2026-10-24": { date: "2026-10-24", speed: 6, incline: 8, min: 30 } },
});

test("backup round-trips every collection, including logger and cardio, but not an in-progress workout", () => {
  const b = DataIO.makeBackup(snapshot(), { now: "2026-10-25T10:00:00Z" });
  assert.equal(b.format, "aziz-fitness-backup");
  assert.equal(b.schema, DataIO.SCHEMA);
  for (const c of ["days", "weights", "workouts", "prefs", "meals", "lb_workouts", "lb_meta", "cardio"]) assert.ok(b.collections[c], c);
  assert.equal(b.collections.lb_meta.active, undefined);
  const r = DataIO.readBackup(JSON.stringify(b));
  assert.equal(r.source, "app");
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.collections.weights, snapshot().weights);
  // restoring onto the same data changes nothing
  const plan = DataIO.planRestore(r, snapshot(), { mode: "merge" });
  assert.equal(plan.writes.length, 0);
  assert.equal(plan.deletes.length, 0);
});

test("merge restore adds missing records and fills gaps without overwriting", () => {
  const b = DataIO.readBackup(DataIO.makeBackup({
    weights: { "2026-10-20": { date: "2026-10-20", kg: 93 }, "2026-10-24": { date: "2026-10-24", kg: 99 } },
    days: { "2026-10-24": { date: "2026-10-24", food: [{ id: "a", name: "Chicken bowl", kcal: 650, p: 55, c: 60, f: 18, eaten: true }, { id: "b", name: "Adonis", kcal: 192, p: 22, c: 11, f: 6, eaten: true }], water: 900, sleep: 7 } },
  }));
  const plan = DataIO.planRestore(b, snapshot(), { mode: "merge" });
  const w = Object.fromEntries(plan.writes.map(x => [x.col + "/" + x.id, x.doc]));
  assert.equal(w["weights/2026-10-20"].kg, 93);
  assert.equal(w["weights/2026-10-24"], undefined, "your weigh-in is kept");
  const day = w["days/2026-10-24"];
  assert.deepEqual(day.food.map(f => f.id), ["a", "b"]);
  assert.equal(day.water, 1500, "existing water kept");
  assert.equal(day.sleep, 7, "missing sleep filled");
  assert.equal(plan.counts.weights.kept, 1);
});

test("replace restore removes records not in the backup, only in collections the backup has", () => {
  const b = DataIO.readBackup(DataIO.makeBackup({ weights: { "2026-10-20": { date: "2026-10-20", kg: 93 } } }));
  const plan = DataIO.planRestore(b, snapshot(), { mode: "replace" });
  assert.deepEqual(plan.deletes.map(d => d.id).sort(), ["2026-10-24", "2026-10-25"]);
  assert.ok(plan.deletes.every(d => d.col === "weights"));
});

test("reads the shell's browser save and Liftbook backups (migration), drops bad records with warnings", () => {
  const raw = { days: {}, weights: { "2026-10-01": { kg: "94.2" }, "bad-id": { kg: 90 }, "2026-10-02": { kg: 5 } }, workouts: {} };
  const r = DataIO.readBackup(JSON.stringify(raw));
  assert.equal(r.source, "browser-save");
  assert.equal(r.schema, 0);
  assert.deepEqual(Object.keys(r.collections.weights), ["2026-10-01"]);
  assert.equal(r.collections.weights["2026-10-01"].kg, 94.2);
  assert.equal(r.collections.weights["2026-10-01"].date, "2026-10-01");
  assert.match(r.warnings[0], /2 records/);

  const lb = { app: "liftbook", v: 1, exported: 1761400000000, data: { workouts: { w9: { id: "w9", name: "Pull A" } }, templates: {}, exercises: {}, measures: { "waist-1": { id: "waist-1", type: "waist", value: 96 } } }, settings: { rest: 90 } };
  const l = DataIO.readBackup(JSON.stringify(lb));
  assert.equal(l.source, "liftbook");
  assert.equal(l.collections.lb_workouts.w9.name, "Pull A");
  assert.equal(l.collections.lb_measures["waist-1"].value, 96);
  assert.equal(l.collections.lb_meta.settings.rest, 90);
});

test("refuses files from a newer app version and non-backups", () => {
  assert.throws(() => DataIO.readBackup(JSON.stringify({ format: "aziz-fitness-backup", schema: 99, collections: {} })), /newer version/);
  assert.throws(() => DataIO.readBackup("{nope"), /valid JSON/);
  assert.throws(() => DataIO.readBackup(JSON.stringify({ hello: 1 })), /isn't a backup/);
});

test("detects file types", () => {
  const d = (t, f) => DataIO.detect(t, f);
  assert.equal(d(JSON.stringify(DataIO.makeBackup({}))), "backup");
  assert.equal(d("Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps\n"), "strong");
  assert.equal(d('"title","start_time","end_time","exercise_title","set_index","set_type","weight_kg","reps"\n'), "hevy");
  assert.equal(d("Date,Meal,Calories,Fat (g),Carbohydrates (g),Protein (g),Sodium (mg)\n"), "nutrition");
  assert.equal(d("Day,Time,Group,Food Name,Amount,Energy (kcal),Protein (g)\n"), "nutrition");
  assert.equal(d("Date,Exercise,Weight,Reps\n"), "workouts-csv");
  assert.equal(d("Date,Waist (cm),Chest (cm)\n"), "measurements");
  assert.equal(d("Time of Measurement,Weight(kg),BMI,Body Fat(%)\n"), "measurements");
  assert.equal(d("Date,Weight (kg)\n2026-10-01,93\n"), "weights");
  assert.equal(d("time,type,value,unit\n"), "health");
  assert.equal(d('<?xml version="1.0"?><HealthData><Record type="HKQuantityTypeIdentifierBodyMass"/></HealthData>'), "health");
  assert.equal(d("STEPS 2026-10-25 8432"), "steps");
  assert.equal(d("WATERH 2026-10-25 2350 mL"), "water");
  assert.equal(d("hello world"), null);
});

test("parses dates from common export formats", () => {
  const p = s => DataIO.parseWhen(s);
  assert.deepEqual(p("2026-10-25 07:12:00"), { date: "2026-10-25", time: "07:12" });
  assert.equal(p("25 Oct 2026, 08:00").date, "2026-10-25");
  assert.equal(p("25 Oct 2026, 08:00").time, "08:00");
  assert.equal(p("Oct 5, 2026").date, "2026-10-05");
  assert.equal(p("25/10/2026").date, "2026-10-25");
  assert.equal(p("10/25/2026").date, "2026-10-25");
  assert.equal(p("03/04/2026").date, "2026-04-03");
  assert.equal(p("03/04/2026").ambiguous, true);
  assert.equal(DataIO.parseWhen("03/04/2026", { dateOrder: "mdy" }).date, "2026-03-04");
  assert.equal(p("2026/10/25").date, "2026-10-25");
  assert.equal(p("nonsense"), null);
});

test("weigh-ins: earliest reading per day, lb converted, your own entries kept", () => {
  const csv = "Date,Weight (lb),Time\n2026-10-20 21:00,206,\n2026-10-20 06:40,204,\n2026-10-21 06:50,203.4,\n2026-10-25 07:00,200,\nbad,200\n";
  const plan = DataIO.importText(csv, { current: snapshot(), today: "2026-10-25" });
  assert.equal(plan.kind, "weights");
  const w = Object.fromEntries(plan.writes.map(x => [x.id, x.doc.kg]));
  assert.equal(w["2026-10-20"], 92.5);          // 204 lb at 06:40, not the evening 206
  assert.equal(w["2026-10-21"], 92.3);
  assert.equal(w["2026-10-25"], undefined);     // 92.1 already logged by hand
  assert.equal(plan.counts.weights.kept, 1);
  assert.match(plan.warnings.join(" "), /1 row/);
  const over = DataIO.importText(csv, { current: snapshot(), today: "2026-10-25", overwrite: true });
  assert.ok(over.writes.some(x => x.id === "2026-10-25"));
});

test("weigh-ins from Samsung Health and Apple Health", () => {
  const samsung = "com.samsung.health.weight,6302012,3\nstart_time,weight,body_fat,time_offset\n2026-10-22 03:40:00.000,92.8,24,UTC+0300\n";
  const s = DataIO.importText(samsung, { current: {}, today: "2026-10-25" });
  assert.equal(s.writes[0].doc.kg, 92.8);
  const xml = '<HealthData><Record type="HKQuantityTypeIdentifierBodyMass" unit="lb" value="205" startDate="2026-10-23 06:30:00 +0300"/><Record type="HKQuantityTypeIdentifierStepCount" value="9000"/></HealthData>';
  const a = DataIO.importText(xml, { current: {}, today: "2026-10-25", deps });
  assert.equal(a.kind, "health");
  assert.equal(a.writes.find(x => x.col === "weights").doc.kg, 93);
});

test("Strong CSV becomes workouts, merging with what's logged", () => {
  const csv = "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps\n" +
    "2026-10-24 18:00:00,Push A,1h,Lateral Raise (Cable),W,5,15\n" +
    "2026-10-24 18:00:00,Push A,1h,Lateral Raise (Cable),1,10,14\n" +
    "2026-10-22 18:00:00,Pull A,1h,Lat Pulldown (Cable),1,55,10\n";
  const plan = DataIO.importText(csv, { current: snapshot(), today: "2026-10-25", program: PROGRAM, rotation: ROTATION, deps });
  assert.equal(plan.kind, "strong");
  const w = Object.fromEntries(plan.writes.map(x => [x.id, x.doc]));
  assert.deepEqual(w["2026-10-24"].sets["Lateral Raise (Cable)"], [{ w: 10, r: 14 }]);
  assert.deepEqual(w["2026-10-24"].sets["Bench Press (Barbell)"], [{ w: 60, r: 9 }], "manual sets kept");
  assert.equal(w["2026-10-22"].session, "Pull A");
  assert.equal(plan.counts.workouts.add, 1);
  assert.equal(plan.counts.workouts.update, 1);
});

test("Hevy CSV goes through the same matching, with lb lifts converted", () => {
  const csv = '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"\n' +
    '"Push A","23 Oct 2026, 18:00","23 Oct 2026, 19:05","","Bench Press (Barbell)","","",0,"warmup",40,10,,,\n' +
    '"Push A","23 Oct 2026, 18:00","23 Oct 2026, 19:05","","Bench Press (Barbell)","","",1,"normal",62.5,8,,,\n' +
    '"Push A","23 Oct 2026, 18:00","23 Oct 2026, 19:05","","Incline Dumbbell Press","","",2,"normal",22.68,10,,,\n';
  const plan = DataIO.importText(csv, { current: {}, today: "2026-10-25", program: PROGRAM, rotation: ROTATION, deps });
  assert.equal(plan.kind, "hevy");
  const doc = plan.writes[0].doc;
  assert.equal(doc.source, "hevy");
  assert.equal(doc.session, "Push A");
  assert.equal(doc.imported.durationMin, 65);
  assert.deepEqual(doc.sets["Bench Press (Barbell)"], [{ w: 62.5, r: 8 }]);
  assert.deepEqual(doc.sets["Incline DB Press"], [{ w: 50, r: 10 }]);   // 22.68 kg -> 50 lb, the program's unit
});

test("generic workout CSV with a unit column", () => {
  const csv = "Date,Exercise,Weight,Unit,Reps\n24/10/2026,Seated Row (Cable),110,lb,10\n";
  const plan = DataIO.importText(csv, { current: {}, today: "2026-10-25", program: PROGRAM, rotation: ROTATION, deps });
  assert.equal(plan.kind, "workouts-csv");
  assert.deepEqual(plan.writes[0].doc.sets["Seated Row (Cable)"], [{ w: 50, r: 10 }]);
});

test("MyFitnessPal: past days eaten, today planned, re-import replaces instead of doubling", () => {
  const csv = "Date,Meal,Time,Calories,Fat (g),Saturated Fat,Carbohydrates (g),Protein (g),Sodium (mg)\n" +
    "2026-10-23,Lunch,,700,20,5,60,60,900\n2026-10-23,Snacks,,192,6,2,11,22,100\n2026-10-25,Dinner,,650,18,4,55,58,800\n";
  const plan = DataIO.importText(csv, { current: snapshot(), today: "2026-10-25", filename: "Nutrition-Summary.csv" });
  assert.equal(plan.kind, "nutrition");
  const d23 = plan.writes.find(x => x.id === "2026-10-23").doc;
  assert.equal(d23.food.length, 2);
  assert.deepEqual(d23.food.map(f => [f.slot, f.kcal, f.p, f.f, f.eaten]), [["Meal 1", 700, 60, 20, true], ["Snack", 192, 22, 6, true]]);
  assert.equal(d23.food[0].name, "Lunch (MyFitnessPal total)");
  assert.equal(plan.writes.find(x => x.id === "2026-10-25").doc.food[0].eaten, false);
  assert.match(plan.warnings.join(" "), /planned/);
  // apply, then import again: same entries, no doubles
  const cur = snapshot(); plan.writes.forEach(w => { cur[w.col][w.id] = w.doc; });
  const again = DataIO.importText(csv, { current: cur, today: "2026-10-25", filename: "Nutrition-Summary.csv" });
  assert.equal(again.writes.length, 0);
});

test("Cronometer servings; missing calories worked out from macros and flagged", () => {
  const csv = 'Day,Time,Group,Food Name,Amount,Energy (kcal),Protein (g),Carbs (g),Fat (g)\n2026-10-22,12:30,Lunch,"Rice, white",200 g,260,5.4,57,0.6\n2026-10-22,,Snacks,Whey,1 scoop,,25,2,1\n2026-10-22,,Snacks,Mystery,1,,,,\n';
  const plan = DataIO.importText(csv, { current: {}, today: "2026-10-25" });
  const food = plan.writes[0].doc.food;
  assert.equal(food.length, 2);
  assert.equal(food[0].name, "Rice, white");
  assert.equal(food[1].kcal, 117); assert.equal(food[1].est, true);
  assert.match(plan.warnings.join(" "), /estimates/);
  assert.match(plan.warnings.join(" "), /1 row/);
});

test("measurements go to the logger's lb_measures, weights to weights, inches converted", () => {
  const csv = "Date,Waist (in),Chest (in),Body Fat %,Weight (kg)\n2026-10-20,38,42,24.5,93.1\n";
  const plan = DataIO.importText(csv, { current: {}, today: "2026-10-25" });
  const m = Object.fromEntries(plan.writes.filter(x => x.col === "lb_measures").map(x => [x.id, x.doc]));
  assert.equal(m["waist-2026-10-20"].value, 96.5);
  assert.equal(m["chest-2026-10-20"].value, 106.7);
  assert.equal(m["bodyfat-2026-10-20"].value, 24.5);
  assert.equal(new Date(m["waist-2026-10-20"].date).getHours(), 12);
  assert.equal(plan.writes.find(x => x.col === "weights").doc.kg, 93.1);
});

test("steps and water hand off to the Steps and WaterH modules", () => {
  const s = DataIO.importText("STEPS 2026-10-24 8432", { current: snapshot(), deps, today: "2026-10-25" });
  const day = s.writes[0].doc;
  assert.equal(day.steps.count, 8432);
  assert.equal(day.food.length, 1, "rest of the day untouched");
  const w = DataIO.importText("WATERH 2026-10-26 2350 mL", { current: snapshot(), deps, today: "2026-10-25" });
  assert.deepEqual(w.writes[0].doc, { date: "2026-10-26", food: [], water: 0, supps: {}, treadmill: false, waterh: { ml: 2350, source: "line" } });
  assert.throws(() => DataIO.importText("STEPS 2026-10-24 8432", { current: {}, deps: {}, today: "2026-10-25" }), /Steps isn't loaded/);
});

test("applyPlan writes then deletes", async () => {
  const log = [];
  const n = await DataIO.applyPlan({ writes: [{ col: "weights", id: "a", doc: {} }], deletes: [{ col: "weights", id: "b" }] },
    { put: async (c, i) => log.push("put " + i), remove: async (c, i) => log.push("rm " + i) });
  assert.equal(n, 2); assert.deepEqual(log, ["put a", "rm b"]);
});

test("CSV exports", () => {
  const s = snapshot();
  assert.equal(DataIO.toCsv(s, "weights"), "Date,Weight (kg)\n2026-10-24,92.4\n2026-10-25,92.1\n");
  assert.match(DataIO.toCsv(s, "food"), /2026-10-24,Meal 1,Chicken bowl,650,55,60,18,yes,no/);
  assert.match(DataIO.toCsv(s, "workouts"), /2026-10-24,Push A,Bench Press \(Barbell\),1,60,9/);
  const daily = DataIO.toCsv(s, "daily", { kcalTarget: () => 2000, proteinMin: 160 }).split("\n");
  assert.match(daily[0], /Calorie target,Protein target \(g\)$/);
  assert.equal(daily[1], "2026-10-24,650,55,650,1500,,,92.4,Push A,2000,160");
  // round-trip: an exported weigh-in CSV imports back as the same data
  const back = DataIO.importText(DataIO.toCsv(s, "weights"), { current: s, today: "2026-10-25" });
  assert.equal(back.writes.length, 0);
  assert.equal(back.counts.weights.same, 2);
});

test("backupStatus: age in days, due after 7 days or when there has never been a backup", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  assert.deepEqual(DataIO.backupStatus(undefined, { now }), { lastBackup: null, ageDays: null, due: true, label: "No backup yet" });
  assert.deepEqual(DataIO.backupStatus({ lastBackup: "2026-10-25T06:00:00Z" }, { now }), { lastBackup: "2026-10-25T06:00:00Z", ageDays: 0, due: false, label: "Backed up today" });
  assert.equal(DataIO.backupStatus({ lastBackup: "2026-10-24T06:00:00Z" }, { now }).label, "Last backup yesterday");
  const six = DataIO.backupStatus({ lastBackup: "2026-10-19T06:00:00Z" }, { now });
  assert.equal(six.ageDays, 6); assert.equal(six.due, false);
  const seven = DataIO.backupStatus({ lastBackup: "2026-10-18T06:00:00Z" }, { now });
  assert.equal(seven.due, true); assert.equal(seven.label, "Last backup 7 days ago");
  assert.equal(DataIO.backupStatus({ lastBackup: "garbage" }, { now }).due, true);
  assert.equal(DataIO.backupStatus({ lastBackup: "2026-10-18T06:00:00Z" }, { now, dueDays: 14 }).due, false);
});
