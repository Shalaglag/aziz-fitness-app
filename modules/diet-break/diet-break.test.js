// Run: node modules/diet-break/diet-break.test.js
const assert = require("assert");
const DB = require("./diet-break.js");

const DAY = 864e5;
const add = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);

// Synthetic log: weigh-ins losing `perWeek` kg/week, eating `kcal` every day.
function docs(days, { perWeek = 0.7, kcal = 2000, from = "2026-10-25", startKg = 91.9, stallFrom = null } = {}) {
  const d = { weights: {}, days: {} };
  let kg = startKg;
  for (let i = 0; i < days; i++) {
    const date = add(from, i);
    if (!stallFrom || date < stallFrom) kg -= perWeek / 7;
    d.weights[date] = { date, kg: Math.round((kg + (i % 3 === 0 ? 0.2 : -0.1)) * 10) / 10 };
    d.days[date] = { date, food: [{ name: "x", kcal, p: 160, eaten: true }] };
  }
  return d;
}

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

t("empty data: plan TDEE, first break after 10 weeks, 2 weeks long", () => {
  const p = DB.build({}, {}, { today: "2026-10-25" });
  assert.strictEqual(p.tdee.source, "plan");
  assert.strictEqual(p.breakKcal, 2800);
  assert.strictEqual(p.now.type, "cut");
  assert.strictEqual(p.weekInBlock, 1);
  assert.strictEqual(p.nextBreak.start, "2027-01-03");
  assert.strictEqual(p.nextBreak.end, "2027-01-16");
  assert.ok(p.goalDate > p.nextBreak.end, "goal comes after the first break");
});

t("target switches to maintenance on the planned break date and back after", () => {
  assert.strictEqual(DB.target({}, {}, "2027-01-02").mode, "cut");
  assert.strictEqual(DB.target({}, {}, "2027-01-02").kcal, 2000);
  const b = DB.target({}, {}, "2027-01-03");
  assert.strictEqual(b.mode, "break");
  assert.strictEqual(b.kcal, 2800);
  assert.strictEqual(b.protein, 160);
  assert.ok(b.carbs > 300);
  assert.strictEqual(DB.target({}, {}, "2027-01-17").mode, "cut");
});

t("blockWeeks and breakWeeks settings are honoured and clamped", () => {
  assert.strictEqual(DB.build({}, { blockWeeks: 8, breakWeeks: 1 }, { today: "2026-10-25" }).nextBreak.end, "2026-12-26");
  assert.strictEqual(DB.build({}, { blockWeeks: 20 }, { today: "2026-10-25" }).state.blockWeeks, 12);
  assert.strictEqual(DB.build({}, { blockWeeks: 3 }, { today: "2026-10-25" }).state.blockWeeks, 8);
});

t("passed TDEE (number or TrendTDEE shape) sets break calories", () => {
  assert.strictEqual(DB.build({}, {}, { today: "2026-11-10", tdee: 2712 }).breakKcal, 2700);
  const p = DB.build({}, {}, { today: "2026-11-10", tdee: { kcal: 2640, lo: 2540, hi: 2740 } });
  assert.strictEqual(p.breakKcal, 2650);
  assert.strictEqual(p.tdee.confidence, "high");
  assert.strictEqual(DB.build({}, {}, { today: "2026-11-10", tdee: null }).tdee.source, "plan");
});

t("uses global TrendTDEE when inlined", () => {
  global.TrendTDEE = { estimate: () => ({ ready: true, tdee: 2905, tdeeLo: 2500, tdeeHi: 3300 }) };
  const p = DB.build({}, {}, { today: "2026-11-10" });
  assert.strictEqual(p.breakKcal, 2900);
  assert.strictEqual(p.tdee.confidence, "low");
  global.TrendTDEE = { estimate: () => ({ ready: false, tdee: null }) };
  assert.strictEqual(DB.build({}, {}, { today: "2026-11-10" }).tdee.source, "plan");
  delete global.TrendTDEE;
});

