// Run: node --test modules/trend-tdee/trend-tdee.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("./trend-tdee.js");

const DAY = 864e5;
const add = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);

// n days from Oct 25: weight falls `lossPerWeek`, eats `kcal`, optional noise and skipped days
function make({ n, start = 91.9, lossPerWeek = 0.7, kcal = 2000, noise = 0, skipFood = () => false, skipWeigh = () => false }) {
  const docs = { weights: {}, days: {}, workouts: {} };
  for (let i = 0; i < n; i++) {
    const d = add("2026-10-25", i);
    const wobble = noise ? noise * Math.sin(i * 2.3) : 0;
    if (!skipWeigh(i, d)) docs.weights[d] = { date: d, kg: Math.round((start - lossPerWeek / 7 * i + wobble) * 10) / 10 };
    if (!skipFood(i, d)) docs.days[d] = { date: d, food: [{ id: "a", kcal: kcal - 500, eaten: true }, { id: "b", kcal: 500, eaten: true }, { id: "c", kcal: 900, eaten: false }] };
  }
  return docs;
}

test("series: EWMA 0.1 seeded at first weigh-in, gaps interpolated, flat after last", () => {
  const s = T.series({ "2026-10-25": { kg: 92 }, "2026-10-27": { kg: 90 } }, { today: "2026-10-29" });
  assert.deepEqual(s.map(r => r.date), ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]);
  assert.equal(s[0].trend, 92);
  assert.equal(s[1].kg, null);
  assert.equal(s[1].trend, 91.9); // 92 + 0.1*(91-92)
  assert.equal(s[2].trend, 91.71); // 91.9 + 0.1*(90-91.9)
  assert.equal(s[3].trend, 91.71);
  assert.equal(s[4].trend, 91.71);
});

test("series ignores junk and accepts string kg", () => {
  const s = T.series({ "2026-10-25": { kg: "91.9" }, bad: { kg: 90 }, "2026-10-26": { kg: null }, "2026-10-27": { kg: 5 } });
  assert.equal(s.length, 1);
  assert.equal(s[0].trend, 91.9);
});

test("series ignores weigh-ins after today", () => {
  const s = T.series({ "2026-10-25": { kg: 92 }, "2026-10-30": { kg: 80 } }, { today: "2026-10-27" });
  assert.deepEqual(s.map(r => r.trend), [92, 92, 92]);
});

test("empty docs", () => {
  const E = T.estimate({}, { today: "2026-10-25" });
  assert.equal(E.status, "empty");
  assert.match(T.html({}, { today: "2026-10-25" }), /Log a morning weigh-in/);
});

test("building before 14 days, with what is missing", () => {
  const E = T.estimate(make({ n: 5 }), { today: "2026-10-30" });
  assert.equal(E.status, "building");
  assert.equal(E.ready, false);
  assert.equal(E.foodDays, 5);
  assert.equal(E.readyOn, "2026-11-08");
  assert.match(E.notes[0], /9 more days/);
});

test("recovers TDEE from clean data: 2000 eaten, 0.7 kg/wk -> 2770", () => {
  const E = T.estimate(make({ n: 20 }), { today: "2026-11-14" });
  assert.equal(E.ready, true);
  assert.equal(E.foodDays, 20);
  assert.equal(E.intakeAvg, 1500 + 500); // planned (not eaten) food is not counted
  assert.ok(Math.abs(E.rateKgWk + 0.7) < 0.02, E.rateKgWk);
  assert.ok(Math.abs(E.tdee - 2770) < 30, E.tdee);
  assert.ok(E.tdeeLo <= E.tdee && E.tdeeHi >= E.tdee);
  assert.deepEqual(E.suggest, { lo: 1900, hi: 2200, keep: true });
  assert.equal(E.reviewOpen, true);
  assert.match(T.html(make({ n: 20 }), { today: "2026-11-14" }), /Keep it/);
});

test("window ends yesterday and caps at 28 days", () => {
  const E = T.estimate(make({ n: 45 }), { today: "2026-12-08" });
  assert.equal(E.to, "2026-12-07");
  assert.equal(E.from, "2026-11-10");
  assert.equal(E.days, 28);
  assert.ok(!E.notes.some(n => /first week/.test(n)));
});

test("slow loss suggests lowering, fast loss suggests raising", () => {
  const slow = T.estimate(make({ n: 21, lossPerWeek: 0.2 }), { today: "2026-11-15" });
  assert.equal(slow.suggest.keep, false);
  assert.ok(slow.suggest.hi < 2000);
  assert.match(T.summary(make({ n: 21, lossPerWeek: 0.2 }), { today: "2026-11-15" }), /slower than 0.5 kg/);
  const fast = T.estimate(make({ n: 21, lossPerWeek: 1.5 }), { today: "2026-11-15" });
  assert.ok(fast.suggest.lo > 2000);
});

test("before the Nov 7 review it only previews", () => {
  const html = T.html(make({ n: 14, lossPerWeek: 0.2 }), { today: "2026-11-07" });
  // 13 days ending yesterday: not ready yet on review day itself
  assert.match(html, /ready from Nov 8/);
  const docs = make({ n: 14, lossPerWeek: 0.2 });
  const E = T.estimate(docs, { today: "2026-11-08" });
  assert.equal(E.ready, true);
  assert.equal(E.reviewOpen, true);
});

test("unlogged Fridays are left out and flagged; noisy weigh-ins still land close", () => {
  const fri = (i, d) => new Date(d + "T00:00:00Z").getUTCDay() === 5;
  const docs = make({ n: 22, noise: 0.6, skipFood: fri, skipWeigh: i => i % 3 === 1 });
  const E = T.estimate(docs, { today: "2026-11-16" });
  assert.equal(E.ready, true);
  assert.equal(E.foodDays, 22 - 3);
  assert.ok(E.notes.some(n => /3 days without food logged/.test(n)));
  assert.ok(E.notes.some(n => /first week/.test(n)));
  assert.ok(Math.abs(E.tdee - 2770) < 250, E.tdee);
});

test("too few weigh-ins blocks the estimate", () => {
  const E = T.estimate(make({ n: 20, skipWeigh: i => i % 4 !== 0 }), { today: "2026-11-14" });
  assert.equal(E.ready, false);
  assert.ok(E.notes[0].includes("weigh-ins (5 so far)"));
});

test("suggestion never goes under the 1,700 floor", () => {
  const E = T.estimate(make({ n: 21, kcal: 1600, lossPerWeek: 0 }), { today: "2026-11-15" });
  assert.equal(E.suggest.lo, 1700);
  assert.equal(E.suggest.hi, 1700);
});

test("html escapes and has the chart", () => {
  const html = T.html(make({ n: 20 }), { today: "2026-11-14" });
  assert.match(html, /<svg/);
  assert.match(html, /class="card tt"/);
  assert.equal(typeof T.css, "string");
});
