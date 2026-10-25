// Run: node --test modules/strength-analytics/strength-analytics.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const SA = require("./strength-analytics.js");

const DAY = 864e5;
const add = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const near = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, a + " ≈ " + b);
const noon = d => new Date(d + "T12:00:00").getTime();

test("e1rm: Epley, 1 rep = weight, nothing outside 1–20 reps or without load", () => {
  near(SA.e1rm(100, 10), 133.33, 0.01);
  assert.equal(SA.e1rm(100, 1), 100);
  assert.equal(SA.e1rm(100, 21), null);
  assert.equal(SA.e1rm(0, 10), null);
  assert.equal(SA.e1rm(100, 0), null);
});

test("musclesFor: the plan's names, logger library names and Strong names map to muscles", () => {
  const p = n => (SA.musclesFor(n) || {}).primary;
  assert.deepEqual(p("Incline DB Press"), ["chest"]);
  assert.deepEqual(p("Gundam (Chest Machine)"), ["chest"]);
  assert.deepEqual(p("Seated DB Overhead Press"), ["frontDelts"]);
  assert.deepEqual(p("Iso-Lateral Low Row"), ["back"]);
  assert.deepEqual(p("Lat Pulldown, Wide"), ["back"]);
  assert.deepEqual(p("Side Delts"), ["sideDelts"]);
  assert.deepEqual(p("Reverse Fly (Machine)"), ["rearDelts"]);
  assert.deepEqual(p("Traps Machine"), ["traps"]);
  assert.deepEqual(p("Cable Standing Biceps"), ["biceps"]);
  assert.deepEqual(p("Triceps Rope"), ["triceps"]);
  assert.deepEqual(p("Lying Leg Curl"), ["hamstrings"]);
  assert.deepEqual(p("Calf Press on Seated Leg Press"), ["calves"]);
  assert.deepEqual(p("Hack Squat"), ["quads"]);
  assert.deepEqual(p("Walking Lunge (Dumbbell)"), ["quads"]);
  assert.deepEqual(p("Glute Kickback (Cable)"), ["glutes"]);
  assert.deepEqual(p("Hip Abductor"), ["abductors"]);
  assert.deepEqual(p("Seated Abs"), ["abs"]);
  assert.ok(SA.musclesFor("Treadmill (Incline Walk)").cardio);
  assert.equal(SA.musclesFor("Zercher Mystery Thing"), null);
  assert.deepEqual(SA.musclesFor("Seated Row (Cable)").secondary, ["rearDelts", "biceps"]);
});

test("unitsFrom reads the app's PROGRAM tuples", () => {
  const u = SA.unitsFrom({ "Push A": [["Incline DB Press", 65, 10, 2, "lb"], ["Cable Crossover", 16.5, 10, 3, "kg"]] });
  assert.deepEqual(u, { "Incline DB Press": "lb", "Cable Crossover": "kg" });
});

test("weekly sets: primary counts 1, helper ½, cardio and other weeks ignored, lb converted for 1RM", () => {
  const today = "2026-11-10";
  const docs = { workouts: {
    [today]: { date: today, session: "Pull A", sets: { "Seated Row (Cable)": [{ w: 90, r: 8 }, { w: 90, r: 8 }], "DB Curl": [{ w: 30, r: 10 }, { w: 30, r: 10 }, { w: 30, r: 10 }] } },
    [add(today, -3)]: { date: add(today, -3), session: "Push A", sets: { "Incline DB Press": [{ w: 65, r: 10 }], "Treadmill": [{ w: 0, r: 30 }] } },
    [add(today, -10)]: { date: add(today, -10), session: "Pull B", sets: { "Seated Row (Cable)": [{ w: 90, r: 8 }] } }
  } };
  const A = SA.analyze(docs, { today, units: { "DB Curl": "lb", "Incline DB Press": "lb" } });
  const w = A.weeks[A.weeks.length - 1];
  assert.equal(w.sessions, 2);
  assert.equal(w.sets.back, 2);
  assert.equal(w.sets.biceps, 3 + 1); // 3 curls + ½ × 2 rows
  assert.equal(w.sets.rearDelts, 1);
  assert.equal(w.sets.chest, 1);
  assert.equal(w.sets.triceps, 0.5);
  assert.equal(w.freq.back, 1);
  const inc = A.lifts.find(l => l.name === "Incline DB Press");
  assert.equal(inc.unit, "lb");
  near(inc.last.e1rm, 65 * 0.45359237 * (1 + 10 / 30), 0.01);
  assert.ok(!A.lifts.some(l => /treadmill/i.test(l.name)));
});

