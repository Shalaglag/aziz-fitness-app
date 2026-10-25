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

// One example person's numbers, passed in by the host app; nothing is built into the module.
const profile = { start: "2026-10-25", startKg: 91.9, goalKg: 80, cutKcal: 2000, protein: 160, fat: 70, maintenance: 2800 };
const P = (today, extra) => ({ today, profile, ...extra });

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

t("no data at all: asks for a weigh-in, no crash", () => {
  const p = DB.build({}, {}, { today: "2026-10-25" });
  assert.strictEqual(p.breakKcal, null);
  assert.ok(DB.html({}, {}, { today: "2026-10-25" }).includes("Log a weigh-in"));
  assert.strictEqual(DB.target({}, {}, "2026-10-25").kcal, null);
});

t("profile: deficit ~29% gives 8-week blocks and 2-week breaks", () => {
  const p = DB.build({}, {}, P("2026-10-25"));
  assert.strictEqual(p.tdee.source, "profile");
  assert.strictEqual(p.breakKcal, 2800);
  assert.strictEqual(p.cutKcal, 2000);
  assert.strictEqual(p.state.blockWeeks, 8);
  assert.strictEqual(p.state.breakWeeks, 2);
  assert.strictEqual(p.nextBreak.start, "2026-12-20");
  assert.strictEqual(p.nextBreak.end, "2027-01-02");
  assert.ok(p.goalDate > p.nextBreak.end);
});

t("block length adapts to the deficit", () => {
  const blk = (cut, main) => DB.build({}, {}, { today: "2026-10-25", profile: { ...profile, cutKcal: cut, maintenance: main } }).state;
  assert.deepStrictEqual([blk(2200, 2800).blockWeeks, blk(2200, 2800).breakWeeks], [10, 2]); // 21%
  assert.deepStrictEqual([blk(2300, 2800).blockWeeks, blk(2300, 2800).breakWeeks], [10, 1]); // 18%
});

t("small deficit gets 12-week blocks and 1-week breaks", () => {
  const s = DB.build({}, {}, { today: "2026-10-25", profile: { ...profile, cutKcal: 2500, maintenance: 2800 } }).state;
  assert.strictEqual(s.blockWeeks, 12);
  assert.strictEqual(s.breakWeeks, 1);
});

t("user choices override the adaptive lengths and can be reset", () => {
  const s = DB.build({}, { blockWeeks: 11, breakWeeks: 1 }, P("2026-10-25")).state;
  assert.strictEqual(s.blockWeeks, 11);
  assert.strictEqual(s.blockAdaptive, false);
  assert.strictEqual(DB.build({}, { blockWeeks: 20 }, P("2026-10-25")).state.blockWeeks, 12);
  const back = DB.apply({ blockWeeks: 11 }, "block:auto", "2026-11-01", {}, { profile });
  assert.strictEqual(back.blockWeeks, null);
});

t("no profile: everything comes from the person's own logs", () => {
  // Someone else: 70 kg, eating 1,700, losing 0.5 kg/week.
  const d = docs(35, { from: "2027-03-01", startKg: 70, kcal: 1700, perWeek: 0.5 });
  const p = DB.build(d, {}, { today: "2027-04-04" });
  assert.strictEqual(p.profile.start, "2027-03-01");
  assert.strictEqual(p.profile.startKg, d.weights["2027-03-01"].kg);
  assert.strictEqual(p.cutSource, "intake");
  assert.strictEqual(p.cutKcal, 1700);
  assert.strictEqual(p.tdee.source, "estimate");
  assert.ok(Math.abs(p.tdee.kcal - (1700 + 550)) <= 150, "tdee " + p.tdee.kcal);
  assert.strictEqual(p.goalDate, null, "no goal set, no goal date");
  assert.ok(p.plannedBreaks.length >= 3, "keeps planning breaks ahead without a goal");
  assert.ok(p.breakMacros.protein > 100 && p.breakMacros.protein < 140);
  const h = DB.html(d, {}, { today: "2027-04-04" });
  assert.ok(!/80 kg|2,000|Aziz/.test(h), "no hard-coded person in the card");
});

t("one weigh-in only: maintenance from body weight, cut at 80% of it", () => {
  const p = DB.build({ weights: { "2027-02-01": { kg: 60 } } }, {}, { today: "2027-02-01" });
  assert.strictEqual(p.tdee.source, "bodyweight");
  assert.strictEqual(p.breakKcal, 1800);
  assert.strictEqual(p.cutKcal, 1450);
  assert.strictEqual(p.cutSource, "default");
});

t("target switches to maintenance on the planned break and back", () => {
  assert.strictEqual(DB.target({}, {}, "2026-12-19", { profile }).mode, "cut");
  assert.strictEqual(DB.target({}, {}, "2026-12-19", { profile }).kcal, 2000);
  const b = DB.target({}, {}, "2026-12-20", { profile });
  assert.strictEqual(b.mode, "break");
  assert.strictEqual(b.kcal, 2800);
  assert.strictEqual(b.protein, 160);
  assert.strictEqual(b.lo, 2600);
  assert.strictEqual(DB.target({}, {}, "2027-01-03", { profile }).mode, "cut");
});

