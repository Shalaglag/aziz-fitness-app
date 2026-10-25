// Run: node modules/form-cues/form-cues.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const FormCues = require('./form-cues.js');
const guide = JSON.parse(fs.readFileSync(path.join(__dirname, 'exercise-form-guide.json'), 'utf8'));
const fc = FormCues.create(guide);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

// Every exercise in Aziz's six templates, as the workout logger names them.
const LOGGER_NAMES = ['Bench Press (Barbell)', 'Incline Bench Press (Dumbbell)', 'Gundam Chest Press (Machine)', 'Cable Crossover',
  'Seated Overhead Press (Dumbbell)', 'Lateral Raise (Dumbbell)', 'Lateral Raise (Cable)', 'Standing Lateral Raise (Machine)',
  'Front Raise (Dumbbell)', 'Reverse Fly (Machine)', 'Triceps Extension (Cable)', 'Triceps Pushdown (Straight Bar)',
  'Triceps Rope Pushdown (Cable)', 'Lat Pulldown - Wide Grip (Cable)', 'Lat Pulldown - Single Arm (Cable)', 'Seated Row (Cable)',
  'Pullover (Machine)', 'T-Bar Row', 'Iso-Lateral Low Row (Plate-loaded)', 'Shrug (Machine)', 'Bicep Curl (Dumbbell)',
  'Seated Bicep Curl (Machine)', 'Standing Bicep Curl (Cable)', 'Hack Squat (Machine)', 'Squat (Smith Machine)',
  'Leg Extension (Machine)', 'Lying Leg Curl (Machine)', 'Hip Adductor (Machine)', 'Hip Abductor (Machine)',
  'Standing Calf Raise (Machine)', 'Calf Press (Leg Press)', 'Seated Abs (Machine)', 'Treadmill (Incline Walk)'];

t('guide has 32 exercises', () => assert.strictEqual(fc.size, 32));

t('every template exercise resolves by logger id and by name', () => {
  LOGGER_NAMES.forEach(name => {
    assert.ok(fc.find(FormCues.slug(name)), 'id ' + name);
    assert.ok(fc.find(name), 'name ' + name);
  });
});

t('every guide exercise is reachable from the templates', () => {
  const hit = new Set(LOGGER_NAMES.map(x => fc.find(x).id));
  guide.exercises.forEach(e => assert.ok(hit.has(e.id), e.id));
});

t('Strong / shell names resolve', () => {
  guide.exercises.forEach(e => (e.loggedAs || []).forEach(n => assert.strictEqual(fc.find(n).id, e.id, n)));
  ['Incline DB Press', 'Lat Pulldown, Wide', 'Gundam (Chest Machine)', 'Side Delts', 'Traps Machine', 'Seated Bicep Curl',
    'Iso-Lateral Low Row', 'Cable Standing Biceps', 'Triceps Rope'].forEach(n => assert.ok(fc.find(n), n));
});

t('specific matches are the right ones', () => {
  assert.strictEqual(fc.find('incline-bench-press-dumbbell').id, 'incline-db-press');
  assert.strictEqual(fc.find('Triceps Extension (Cable)').id, 'cable-overhead-triceps-extension');
  assert.strictEqual(fc.find('Standing Lateral Raise (Machine)').id, 'machine-lateral-raise');
  assert.strictEqual(fc.find('Lateral Raise (Dumbbell)').id, 'lateral-raise');
});

t('unknown exercises return null and render nothing', () => {
  assert.strictEqual(fc.find('Deadlift (Barbell)'), null);
  assert.strictEqual(fc.find(''), null);
  assert.strictEqual(fc.inlineHtml(null), '');
  assert.strictEqual(fc.detailHtml(null), '');
});

t('inline panel has cues, watch-outs, muscles and demo link', () => {
  const h = fc.inlineHtml(fc.find('bench-press-barbell'), 'bench-press-barbell');
  assert.ok(h.includes('Bend the bar'));
  assert.ok(h.includes('Watch for'));
  assert.ok(h.includes('class="fc-chip p">Chest'));
  assert.ok(h.includes('Triceps'));
  assert.ok(h.includes('https://www.youtube.com/results?search_query=Bench%20Press%20proper%20form'));
  assert.ok(h.includes('rel="noopener noreferrer"'));
  assert.ok(!/ open>/.test(h.split('<summary>')[0]));
});

t('detail section has setup, steps and all mistakes', () => {
  const e = fc.find('hack-squat-machine'), h = fc.detailHtml(e);
  e.setup.concat(e.steps).forEach(s => assert.ok(h.includes(s.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')), s));
  assert.strictEqual((h.match(/<li>/g) || []).length, e.cues.length + e.setup.length + e.steps.length + e.mistakes.length);
});

t('text is escaped', () => {
  const x = FormCues.create({ exercises: [{ id: 'x', name: 'X <b>', cues: ['<img onerror=1>'], primary: ['"a"'] }] });
  const h = x.inlineHtml(x.find('x'));
  assert.ok(!h.includes('<img'));
  assert.ok(h.includes('&lt;img onerror=1&gt;'));
  assert.ok(h.includes('&quot;a&quot;'));
});

t('custom demo url wins', () => {
  assert.strictEqual(FormCues.demoUrl({ name: 'A', demo: 'https://example.com/v' }), 'https://example.com/v');
});

t('open state survives re-render', () => {
  let handler;
  const doc = { addEventListener: (type, fn, cap) => { assert.strictEqual(type, 'toggle'); assert.strictEqual(cap, true); handler = fn; } };
  fc.attach(doc);
  const el = open => ({ open, matches: s => s === 'details.fc-inline', getAttribute: () => 'k1' });
  const e = fc.find('Leg Extension');
  handler({ target: el(true) });
  assert.ok(/<details[^>]* open>/.test(fc.inlineHtml(e, 'k1')));
  handler({ target: el(false) });
  assert.ok(!/<details[^>]* open>/.test(fc.inlineHtml(e, 'k1')));
});

t('css uses shell tokens only', () => {
  (FormCues.css.match(/var\(--[a-z-]+/g) || []).forEach(v =>
    assert.ok(['--line', '--r', '--sunk', '--accent', '--muted', '--ink', '--warn', '--accent-ink', '--surface'].includes(v.slice(4)), v));
});

console.log(n + ' tests passed');
