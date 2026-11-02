// Run: node modules/daily-dashboard/daily-dashboard.test.js
const assert = require("assert");
const DD = require("./daily-dashboard.js");

const ROT = ["Push A", "Pull A", "Lower A", "Rest", "Push B", "Pull B", "Lower B", "Rest"];
const base = { today: "2026-10-27", rotation: ROT, targets: { kcal: 2000, proteinMin: 160, proteinMax: 170 }, waterGoal: (d, training) => training ? 3500 : 3000 };
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok", name); };

// Oct 25, 2026 is a Sunday; Oct 30 is a Friday.
const docs = () => ({
  days: {
    "2026-10-27": { food: [
      { name: "Meal 1", slot: "Meal 1", kcal: 700, p: 55, eaten: true },
      { name: "Snack", slot: "Snack", kcal: 150, p: 3, eaten: true, est: true },
      { name: "Meal 2", slot: "Meal 2", kcal: 800, p: 60, eaten: false },
    ], water: 1500, waterh: { ml: 1000 }, sleep: 5.5, treadmill: true },
    "2026-10-26": { food: [{ name: "x", kcal: 2050, p: 165, eaten: true }], water: 3600 },
  },
  weights: { "2026-10-25": { date: "2026-10-25", kg: 91.9 }, "2026-10-26": { date: "2026-10-26", kg: 91.5 }, "2026-10-27": { date: "2026-10-27", kg: 91.2 } },
  workouts: {
    "2026-10-25": { date: "2026-10-25", session: "Push A", idx: 0, sets: { Bench: [{ w: 90, r: 8 }] }, effort: 7 },
    "2026-10-26": { date: "2026-10-26", session: "Pull A", idx: 1, sets: { Row: [{ w: 95, r: 8 }, { w: 95, r: 7 }] }, effort: 9 },
    "2026-10-27": { date: "2026-10-27", session: "Lower A", idx: 2, sets: { Squat: [{ w: 70, r: 8 }], Curl: [{ w: 63, r: 8 }] }, durationMin: 62 },
  },
});

t("calories and protein left count only eaten food", () => {
  const g = DD.glance(docs(), "2026-10-27", base);
  assert.strictEqual(g.kcal.eaten, 850); assert.strictEqual(g.kcal.left, 1150);
  assert.strictEqual(g.kcal.planned, 1650); assert.strictEqual(g.kcal.planLeft, 350);
  assert.strictEqual(g.protein.eaten, 58); assert.strictEqual(g.protein.left, 102); assert.strictEqual(g.protein.planLeft, 42);
  assert.strictEqual(g.meals.eaten, 2); assert.strictEqual(g.meals.total, 3); assert.strictEqual(g.meals.estimated, 1);
});

t("kcal target can be a function of the date", () => {
  const g = DD.glance(docs(), "2026-10-27", { ...base, kcalTarget: d => d === "2026-10-27" ? 1800 : 2000 });
  assert.strictEqual(g.kcal.left, 950);
});

t("workout done shows sets, exercises and duration", () => {
  const w = DD.glance(docs(), "2026-10-27", base).workout;
  assert.strictEqual(w.status, "done"); assert.strictEqual(w.sets, 2); assert.strictEqual(w.exercises, 2); assert.strictEqual(w.durationMin, 62); assert.ok(w.treadmill);
});

t("weigh-in delta and 7-day average", () => {
  const wi = DD.glance(docs(), "2026-10-27", base).weighin;
  assert.strictEqual(wi.kg, 91.2); assert.strictEqual(+wi.delta.toFixed(1), -0.3);
  assert.strictEqual(wi.avgN, 3); assert.strictEqual(+wi.avg7.toFixed(2), 91.53);
});

t("missing weigh-in is null, not guessed", () => {
  const d = docs(); delete d.weights["2026-10-27"];
  const wi = DD.glance(d, "2026-10-27", base).weighin;
  assert.strictEqual(wi.kg, null); assert.strictEqual(wi.prev.kg, 91.5);
  assert.ok(DD.glanceHtml(d, "2026-10-27", base).includes("Not logged"));
});

t("water adds manual and WaterH, goal depends on training", () => {
  const wa = DD.glance(docs(), "2026-10-27", base).water;
  assert.strictEqual(wa.ml, 2500); assert.strictEqual(wa.goal, 3500); assert.ok(!wa.hit);
  const fri = DD.glance(docs(), "2026-10-30", base).water; assert.strictEqual(fri.goal, 3000);
  const custom = DD.glance(docs(), "2026-10-27", { ...base, waterGoal: () => 2000 }).water; assert.ok(custom.hit);
});

