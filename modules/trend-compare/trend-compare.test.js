// Run: node --test modules/trend-compare/trend-compare.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const TC = require("./trend-compare.js");

const DAY = 864e5;
const add = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const TODAY = "2026-11-21";

function make(n = 28) {
  const docs = { weights: {}, days: {}, cardio: {}, workouts: {} };
  for (let i = 0; i < n; i++) {
    const d = add("2026-10-25", i);
    docs.weights[d] = { date: d, kg: 92 - 0.1 * i };
    docs.days[d] = { date: d, food: [{ kcal: 1500, p: 120, eaten: true }, { kcal: 500 + 10 * i, p: 40, eaten: true }, { kcal: 900, p: 50, eaten: false }], steps: 6000 + 100 * i, sleep: 7 };
    if (i % 2 === 0) docs.cardio[d] = { date: d, sessions: [{ min: 30 }, { min: 10 }] };
    if (i % 3 === 0) docs.workouts[d] = { date: d, sets: { "Flat barbell bench press": [{ w: 60, r: 8 }, { w: 65, r: 5 }], "Lat pulldown": [{ w: 50, r: 10 }] } };
  }
  return docs;
}

test("series: one entry per source, only eaten food counts, steps accept both shapes", () => {
  const docs = make(10);
  docs.days["2026-10-26"].steps = { count: 7777, at: "x", source: "manual" };
  const s = TC.series(docs, { today: TODAY });
  const by = Object.fromEntries(s.map(x => [x.key, x]));
  assert.deepEqual(Object.keys(by), ["trend", "weight", "kcal", "protein", "steps", "sleep", "cardio", "lift:flat-barbell-bench-press", "lift:lat-pulldown"]);
  assert.equal(by.kcal.points[0].v, 2000);
  assert.equal(by.protein.points[0].v, 160);
  assert.equal(by.steps.points[1].v, 7777);
  assert.equal(by.cardio.points.length, 5);
  assert.equal(by.cardio.points[0].v, 40);
  assert.equal(by.weight.points.length, 10);
  assert.equal(by.trend.points[0].v, 92);
  assert.ok(by.trend.points[1].v > 91.9 && by.trend.points[1].v < 92);
  assert.equal(by["lift:flat-barbell-bench-press"].points[0].v, 76); // Epley on the best set: 60 × 8 beats 65 × 5
  assert.equal(by["lift:flat-barbell-bench-press"].unit, "kg");
});

test("series: future dates are cut, a given trend and lifts are used as-is", () => {
  const docs = make(5);
  const s = TC.series(docs, { today: "2026-10-26", trend: [{ date: "2026-10-25", trend: 91.5 }, { date: "2026-10-30", trend: 90 }], lifts: [{ name: "Squat", key: "squat", unit: "lb", points: [{ date: "2026-10-25", e1rm: 200 }] }] });
  const by = Object.fromEntries(s.map(x => [x.key, x]));
  assert.deepEqual(by.trend.points, [{ date: "2026-10-25", v: 91.5 }]);
  assert.equal(by.weight.points.length, 2);
  assert.deepEqual(by["lift:squat"], { key: "lift:squat", label: "Est. 1RM · Squat", unit: "lb", points: [{ date: "2026-10-25", v: 200 }], lift: true });
  assert.equal(s.filter(x => x.lift).length, 1);
});

