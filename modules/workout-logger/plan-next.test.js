// Run: node --test modules/workout-logger/plan-next.test.js
// Up next follows the templates the person added; finished workouts are journaled until the store confirms them.
const test = require('node:test');
const assert = require('node:assert');
require('./workout-logger.js');
const { planNext, freshStart, journalStore, rotation } = globalThis.WorkoutLogger;
const DAY = 864e5;
const tpl = (id, name, folder, order) => ({ id, name, folder, order, exercises: [{ exId: 'x', sets: [{ t: 'n' }] }] });
const done = (templateName, daysAgo) => ({ id: 'w' + templateName + daysAgo, templateName, start: Date.now() - daysAgo * DAY, end: Date.now() - daysAgo * DAY + 36e5 });

test('no templates: nothing is up next (a new person sees no programme)', () => {
  assert.strictEqual(planNext({}, {}, null), null);
  assert.strictEqual(planNext(null, null, null), null);
});

test("Aziz's six Push / Pull / Lower templates keep the rotation with rest days", () => {
  const t = {}; rotation.filter(n => n !== 'Rest').forEach((n, i) => { t[n] = tpl(n, n, 'My program', i); });
  const fresh = planNext(t, {}, null);
  assert.strictEqual(fresh.name, 'Push A'); assert.deepStrictEqual(fresh.list, rotation);
  const afterLowerA = planNext(t, { a: done('Lower A', 1) }, null);
  assert.strictEqual(afterLowerA.name, 'Rest'); assert.strictEqual(afterLowerA.rest, true);
  assert.strictEqual(planNext(t, { a: done('Lower B', 2) }, null).name, 'Rest');
  assert.strictEqual(planNext(t, { a: done('Pull B', 0) }, null).name, 'Lower B');
});

test("someone else's templates cycle in their own order, no rest days", () => {
  const t = { u1: tpl('u1', 'Upper', 'Upper / Lower', 0), l1: tpl('l1', 'Lower', 'Upper / Lower', 1) };
  assert.deepStrictEqual(planNext(t, {}, null), { idx: 0, name: 'Upper', list: ['Upper', 'Lower'], last: null, rest: false });
  const w = { a: done('Upper', 2) };
  assert.strictEqual(planNext(t, w, null).name, 'Lower');
  assert.strictEqual(planNext(t, { a: done('Upper', 3), b: done('Lower', 1) }, null).name, 'Upper');
});

test('a programme added from New template cycles within its own folder', () => {
  const t = { 'np-ml-1': tpl('np-ml-1', 'Day 1', 'Muscle Ladder', 1), 'np-ml-2': tpl('np-ml-2', 'Day 2', 'Muscle Ladder', 2), 'np-ml-3': tpl('np-ml-3', 'Day 3', 'Muscle Ladder', 3), own: tpl('own', 'Arms', '', 0) };
  const p = planNext(t, { a: done('Day 2', 1) }, null);
  assert.deepStrictEqual(p.list, ['Day 1', 'Day 2', 'Day 3']); assert.strictEqual(p.name, 'Day 3');
  assert.strictEqual(planNext(t, { a: done('Day 3', 1) }, null).name, 'Day 1');
  // With no history yet every template is in the cycle, first one first.
  assert.deepStrictEqual(planNext(t, {}, null).list, ['Arms', 'Day 1', 'Day 2', 'Day 3']);
});

test('Skip to next overrides until the next finished workout', () => {
  const t = { a: tpl('a', 'A', '', 0), b: tpl('b', 'B', '', 1), c: tpl('c', 'C', '', 2) };
  const w = { x: done('A', 1) };
  assert.strictEqual(planNext(t, w, { idx: 2, at: Date.now() }).name, 'C');
  assert.strictEqual(planNext(t, w, { idx: 2, at: Date.now() - 3 * DAY }).name, 'B', 'an old skip is beaten by a newer workout');
  assert.strictEqual(planNext(t, w, { idx: 7, at: Date.now() }).name, 'B', 'an index from a longer old list is ignored');
});

test('a workout opened yesterday with nothing ticked is dated from its first set', () => {
  // Pinned to local noon: run at 00:30, "an hour ago" would fall on the previous day and this check would fail (main, Nov 8 00:03 UTC).
  const now = new Date().setHours(12, 0, 0, 0);
  const d = { start: now - 2 * DAY, exercises: [{ sets: [{ done: false }] }] };
  assert.strictEqual(freshStart(d, now), true); assert.strictEqual(d.start, now);
  const today = { start: now - 36e5, exercises: [{ sets: [{ done: false }] }] };
  assert.strictEqual(freshStart(today, now), false); assert.strictEqual(today.start, now - 36e5);
  const old = { start: now - 2 * DAY, exercises: [{ sets: [{ done: true }, { done: false }] }] };
  assert.strictEqual(freshStart(old, now), false, 'sets already ticked on the earlier day keep that date');
});

test('journal keeps a finished workout until the store confirms that exact copy', () => {
  const mem = {}; const ls = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  const j = journalStore(ls);
  const w = { id: 'w1', end: 5, exercises: [] };
  j.add(w);
  assert.deepStrictEqual(j.list(), [w]);
  j.drop('w1', { id: 'w1', end: 6, exercises: [] });
  assert.strictEqual(j.list().length, 1, 'a different copy does not clear the entry');
  j.drop('w1', w);
  assert.deepStrictEqual(j.list(), []);
  j.add(w); j.drop('w1');
  assert.deepStrictEqual(j.list(), [], 'drop without a copy always clears (delete)');
});
