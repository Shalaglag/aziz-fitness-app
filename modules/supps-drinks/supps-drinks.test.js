// Run: node --test modules/supps-drinks/supps-drinks.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./supps-drinks.js");

const NOW = new Date(2026, 9, 25, 15, 0); // 3 pm local on Oct 25
const day0 = () => ({ date: "2026-10-25", food: [{ id: "m1", name: "Meal 1", kcal: 600, p: 50, eaten: true }], water: 500, waterh: { ml: 1500 }, supps: {} });
let n = 0; const uid = () => "id" + (++n);

test("logging a drink counts kcal and fluid once", () => {
  const r = S.logDrink(day0(), "gatorade", {}, { uid, now: NOW });
  const t = S.drinkTotals(r.day);
  assert.equal(t.kcal, 240); assert.equal(t.c, 60); assert.equal(t.ml, 1000);
  assert.equal(S.totalFluid(r.day), 500 + 1500 + 1000);
  const row = r.day.food.find(f => f.drink);
  assert.equal(row.eaten, true); assert.equal(row.est, true); assert.equal(row.slot, "Drink");
});

test("planned drinks never count until confirmed", () => {
  const p = S.planDrink(day0(), "pocari", {}, { uid });
  let t = S.drinkTotals(p.day);
  assert.equal(t.kcal, 0); assert.equal(t.ml, 0); assert.equal(t.plannedKcal, 125); assert.equal(t.plannedCount, 1);
  assert.equal(S.totalFluid(p.day), 2000);
  const id = p.day.food.find(f => f.drink).id;
  const c = S.confirmDrink(p.day, id, NOW);
  t = S.drinkTotals(c); assert.equal(t.kcal, 125); assert.equal(t.ml, 500);
  const u = S.unconfirmDrink(c, id); assert.equal(S.drinkTotals(u).kcal, 0);
  assert.equal(S.removeDrink(u, id).food.some(f => f.drink), false);
});

test("logging when a planned one exists confirms it instead of adding a second", () => {
  const p = S.planDrink(day0(), "gatorade", {}, { uid }).day;
  const r = S.logDrink(p, "gatorade", {}, { uid, now: NOW });
  assert.ok(r.confirmed);
  assert.equal(r.day.food.filter(f => f.drink).length, 1);
  assert.equal(S.drinkTotals(r.day).kcal, 240);
});

test("whey has no made-up values: blocked until the label is saved", () => {
  assert.equal(S.logDrink(day0(), "whey", {}, { uid }).error, "needs-label");
  assert.equal(S.planDrink(day0(), "whey", {}, { uid }).error, "needs-label");
  const bad = S.saveDrinkLabel({}, "whey", { kcal: "", p: "24" });
  assert.equal(bad.error, "invalid");
  const prefs = S.saveDrinkLabel({ dislikes: ["x"] }, "whey", { kcal: "130", p: "25", c: "3", f: "1.5", ml: "300" });
  assert.deepEqual(prefs.dislikes, ["x"]);
  const r = S.logDrink(day0(), "whey", prefs, { uid, now: NOW });
  const t = S.drinkTotals(r.day);
  assert.equal(t.kcal, 130); assert.equal(t.p, 25); assert.equal(t.ml, 300);
  assert.equal(r.day.food.find(f => f.drink).est, false);
});

test("saving a label clears the estimate flag and overrides the default", () => {
  const prefs = S.saveDrinkLabel({}, "gatorade", { kcal: "210", p: "0", c: "56", ml: "1000" });
  const d = S.drinks(prefs).gatorade;
  assert.equal(d.kcal, 210); assert.equal(d.est, false);
  assert.equal(S.saveDrinkLabel({}, "gatorade", { kcal: "-5" }).error, "invalid");
});

test("custom drinks can be added", () => {
  const prefs = S.saveDrinkLabel({}, "latte", { name: "Iced latte", kcal: "150", p: "8", ml: "350" });
  const r = S.logDrink(day0(), "latte", prefs, { uid, now: NOW });
  assert.equal(S.drinkTotals(r.day).kcal, 150);
  assert.equal(S.saveDrinkLabel({}, "nameless", { kcal: "10", p: "0" }).error, "invalid");
});

