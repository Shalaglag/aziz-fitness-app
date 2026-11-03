// Run: node --test modules/workout-logger/swipe-delete.test.js
const test = require('node:test');
const assert = require('assert');
require('./workout-logger.js');
const { swipeDecision } = globalThis.WorkoutLogger.swipe;
const W = 328; // a set row on a 360 px phone

test('a short drag or a mostly vertical one does nothing', () => {
  assert.strictEqual(swipeDecision(-20, 0, W), 'none');
  assert.strictEqual(swipeDecision(-60, -80, W), 'none', 'scrolling, not swiping');
  assert.strictEqual(swipeDecision(0, 0, W), 'none');
});

test('swiping right never deletes', () => {
  assert.strictEqual(swipeDecision(300, 0, W), 'none');
});

test('a swipe of 40 px or more reveals the Delete button', () => {
  assert.strictEqual(swipeDecision(-40, 5, W), 'reveal');
  assert.strictEqual(swipeDecision(-120, 10, W), 'reveal');
});

test('past half the row the set is deleted on release', () => {
  assert.strictEqual(swipeDecision(-W * 0.55, 0, W), 'delete');
  assert.strictEqual(swipeDecision(-W, 0, W), 'delete');
  assert.strictEqual(swipeDecision(-W * 0.5, 0, W), 'reveal');
});

test('the markup gives every set row a Delete panel behind it', () => {
  const src = require('fs').readFileSync(__dirname + '/workout-logger.js', 'utf8');
  assert.ok(src.includes('<div class="lb-setwrap"><div class="lb-swipe-del"><button class="lb-swipe-btn" data-a="delSet"'));
  assert.ok(src.includes('Delete this set'), 'the set-type sheet keeps its delete option');
});
