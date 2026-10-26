// node --test modules/travel-workout/travel-workout.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const TW = require('./travel-workout.js');
const X = require('../exercise-swap/exercise-swap.js');

const PROGRAM = {
  "Push A":[["Bench Press (Barbell)",90,8,2,"kg"],["Lateral Raise (Cable)",7.5,10,3,"kg"],["Incline DB Press",65,10,2,"lb"],["Cable Crossover",16.5,10,3,"kg"],["Triceps Extension (Cable)",15,10,3,"kg"],["Triceps Pushdown (Straight bar)",32.5,10,2,"kg"],["Standing Side Delts (Machine)",66,10,3,"kg"]],
  "Pull A":[["Lat Pulldown, Wide",80,8,3,"kg"],["Lat Pulldown, Single Arm",60,10,3,"kg"],["Seated Row (Cable)",95,8,2,"kg"],["Pullover (Machine)",61,8,2,"kg"],["DB Curl",30,10,3,"lb"],["Seated Bicep Curl",25,10,3,"kg"],["Reverse Fly (Machine)",61,10,1,"kg"]],
  "Lower A":[["Leg Extension",122,8,3,"kg"],["Hack Squat",70,8,2,"kg"],["Smith Squat",40,7,1,"kg"],["Lying Leg Curl",63,8,2,"kg"],["Hip Adductor",85,10,3,"kg"],["Standing Calf Raise",60,10,3,"kg"],["Seated Abs",5,100,1,"kg"]],
  "Push B":[["Gundam (Chest Machine)",60,8,3,"kg"],["Seated DB Overhead Press",60,8,3,"lb"],["Side Delts",7.5,10,3,"kg"],["Reverse Fly (Machine)",61,10,3,"kg"],["Front Raise (DB)",30,10,1,"lb"],["Triceps Rope",15,10,2,"kg"],["Triceps Pushdown (Straight bar)",32.5,10,2,"kg"]],
  "Pull B":[["T-Bar Row",50,8,3,"kg"],["Lat Pulldown, Single Arm",60,10,3,"kg"],["Iso-Lateral Low Row",70,10,2,"kg"],["Seated Row (Cable)",90,8,2,"kg"],["Traps Machine",80,10,2,"kg"],["Cable Standing Biceps",16,10,3,"kg"]],
  "Lower B":[["Lying Leg Curl",63,8,3,"kg"],["Leg Extension",122,8,2,"kg"],["Hack Squat",70,8,2,"kg"],["Smith Squat",40,10,2,"kg"],["Hip Abductor",135,20,3,"kg"],["Calf Press on Seated Leg Press",65,10,2,"kg"],["Seated Abs",5,100,1,"kg"]]
};
const HINGES = ['Deadlift (Barbell)','Romanian Deadlift (Dumbbell)','Single-Leg RDL','Hip Thrust','Glute Bridge','Back Extension','Good Morning','Kettlebell Swing','Nordic Curl','Superman','Band Pull-Through'];

test('every kit converts every session slot to a same-muscle move, never a hinge, never a repeat', () => {
  for (const kit of TW.KITS) {
    for (const [session, rows] of Object.entries(PROGRAM)) {
      const out = TW.convert(rows, { kit: kit.id, swap: X });
      assert.equal(out.length, rows.length, session);
      const names = new Set();
      out.forEach((it, i) => {
        assert.ok(!it.missing && it.name, `${kit.id} ${session}: ${it.plan} has no travel version`);
        assert.ok(!TW.isAvoided(it.name, X) && !X.isAvoided(it.name), it.name);
        assert.ok(kit.equip.includes(it.equip), `${it.name} uses ${it.equip} in a ${kit.id} kit`);
        assert.ok(!names.has(it.name), `${it.name} repeated in ${session}`); names.add(it.name);
        const plan = X.lookup(it.plan);
        assert.equal(it.muscle, plan.muscle, `${it.name} is ${it.muscle}, ${it.plan} is ${plan.muscle}`);
        assert.equal(it.plan, rows[i][0]);
        assert.equal(it.sets, rows[i][3]);
        assert.ok(it.reps && it.reps.lo <= it.reps.hi && it.reps.lo > 0, it.name + ' reps');
      });
    }
  }
});

test('the whole travel catalog is hinge-free and its muscles exist in ExerciseSwap', () => {
  const muscles = new Set(X.catalog.map(e => e.muscle));
  TW.catalog.forEach(e => {
    assert.ok(!X.isAvoided(e.name) && !TW.isAvoided(e.name), e.name);
    assert.ok(muscles.has(e.muscle), e.name + ': ' + e.muscle);
    assert.ok(['Dumbbell', 'Band', 'Bodyweight'].includes(e.equip), e.name);
  });
  HINGES.forEach(h => assert.ok(TW.isAvoided(h, X), h));
  assert.ok(!TW.isAvoided('Reverse Lunge', X) && !TW.isAvoided('Band Leg Curl (lying)', X));
});