t("fallback estimator recovers TDEE from intake and weight trend", () => {
  // 0.7 kg/week at 2,000 kcal => ~2,000 + 0.1 * 7,700 = 2,770
  const d = docs(35);
  const e = DB.estimateTdee(d, "2026-11-28");
  assert.strictEqual(e.source, "estimate");
  assert.ok(Math.abs(e.kcal - 2770) <= 150, "got " + e.kcal);
  assert.strictEqual(DB.estimateTdee(docs(10), "2026-11-03").source, "plan", "too little data");
});

t("projection uses observed trend once there are 3 weeks", () => {
  const p = DB.build(docs(28, { perWeek: 0.9 }), {}, { today: "2026-11-21" });
  assert.strictEqual(p.rateSource, "trend");
  assert.ok(Math.abs(p.rate - 0.9) < 0.15, "rate " + p.rate);
});

t("stall after week 8 while on target suggests an early break", () => {
  const d = docs(63, { stallFrom: "2026-12-10" });
  const p = DB.build(d, {}, { today: "2026-12-26" });
  assert.strictEqual(p.weekInBlock, 9);
  assert.ok(p.early, "expected early-break suggestion");
  assert.ok(DB.html(d, {}, { today: "2026-12-26" }).includes("Start break today"));
  // Same stall before week 8 is ignored.
  const q = DB.build(docs(40, { stallFrom: "2026-11-15" }), {}, { today: "2026-12-03" });
  assert.strictEqual(q.early, null);
});

t("apply: start early, end early, resize", () => {
  let s = DB.apply({}, "start", "2026-12-26");
  assert.deepStrictEqual(s.breaks, [{ start: "2026-12-26", end: "2027-01-08" }]);
  assert.strictEqual(DB.target({}, s, "2026-12-30").mode, "break");
  // With no weigh-ins the plan assumes the goal is close, so no 2nd break; a heavy weigh-in brings it back.
  assert.strictEqual(DB.build({}, s, { today: "2027-01-09" }).nextBreak, null);
  const p = DB.build({ weights: { "2027-01-08": { kg: 91.5 } } }, s, { today: "2027-01-09" });
  assert.strictEqual(p.now.type, "cut");
  assert.strictEqual(p.blockIdx, 2);
  assert.strictEqual(p.nextBreak.start, "2027-03-20", "next block counts from the end of the early break");

  s = DB.apply(s, "length:1", "2026-12-28");
  assert.strictEqual(s.breaks[0].end, "2027-01-01");
  s = DB.apply(s, "end", "2026-12-30");
  assert.strictEqual(s.breaks[0].end, "2026-12-29");
  assert.strictEqual(DB.target({}, s, "2026-12-30").mode, "cut");
});

t("apply: ending an automatic planned break records it", () => {
  const s = DB.apply({}, "end", "2027-01-08");
  assert.deepStrictEqual(s.breaks, [{ start: "2027-01-03", end: "2027-01-07" }]);
  assert.strictEqual(DB.target({}, s, "2027-01-08").mode, "cut");
  assert.strictEqual(DB.apply({}, "end", "2027-01-03").breaks.length, 0, "ending on day 1 drops it");
});

t("apply: block length buttons", () => {
  assert.strictEqual(DB.apply({}, "block:9", "2026-11-01").blockWeeks, 9);
  assert.strictEqual(DB.apply({}, "block:30", "2026-11-01").blockWeeks, 12);
});

t("html renders each phase without throwing", () => {
  const cut = DB.html({}, {}, { today: "2026-11-01" });
  assert.ok(cut.includes("Diet breaks") && cut.includes("Jan 3 – Jan 16"));
  const brk = DB.html({}, {}, { today: "2027-01-05" });
  assert.ok(brk.includes("Day 3 of 14") && brk.includes("End break today"));
  assert.ok(DB.css.includes(".db-track"));
});

t("goal reached flips to maintain", () => {
  const p = DB.build({ weights: { "2026-10-25": { kg: 79.8 } } }, {}, { today: "2026-10-26" });
  assert.ok(["cut", "maintain"].includes(p.now.type));
  assert.strictEqual(p.plannedBreaks.length, 0);
});

console.log(n + " tests passed");
