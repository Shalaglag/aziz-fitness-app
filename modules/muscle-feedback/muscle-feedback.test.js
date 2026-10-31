// Run: node --test modules/muscle-feedback/muscle-feedback.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const MF = require("./muscle-feedback.js");
const SA = require("../strength-analytics/strength-analytics.js");

const T = "2026-10-26";
const mf = SA.musclesFor;
const w = (date, sets, feedback) => ({ date, session: "Push A", sets, feedback });
const chestDay = (date, n = 4) => ({ "Incline DB Press": Array.from({ length: n }, () => ({ w: 30, r: 10 })) });

test("sessionDelta: RP-style table", () => {
  const d = (pump, soreness, workload) => MF.sessionDelta({ pump, soreness, workload }).delta;
  assert.equal(d(1, 1, 1), 2);   // fresh, no pump, easy
  assert.equal(d(2, 1, 1), 1);
  assert.equal(d(3, 1, 1), 1);
  assert.equal(d(2, 2, 2), 0);
  assert.equal(d(3, 2, 2), 0);
  assert.equal(d(1, 2, 2), 1);
  assert.equal(d(1, 3, 1), 0);   // still sore never adds
  assert.equal(d(1, 1, 3), 0);   // too much work never adds
  assert.equal(d(3, 3, 2), -1);
  assert.equal(d(2, 3, 3), -2);
  assert.equal(d(3, 2, 3), -1);
  assert.equal(MF.sessionDelta({ pump: 2, soreness: 2 }).delta, null);
  assert.equal(MF.sessionDelta(null).delta, null);
});

test("musclesTrained: primary muscles of today's lifted sets, body order, cardio skipped", () => {
  const ids = MF.musclesTrained(w(T, {
    "Cable Standing Biceps": [{ w: 20, r: 12 }], "Treadmill": [{ w: 0, r: 0 }],
    "Incline DB Press": [{ w: 30, r: 10 }], "Lat Pulldown, Wide": [{ w: 0, r: 0 }]
  }), mf);
  assert.deepEqual(ids, ["chest", "biceps"]);
  assert.deepEqual(MF.musclesTrained(null, mf), []);
});

test("plan: counts this week's sets, applies the delta inside the default 10–20 range", () => {
  const docs = { workouts: {
    "2026-10-20": w("2026-10-20", chestDay("2026-10-20", 6), { chest: { pump: 1, soreness: 1, workload: 1 } }),
    "2026-10-23": w("2026-10-23", chestDay("2026-10-23", 6), { chest: { pump: 2, soreness: 1, workload: 1 } }),
    "2026-10-10": w("2026-10-10", chestDay("2026-10-10", 9))   // outside the window
  } };
  const p = MF.plan(docs, { today: T, musclesFor: mf });
  assert.deepEqual([p.from, p.to], ["2026-10-20", T]);
  const chest = p.rows.find(r => r.id === "chest");
  assert.equal(chest.sets, 12);
  assert.equal(chest.sessions, 2);
  assert.equal(chest.delta, 2);         // mean of +2 and +1 = 1.5 → 2
  assert.equal(chest.next, 14);
  assert.deepEqual([chest.lo, chest.hi], [10, 20]);
  // presses give triceps and front delts half a set each; no feedback → stays
  const tri = p.rows.find(r => r.id === "triceps");
  assert.equal(tri.sets, 6); assert.equal(tri.delta, null); assert.equal(tri.next, 6); assert.match(tri.reason, /No feedback yet · under target/);
  assert.equal(p.rated, true);
});

test("plan: weekly set targets from prefs clamp the result, and the reason says so", () => {
  const docs = { workouts: { [T]: w(T, chestDay(T, 12), { chest: { pump: 1, soreness: 1, workload: 1 } }) } };
  const p = MF.plan(docs, { today: T, musclesFor: mf, setTargets: { chest: { lo: 8, hi: 12 } } });
  const chest = p.rows.find(r => r.id === "chest");
  assert.equal(chest.next, 12);
  assert.match(chest.reason, /top of the target/);
  const low = MF.plan({ workouts: { [T]: w(T, chestDay(T, 10), { chest: { pump: 3, soreness: 3, workload: 3 } }) } }, { today: T, musclesFor: mf, setTargets: { chest: { lo: 10, hi: 16 } } }).rows.find(r => r.id === "chest");
  assert.equal(low.delta, -2); assert.equal(low.next, 10); assert.match(low.reason, /bottom of the target/);
});

