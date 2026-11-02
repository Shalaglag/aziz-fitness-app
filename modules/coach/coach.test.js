// Run: node --test modules/coach/coach.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Coach = require("./coach.js");

const DAY = 864e5;
const add = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const START = "2026-10-25";
const TARGETS = { kcal: 2000, kcalLo: 1850, kcalHi: 2150, proteinMin: 160, proteinMax: 170, start: START };
const noise = i => [0.3, -0.2, 0.1, -0.3, 0.2, 0, -0.1][i % 7];

// days: number of days from START; kgWk: weight change per week; kcal(i), p(i): eaten per day (null = unlogged)
function make({ days = 28, startKg = 92, kgWk = -0.7, kcal = () => 2000, p = () => 165, lifts = i => 100, workEvery = 2 } = {}) {
  const docs = { weights: {}, days: {}, workouts: {}, prefs: { main: {} } };
  for (let i = 0; i < days; i++) {
    const d = add(START, i);
    docs.weights[d] = { date: d, kg: +(startKg + kgWk * i / 7 + noise(i)).toFixed(1) };
    const k = kcal(i);
    if (k != null) docs.days[d] = { date: d, food: [{ name: "Meal", kcal: k, p: p(i), eaten: true }, { name: "Planned snack", kcal: 400, p: 30, eaten: false }] };
    if (i % workEvery === 0) docs.workouts[d] = { date: d, session: "Push A", sets: { "Bench Press": [{ w: lifts(i), r: 8 }, { w: lifts(i), r: 8 }], "Squat": [{ w: lifts(i) + 20, r: 6 }] } };
  }
  return docs;
}
const opts = (today, extra) => Object.assign({ today, targets: TARGETS }, extra);

test("on-track pace keeps calories and suggests no change", () => {
  const R = Coach.review(make(), opts("2026-11-09"));
  assert.equal(R.period.from, START);
  assert.equal(R.period.to, "2026-11-07");
  assert.equal(R.verdict, "on-track");
  assert.ok(R.recs.every(r => !r.change));
  assert.equal(R.checks.find(c => c.key === "kcal").status, "good");
});

test("too fast in the first two weeks is read as water, no change offered", () => {
  const R = Coach.review(make({ kgWk: -1.6 }), opts("2026-11-09"));
  assert.equal(R.verdict, "too-fast");
  assert.equal(R.recs[0].id, "water");
  assert.equal(R.recs[0].change, null);
});

test("too fast after the first weeks suggests +150 kcal, as a suggestion only", () => {
  const R = Coach.review(make({ kgWk: -1.6 }), opts("2026-11-23"));
  assert.equal(R.period.from, "2026-11-08");
  assert.equal(R.verdict, "too-fast");
  assert.deepEqual(R.recs[0].change, { key: "profile.cutKcal", from: 2000, to: 2150 });
});

test("stalled with good adherence suggests a small cut, never below the floor", () => {
  const docs = make({ kgWk: 0 });
  let R = Coach.review(docs, opts("2026-11-23"));
  assert.equal(R.verdict, "stalled");
  assert.equal(R.recs[0].change.to, 1850);
  R = Coach.review(docs, opts("2026-11-23", { rules: { floor: 1900 } }));
  assert.equal(R.recs[0].change.to, 1900);
  R = Coach.review(docs, opts("2026-11-23", { rules: { floor: 2000 } }));
  assert.equal(R.recs[0].id, "steps");
  assert.equal(R.recs[0].change, null);
});

test("a stall with poor adherence asks for adherence first, not a cut", () => {
  const R = Coach.review(make({ kgWk: 0, kcal: i => (i % 2 ? 2600 : 2000) }), opts("2026-11-23"));
  assert.equal(R.verdict, "adherence");
  assert.ok(R.recs.every(r => !r.change));
});

test("in-progress period says what is still needed", () => {
  const R = Coach.review(make({ days: 5 }), opts("2026-10-30"));
  assert.equal(R.period.partial, true);
  assert.equal(R.verdict, "not-enough-data");
  assert.ok(R.missing.length >= 1);
  assert.match(R.headline, /day 5 of 14/);
});

test("no targets anywhere: nothing invented, no change suggested", () => {
  const docs = make({ kgWk: 0 });
  const R = Coach.review(docs, { today: "2026-11-23" });
  assert.equal(R.targets.kcal, null);
  assert.equal(R.checks.find(c => c.key === "kcal").status, "none");
  assert.ok(R.recs.every(r => !r.change));
  assert.doesNotMatch(Coach.summary(R), /within ±|g\+/);
});

