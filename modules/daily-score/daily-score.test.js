// Run: node modules/daily-score/daily-score.test.js
const assert = require("assert");
const DS = require("./daily-score.js");

const food = (kcal, p) => [{ name: "x", kcal, p, eaten: true }];
const fullDay = (o = {}) => Object.assign({ food: food(2000, 165), water: 3600, supps: { creatine: 1, omega: 1, d3: 1, mag: 1 }, treadmill: true }, o);
const lifted = { session: "Push A", sets: { "Bench Press (Barbell)": [{ w: 90, r: 8 }] } };
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok", name); };

// Oct 25, 2026 is a Sunday; Oct 30 is the Friday.
t("perfect training day scores 100 without sleep", () => {
  const s = DS.score({ days: { "2026-10-25": fullDay() }, workouts: { "2026-10-25": lifted } }, "2026-10-25");
  assert.strictEqual(s.score, 100); assert.ok(s.good); assert.ok(!s.sleepLogged);
  assert.ok(!s.parts.some(p => p.key === "sleep"));
});

t("empty day scores 0 and is not logged", () => {
  const s = DS.score({}, "2026-10-26");
  assert.strictEqual(s.score, 0); assert.ok(!s.logged); assert.ok(!s.good);
});

t("planned (uneaten) food does not count", () => {
  const s = DS.score({ days: { "2026-10-25": fullDay({ food: [{ kcal: 2000, p: 165, eaten: false }] }) }, workouts: { "2026-10-25": lifted } }, "2026-10-25");
  assert.strictEqual(s.parts.find(p => p.key === "protein").got, 0);
  assert.strictEqual(s.parts.find(p => p.key === "kcal").got, 0);
});

t("protein ramps from 120 to 160 g", () => {
  const s = DS.score({ days: { "2026-10-25": fullDay({ food: food(2000, 140) }) } }, "2026-10-25");
  assert.strictEqual(s.parts.find(p => p.key === "protein").got, 12.5);
});

t("calories lose credit outside 1,850–2,150 over 300 kcal", () => {
  const s = DS.score({ days: { "2026-10-25": fullDay({ food: food(2300, 165) }) } }, "2026-10-25");
  assert.strictEqual(s.parts.find(p => p.key === "kcal").got, 10);
});

t("Friday skips calories and gives training full marks", () => {
  const s = DS.score({ days: { "2026-10-30": { food: food(3200, 165), water: 3000, supps: { creatine: 1, omega: 1, d3: 1, mag: 1 } } } }, "2026-10-30");
  assert.ok(!s.parts.some(p => p.key === "kcal"));
  assert.strictEqual(s.parts.find(p => p.key === "training").got, 15);
  assert.strictEqual(s.score, 100);
});

t("rotation Rest day from opts.session uses 3 L water and full training marks", () => {
  const s = DS.score({ days: { "2026-10-28": fullDay({ water: 3000, treadmill: false }) } }, "2026-10-28", { session: "Rest" });
  assert.strictEqual(s.parts.find(p => p.key === "water").got, 15);
  assert.strictEqual(s.parts.find(p => p.key === "training").got, 15);
});

t("training day: treadmill only gives 5 of 15", () => {
  const s = DS.score({ days: { "2026-10-25": fullDay() } }, "2026-10-25");
  assert.strictEqual(s.parts.find(p => p.key === "training").got, 5);
});

t("WaterH bottle adds to manual water", () => {
  const s = DS.score({ days: { "2026-10-25": fullDay({ water: 1500, waterh: { ml: 2000 } }) } }, "2026-10-25");
  assert.strictEqual(s.parts.find(p => p.key === "water").got, 15);
});

t("sleep joins the score once logged", () => {
  const s = DS.score({ days: { "2026-10-25": fullDay({ sleep: 6 }) }, workouts: { "2026-10-25": lifted } }, "2026-10-25");
  assert.ok(s.sleepLogged); assert.strictEqual(s.parts.find(p => p.key === "sleep").got, 7.5);
  assert.strictEqual(s.score, Math.round(92.5 / 100 * 100));
});

t("streak counts good days, unfinished today does not break it", () => {
  const days = {}, workouts = {};
  ["2026-10-25", "2026-10-26", "2026-10-27"].forEach(d => { days[d] = fullDay(); workouts[d] = lifted; });
  const st = DS.streak({ days, workouts }, "2026-10-28");
  assert.strictEqual(st.current, 3); assert.strictEqual(st.best, 3); assert.ok(!st.todayGood);
  days["2026-10-28"] = fullDay(); workouts["2026-10-28"] = lifted;
  const st2 = DS.streak({ days, workouts }, "2026-10-28");
  assert.strictEqual(st2.current, 4); assert.ok(st2.todayGood);
});

t("a missed day breaks the streak, best is kept", () => {
  const days = {}, workouts = {};
  ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-29"].forEach(d => { days[d] = fullDay(); workouts[d] = lifted; });
  const st = DS.streak({ days, workouts }, "2026-10-29");
  assert.strictEqual(st.current, 1); assert.strictEqual(st.best, 3);
  assert.strictEqual(st.last7.length, 7);
});

t("sessionFor makes a rotation rest day count", () => {
  const days = { "2026-10-25": fullDay(), "2026-10-26": fullDay({ treadmill: false }) };
  const workouts = { "2026-10-25": lifted };
  const sessionFor = d => d === "2026-10-26" ? "Rest" : "Push A";
  assert.strictEqual(DS.streak({ days, workouts }, "2026-10-26", { sessionFor }).current, 2);
  assert.strictEqual(DS.streak({ days, workouts }, "2026-10-26").current, 1);
});

t("80+ with a skipped part is not a good day", () => {
  const s = DS.score({ days: { "2026-10-26": fullDay({ treadmill: false }) } }, "2026-10-26");
  assert.strictEqual(s.score, 82); assert.ok(!s.good);
});

t("html renders and escapes", () => {
  const h = DS.html({ days: { "2026-10-25": fullDay() }, workouts: { "2026-10-25": lifted } }, "2026-10-25", { today: "2026-10-25" });
  assert.ok(h.includes("Daily score") && h.includes(">100<") && h.includes("1 good day"));
  assert.ok(typeof DS.css === "string" && DS.css.includes(".ds-ring"));
});

t("targets option moves the protein and calorie bands", () => {
  const docs = { days: { "2026-10-26": fullDay() }, workouts: { "2026-10-26": lifted } };
  const base = DS.score(docs, "2026-10-26");
  const hi = DS.score(docs, "2026-10-26", { targets: { proteinMin: 200, kcalLo: 2650, kcalHi: 2950 } });
  assert.ok(hi.score < base.score);
  assert.ok(hi.parts.find(x => x.key === "protein").detail.includes("/ 200 g"));
  assert.ok(hi.parts.find(x => x.key === "kcal").detail.includes("2,650–2,950"));
  const fn = DS.score(docs, "2026-10-26", { targets: d => ({ proteinMin: 200, kcalLo: 2650, kcalHi: 2950 }) });
  assert.strictEqual(fn.score, hi.score);
  assert.strictEqual(DS.score(docs, "2026-10-26", { targets: {} }).score, base.score);
});

console.log(n + " tests passed");
