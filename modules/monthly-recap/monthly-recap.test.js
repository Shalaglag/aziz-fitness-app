// Run: node --test modules/monthly-recap/monthly-recap.test.js
const test = require("node:test");
const assert = require("node:assert");
const MR = require("./monthly-recap.js");
const DailyScore = require("../daily-score/daily-score.js");
const StrengthAnalytics = require("../strength-analytics/strength-analytics.js");

const food = (kcal, p) => [{ name: "x", kcal, p, eaten: true }];
const full = (date, p = 165) => ({ date, food: food(2000, p), water: 3600, supps: { creatine: 1, omega: 1, d3: 1, mag: 1 }, treadmill: true });
const lift = (date, w) => ({ date, session: "Push A", sets: { "Bench Press (Barbell)": [{ w, r: 8 }, { w, r: 8 }] } });

function sample() {
  const docs = { weights: {}, days: {}, workouts: {}, cardio: {} };
  docs.weights["2026-09-29"] = { date: "2026-09-29", kg: 101.2 };     // week before the month: used as the start
  docs.weights["2026-10-02"] = { date: "2026-10-02", kg: 100.4 };
  docs.weights["2026-10-24"] = { date: "2026-10-24", kg: 98.2 };
  docs.weights["2026-11-01"] = { date: "2026-11-01", kg: 97.9 };      // outside the month
  // 4 good days in a row (Oct 20–23), Oct 24 protein low
  ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"].forEach(d => { docs.days[d] = full(d); });
  docs.days["2026-10-24"] = full("2026-10-24", 110);
  docs.workouts["2026-10-20"] = lift("2026-10-20", 80);
  docs.workouts["2026-10-22"] = lift("2026-10-22", 85);               // PR
  docs.workouts["2026-10-24"] = lift("2026-10-24", 82);
  docs.workouts["2026-10-21"] = { date: "2026-10-21", session: "Rest" };
  docs.workouts["2026-10-23"] = { date: "2026-10-23", session: "Rest" };
  docs.cardio["2026-10-20"] = { date: "2026-10-20", sessions: [{ kind: "treadmill", min: 30, km: 2 }] };
  return docs;
}
const opts = { today: "2026-10-25", ym: "2026-10", score: DailyScore, strength: StrengthAnalytics };

test("weight change uses the last weigh-in before the month as the start", () => {
  const r = MR.compute(sample(), opts);
  assert.strictEqual(r.weight.start, 101.2);
  assert.strictEqual(r.weight.end, 98.2);
  assert.ok(Math.abs(r.weight.delta - -3.0) < 1e-9);
  assert.strictEqual(r.weight.n, 2);
});

test("workouts, sets, cardio and PRs are counted inside the month only", () => {
  const r = MR.compute(sample(), opts);
  assert.strictEqual(r.workouts.count, 3);
  assert.strictEqual(r.workouts.sets, 6);
  assert.strictEqual(r.cardio.sessions, 5, "1 logged session + 4 treadmill ticks on days without a cardio doc");
  assert.strictEqual(r.cardio.minutes, 30);
  assert.strictEqual(r.prCount, 1);
  assert.strictEqual(r.prs[0].date, "2026-10-22");
  assert.ok(r.prs[0].e1rm > r.prs[0].from);
});

test("best streak and protein hit rate come from DailyScore and the protein target", () => {
  const r = MR.compute(sample(), opts);
  assert.ok(r.score.available);
  assert.strictEqual(r.score.bestStreak, 4);
  assert.strictEqual(r.protein.logged, 5);
  assert.strictEqual(r.protein.hit, 4);
  assert.strictEqual(r.protein.pct, 80);
  assert.strictEqual(r.protein.target, 160);
  const r2 = MR.compute(sample(), Object.assign({}, opts, { targets: { proteinMin: 170 } }));
  assert.strictEqual(r2.protein.hit, 0);
});

test("an unfinished today does not break the streak; future days are ignored", () => {
  const docs = sample();
  docs.days["2026-10-25"] = { date: "2026-10-25", water: 500 };          // today, barely started
  docs.weights["2026-10-26"] = { date: "2026-10-26", kg: 50 };            // future junk
  const r = MR.compute(docs, { ...opts, today: "2026-10-25" });
  assert.strictEqual(r.weight.end, 98.2);
  assert.strictEqual(r.to, "2026-10-25");
  assert.ok(!r.complete);
  // streak run through Oct 23 was 4, Oct 24 breaks it (protein 110 g), today keeps run at 0 but best stays 4
  assert.strictEqual(r.score.bestStreak, 4);
});

test("PR fallback works without StrengthAnalytics and ignores the first-ever session", () => {
  const r = MR.compute(sample(), { today: "2026-10-25", ym: "2026-10", strength: null, score: null });
  assert.strictEqual(r.prCount, 1);
  assert.strictEqual(r.prs[0].name, "Bench Press (Barbell)");
  assert.ok(!r.score.available);
});

test("months lists months with data, newest last, never the future", () => {
  const ms = MR.months(sample(), { today: "2026-10-25", start: "2026-10-25" });
  assert.deepStrictEqual(ms, ["2026-10"]);
  const ms2 = MR.months(sample(), { today: "2026-11-03" });
  assert.deepStrictEqual(ms2, ["2026-09", "2026-10", "2026-11"]);
});

test("empty month renders a disabled card; html escapes and includes nav + actions", () => {
  const h = MR.html({}, { today: "2026-10-25" });
  assert.ok(h.includes("Nothing logged in October 2026"));
  assert.ok(h.includes('data-mr-save="2026-10" disabled'));
  const h2 = MR.html(sample(), { ...opts });
  assert.ok(h2.includes("−3.0"));
  assert.ok(h2.includes("data-mr-month"));
  assert.ok(h2.includes("Save as image"));
  assert.ok(h2.includes("Bench Press (Barbell)"));
});

test("summary and svg are plain strings with the key numbers", () => {
  const r = MR.compute(sample(), opts);
  const s = MR.summary(r);
  assert.ok(s.includes("101.2 → 98.2 kg (−3.0 kg)"));
  assert.ok(s.includes("Workouts: 3"));
  assert.ok(s.includes("PRs: 1"));
  assert.ok(s.includes("Protein hit: 4/5 days (80%)"));
  const svg = MR.svg(r, { name: "A<b>" });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("A&lt;b&gt;"));
  assert.ok(svg.includes("October 2026"));
  assert.ok(svg.includes("NEW RECORDS"));
});
