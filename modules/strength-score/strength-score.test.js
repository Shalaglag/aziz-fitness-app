// Run: node --test modules/strength-score/strength-score.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const SS = require("./strength-score.js");
const SA = require("../strength-analytics/strength-analytics.js");

const near = (a, b, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, a + " ≈ " + b);
const DAY = 864e5;
const add = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const TODAY = "2026-11-20";
const lift = (name, e1rmKg, date = TODAY, muscles) => ({ name, points: [{ date, e1rm: e1rmKg }], muscles: muscles || SA.musclesFor(name) });

test("patternFor maps the plan's lifts, Strong names and machines to a standard", () => {
  const id = n => (SS.patternFor(n) || {}).id;
  assert.equal(id("Incline DB Press"), "benchDB");
  assert.equal(id("Bench Press (Barbell)"), "benchBB");
  assert.equal(id("Gundam (Chest Machine)"), "chestMach");
  assert.equal(id("Cable Crossover"), "flyCable");
  assert.equal(id("Seated DB Overhead Press"), "ohpDB");
  assert.equal(id("Standing Side Delts (Machine)"), "lateral");
  assert.equal(id("Upright Row (Barbell)"), "lateral");
  assert.equal(id("Lat Pulldown, Wide"), "pulldown");
  assert.equal(id("Seated Row (Cable)"), "rowCable");
  assert.equal(id("T-Bar Row"), "rowBB");
  assert.equal(id("Reverse Fly (Machine)"), "rearDelt");
  assert.equal(id("DB Curl"), "curlDB");
  assert.equal(id("Cable Standing Biceps"), "curlCable");
  assert.equal(id("Triceps Rope"), "tricepsCable");
  assert.equal(id("Hack Squat"), "hackSquat");
  assert.equal(id("Leg Extension"), "legExt");
  assert.equal(id("Lying Leg Curl"), "legCurl");
  assert.equal(id("Calf Press on Seated Leg Press"), "calf");
  assert.equal(id("Glute Kickback (Cable)"), "hipThrust");
  assert.equal(id("Romanian Deadlift (Barbell)"), "rdl");
  assert.equal(id("Walking Lunge (Dumbbell)"), "lunge");
  assert.equal(id("Pull Up"), "pullup");
  assert.equal(SS.patternFor("Treadmill (Incline Walk)"), null);
  assert.equal(SS.patternFor("Seated Abs"), null);
  assert.equal(SS.patternFor("Hip Abductor"), null);
  assert.equal(SS.patternFor("Zercher Mystery Thing"), null);
  assert.equal(SS.patternFor("Zercher Mystery Thing", { "Zercher Mystery Thing": "squatBB" }).id, "squatBB");
});

test("scoreOf: breakpoints land on 20/40/60/80/100, straight lines between, capped at 100", () => {
  const r = [0.5, 0.75, 1.0, 1.25, 1.5];
  assert.equal(SS.scoreOf(0.5, r), 20);
  assert.equal(SS.scoreOf(1.0, r), 60);
  assert.equal(SS.scoreOf(1.5, r), 100);
  assert.equal(SS.scoreOf(2.0, r), 100);
  near(SS.scoreOf(0.875, r), 50, 0.01);
  near(SS.scoreOf(0.25, r), 10, 0.01);
  assert.equal(SS.scoreOf(0, r), null);
  assert.equal(SS.levelOf(59.9), "Novice");
  assert.equal(SS.levelOf(60), "Intermediate");
  assert.equal(SS.levelOf(100), "Elite");
  assert.equal(SS.levelOf(5), "Starting");
});

test("compute: ratio uses body weight, per-hand dumbbell loads, body-weight moves add the load", () => {
  const A = SS.compute([lift("Bench Press (Barbell)", 90), lift("Pull Up", 27)], { today: TODAY, bodyKg: 90 });
  const bench = A.lifts.find(l => l.name.startsWith("Bench"));
  near(bench.ratio, 1.0, 0.001); assert.equal(bench.score, 60); assert.equal(bench.level, "Intermediate");
  const pu = A.lifts.find(l => l.name === "Pull Up");
  near(pu.ratio, 1.3, 0.001); assert.equal(pu.score, 60);
});

