// Run: node modules/workout-logger/gym-mode.test.js
const assert = require('assert');
require('./workout-logger.js');
const { gymOrder, nextPending, resumePoint, restAfter, compareSets, weightStep, bumpVal } = globalThis.WorkoutLogger.gym;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const sets = (k, done = 0) => Array.from({ length: k }, (_, i) => ({ t: 'n', w: '', r: '', done: i < done }));

t('straight sets run top to bottom', () => {
  const exs = [{ sets: sets(2) }, { sets: sets(3) }];
  assert.deepStrictEqual(gymOrder(exs), [[0, 0], [0, 1], [1, 0], [1, 1], [1, 2]]);
});

t('a superset alternates A1 B1 A2 B2, uneven set counts finish on the longer one', () => {
  const exs = [{ sets: sets(1) }, { ss: 'g', sets: sets(3) }, { ss: 'g', sets: sets(2) }, { sets: sets(1) }];
  assert.deepStrictEqual(gymOrder(exs), [[0, 0], [1, 0], [2, 0], [1, 1], [2, 1], [1, 2], [3, 0]]);
});

t('two separate supersets next to each other stay separate', () => {
  const exs = [{ ss: 'a', sets: sets(2) }, { ss: 'a', sets: sets(2) }, { ss: 'b', sets: sets(1) }, { ss: 'b', sets: sets(1) }];
  assert.deepStrictEqual(gymOrder(exs), [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [3, 0]]);
});

t('next pending skips done sets and wraps round to skipped ones', () => {
  const exs = [{ sets: sets(3, 1) }, { sets: sets(2) }];
  assert.deepStrictEqual(nextPending(exs, null), [0, 1]);
  assert.deepStrictEqual(nextPending(exs, [0, 1]), [0, 2]);
  exs[1].sets.forEach(s => { s.done = true; });
  assert.deepStrictEqual(nextPending(exs, [1, 1]), [0, 1], 'wraps to the skipped set');
  exs[0].sets.forEach(s => { s.done = true; });
  assert.strictEqual(nextPending(exs, [0, 2]), null);
});

t('resume picks up after the furthest checked set, not at a skipped warm-up', () => {
  const exs = [{ sets: [{ t: 'w' }, { t: 'n', done: true }, { t: 'n' }] }, { sets: sets(2) }];
  assert.deepStrictEqual(resumePoint(exs), [0, 2]);
  exs[0].sets[2].done = true; exs[1].sets.forEach(x => { x.done = true; });
  assert.deepStrictEqual(resumePoint(exs), [0, 0], 'only the skipped warm-up is left');
  assert.deepStrictEqual(resumePoint([{ sets: sets(2) }]), [0, 0]);
});

t('rest timer waits until the superset round is over', () => {
  const exs = [{ ss: 'g', sets: sets(3) }, { ss: 'g', sets: sets(2) }, { sets: sets(2) }];
  exs[0].sets[0].done = true; assert.strictEqual(restAfter(exs, 0, 0), false, 'A1 -> B1, no rest');
  exs[1].sets[0].done = true; assert.strictEqual(restAfter(exs, 1, 0), true, 'B1 -> A2, rest');
  exs[0].sets[1].done = true; exs[1].sets[1].done = true;
  exs[0].sets[2].done = true; assert.strictEqual(restAfter(exs, 0, 2), true, 'A3 has no partner left, rest');
  assert.strictEqual(restAfter(exs, 2, 0), true, 'straight sets always rest');
});

t('comparison with last time: weight, reps and est. 1RM deltas', () => {
  const d = compareSets({ w: '62.5', r: '9' }, { w: 60, r: 10 }, 'kg', 'kg');
  assert.strictEqual(d.dw, 2.5); assert.strictEqual(d.dr, -1);
  assert.ok(Math.abs(d.de - (62.5 * 1.3 - 60 * (1 + 10 / 30))) < 0.06);
});

