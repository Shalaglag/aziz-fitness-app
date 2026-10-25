// Run: TZ=Asia/Kuwait node --test modules/cardio/
const test = require("node:test");
const assert = require("node:assert/strict");
const { Cardio: C } = require("./cardio.js");

const TODAY = "2026-11-20";
const DAY = 864e5;
const back = n => new Date(Date.parse(TODAY + "T00:00:00Z") - n * DAY).toISOString().slice(0, 10);
const prefs = { main: { cardio: { kind: "treadmill", min: 30, speed: 4.0, incline: 3, hrCeiling: 135 } } };

// cardio/{date} docs from [daysBack, session fields]
function cardio(rows) {
  const out = {};
  rows.forEach(([n, s], i) => {
    const date = back(n);
    const { session } = C.clean(Object.assign({ kind: "treadmill", id: "s" + i, at: date + "T15:00:00Z" }, s));
    out[date] = C.withSession(out[date], session, date);
  });
  return out;
}
const lift = n => ({ date: back(n), session: "Push A", sets: { "Bench Press (Barbell)": [{ w: 90, r: 8 }] } });

test("clean: validates ranges and needs minutes", () => {
  const ok = C.clean({ min: "30", speed: "4,0", incline: "3", hrAvg: "128" });
  assert.equal(ok.ok, true);
  assert.equal(ok.session.speed, 4);
  const bad = C.clean({ min: "", speed: "60", hrAvg: "20" });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.sort(), ["hrAvg", "min", "speed"]);
  assert.equal(C.clean({ min: 30, hrAvg: 140, hrMax: 120 }).errors[0], "hrMax");
});

test("clean: distance from speed × time is flagged, typed distance is not", () => {
  const calc = C.clean({ min: 30, speed: 4 }).session;
  assert.equal(calc.km, 2); assert.equal(calc.kmCalc, true);
  const typed = C.clean({ min: 30, speed: 4, km: 2.1 }).session;
  assert.equal(typed.km, 2.1); assert.equal(typed.kmCalc, false);
  const fromKm = C.clean({ min: 30, km: 2.5 }).session;
  assert.equal(fromKm.speed, 5);
});

test("clean: calories are the machine's, an ACSM estimate with body weight, or nothing", () => {
  assert.deepEqual([C.clean({ min: 30, speed: 4, incline: 3, kcal: 210 }, { weightKg: 92 }).session.kcal, C.clean({ min: 30, speed: 4, incline: 3, kcal: 210 }).session.kcalSrc], [210, "machine"]);
  const est = C.clean({ min: 30, speed: 4, incline: 3 }, { weightKg: 92 }).session;
  // VO2 = 0.1*66.67 + 1.8*66.67*0.03 + 3.5 = 13.77 ml/kg/min -> 13.77*92/1000*5*30 = 190 kcal
  assert.equal(est.kcal, 190); assert.equal(est.kcalSrc, "est");
  const none = C.clean({ min: 30, speed: 4, incline: 3 }).session;
  assert.equal(none.kcal, null);
  assert.equal(C.clean({ kind: "bike", min: 30 }, { weightKg: 92 }).session.kcal, null);
});

test("treadmillFlag keeps the day boolean in step", () => {
  const s = C.clean({ min: 30, speed: 4 }).session;
  const doc = C.withSession(null, s, TODAY);
  assert.equal(C.treadmillFlag({ date: TODAY }, doc, null).treadmill, true);
  const emptied = C.withoutSession(doc, s.id);
  assert.equal(C.treadmillFlag({ date: TODAY, treadmill: true }, emptied, doc).treadmill, false);
  // ticked by hand with no sessions: left alone
  assert.equal(C.treadmillFlag({ date: TODAY, treadmill: true }, { sessions: [] }, null).treadmill, true);
  const bike = C.withSession(null, C.clean({ kind: "bike", min: 20 }).session, TODAY);
  assert.equal(C.treadmillFlag({ date: TODAY }, bike, null).treadmill, false);
});