t("recovery flags short sleep, recent max effort and lifting streak", () => {
  const r = DD.glance(docs(), "2026-10-27", base).recovery;
  assert.strictEqual(r.sleep, 5.5); assert.deepStrictEqual(r.effort, { date: "2026-10-26", n: 9 }); assert.strictEqual(r.streak, 3);
  assert.ok(r.flags.includes("Short sleep")); assert.ok(r.flags.includes("Last session near max"));
});

t("empty day: nothing invented", () => {
  const g = DD.glance({}, "2026-10-27", base);
  assert.strictEqual(g.workout.status, "unset"); assert.strictEqual(g.kcal.eaten, 0); assert.strictEqual(g.weighin.kg, null);
  assert.strictEqual(g.recovery.sleep, null); assert.ok(!g.recovery.logged);
  const html = DD.glanceHtml({}, "2026-10-27", base);
  assert.ok(html.includes("Pick")); assert.ok(html.includes("Nothing planned yet"));
});

t("rotation projects forward and skips Friday", () => {
  const w = docs().workouts;
  assert.deepStrictEqual(DD.projectSession(w, "2026-10-28", base), { session: "Rest", idx: 3, planned: true });
  assert.strictEqual(DD.projectSession(w, "2026-10-29", base).session, "Push B");
  assert.strictEqual(DD.projectSession(w, "2026-10-30", base), null); // Friday
  assert.strictEqual(DD.projectSession(w, "2026-10-31", base).session, "Pull B");
  assert.strictEqual(DD.projectSession(w, "2026-11-03", base).session, "Push A");
  assert.strictEqual(DD.projectSession({}, "2026-10-28", base), null);
});

t("sessionFor from the host wins for the selected day", () => {
  const g = DD.glance({}, "2026-10-28", { ...base, sessionFor: () => ({ session: "Pull B", idx: 5, chosen: false }), exerciseCount: () => 7 });
  assert.strictEqual(g.workout.session, "Pull B"); assert.strictEqual(g.workout.status, "planned"); assert.strictEqual(g.workout.planned, 7);
});

t("month grid starts on the right weekday and totals logged days", () => {
  const m = DD.month(docs(), "2026-10", base);
  assert.strictEqual(m.label, "October 2026"); assert.strictEqual(m.prev, "2026-09"); assert.strictEqual(m.next, "2026-11");
  assert.strictEqual(m.weeks[0].filter(x => x === null).length, 4); // Oct 1, 2026 is a Thursday
  assert.strictEqual(m.weeks.flat().filter(Boolean).length, 31);
  assert.strictEqual(m.totals.workouts, 3); assert.strictEqual(m.totals.weighins, 3);
  assert.strictEqual(m.totals.kcalLogged, 2); assert.strictEqual(m.totals.kcalOn, 1); // Oct 26 on, Oct 27 under so far
  const c = m.weeks.flat().filter(Boolean);
  const d26 = c.find(x => x.date === "2026-10-26");
  assert.ok(d26.lifted && d26.weighed && d26.protein && d26.water); assert.strictEqual(d26.kcal, "on");
  const d29 = c.find(x => x.date === "2026-10-29"); assert.ok(d29.planned && d29.future); assert.strictEqual(d29.session, "Push B");
  assert.ok(c.find(x => x.date === "2026-10-27").today);
});

t("chosen session without sets in the past reads as not logged", () => {
  const d = docs(); d.workouts["2026-10-20"] = { date: "2026-10-20", session: "Push B", idx: 4, sets: {} };
  const c = DD.month(d, "2026-10", base).weeks.flat().find(x => x && x.date === "2026-10-20");
  assert.ok(c.missed); assert.ok(!c.lifted);
});

t("bad month string falls back to today's month; HTML escapes names", () => {
  assert.strictEqual(DD.month({}, "nope", base).ym, "2026-10");
  const d = docs(); d.workouts["2026-10-27"].session = "<b>x</b>";
  const html = DD.glanceHtml(d, "2026-10-27", base) + DD.calendarHtml(d, "2026-10", base);
  assert.ok(!html.includes("<b>x</b>"));
  assert.ok(html.includes('data-act="caldate" data-d="2026-10-27"'));
  assert.ok(html.includes('data-act="calmonth" data-ym="2026-11"'));
});

t("no targets: nothing made up", () => {
  const o = { today: "2026-10-27", rotation: ROT };
  const g = DD.glance(docs(), "2026-10-27", o);
  assert.strictEqual(g.kcal.target, null); assert.strictEqual(g.kcal.left, null); assert.strictEqual(g.protein.left, null);
  assert.strictEqual(g.water.goal, null); assert.ok(!g.water.hit);
  const html = DD.glanceHtml(docs(), "2026-10-27", o);
  assert.ok(html.includes("no calorie target set")); assert.ok(html.includes("no protein target set")); assert.ok(!html.includes("2,000"));
  const c = DD.month(docs(), "2026-10", o).weeks.flat().find(x => x && x.date === "2026-10-26");
  assert.strictEqual(c.kcal, null); assert.strictEqual(c.protein, null); assert.strictEqual(c.water, null);
});

