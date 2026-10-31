// node --test modules/short-session/short-session.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const SS = require('./short-session.js');
const X = require('../exercise-swap/exercise-swap.js');

const PROGRAM = {
  "Push A":[["Bench Press (Barbell)",90,8,2,"kg"],["Lateral Raise (Cable)",7.5,10,3,"kg"],["Incline DB Press",65,10,2,"lb"],["Cable Crossover",16.5,10,3,"kg"],["Triceps Extension (Cable)",15,10,3,"kg"],["Triceps Pushdown (Straight bar)",32.5,10,2,"kg"],["Standing Side Delts (Machine)",66,10,3,"kg"]],
  "Pull A":[["Lat Pulldown, Wide",80,8,3,"kg"],["Lat Pulldown, Single Arm",60,10,3,"kg"],["Seated Row (Cable)",95,8,2,"kg"],["Pullover (Machine)",61,8,2,"kg"],["DB Curl",30,10,3,"lb"],["Seated Bicep Curl",25,10,3,"kg"],["Reverse Fly (Machine)",61,10,1,"kg"]],
  "Lower A":[["Leg Extension",122,8,3,"kg"],["Hack Squat",70,8,2,"kg"],["Smith Squat",40,7,1,"kg"],["Lying Leg Curl",63,8,2,"kg"],["Hip Adductor",85,10,3,"kg"],["Standing Calf Raise",60,10,3,"kg"],["Seated Abs",5,100,1,"kg"]],
  "Push B":[["Gundam (Chest Machine)",60,8,3,"kg"],["Seated DB Overhead Press",60,8,3,"lb"],["Side Delts",7.5,10,3,"kg"],["Reverse Fly (Machine)",61,10,3,"kg"],["Front Raise (DB)",30,10,1,"lb"],["Triceps Rope",15,10,2,"kg"],["Triceps Pushdown (Straight bar)",32.5,10,2,"kg"]],
  "Pull B":[["T-Bar Row",50,8,3,"kg"],["Lat Pulldown, Single Arm",60,10,3,"kg"],["Iso-Lateral Low Row",70,10,2,"kg"],["Seated Row (Cable)",90,8,2,"kg"],["Traps Machine",80,10,2,"kg"],["Cable Standing Biceps",16,10,3,"kg"]],
  "Lower B":[["Lying Leg Curl",63,8,3,"kg"],["Leg Extension",122,8,2,"kg"],["Hack Squat",70,8,2,"kg"],["Smith Squat",40,10,2,"kg"],["Hip Abductor",135,20,3,"kg"],["Calf Press on Seated Leg Press",65,10,2,"kg"],["Seated Abs",5,100,1,"kg"]]
};

test('full sessions take about 75–95 minutes with the 30 min treadmill', () => {
  for (const rows of Object.values(PROGRAM)) {
    const e = SS.estimate(SS.normalize(rows, { swap: X }), { cardioMin: 30 });
    assert.ok(e.total >= 70 && e.total <= 95, String(e.total));
    assert.equal(e.total, e.lifting + e.cardio);
  }
});

test('every budget fits every session, keeps every main lift with at least 2 sets, and never drops to nothing', () => {
  for (const minutes of SS.BUDGETS) {
    for (const [session, rows] of Object.entries(PROGRAM)) {
      const p = SS.plan(rows, { minutes, swap: X, cardioMin: 30 });
      assert.ok(p.est.total <= minutes, `${session} @${minutes}: ${p.est.total}`);
      assert.equal(p.over, 0);
      p.items.filter(it => it.main).forEach(it => { assert.ok(!it.drop, it.name); assert.ok(it.sets >= 2, it.name); });
      assert.ok(p.items.some(it => !it.drop));
      assert.equal(p.items.length, rows.length);
      p.items.forEach((it, i) => assert.equal(it.name, rows[i][0]));
      assert.ok(p.cardioMin <= 30 && p.cardioMin >= 0);
    }
  }
});

test('60 min keeps the lifting mostly intact and trims the treadmill first', () => {
  const p = SS.plan(PROGRAM['Push A'], { minutes: 60, swap: X, cardioMin: 30 });
  assert.equal(p.items.filter(it => it.drop).length, 0, 'nothing dropped at 60');
  assert.ok(p.cardioMin < 30 && p.cardioMin >= 10);
  assert.ok(p.items.some(it => it.pair), 'accessories supersetted');
  assert.ok(p.steps.length);
});