test("compute: muscles and groups aggregate, overall is the mean of the groups that have data", () => {
  const A = SS.compute([
    lift("Bench Press (Barbell)", 90),        // chest 60 (triceps/front delts as helpers)
    lift("T-Bar Row", 90),                     // back 60
    lift("Hack Squat", 135)                    // quads 60, machine
  ], { today: TODAY, bodyKg: 90 });
  near(A.groups.push.score, 60); near(A.groups.pull.score, 60); near(A.groups.legs.score, 60);
  near(A.overall, 60); assert.equal(A.level, "Intermediate");
  assert.equal(A.flags.length, 0);
  assert.ok(A.notes.some(n => /within 15 points/.test(n)));
  assert.ok(A.notes.some(n => /Machine loads/.test(n)));
  const quads = A.muscles.find(m => m.id === "quads"); assert.ok(quads); near(quads.score, 60);
});

test("compute: a missing group is left out of the overall and said in a note", () => {
  const A = SS.compute([lift("Bench Press (Barbell)", 90), lift("T-Bar Row", 90)], { today: TODAY, bodyKg: 90 });
  near(A.overall, 60);
  assert.equal(A.groups.legs.score, null);
  assert.ok(A.notes.some(n => /No legs lifts/.test(n)));
  assert.equal(A.regions.lower, null);
});

test("compute: push/pull, upper/lower and quad/hamstring gaps of 15+ points are flagged with advice", () => {
  const A = SS.compute([
    lift("Bench Press (Barbell)", 112.5),      // chest 80
    lift("T-Bar Row", 67.5),                   // back 40
    lift("Hack Squat", 180),                   // quads 80
    lift("Lying Leg Curl", 45)                 // hams 40
  ], { today: TODAY, bodyKg: 90 });
  const ids = A.flags.map(f => f.id);
  assert.ok(ids.includes("push-pull"), ids.join());
  assert.ok(ids.includes("quads-hams"), ids.join());
  assert.ok(ids.includes("chest-back"), ids.join());
  assert.ok(!ids.includes("upper-lower"), ids.join());
  const pp = A.flags.find(f => f.id === "push-pull");
  assert.equal(pp.lag, "Pull"); assert.equal(pp.lead, "Push");
  assert.match(pp.text, /Pull lags push by \d+ points/);
  assert.match(pp.advice, /pull/);
  assert.deepEqual(A.flagged.sort(), ["Chest", "Back", "Push", "Pull", "Quads", "Hamstrings"].sort());
});

test("compute: upper/lower gap flags when legs trail both upper groups", () => {
  const A = SS.compute([lift("Bench Press (Barbell)", 90), lift("T-Bar Row", 90), lift("Hack Squat", 90)], { today: TODAY, bodyKg: 90 });
  const f = A.flags.find(x => x.id === "upper-lower");
  assert.ok(f); assert.equal(f.lag, "Lower body");
});

test("compute: stale lifts, unknown lifts and no-body-weight cases are handled, never guessed", () => {
  const A = SS.compute([lift("Bench Press (Barbell)", 90, add(TODAY, -61)), lift("Zercher Mystery Thing", 50), lift("Treadmill (Incline Walk)", null)], { today: TODAY, bodyKg: 90 });
  assert.equal(A.overall, null);
  assert.deepEqual(A.skipped.map(s => s.name).sort(), ["Bench Press (Barbell)", "Zercher Mystery Thing"]);
  assert.match(A.skipped.find(s => s.name.startsWith("Bench")).why, /61 days/);
  const B = SS.compute([lift("Bench Press (Barbell)", 90)], { today: TODAY });
  assert.equal(B.overall, null); assert.match(B.notes[0], /weigh-in/);
  // asOf picks the latest session at or before the date
  const C = SS.compute([{ name: "Bench Press (Barbell)", points: [{ date: add(TODAY, -30), e1rm: 90 }, { date: TODAY, e1rm: 112.5 }], muscles: SA.musclesFor("Bench Press (Barbell)") }], { today: TODAY, asOf: add(TODAY, -28), bodyKg: 90 });
  assert.equal(C.lifts[0].score, 60);
});

