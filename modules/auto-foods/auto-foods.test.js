// node --test modules/auto-foods/auto-foods.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const AF = require('./auto-foods.js');
const SD = require('../supps-drinks/supps-drinks.js');

let n = 0;
const uid = () => 'u' + (++n);
const TRAIN = { date: '2026-10-26', today: '2026-10-26', training: true, type: 'training' };
const REST = { date: '2026-10-26', today: '2026-10-26', training: false, type: 'training' };
const day = food => ({ date: '2026-10-26', food: food || [], water: 0, supps: {} });

test('seed writes the two defaults once and never again', () => {
  const p = AF.seed({}, 1);
  assert.deepEqual(Object.keys(p.autoFoods), ['adonis', 'gatorade']);
  assert.equal(p.autoFoodsSeeded, true);
  assert.equal(AF.seed(p), null);
  assert.equal(AF.seed({ autoFoodsSeeded: true }), null, 'deleting every rule must not bring the defaults back');
});

test('due follows the schedule', () => {
  const r = w => ({ id: 'x', when: w });
  assert.equal(AF.due(r('daily'), REST), true);
  assert.equal(AF.due(r('training'), TRAIN), true);
  assert.equal(AF.due(r('training'), REST), false);
  assert.equal(AF.due(r('rest'), REST), true);
  assert.equal(AF.due(r('rest'), TRAIN), false);
  assert.equal(AF.due(r('saturday'), { type: 'saturday', training: true }), true);
  assert.equal(AF.due(r('friday'), { type: 'friday' }), true);
  assert.equal(AF.due(r('friday'), TRAIN), false);
  assert.equal(AF.due(Object.assign(r('daily'), { off: true }), TRAIN), false);
});

test('plan adds due rules as planned rows tagged with the rule id, once', () => {
  const prefs = AF.seed({}, 1);
  const r1 = AF.plan(day(), prefs, TRAIN, { uid });
  assert.equal(r1.changed, true);
  assert.deepEqual(r1.added, ['Adonis Protein Cookie Dough (50 g)', 'Gatorade 1 L']);
  assert.equal(r1.day.food.length, 2);
  assert.ok(r1.day.food.every(f => f.eaten === false), 'pending rows are not eaten');
  assert.equal(r1.day.food[0].auto, 'adonis');
  assert.equal(r1.day.food[1].auto, 'gatorade');
  assert.deepEqual(r1.day.auto, { adonis: 'added', gatorade: 'added' });
  const r2 = AF.plan(r1.day, prefs, TRAIN, { uid });
  assert.equal(r2.changed, false);
  assert.equal(r2.day.food.length, 2, 'a second open adds nothing');
});

test('plan never touches the input and skips rest-day Gatorade', () => {
  const prefs = AF.seed({}, 1);
  const d = day();
  const r = AF.plan(d, prefs, REST, { uid });
  assert.equal(d.food.length, 0);
  assert.deepEqual(r.added, ['Adonis Protein Cookie Dough (50 g)']);
  assert.equal(r.day.auto.gatorade, undefined, 'a rule that is not due stays open for later');
});

test('plan does not back-fill past days', () => {
  const prefs = AF.seed({}, 1);
  const r = AF.plan(day(), prefs, Object.assign({}, TRAIN, { date: '2026-10-20' }), { uid });
  assert.equal(r.changed, false);
  assert.equal(r.day.food.length, 0);
});

test('a food already on the day is claimed, not duplicated', () => {
  const prefs = AF.seed({}, 1);
  const d = day([{ id: 'a', name: 'adonis protein cookie dough (50 g)', slot: 'Fixed', kcal: 192, eaten: true }]);
  const r = AF.plan(d, prefs, REST, { uid });
  assert.equal(r.day.food.length, 1);
  assert.equal(r.day.auto.adonis, 'added');
  assert.deepEqual(r.added, []);
});

test('drink rules go through SuppDrinks.planDrink so the row carries the drink tag', () => {
  const prefs = AF.seed({}, 1);
  const planDrink = (d, key) => SD.planDrink(d, key, prefs, { uid });
  const r = AF.plan(day(), prefs, TRAIN, { uid, planDrink });
  const g = r.day.food.find(f => f.auto === 'gatorade');
  assert.equal(g.slot, 'Drink');
  assert.deepEqual(g.drink, { key: 'gatorade', ml: 1000 });
  assert.equal(g.eaten, false);
  assert.equal(SD.totalFluid(r.day), 0, 'a planned drink is not fluid yet');
  // a drink SuppDrinks already planned is claimed
  const d2 = SD.planDrink(day(), 'gatorade', prefs, { uid }).day;
  const r2 = AF.plan(d2, prefs, TRAIN, { uid, planDrink });
  assert.equal(r2.day.food.filter(f => f.drink).length, 1);
});

test('a drink without a saved label is left for SuppDrinks to ask about', () => {
  const prefs = AF.seed({}, 1);
  prefs.autoFoods.whey = { id: 'whey', name: 'Whey', slot: 'Drink', when: 'daily', drink: 'whey', created: 2 };
  const planDrink = (d, key) => SD.planDrink(d, key, prefs, { uid });
  const r = AF.plan(day(), prefs, REST, { uid, planDrink });
  assert.ok(!r.day.food.some(f => f.auto === 'whey'));
  assert.equal(r.day.auto.whey, undefined);
});

