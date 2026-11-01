// Run: node --test modules/lift-goals/lift-goals.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const LG = require("./lift-goals.js");
const SA = require("../strength-analytics/strength-analytics.js");

const DAY = 864e5;
const add = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const near = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, a + " ≈ " + b);
const TODAY = "2026-12-20";
// A bench series: one session every 4 days for `n` sessions ending today, est. 1RM rising `perWeek` kg/wk.
function lift(name, { n = 10, every = 4, start = 80, perWeek = 1, unit = "kg", end = TODAY } = {}) {
  const points = [];
  for (let i = n - 1; i >= 0; i--) { const date = add(end, -i * every); points.push({ date, e1rm: start + perWeek * (n - 1 - i) * every / 7 }); }
  return { name, unit, points };
}

test("empty state, add replaces a goal for the same lift, remove drops it", () => {
  let s = LG.empty();
  assert.deepEqual(s, { goals: [] });
  s = LG.add(s, { name: "Bench Press (Barbell)", w: 100, r: 1, unit: "kg", by: "2027-06-01" });
  s = LG.add(s, { name: "Hack Squat", w: "180", r: "8" });
  assert.equal(s.goals.length, 2);
  assert.equal(s.goals[1].w, 180); assert.equal(s.goals[1].r, 8); assert.equal(s.goals[1].unit, "kg"); assert.equal(s.goals[1].by, null);
  s = LG.add(s, { name: "bench press barbell", w: 110 });
  assert.equal(s.goals.length, 2, "same lift (different spelling) replaces");
  assert.equal(s.goals.find(g => /bench/i.test(g.name)).w, 110);
  assert.equal(LG.add(s, { name: "", w: 50 }).goals.length, 2, "no name ignored");
  assert.equal(LG.add(s, { name: "X", w: 0 }).goals.length, 2, "no load ignored");
  assert.equal(LG.add(s, { name: "X", w: 50, r: 25 }).goals.length, 2, "reps above 20 ignored");
  assert.equal(LG.remove(s, s.goals[0].id).goals.length, 1);
  assert.equal(LG.remove(s, "nope").goals.length, 2);
  assert.deepEqual(LG.project(null, [], { today: TODAY }), []);
});

test("goal × reps converts to an est. 1RM target; lb goals convert to kg internally", () => {
  const s = LG.add(LG.add(LG.empty(), { name: "Hack Squat", w: 180, r: 8 }), { name: "Incline DB Press", w: 80, r: 10, unit: "lb" });
  const [hack, incl] = LG.project(s, [], { today: TODAY });
  near(hack.targetKg, 180 * (1 + 8 / 30), 0.01);
  near(hack.target, hack.targetKg, 0.01);
  near(incl.targetKg, 80 * 0.45359237 * (1 + 10 / 30), 0.01);
  near(incl.target, 80 * (1 + 10 / 30), 0.01);
  assert.equal(hack.status, "none");
  assert.ok(hack.note.includes("Not logged"));
});

test("rising trend projects a date and a rate; progress is best e1RM / target", () => {
  const s = LG.add(LG.empty(), { name: "Bench Press (Barbell)", w: 100, r: 1 });
  const bench = lift("Bench Press (Barbell)", { n: 10, start: 80, perWeek: 2 }); // ends at ~90.3 kg
  const [g] = LG.project(s, [bench], { today: TODAY });
  assert.equal(g.status, "trend");
  near(g.ratePerWeek, 2, 0.05);
  near(g.pct, bench.points[9].e1rm / 100 * 100, 0.1);
  // ~9.7 kg to go at 2 kg/wk ≈ 34 days
  const d = Math.round((Date.parse(g.eta) - Date.parse(TODAY)) / DAY);
  assert.ok(d >= 30 && d <= 38, "days " + d);
  assert.equal(g.current, bench.points[9].e1rm);
  assert.ok(g.note.includes("/wk"));
});

test("a target date gives the needed pace and on-track flag", () => {
  const bench = lift("Bench Press (Barbell)", { start: 80, perWeek: 2 });
  const late = LG.project(LG.add(LG.empty(), { name: "Bench Press (Barbell)", w: 100, by: "2027-12-01" }), [bench], { today: TODAY })[0];
  assert.equal(late.onTrack, true);
  assert.ok(late.note.includes("Ahead of Dec 1"));
  const soon = LG.project(LG.add(LG.empty(), { name: "Bench Press (Barbell)", w: 100, by: add(TODAY, 7) }), [bench], { today: TODAY })[0];
  assert.equal(soon.onTrack, false);
  assert.ok(soon.needPerWeek > 5, "needs " + soon.needPerWeek);
  assert.ok(soon.note.includes("Needs"));
});

test("reached when the best session meets the target, with the date it happened", () => {
  const s = LG.add(LG.empty(), { name: "Bench Press (Barbell)", w: 85, r: 1 });
  const bench = lift("Bench Press (Barbell)", { start: 80, perWeek: 2 });
  const [g] = LG.project(s, [bench], { today: TODAY });
  assert.equal(g.status, "reached");
  assert.equal(g.pct, 100);
  assert.equal(g.reachedOn, bench.points.find(p => p.e1rm >= 85).date);
  assert.equal(g.eta, null);
});