test("lb_workouts first: warm-ups and unchecked sets dropped, merged workouts/{date} sets not double counted", () => {
  const d = "2026-11-02";
  const docs = {
    lb_workouts: [{ id: "a", start: noon(d), end: noon(d) + 3600e3, templateName: "Push A", exercises: [
      { exId: "bench-press-barbell", unit: "kg", sets: [{ t: "w", w: 40, r: "" }, { t: "n", w: 90, r: 8 }, { t: "n", w: 90, r: 7 }, { t: "n", w: 90, r: 6, done: false }] },
      { exId: "incline-bench-press-dumbbell", unit: "lb", sets: [{ t: "n", w: 65, r: 10 }] }
    ] }, { id: "live", start: noon(d), exercises: [] }],
    workouts: { [d]: { date: d, session: "Push A", sets: {
      "Bench Press (Barbell)": [{ w: 90, r: 8, unit: "kg" }, { w: 90, r: 7, unit: "kg" }],
      "Incline DB Press": [{ w: 65, r: 10, unit: "lb" }],
      "Cable Crossover": [{ w: 16.5, r: 10 }]
    } } }
  };
  const A = SA.analyze(docs, { today: d });
  const w = A.weeks[A.weeks.length - 1];
  assert.equal(w.direct.chest, 2 + 1 + 1); // bench 2 working + incline 1 + crossover 1 (quick log extra)
  const bench = A.lifts.find(l => l.name === "Bench Press (Barbell)");
  assert.equal(bench.points.length, 1);
  assert.equal(bench.points[0].sets, 2);
  assert.ok(A.lifts.find(l => l.name === "Incline DB Press"), "logger exId maps to the plan name");
  assert.equal(A.lifts.length, 3);
});

// Two sessions a week of each lift, from 2 weeks before the cut to `weeks` after.
function cutDocs({ start = "2026-10-25", weeks = 4, change = {} } = {}) {
  const lifts = { "Bench Press (Barbell)": 90, "Lat Pulldown, Wide": 80, "Hack Squat": 70, "Leg Extension": 122 };
  const docs = { workouts: {}, weights: {} };
  for (let i = -14; i <= weeks * 7; i += 3) {
    const d = add(start, i), sets = {};
    Object.entries(lifts).forEach(([n, base]) => {
      const f = i <= 0 ? 1 : 1 + (change[n] || 0) * (i / (weeks * 7));
      sets[n] = [{ w: Math.round(base * f * 2) / 2, r: 8 }, { w: Math.round(base * f * 2) / 2, r: 8 }];
    });
    docs.workouts[d] = { date: d, session: "Push A", sets };
  }
  for (let i = -3; i <= weeks * 7; i++) docs.weights[add(start, i)] = { kg: 91.9 - Math.max(0, i) * 0.1 };
  return docs;
}

test("cut check: too early before 2 weeks, then holding / dropping with body weight change", () => {
  const start = "2026-10-25";
  const early = SA.analyze(cutDocs({ weeks: 1 }), { today: add(start, 7), cutStart: start });
  assert.equal(early.cut.status, "early");

  const held = SA.analyze(cutDocs(), { today: add(start, 28), targets: { start } });
  assert.equal(held.cut.status, "good");
  assert.equal(held.cut.lifts, 4);
  assert.equal(held.cut.down, 0);
  assert.ok(held.cut.bw.pct < -2);
  assert.match(held.cut.text, /while body weight fell/);
  const b = held.lifts.find(l => l.name === "Bench Press (Barbell)");
  near(b.cut.pct, 0, 0.01);
  assert.ok(b.cut.rel.pct > 0, "same 1RM at lower body weight = stronger relative to body weight");

  const dropping = SA.analyze(cutDocs({ change: { "Bench Press (Barbell)": -0.1, "Hack Squat": -0.1, "Leg Extension": 0.05 } }), { today: add(start, 28), cutStart: start });
  assert.equal(dropping.cut.status, "down");
  assert.equal(dropping.cut.down, 2);
  assert.equal(dropping.cut.up, 1);
  assert.match(dropping.cut.text, /never changes your calories/);

  const mains = SA.analyze(cutDocs({ change: { "Bench Press (Barbell)": -0.1 } }), { today: add(start, 28), cutStart: start, mainLifts: ["Bench Press (Barbell)", "Hack Squat", "Leg Extension"] });
  assert.equal(mains.cut.lifts, 3);
  assert.equal(mains.cut.status, "mixed");
  assert.equal(mains.lifts[0].name, "Bench Press (Barbell)");
});