test('removing an auto row marks the day skipped; restore clears it', () => {
  const prefs = AF.seed({}, 1);
  let d = AF.plan(day(), prefs, REST, { uid }).day;
  const row = d.food[0];
  d.food = [];
  d = AF.onRemove(d, row);
  assert.equal(d.auto.adonis, 'skipped');
  assert.equal(AF.plan(d, prefs, REST, { uid }).changed, false, 'skipped is not re-added');
  d = AF.onRestore(d, row);
  assert.equal(d.auto.adonis, 'added');
  assert.equal(AF.onRemove(d, { id: 'z' }), d, 'rows without auto are untouched');
});

test('apply: save, from, toggle, del', () => {
  let prefs = {};
  let r = AF.apply('save', { name: 'ISO100 scoop', slot: 'Extra', kcal: '120', p: '25', c: '2', f: '0.5', when: 'rest', est: true }, prefs, day(), { now: 5 });
  prefs = r.prefs;
  const iso = prefs.autoFoods['iso100-scoop'];
  assert.deepEqual(iso, { id: 'iso100-scoop', name: 'ISO100 scoop', slot: 'Extra', kcal: 120, p: 25, c: 2, f: 0.5, when: 'rest', created: 5, est: true });
  assert.equal(prefs.autoFoodsSeeded, true);
  assert.match(r.toast, /rest days/);
  assert.match(AF.apply('save', { name: '  ' }, prefs, day()).toast, /name/);

  const d = day([{ id: 'k', name: 'Thin khubz, 1 loaf (~57 g)', slot: 'Extra', kcal: 145, p: 7.2, c: 28, f: 0.5, eaten: false, est: true }]);
  r = AF.apply('from', { id: 'k' }, prefs, d);
  prefs = r.prefs;
  const kh = prefs.autoFoods['thin-khubz-1-loaf-57-g'];
  assert.equal(kh.when, 'daily');
  assert.equal(kh.est, true);
  assert.equal(r.day.food[0].auto, kh.id, 'the source row is claimed so it is not added twice today');
  assert.equal(r.day.auto[kh.id], 'added');
  assert.equal(AF.plan(r.day, prefs, REST, { uid }).day.food.length, 2, 'only iso100 is new');
  assert.match(AF.apply('from', { id: 'gone' }, prefs, d).toast, /no longer/);

  r = AF.apply('toggle', { id: kh.id }, prefs, d);
  assert.equal(r.prefs.autoFoods[kh.id].off, true);
  assert.equal(AF.status(r.prefs.autoFoods[kh.id], day(), TRAIN), 'off');
  r = AF.apply('del', { id: kh.id }, r.prefs, d);
  assert.equal(r.prefs.autoFoods[kh.id], undefined);
  assert.deepEqual(AF.apply('nope', {}, prefs, d), {});
});

test('status and html', () => {
  const prefs = AF.seed({}, 1);
  const d = AF.plan(day(), prefs, TRAIN, { uid }).day;
  d.food[0].eaten = true;
  assert.equal(AF.status(prefs.autoFoods.adonis, d, TRAIN), 'eaten');
  assert.equal(AF.status(prefs.autoFoods.gatorade, d, TRAIN), 'planned');
  assert.equal(AF.status(prefs.autoFoods.gatorade, day(), REST), 'not today');
  assert.equal(AF.status(prefs.autoFoods.gatorade, day(), TRAIN), 'due');
  d.food.push({ id: 'x', name: 'Fruit <snack>', slot: 'Snack', kcal: 90 });
  const h = AF.html(prefs.autoFoods, { day: d, training: true, type: 'training', hasDrinks: true });
  assert.match(h, /Repeats automatically/);
  assert.match(h, /data-af="toggle" data-id="adonis"/);
  assert.match(h, /data-af="from" data-id="x"/);
  assert.match(h, /Fruit &lt;snack&gt;/);
  assert.ok(!/Adonis Protein Cookie Dough<\/button>/.test(h), 'rule foods are not offered as chips');
  assert.match(h, /data-form="af-save"/);
  assert.match(h, /Drinks and supplements card/);
  assert.match(AF.html({}, {}), /Nothing repeats yet/);
});

test('adherence counts eaten and skipped per rule', () => {
  const prefs = AF.seed({}, 1);
  const days = {};
  const mk = (iso, st, eaten) => { days[iso] = { date: iso, auto: { adonis: st }, food: st === 'added' ? [{ auto: 'adonis', eaten }] : [] }; };
  mk('2026-10-26', 'added', true); mk('2026-10-25', 'added', false); mk('2026-10-24', 'skipped');
  const a = AF.adherence(iso => days[iso], '2026-10-26', prefs, 7);
  assert.deepEqual(a, [{ id: 'adonis', name: 'Adonis Protein Cookie Dough (50 g)', added: 2, eaten: 1, skipped: 1 }]);
});
