// Run: node --test modules/effort-deload/
const test = require("node:test");
const assert = require("node:assert/strict");
const { EffortDeload: E } = require("./effort-deload.js");

const TODAY = "2026-12-20";
const DAY = 864e5;
const back = n => new Date(Date.parse(TODAY + "T00:00:00Z") - n * DAY).toISOString().slice(0, 10);

// One workout `n` days before TODAY with bench + row at the given weights.
const wk = (n, effort, bench = 90, row = 95, extra = {}) => ({
  date: back(n), session: "Push A", effort,
  sets: { "Bench Press (Barbell)": [{ w: bench, r: 8 }], "Seated Row (Cable)": [{ w: row, r: 8 }] },
  ...extra,
});

// Older history (weeks 3-5 back) that sets the lifts' "before" bests.
const history = [wk(35, 6), wk(28, 6), wk(24, 6)];

function asDocs(list) { const o = {}; list.forEach(w => { o[w.date] = w; }); return o; }

test("clean clamps and rounds", () => {
  assert.equal(E.clean(7), 7);
  assert.equal(E.clean("8"), 8);
  assert.equal(E.clean(11), 10);
  assert.equal(E.clean(0), 1);
  assert.equal(E.clean(6.6), 7);
  assert.equal(E.clean(""), null);
  assert.equal(E.clean(undefined), null);
});

test("withEffort sets and clears without touching sets", () => {
  const doc = wk(0, undefined);
  delete doc.effort;
  const rated = E.withEffort(doc, 9);
  assert.equal(rated.effort, 9);
  assert.deepEqual(rated.sets, doc.sets);
  assert.equal("effort" in doc, false);
  assert.equal("effort" in E.withEffort(rated, null), false);
});

test("nudges when effort rises and lifts stall for 2 weeks", () => {
  const ws = [...history, wk(18, 6), wk(16, 6), wk(12, 7), wk(9, 7), wk(5, 8), wk(2, 8)];
  const r = E.analyze(asDocs(ws), { today: TODAY });
  assert.equal(r.reason, "deload");
  assert.equal(r.nudge, true);
  assert.match(r.text, /lighter week/);
  assert.equal(r.lifts.length, 2);
  assert.match(E.nudgeHtml(r), /data-deload="start"/);
});

test("no nudge while lifts are still going up", () => {
  const ws = [...history, wk(18, 6), wk(16, 6), wk(12, 7), wk(9, 7), wk(5, 8, 95, 100), wk(2, 8)];
  const r = E.analyze(ws, { today: TODAY });
  assert.equal(r.reason, "still-progressing");
  assert.equal(E.nudgeHtml(r), "");
});

test("no nudge when effort is flat", () => {
  const ws = [...history, wk(18, 7), wk(16, 7), wk(12, 7), wk(9, 7), wk(5, 7), wk(2, 7)];
  assert.equal(E.analyze(ws, { today: TODAY }).reason, "effort-ok");
});

test("high effort plateau counts as rising", () => {
  const ws = [...history, wk(18, 9), wk(12, 9), wk(9, 9), wk(5, 9), wk(2, 9)];
  assert.equal(E.analyze(ws, { today: TODAY }).nudge, true);
});

test("needs enough rated sessions", () => {
  const ws = [...history, wk(18, 6), wk(12, 7), wk(5, 8), wk(2, 8)];
  assert.equal(E.analyze(ws, { today: TODAY }).reason, "not-enough-ratings");
});

test("rest days and unrated sessions are ignored for effort", () => {
  const ws = [...history, wk(18, 6), wk(12, 7), wk(9, 7), wk(5, 8), wk(2, 8),
    { date: back(3), session: "Rest", effort: 1 }, wk(4, undefined)];
  assert.equal(E.analyze(ws, { today: TODAY }).reason, "deload");
});

test("recent deload or a dismissal suppresses the nudge", () => {
  const base = [...history, wk(18, 6), wk(16, 6), wk(12, 7), wk(9, 7), wk(5, 8), wk(2, 8)];
  assert.equal(E.analyze([...base, wk(19, 4, 80, 85, { deload: true })], { today: TODAY }).reason, "recent-deload");
  assert.equal(E.analyze(base, { today: TODAY, dismissedAt: back(3) }).reason, "dismissed");
  assert.equal(E.analyze(base, { today: TODAY, dismissedAt: back(20) }).reason, "deload");
});

test("future-dated workouts are ignored", () => {
  const ws = [...history, wk(18, 6), wk(16, 6), wk(12, 7), wk(9, 7), wk(5, 8), wk(2, 8), wk(-3, 3, 120, 120)];
  assert.equal(E.analyze(ws, { today: TODAY }).reason, "deload");
});

test("picker marks the current rating and escapes the date", () => {
  const html = E.pickerHtml("2026-10-25", 7);
  assert.equal((html.match(/data-effort="/g) || []).length, 10);
  assert.match(html, /class="ed-n on" data-effort="7"/);
  assert.match(html, /7 · Hard/);
  assert.doesNotMatch(E.pickerHtml('"><x', null), /"><x/);
});

test("empty data is safe", () => {
  const r = E.analyze({}, { today: TODAY });
  assert.equal(r.nudge, false);
  assert.equal(r.reason, "not-enough-ratings");
});
