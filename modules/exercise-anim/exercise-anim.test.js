// Run: node --test modules/exercise-anim/exercise-anim.test.js
const test = require('node:test');
const assert = require('assert');
global.window = global; global.document = undefined;
require('../workout-logger/workout-logger.js');
const A = require('./exercise-anim.js');
const library = window.WorkoutLogger.library;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const FRAMES = 32;

// The 33 exercises in Aziz's Push/Pull/Lower templates (logger ids).
const PLAN = ['bench-press-barbell', 'incline-bench-press-dumbbell', 'gundam-chest-press-machine', 'cable-crossover', 'seated-overhead-press-dumbbell',
  'lateral-raise-cable', 'lateral-raise-dumbbell', 'standing-lateral-raise-machine', 'front-raise-dumbbell', 'reverse-fly-machine', 'triceps-extension-cable',
  'triceps-pushdown-straight-bar', 'triceps-rope-pushdown-cable', 'lat-pulldown-wide-grip-cable', 'lat-pulldown-single-arm-cable', 'seated-row-cable',
  'pullover-machine', 't-bar-row', 'iso-lateral-low-row-plate-loaded', 'shrug-machine', 'bicep-curl-dumbbell', 'seated-bicep-curl-machine',
  'standing-bicep-curl-cable', 'hack-squat-machine', 'squat-smith-machine', 'leg-extension-machine', 'lying-leg-curl-machine', 'hip-adductor-machine',
  'hip-abductor-machine', 'standing-calf-raise-machine', 'calf-press-leg-press', 'seated-abs-machine', 'treadmill-incline-walk'];

test('every plan exercise has its own animation', () => {
  PLAN.forEach(id => assert.ok(A.has(id), id));
});

test('animations are keyed by real logger ids with matching equipment', () => {
  A.ids().forEach(id => {
    assert.ok(library[id], 'not a logger exercise: ' + id);
    assert.strictEqual(A.defs[id].eq, library[id].cat, id + ' equipment');
    assert.strictEqual(A.defs[id].name, library[id].name, id + ' name');
  });
});

test('no guessing: unknown and similar names get nothing', () => {
  assert.strictEqual(A.has('bench-press'), false);
  assert.strictEqual(A.has('row-machine'), false);
  assert.strictEqual(A.has('Seated Row (Cable)'), false, 'names are not ids');
  assert.strictEqual(A.frame('nope', 0), null);
});

test('every pose is reachable: hands and feet land on their targets', () => {
  A.ids().forEach(id => {
    for (let i = 0; i < FRAMES; i++) assert.ok(A.frame(id, i / FRAMES).sk.err < 0.02, id + ' at ' + i);
  });
});

test('bones keep their length through the whole rep', () => {
  A.ids().forEach(id => {
    for (let i = 0; i < FRAMES; i += 4) {
      const sk = A.frame(id, i / FRAMES).sk;
      ['L', 'R'].forEach(k => {
        assert.ok(Math.abs(dist(sk.sh[k], sk.el[k]) - A.B.upper) < 1e-6, id + ' upper arm');
        assert.ok(Math.abs(dist(sk.el[k], sk.wr[k]) - A.B.fore) < 1e-6, id + ' forearm');
        assert.ok(Math.abs(dist(sk.hip[k], sk.kn[k]) - A.B.thigh) < 1e-6, id + ' thigh');
        assert.ok(Math.abs(dist(sk.kn[k], sk.an[k]) - A.B.shin) < 1e-6, id + ' shin');
      });
    }
  });
});

test('feet stay above the floor and nothing is NaN', () => {
  A.ids().forEach(id => {
    for (let i = 0; i < FRAMES; i++) {
      const f = A.frame(id, i / FRAMES);
      ['L', 'R'].forEach(k => assert.ok(f.sk.an[k][1] > 0.05 && f.sk.toe[k][1] > 0.03, id + ' foot below floor'));
      assert.ok(!JSON.stringify(f.shapes).includes('null'), id + ' has NaN');
    }
  });
});