test("compute: female standards scale the ratios, opts.standards overrides one pattern", () => {
  const m = SS.compute([lift("Bench Press (Barbell)", 58.5)], { today: TODAY, bodyKg: 90, sex: "male" });
  const f = SS.compute([lift("Bench Press (Barbell)", 58.5)], { today: TODAY, bodyKg: 90, sex: "female" });
  assert.equal(m.lifts[0].score, 20 + 20 * (0.65 - 0.5) / 0.25);
  near(f.lifts[0].score, 60, 0.01);
  assert.ok(!f.notes.some(n => /assume male/.test(n)));
  assert.ok(m.notes.every(n => !/assume male/.test(n)), "an explicit sex does not get the note");
  const o = SS.compute([lift("Bench Press (Barbell)", 90)], { today: TODAY, bodyKg: 90, standards: { benchBB: { ...SS.STANDARDS.benchBB, ratios: [0.25, 0.5, 0.75, 1.0, 1.25] } } });
  assert.equal(o.lifts[0].score, 80);
});

// Docs path through StrengthAnalytics: Quick-log sets in workouts/{date} plus weigh-ins.
function docs() {
  const workouts = {}, weights = {};
  const put = (date, name, w, r, n = 3) => { const d = (workouts[date] = workouts[date] || { date, sets: {} }); d.sets[name] = Array.from({ length: n }, () => ({ w, r, unit: "kg" })); };
  for (let w = 0; w < 6; w++) {
    const d = add(TODAY, -7 * w);
    put(d, "Bench Press (Barbell)", 80 - w * 2.5, 5);
    put(add(d, -1), "T-Bar Row", 70 - w * 2.5, 8);
    put(add(d, -2), "Hack Squat", 120 - w * 5, 8);
    weights[d] = { date: d, kg: 90 + w * 0.5 };
  }
  return { workouts, weights };
}

test("fromDocs: lifts via StrengthAnalytics, latest weigh-in, 28-day change", () => {
  const A = SS.fromDocs(docs(), { today: TODAY, analytics: SA });
  assert.equal(A.bodyKg, 90); assert.equal(A.bodyDate, TODAY);
  assert.equal(A.lifts.length, 3);
  assert.ok(A.overall > 0 && A.overall < 100);
  assert.ok(A.change28 > 0, "stronger than 28 days ago: " + A.change28);
  const B = SS.fromDocs({ weights: { [TODAY]: { kg: 90 } } }, { today: TODAY, analytics: SA });
  assert.equal(B.overall, null); assert.equal(B.lifts.length, 0);
  const C = SS.fromDocs({}, { today: TODAY, analytics: SA });
  assert.match(C.notes[0], /weigh-in/);
});

test("html and summary render the score, groups and flags; empty states are plain", () => {
  const h = SS.html(docs(), { today: TODAY, analytics: SA });
  assert.match(h, /class="card ss-card"/);
  assert.match(h, /Strength score/);
  assert.match(h, /Push · /); assert.match(h, /Legs · /);
  assert.match(h, /Per lift \(3\)/);
  const s = SS.summary(docs(), { today: TODAY, analytics: SA });
  assert.match(s, /^Strength score \d+\/100 \(/);
  assert.match(s, /Push \d+, pull \d+, legs \d+\./);
  const e = SS.html({}, { today: TODAY, analytics: SA });
  assert.match(e, /weigh-in/);
  const x = SS.html({ weights: { [TODAY]: { kg: 90 } } }, { today: TODAY, analytics: SA });
  assert.match(x, /No scorable lifts/);
  assert.ok(typeof SS.css === "string" && SS.css.includes(".ss-card"));
});
