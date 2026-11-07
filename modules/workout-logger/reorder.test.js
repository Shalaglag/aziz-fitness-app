// Run: node --test modules/workout-logger/reorder.test.js
const test = require('node:test');
const assert = require('assert');
require('./workout-logger.js');
const { dropIndex, moveItem } = globalThis.WorkoutLogger.reorder;
const mids = [50, 110, 170, 230]; // folded exercise rows, centre Y of each

test('holding without moving keeps the exercise where it is', () => {
  assert.strictEqual(dropIndex(mids, 0, 50), 0);
  assert.strictEqual(dropIndex(mids, 2, 170), 2);
});

test('dragging past another row centre swaps places', () => {
  assert.strictEqual(dropIndex(mids, 0, 115), 1);
  assert.strictEqual(dropIndex(mids, 0, 300), 3, 'below the last row goes to the end');
  assert.strictEqual(dropIndex(mids, 3, 105), 1);
  assert.strictEqual(dropIndex(mids, 3, 0), 0, 'above the first row goes to the top');
});

test('moving keeps every exercise object, with its sets, intact', () => {
  const sets = [{ w: 60, r: 8, done: true }, { w: 60, r: 7, done: false }];
  const a = [{ exId: 'bench', sets }, { exId: 'row', sets: [] }, { exId: 'curl', sets: [], ss: 'g1' }];
  const bench = a[0];
  assert.ok(moveItem(a, 0, 2));
  assert.deepStrictEqual(a.map(e => e.exId), ['row', 'curl', 'bench']);
  assert.strictEqual(a[2], bench, 'same object, not a copy');
  assert.strictEqual(a[2].sets, sets);
  assert.deepStrictEqual(a[2].sets, [{ w: 60, r: 8, done: true }, { w: 60, r: 7, done: false }]);
  assert.strictEqual(a[1].ss, 'g1');
  assert.strictEqual(moveItem(a, 1, 1), false, 'dropping in place changes nothing');
  assert.strictEqual(a.length, 3);
});

test('the editor folds the list and binds the hold-to-drag handler', () => {
  const src = require('fs').readFileSync(__dirname + '/workout-logger.js', 'utf8');
  assert.ok(src.includes('bindReorder(liveEl)'));
  assert.ok(src.includes('.lb-reordering .lb-exblock>:not(.lb-exhead)'));
  assert.ok(src.includes("opt('exUp', 'Move up')"), 'Move up / down stay in the ••• menu');
});