test("PRs, 4-week change and volume status", () => {
  const start = "2026-10-25";
  const A = SA.analyze(cutDocs({ change: { "Leg Extension": 0.1 } }), { today: add(start, 28), cutStart: start });
  const le = A.lifts.find(l => l.name === "Leg Extension");
  assert.ok(le.points.some(p => p.pr));
  assert.ok(!le.points[0].pr, "the first session is not a PR");
  assert.ok(le.change28 && le.change28.pct > 0);
  const quads = A.muscles.find(m => m.id === "quads");
  assert.ok(quads.avg4 > 0);
  assert.ok(["low", "ok", "high"].includes(quads.status));
  const chest = A.muscles.find(m => m.id === "chest");
  assert.equal(chest.status, "low"); // 2 bench sets twice-ish a week < 10
});

test("balance: push vs pull leans when past 1.5 : 1", () => {
  const today = "2026-11-10", docs = { workouts: {} };
  for (let i = 0; i < 4; i++) docs.workouts[add(today, -i * 7)] = { sets: { "Bench Press (Barbell)": Array(6).fill({ w: 90, r: 8 }), "Lat Pulldown, Wide": Array(2).fill({ w: 80, r: 8 }) } };
  const A = SA.analyze(docs, { today });
  const pp = A.balance.find(b => b.id === "pushPull");
  assert.equal(pp.lean, "a");
  near(pp.a, 4 * (6 + 6 * 0.5 + 6 * 0.5)); // chest 6 + front delts ½ × 6 + triceps ½ × 6 per week
  const ql = A.balance.find(b => b.id === "quadHam");
  assert.equal(ql.ratio, null);
});

test("unknown exercises are listed, not guessed; future days and bad data are ignored", () => {
  const today = "2026-11-10";
  const A = SA.analyze({ workouts: {
    [today]: { sets: { "Zercher Mystery Thing": [{ w: 50, r: 5 }], "Leg Extension": [{ w: "abc", r: 8 }, { w: 100, r: 0 }, null] } },
    [add(today, 1)]: { sets: { "Leg Extension": [{ w: 200, r: 10 }] } },
    "junk": { sets: 5 }
  } }, { today });
  assert.deepEqual(A.unmapped, ["Zercher Mystery Thing"]);
  const le = A.lifts.find(l => l.name === "Leg Extension");
  assert.equal(le.points.length, 1);
  assert.equal(le.points[0].sets, 1);
  assert.equal(le.points[0].e1rm, null); // weight missing → set counts, no 1RM
  assert.match(A.notes.join(" "), /Zercher/);
});

test("html and summary render, empty state has no fake numbers", () => {
  const start = "2026-10-25";
  const h = SA.html(cutDocs(), { today: add(start, 28), cutStart: start, mainLifts: ["Bench Press (Barbell)"] });
  assert.match(h, /data-sa-lift/);
  assert.match(h, /<svg class="sa-svg"/);
  assert.match(h, /Strength during the cut/);
  assert.match(h, /Push vs pull/);
  assert.doesNotMatch(h, /NaN|undefined|Infinity/);
  const empty = SA.html({}, { today: "2026-11-10" });
  assert.match(empty, /Log a workout/);
  assert.doesNotMatch(empty, /<svg/);
  const s = SA.summary(cutDocs(), { today: add(start, 28), cutStart: start });
  assert.match(s, /Strength during the cut/);
  assert.match(s, /Bench Press \(Barbell\): 114 → 114 kg/);
  assert.doesNotMatch(s, /NaN|undefined/);
});