test("profile numbers are used when no targets object is passed", () => {
  const docs = make();
  docs.prefs.main.profile = { cutKcal: 2200, protein: 150, start: START };
  const T = Coach.targets(docs, {});
  assert.equal(T.kcal, 2200); assert.equal(T.proteinMin, 150); assert.equal(T.start, START);
});

test("only eaten food counts, planned items are ignored", () => {
  const R = Coach.review(make(), opts("2026-11-09"));
  assert.equal(Math.round(R.numbers.kcalAvg), 2000);
  assert.equal(Math.round(R.numbers.proteinAvg), 165);
});

test("unlogged days are not treated as zero", () => {
  const R = Coach.review(make({ kcal: i => (i % 3 === 0 ? null : 2000) }), opts("2026-11-09"));
  assert.equal(Math.round(R.numbers.kcalAvg), 2000);
  assert.ok(R.numbers.unlogged.length >= 4);
});

test("full logger wins over quick log, converts lb to kg and skips warm-ups", () => {
  const docs = make({ days: 14 });
  docs.workouts = {};
  const start = d => new Date(d + "T12:00:00").getTime();
  const lbw = (id, d, w) => ({ id, name: "Push A", start: start(d), exercises: [{ exId: "bench", unit: "lb", sets: [{ t: "w", w: 300, r: 10 }, { t: "n", w, r: 5 }] }] });
  docs.lb_workouts = { a: lbw("a", "2026-10-26", 200), b: lbw("b", "2026-11-04", 220) };
  docs.lb_exercises = { bench: { id: "bench", name: "Bench Press (Barbell)" } };
  docs.workouts["2026-10-26"] = { date: "2026-10-26", session: "Push A", effort: 8, sets: { "Bench Press": [{ w: 500, r: 5 }] } };
  docs.workouts["2026-11-04"] = { date: "2026-11-04", session: "Push A", effort: 7, sets: { "Bench Press": [{ w: 500, r: 5 }] } };
  const R = Coach.review(docs, opts("2026-11-09"));
  assert.equal(R.numbers.sessions, 2);
  assert.equal(R.numbers.sets, 2);
  assert.equal(R.numbers.effortAvg, 7.5);
  const l = R.numbers.lifts.find(x => x.name === "Bench Press (Barbell)");
  assert.ok(l, "named from lb_exercises");
  assert.equal(l.before.w, 90.7); // 200 lb
  assert.equal(l.status, "up");
});

test("strength dropping across lifts adds a protect-strength tip", () => {
  const R = Coach.review(make({ lifts: i => (i < 7 ? 100 : 90) }), opts("2026-11-09"));
  assert.ok(R.recs.some(r => r.id === "strength"));
  assert.equal(R.checks.find(c => c.key === "strength").status, "bad");
});

test("a diet break in the period is called out instead of judging pace", () => {
  const docs = make({ kgWk: 0 });
  docs.prefs.main.dietBreak = { breaks: [{ start: "2026-11-10", end: "2026-11-20" }] };
  const R = Coach.review(docs, opts("2026-11-23"));
  assert.equal(R.verdict, "diet-break");
});

test("effort nudge from EffortDeload becomes a tip with its own text", () => {
  const R = Coach.review(make(), opts("2026-11-09", { effort: { nudge: true, text: "Effort up 1.5 points while 3 of 4 lifts stalled." } }));
  const t = R.recs.find(r => r.id === "deload");
  assert.ok(t); assert.match(t.evidence[0], /Effort up/);
});

test("review card shows a Use button only when the host can apply", () => {
  const docs = make({ kgWk: 0 });
  assert.doesNotMatch(Coach.reviewHtml(docs, opts("2026-11-23")), /data-coach-apply/);
  assert.match(Coach.reviewHtml(docs, opts("2026-11-23", { onApply: () => {} })), /data-coach-apply/);
});

test("period navigation can show the first block", () => {
  const html = Coach.reviewHtml(make(), opts("2026-11-23", { from: START }));
  assert.match(html, /Oct 25 – Nov 7/);
  assert.equal(Coach.periods(make(), opts("2026-11-23")).length, 3);
});

