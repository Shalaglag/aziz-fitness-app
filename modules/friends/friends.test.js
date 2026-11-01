// node --test modules/friends/friends.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.TZ = "Asia/Kuwait"; // local-day maths, like the steps tests
const F = require("./friends.js");

const TODAY = "2026-11-04"; // a Wednesday
const day = (date, steps, extra) => Object.assign({ date, food: [], water: 0, steps: steps == null ? undefined : { count: steps, at: date + "T08:00:00+03:00", source: "health-connect" } }, extra || {});
function docs() {
  return {
    days: { "2026-11-04": day("2026-11-04", 6200, { water: 1500 }), "2026-11-03": day("2026-11-03", 11000), "2026-11-02": day("2026-11-02", 9000), "2026-10-20": day("2026-10-20", 4000) },
    weights: { "2026-10-01": { date: "2026-10-01", kg: 92 }, "2026-11-04": { date: "2026-11-04", kg: 90 } },
    workouts: { "2026-11-02": { date: "2026-11-02", session: "Push A", sets: { "Bench": [{ w: 60, r: 8 }] } } },
    lb_workouts: { w1: { id: "w1", start: Date.parse("2026-11-03T18:00:00+03:00"), end: Date.parse("2026-11-03T19:00:00+03:00"), exercises: [{ exId: "e1", unit: "kg", sets: [{ t: "w", w: 40, r: 10 }, { w: 80, r: 5, done: true }, { w: 85, r: 3, done: true }] }] } },
    lb_exercises: { e1: { name: "Bench Press (Barbell)" } },
    cardio: { "2026-11-03": { sessions: [{ min: 30, km: 2.5 }] } }
  };
}
const ctx = (over) => Object.assign({ today: TODAY, now: Date.parse("2026-11-04T10:00:00+03:00"), docs: docs(), getDay: d => docs().days[d] || { date: d, food: [], water: 0 }, stepGoal: 8000, waterGoal: () => 3000, kcalTarget: () => 2000, proteinMin: 160, weekGoal: 4, stepsConnected: true }, over);
const me = { uid: "u_me", name: "Aziz", avatar: "🦁" };

test("nothing is shared until a category is switched on", () => {
  const s = F.buildShare(me, F.defaultSharing(), ctx());
  assert.equal(s.name, "Aziz");
  for (const c of F.CATS) { assert.equal(s.cats[c.key], false); assert.equal(s[c.key], undefined); }
});

test("steps share holds daily counts, goal and last sync time, nothing older than 35 days", () => {
  const s = F.buildShare(me, { steps: true }, ctx());
  assert.deepEqual(s.steps.days, { "2026-11-04": 6200, "2026-11-03": 11000, "2026-11-02": 9000, "2026-10-20": 4000 });
  assert.equal(s.steps.goal, 8000);
  assert.equal(s.steps.at, Date.parse("2026-11-04T08:00:00+03:00"));
  assert.equal(s.steps.source, "health-connect");
  const old = ctx(); old.docs.days["2026-09-01"] = day("2026-09-01", 5000); old.getDay = d => old.docs.days[d] || { date: d };
  assert.equal(F.buildShare(me, { steps: true }, old).steps.days["2026-09-01"], undefined);
});

test("workouts share lists training days from both loggers, never the sets", () => {
  const s = F.buildShare(me, { workouts: true }, ctx());
  assert.deepEqual(s.workouts, { weekGoal: 4, dates: ["2026-11-02", "2026-11-03"] });
  assert.equal(JSON.stringify(s).includes("Bench"), false);
});

test("strength share keeps the best set per exercise in kg (warm-ups skipped)", () => {
  const s = F.buildShare(me, { strength: true }, ctx());
  const b = s.strength.ex["Bench Press (Barbell)"];
  assert.equal(b.kg, 85); assert.equal(b.reps, 3); assert.equal(b.e1rm, 93.5);
});

test("weight share gives change over 30 days (kg or %), never the weight itself", () => {
  const s = F.buildShare(me, { weight: true }, ctx());
  assert.deepEqual(s.weight, { mode: "change", change: -2, since: "2026-10-01", days: 34 });
  const p = F.buildShare(me, { weight: true, weightMode: "percent" }, ctx());
  assert.equal(p.weight.pct, -2.2);
  assert.equal(JSON.stringify(s).includes("92"), false);
  assert.equal(JSON.stringify(s).includes("90"), false);
});

test("water, cardio and nutrition shares are summaries only", () => {
  const c = ctx(); c.docs.days[TODAY].food = [{ kcal: 1900, p: 170, eaten: true }, { kcal: 900, p: 10, eaten: false }]; c.getDay = d => c.docs.days[d] || { date: d };
  const s = F.buildShare(me, { water: true, cardio: true, nutrition: true }, c);
  assert.equal(s.water.days[TODAY], 1500);
  assert.deepEqual(s.cardio.days["2026-11-03"], { min: 30, km: 2.5 });
  assert.deepEqual(s.nutrition.days[TODAY], { kcalOk: true, proteinOk: true });
  assert.equal(JSON.stringify(s.nutrition).includes("1900"), false);
});

