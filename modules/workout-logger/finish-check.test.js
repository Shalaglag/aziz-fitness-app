// Run: node --test modules/workout-logger/finish-check.test.js
// "Finish and check remaining sets": every unchecked set with numbers (or last time's numbers) gets ticked before the save.
const test = require('node:test');
const assert = require('assert');
require('./workout-logger.js');
const { fillRemaining } = globalThis.WorkoutLogger;

const fields = () => ['w', 'r'];
const ex = () => ({ cat: 'Chest' });
const prev = () => ({ sets: [{ t: 'n', w: '60', r: '10' }], unit: 'kg' });
const match = (pv, e, j) => pv.sets[j] || null;
const ph = (pv, p, e, k) => p && p[k] != null && p[k] !== '' ? p[k] : '';
const set = (w, r, done = false) => ({ t: 'n', w, r, done });

test('sets with numbers are ticked, blanks take last time, nothing-to-fill stays unchecked', () => {
  const exs = [{ exId: 'a', unit: 'kg', sets: [set('80', '8', true), set('80', '7'), set('', ''), set('', '')] }];
  const seen = [];
  const n = fillRemaining(exs, fields, ex, ph, prev, match, (e, s) => seen.push(s.w + 'x' + s.r));
  assert.strictEqual(n, 1, 'set 4 has no number and no last-time match, so only set 2 is ticked');
  assert.deepStrictEqual(exs[0].sets.map(s => !!s.done), [true, true, false, false]);
  assert.deepStrictEqual(seen, ['80x7']);
});

test('blank set 1 takes last time’s numbers and is ticked', () => {
  const exs = [{ exId: 'a', unit: 'kg', sets: [set('', '')] }];
  assert.strictEqual(fillRemaining(exs, fields, ex, ph, prev, match), 1);
  assert.deepStrictEqual(exs[0].sets[0], { t: 'n', w: '60', r: '10', done: true });
});

test('already-checked sets are left alone and counting on a clone changes nothing', () => {
  const exs = [{ exId: 'a', unit: 'kg', sets: [set('50', '5', true), set('50', '5')] }];
  const copy = JSON.parse(JSON.stringify(exs));
  assert.strictEqual(fillRemaining(copy, fields, ex, ph, prev, match), 1);
  assert.strictEqual(exs[0].sets[1].done, false);
});
