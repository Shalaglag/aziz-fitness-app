// node --test modules/reverse-diet/reverse-diet.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const RD = require("./reverse-diet.js");

const DAY = 864e5;
const add = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);

// Synthetic log: weigh-ins losing `perWeek` kg/week until `floorKg`, then drifting by `driftPerWeek`.
function docs(days, { perWeek = 0.7, kcal = 2000, from = "2026-10-25", startKg = 91.9, floorKg = 0, driftPerWeek = 0, floorFrom = null } = {}) {
  const d = { weights: {}, days: {} };
  let kg = startKg;
  for (let i = 0; i < days; i++) {
    const date = add(from, i);
    if (floorFrom && date >= floorFrom) kg += driftPerWeek / 7;
    else if (kg > floorKg) kg -= perWeek / 7;
    d.weights[date] = { date, kg: Math.round(kg * 10) / 10 };
    d.days[date] = { date, food: [{ name: "x", kcal, p: 160, eaten: true }] };
  }
  return d;
}
const profile = { goalKg: 80, cutKcal: 2000, maintenance: 2700, protein: 160, fat: 70 };
const O = (today, extra) => ({ today, profile, ...extra });

test("no goal or no weigh-ins: status off, target stays with the host", () => {
  assert.equal(RD.plan({}, {}, { today: "2026-10-25" }).status, "off");
  assert.equal(RD.plan({}, {}, O("2026-10-25")).status, "off");
  assert.equal(RD.target({}, {}, "2026-10-25", O("2026-10-25")).mode, "cut");
  assert.ok(RD.html({}, {}, { today: "2026-10-25" }).includes("goal weight"));
});

test("schedule: +100–150 a week, 2–10 weeks, lands exactly on maintenance", () => {
  const s = RD.schedule(2000, 2700);
  assert.equal(s.weeks, 5);
  assert.equal(s.kcal[s.kcal.length - 1], 2700);
  assert.ok(s.kcal.every((k, i) => i === 0 || k >= s.kcal[i - 1]));
  assert.equal(RD.schedule(2000, 2100).weeks, 2);
  assert.equal(RD.schedule(2000, 4000).weeks, 10);
  assert.equal(RD.schedule(2700, 2000).weeks, 0);
});

test("while cutting: preview of the reverse, kg to go, no target change", () => {
  const d = docs(30);
  const P = RD.plan(d, {}, O("2026-11-23"));
  assert.equal(P.status, "cutting");
  assert.ok(P.kgToGo > 5);
  assert.equal(P.preview.from, 2000);
  assert.equal(P.preview.to, 2700);
  assert.equal(P.preview.weeks, 5);
  assert.equal(RD.target(d, {}, "2026-11-23", O("2026-11-23")).mode, "cut");
  assert.ok(RD.html(d, {}, O("2026-11-23")).includes("to go"));
});

test("trend hits the goal: manual mode offers Start, auto mode starts on its own", () => {
  // 120 days at 0.7 kg/wk takes the trend to 80 by about day 120.
  const d = docs(130, { floorKg: 79.5 });
  const today = add("2026-10-25", 129);
  const man = RD.plan(d, { auto: false }, O(today));
  assert.equal(man.status, "ready");
  assert.ok(RD.html(d, { auto: false }, O(today)).includes("data-rd-action=\"start\""));
  assert.equal(RD.target(d, { auto: false }, today, O(today)).mode, "cut", "manual: nothing changes until Start");
  const aut = RD.plan(d, {}, O(today));
  assert.equal(aut.status, "reverse");
  assert.ok(aut.kcalToday >= 2000);
});

test("start locks the plan; week 0 eats the cut calories, week 1 steps up", () => {
  const d = docs(130, { floorKg: 79.5 });
  const t0 = add("2026-10-25", 129);
  const st = RD.apply({ auto: false }, "start", t0, d, O(t0));
  assert.equal(st.started, t0);
  assert.equal(st.fromKcal, 2000);
  assert.equal(st.toKcal, 2700);
  assert.equal(st.weeks, 5);
  const T0 = RD.target(d, st, t0, O(t0));
  assert.equal(T0.mode, "reverse");
  assert.equal(T0.kcal, 2000);
  assert.equal(T0.protein, 160);
  assert.equal(T0.fat, 70);
  assert.ok(T0.carbs > 0);
  // a week later with a steady trend: first step
  const d2 = docs(137, { floorKg: 79.5, floorFrom: t0 });
  const t1 = add(t0, 7);
  const T1 = RD.target(d2, st, t1, O(t1));
  assert.equal(T1.week, 1);
  assert.equal(T1.kcal, 2150);
});

test("drift check: trend above the band holds the step; far above steps back", () => {
  const d = docs(130, { floorKg: 79.5 });
  const t0 = add("2026-10-25", 129);
  const st = RD.apply({ auto: false }, "start", t0, d, O(t0));
  // +2 kg/week drift from the start: by week 1 the trend is > 1 % over the goal
  const up = docs(144, { floorKg: 79.5, floorFrom: t0, driftPerWeek: 2 });
  const t2 = add(t0, 14);
  const P = RD.plan(up, st, O(t2));
  assert.equal(P.scheduledWeek, 2);
  assert.ok(P.effWeek < 2, "at least one step held or reversed");
  assert.ok(P.checks.some(c => c.verdict !== "step"));
  assert.ok(P.kcalToday <= 2150);
  assert.ok(RD.html(up, st, O(t2)).includes("above the goal"));
});

test("after the last step the mode is maintain at the locked maintenance", () => {
  const d = docs(130, { floorKg: 79.5 });
  const t0 = add("2026-10-25", 129);
  const st = RD.apply({ auto: false }, "start", t0, d, O(t0));
  const later = docs(130 + 7 * 6, { floorKg: 79.5, floorFrom: t0 });
  const t6 = add(t0, 7 * 6);
  const T = RD.target(later, st, t6, O(t6));
  assert.equal(T.mode, "maintain");
  assert.equal(T.kcal, 2700);
  assert.ok(RD.html(later, st, O(t6)).includes("at maintenance"));
});

test("maintenance source: trend estimate beats profile beats the kg estimate", () => {
  const d = docs(30);
  assert.equal(RD.plan(d, {}, O("2026-11-23", { tdee: { kcal: 2610, lo: 2500, hi: 2700 } })).maintenance.kcal, 2600);
  assert.equal(RD.plan(d, {}, O("2026-11-23")).maintenance.source, "profile");
  const noM = RD.plan(d, {}, { today: "2026-11-23", profile: { goalKg: 80, cutKcal: 2000 } });
  assert.equal(noM.maintenance.source, "estimate");
  assert.equal(noM.maintenance.kcal, 2500);
});

test("cancel clears the reverse; faster/slower shift the week", () => {
  const d = docs(130, { floorKg: 79.5 });
  const t0 = add("2026-10-25", 129);
  let st = RD.apply({ auto: false }, "start", t0, d, O(t0));
  const fast = RD.apply(st, "faster", t0, d, O(t0));
  assert.equal(fast.started, add(t0, -7));
  const slow = RD.apply(fast, "slower", t0, d, O(t0));
  assert.equal(slow.started, t0);
  st = RD.apply(st, "cancel", t0, d, O(t0));
  assert.equal(st.started, undefined);
  assert.equal(RD.plan(d, st, O(t0)).status, "ready");
});

test("shares a trend series passed in by the host", () => {
  const d = docs(30);
  const series = RD.trendSeries(d, "2026-11-23");
  const P = RD.plan(d, {}, O("2026-11-23", { trend: series }));
  assert.equal(P.trendNow, series[series.length - 1].trend);
});
