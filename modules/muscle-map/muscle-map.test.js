// Run: node --test modules/muscle-map/muscle-map.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const SA = require("../strength-analytics/strength-analytics.js");
const MM = require("./muscle-map.js");

const H = 36e5;
const NOW = new Date(2026, 9, 26, 10, 0).getTime(); // Oct 26 2026, 10:00 local
const opts = (o = {}) => Object.assign({ now: NOW, musclesFor: SA.musclesFor, muscleList: SA.MUSCLES }, o);
const sets = (n, t) => Array.from({ length: n }, () => ({ w: 60, r: 8, done: true, t }));
const lbw = (hoursAgo, exercises, extra) => Object.assign({ id: "w" + hoursAgo, start: NOW - hoursAgo * H - H, end: NOW - hoursAgo * H, exercises }, extra);
const by = A => Object.fromEntries(A.muscles.map(m => [m.id, m]));

test("nothing logged: every muscle fresh at 100%", () => {
  const A = MM.analyze({}, opts());
  assert.equal(A.muscles.length, 16);
  assert.ok(A.muscles.every(m => m.pct === 100 && m.status === "fresh"));
  assert.match(A.notes[0], /No sets logged/);
});

test("a full chest session fades linearly over its window; helpers count half", () => {
  const w = [lbw(0, [{ exId: "bench-press-barbell", sets: sets(8) }])];
  let m = by(MM.analyze({ lb_workouts: w }, opts())); // just finished
  assert.equal(m.chest.pct, 0);
  assert.equal(m.chest.sets, 8);
  assert.equal(m.triceps.sets, 4); // secondary, ½ a set each
  assert.equal(m.triceps.pct, 50); // dose 4/8
  assert.equal(m.quads.pct, 100);
  // chest window = 48 × (0.6 + 0.8) = 67.2 h → after 33.6 h half the fatigue is gone
  m = by(MM.analyze({ lb_workouts: w }, opts({ now: NOW + 33.6 * H })));
  assert.equal(m.chest.pct, 50);
  assert.equal(m.chest.status, "recovering");
  m = by(MM.analyze({ lb_workouts: w }, opts({ now: NOW + 70 * H })));
  assert.equal(m.chest.pct, 100);
  assert.equal(m.chest.status, "ready");
  assert.equal(m.chest.lastDate, "2026-10-26");
});

test("warm-ups, undone sets and future/old sessions are ignored; doses add up", () => {
  const w = [
    lbw(0, [{ exId: "leg-extension-machine", sets: sets(3, "w").concat(sets(2)).concat([{ r: 8, done: false }]) }]),
    lbw(24, [{ exId: "hack-squat-machine", sets: sets(4) }]),
    lbw(24 * 8, [{ exId: "hack-squat-machine", sets: sets(10) }]), // 8 days ago: outside the 7-day window
    { id: "future", start: NOW + 2 * H, end: NOW + 3 * H, exercises: [{ exId: "bench-press-barbell", sets: sets(10) }] }
  ];
  const m = by(MM.analyze({ lb_workouts: w }, opts()));
  assert.equal(m.quads.sets, 6);
  assert.equal(m.quads.lastSets, 2);
  assert.equal(m.chest.pct, 100);
  // today: dose 2/8 = .25 at 0 h; yesterday: 4 sets, window 48 × 1.0 = 48 h, half gone → .25; total .5
  assert.equal(m.quads.pct, 50);
  assert.equal(m.quads.readyInH > 0, true);
  assert.ok(m.quads.pct < by(MM.analyze({ lb_workouts: [w[1]] }, opts())).quads.pct);
});

test("Quick log fills dates the logger has no session for, assumed at 18:00", () => {
  const docs = {
    lb_workouts: [lbw(2, [{ exId: "lat-pulldown-wide-grip-cable", sets: sets(3) }])],
    workouts: {
      "2026-10-26": { date: "2026-10-26", session: "Push A", sets: { "Bench Press (Barbell)": sets(8) } }, // same day as the logger: skipped
      "2026-10-25": { date: "2026-10-25", session: "Lower A", sets: { "Leg Extension": sets(4), "Treadmill": [{ r: 1 }] } }
    }
  };
  const m = by(MM.analyze(docs, opts()));
  assert.equal(m.chest.pct, 100);
  assert.equal(m.back.sets, 3);
  assert.equal(m.quads.lastDate, "2026-10-25");
  assert.equal(Math.round(m.quads.hoursSince), 16);
});