t('comparison converts last time from lb and leaves missing fields null', () => {
  const d = compareSets({ w: '25', r: '' }, { w: 50, r: 10 }, 'kg', 'lb');
  assert.strictEqual(d.dw, Math.round((25 - 50 * 0.45359237) * 100) / 100);
  assert.strictEqual(d.dr, null); assert.strictEqual(d.de, null);
  assert.strictEqual(compareSets({ w: 1, r: 1 }, null, 'kg'), null);
});

t('quick-adjust steps match the equipment', () => {
  assert.strictEqual(weightStep({ cat: 'Dumbbell' }, 'kg'), 2);
  assert.strictEqual(weightStep({ cat: 'Barbell' }, 'kg'), 2.5);
  assert.strictEqual(weightStep({ cat: 'Machine' }, 'kg'), 2.5);
  assert.strictEqual(weightStep({ cat: 'Dumbbell' }, 'lb'), 5);
});

t('quick adjust never goes below zero and avoids float noise', () => {
  assert.strictEqual(bumpVal('0.1', 0.2), 0.3);
  assert.strictEqual(bumpVal('2', -2.5), 0);
  assert.strictEqual(bumpVal('', 2.5), 2.5);
  assert.strictEqual(bumpVal('82.5', 2.5), 85);
});

t('shell record keeps RIR when it was logged', () => {
  const w = { start: Date.now() - 36e5, end: Date.now(), templateName: 'Push A', name: 'Push A', exercises: [
    { exId: 'bench-press-barbell', unit: 'kg', sets: [{ t: 'w', w: '20', r: '10', done: true }, { t: 'n', w: '60', r: '8', rir: 2, done: true }, { t: 'n', w: '60', r: '7', done: true }] }] };
  const rec = globalThis.WorkoutLogger.toShellRecord(w), b = rec.sets[Object.keys(rec.sets)[0]];
  assert.deepStrictEqual(b, [{ w: 60, r: 8, unit: 'kg', rir: 2 }, { w: 60, r: 7, unit: 'kg' }]);
});


// ---- Machine weight steps ----
const { snapStep, stepWeight, warmSets, loadableUp } = globalThis.WorkoutLogger.gym;
t('an exercise can override the weight step; it converts when logging in the other unit', () => {
  assert.strictEqual(weightStep({ cat: 'Machine', step: 5, stepUnit: 'kg' }, 'kg'), 5);
  assert.strictEqual(weightStep({ cat: 'Machine', step: 1.25, stepUnit: 'kg' }, 'kg'), 1.25);
  assert.strictEqual(weightStep({ cat: 'Dumbbell', step: 0, stepUnit: 'kg' }, 'kg'), 2, 'zero means default');
  assert.strictEqual(weightStep({ cat: 'Machine', step: 5, stepUnit: 'kg' }, 'lb'), 11, '5 kg -> 11.02 lb, rounded to 0.25');
  assert.strictEqual(weightStep({ cat: 'Machine', step: 10, stepUnit: 'lb' }, 'kg'), 4.5);
  assert.strictEqual(weightStep({ cat: 'Machine', step: 7, unit: 'kg' }, 'kg'), 7, 'old docs without stepUnit use the exercise unit');
});

t('stepping a weight lands on the machine grid', () => {
  assert.strictEqual(stepWeight('61', 1, 2.5), 62.5);
  assert.strictEqual(stepWeight('61', -1, 2.5), 57.5);
  assert.strictEqual(stepWeight('60', 1, 2.5), 62.5);
  assert.strictEqual(stepWeight('', 1, 5), 5);
  assert.strictEqual(stepWeight('3', -1, 5), 0, 'never below zero');
  assert.strictEqual(stepWeight('22.5', 1, 1.25), 23.75);
  assert.strictEqual(snapStep(63.5, 2.5), 62.5);
  assert.strictEqual(snapStep(63.5, 0), 63.5, 'no step, no snapping');
});

t('warm-up sets round to the given step', () => {
  const w = warmSets(100, 'kg', 20, 5).map(s => s.w);
  assert.deepStrictEqual(w, [20, 50, 70, 85]);
  const fine = warmSets(61, 'kg', 20).map(s => s.w);
  assert.ok(fine.every(v => Math.abs(v / 2.5 - Math.round(v / 2.5)) < 1e-9), 'default 2.5 grid: ' + fine);
});

