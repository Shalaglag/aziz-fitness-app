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
  assert.ok(Coach.chatHtml().includes("Ask Claude"));
  assert.ok(Coach.context({}, { today: "2026-11-09" }));
});

test("suggestions differ per screen and partialAnswer reads a streaming reply", () => {
  assert.ok(Coach.suggestions("train").some(s => /train today/i.test(s.q)));
  assert.ok(Coach.suggestions("food").some(s => s.topic === "protein"));
  assert.equal(Coach.suggestions("nope").length, Coach.suggestions("today").length);
  assert.equal(Coach.partialAnswer('{"answer":"Yes, add 2.5 kg.\\nYour bench'), "Yes, add 2.5 kg.\nYour bench");
  assert.equal(Coach.partialAnswer('{"answer":"Done \\"now\\"","evidence":[]}'), 'Done "now"');
  assert.equal(Coach.partialAnswer('{"evid'), "");
});

test("panelHtml renders the button, the panel and the offline/no-Claude notes", () => {
  const h = Coach.panelHtml();
  assert.ok(h.includes("co-fab") && h.includes("Ask Claude") && h.includes("data-coach-form"));
  assert.ok(!h.includes("co-open"));
  Coach._state.noClaude = true;
  assert.ok(/suggested questions still work|quick questions/.test(Coach.panelHtml()));
  Coach._state.noClaude = false;
});

test("context carries lift history, planned food, saved meals, readiness, steps and the exercise asked about", () => {
  const docs = { weights: {}, days: {}, workouts: {}, meals: {}, prefs: { main: { profile: { start: "2026-10-01", cutKcal: 2000, protein: 180 }, stepGoal: 9000 }, swaps: { hurt: { "leg-press": { name: "Leg Press", note: "knee" } } } } };
  ["2026-10-20", "2026-10-22", "2026-10-24"].forEach((d, i) => { docs.workouts[d] = { date: d, session: "Push A", effort: 3, sets: { "Bench Press (Barbell)": [{ w: 80 + i * 2.5, r: 8 }], "Lateral Raise (Cable)": [{ w: 7.5, r: 12 }] } }; });
  docs.days["2026-10-26"] = { date: "2026-10-26", steps: 8200, readiness: { quality: 4, soreness: 3, energy: 4, joints: { knee: 1 } }, food: [{ name: "Chicken rice", slot: "Lunch", kcal: 600, p: 50, c: 60, f: 12, eaten: true }, { name: "Protein shake", slot: "Snack", kcal: 200, p: 40, eaten: false }] };
  docs.meals.a = { id: "a", name: "Usual Nutreeze day", items: [{ name: "x", kcal: 500, p: 45 }, { name: "y", kcal: 700, p: 60 }], uses: 3 };
  const ctx = Coach.context(docs, { today: "2026-10-26", question: "Should I increase my bench press weight?", exercise: n => ({ name: n, cues: ["Bend the bar"], mistakes: ["Flared elbows"], primary: ["Chest"], demo: { url: "x" } }), planToday: { session: "Push A", exercises: [{ name: "Bench Press (Barbell)", w: 90, reps: 8, sets: 2, unit: "kg" }] } });
  const bench = ctx.lifts.find(l => l.name === "Bench Press (Barbell)");
  assert.equal(bench.last5.length, 3);
  assert.equal(bench.latestIsPR, true);
  assert.ok(bench.vsPrevious.startsWith("+"));
  assert.deepEqual(ctx.plannedToday, [{ name: "Protein shake", slot: "Snack", kcal: 200, p: 40 }]);
  assert.equal(ctx.eatenToday[0].name, "Chicken rice");
  assert.equal(ctx.todaySoFar.eatenCarbs, 60);
  assert.equal(ctx.savedMeals[0].kcal, 1200);
  assert.deepEqual(ctx.steps7, [["2026-10-26", 8200]]);
  assert.equal(ctx.stepGoal, 9000);
  assert.deepEqual(ctx.readiness7[0].joints, ["knee"]);
  assert.deepEqual(ctx.exercisesThatHurt, ["Leg Press (knee)"]);
  assert.equal(ctx.exerciseAsked.name, "Bench Press (Barbell)");
  assert.ok(/verified demo/.test(ctx.exerciseAsked.demoVideo));
  assert.equal(ctx.planToday.session, "Push A");
  assert.ok(Coach.prompt("q", ctx, []).includes("exercisesThatHurt"));
});