test("periods: today, Monday-based week, calendar month", () => {
  assert.deepEqual(F.periodRange("today", TODAY), { from: TODAY, to: TODAY, label: "Today" });
  assert.deepEqual(F.periodRange("week", TODAY), { from: "2026-11-02", to: TODAY, label: "This week" });
  assert.deepEqual(F.periodRange("month", TODAY), { from: "2026-11-01", to: TODAY, label: "This month" });
});

const share = (uid, name, steps, at, extra) => Object.assign({ uid, name, cats: { steps: steps !== null }, steps: steps === null ? undefined : { goal: 10000, days: steps, at, connected: true } }, extra || {});
const NOW = Date.parse("2026-11-04T10:00:00+03:00");

test("leaderboard ranks shared steps, shows the gap to me, and flags stale, missing and unshared people", () => {
  const shares = {
    u_me: share("u_me", "Aziz", { "2026-11-04": 6200, "2026-11-03": 11000 }, NOW - 5 * 60000),
    u_b: share("u_b", "Brother", { "2026-11-04": 9800, "2026-11-03": 3000 }, NOW - 60000),
    u_c: share("u_c", "Cousin", { "2026-11-01": 7000 }, NOW - 3 * 864e5),
    u_d: share("u_d", "Dan", null),
    u_e: share("u_e", "Eve", {}, null, { steps: { goal: 10000, days: {}, at: null, connected: false } })
  };
  const lb = F.leaderboard(shares, "today", TODAY, { me: "u_me", now: NOW });
  assert.deepEqual(lb.rows.map(r => r.name), ["Brother", "Aziz", "Cousin", "Dan", "Eve"]);
  const b = lb.rows[0];
  assert.equal(b.total, 9800); assert.equal(b.remaining, 200); assert.equal(b.pct, 0.98); assert.equal(b.diff, 3600); assert.equal(b.status, "ok");
  assert.equal(lb.rows[1].me, true); assert.equal(lb.rows[1].diff, null);
  assert.equal(lb.rows[2].status, "stale"); assert.equal(lb.rows[2].total, 0);
  assert.equal(lb.rows[3].status, "notShared");
  assert.equal(lb.rows[4].status, "notConnected");
  const wk = F.leaderboard(shares, "week", TODAY, { me: "u_me", now: NOW });
  assert.equal(wk.rows[0].name, "Aziz"); assert.equal(wk.rows[0].total, 17200); assert.equal(wk.rows[0].goalDays, 1); assert.equal(wk.nDays, 3);
  assert.equal(wk.rows[1].diff, -4400);
});

test("compare shows each category as a value, Not shared or No data", () => {
  const a = Object.assign(share("u_me", "Aziz", { "2026-11-04": 6200 }, NOW), { cats: { steps: true, workouts: true, strength: true, weight: true }, workouts: { weekGoal: 4, dates: ["2026-11-02"] }, strength: { ex: { Squat: { kg: 100, reps: 5, e1rm: 116.7 }, Bench: { kg: 80, reps: 5, e1rm: 93.3 } } }, weight: { mode: "change", change: -2, since: "2026-10-01", days: 34 } });
  const b = Object.assign(share("u_b", "Brother", { "2026-11-04": 9800 }, NOW), { cats: { steps: true, strength: true, weight: true }, strength: { ex: { Squat: { kg: 120, reps: 3, e1rm: 132 } } }, weight: { mode: "percent", since: null } });
  const c = F.compare(a, b, TODAY);
  const row = l => c.rows.find(r => r.label === l);
  assert.equal(row("Steps today").a, "6,200 / 10,000"); assert.equal(row("Steps today").b, "9,800 / 10,000");
  assert.equal(row("Workouts this week").a, "1 / 4"); assert.equal(row("Workouts this week").b, "Not shared");
  assert.equal(row("Water today").a, "Not shared");
  assert.equal(row("Weight change").a, "-2 kg in 34 days"); assert.equal(row("Weight change").b, "No weigh-ins yet");
  assert.deepEqual(c.lifts.map(l => l.name), ["Squat"]);
});

const ch = over => Object.assign({ id: "c1", name: "Walk-off", type: "steps_total", target: 0, start: "2026-11-02", end: "2026-11-08", creator: "u_me", invited: ["u_me", "u_b", "u_c"], members: ["u_me", "u_b"], names: { u_me: "Aziz", u_b: "Brother", u_c: "Cousin" } }, over);
const entry = (uid, name, days) => ({ uid, name, days, updatedAt: NOW });