t('plate rounding finds the next loadable per-side weight', () => {
  assert.strictEqual(loadableUp(20, 'kg'), 20, 'already loadable');
  assert.strictEqual(loadableUp(21, 'kg'), 21.25, '21 -> 20 + 1.25 plate');
  assert.strictEqual(loadableUp(0.6, 'kg'), 1.25);
});

t('−15 keeps the rest length so the ring drops with the number; +15 only grows it past full', () => {
  const { adjustRest } = globalThis.WorkoutLogger.gym;
  const now = 1e6, r = { end: now + 60000, total: 90, buzz: 3, alerted: false };
  const less = adjustRest(r, -15, now);
  assert.strictEqual(less.end, now + 45000); assert.strictEqual(less.total, 90);
  assert.strictEqual((less.end - now) / (less.total * 1000), 0.5, 'ring at half, not 45/75');
  assert.strictEqual(less.buzz, undefined, '3-2-1 buzz re-arms');
  const more = adjustRest(r, 15, now); assert.strictEqual(more.total, 90); assert.strictEqual(more.end, now + 75000);
  const over = adjustRest({ end: now + 85000, total: 90 }, 15, now); assert.strictEqual(over.total, 100, 'past full: length grows');
  const gone = adjustRest({ end: now + 10000, total: 90 }, -15, now); assert.strictEqual(gone.end, now, 'never below now');
});

t('typed rest times: m:ss, seconds, minutes, off, bad input', () => {
  const { parseRest } = globalThis.WorkoutLogger;
  assert.strictEqual(parseRest('1:45'), 105);
  assert.strictEqual(parseRest(' 2:05 '), 125);
  assert.strictEqual(parseRest('105'), 105, 'plain 10+ = seconds');
  assert.strictEqual(parseRest('2'), 120, 'plain under 10 = minutes');
  assert.strictEqual(parseRest('2.5'), 150);
  assert.strictEqual(parseRest('2m'), 120);
  assert.strictEqual(parseRest('1m30s'), 90);
  assert.strictEqual(parseRest('95s'), 95);
  assert.strictEqual(parseRest('0'), 0);
  assert.strictEqual(parseRest('off'), 0);
  assert.strictEqual(parseRest('1:75'), null);
  assert.strictEqual(parseRest('abc'), null);
  assert.strictEqual(parseRest(''), null);
  assert.strictEqual(parseRest('120:00'), 3600, 'capped at an hour');
});

t('a set\'s own rest wins over the exercise rest', () => {
  const { setRestOf } = globalThis.WorkoutLogger;
  const e = { exId: 'x-none', rest: 100, sets: [{ rest: 75 }, {}] };
  assert.strictEqual(setRestOf(e, e.sets[0]), 75);
  assert.strictEqual(setRestOf(e, e.sets[1]), 100);
  assert.strictEqual(setRestOf(e, { rest: -1 }), -1, 'off for one set');
});

t('next exercise: the following one with sets left, read from the current order', () => {
  const { nextExIndex: nextExercise } = globalThis.WorkoutLogger.gym;
  const exs = [{ sets: sets(2, 1) }, { sets: sets(2, 2) }, { sets: sets(3) }];
  assert.strictEqual(nextExercise(exs, 0), 2, 'skips a finished exercise');
  assert.strictEqual(nextExercise(exs, 2), 0, 'wraps round to a skipped earlier one');
  exs.reverse();
  assert.strictEqual(nextExercise(exs, 0), 2, 'follows a reorder');
  exs[2].sets.forEach(s => { s.done = true; });
  assert.strictEqual(nextExercise(exs, 0), null, 'null when nothing else is left');
  const ss = [{ ss: 'a', sets: sets(2) }, { ss: 'a', sets: sets(2) }, { sets: sets(1) }];
  assert.strictEqual(nextExercise(ss, 0), 2, 'superset partner is not "next"');
});

console.log('\n' + n + ' tests passed');
