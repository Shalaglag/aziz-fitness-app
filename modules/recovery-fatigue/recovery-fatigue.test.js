const test = require("node:test");
const assert = require("node:assert/strict");
const { RecoveryFatigue: R } = require("./recovery-fatigue.js");

const DAY = 864e5;
const add = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const T = "2026-11-20";

// Two lifts trained every 4 days for 6 weeks; `drop` scales the last two sessions.
function workouts(drop = 1, extra = {}) {
  const out = {};
  for (let i = 40; i >= 0; i -= 4) {
    const d = add(T, -i), k = i <= 4 ? drop : 1;
    out[d] = Object.assign({ date: d, session: "Push A", sets: { "Bench Press": [{ w: 80 * k, r: 8 }], "Squat": [{ w: 100 * k, r: 6 }] } }, extra[d]);
  }
  return out;
}

test("no data -> no-checkin, low fatigue, notes explain what is missing", () => {
  const rd = R.readiness({}, { date: T });
  assert.equal(rd.status, "no-checkin");
  assert.equal(rd.score, null);
  const fa = R.fatigue({}, { today: T });
  assert.equal(fa.level, "low");
  assert.equal(fa.warnings.length, 0);
  assert.ok(fa.notes.length >= 2);
  assert.equal(R.warningsHtml(fa), "");
});

test("good night + fresh check-in -> green", () => {
  const days = { [T]: { sleep: 8, readiness: { quality: 5, soreness: 4, energy: 5 } }, [add(T, -1)]: { sleep: 8 } };
  const rd = R.readiness({ days }, { date: T });
  assert.equal(rd.verdict, "green");
  assert.ok(rd.score >= 85, rd.score);
});

test("sleep under 5.5 h forces red even with good check-in", () => {
  const rd = R.readiness({ days: { [T]: { sleep: 5, readiness: { quality: 5, soreness: 5, energy: 5 } } } }, { date: T });
  assert.equal(rd.verdict, "red");
});

test("sleep below minimum caps green at amber", () => {
  const rd = R.readiness({ days: { [T]: { sleep: 6.8, readiness: { quality: 5, soreness: 5, energy: 5 } } } }, { date: T, sleepTarget: 7 });
  assert.equal(rd.verdict, "amber");
});

test("sharp joint -> red and swap/physio advice", () => {
  const rd = R.readiness({ days: { [T]: { sleep: 8, readiness: { quality: 5, soreness: 5, energy: 5, joints: { knee: 3 } } } } }, { date: T });
  assert.equal(rd.verdict, "red");
  assert.match(rd.advice, /knee/);
  assert.match(rd.advice, /physio/);
});

test("score uses only parts that were logged", () => {
  const rd = R.readiness({ days: { [T]: { readiness: { energy: 1 } } } }, { date: T });
  assert.equal(rd.parts.length, 2); // energy + joints (none)
  assert.equal(rd.verdict, "red");
});

test("lifts dropping 2 sessions -> lifts-down warning with evidence", () => {
  const fa = R.fatigue({ workouts: workouts(0.9) }, { today: T });
  const w = fa.warnings.find(x => x.id === "lifts-down");
  assert.ok(w);
  assert.equal(w.evidence.length, 2);
  assert.equal(fa.level, "high");
});

test("steady lifts -> no lift warning", () => {
  const fa = R.fatigue({ workouts: workouts(1) }, { today: T });
  assert.ok(!fa.warnings.some(x => x.id === "lifts-down"));
  assert.equal(fa.lifts.length, 2);
});

test("lighter week mutes the lift drop", () => {
  const docs = { workouts: workouts(0.9), prefs: { main: { deloadFrom: add(T, -5), deloadUntil: add(T, 1) } } };
  const fa = R.fatigue(docs, { today: T });
  assert.ok(fa.onDeload);
  assert.ok(!fa.warnings.some(x => x.id === "lifts-down"));
});

