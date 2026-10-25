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
  const ctx = Coach.context(make({ kcal: i => (i % 3 === 0 ? null : 2000) }), opts("2026-11-09"));
  assert.ok(ctx.food14.some(d => d.logged === false));
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

test("prompt carries the no-invention rules and the data", () => {
  const ctx = Coach.context(make(), opts("2026-11-09"));
  const p = Coach.prompt("Why is my weight stuck?", ctx, [{ q: "hi", a: "hello" }]);
  assert.match(p, /Never invent numbers/);
  assert.match(p, /cannot change targets/);
  assert.match(p, /"kcal":2000/);
  assert.match(p, /Why is my weight stuck\?/);
  assert.equal(ctx.weight.avg7.weighIns, 7);
});

test("parseAnswer cleans Claude's reply", () => {
  assert.equal(Coach.parseAnswer('{"answer":"Keep going.","evidence":["a","",3],"suggestion":{"title":"Walk"}}').evidence.length, 2);
  assert.equal(Coach.parseAnswer({ answer: "x", suggestion: { title: "" } }).suggestion, null);
  assert.ok(Coach.parseAnswer(null).error);
  assert.equal(Coach.parseAnswer("plain text").answer, "plain text");
});

test("quick answers work without Claude and cite the logs", () => {
  const docs = make({ p: () => 140 });
  const a = Coach.localAnswer("protein", docs, opts("2026-11-09"));
  assert.match(a.answer, /20 g under/);
  assert.ok(a.local);
  const l = Coach.localAnswer("lifts", docs, opts("2026-11-09"));
  assert.ok(l.evidence.length >= 1);
  const t = Coach.localAnswer("today", docs, opts("2026-11-09"));
  assert.match(t.answer, /kcal and \d+ g protein left today/);
  const pl = Coach.localAnswer("plateau", make({ kgWk: 0 }), opts("2026-11-23"));
  assert.match(pl.answer, /Likely reasons/);
});

test("empty data does not throw", () => {
  const R = Coach.review({}, { today: "2026-11-09" });
  assert.equal(R.verdict, "empty");
  assert.ok(Coach.reviewHtml({}, { today: "2026-11-09" }).includes("14-day review"));
  assert.ok(Coach.chatHtml().includes("Ask your coach"));
  assert.ok(Coach.context({}, { today: "2026-11-09" }));
});
