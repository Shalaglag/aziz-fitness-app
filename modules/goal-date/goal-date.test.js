// Run: node modules/goal-date/goal-date.test.js
const assert = require("assert");
const G = require("./goal-date.js");

const DAY = 864e5;
const add = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
// Daily weigh-ins from Oct 25 losing `perWeek` kg a week, with a repeating ±0.4 kg wobble.
function series(n, perWeek, { start = 91.9, every = 1, from = "2026-10-25" } = {}) {
  const out = {}, wob = [0, 0.3, -0.2, 0.4, -0.4, 0.1, -0.2];
  for (let i = 0; i < n; i += every) {
    const date = add(from, i);
    out[date] = { date, kg: Math.round((start - perWeek * i / 7 + wob[i % 7]) * 10) / 10 };
  }
  return out;
}
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("ok - " + name); };

t("empty weights", () => {
  const p = G.project({}, { today: "2026-10-25" });
  assert.strictEqual(p.status, "empty");
  assert.strictEqual(G.compact({}, { today: "2026-10-25" }), "");
  assert.ok(G.html({}, { today: "2026-10-25" }).includes("Log a morning weigh-in"));
});

t("one weigh-in uses the plan pace", () => {
  const p = G.project({ "2026-10-25": { date: "2026-10-25", kg: 91.9 } }, { today: "2026-10-25" });
  assert.strictEqual(p.status, "plan");
  assert.strictEqual(p.goalDate, "2027-03-02"); // 11.9 kg at 0.65 kg/wk
  assert.deepStrictEqual(p.range, { early: "2027-02-06", late: "2027-04-10" });
  assert.deepStrictEqual(p.milestones.map(m => m.kg), [90, 85, 80]);
  assert.ok(p.note.includes("Nov 8"));
});

t("13 days of data is still plan pace (needs 14+ day span)", () => {
  assert.strictEqual(G.project(series(14, 0.7), { today: "2026-11-07" }).status, "plan");
  assert.strictEqual(G.project(series(15, 0.7), { today: "2026-11-08" }).status, "trend");
});

t("steady 0.7 kg/wk loss projects from the slope", () => {
  const p = G.project(series(35, 0.7), { today: "2026-11-28" });
  assert.strictEqual(p.status, "trend");
  assert.ok(Math.abs(p.ratePerWeek - 0.7) <= 0.1, "rate " + p.ratePerWeek);
  assert.ok(p.goalDate > "2027-02-01" && p.goalDate < "2027-03-31", p.goalDate);
  assert.ok(p.range.early <= p.goalDate && p.goalDate <= p.range.late);
  assert.ok(p.milestones[0].reachedOn, "90 kg should be reached on the trend");
  assert.strictEqual(p.milestones[0].eta, null);
  assert.ok(p.milestones[1].eta < p.milestones[2].eta);
  assert.ok(p.note.includes("On the plan pace"));
});

t("milestone uses the trend, not a single low reading", () => {
  const w = series(15, 0.3);
  w["2026-11-01"].kg = 89.5; // one-off low day
  const p = G.project(w, { today: "2026-11-08" });
  assert.strictEqual(p.milestones[0].reachedOn, null);
});

t("fast early drop warns about water", () => {
  const p = G.project(series(15, 1.6), { today: "2026-11-08" });
  assert.strictEqual(p.status, "trend");
  assert.ok(p.note.includes("water"));
});

t("flat or rising weight shows no date", () => {
  const p = G.project(series(21, -0.1), { today: "2026-11-14" });
  assert.strictEqual(p.status, "stalled");
  assert.strictEqual(p.goalDate, null);
  assert.ok(G.html(series(21, -0.1), { today: "2026-11-14" }).includes("No date yet"));
  assert.ok(G.compact(series(21, -0.1), { today: "2026-11-14" }).includes("no goal date"));
});

t("a 3-week plateau after a good start counts as stalled", () => {
  const w = series(28, 0.8);
  for (let i = 0; i < 21; i++) { const d = add("2026-10-25", 28 + i); w[d] = { date: d, kg: 88.7 + [0, 0.2, -0.1, 0.3, -0.2, 0.1, 0][i % 7] }; }
  const p = G.project(w, { today: add("2026-10-25", 48) });
  assert.strictEqual(p.status, "stalled");
  assert.ok(p.milestones[0].reachedOn);
});

t("dates show the year only when it is not this year", () => {
  const h = G.html(series(35, 0.7), { today: "2026-11-28" });
  assert.ok(/Nov \d+</.test(h), "90 kg reached date without year");
  assert.ok(h.includes(", 2027"), "2027 goal date shows its year");
});

t("reaching 80 kg", () => {
  const p = G.project(series(200, 0.7, { start: 92 }), { today: add("2026-10-25", 199) });
  assert.strictEqual(p.status, "reached");
  assert.strictEqual(p.pctDone, 100);
  assert.ok(p.milestones.every(m => m.reachedOn));
});

t("weigh-ins every 3 days still project", () => {
  const p = G.project(series(28, 0.6, { every: 3 }), { today: "2026-11-21" });
  assert.strictEqual(p.status, "trend");
  assert.ok(Math.abs(p.ratePerWeek - 0.6) <= 0.15, "rate " + p.ratePerWeek);
});

t("fallback trend interpolates gaps and smooths with alpha 0.1", () => {
  const tr = G.trend({ a: { date: "2026-10-25", kg: 92 }, b: { date: "2026-10-27", kg: 90 } });
  assert.deepStrictEqual(tr.map(p => p.date), ["2026-10-25", "2026-10-26", "2026-10-27"]);
  assert.deepStrictEqual(tr.map(p => p.kg), [92, null, 90]);
  assert.strictEqual(tr[1].trend, 91.9); // 92 + 0.1 * (91 - 92)
  assert.strictEqual(tr[2].trend, 91.71); // 91.9 + 0.1 * (90 - 91.9)
});

t("external trend series padded to today anchors on the last weigh-in", () => {
  const w = series(21, 0.7);
  const own = G.trend(w);
  const last = own[own.length - 1];
  const padded = own.concat([1, 2, 3].map(i => ({ date: add(last.date, i), kg: null, trend: last.trend })));
  const a = G.project(w, { today: add(last.date, 3) });
  const b = G.project(w, { today: add(last.date, 3), trend: padded });
  assert.strictEqual(b.goalDate, a.goalDate);
  assert.strictEqual(b.current, a.current);
});

t("future-dated and junk entries are ignored", () => {
  const w = series(15, 0.7);
  w.x = { date: "2027-01-01", kg: 70 };
  w.y = { date: "bad", kg: 80 };
  w.z = { date: "2026-11-02", kg: 0 };
  assert.strictEqual(G.project(w, { today: "2026-11-08" }).status, "trend");
});

t("html renders all three milestones and the bar", () => {
  const h = G.html(series(35, 0.7), { today: "2026-11-28" });
  for (const s of ["90 kg", "85 kg", "80 kg", "gd-bar", "Reached"]) assert.ok(h.includes(s), s);
  assert.ok(G.compact(series(35, 0.7), { today: "2026-11-28" }).includes("85 kg by"));
  assert.ok(typeof G.css === "string" && G.css.includes(".gd-bar"));
});

console.log(passed + " tests passed");