test("fromLogger + mergeLogger: minutes/km from the logger, typed details kept", () => {
  const w = { id: "w1", start: new Date(2026, 10, 20, 15, 30).getTime(), end: new Date(2026, 10, 20, 17, 0).getTime(), exercises: [
    { exId: "bench-press-barbell", sets: [{ w: 90, r: 8 }] },
    { exId: "treadmill-incline-walk", sets: [{ t: "n", km: "2.0", min: "30", done: true }] },
    { exId: "stationary-bike", sets: [{ t: "w", km: "1", min: "5" }] },
  ] };
  const got = C.fromLogger(w);
  assert.equal(got.length, 1);
  assert.equal(got[0].date, "2026-11-20");
  assert.deepEqual([got[0].kind, got[0].min, got[0].km, got[0].speed], ["treadmill", 30, 2, 4]);
  let doc = C.mergeLogger(null, got);
  assert.equal(doc.date, "2026-11-20");
  // user adds incline + HR in the app, then the workout is saved again from the logger
  const s = doc.sessions[0];
  doc = C.withSession(doc, Object.assign({}, s, { incline: 3, hrAvg: 126 }));
  doc = C.mergeLogger(doc, C.fromLogger(w));
  assert.equal(doc.sessions.length, 1);
  assert.deepEqual([doc.sessions[0].incline, doc.sessions[0].hrAvg, doc.sessions[0].id], [3, 126, s.id]);
});

test("liftDates reads lb_workouts first and workouts/{date}, skipping cardio-only and Rest", () => {
  const docs = {
    lb_workouts: {
      a: { id: "a", start: new Date(2026, 10, 18, 15).getTime(), end: 1, exercises: [{ exId: "leg-extension-machine", sets: [{ w: 100, r: 8 }] }] },
      b: { id: "b", start: new Date(2026, 10, 17, 15).getTime(), end: 1, exercises: [{ exId: "treadmill-incline-walk", sets: [{ km: 2, min: 30 }] }] },
      c: { id: "c", start: new Date(2026, 10, 16, 15).getTime(), exercises: [{ exId: "leg-extension-machine", sets: [{ w: 100, r: 8 }] }] }, // not finished
    },
    workouts: { [back(1)]: lift(1), [back(3)]: { date: back(3), session: "Rest", sets: {} } },
  };
  assert.deepEqual([...C.liftDates(docs)].sort(), ["2026-11-18", back(1)].sort());
});

test("analyze: weekly totals, cardio-after-lifting count, checkbox-only days", () => {
  const docs = {
    prefs,
    cardio: cardio([[0, { min: 30, speed: 4, incline: 3 }], [1, { min: 30, speed: 4, incline: 3 }], [8, { min: 25, speed: 4, incline: 3 }]]),
    days: { [back(2)]: { date: back(2), treadmill: true } },
    workouts: { [back(0)]: lift(0), [back(1)]: lift(1), [back(2)]: lift(2), [back(4)]: lift(4), [back(8)]: lift(8) },
  };
  const a = C.analyze(docs, { today: TODAY });
  assert.equal(a.week.sessions, 2);
  assert.equal(a.week.min, 60);
  assert.equal(a.week.km, 4);
  assert.equal(a.week.climbM, 120); // 4 km at 3%
  assert.equal(a.week.liftDays, 4);
  assert.equal(a.week.liftDaysWithCardio, 3); // 0, 1, and the ticked day 2; day 4 had none
  assert.equal(a.week.checkboxOnly, 1);
  assert.equal(a.prev.min, 25);
});

test("suggest: step up only after 3 full, easy sessions at the same setting", () => {
  const easy = { min: 30, speed: 4, incline: 3, hrAvg: 120 };
  let a = C.analyze({ prefs, cardio: cardio([[4, easy], [2, easy]]) }, { today: TODAY });
  assert.equal(a.suggestion.action, "hold");
  a = C.analyze({ prefs, cardio: cardio([[4, easy], [2, easy], [0, easy]]) }, { today: TODAY });
  assert.equal(a.suggestion.action, "up");
  assert.deepEqual(a.suggestion.next, { speed: 4, incline: 4, change: "incline 3 → 4" });
  // one short session holds
  a = C.analyze({ prefs, cardio: cardio([[4, easy], [2, Object.assign({}, easy, { min: 20 })], [0, easy]]) }, { today: TODAY });
  assert.equal(a.suggestion.action, "hold");
  // heart rate near or over the ceiling holds
  a = C.analyze({ prefs, cardio: cardio([[4, easy], [2, easy], [0, Object.assign({}, easy, { hrAvg: 138 })]]) }, { today: TODAY });
  assert.equal(a.suggestion.action, "hold");
  assert.match(a.suggestion.text, /above your easy-zone top of 135/);
});

test("suggest: effort ratings work without heart rate; max incline moves speed", () => {
  const p = { main: { cardio: { min: 30 } } };
  const s = { min: 30, speed: 4, incline: 12, effort: 1 };
  let a = C.analyze({ prefs: p, cardio: cardio([[4, s], [2, s], [0, s]]) }, { today: TODAY });
  assert.equal(a.suggestion.action, "up");
  assert.equal(a.suggestion.next.speed, 4.3);
  a = C.analyze({ prefs: p, cardio: cardio([[4, s], [2, Object.assign({}, s, { effort: 3 })], [0, s]]) }, { today: TODAY });
  assert.equal(a.suggestion.action, "hold");
  const bare = { min: 30, speed: 4, incline: 3 };
  a = C.analyze({ prefs: p, cardio: cardio([[4, bare], [2, bare], [0, bare]]) }, { today: TODAY });
  assert.match(a.suggestion.text, /Rate how each session felt/);
});