test("exerciseIn matches plan names loosely and ignores unrelated questions", () => {
  const names = ["Bench Press (Barbell)", "Incline DB Press", "Lat Pulldown, Wide", "Hack Squat", "Leg Extension"];
  assert.equal(Coach.exerciseIn("how do I do the hack squat", names), "Hack Squat");
  assert.equal(Coach.exerciseIn("Explain the lat pulldown", names), "Lat Pulldown, Wide");
  assert.equal(Coach.exerciseIn("Should I bench heavier?", names), "Bench Press (Barbell)");
  assert.equal(Coach.exerciseIn("What should I eat today?", names), null);
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

test("actions: only the fixed menu survives parsing, and nothing applies without a Confirm tap", async () => {
  const a = Coach.parseAnswer(JSON.stringify({ answer: "Try this.", actions: [
    { type: "set_calorie_target", kcal: "1850.4", why: "stalled 3 weeks" },
    { type: "delete_everything" },
    { type: "add_saved_meal" },
    { type: "swap_exercise", from: "Leg Press", to: "Hack Squat", why: "knee" },
  ] }));
  assert.deepEqual(a.actions.map(x => x.type), ["set_calorie_target", "swap_exercise"]);
  assert.equal(a.actions[0].kcal, 1850);
  assert.deepEqual(Coach.cleanActions("nope"), []);

  // Host stub records applies; the panel must show the exact change and wait for a tap.
  const applied = [];
  const host = { check: x => x.type === "swap_exercise" ? { ok: false, error: "Leg Press isn't in today's session." } : { ok: true, change: "Daily calorie target 2,000 → 1,850 kcal" },
    apply: async x => { applied.push(x.type); return { ok: true, message: "Calorie target is now 1,850 kcal." }; } };
  const listeners = {};
  const root = { addEventListener: (k, fn) => { listeners[k] = fn; } };
  Coach.bind(root, { getDocs: () => ({}), render: () => {}, actionHost: host, getSample: () => Promise.resolve({ json: async () => ({ answer: "Cut 150.", actions: [{ type: "set_calorie_target", kcal: 1850 }, { type: "swap_exercise", from: "Leg Press", to: "Hack Squat" }] }) }) });
  Coach._state.msgs = []; Coach._state.busy = false;
  listeners.submit({ preventDefault() {}, target: { matches: s => s === "[data-coach-form]", querySelector: () => ({ value: "Should I cut calories?" }) } });
  await new Promise(r => setTimeout(r, 20));
  const m = Coach._state.msgs[Coach._state.msgs.length - 1];
  assert.equal(m.actions[0].status, "proposed");
  assert.equal(m.actions[1].status, "blocked");
  assert.equal(applied.length, 0, "nothing is applied before a tap");
  const html = Coach.panelHtml();
  assert.ok(html.includes("Daily calorie target 2,000 → 1,850 kcal") && html.includes("Confirm") && html.includes("Can't do this"));
  const mi = Coach._state.msgs.length - 1;
  const tap = attrs => listeners.click({ target: { closest: () => ({ dataset: attrs, hasAttribute: k => k.replace("data-coach-", "") in attrs }) } });
  tap({ coachAct: mi + ":1" }); // blocked: ignored
  tap({ coachAct: mi + ":0" });
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(applied, ["set_calorie_target"]);
  assert.equal(m.actions[0].status, "done");
  assert.ok(Coach.panelHtml().includes("✓ Calorie target is now 1,850 kcal."));
  tap({ coachAct: mi + ":0" }); // a second tap does nothing
  await new Promise(r => setTimeout(r, 20));
  assert.equal(applied.length, 1);
  Coach._state.msgs = [];
});
