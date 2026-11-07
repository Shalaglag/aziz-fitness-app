const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const PC = require('./program-chooser.js');
const NP = require('../nippard-programs/nippard-programs.js');
const list = NP.create(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'nippard-programs', 'programs.json'), 'utf8'))).list();

const base = { situation: 'training', joints: ['nothing'], level: 'middle', goal: 'muscle', days: '4', time: 'long', gear: 'full', split: 'any', push: 'steady', focus: ['balanced'], style: 'simple', schedule: 'fixed' };
const top = a => PC.recommend(Object.assign({}, base, a), list)[0];

test('every program has tags and every question has at least two options', () => {
  list.forEach(p => assert.ok(PC.TAGS[p.id], 'tags for ' + p.id));
  Object.keys(PC.TAGS).forEach(id => assert.ok(list.some(p => p.id === id), 'stale tag ' + id));
  PC.QUESTIONS.forEach(q => { assert.ok(q.id && q.title && q.options.length >= 2, q.id); if (q.multi) assert.ok(q.options.some(o => o.id === q.none)); });
  assert.ok(PC.QUESTIONS.length >= 12);
});

test('the "time away" step only shows for a comeback', () => {
  assert.ok(!PC.stepsFor({ situation: 'training' }).some(q => q.id === 'away'));
  assert.ok(PC.stepsFor({ situation: 'injury' }).some(q => q.id === 'away'));
});

test('recommend(): injury or long break -> a Comeback plan; steady training never gets one', () => {
  const r = PC.recommend(Object.assign({}, base, { situation: 'injury', away: 'medium', joints: ['back'], goal: 'fitness', push: 'easy' }), list);
  assert.ok(r[0].id.startsWith('comeback-'), r[0].id);
  assert.ok(r[0].reasons.some(x => /injury/.test(x)));
  assert.strictEqual(top({ situation: 'restart', away: 'long', days: '4' }).id, 'comeback-ul');
  const steady = PC.recommend(base, list);
  assert.ok(!steady.slice(0, 3).some(x => x.id.startsWith('comeback-')));
  assert.ok(steady.find(x => x.id === 'comeback-ul').cautions.some(c => /comeback/i.test(c)));
});

test('recommend(): days, level, goal and gear steer the pick', () => {
  assert.strictEqual(top({ days: '2', goal: 'lean', style: 'fast', time: 'medium' }).id, 'ml-fb2');
  assert.ok(['fund-fb3', 'ml-fb3-beginner'].includes(top({ situation: 'new', level: 'beginner', days: '3' }).id));
  assert.strictEqual(top({ level: 'advanced', goal: 'both', days: '5', push: 'hard', style: 'heavy', gear: 'free' }).id, 'powerbuilding-5x');
  assert.strictEqual(top({ level: 'advanced', days: '6', split: 'ppl', push: 'hard', style: 'variety' }).id, 'ml-ppl6');
  const machines = top({ days: '5', gear: 'machine', joints: ['knee'], push: 'hard', style: 'variety', focus: ['arms'] });
  assert.strictEqual(machines.id, 'pbb2-fb5');
  assert.notStrictEqual(PC.TAGS[machines.id].gear, 'barbell');
  assert.ok(machines.reasons.some(x => /arm/i.test(x)));
});

test('recommend(): sorted best first, pct within 5..99, reasons and cautions are short lists', () => {
  const r = PC.recommend(base, list);
  assert.strictEqual(r.length, list.length);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score);
  r.forEach(x => { assert.ok(x.pct >= 5 && x.pct <= 99); assert.ok(x.reasons.length <= 6 && x.cautions.length <= 3); assert.ok(x.program && x.program.name); });
  assert.strictEqual(PC.recommend({}, []).length, 0);
  assert.ok(PC.recommend({}, list)[0].pct > 0);
});

test('html: a question renders its options as pressed/unpressed gs-opt buttons; the result page lists three cards', () => {
  const q = PC.QUESTIONS.find(x => x.id === 'days');
  const h = PC.questionHtml(q, { days: '4' });
  assert.strictEqual((h.match(/class="gs-opt"/g) || []).length, q.options.length);
  assert.ok(h.includes('data-v="4" aria-pressed="true"'));
  assert.ok(h.includes('data-v="3" aria-pressed="false"'));
  const multi = PC.questionHtml(PC.QUESTIONS.find(x => x.id === 'joints'), { joints: ['knee', 'back'] });
  assert.strictEqual((multi.match(/aria-pressed="true"/g) || []).length, 2);
  const res = PC.resultHtml(PC.recommend(base, list), base, id => id === 'ml-ul4');
  assert.strictEqual((res.match(/class="pc-card/g) || []).length, 3);
  assert.ok(res.includes('Best match') && res.includes('data-pc="add"') && res.includes('data-pc="preview"'));
  assert.ok(res.includes('Based on: 4 days a week'));
  assert.ok(PC.css.includes('.pc-card'));
});