test("flat or falling trend has no date (stalled); a tiny climb far out is stalled too", () => {
  const s = LG.add(LG.empty(), { name: "Bench Press (Barbell)", w: 100 });
  assert.equal(LG.project(s, [lift("Bench Press (Barbell)", { start: 90, perWeek: 0 })], { today: TODAY })[0].status, "stalled");
  const down = LG.project(s, [lift("Bench Press (Barbell)", { start: 90, perWeek: -1 })], { today: TODAY })[0];
  assert.equal(down.status, "stalled");
  assert.ok(down.ratePerWeek < 0);
  assert.ok(down.note.includes("slipping"));
  const crawl = LG.project(LG.add(LG.empty(), { name: "Bench Press (Barbell)", w: 300 }), [lift("Bench Press (Barbell)", { start: 90, perWeek: 0.5 })], { today: TODAY })[0];
  assert.equal(crawl.status, "stalled");
  assert.ok(crawl.note.includes("two years"));
});

test("too few sessions or too short a span is early; old sessions outside 8 weeks do not count", () => {
  const s = LG.add(LG.empty(), { name: "Bench Press (Barbell)", w: 100 });
  const two = LG.project(s, [lift("Bench Press (Barbell)", { n: 2, perWeek: 2 })], { today: TODAY })[0];
  assert.equal(two.status, "early");
  assert.ok(two.note.includes("2 of 3 sessions"));
  assert.ok(two.pct > 0);
  const packed = LG.project(s, [lift("Bench Press (Barbell)", { n: 4, every: 3, perWeek: 2 })], { today: TODAY })[0];
  assert.equal(packed.status, "early");
  assert.ok(packed.note.includes("needs 14"));
  const old = LG.project(s, [lift("Bench Press (Barbell)", { n: 10, perWeek: 2, end: add(TODAY, -70) })], { today: TODAY })[0];
  assert.equal(old.status, "early");
});

test("works on StrengthAnalytics.analyze output, matching plan names case-insensitively", () => {
  const workouts = {};
  for (let i = 0; i < 6; i++) { const d = add(TODAY, -i * 5); workouts[d] = { date: d, session: "Push A", sets: { "Incline DB Press": [{ w: 70 + (5 - i) * 2, r: 10 }], "Hack Squat": [{ w: 140, r: 10 }] } }; }
  const A = SA.analyze({ workouts }, { today: TODAY, units: { "Incline DB Press": "lb" } });
  const s = LG.add(LG.add(LG.empty(), { name: "incline db press", w: 100, r: 10, unit: "lb" }), { name: "Hack Squat", w: 180, r: 8 });
  const [inc, hack] = LG.project(s, A, { today: TODAY });
  assert.equal(inc.name, "Incline DB Press");
  assert.equal(inc.unit, "lb");
  assert.equal(inc.status, "trend");
  near(inc.best, 80 * (1 + 10 / 30), 0.05); // best session 80 lb × 10 shown in lb
  assert.ok(inc.eta > TODAY);
  assert.equal(hack.status, "stalled");
});

test("html renders bars, the form and lift options; handle() adds and removes through a fake DOM", () => {
  const bench = lift("Bench Press (Barbell)", { start: 80, perWeek: 2 });
  let s = LG.add(LG.empty(), { name: "Bench Press (Barbell)", w: 100 });
  const h = LG.html(s, [bench], { today: TODAY, names: ["Lat Pulldown, Wide"] });
  assert.ok(h.includes("lg-card") && h.includes("role=\"progressbar\"") && h.includes("Bench Press (Barbell)"));
  assert.ok(h.includes('<optgroup label="Not logged yet"><option value="Lat Pulldown, Wide">'));
  assert.ok(h.includes("0 / 1 reached"));
  assert.ok(LG.html(LG.empty(), [], { today: TODAY }).includes("No lift goals yet"));
  assert.ok(typeof LG.css === "string" && LG.css.includes(".lg-bar"));

  // minimal element stand-ins
  const field = (v, extra = {}) => Object.assign({ value: v }, extra);
  const fields = { name: field("Hack Squat", { options: [], selectedIndex: 0 }), other: field(""), w: field("180"), r: field("8"), unit: field("kg"), by: field("") };
  const root = { querySelector: sel => fields[sel.match(/"([^"]+)"/)[1]] || null };
  const addBtn = { getAttribute: k => ({ "data-lg": "add" })[k] || null, closest: () => addBtn };
  addBtn.closest = sel => sel === "[data-lg]" ? addBtn : root;
  const r = LG.handle(addBtn, { state: s, root, today: TODAY });
  assert.equal(r.state.goals.length, 2);
  assert.ok(r.toast.includes("Hack Squat 180 kg × 8"));
  fields.w.value = "";
  assert.equal(LG.handle(addBtn, { state: s, root }).state.goals.length, 1);
  assert.ok(LG.handle(addBtn, { state: s, root }).toast.includes("load"));
  const id = r.state.goals[0].id;
  const rm = { getAttribute: k => ({ "data-lg": "remove", "data-id": id })[k] || null, closest: () => rm };
  const r2 = LG.handle(rm, { state: r.state });
  assert.equal(r2.state.goals.length, 1);
  assert.ok(r2.toast.includes("Removed"));
  assert.equal(LG.handle({ closest: () => null }, { state: s }), null);
});
