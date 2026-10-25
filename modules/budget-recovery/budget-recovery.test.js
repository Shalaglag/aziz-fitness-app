// Run: node --test modules/budget-recovery/
const test = require("node:test");
const assert = require("node:assert/strict");
const { BudgetRecovery: B } = require("./budget-recovery.js");

// Oct 2026: Sun 25, Mon 26, Tue 27, Wed 28, Thu 29, Fri 30, Sat 31.
const day = (date, kcal, extra = {}) => ({ date, food: [{ id: "a", kcal, eaten: true }, { id: "b", kcal: 500, eaten: false }], ...extra });
const docs = (...list) => Object.fromEntries(list.map(d => [d.date, d]));

test("only eaten items count", () => {
  assert.equal(B.eatenKcal(day("2026-10-26", 1800)), 1800);
  assert.equal(B.eatenKcal(undefined), 0);
});

test("on target or a little over: nothing to do", () => {
  assert.equal(B.plan("2026-10-26", docs(day("2026-10-26", 1900))).reason, "under");
  assert.equal(B.plan("2026-10-26", docs(day("2026-10-26", 2090))).reason, "small");
  assert.equal(B.cardHtml(B.plan("2026-10-26", docs(day("2026-10-26", 2090)))), "");
});

test("Friday is a free day", () => {
  const p = B.plan("2026-10-30", docs(day("2026-10-30", 2900)));
  assert.equal(p.reason, "friday");
  assert.equal(B.apply(p, "spread").length, 0);
});

test("300 over: spread 100 a day over the next 3 days, spread recommended", () => {
  const p = B.plan("2026-10-26", docs(day("2026-10-26", 2300)));
  assert.equal(p.reason, "recover");
  assert.equal(p.recommended, "spread");
  assert.deepEqual(p.options.spread.days, [
    { date: "2026-10-27", cut: 100, target: 1900 },
    { date: "2026-10-28", cut: 100, target: 1900 },
    { date: "2026-10-29", cut: 100, target: 1900 },
  ]);
  assert.equal(p.options.spread.letGo, 0);
  // walk covers ~175, the remaining 125 is spread
  assert.equal(p.options.walk.covered, 130);
});

test("small surplus: walk recommended and covers it alone", () => {
  const p = B.plan("2026-10-26", docs(day("2026-10-26", 2180)));
  assert.equal(p.recommended, "walk");
  assert.equal(p.options.walk.days.length, 0);
});

test("Friday is skipped when spreading", () => {
  const p = B.plan("2026-10-29", docs(day("2026-10-29", 2300)));
  assert.deepEqual(p.options.spread.days.map(d => d.date), ["2026-10-31", "2026-11-01", "2026-11-02"]);
});

test("big day: capped at 150 a day (floor 1,850), the rest let go", () => {
  const p = B.plan("2026-10-26", docs(day("2026-10-26", 3200)));
  assert.ok(p.options.spread.days.every(d => d.target >= B.FLOOR && d.cut <= 150));
  assert.equal(p.options.spread.covered, 450);
  assert.equal(p.options.spread.letGo, 750);
  assert.match(B.cardHtml(p), /750 kcal is let go/);
});

test("stacked cuts never push a day below the floor", () => {
  const d = docs(day("2026-10-26", 2600));
  const w = B.apply(B.plan("2026-10-26", d), "spread", "t");
  w.forEach(({ date, patch }) => { d[date] = Object.assign(d[date] || { date, food: [] }, patch); });
  d["2026-10-27"].food = [{ kcal: 2600, eaten: true }];
  const p2 = B.plan("2026-10-27", d);
  assert.equal(p2.target, 1850);
  p2.options.spread.days.forEach(x => assert.ok(x.target >= 1850, `${x.date} ${x.target}`));
  assert.equal(B.targetFor("2026-10-28", d), 1850);
});

test("apply writes the choice and per-day budgetAdj", () => {
  const p = B.plan("2026-10-26", docs(day("2026-10-26", 2300)));
  const w = B.apply(p, "spread", "2026-10-26T20:00:00Z");
  assert.deepEqual(w[0], { date: "2026-10-26", patch: { recovery: { choice: "spread", surplus: 300, at: "2026-10-26T20:00:00Z" } } });
  assert.deepEqual(w[1], { date: "2026-10-27", patch: { budgetAdj: { "2026-10-26": -100 } } });
  assert.equal(B.apply(p, "skip", "t").length, 1);
});

test("a handled day does not ask again", () => {
  const p = B.plan("2026-10-26", docs(day("2026-10-26", 2600, { recovery: { choice: "walk" } })));
  assert.equal(p.reason, "handled");
  assert.equal(B.cardHtml(p), "");
});

test("target on a Friday is never cut", () => {
  const d = docs({ date: "2026-10-30", food: [], budgetAdj: { x: -150 } });
  assert.equal(B.targetFor("2026-10-30", d), 2000);
});

test("card has the three buttons", () => {
  const html = B.cardHtml(B.plan("2026-10-26", docs(day("2026-10-26", 2300))));
  ["walk", "spread", "skip"].forEach(k => assert.match(html, new RegExp(`data-recover="${k}" data-recover-date="2026-10-26"`)));
});

test("setTargets moves the target, floor and card text", () => {
  B.setTargets({ kcal: 2200, kcalLo: 2050, proteinMin: 170 });
  assert.equal(B.TARGET, 2200); assert.equal(B.FLOOR, 2050);
  assert.equal(B.targetFor("2026-10-26", {}), 2200);
  const p = B.plan("2026-10-26", { "2026-10-26": { food: [{ kcal: 2600, eaten: true }] } });
  assert.equal(p.surplus, 400);
  assert.ok(p.options.spread.days.every(d => d.target >= 2050));
  assert.ok(B.cardHtml(p).includes("Protein stays at 170 g+") && B.cardHtml(p).includes("below 2,050"));
  B.setTargets(null);
  assert.equal(B.TARGET, 2000); assert.equal(B.FLOOR, 1850);
});
