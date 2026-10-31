// Run: node --test modules/break-ramp/break-ramp.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { BreakRamp: B } = require("./break-ramp.js");

const TODAY = "2026-11-20";
const DAY = 864e5;
const back = n => new Date(Date.parse(TODAY + "T00:00:00Z") - n * DAY).toISOString().slice(0, 10);
const S = (n, w, r = 8) => ({ date: back(n), sets: [{ w, r }, { w, r }] });

test("no history, no ramp", () => {
  assert.equal(B.plan([], { today: TODAY }).ramp, false);
  assert.equal(B.plan([{ date: back(10), sets: [{ w: "", r: 8 }] }], { today: TODAY }).reason, "no-history");
});

test("trained within the week: normal progression", () => {
  const p = B.plan([S(3, 80), S(7, 80), S(10, 77.5)], { today: TODAY });
  assert.equal(p.ramp, false);
  assert.equal(p.reason, "no-break");
});

test("7+ days off: stage 1 at 90%, rounded down to the step", () => {
  const p = B.plan([S(9, 80), S(13, 77.5)], { today: TODAY });
  assert.equal(p.ramp, true);
  assert.equal(p.stage, 1); assert.equal(p.of, 2); assert.equal(p.factor, 0.9); assert.equal(p.gapDays, 9);
  assert.deepEqual(p.sets, [{ w: 70, r: 8 }, { w: 70, r: 8 }]);   // 72 -> 70 at 2.5 kg
  assert.equal(B.plan([S(9, 80)], { today: TODAY, step: 2 }).sets[0].w, 72);
  assert.match(p.text, /9 days/);
});

test("exactly 6 days is not a break, 7 is", () => {
  assert.equal(B.plan([S(6, 80)], { today: TODAY }).ramp, false);
  assert.equal(B.plan([S(7, 80)], { today: TODAY }).ramp, true);
});

test("second session after the break: 95% of the pre-break weights, not of the 90% session", () => {
  const p = B.plan([S(2, 70), S(11, 80), S(15, 80)], { today: TODAY });
  assert.equal(p.ramp, true);
  assert.equal(p.stage, 2); assert.equal(p.factor, 0.95); assert.equal(p.gapDays, 9);
  assert.equal(p.base.date, back(11));
  assert.equal(p.sets[0].w, 75);   // 76 -> 75
});

test("third session after a short break: ramp done", () => {
  const p = B.plan([S(1, 75), S(4, 70), S(13, 80)], { today: TODAY });
  assert.equal(p.ramp, false);
  assert.equal(p.reason, "ramp-done");
});

test("28+ days off ramps over three sessions", () => {
  const p1 = B.plan([S(30, 100)], { today: TODAY });
  assert.equal(p1.factor, 0.8); assert.equal(p1.of, 3); assert.equal(p1.sets[0].w, 80);
  const p2 = B.plan([S(1, 80), S(31, 100)], { today: TODAY });
  assert.equal(p2.stage, 2); assert.equal(p2.factor, 0.9);
  const p3 = B.plan([S(1, 90), S(4, 80), S(34, 100)], { today: TODAY });
  assert.equal(p3.stage, 3); assert.equal(p3.factor, 0.95);
  assert.equal(B.plan([S(1, 95), S(3, 90), S(6, 80), S(36, 100)], { today: TODAY }).ramp, false);
});

test("future-dated and unordered sessions are handled", () => {
  const p = B.plan([S(13, 77.5), S(-2, 90), S(9, 80)], { today: TODAY });
  assert.equal(p.stage, 1); assert.equal(p.base.sets[0].w, 80);
});

test("fromShell reads the app's workouts docs and skips empty sets", () => {
  const w = {};
  w[back(9)] = { date: back(9), session: "Push A", sets: { "Bench Press (Barbell)": [{ w: 80, r: 8 }, { w: "", r: "" }], "Fly": [{ w: 12, r: 12 }] } };
  w[back(2)] = { date: back(2), session: "Pull A", sets: { "Row": [{ w: 60, r: 10 }] } };
  const h = B.fromShell(w, "Bench Press (Barbell)");
  assert.equal(h.length, 1); assert.deepEqual(h[0].sets, [{ w: 80, r: 8 }]);
  const res = B.analyzeShell(w, { today: TODAY });
  assert.equal(res.count, 2);
  assert.deepEqual(res.lifts.map(l => l.name), ["Bench Press (Barbell)", "Fly"]);
  assert.equal(res.lifts[1].sets[0].w, 10);   // 10.8 -> 10
  assert.equal(B.analyzeShell(w, { today: TODAY, names: ["Row"] }).count, 0);
});

test("fromLogger reads lb_workouts, drops warm-ups, unchecked sets and the current workout", () => {
  const t = Date.parse(TODAY + "T10:00:00Z");
  const lb = [
    { id: "a", start: t - 9 * DAY, exercises: [{ exId: "bench", sets: [{ t: "w", w: 40, r: 10, done: true }, { t: "n", w: 80, r: 8, done: true }, { t: "n", w: 80, r: 7, done: false }] }] },
    { id: "cur", start: t, exercises: [{ exId: "bench", sets: [{ t: "n", w: 70, r: 8, done: true }] }] },
    { id: "b", start: t - 3 * DAY, exercises: [{ exId: "squat", sets: [{ t: "n", w: 100, r: 5, done: true }] }] },
  ];
  const h = B.fromLogger(lb, "bench", { excludeId: "cur" });
  assert.equal(h.length, 1); assert.deepEqual(h[0].sets, [{ w: 80, r: 8 }]);
  const p = B.plan(h, { today: t });
  assert.equal(p.ramp, true); assert.equal(p.gapDays, 9); assert.equal(p.sets[0].w, 70);
  assert.equal(B.plan(B.fromLogger(lb, "squat"), { today: t }).ramp, false);
});

test("html helpers", () => {
  const p = B.plan([S(9, 80)], { today: TODAY });
  assert.match(B.noteHtml(p, "kg"), /Back after 9 days/);
  assert.match(B.noteHtml(p), /70×8, 70×8 kg/);
  assert.equal(B.noteHtml({ ramp: false }), "");
  assert.equal(B.cardHtml({ lifts: [], count: 0 }), "");
  const html = B.cardHtml({ lifts: [Object.assign({ name: "Bench <B>" }, p)], count: 1 });
  assert.match(html, /Bench &lt;B&gt;/); assert.match(html, /1 lift after/); assert.match(html, /90% · 9 days off · 1\/2/);
  assert.equal(B.roundDown(72, 2.5), 70); assert.equal(B.roundDown(72, 2), 72); assert.equal(B.roundDown(45, 5), 45);
  assert.equal(B.daysBetween("2026-11-01", "2026-11-20"), 19);
});
