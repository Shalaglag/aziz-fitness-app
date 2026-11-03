// Run: node --test modules/workout-logger/settings-load.test.js
// A setting changed while the logger is still loading (e.g. the rest timer look picked in Settings while a long
// workout history loads) must survive the load, and must not wipe the other saved settings.
const test = require('node:test');
const assert = require('assert');
require('./workout-logger.js');
const { mergeSettings } = globalThis.WorkoutLogger;
const DEF = { restStyle: 'bar', gym: false, restCompound: 150, sound: true };

test('saved settings sit over the defaults', () => {
  assert.deepStrictEqual(mergeSettings(DEF, { id: 'settings', restStyle: 'ring', gym: true }, null), { restStyle: 'ring', gym: true, restCompound: 150, sound: true });
});

test('a look picked before the saved settings arrived wins over the saved one', () => {
  const s = mergeSettings(DEF, { id: 'settings', restStyle: 'plates', gym: true, restCompound: 180 }, { restStyle: 'fill' });
  assert.strictEqual(s.restStyle, 'fill');
  assert.strictEqual(s.gym, true, 'Gym mode stays as saved');
  assert.strictEqual(s.restCompound, 180, 'other saved settings are kept');
});

test('picking the default look early still counts', () => {
  assert.strictEqual(mergeSettings(DEF, { restStyle: 'ring' }, { restStyle: 'bar' }).restStyle, 'bar');
});

test('nothing saved yet: defaults plus the early pick', () => {
  assert.deepStrictEqual(mergeSettings(DEF, undefined, { gym: true }), Object.assign({}, DEF, { gym: true }));
});

test('defaults are not changed by a merge', () => {
  mergeSettings(DEF, { restStyle: 'ring' }, { gym: true });
  assert.strictEqual(DEF.restStyle, 'bar'); assert.strictEqual(DEF.gym, false);
});