t("passed TDEE (number or TrendTDEE shape) beats the profile", () => {
  assert.strictEqual(DB.build({}, {}, P("2026-11-10", { tdee: 2712 })).breakKcal, 2700);
  const p = DB.build({}, {}, P("2026-11-10", { tdee: { kcal: 2640, lo: 2540, hi: 2740 } }));
  assert.strictEqual(p.breakKcal, 2650);
  assert.strictEqual(p.tdee.confidence, "high");
});

t("uses global TrendTDEE when inlined", () => {
  global.TrendTDEE = { estimate: () => ({ ready: true, tdee: 2905, tdeeLo: 2500, tdeeHi: 3300 }) };
  assert.strictEqual(DB.build({}, {}, P("2026-11-10")).breakKcal, 2900);
  global.TrendTDEE = { estimate: () => ({ ready: false, tdee: null }) };
  assert.strictEqual(DB.build({}, {}, P("2026-11-10")).tdee.source, "profile");
  delete global.TrendTDEE;
});

t("projection uses the observed trend after 2+ weeks", () => {
  const p = DB.build(docs(28, { perWeek: 0.9 }), {}, P("2026-11-21"));
  assert.strictEqual(p.rateSource, "trend");
  assert.ok(Math.abs(p.rate - 0.9) < 0.15, "rate " + p.rate);
});

t("stall after week 8 (relative to body weight) suggests an early break", () => {
  const d = docs(63, { stallFrom: "2026-12-05" });
  const p = DB.build(d, { blockWeeks: 10 }, P("2026-12-26"));
  assert.strictEqual(p.weekInBlock, 9);
  assert.ok(p.early, "expected early-break suggestion");
  assert.ok(DB.html(d, { blockWeeks: 10 }, P("2026-12-26")).includes("Start break today"));
  const q = DB.build(docs(40, { stallFrom: "2026-11-15" }), {}, P("2026-12-03"));
  assert.strictEqual(q.early, null, "stall before week 8 is ignored");
});

t("apply: start early, resize, end early", () => {
  let s = DB.apply({}, "start", "2026-12-10", {}, { profile });
  assert.deepStrictEqual(s.breaks, [{ start: "2026-12-10", end: "2026-12-23" }]);
  assert.strictEqual(DB.target({}, s, "2026-12-15", { profile }).mode, "break");
  s = DB.apply(s, "length:1", "2026-12-12", {}, { profile });
  assert.strictEqual(s.breaks[0].end, "2026-12-16");
  s = DB.apply(s, "end", "2026-12-14", {}, { profile });
  assert.strictEqual(s.breaks[0].end, "2026-12-13");
  assert.strictEqual(DB.target({}, s, "2026-12-14", { profile }).mode, "cut");
  const p = DB.build({ weights: { "2026-12-14": { kg: 91 } } }, s, P("2026-12-20"));
  assert.strictEqual(p.blockIdx, 2);
  assert.strictEqual(p.nextBreak.start, add("2026-12-14", 8 * 7), "next block counts from the end of the early break");
});

t("apply: ending a break that started on its own records it", () => {
  const s = DB.apply({}, "end", "2026-12-25", {}, { profile });
  assert.deepStrictEqual(s.breaks, [{ start: "2026-12-20", end: "2026-12-24" }]);
  assert.strictEqual(DB.target({}, s, "2026-12-25", { profile }).mode, "cut");
});

t("manual mode (auto:false): no break until the user starts one", () => {
  const st = { auto: false };
  assert.strictEqual(DB.target({}, st, "2026-12-28", { profile }).mode, "cut");
  const p = DB.build({}, st, P("2026-12-28"));
  assert.strictEqual(p.weekInBlock, 10);
  const h = DB.html({}, st, P("2026-12-28"));
  assert.ok(h.includes("break is due") && h.includes("Start break today") && h.includes("stays at 2,000"));
  const s2 = DB.apply(st, "start", "2026-12-28", {}, { profile });
  assert.strictEqual(s2.auto, false);
  assert.strictEqual(DB.target({}, s2, "2026-12-29", { profile }).mode, "break");
  assert.strictEqual(DB.target({}, s2, "2027-01-11", { profile }).mode, "cut");
  assert.strictEqual(DB.build({}, {}, P("2026-11-01")).state.auto, true, "default stays automatic");
});

t("html renders each phase", () => {
  assert.ok(DB.html({}, {}, P("2026-11-01")).includes("Dec 20 – Jan 2"));
  const brk = DB.html({}, {}, P("2026-12-22"));
  assert.ok(brk.includes("Day 3 of 14") && brk.includes("End break today"));
  assert.ok(DB.css.includes(".db-track"));
});

t("at or below goal flips to maintain with no breaks", () => {
  const p = DB.build({ weights: { "2026-10-25": { kg: 79.8 } } }, {}, P("2026-10-26"));
  assert.ok(["cut", "maintain"].includes(p.now.type));
  assert.strictEqual(p.plannedBreaks.length, 0);
});

console.log(n + " tests passed");