test('dumbbells keep the plan reps and prefer ExerciseSwap dumbbell swaps; bands and bodyweight go higher', () => {
  const db = TW.convert(PROGRAM['Push A'], { kit: 'dumbbell', swap: X });
  const bench = db.find(i => i.plan === 'Bench Press (Barbell)');
  assert.equal(bench.name, 'Bench Press (Dumbbell)'); assert.equal(bench.via, 'swap');
  assert.deepEqual(bench.reps, { lo: 8, hi: 12 });
  assert.equal(bench.loggerId, 'bench-press-dumbbell');
  const incline = db.find(i => i.plan === 'Incline DB Press');
  assert.equal(incline.name, 'Incline DB Press'); assert.equal(incline.via, 'plan');
  const bw = TW.convert(PROGRAM['Push A'], { kit: 'bodyweight', swap: X });
  assert.equal(bw.find(i => i.plan === 'Bench Press (Barbell)').name, 'Push-Up');
  assert.equal(bw.find(i => i.plan === 'Incline DB Press').name, 'Decline Push-Up (feet raised)');
  bw.forEach(i => assert.ok(i.reps.lo >= 8, i.name));
  const band = TW.convert(PROGRAM['Lower A'], { kit: 'band', swap: X });
  const curl = band.find(i => i.plan === 'Lying Leg Curl');
  assert.match(curl.name, /Band Leg Curl/); assert.equal(curl.via, 'travel');
  assert.ok(curl.reps.lo >= 12);
  const abs = band.find(i => i.plan === 'Seated Abs');
  assert.ok(abs.reps.lo >= 100, 'plan of 100 reps is never lowered');
});

test('seconds-based moves are marked and accept plain names or PROGRAM rows', () => {
  const out = TW.convert(['Hip Adductor', 'Leg Extension'], { kit: 'bodyweight', swap: X });
  assert.equal(out[0].name, 'Copenhagen Plank'); assert.equal(out[0].reps.seconds, true);
  assert.equal(out[0].sets, null);
  const out2 = TW.convert([{ name: 'Hip Adductor', reps: 10, sets: 3 }], { kit: 'bodyweight', swap: X });
  assert.equal(out2[0].sets, 3);
});

test('unknown lifts and hinges in the plan do not produce a hinge', () => {
  const out = TW.convert(['Romanian Deadlift (Barbell)', 'Something new'], { kit: 'dumbbell', swap: X });
  assert.ok(out[0].missing || !X.isAvoided(out[0].name));
  assert.equal(out[1].missing, true); assert.equal(out[1].name, null);
});

test('apply links every travel move to its plan slot through ExerciseSwap, clear undoes it', () => {
  const items = TW.convert(PROGRAM['Lower A'], { kit: 'bodyweight', swap: X });
  const doc = { date: '2026-11-02', session: 'Lower A', sets: {}, swapped: { 'Pendulum Squat (Machine)': 'Hack Squat' } };
  const w = TW.apply(doc, items, 'bodyweight');
  assert.equal(TW.active(w), 'bodyweight');
  assert.equal(Object.keys(w.travel.map).length, 7);
  items.forEach(it => assert.equal(w.swapped[it.name], it.plan));
  assert.equal(w.swapped['Pendulum Squat (Machine)'], undefined, 'an earlier swap for the same slot is replaced');
  // sets logged under the travel name show under the plan lift
  w.sets[items[0].name] = [{ w: 0, r: 20 }];
  const h = X.history('Leg Extension', [w]);
  assert.equal(h.length, 1); assert.equal(h[0].via, 'swap'); assert.equal(h[0].name, items[0].name);
  const back = TW.clear(w);
  assert.equal(TW.active(back), null); assert.equal(back.swapped, undefined); assert.equal(back.travel, undefined);
  assert.equal(TW.active(doc), null, 'input docs are not mutated'); assert.equal(doc.swapped['Pendulum Squat (Machine)'], 'Hack Squat');
  // a manual swap made after apply survives clear
  const w2 = X.linkSwap(w, 'Standing Calf Raise', 'Seated Calf Raise (Machine)');
  assert.deepEqual(TW.clear(w2).swapped, { 'Seated Calf Raise (Machine)': 'Standing Calf Raise' });
});

test('card renders kit chips, the apply or clear button, and escapes text', () => {
  const html = TW.cardHtml({ session: 'Push A', exercises: PROGRAM['Push A'], kit: 'band', swap: X });
  assert.match(html, /data-act="twkit" data-kit="band" aria-pressed="true"/);
  assert.match(html, /data-act="twapply" data-kit="band"/);
  assert.match(html, /Band Chest Press/);
  assert.doesNotMatch(html, /twclear/);
  const on = TW.cardHtml({ session: 'Push A', exercises: PROGRAM['Push A'], active: 'dumbbell', swap: X });
  assert.match(on, /data-act="twclear"/); assert.match(on, /<details open/);
  const bad = TW.cardHtml({ session: '<b>x</b>', exercises: ['<script>'], kit: 'bodyweight', swap: X });
  assert.doesNotMatch(bad, /<script>/); assert.match(bad, /&lt;script&gt;/);
});