test("empty data does not throw", () => {
  const R = Coach.review({}, { today: "2026-11-09" });
  assert.equal(R.verdict, "empty");
  assert.ok(Coach.reviewHtml({}, { today: "2026-11-09" }).includes("14-day review"));
});

test("insights: PRs, falling strength, protein, fatigue, weekday overage, rest-vs-train protein; seen ids hide", () => {
  const docs = { weights: {}, days: {}, workouts: {}, prefs: { main: { profile: { start: "2026-09-01", cutKcal: 2000, protein: 180 } } } };
  const d = n => { const t = new Date(Date.UTC(2026, 9, 26)); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10); };
  // Lifts: Squat improving to a PR, two lifts falling three sessions in a row, effort high.
  [6, 4, 2].forEach((n, i) => { docs.workouts[d(n)] = { date: d(n), session: "Lower A", effort: 4, sets: { "Hack Squat": [{ w: 100 + i * 5, r: 8 }], "Leg Extension": [{ w: 120 - i * 10, r: 8 }], "Lying Leg Curl": [{ w: 60 - i * 5, r: 8 }] } }; });
  docs.workouts[d(8)] = { date: d(8), session: "Push A", effort: 5, sets: { "Bench Press (Barbell)": [{ w: 80, r: 8 }] } };
  // Food: 28 days logged; Fridays (d(n) where weekday 5) over by 400; rest days low protein.
  for (let n = 1; n <= 28; n++) { const dt = d(n), wd = new Date(dt + "T00:00:00Z").getUTCDay(), train = !!docs.workouts[dt]; docs.days[dt] = { date: dt, food: [{ name: "Day", slot: "Lunch", kcal: wd === 5 ? 2400 : 1950, p: train ? 190 : 140, eaten: true }] }; }
  const ins = Coach.insights(docs, { today: "2026-10-26", limit: 10 });
  const ids = ins.map(i => i.id);
  assert.ok(ids.some(i => i.startsWith("pr-")), "pr");
  assert.ok(ids.includes("strength-down"), "strength-down");
  assert.ok(ids.some(i => i.startsWith("protein-week-")), "protein");
  assert.ok(ids.some(i => i.startsWith("fatigue-")), "fatigue");
  assert.ok(ids.includes("weekday-over-5"), "friday");
  assert.ok(ids.includes("protein-rest-vs-train"), "rest vs train");
  ins.forEach(i => assert.ok(i.title && i.text && ["good", "warn", "info"].includes(i.kind)));
  const few = Coach.insights(docs, { today: "2026-10-26" });
  assert.equal(few.length, 3);
  assert.equal(few[0].kind, "warn");
  const seen = Object.fromEntries(ids.map(i => [i, "2026-10-24"]));
  assert.equal(Coach.insights(docs, { today: "2026-10-26", seen }).length, 0);
  assert.ok(Coach.insights(docs, { today: "2026-10-26", seen: { "strength-down": "2026-10-10" }, limit: 10 }).some(i => i.id === "strength-down"));
  assert.ok(Coach.insightsHtml(docs, { today: "2026-10-26" }).includes("Patterns in your logs"));
  assert.equal(Coach.insights({}, { today: "2026-10-26" }).length, 0);
  assert.equal(Coach.insightsHtml({}, { today: "2026-10-26" }), "");
});

test("the AI coach is gone: no chat, no Claude, no actions; the cards still wire period, apply and dismiss", () => {
  ["chatHtml", "panelHtml", "mountPanel", "context", "prompt", "parseAnswer", "localAnswer", "ACTIONS", "cleanActions", "suggestions"].forEach(k => assert.equal(Coach[k], undefined, k));
  assert.doesNotMatch(Coach.css, /co-fab|co-panel/);
  const docs = make({ kgWk: 0 });
  const html = Coach.reviewHtml(docs, opts("2026-11-23")) + Coach.insightsHtml(docs, opts("2026-11-23", { limit: 10 }));
  assert.doesNotMatch(html, /Claude|data-coach-ask|data-coach-open/);
  const listeners = {}, applied = [], dismissed = [];
  let renders = 0;
  Coach.bind({ addEventListener: (k, fn) => { listeners[k] = fn; } }, { getDocs: () => docs, render: () => { renders++; }, onApply: ch => applied.push(ch.to), onDismiss: id => dismissed.push(id) });
  assert.deepEqual(Object.keys(listeners), ["click"]);
  const tap = attrs => listeners.click({ target: { closest: () => ({ dataset: attrs, closest: () => null }) } });
  tap({ coachPeriod: START }); assert.equal(renders, 1); assert.equal(Coach._state.from, START);
  tap({ coachApply: JSON.stringify({ key: "profile.cutKcal", from: 2000, to: 1850 }) }); assert.deepEqual(applied, [1850]);
  tap({ coachDismiss: "strength-down" }); assert.deepEqual(dismissed, ["strength-down"]);
  Coach._state.from = null;
  Coach.bind({ addEventListener() {} }, { onApply: undefined }); // later tests expect no apply host
});

