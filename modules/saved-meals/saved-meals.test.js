// Run: node --test modules/saved-meals/saved-meals.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./saved-meals.js');

const DAY = {
  date: '2026-10-27',
  food: [
    { id: 'a', name: 'French Tacos Chicken', slot: 'Meal 1', kcal: 610, p: 52, c: 60, f: 18, eaten: true },
    { id: 'b', name: 'Chicken Biryani', slot: 'Meal 2', kcal: 650, p: 55, c: 70, f: 16, eaten: false },
    { id: 'c', name: 'Mango', slot: 'Snack', kcal: 52, p: 1, c: 12, f: 0, eaten: false },
    { id: 'd', name: 'Adonis Protein Cookie Dough (50 g)', slot: 'Fixed', kcal: 192, p: 22, c: 11.4, f: 6.2, eaten: false },
    { id: 'e', name: 'Gatorade 1 L', slot: 'Fixed', kcal: 240, p: 0, c: 60, f: 0, eaten: false, est: true },
  ],
  water: 1500,
};
let n = 0; const uid = () => 'u' + (++n);

test('fromItems strips per-day fields and names from the meals', () => {
  const m = M.fromItems(DAY.food, { now: 1 });
  assert.equal(m.name, 'French Tacos Chicken + Chicken Biryani');
  assert.equal(m.id, 'french-tacos-chicken-chicken-biryani');
  assert.equal(m.items.length, 5);
  assert.ok(m.items.every(i => !('id' in i) && !('eaten' in i)));
  assert.equal(m.items[4].est, true);
  assert.equal(m.items[0].est, undefined);
  assert.deepEqual([m.uses, m.lastUsed, m.created], [0, 0, 1]);
});

test('fromItems: custom name, onlyEaten, unique id, empty input', () => {
  const m = M.fromItems(DAY.food, { name: ' Usual Sunday ', onlyEaten: true, existing: { 'usual-sunday': {} } });
  assert.equal(m.name, 'Usual Sunday');
  assert.equal(m.id, 'usual-sunday-2');
  assert.equal(m.items.length, 1);
  assert.equal(M.fromItems([], {}), null);
  assert.equal(M.fromItems([{ name: '  ' }], {}), null);
});

test('totals adds macros and tolerates junk numbers', () => {
  const t = M.totals(M.fromItems(DAY.food).items);
  assert.deepEqual(t, { kcal: 1744, p: 130, c: 213.4, f: 40.2 });
  assert.deepEqual(M.totals([{ kcal: 'x', p: null }]), { kcal: 0, p: 0, c: 0, f: 0 });
});

test('applyToDay appends as planned with new ids, skips duplicates, does not mutate', () => {
  const combo = M.fromItems(DAY.food);
  const partial = { date: '2026-10-28', food: [{ id: 'z', name: 'Mango', slot: 'Snack', kcal: 52, p: 1, c: 12, f: 0, eaten: true }] };
  const before = JSON.stringify(partial);
  const r = M.applyToDay(partial, combo, { uid });
  assert.equal(JSON.stringify(partial), before);
  assert.equal(r.day.food.length, 5);
  assert.deepEqual(r.skipped, ['Mango']);
  assert.equal(r.added.length, 4);
  assert.ok(r.added.every(i => i.eaten === false && /^u\d+$/.test(i.id)));
  assert.equal(new Set(r.day.food.map(i => i.id)).size, 5);
  assert.equal(r.day.date, '2026-10-28');
});

test('applyToDay on an empty/missing day and with eaten + allowDuplicates', () => {
  const combo = M.fromItems(DAY.food);
  const r = M.applyToDay(undefined, combo, { uid, eaten: true });
  assert.equal(r.day.food.length, 5);
  assert.ok(r.day.food.every(i => i.eaten));
  const r2 = M.applyToDay(r.day, combo, { uid, allowDuplicates: true });
  assert.equal(r2.day.food.length, 10);
});

test('applyToDay replace mode keeps eaten items and drops planned ones', () => {
  const other = { name: 'Other day', items: [{ name: 'Grilled Steak with Potato', slot: 'Meal 2', kcal: 700, p: 60, c: 50, f: 25 }] };
  const r = M.applyToDay(DAY, other, { uid, mode: 'replace' });
  assert.deepEqual(r.day.food.map(i => i.name), ['French Tacos Chicken', 'Grilled Steak with Potato']);
  assert.equal(r.day.water, 1500);
});

test('sorted orders by uses, then recency, then name; markUsed bumps', () => {
  const a = { id: 'a', name: 'B', items: [{}], uses: 1, lastUsed: 5 };
  const b = { id: 'b', name: 'A', items: [{}], uses: 1, lastUsed: 5 };
  const c = { id: 'c', name: 'C', items: [{}], uses: 3, lastUsed: 1 };
  const empty = { id: 'e', name: 'E', items: [] };
  assert.deepEqual(M.sorted({ a, b, c, empty }).map(x => x.id), ['c', 'b', 'a']);
  const u = M.markUsed(a, 99);
  assert.deepEqual([u.uses, u.lastUsed, a.uses], [2, 99, 1]);
});

test('parse round-trips JSON and rejects junk', () => {
  const m = M.fromItems(DAY.food, { name: 'Usual' });
  const p = M.parse(JSON.stringify(m));
  assert.equal(p.name, 'Usual');
  assert.deepEqual(p.items, m.items);
  assert.equal(M.parse('{nope'), null);
  assert.equal(M.parse('{"items":"x"}'), null);
});

test('cardHTML escapes names and wires the app actions', () => {
  const m = M.fromItems([{ name: '<b>Steak</b> & "rice"', slot: 'Meal 1', kcal: 500, p: 40, c: 50, f: 10 }]);
  const html = M.cardHTML({ [m.id]: m }, { day: DAY });
  assert.ok(!html.includes('<b>Steak'));
  assert.ok(html.includes('&lt;b&gt;Steak&lt;/b&gt; &amp; &quot;rice&quot;'));
  assert.ok(html.includes('data-act="meal-add" data-id="' + m.id + '"'));
  assert.ok(html.includes('data-act="meal-del"'));
  assert.ok(html.includes('data-form="meal-save"'));
  const empty = M.cardHTML({}, { day: { food: [] } });
  assert.ok(empty.includes('No saved combos yet'));
  assert.ok(!empty.includes('data-form="meal-save"'));
});
