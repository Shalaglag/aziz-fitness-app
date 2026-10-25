// Run: node modules/app-targets/app-targets.test.js
const assert = require('assert');
const T = require('./app-targets.js');

// The host's plan numbers (from the handoff doc); the module itself ships none.
const PLAN = { kcal: 2000, kcalLo: 1850, kcalHi: 2150, proteinMin: 160, proteinMax: 170, fatLo: 55, fatHi: 70, carbsLo: 180, carbsHi: 220, goalKg: 80, start: '2026-10-25' };

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('empty profile keeps the plan numbers exactly', () => {
  const r = T.resolve({}, PLAN);
  assert.deepStrictEqual([r.kcal, r.kcalLo, r.kcalHi, r.proteinMin, r.proteinMax, r.fatLo, r.fatHi, r.carbsLo, r.carbsHi, r.goalKg], [2000, 1850, 2150, 160, 170, 55, 70, 180, 220, 80]);
  assert.strictEqual(r.source.kcal, 'default');
  assert.strictEqual(r.reviewDate, '2026-11-07');
});

t('no profile and no defaults: everything null, nothing invented', () => {
  const r = T.resolve(null, null);
  ['kcal', 'kcalLo', 'proteinMin', 'proteinMax', 'fatLo', 'carbsLo', 'goalKg', 'start', 'reviewDate', 'maintenance'].forEach(k => assert.strictEqual(r[k], null, k));
  assert.strictEqual(r.source.kcal, 'none');
});

t('profile calories move the band and re-derive carbs', () => {
  const r = T.resolve({ cutKcal: 2200 }, PLAN);
  assert.strictEqual(r.kcal, 2200); assert.strictEqual(r.kcalLo, 2050); assert.strictEqual(r.kcalHi, 2350);
  assert.strictEqual(r.source.kcal, 'profile');
  // (2200 - 160*4 - 62.5*9) / 4 = 249.4 -> 250 ± 20
  assert.deepStrictEqual([r.carbsLo, r.carbsHi], [230, 270]);
  assert.strictEqual(r.source.carbs, 'derived');
});

t('profile protein sets min, max = min + 10', () => {
  const r = T.resolve({ protein: 175 }, PLAN);
  assert.deepStrictEqual([r.proteinMin, r.proteinMax], [175, 185]);
});

t('profile fat is the midpoint of a ±7.5 g range', () => {
  const r = T.resolve({ fat: 62.5 }, PLAN);
  assert.deepStrictEqual([r.fatLo, r.fatHi], [55, 70]);
});

t('profile goal and start move the goal and the 14-day review', () => {
  const r = T.resolve({ goalKg: 78, start: '2026-11-01' }, PLAN);
  assert.strictEqual(r.goalKg, 78); assert.strictEqual(r.reviewDate, '2026-11-14');
});

t('out-of-range and junk values are ignored and reported', () => {
  const v = T.validate({ cutKcal: 300, protein: 'abc', fat: 900, start: '2026-02-30', goalKg: 80 });
  assert.deepStrictEqual(v.clean, { goalKg: 80 });
  assert.deepStrictEqual(v.errors.map(e => e.field).sort(), ['cutKcal', 'fat', 'start']);
  const r = T.resolve({ cutKcal: 300 }, PLAN);
  assert.strictEqual(r.kcal, 2000);
});

t('numeric strings from form inputs are accepted', () => {
  assert.strictEqual(T.resolve({ cutKcal: '1900' }, PLAN).kcal, 1900);
});

t('forKcal swaps the day target (diet break) and keeps protein', () => {
  const base = T.resolve({}, PLAN);
  const brk = T.forKcal(base, 2800);
  assert.strictEqual(brk.kcal, 2800); assert.strictEqual(brk.kcalLo, 2650);
  assert.strictEqual(brk.proteinMin, 160);
  assert.ok(brk.carbsLo > base.carbsLo);
  assert.strictEqual(base.kcal, 2000, 'original not mutated');
  assert.strictEqual(T.forKcal(base, null).kcal, 2000);
});

t('lastDays: last 14 days inclusive', () => {
  assert.deepStrictEqual(T.lastDays('2026-11-07', 14), { from: '2026-10-25', to: '2026-11-07' });
  assert.deepStrictEqual(T.lastDays('2026-03-01', 7), { from: '2026-02-23', to: '2026-03-01' });
  assert.strictEqual(T.lastDays('bad', 7), null);
});

t('reviewWindow tracks the day of the strict period', () => {
  const r = T.resolve({}, PLAN);
  assert.deepStrictEqual(T.reviewWindow(r, '2026-10-25'), { from: '2026-10-25', to: '2026-11-07', day: 1, days: 14, done: false, notStarted: false });
  assert.strictEqual(T.reviewWindow(r, '2026-11-07').done, true);
  assert.strictEqual(T.reviewWindow(r, '2026-11-20').day, 14);
  assert.strictEqual(T.reviewWindow(r, '2026-10-20').notStarted, true);
  assert.strictEqual(T.reviewWindow(T.resolve({}, {}), '2026-10-25'), null);
});

console.log(n + ' tests passed');