test('30 min drops the lowest-priority accessories, duplicate muscles first', () => {
  const p = SS.plan(PROGRAM['Push A'], { minutes: 30, swap: X, cardioMin: 30 });
  const dropped = p.items.filter(it => it.drop).map(it => it.name);
  assert.ok(dropped.length >= 1);
  // the first skip is a second move for a muscle already worked (or the last accessory), never a first-of-muscle move
  const firstSkip = p.steps.find(s => s.startsWith('Skip ')).slice(5);
  const first = p.items.find(it => it.name === firstSkip);
  assert.ok(p.items.slice(0, first.i).some(it => it.muscle === first.muscle), firstSkip);
  // the treadmill goes to 0 before any first-of-muscle accessory is skipped
  const seen = new Set();
  p.items.forEach(it => { if (it.drop && !seen.has(it.muscle)) assert.equal(p.cardioMin, 0, 'dropped ' + it.name + ' while cardio stays'); seen.add(it.muscle); });
  p.items.filter(it => it.pair).forEach(it => assert.ok(!it.drop));
  // a superset letter always names exactly two live moves
  const letters = {}; p.items.forEach(it => { if (it.pair) letters[it.pair] = (letters[it.pair] || 0) + 1; });
  Object.values(letters).forEach(n => assert.equal(n, 2));
});

test('a session that already fits is returned untouched', () => {
  const p = SS.plan([['Bench Press (Barbell)', 90, 8, 2, 'kg'], ['DB Curl', 30, 10, 2, 'lb']], { minutes: 60, swap: X, cardioMin: 20 });
  assert.equal(p.steps.length, 0);
  assert.equal(p.cardioMin, 20);
  assert.ok(p.items.every(it => !it.pair && !it.drop && it.sets === it.origSets));
});

test('apply / slot / clear round-trip on the workout doc', () => {
  const p = SS.plan(PROGRAM['Pull A'], { minutes: 30, swap: X, cardioMin: 30 });
  const doc = { date: '2026-10-27', session: 'Pull A', sets: { 'DB Curl': [{ w: 30, r: 10 }] } };
  const w = SS.apply(doc, p);
  assert.equal(SS.active(w), 30);
  assert.equal(w.short.cardioMin, p.cardioMin);
  assert.deepEqual(doc.sets, w.sets);
  p.items.forEach(it => {
    const s = SS.slot(w, it.name);
    assert.equal(s.drop, it.drop);
    assert.equal(s.pair, it.pair);
    assert.equal(s.sets, !it.drop && it.sets !== it.origSets ? it.sets : null);
  });
  assert.deepEqual(SS.slot(w, 'Nope'), { sets: null, drop: false, pair: null });
  const c = SS.clear(w);
  assert.equal(SS.active(c), null);
  assert.ok(!('short' in c));
  assert.equal(SS.active(null), null);
});

test('works without ExerciseSwap (name-based muscles) and with plain names', () => {
  const p = SS.plan(['Bench Press (Barbell)', 'Cable Crossover', 'Triceps Rope', 'Triceps Pushdown (Straight bar)'], { minutes: 30, swap: null, cardioMin: 30 });
  assert.ok(p.est.total <= 30);
  assert.equal(p.items[2].muscle, 'Triceps');
  assert.equal(p.items[0].main, true);
});

test('cardHtml renders chips, the estimate, the steps and the right buttons', () => {
  const h = SS.cardHtml({ session: 'Push A', exercises: PROGRAM['Push A'], minutes: 45, swap: X, cardioMin: 30 });
  assert.match(h, /data-act="ssmin" data-min="30"/);
  assert.match(h, /aria-pressed="true">45 min/);
  assert.match(h, /data-act="ssapply" data-min="45"/);
  assert.match(h, /Full session <b>\d+ min/);
  assert.match(h, /<ul class="ss-steps">/);
  const on = SS.cardHtml({ session: 'Push A', exercises: PROGRAM['Push A'], active: 30, swap: X, cardioMin: 30 });
  assert.match(on, /data-act="ssclear"/);
  assert.match(on, /Short session on · 30 min/);
  assert.doesNotMatch(on, /ssapply/);
});
