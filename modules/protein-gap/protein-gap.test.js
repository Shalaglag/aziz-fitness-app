// Run: node --test modules/protein-gap/
const test = require('node:test');
const assert = require('node:assert');
const PG = require('./protein-gap.js');

const item = (name, kcal, p, eaten = true) => ({ name, kcal, p, c: 0, f: 0, eaten });

test('protein already met', () => {
  const r = PG.suggest([item('Day so far', 1970, 164)]);
  assert.equal(r.status, 'met');
  assert.equal(r.kcalLeft, 30);
  assert.equal(r.best, null);
});

test('small gap: one ISO100 scoop is the smallest add', () => {
  const r = PG.suggest([item('Day so far', 1700, 140)]);
  assert.equal(r.status, 'closable');
  assert.equal(r.proteinLeft, 20);
  assert.deepEqual(r.best.items.map(x => x.id), ['iso100']);
  assert.ok(r.best.after.kcal <= 2000 && r.best.after.p >= 160);
});

test('big gap uses two scoops if they fit', () => {
  const r = PG.suggest([item('Day so far', 1650, 115)]);
  assert.equal(r.status, 'closable');
  assert.deepEqual(r.best.items.map(x => [x.id, x.servings]), [['iso100', 2]]);
});

test('never goes over the kcal left', () => {
  const r = PG.suggest([item('Day so far', 1880, 120)]);
  assert.equal(r.status, 'partial');
  assert.ok(r.best.add.kcal <= 120);
  assert.ok(r.best.short > 0);
  for (const a of r.alternatives) assert.ok(a.add.kcal <= 120);
});

test('no room when kcal are used up', () => {
  assert.equal(PG.suggest([item('Day', 2010, 150)]).status, 'no-room');
});

test('a 5 g gap with little room picks the cheapest fit, skipping banned Popcorn', () => {
  const r = PG.suggest([item('Day', 1880, 155)]);
  assert.equal(r.status, 'closable');
  assert.ok(!r.best.items.some(x => x.id === 'popcorn'));
  assert.ok(r.skipped.includes('Popcorn'));
  assert.ok(r.best.add.kcal <= 120);
});

test('dislikes from prefs/main are respected', () => {
  const r = PG.suggest([item('Day', 1700, 140)], { dislikes: ['iso100'] });
  assert.ok(!r.best.items.some(x => x.id === 'iso100'));
  assert.ok(r.skipped.some(n => /ISO100/.test(n)));
});

test('custom never entries and exclude work', () => {
  const never = [{ list: 'never', terms: ['egg'], except: [] }];
  const r = PG.suggest([item('Day', 1700, 140)], { never, exclude: ['iso100'] });
  assert.ok(!r.best.items.some(x => x.id === 'eggs' || x.id === 'iso100'));
  assert.ok(r.best.items.some(x => x.id === 'adonis'));
});

test('extra candidates (e.g. a menu item) are considered and filtered by dislikes', () => {
  const extra = [{ name: 'Grilled Chicken Breast 100 g', kcal: 165, p: 31, c: 0, f: 4 }, { name: 'Tuna Salad', kcal: 150, p: 30, c: 2, f: 3 }];
  const r = PG.suggest([item('Day', 1500, 130)], { extra, exclude: ['iso100'] });
  assert.ok(r.best.items.some(x => /Chicken Breast/.test(x.name)));
  assert.ok(r.skipped.includes('Tuna Salad'));
});

test('basis eaten ignores planned items', () => {
  const food = [item('Meal 1', 700, 70), item('Meal 2', 800, 75, false)];
  assert.equal(PG.remaining(food, { basis: 'eaten' }).proteinLeft, 90);
  assert.equal(PG.remaining(food).proteinLeft, 15);
});

test('summary and toFoodItems', () => {
  const r = PG.suggest([item('Day', 1650, 115)]);
  assert.match(PG.summary(r), /^45 g protein and 350 kcal left\. Add 2 × Dymatize/);
  const f = PG.toFoodItems(r.best);
  assert.equal(f.length, 2);
  assert.equal(f[0].slot, 'add');
  assert.equal(f[0].eaten, false);
  assert.match(PG.summary(PG.suggest([item('Day', 1970, 164)])), /Protein is covered/);
});

test('sandwich rule keeps French Tacos', () => {
  assert.ok(PG.isDisliked('Turkey Sandwich'));
  assert.ok(!PG.isDisliked('French Tacos Chicken Sandwich'));
  assert.ok(!PG.isDisliked('Grilled Chicken'));
});

test('summary names the day target passed in, not a fixed 2,000', () => {
  const r = PG.suggest([item('Day so far', 2190, 120)], { targets: { kcal: 2200, proteinMin: 160, proteinMax: 170 } });
  assert.equal(r.kcalTarget, 2200);
  assert.match(PG.summary(r), /2,200 kcal/);
  assert.doesNotMatch(PG.summary(r), /2,000/);
});
