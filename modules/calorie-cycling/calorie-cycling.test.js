// Run: node --test modules/calorie-cycling/calorie-cycling.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { CalorieCycling: C } = require("./calorie-cycling.js");

const T = { kcal: 2000, carbsLo: 180, carbsHi: 220, proteinMin: 160, fatLo: 55, fatHi: 70 };
// Oct 2026: Sun 25, Mon 26 ... Fri 30, Sat 31.
const on = (extra = {}) => ({ on: true, delta: 150, ...extra });

test("defaults: off, +150, every day but Friday", () => {
  const d = C.defaults();
  assert.equal(d.on, false); assert.equal(d.delta, 150);
  assert.deepEqual(d.trainDays, [0, 1, 2, 3, 4, 6]);
});

test("normalize fixes bad input", () => {
  assert.deepEqual(C.normalize(null), C.defaults());
  assert.equal(C.normalize({ delta: 999 }).delta, 400);
  assert.equal(C.normalize({ delta: 10 }).delta, 50);
  assert.equal(C.normalize({ delta: 170 }).delta, 150);
  assert.deepEqual(C.normalize({ trainDays: [6, 6, 1, 9, -1, "2"] }).trainDays, [1, 2, 6]);
});

test("plan keeps the weekly total", () => {
  const p = C.plan(T, on());
  assert.equal(p.nTrain, 6); assert.equal(p.nRest, 1);
  assert.equal(p.trainKcal * p.nTrain + p.restKcal * p.nRest, 2000 * 7);
  // 6 lift days at +150 would need -900 on the one rest day: capped to -300 (delta 50).
  assert.equal(p.clamped, true); assert.equal(p.delta, 50); assert.equal(p.trainKcal, 2050); assert.equal(p.restKcal, 1700);
});

test("4 lift days / 3 rest days: +150 balances to -200", () => {
  const p = C.plan(T, on({ trainDays: [1, 2, 4, 6] }));
  assert.equal(p.clamped, false);
  assert.equal(p.trainKcal, 2150); assert.equal(p.restKcal, 1800);
  assert.equal(p.trainKcal * 4 + p.restKcal * 3, 14000);
  assert.deepEqual(p.trainCarbs, [218, 258]); // +150/4 = 37.5 g
  assert.deepEqual(p.restCarbs, [130, 170]);  // -200/4 = 50 g
});

test("odd split still sums exactly", () => {
  const p = C.plan(T, on({ delta: 100, trainDays: [0, 1, 2] }));
  assert.equal(p.trainKcal * 3 + p.restKcal * 4, 14000);
});

test("no rest days or no train days: nothing moves", () => {
  assert.equal(C.plan(T, on({ trainDays: [0, 1, 2, 3, 4, 5, 6] })).reason, "no-rest-days");
  assert.equal(C.plan(T, on({ trainDays: [] })).reason, "no-train-days");
  assert.equal(C.target(T, "2026-10-26", on({ trainDays: [] })).kcal, 2000);
});

test("no target: plan says so and html is empty", () => {
  assert.equal(C.plan({}, on()).reason, "no-target");
  assert.equal(C.html({ kcal: null }, on()), "");
});

test("target by weekday", () => {
  const st = on({ trainDays: [1, 2, 4, 6] });
  assert.deepEqual(C.target(T, "2026-10-26", st), { kcal: 2150, kind: "train", delta: 150, carbsLo: 218, carbsHi: 258 }); // Mon
  const fri = C.target(T, "2026-10-30", st);
  assert.equal(fri.kcal, 1800); assert.equal(fri.kind, "rest"); assert.equal(fri.delta, -200);
});

test("target is flat while off", () => {
  const t = C.target(T, "2026-10-26", { on: false, trainDays: [1] });
  assert.deepEqual(t, { kcal: 2000, kind: "flat", delta: 0, carbsLo: 180, carbsHi: 220 });
});

test("host's training(date) answer wins over the weekday pattern", () => {
  const st = on({ trainDays: [1, 2, 4, 6] });
  assert.equal(C.target(T, "2026-10-30", st, { training: () => true }).kind, "train");   // Friday but lifted
  assert.equal(C.target(T, "2026-10-26", st, { training: () => false }).kind, "rest");  // Monday skipped
  assert.equal(C.target(T, "2026-10-26", st, { training: () => null }).kind, "train");  // unknown: weekday
  assert.equal(C.target(T, "2026-10-26", st, { training: () => { throw new Error("x"); } }).kind, "train");
});

test("apply: on/off, stepper, day toggles", () => {
  let s = C.apply({}, "on"); assert.equal(s.on, true);
  s = C.apply(s, "more"); assert.equal(s.delta, 200);
  s = C.apply(s, "less"); s = C.apply(s, "less"); s = C.apply(s, "less"); s = C.apply(s, "less"); assert.equal(s.delta, 50);
  s = C.apply(s, "day:5"); assert.deepEqual(s.trainDays, [0, 1, 2, 3, 4, 5, 6]);
  s = C.apply(s, "day:5"); s = C.apply(s, "day:0"); assert.deepEqual(s.trainDays, [1, 2, 3, 4, 6]);
  s = C.apply(s, "off"); assert.equal(s.on, false);
  assert.deepEqual(C.apply(s, "nonsense"), s);
});

test("html shows the split, the toggle and the day chips", () => {
  const h = C.html(T, on({ trainDays: [1, 2, 4, 6] }));
  assert.match(h, /2,150/); assert.match(h, /1,800/); assert.match(h, /14,000/);
  assert.match(h, /data-cc-action="off"/); assert.match(h, /data-cc-action="day:5"/);
  assert.match(h, /aria-pressed="true"[^>]*day:1/);
  const off = C.html(T, { on: false });
  assert.match(off, /data-cc-action="on"/); assert.match(off, /Capped at \+50/);
});
