// Run: node --test modules/exercise-demos/exercise-demos.test.js
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
global.window = global; global.document = {};
require('../workout-logger/workout-logger.js');
const ExerciseDemos = require('./exercise-demos.js');
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'demos.json'), 'utf8'));
const library = window.WorkoutLogger.library;
const clone = o => JSON.parse(JSON.stringify(o));
const make = mut => { const d = clone(DATA); if (mut) mut(d.demos); return ExerciseDemos.create(d, { library }); };
const item = (o) => Object.assign({ kind: 'link', url: 'https://www.youtube.com/watch?v=abc123', status: 'verified', source: 'Test', checkedBy: 'Aziz', checkedAt: '2026-10-26' }, o);

test('every library exercise has a registry entry and the shipped data validates', () => {
  const dm = make();
  Object.keys(library).forEach(id => assert.ok(dm.entry(id), id));
  assert.deepStrictEqual(dm.validate(), []);
  assert.strictEqual(dm.size, 124);
});

test('shipped data has no URL nobody has checked', () => {
  Object.values(DATA.demos).forEach(e => (e.items || []).forEach(it => assert.ok(it.status !== 'verified' || (it.checkedBy && it.checkedAt), e.name)));
});

test('ids resolve by id, exact name and alias only', () => {
  const dm = make();
  assert.strictEqual(dm.id('seated-row-machine'), 'seated-row-machine');
  assert.strictEqual(dm.id('Seated Row (Machine)'), 'seated-row-machine');
  assert.strictEqual(dm.id('Incline DB Press'), 'incline-bench-press-dumbbell');
  assert.strictEqual(dm.id('Gundam (chest machine)'), 'gundam-chest-press-machine');
  assert.strictEqual(dm.id('Seated Row'), null, 'no fuzzy match onto cable or machine row');
  assert.strictEqual(dm.id('Side Delts'), null, 'ambiguous plan name stays unmapped');
  assert.strictEqual(dm.id(''), null);
});

test('unchecked items are never returned as a demo', () => {
  const dm = make(d => { d['seated-row-cable'].items = [item({ status: 'review', checkedBy: null, checkedAt: null })]; });
  assert.strictEqual(dm.best('seated-row-cable'), null);
  assert.strictEqual(dm.status('seated-row-cable'), 'review');
  assert.strictEqual(dm.candidates('seated-row-cable').length, 1);
  const l = dm.link('seated-row-cable');
  assert.strictEqual(l.verified, false);
  assert.match(l.href, /youtube\.com\/results/);
});

test('verified needs checkedBy and checkedAt', () => {
  const dm = make(d => { d['seated-row-cable'].items = [item({ checkedAt: '' })]; });
  assert.strictEqual(dm.best('seated-row-cable'), null);
  assert.ok(dm.validate().some(p => /verified without/.test(p.problem)));
});

test('a checked item becomes the Demo link', () => {
  const dm = make(d => { d['seated-row-cable'].items = [item()]; });
  assert.strictEqual(dm.status('seated-row-cable'), 'verified');
  assert.deepStrictEqual(dm.link('Seated Row (Cable)').href, 'https://www.youtube.com/watch?v=abc123');
  assert.strictEqual(dm.link('Seated Row (Cable)').label, 'Demo ↗');
});

test('equipment mismatch with the library blocks the demo', () => {
  const dm = make(d => { d['seated-row-machine'].equipment = 'Cable'; d['seated-row-machine'].items = [item()]; });
  assert.strictEqual(dm.best('seated-row-machine'), null);
  assert.ok(dm.validate().some(p => p.id === 'seated-row-machine' && /Equipment/.test(p.problem)));
});

test('one URL reused across different equipment is flagged', () => {
  const dm = make(d => { d['lateral-raise-cable'].items = [item()]; d['lateral-raise-dumbbell'].items = [item()]; });
  assert.ok(dm.validate().some(p => /different equipment/.test(p.problem)));
});

test('an item marked incorrect hides every demo for that exercise', () => {
  const dm = make(d => { d['seated-row-cable'].items = [item(), item({ url: 'https://www.youtube.com/watch?v=zzz', status: 'incorrect' })]; });
  assert.strictEqual(dm.status('seated-row-cable'), 'incorrect');
  assert.strictEqual(dm.best('seated-row-cable'), null);
});

test('unsafe or non-https URLs are rejected', () => {
  const dm = make(d => { d['seated-row-cable'].items = [item({ url: 'javascript:alert(1)' }), item({ url: 'http://x.com/a' })]; });
  assert.strictEqual(dm.best('seated-row-cable'), null);
  assert.strictEqual(dm.validate().filter(p => /https/.test(p.problem)).length, 2);
});

test('self-hosted clips need a licence and are preferred, with angle choice', () => {
  const dm = make(d => { d['hack-squat-machine'].items = [item(), item({ kind: 'video', url: 'demos/hack-squat-side.mp4', angle: 'side', licence: 'own recording' }), item({ kind: 'video', url: 'demos/hack-squat-front.mp4', angle: 'front', licence: 'own recording' })]; });
  assert.strictEqual(dm.best('hack-squat-machine').url, 'demos/hack-squat-side.mp4');
  assert.strictEqual(dm.best('hack-squat-machine', 'front').url, 'demos/hack-squat-front.mp4');
  const bad = make(d => { d['hack-squat-machine'].items = [item({ kind: 'video', url: 'demos/x.mp4' })]; });
  assert.ok(bad.validate().some(p => /licence/.test(p.problem)));
});

test('custom exercises get a search that keeps the equipment words', () => {
  const dm = make();
  const l = dm.link('c-my-lift', 'Seated Row (Machine)');
  assert.strictEqual(l.verified, false);
  assert.ok(decodeURIComponent(l.href).includes('Seated Row Machine proper form'));
});

test('summary counts every entry once', () => {
  const s = make().summary();
  assert.strictEqual(s.total, 124);
  assert.strictEqual(s.verified, 0);
  assert.strictEqual(s.review + s.missing, 124);
});

test('sheet html escapes and labels unchecked finds', () => {
  const dm = make(d => { d['seated-row-cable'].items = [item({ status: 'review', title: '<b>x</b>' })]; });
  const h = dm.sheetHtml('seated-row-cable');
  assert.ok(h.includes('Found, not checked yet'));
  assert.ok(!h.includes('<b>x</b>'));
});