test("hrCeiling: own number, else 70% of 220 - age, else none", () => {
  assert.equal(C.hrCeiling(C.planFrom(prefs.main), prefs.main), 135);
  assert.equal(C.hrCeiling(C.planFrom({}), { profile: { age: 29 } }), 134);
  assert.equal(C.hrCeiling(C.planFrom({}), {}), null);
});

test("analyze: heart rate trend at the same setting", () => {
  const docs = { prefs, cardio: cardio([[20, { min: 30, speed: 4, incline: 3, hrAvg: 132 }], [10, { min: 30, speed: 4, incline: 3 }], [0, { min: 30, speed: 4, incline: 3, hrAvg: 124 }]]) };
  const a = C.analyze(docs, { today: TODAY });
  assert.deepEqual([a.setting.hrFirst, a.setting.hrLast, a.setting.count], [132, 124, 3]);
  assert.match(C.progressHTML(docs, { today: TODAY }), /132 → 124 bpm/);
  assert.match(C.summary(docs, { today: TODAY }), /Avg HR at Treadmill · 4 km\/h · incline 3: 132 → 124 bpm/);
});

test("cardHTML: prefills from the last session, shows sessions, escapes", () => {
  const docs = { prefs, cardio: cardio([[1, { min: 30, speed: 4.2, incline: 4 }]]), workouts: { [TODAY]: lift(0) } };
  const empty = C.cardHTML(TODAY, docs);
  assert.match(empty, /Cardio after lifting/);
  assert.match(empty, /id="cdo-speed"[^>]*value="4.2"/);
  assert.match(empty, /your last session/);
  docs.cardio[TODAY] = C.withSession(null, C.clean({ id: "x\"y", min: 30, speed: 4, incline: 3 }).session, TODAY);
  const done = C.cardHTML(TODAY, docs);
  assert.match(done, /30 of 30 min/);
  assert.match(done, /≈2.0 km/);
  assert.ok(done.includes('data-id="x&quot;y"'));
  assert.match(C.progressHTML({}, { today: TODAY }), /No cardio logged yet/);
});

test("handle: save, edit and delete write cardio/{date} and the treadmill flag", () => {
  const writes = [];
  const docs = { prefs, cardio: {}, days: {} };
  const put = (c, id, doc) => { writes.push([c, id]); docs[c][id] = doc; };
  // minimal DOM stand-ins
  const vals = { kind: "treadmill", min: "30", speed: "4", incline: "3", km: "", hrAvg: "125", hrMax: "", kcal: "" };
  const form = {
    dataset: { date: TODAY, edit: "" },
    querySelector: sel => {
      const m = sel.match(/#cdo-(\w+)/); if (m) return { value: vals[m[1]] };
      if (sel.startsWith("input[name")) return { value: "1" };
      if (sel === ".cdo-err") return { hidden: true };
      return null;
    },
    querySelectorAll: () => [],
  };
  const card = { querySelector: () => form };
  const btn = (act, id) => ({ dataset: { cardio: act, id }, closest: sel => sel === ".cdo-card" ? card : btnObj });
  let btnObj = btn("save"); btnObj = Object.assign(btnObj, { closest: sel => sel === ".cdo-card" ? card : btnObj });
  const el = { closest: () => btnObj };
  assert.equal(C.handle(el, { docs, put, weightKg: 92 }), true);
  assert.deepEqual(writes, [["cardio", TODAY], ["days", TODAY]]);
  const s = docs.cardio[TODAY].sessions[0];
  assert.deepEqual([s.min, s.hrAvg, s.effort, s.kcalSrc, docs.days[TODAY].treadmill], [30, 125, 1, "est", true]);
  // edit keeps the id
  form.dataset.edit = s.id; vals.hrAvg = "121";
  C.handle(el, { docs, put });
  assert.equal(docs.cardio[TODAY].sessions.length, 1);
  assert.equal(docs.cardio[TODAY].sessions[0].hrAvg, 121);
  // delete clears the flag
  btnObj.dataset = { cardio: "del", id: s.id };
  C.handle(el, { docs, put });
  assert.equal(docs.cardio[TODAY].sessions.length, 0);
  assert.equal(docs.days[TODAY].treadmill, false);
  assert.equal(C.handle({ closest: () => null }, { docs, put }), false);
});