test("short sleep + rising effort -> combined fatigue warning first", () => {
  const days = {}, extra = {};
  for (let i = 0; i < 7; i++) days[add(T, -i)] = { sleep: 6 };
  const ws = workouts(1);
  Object.keys(ws).forEach(d => { ws[d].effort = d >= add(T, -6) ? 9 : 7; });
  ws[add(T, -2)] = { date: add(T, -2), session: "Pull A", sets: {}, effort: 9 };
  const fa = R.fatigue({ days, workouts: ws }, { today: T });
  assert.equal(fa.warnings[0].id, "fatigue");
  assert.match(fa.warnings[0].text, /short sleep/);
  assert.match(fa.warnings[0].text, /Fix sleep first/);
  assert.equal(fa.level, "high");
});

test("joint logged 3 times in 10 days -> watch warning", () => {
  const days = {};
  [0, 3, 6].forEach(i => { days[add(T, -i)] = { readiness: { joints: { shoulder: 1 } } }; });
  const fa = R.fatigue({ days }, { today: T });
  const w = fa.warnings.find(x => x.id === "joint-shoulder");
  assert.ok(w);
  assert.equal(w.level, "watch");
});

test("handle: scale set, tap again clears, joint cycles", () => {
  const btn = ds => ({ closest: () => ({ dataset: ds }) });
  let docs = { days: { [T]: { date: T, sleep: 7, food: [] } } };
  let out = R.handle(btn({ rf: "energy", rfV: "4", rfDate: T }), docs, T);
  assert.equal(out.doc.readiness.energy, 4);
  assert.equal(out.doc.sleep, 7);
  docs = { days: { [T]: out.doc } };
  out = R.handle(btn({ rf: "energy", rfV: "4", rfDate: T }), docs, T);
  assert.equal(out.doc.readiness.energy, undefined);
  for (let i = 1; i <= 4; i++) {
    out = R.handle(btn({ rf: "joint", rfV: "knee", rfDate: T }), docs, T);
    docs = { days: { [T]: out.doc } };
    assert.equal((out.doc.readiness.joints || {}).knee, i < 4 ? i : undefined);
  }
  assert.equal(R.handle(btn({ rf: "joint", rfV: "<x>", rfDate: T }), docs, T), null);
  assert.equal(R.handle({ closest: () => null }, docs, T), null);
});

test("HTML renders and escapes", () => {
  const days = { [T]: { sleep: 7.5, readiness: { quality: 4, energy: 3, joints: { knee: 2 } } } };
  const c = R.checkinHtml({ days }, { date: T });
  assert.match(c, /Recovery check-in/);
  assert.match(c, /data-rf="joint" data-rf-v="knee"/);
  assert.match(c, /Knee · Moderate/);
  const h = R.html({ days, workouts: workouts(0.9) }, { today: T });
  assert.match(h, /Fatigue building/);
  assert.match(h, /<svg/);
  assert.match(R.summary({ days }, { today: T }), /Readiness \d+\/100/);
});

test("full logger sessions are read first, lb converted to kg, and line up with Quick log names", () => {
  // Quick log: Bench at 80 kg x 8 for older sessions; full logger: last two sessions in lb, lower.
  const ws = {};
  [24, 20, 16].forEach(i => { const d = add(T, -i); ws[d] = { date: d, session: "Push A", sets: { "Bench Press (Barbell)": [{ w: 80, r: 8 }], "Squat (Barbell)": [{ w: 100, r: 6 }] } }; });
  const at = d => new Date(d + "T12:00:00").getTime();
  const lb = {};
  [8, 4].forEach(i => { const d = add(T, -i); lb["w" + i] = { id: "w" + i, start: at(d), exercises: [
    { exId: "bench-press-barbell", unit: "lb", sets: [{ t: "w", w: 95, r: 10 }, { t: "n", w: 160, r: 8 }] },
    { exId: "squat-barbell", unit: "kg", sets: [{ t: "n", w: 90, r: 6 }] }] }; });
  // A Quick log summary on a logger date must not double count.
  ws[add(T, -4)] = { date: add(T, -4), session: "Push A", sets: { "Bench Press (Barbell)": [{ w: 200, r: 8 }] } };
  const fa = R.fatigue({ workouts: ws, lb_workouts: lb }, { today: T });
  const bench = fa.lifts.find(l => l.name === "Bench Press (Barbell)");
  assert.ok(bench, JSON.stringify(fa.lifts));
  assert.ok(Math.abs(bench.last - 160 * 0.45359237 * (1 + 8 / 30)) < 0.1, bench.last);
  assert.ok(fa.warnings.some(w => w.id === "lifts-down"));
});