test("supplements are only taken after a tap; past days say not logged", () => {
  const st = S.suppStatus(day0(), {}, { today: "2026-10-25", now: NOW });
  const by = Object.fromEntries(st.map(s => [s.key, s.state]));
  assert.deepEqual(by, { creatine: "due", d3: "later", omega: "later", mag: "later" });
  const past = S.suppStatus({ date: "2026-10-24", supps: {} }, {}, { today: "2026-10-25", now: NOW });
  assert.ok(past.every(s => s.state === "unlogged"));
  let d = S.takeSupp(day0(), "creatine", NOW);
  assert.equal(d.supps.creatine, true); assert.ok(d.suppLog.creatine.at);
  d = S.skipSupp(d, "mag", NOW);
  assert.equal(d.supps.mag, false);
  const st2 = Object.fromEntries(S.suppStatus(d, {}, { today: "2026-10-25", now: NOW }).map(s => [s.key, s.state]));
  assert.equal(st2.creatine, "taken"); assert.equal(st2.mag, "skipped");
  d = S.clearSupp(d, "creatine");
  assert.equal("creatine" in d.supps, false);
});

test("schedule edits: time validation, turning one off, custom supplement", () => {
  assert.equal(S.savePlan({}, "mag", { time: "25:00" }).error, "invalid");
  let p = S.savePlan({}, "mag", { time: "23:15", on: false });
  assert.equal(S.plan(p).find(s => s.key === "mag").time, "23:15");
  assert.equal(S.suppStatus(day0(), p, { today: "2026-10-25", now: NOW }).some(s => s.key === "mag"), false);
  p = S.savePlan(p, "zinc", { name: "Zinc", dose: "15 mg", time: "21:00" });
  assert.ok(S.plan(p).some(s => s.key === "zinc" && s.on === true));
  assert.equal(S.savePlan({}, "nameless", { time: "10:00" }).error, "invalid");
});

test("adherence counts taps only", () => {
  const days = {
    "2026-10-25": { supps: { creatine: true, d3: true } },
    "2026-10-24": { supps: { creatine: true }, suppLog: { d3: { skipped: true } } },
    "2026-10-23": {},
  };
  const a = Object.fromEntries(S.adherence(d => days[d], "2026-10-25", {}, 7).map(r => [r.key, r]));
  assert.equal(a.creatine.taken, 2); assert.equal(a.d3.taken, 1); assert.equal(a.d3.skipped, 1); assert.equal(a.mag.taken, 0);
});

test("migrateDay tags old Gatorade food rows without changing what counts", () => {
  const old = { date: "2026-10-25", food: [{ id: "g", name: "Gatorade 1 L", slot: "Fixed", kcal: 240, c: 60, eaten: false, est: true }, { id: "m", name: "Meal 2", kcal: 700 }] };
  const m = S.migrateDay(old);
  const g = m.food.find(f => f.id === "g");
  assert.deepEqual(g.drink, { key: "gatorade", ml: 1000 });
  assert.equal(g.eaten, false); assert.equal(g.slot, "Fixed");
  assert.equal(S.drinkTotals(m).kcal, 0);
  assert.deepEqual(S.migrateDay(m), m, "idempotent");
  assert.equal(old.food[0].drink, undefined, "input not mutated");
});

test("apply routes clicks and surfaces errors as toasts", () => {
  const r1 = S.apply("log", { key: "whey" }, day0(), {}, { uid, now: NOW });
  assert.equal(r1.day, undefined); assert.match(r1.toast, /label/);
  const r2 = S.apply("take", { key: "d3" }, day0(), {}, { now: NOW });
  assert.equal(r2.day.supps.d3, true);
  const r3 = S.apply("label-save", { key: "whey", kcal: "120", p: "24" }, day0(), {});
  assert.equal(S.drinks(r3.prefs).whey.kcal, 120);
});

test("html renders without crashing and never claims a supplement was taken", () => {
  const h = S.html(day0(), {}, { today: "2026-10-25", now: NOW, training: true });
  assert.match(h, /Drinks &amp; supplements/);
  assert.match(h, /0 of 4 taken/);
  assert.match(h, /Plan today's Gatorade/);
  assert.match(h, /add label/);
  assert.ok(S.summary(d => (d === "2026-10-25" ? day0() : {}), "2026-10-25", {}).includes("Creatine 0/7"));
});
