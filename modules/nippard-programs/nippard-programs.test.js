const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const NP = require('./nippard-programs.js');
const programs = JSON.parse(fs.readFileSync(path.join(__dirname, 'programs.json'), 'utf8'));
const tips = JSON.parse(fs.readFileSync(path.join(__dirname, 'tips.json'), 'utf8'));

// The logger's exercise library (ids are slug(name)); the programs must only use ids that exist there.
const loggerSrc = fs.readFileSync(path.join(__dirname, '..', 'workout-logger', 'workout-logger.js'), 'utf8');
const libBlock = loggerSrc.slice(loggerSrc.indexOf('const LIB_SRC = `') + 17, loggerSrc.indexOf('`', loggerSrc.indexOf('const LIB_SRC = `') + 17));
const LIB = new Set(libBlock.split('\n').map(l => l.split('|')[0].trim()).filter(Boolean).map(NP.slug));

test('every program exercise maps to a logger library id', () => {
  const bad = [];
  programs.programs.forEach(p => p.workouts.forEach(w => w.exercises.forEach(e => { if (!LIB.has(e.ex)) bad.push(p.id + ': ' + e.name + ' -> ' + e.ex); })));
  assert.deepStrictEqual(bad, []);
  assert.ok(programs.programs.length >= 18);
});

test('every tip is keyed by a logger library id and credits a known source', () => {
  const bad = Object.keys(tips.tips).filter(k => !LIB.has(k));
  assert.deepStrictEqual(bad, []);
  Object.values(tips.tips).forEach(list => list.forEach(t => { assert.ok(tips._sources[t.src], t.src); assert.ok(t.q.length > 10); assert.ok(['tip', 'machine', 'fact'].includes(t.kind)); }));
});

test('program shapes: sets, reps, rest and superset groups', () => {
  programs.programs.forEach(p => {
    assert.ok(p.id && p.name && p.source && p.level && p.days && p.time && p.blurb, p.id);
    p.workouts.forEach(w => {
      assert.ok(w.name && w.exercises.length, p.id + ' ' + w.name);
      w.exercises.forEach(e => {
        assert.ok(e.sets.some(s => s.t === 'n'), p.id + ' ' + e.name + ' has no working set');
        e.sets.forEach(s => assert.ok(s.t === 'n' || s.t === 'w'));
        if (e.rest != null) assert.ok(Number.isInteger(e.rest) && e.rest >= 15 && e.rest <= 600, p.id + ' ' + e.name + ' rest ' + e.rest);
        assert.ok(typeof e.notes === 'string');
      });
    });
  });
});

test('templates() builds logger templates with stable ids and folder', () => {
  const P = NP.create(programs);
  assert.strictEqual(P.size, programs.programs.length);
  const ml = P.list().find(x => x.id === 'ml-fb2');
  assert.strictEqual(ml.days, 2);
  const t = P.templates('ml-fb2', { unit: 'lb', order: 50 });
  assert.strictEqual(t.length, 2);
  assert.strictEqual(t[0].id, 'np-ml-fb2-1');
  assert.strictEqual(t[0].folder, 'Muscle Ladder · Full Body 2x/week');
  assert.strictEqual(t[0].order, 50);
  assert.ok(t[0].notes.includes('The Muscle Ladder'));
  const lp = t[0].exercises[0];
  assert.strictEqual(lp.exId, 'leg-press-machine');
  assert.strictEqual(lp.unit, 'lb');
  assert.strictEqual(lp.sets.filter(s => s.t === 'w').length, 2);
  assert.strictEqual(lp.sets.filter(s => s.t === 'n').length, 3);
  assert.strictEqual(lp.sets[2].r, 6);
  assert.strictEqual(lp.rest, 45);
  // superset 1 = leg press + lateral raise share a group id unique to this template
  assert.strictEqual(lp.ss, t[0].exercises[1].ss);
  assert.ok(lp.ss.startsWith('np-ml-fb2-1-'));
  assert.strictEqual(t[0].exercises[2].ss, undefined);
  assert.deepStrictEqual(P.templates('nope'), []);
  // templates are fresh copies, so editing one does not change the data
  t[0].exercises[0].sets[0].w = 99;
  assert.strictEqual(P.templates('ml-fb2')[0].exercises[0].sets[0].w, '');
});

test('tips(): html quotes Jeff Nippard with the source, escapes, and is empty for unknown lifts', () => {
  const T = NP.tips(tips);
  assert.ok(T.size > 60);
  const h = T.inlineHtml('seated-leg-curl-machine');
  assert.ok(h.includes('Jeff Nippard says'));
  assert.ok(h.includes('55 percent more hamstring growth'));
  assert.ok(h.includes('The Muscle Ladder bonus guide'));
  assert.ok(h.includes('Fun fact'));
  assert.strictEqual(T.inlineHtml('treadmill-incline-walk'), '');
  assert.strictEqual(T.detailHtml('unknown-lift'), '');
  const d = T.detailHtml('bench-press-barbell');
  assert.ok(d.startsWith('<section class="nt-detail">'));
  assert.ok(d.includes('&#39;') || !d.includes("'"), 'quotes are escaped');
  assert.ok(T.css.includes('.nt-inline'));
});
