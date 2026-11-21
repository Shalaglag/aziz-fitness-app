// Run: node --test modules/workout-logger/same-day-prev.test.js
// "Last time" numbers come from the same template day: Lower B shows Lower B's weights, not Lower A's.
const test = require('node:test');
const assert = require('assert');
require('./workout-logger.js');
const { pickPrev } = globalThis.WorkoutLogger;

const s = (w, kg) => ({ w, e: { exId: 'leg-press', unit: 'kg', sets: [{ t: 'n', w: String(kg), r: '10' }] } });
const lowerA = { id: 'wa', templateId: 'tA', templateName: 'Lower A', name: 'Lower A' };
const lowerB = { id: 'wb', templateId: 'tB', templateName: 'Lower B', name: 'Lower B' };

test('the same template day wins over a newer session from another day', () => {
  const list = [s(lowerA, 140), s(lowerB, 110)]; // newest first: Lower A was the latest
  assert.strictEqual(pickPrev(list, { templateId: 'tB', name: 'Lower B' }).e.sets[0].w, '110');
  assert.strictEqual(pickPrev(list, { templateId: 'tA', name: 'Lower A' }).e.sets[0].w, '140');
});

test('falls back to the newest session anywhere when this day has none', () => {
  const list = [s(lowerA, 140)];
  assert.strictEqual(pickPrev(list, { templateId: 'tB', name: 'Lower B' }).e.sets[0].w, '140');
  assert.strictEqual(pickPrev(list, { name: 'Quick workout' }).e.sets[0].w, '140');
  assert.strictEqual(pickPrev(list, null).e.sets[0].w, '140');
  assert.strictEqual(pickPrev([], lowerB), null);
});

test('imported or older workouts without a template id match by name, ignoring a " · Travel" suffix', () => {
  const imported = { id: 'wi', name: 'Lower B' };
  const list = [s(lowerA, 140), s(imported, 105)];
  assert.strictEqual(pickPrev(list, { templateId: 'tB', templateName: 'Lower B', name: 'Lower B · Travel' }).e.sets[0].w, '105');
  assert.strictEqual(pickPrev(list, { name: 'lower b' }).e.sets[0].w, '105');
});

test('a same-id session beats a same-name one', () => {
  const renamed = { id: 'wr', templateId: 'tB', name: 'Legs (B)' };
  const list = [s({ id: 'x', name: 'Lower B' }, 100), s(renamed, 120)];
  assert.strictEqual(pickPrev(list, { templateId: 'tB', name: 'Lower B' }).e.sets[0].w, '120');
});