test("challenge entry carries only the fields the challenge needs, inside its window", () => {
  const e = F.buildEntry(ch(), me, ctx());
  assert.deepEqual(e.days, { "2026-11-02": { s: 9000, g: 8000 }, "2026-11-03": { s: 11000, g: 8000 }, "2026-11-04": { s: 6200, g: 8000 } });
  const w = F.buildEntry(ch({ type: "workouts", target: 4 }), me, ctx());
  assert.deepEqual(w.days, { "2026-11-02": { w: 1 }, "2026-11-03": { w: 1 } });
  const a = F.buildEntry(ch({ type: "active_days", target: 5 }), me, ctx());
  assert.deepEqual(a.days["2026-11-04"], { s: 6200, g: 8000 });
});

test("challenge progress: most steps, goal days, workouts to a target, team total, result when done", () => {
  const entries = { u_me: entry("u_me", "Aziz", { "2026-11-02": { s: 9000, g: 8000 }, "2026-11-03": { s: 11000, g: 8000 }, "2026-11-04": { s: 6200, g: 8000 } }), u_b: entry("u_b", "Brother", { "2026-11-03": { s: 30000, g: 10000 }, "2026-11-04": { s: 100, g: 10000 } }) };
  const p = F.challengeProgress(ch(), entries, TODAY);
  assert.equal(p.status, "active"); assert.equal(p.daysLeft, 5);
  assert.deepEqual(p.rows.map(r => [r.name, r.score]), [["Brother", 30100], ["Aziz", 26200]]);
  assert.equal(p.result, null);
  const g = F.challengeProgress(ch({ type: "steps_goal_days" }), entries, TODAY);
  assert.deepEqual(g.rows.map(r => [r.name, r.score]), [["Aziz", 2], ["Brother", 1]]);
  const t = F.challengeProgress(ch({ type: "group_steps", target: 50000 }), entries, TODAY);
  assert.equal(t.result.total, 56300); assert.equal(t.result.reached, true);
  const done = F.challengeProgress(ch({ end: "2026-11-03" }), entries, TODAY);
  assert.equal(done.status, "done"); assert.deepEqual(done.result, { kind: "winner", winners: ["Brother"], score: 30000 });
  const w = F.challengeProgress(ch({ type: "workouts", target: 2 }), { u_me: entry("u_me", "Aziz", { "2026-11-02": { w: 1 }, "2026-11-03": { w: 1 } }) }, TODAY);
  assert.equal(w.rows[0].reached, true); assert.equal(w.rows[1].hasEntry, false); assert.equal(w.rows[1].score, 0);
  assert.equal(F.challengeStatus(ch({ start: "2026-11-10", end: "2026-11-12" }), TODAY), "upcoming");
});

test("challenge form validation", () => {
  assert.deepEqual(F.validateChallenge({ name: "x", type: "steps_total", start: TODAY, end: "2026-11-10", invited: ["u_b"] }, TODAY), []);
  const errs = F.validateChallenge({ name: "", type: "workouts", start: "2026-11-10", end: "2026-11-01", invited: [] }, TODAY);
  assert.equal(errs.length, 4);
});

test("invite codes and pair ids", () => {
  assert.match(F.newCode(), /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
  assert.equal(F.cleanCode(" abc123 "), "ABC-123"); assert.equal(F.cleanCode("abc-123"), "ABC-123");
  assert.equal(F.pairId("zed", "amy"), "amy_zed");
  assert.equal(F.initials("Aziz Al Shaheen"), "AA");
});

test("screen HTML: empty states, leaderboard rows and sharing switches render without an account's data", () => {
  const st = { uid: "u_me", me, code: "ABC-123", requestsIn: [], requestsOut: [], friends: [], shares: {}, myShare: null, challenges: {}, entries: {}, sub: "leaderboard", period: "today", sharing: F.defaultSharing() };
  const c = { today: TODAY, now: NOW, email: "a@b.c" };
  assert.match(F.screenHTML(st, c), /Invite a friend/);
  st.friends = [{ pairId: "u_b_u_me", uid: "u_b", name: "Brother" }];
  st.shares = { u_b: share("u_b", "Brother", { [TODAY]: 9800 }, NOW) };
  st.myShare = share("u_me", "Aziz", null);
  const h = F.screenHTML(st, c);
  assert.match(h, /9,800/); assert.match(h, /Not sharing steps/); assert.match(h, /Share your steps/);
  st.sub = "sharing"; assert.equal((F.screenHTML(st, c).match(/role="switch"/g) || []).length, F.CATS.length);
  st.sub = "friends"; assert.match(F.screenHTML(st, c), /ABC-123/);
  st.sub = "challenges"; assert.match(F.screenHTML(st, c), /New challenge/);
  st.compareUid = "u_b"; assert.match(F.screenHTML(st, c), /role="dialog"/);
  assert.match(F.signedOutHTML(true), /data-act="cloudsignin"/, "the shell handles data-act buttons; data-a did nothing");
});