test("soreness logged today stretches the windows; unknown exercises are noted", () => {
  const w = [lbw(24, [{ exId: "bench-press-barbell", sets: sets(8) }, { exId: "mystery-machine", sets: sets(3) }])];
  const plain = MM.analyze({ lb_workouts: w }, opts());
  const sore = MM.analyze({ lb_workouts: w, days: { "2026-10-26": { readiness: { soreness: 1 } } } }, opts());
  assert.ok(by(sore).chest.pct < by(plain).chest.pct);
  assert.equal(sore.stretch, 1.25);
  assert.match(plain.notes.join(" "), /Not mapped to a muscle: Mystery Machine/);
  assert.match(sore.notes.join(" "), /soreness 1\/5/);
});

test("next session verdict: go / ok / wait from the primaries it hits", () => {
  const push = { name: "Push A", exercises: ["Bench Press (Barbell)", "Lateral Raise (Cable)", "Triceps Pushdown (Straight bar)"] };
  let A = MM.analyze({}, opts({ nextSession: push }));
  assert.equal(A.next.verdict, "go");
  assert.deepEqual(A.next.muscles.map(m => m.id).sort(), ["chest", "frontDelts", "sideDelts", "triceps"]);
  A = MM.analyze({ lb_workouts: [lbw(40, [{ exId: "bench-press-barbell", sets: sets(8) }])] }, opts({ nextSession: push }));
  assert.equal(A.next.verdict, "ok");
  assert.match(A.next.note, /Chest \d+% still recovering/);
  A = MM.analyze({ lb_workouts: [lbw(2, [{ exId: "bench-press-barbell", sets: sets(8) }])] }, opts({ nextSession: push }));
  assert.equal(A.next.verdict, "wait");
  assert.match(A.next.note, /ready in about/);
  // a pull day after a push day is fine
  A = MM.analyze({ lb_workouts: [lbw(2, [{ exId: "bench-press-barbell", sets: sets(8) }])] }, opts({ nextSession: { name: "Pull A", exercises: ["Lat Pulldown, Wide", "DB Curl"] } }));
  assert.equal(A.next.verdict, "go");
});

test("html: card with two figures, coloured paths, list and verdict; summary is plain text", () => {
  const docs = { lb_workouts: [lbw(5, [{ exId: "bench-press-barbell", sets: sets(6) }, { exId: "leg-extension-machine", sets: sets(2) }])] };
  const h = MM.html(docs, opts({ nextSession: { name: "Push B", exercises: ["Gundam (Chest Machine)"] } }));
  assert.match(h, /class="card mm-card"/);
  assert.equal((h.match(/<svg /g) || []).length, 2);
  assert.ok(h.includes('data-mm="chest"') && h.includes('data-mm="glutes"'));
  assert.ok(h.includes("mm-wait") && h.includes("Push B"));
  assert.match(h, /Chest<\/span>/);
  assert.match(h, /5 h ago/);
  assert.ok(!/<script/.test(h));
  const s = MM.summary(docs, opts());
  assert.match(s, /Chest \d+% \(5 h ago\)/);
  assert.equal(MM.colour(100), "rgb(30,138,76)");
  assert.equal(MM.colour(0), "rgb(200,53,46)");
});

test("works without StrengthAnalytics using opts.muscles overrides and the built-in list", () => {
  const A = MM.analyze({ workouts: { "2026-10-26": { sets: { "Thing": sets(4) } } } }, { now: NOW + 8 * H, musclesFor: () => null, muscles: { Thing: { primary: ["calves"] } } });
  assert.equal(by(A).calves.pct, 50);
  assert.equal(A.muscles.length, 16);
});