// --- Goal plan (prefs/main.goalSetup) steers the review ---
const G = require("../goal-setup/goal-setup.js");
const planOf = (goal, extra) => { const a = Object.assign({ sex: "male", age: 29, heightCm: 172, kg: 92, activity: "moderate", goal }, extra); return { answers: a, result: G.compute(a, { today: START }), at: START }; };

test("gain plan: the pace band follows the chosen pace, and gaining too fast past week two suggests fewer calories (confirm only)", () => {
  const plan = planOf("bulk", { pace: "lean", targetKg: 100 });
  const T = Coach.targets(make(), { targets: TARGETS, plan });
  assert.equal(T.plan.direction, 1); assert.ok(T.paceLo < T.paceHi && T.paceHi <= 0.5, JSON.stringify([T.paceLo, T.paceHi]));
  const R = Coach.review(make({ kgWk: 0.6 }), opts("2026-11-23", { plan }));
  assert.equal(R.verdict, "too-fast");
  assert.match(R.headline, /^Gaining faster/);
  assert.equal(R.recs[0].id, "trim"); assert.deepEqual(R.recs[0].change, { key: "profile.cutKcal", from: 2000, to: 1850 });
  assert.match(R.basis, /your plan \(gain weight, 0\.3 % of body weight a week, lean, moderate\), 2,000 kcal and 14 days of logs: \d+ weigh-ins/);
  const ok = Coach.review(make({ kgWk: 0.25 }), opts("2026-11-23", { plan }));
  assert.equal(ok.verdict, "on-track"); assert.match(ok.headline, /gain is on plan/); assert.ok(ok.recs.every(r => !r.change));
  const stuck = Coach.review(make({ kgWk: 0 }), opts("2026-11-23", { plan }));
  assert.equal(stuck.verdict, "stalled"); assert.equal(stuck.recs[0].change.to, 2150, "a stalled gain suggests more, not less");
});

test("maintain plan: steady is on-track; a drift with on-target eating offers a small nudge, never a silent change", () => {
  const plan = planOf("maintain", {});
  const steady = Coach.review(make({ kgWk: 0.1 }), opts("2026-11-23", { plan }));
  assert.equal(steady.verdict, "on-track"); assert.match(steady.headline, /steady/);
  const R = Coach.review(make({ kgWk: -0.6 }), opts("2026-11-23", { plan }));
  assert.equal(R.verdict, "drift"); assert.match(R.headline, /drifting down on a maintenance plan/);
  assert.equal(R.recs[0].id, "nudge"); assert.deepEqual(R.recs[0].change, { key: "profile.cutKcal", from: 2000, to: 2100 });
  assert.doesNotMatch(Coach.reviewHtml(make({ kgWk: -0.6 }), opts("2026-11-23", { plan })), /Use 2,100/, "no apply button without onApply");
  const uneven = Coach.review(make({ kgWk: -0.6, kcal: i => (i % 3 ? 2600 : 2000) }), opts("2026-11-23", { plan }));
  assert.equal(uneven.verdict, "adherence"); assert.ok(uneven.recs.every(r => !r.change));
});

test("the basis line and the plan reach the card; without a plan the review still runs", () => {
  const plan = planOf("cut", { pace: "regular", targetKg: 80 });
  const h = Coach.reviewHtml(make(), opts("2026-11-23", { plan }));
  assert.match(h, /co-src">Based on your plan \(lose fat, 0\.5 % of body weight a week, regular, moderate\)/);
  const none = Coach.review(make(), opts("2026-11-23"));
  assert.equal(none.verdict, "on-track"); assert.match(none.basis, /^Based on your targets, 2,000 kcal/);
  const skipped = Coach.review(make(), opts("2026-11-23", { plan: { skipped: true } }));
  assert.equal(skipped.verdict, "on-track");
});