test("plan: prefers the Strength card's this-week numbers when given", () => {
  const docs = { workouts: { [T]: w(T, chestDay(T, 2), { chest: { pump: 2, soreness: 2, workload: 2 } }) } };
  const p = MF.plan(docs, { today: T, musclesFor: mf, analysis: () => ({ muscles: [{ id: "chest", thisWeek: 15 }] }) });
  assert.equal(p.rows.find(r => r.id === "chest").sets, 15);
  const p2 = MF.plan(docs, { today: T, musclesFor: mf, analysis: () => { throw new Error("boom"); } });
  assert.equal(p2.rows.find(r => r.id === "chest").sets, 2);
});

test("handle: taps write workouts/{date}.feedback, re-tap clears, nothing else touched", () => {
  const docs = { workouts: { [T]: w(T, chestDay(T), undefined) } };
  docs.workouts[T].effort = 7;
  const el = (k, v) => ({ closest: () => ({ dataset: { mf: k, muscle: "chest", v: String(v), date: T } }) });
  let r = MF.handle(el("pump", 2), docs, T);
  assert.equal(r.collection, "workouts"); assert.equal(r.id, T);
  assert.equal(r.doc.feedback.chest.pump, 2); assert.equal(r.doc.effort, 7); assert.ok(r.doc.sets["Incline DB Press"]);
  docs.workouts[T] = r.doc;
  r = MF.handle(el("soreness", 3), docs, T); docs.workouts[T] = r.doc;
  r = MF.handle(el("workload", 1), docs, T); docs.workouts[T] = r.doc;
  assert.deepEqual([r.doc.feedback.chest.pump, r.doc.feedback.chest.soreness, r.doc.feedback.chest.workload], [2, 3, 1]);
  r = MF.handle(el("pump", 2), docs, T);
  assert.equal(r.doc.feedback.chest.pump, undefined);
  assert.equal(MF.handle({ closest: () => null }, docs, T), null);
  assert.equal(MF.handle(el("pump", 9), docs, T), null);
  assert.equal(MF.handle(el("mood", 1), docs, T), null);
});

test("handle: a day with no workout doc still gets one", () => {
  const r = MF.handle({ closest: () => ({ dataset: { mf: "pump", muscle: "back", v: "3" } }) }, { workouts: {} }, T);
  assert.deepEqual(Object.keys(r.doc).sort(), ["date", "feedback"]);
  assert.equal(r.doc.feedback.back.pump, 3);
});

test("html: card lists trained muscles with 9 taps each, marks the chosen level; plan table renders", () => {
  const wk = w(T, chestDay(T), { chest: { pump: 3 } });
  const h = MF.cardHtml(wk, T, { musclesFor: mf });
  assert.match(h, /How did it feel\?/);
  assert.equal((h.match(/data-mf="/g) || []).length, 9);
  assert.match(h, /data-mf="pump" data-muscle="chest" data-v="3"[^>]*aria-pressed="true"/);
  assert.match(h, /0\/1 rated/);
  assert.equal(MF.cardHtml({ date: T, session: "Rest" }, T, { musclesFor: mf }), "");
  const ph = MF.planHtml({ workouts: { [T]: wk } }, { today: T, musclesFor: mf });
  assert.match(ph, /Next week's sets/); assert.match(ph, /<td>Chest<\/td>/); assert.match(ph, /No feedback this week yet/);
  assert.match(MF.planHtml({}, { today: T, musclesFor: mf }), /Log some sets/);
  assert.match(MF.summary({ workouts: { [T]: wk } }, { today: T, musclesFor: mf }), /Chest: 4 → 4 \(target 10–20\)/);
});