test("correlate: needs 7 shared days, then Pearson r with a plain note", () => {
  const s = TC.series(make(28), { today: TODAY });
  const by = Object.fromEntries(s.map(x => [x.key, x]));
  const c = TC.correlate(by.weight, by.steps, { today: TODAY });
  assert.equal(c.n, 28);
  assert.equal(c.r, -1); // weight falls exactly as steps rise
  assert.equal(c.strength, "strong");
  assert.equal(c.dir, "opposite");
  assert.match(c.note, /higher scale weight went with lower steps \(r = −1\.00, strong\)/);
  const few = TC.correlate(by.weight, by["lift:lat-pulldown"], { today: TODAY, range: 14 });
  assert.ok(few.n < 7);
  assert.equal(few.r, null);
  assert.match(few.note, /Only \d days? with both logged/);
  const flat = TC.correlate(by.sleep, by.steps, { today: TODAY });
  assert.equal(flat.r, null);
  assert.match(flat.note, /didn't change/);
  assert.equal(TC.correlate(by.weight, { key: "x", label: "X", unit: "", points: [] }).note, "No days where both were logged yet.");
});

test("correlate: range limits the window; independent series read as none", () => {
  const a = { key: "a", label: "A", unit: "", points: [] }, b = { key: "b", label: "B", unit: "", points: [] };
  const vals = [1, 5, 2, 4, 3, 5, 1, 4, 2, 3];
  vals.forEach((v, i) => { const d = add(TODAY, -i); a.points.unshift({ date: d, v }); b.points.unshift({ date: d, v: [3, 1, 5, 5, 1, 4, 2, 4, 3, 2][i] }); });
  assert.equal(TC.correlate(a, b, { today: TODAY, range: 5 }).n, 5);
  const c = TC.correlate(a, b, { today: TODAY });
  assert.equal(c.n, 10);
  assert.equal(c.strength, "none");
  assert.match(c.note, /moved independently/);
});

test("chart: dual axis SVG, left ticks in A's unit, right ticks in B's", () => {
  const s = TC.series(make(28), { today: TODAY });
  const by = Object.fromEntries(s.map(x => [x.key, x]));
  const svg = TC.chart(by.trend, by.steps, { today: TODAY, range: 28 });
  assert.match(svg, /^<svg viewBox="0 0 640 240"/);
  assert.match(svg, /class="tc-tick tc-tick-l">9\d\.\d</);
  assert.match(svg, /class="tc-tick tc-tick-r">[0-9,]{5,}</);
  assert.match(svg, /<polyline class="tc-a"/);
  assert.match(svg, /<polyline class="tc-b"/);
  assert.match(svg, /Oct 25<\/text>/);
  assert.match(svg, /Nov 21<\/text>/);
  assert.match(TC.chart(by.trend, by.steps, { today: "2027-01-01", range: 14 }), /Nothing logged in this range/);
});

test("html: card with two pickers and a range, defaults trend vs steps, lifts in an optgroup", () => {
  const h = TC.html(make(28), { today: TODAY });
  assert.match(h, /<section class="card tc-card">/);
  assert.match(h, /<select data-tc="a"[^>]*><option value="trend" selected>/);
  assert.match(h, /<select data-tc="b"[^>]*>.*<option value="steps" selected>/);
  assert.match(h, /<option value="28" selected>Last 28 days/);
  assert.match(h, /<optgroup label="Lifts \(est\. 1RM\)">/);
  assert.match(h, /class="tc-note tc-strong"/);
  assert.match(h, /Trend weight <b class="tc-mono">\d+\.\d kg · Nov 21/);
});

test("html: explicit picks win and an unlogged series is disabled; summary is one line", () => {
  const docs = make(10);
  delete docs.cardio; delete docs.workouts;
  const h = TC.html(docs, { today: TODAY, a: "kcal", b: "trend", range: 0 });
  assert.match(h, /<option value="kcal" selected>/);
  assert.match(h, /<option value="cardio" disabled>Cardio minutes \(nothing logged\)/);
  assert.match(h, /<option value="0" selected>All time/);
  assert.doesNotMatch(h, /optgroup/);
  const sum = TC.summary(docs, { today: TODAY, a: "kcal", b: "trend", range: 0 });
  assert.match(sum, /^Compare: Calories eaten vs Trend weight \(all time\)\. Over 10 shared days/);
  assert.match(TC.html({}, { today: TODAY }), /Log weigh-ins plus one more thing/);
});
