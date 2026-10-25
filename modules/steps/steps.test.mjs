// Run: TZ=Asia/Kuwait node --test modules/steps/steps.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "./steps.js";

const now = new Date(2026, 9, 25, 18, 0);
const file = f => readFileSync(new URL(f, import.meta.url), "utf8");

test("bare numbers are today", () => {
  for (const [t, n] of [["8432", 8432], ["8,432", 8432], ["8.4k", 8400], ["8 432 steps", 8432], ["8.432", 8432]])
    assert.deepEqual(S.parseSteps(t, now), [{ date: "2026-10-25", steps: n, source: "manual" }], t);
  assert.deepEqual(S.parseSteps("hello", now), []);
});

test("STEPS lines, latest per day wins", () => {
  const r = S.parseSteps("STEPS 2026-10-24 9000\nSTEPS 2026-10-25 4000\nSTEPS 2026-10-25 6100 steps", now);
  assert.deepEqual(r.map(x => [x.date, x.steps]), [["2026-10-24", 9000], ["2026-10-25", 6100]]);
});

test("daily CSV", () => {
  const r = S.parseSteps(file("samples/health-connect-daily.csv"), now);
  assert.deepEqual(r.map(x => [x.date, x.steps]), [["2026-10-22", 7412], ["2026-10-23", 10233], ["2026-10-24", 9050]]);
});

test("Health Connect records: local day, per-source sum, max across sources", () => {
  const r = S.parseSteps(file("samples/health-connect-records.csv"), now);
  // In Kuwait (UTC+3) 22:30Z on the 24th is 01:30 on the 25th.
  // Oct 24: phone 3200+4100 = 7300, watch 3350 -> 7300 (not 10650).
  // Oct 25: phone 900+2500 = 3400.
  assert.deepEqual(r.map(x => [x.date, x.steps]), [["2026-10-24", 7300], ["2026-10-25", 3400]]);
});

test("long CSV keeps only step rows; Google Fit daily column", () => {
  const long = "time,type,value,unit\n2026-10-25 08:00:00,Steps,1200,count\n2026-10-25 08:00:00,Heart rate,80,bpm\n2026-10-25 12:00:00,Steps,800,count";
  assert.deepEqual(S.parseSteps(long, now).map(x => x.steps), [2000]);
  const fit = "Date,Move Minutes count,Calories (kcal),Step count\n2026-10-20,40,2100,8123";
  assert.deepEqual(S.parseSteps(fit, now).map(x => [x.date, x.steps]), [["2026-10-20", 8123]]);
});

test("set/add/apply on the day doc", () => {
  let d = { date: "2026-10-25", water: 500 };
  d = S.setSteps(d, 5000, "manual", now);
  assert.equal(d.water, 500);
  assert.equal(d.steps.count, 5000);
  d = S.addSteps(d, 1000, now);
  assert.equal(S.stepCount(d), 6000);
  assert.equal(S.stepCount(S.addSteps(d, -99999, now)), 0);
  d = S.applySteps(d, { steps: 7300, source: "csv" }, now);
  assert.deepEqual([d.steps.count, d.steps.source], [7300, "csv"]);
  assert.equal(S.stepCount({ steps: 4200 }), 4200);
  assert.equal(S.stepCount(undefined), 0);
});

test("goal, progress and week", () => {
  assert.equal(S.stepGoal({}), 10000);
  assert.equal(S.stepGoal({ stepGoal: 8000 }), 8000);
  assert.equal(S.stepGoal({ stepGoal: 5 }), 10000);
  assert.deepEqual(S.stepProgress({ steps: { count: 7500 } }, 10000), { count: 7500, goal: 10000, pct: 75, left: 2500, hit: false });
  assert.equal(S.stepProgress({ steps: { count: 12000 } }, 10000).pct, 100);
  const days = { "2026-10-25": { steps: { count: 12000 } }, "2026-10-23": { steps: 8000 }, "2026-10-18": { steps: 20000 } };
  assert.deepEqual(S.weekSteps(d => days[d], "2026-10-25", 10000), { avg: 10000, logged: 2, hitDays: 1 });
});

test("card HTML", () => {
  const h = S.stepsCardHTML({ steps: { count: 7500, at: now.toISOString(), source: "csv" } }, { goal: 10000, week: { avg: 9000, logged: 5, hitDays: 2 } });
  for (const s of ["7,500", "2,500 to go", "width:75%", "Imported from a step app", "7-day average", 'data-act="stepsimport"', 'id="stepsFile"'])
    assert.ok(h.includes(s), s);
  assert.ok(S.stepsCardHTML({ steps: 11000 }, { goal: 10000 }).includes("Goal hit, 1,000 over"));
  assert.ok(S.stepsCardHTML(undefined).includes(">0<"));
});

test("step apps' own exports", () => {
  const got = f => S.parseSteps(file("samples/" + f), now).map(x => [x.date, x.steps]);
  // Samsung daily trend: phone 7300, watch 6900, combined (-2) 8100 -> 8100.
  assert.deepEqual(got("samsung-step-daily-trend.csv"), [["2026-10-24", 8100], ["2026-10-25", 4200]]);
  // Samsung step_count: UTC times + UTC+0300 offset; 22:30Z on the 24th is the 25th.
  assert.deepEqual(got("samsung-step-count.csv"), [["2026-10-24", 3000], ["2026-10-25", 500]]);
  assert.deepEqual(got("fitbit-steps.json"), [["2026-10-24", 135], ["2026-10-25", 120]]);
  assert.deepEqual(got("fitbit-account-export.csv"), [["2026-10-23", 9812], ["2026-10-24", 8050]]);
  assert.deepEqual(got("garmin-uds.json"), [["2026-10-23", 11234], ["2026-10-24", 6120]]);
  assert.deepEqual(got("garmin-connect-report.csv"), [["2026-10-23", 11234], ["2026-10-24", 6120]]);
  // Apple: iPhone 900+2100 = 3000 vs Watch 950; the water record is ignored.
  assert.deepEqual(got("apple-export.xml"), [["2026-10-24", 3000]]);
});

test("date formats", () => {
  const one = csv => S.parseSteps("Date,Steps\n" + csv, now)[0].date;
  assert.equal(one("Oct 24, 2026,5000".replace("Oct 24, 2026", '"Oct 24, 2026"')), "2026-10-24");
  assert.equal(one("24 Oct 2026,5000"), "2026-10-24");
  assert.equal(one("2026/10/24,5000"), "2026-10-24");
  assert.equal(one("10/24/26,5000"), "2026-10-24");
  assert.equal(one("1792800000000,5000"), "2026-10-24");
});

test("card lists every source", () => {
  const h = S.stepsCardHTML({});
  for (const s of S.STEP_SOURCES) assert.ok(h.includes(s.name), s.name);
});