t("day calorie target (diet break) wins over targets.kcal", () => {
  assert.strictEqual(DD.glance(docs(), "2026-10-27", { ...base, kcalTarget: () => 2600 }).kcal.left, 1750);
});

t("full logger workouts are read first, warm-ups skipped", () => {
  const start = new Date(2026, 9, 28, 15, 30).getTime();
  const lb = [{ start, end: start + 55 * 6e4, templateName: "Push B", exercises: [
    { exId: "bench", sets: [{ w: 40, r: 10, t: "w" }, { w: 90, r: 8 }, { w: 90, r: 7 }] },
    { exId: "fly", sets: [{ w: 20, r: 12 }, { w: 20, r: 0, done: false }] }] }];
  const w = DD.glance({}, "2026-10-28", { ...base, lbWorkouts: lb }).workout;
  assert.strictEqual(w.status, "done"); assert.strictEqual(w.session, "Push B"); assert.strictEqual(w.sets, 3); assert.strictEqual(w.exercises, 2); assert.strictEqual(w.durationMin, 55);
  assert.ok(DD.month({}, "2026-10", { ...base, lbWorkouts: lb }).weeks.flat().find(x => x && x.date === "2026-10-28").lifted);
});

t("cardio details and readiness come through", () => {
  const d = docs(); d.cardio = { "2026-10-27": { durationMin: 30, speed: 4, incline: 3 } };
  const g = DD.glance(d, "2026-10-27", { ...base, readiness: () => ({ score: 42, verdict: "red" }) });
  assert.strictEqual(g.workout.cardioMin, 30); assert.deepStrictEqual(g.recovery.ready, { score: 42, verdict: "red" });
  assert.strictEqual(g.recovery.flags[0], "Readiness low");
  const html = DD.glanceHtml(d, "2026-10-27", { ...base, readiness: () => ({ score: 42, verdict: "red" }) });
  assert.ok(html.includes("42/100")); assert.ok(html.includes("cardio ✓ 30 min"));
});

t("scoreboard: calorie strip has one segment per slot, eaten solid and planned hatched", () => {
  const g = DD.glance(docs(), "2026-10-27", base);
  assert.deepStrictEqual(g.meals.slots.map(s => s.slot), ["Meal 1", "Snack", "Meal 2"]);
  assert.strictEqual(g.meals.slots[2].eatenKcal, 0); assert.strictEqual(g.meals.slots[2].kcal, 800);
  const html = DD.glanceHtml(docs(), "2026-10-27", base);
  assert.ok(html.includes('class="dd-kbar"')); assert.strictEqual((html.match(/<i class="pl"/g) || []).length, 1);
  assert.ok(html.includes("1,150")); assert.ok(html.includes("plan leaves 350"));
  assert.ok(html.includes('data-act="dd-day"')); assert.ok(html.includes('data-act="water" data-ml="250"'));
  assert.ok(!html.includes("dd-tile"));
});

t("your day: steps in order with the workout at its time and Now before the first open step", () => {
  const d = docs(); d.workouts["2026-10-27"].sets = {}; // not lifted yet
  const o = { ...base, trainTime: () => "15:30" };
  const y = DD.day(d, "2026-10-27", o);
  assert.deepStrictEqual(y.steps.map(s => s.key), ["weigh", "slot:Meal 1", "train", "slot:Snack", "slot:Meal 2"]);
  assert.strictEqual(y.steps[2].label, "3:30 pm");
  assert.deepStrictEqual(y.steps.map(s => s.state), ["done", "done", "todo", "done", "todo"]);
  assert.strictEqual(y.now.at, 2); assert.strictEqual(y.done, 3);
  const html = DD.dayHtml(d, "2026-10-27", o);
  assert.ok(html.indexOf(">Now<") < html.indexOf("3:30 pm")); assert.ok(html.includes("1,150"));
});

t("your day: past days show misses and a total, future days only plans", () => {
  const past = DD.day(docs(), "2026-10-26", base);
  assert.strictEqual(past.now, null); assert.ok(DD.dayHtml(docs(), "2026-10-26", base).includes(">Total<"));
  const fut = DD.day(docs(), "2026-10-29", base);
  assert.strictEqual(fut.steps.find(s => s.key === "weigh").state, "todo");
  assert.ok(DD.dayHtml(docs(), "2026-10-29", base).includes("Planned"));
  assert.strictEqual(DD.day({}, "2026-10-25", base).steps.find(s => s.key === "weigh").state, "miss");
});

console.log(n + " tests passed");