test('each rep actually moves', () => {
  A.ids().forEach(id => {
    if (A.defs[id].still) return;
    const a = A.frame(id, 0).sk;
    const moved = [0.25, 0.5, 0.75].some(t => {
      const b = A.frame(id, t).sk;
      return ['L', 'R'].some(k => dist(a.wr[k], b.wr[k]) > 0.05 || dist(a.hand[k], b.hand[k]) > 0.05 || dist(a.an[k], b.an[k]) > 0.05 || dist(a.toe[k], b.toe[k]) > 0.05) || dist(a.P, b.P) > 0.05 || dist(a.sh.L, b.sh.L) > 0.04;
    });
    assert.ok(moved, id + ' does not move');
  });
});

test('loop is seamless: the end of the cycle meets the start', () => {
  A.ids().forEach(id => {
    const a = A.frame(id, 0).sk, b = A.frame(id, 0.9999).sk;
    assert.ok(dist(a.wr.L, b.wr.L) < 0.01 && dist(a.an.L, b.an.L) < 0.01, id);
  });
});

test('highlights use known muscle groups', () => {
  const known = new Set(['torso', 'abs', 'pelvis', 'delts', 'arms', 'forearms', 'thighs', 'calves']);
  A.ids().forEach(id => (A.defs[id].hi || []).forEach(h => assert.ok(known.has(h), id + ' ' + h)));
});

test('card html is escaped and only for known ids', () => {
  const an = A.create();
  assert.strictEqual(an.cardHtml('nope'), '');
  const h = an.cardHtml('bench-press-barbell');
  assert.ok(h.includes('data-ea="bench-press-barbell"') && h.includes('<canvas') && h.includes('data-ea-full'));
  assert.ok(!an.cardHtml('bench-press-barbell', 'ea-big').includes('data-ea-full'));
});

// ---- Blender video clips (clips.json, files in app/clips) ----
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const CLIPS = JSON.parse(fs.readFileSync(path.join(__dirname, 'clips.json'), 'utf8'));
const CLIP_DIR = path.join(__dirname, '..', '..', 'app', CLIPS.base);

test('every clip is keyed by a canonical exercise id and its file matches the record', () => {
  const ids = Object.keys(CLIPS.clips);
  assert.ok(ids.length >= 4);
  ids.forEach(id => {
    const c = CLIPS.clips[id];
    assert.ok(A.has(id) && library[id], 'unknown exercise: ' + id);
    assert.strictEqual(c.file, id + '.mp4', 'file is named after the exercise id');
    const buf = fs.readFileSync(path.join(CLIP_DIR, c.file));
    assert.strictEqual(buf.length, c.bytes, id + ' size');
    assert.strictEqual(crypto.createHash('sha256').update(buf).digest('hex'), c.sha256, id + ' sha256');
    assert.ok(['preview', 'approved', 'rejected', 'pending'].includes(c.status), id + ' status');
    ['revision', 'source', 'licence'].forEach(k => assert.ok(c[k], id + ' has ' + k));
    assert.ok(c.primary.length && c.secondary.length, id + ' lists primary and secondary muscles');
    assert.ok(c.status !== 'approved' || (c.reviewedBy && c.reviewedAt), id + ' approved needs reviewedBy and reviewedAt');
  });
  const total = ids.reduce((s, id) => s + CLIPS.clips[id].bytes, 0);
  assert.ok(total / ids.length < 1.5e6, 'clips stay small (avg under 1.5 MB)');
});

test('a preview clip is offered but 3D stays the default; an approved clip is the default', () => {
  const clips = { base: 'clips/', clips: { 'bench-press-barbell': { file: 'b.mp4', status: 'preview' }, 'push-up': { file: 'p.mp4', status: 'approved' }, 'squat-barbell': { file: 's.mp4', status: 'pending' } } };
  const an = A.create({ clips });
  const prev = an.cardHtml('bench-press-barbell');
  assert.ok(prev.includes('data-mode="3d"') && prev.includes('<video') && prev.includes('src="clips/b.mp4"') && prev.includes('data-ea-mode="clip"') && prev.includes('data-ea-mode="3d"'));
  const appr = an.cardHtml('push-up');
  assert.ok(appr.includes('data-mode="clip"') && appr.includes('Video demo') && !appr.includes('preview'));
  const none = an.cardHtml('squat-barbell');
  assert.ok(!none.includes('<video') && !none.includes('data-ea-mode') && none.includes('data-mode="3d"'), 'pending clips are ignored');
  assert.ok(!an.cardHtml('lat-pulldown-wide-grip-cable').includes('<video'), 'no clip, 3D card only');
});

