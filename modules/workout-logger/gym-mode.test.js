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

console.log('\n' + n + ' tests passed');
