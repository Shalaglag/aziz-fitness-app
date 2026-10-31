// node --test modules/meal-grade/meal-grade.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const MG = require('./meal-grade.js');

const g = (it, o) => MG.gradeItem(it, o);

test('density is protein per 100 kcal, null without numbers', () => {
  assert.equal(MG.density({ kcal: 500, p: 65 }), 13);
  assert.equal(MG.density({ kcal: 650, protein: '55' }), 55 / 650 * 100);
  assert.equal(MG.density({ kcal: 0, p: 10 }), null);
  assert.equal(MG.density({ kcal: 300 }), null);
  assert.equal(g({ name: 'x', kcal: null, p: 3 }), null);
});

test('kind comes from slot, then section, then size', () => {
  assert.equal(MG.kindOf({ slot: 'Meal 1' }), 'meal');
  assert.equal(MG.kindOf({ slot: 'Breakfast' }), 'meal');
  assert.equal(MG.kindOf({ slot: 'Snack' }), 'snack');
  assert.equal(MG.kindOf({ slot: 'Extra', kcal: 600 }), 'snack');
  assert.equal(MG.kindOf({ section: 'salad' }), 'meal');
  assert.equal(MG.kindOf({ section: 'drink', kcal: 600 }), 'snack');
  assert.equal(MG.kindOf({ kcal: 600 }), 'meal');
  assert.equal(MG.kindOf({ kcal: 120 }), 'snack');
});

test('Nutreeze meals: lean high-protein meals grade A, a heavier one B', () => {
  const buffalo = g({ name: 'Buffalo Chicken with Sweet Potato', kcal: 496, p: 65, c: 41, f: 8, slot: 'Meal 1' });
  assert.equal(buffalo.grade, 'A');
  assert.equal(buffalo.kind, 'meal');
  assert.equal(buffalo.density, 13.1);
  const masala = g({ name: 'Chicken Masala', kcal: 607, protein: 67, carbs: 60, fat: 11, section: 'meal' });
  assert.equal(masala.grade, 'A');
  const tacos = g({ name: 'French Tacos Chicken', kcal: 650, p: 55, c: 60, f: 18, slot: 'Meal 2' });
  assert.equal(tacos.grade, 'B');
  assert.ok(buffalo.score > masala.score && masala.score > tacos.score);
});

test('a fatty low-protein meal is D and says why', () => {
  const r = g({ name: 'Creamy pasta', kcal: 900, p: 25, c: 90, f: 48, slot: 'Meal 1' });
  assert.equal(r.grade, 'D');
  assert.ok(r.reasons.some(s => /calories are fat/.test(s)));
  assert.ok(r.reasons.some(s => /45% of the day/.test(s)));
});

test('a tiny "meal" loses fit points for being too small for the day', () => {
  const small = g({ kcal: 200, p: 30, f: 2 }, { kind: 'meal' });
  const full = g({ kcal: 520, p: 78, f: 5 }, { kind: 'meal' });
  assert.equal(small.density, full.density);
  assert.ok(small.score < full.score);
  assert.equal(full.grade, 'A');
});

test('snacks: popcorn A, fruit B, banana C, nuts and mud cake D, Adonis A', () => {
  const s = (name, kcal, p, c, f) => g({ name, kcal, p, c, f }, { kind: 'snack' }).grade;
  assert.equal(s('Popcorn', 61, 7, 6, 1), 'A');
  assert.equal(s('Fruit Salad', 48, 1, 11, 0), 'B');
  assert.equal(s('Chocolate Chip Cookies', 113, 3, 14, 5), 'B');
  assert.equal(s('Banana', 121, 1, 27, 1), 'C');
  assert.equal(s('Kinder Protein Ball', 162, 3, 15, 10), 'C');
  assert.equal(s('Herbs Roasted Walnut', 248, 6, 11, 20), 'D');
  assert.equal(s('Pro Mud Cake', 252, 4, 14, 20), 'D');
  assert.equal(g({ name: 'Adonis Protein Cookie Dough (50 g)', kcal: 192, p: 22, c: 11.4, f: 6.2, slot: 'Snack' }).grade, 'A');
});

test('targets change the kcal share and come in three shapes', () => {
  const it = { kcal: 500, p: 60, f: 10 };
  const a = g(it, { kind: 'meal', targets: { kcal: 2000 } });
  const b = g(it, { kind: 'meal', targets: { kcal: 1600 } });
  assert.equal(a.kcalShare, 0.25);
  assert.equal(b.kcalShare, 0.313);
  assert.deepEqual(MG.targetsFrom({ kcal: 2200, pMin: 150, pMax: 160, fMin: 50, fMax: 65, cMin: 200, cMax: 240 }),
    { kcal: 2200, kcalLo: 2050, kcalHi: 2350, proteinMin: 150, proteinMax: 160, fatLo: 50, fatHi: 65, carbsLo: 200, carbsHi: 240 });
  assert.deepEqual(MG.targetsFrom({ kcal: 2000, proteinMin: 160, proteinMax: 170, fat: [55, 70], carbs: [180, 220] }), MG.targetsFrom(null));
  assert.equal(MG.targetsFrom({ kcal: 1800, kcalLo: 1650, kcalHi: 1950, proteinMin: 160 }).proteinMax, 170);
});

const DAY = [
  { name: 'French Tacos Chicken', slot: 'Meal 1', kcal: 650, p: 55, c: 60, f: 18, eaten: true },
  { name: 'Chicken Masala', slot: 'Meal 2', kcal: 607, p: 67, c: 60, f: 11, eaten: true },
  { name: 'Dymatize ISO100 scoop', slot: 'Extra', kcal: 120, p: 25, c: 2, f: 0.5, eaten: false },
  { name: 'Low-fat milk 250 ml', slot: 'Extra', kcal: 115, p: 8.5, c: 12, f: 4, eaten: false },
  { name: 'Adonis', slot: 'Snack', kcal: 192, p: 22, c: 11.4, f: 6.2, eaten: false },
  { name: 'Popcorn', slot: 'Snack', kcal: 61, p: 7, c: 6, f: 1, eaten: false },
  { name: 'Fruit Salad', slot: 'Snack', kcal: 48, p: 1, c: 11, f: 0, eaten: false },
  { name: 'Gatorade 1 L', slot: 'Extra', kcal: 240, p: 0, c: 60, f: 0, eaten: false },
];

test('a day on target is A when planned, and the eaten half alone is D', () => {
  const plan = MG.gradeDay(DAY);
  assert.equal(plan.grade, 'A');
  assert.equal(plan.score, 95);
  assert.equal(plan.basis, 'plan');
  assert.equal(Math.round(plan.totals.kcal), 2033);
  assert.deepEqual(plan.reasons, []);
  assert.equal(plan.parts.find(p => p.key === 'carbs').got, 5);
  const eaten = MG.gradeDay(DAY, { basis: 'eaten' });
  assert.equal(eaten.count, 2);
  assert.equal(eaten.grade, 'D');
  assert.ok(eaten.reasons.some(s => /protein short/.test(s)));
  assert.ok(eaten.reasons.some(s => /kcal under/.test(s)));
  assert.equal(MG.gradeDay([]), null);
  assert.equal(MG.gradeDay(DAY.map(i => ({ ...i, eaten: false })), { basis: 'eaten' }), null);
});

test('a day with protein hit but 400 kcal over drops to C', () => {
  const r = MG.gradeDay(DAY.concat([{ name: 'Extra cake', slot: 'Extra', kcal: 500, p: 5, c: 60, f: 25 }]));
  assert.equal(r.grade, 'C');
  assert.equal(r.parts.find(p => p.key === 'kcal').got, 0);
  assert.ok(r.reasons.some(s => /kcal over/.test(s)));
});

test('day targets follow the day\'s calorie target', () => {
  const r = MG.gradeDay(DAY, { targets: { kcal: 2400, kcalLo: 2250, kcalHi: 2550, proteinMin: 160, proteinMax: 170, fatLo: 55, fatHi: 70, carbsLo: 180, carbsHi: 220 } });
  assert.ok(r.reasons.some(s => /kcal under the 2250–2550 band/.test(s)));
  assert.equal(r.grade, 'B');
});

test('badges are escaped HTML with the grade and a reason', () => {
  const b = MG.badge(g({ kcal: 496, p: 65, f: 8, slot: 'Meal 1' }));
  assert.match(b, /class="mg mg-A"/);
  assert.match(b, /13\.1 g protein per 100 kcal/);
  assert.equal(MG.badge(null), '');
  const d = MG.dayBadge(MG.gradeDay(DAY, { basis: 'eaten' }));
  assert.match(d, /mg-day mg-D/);
  assert.match(d, /<small>eaten<\/small>/);
  assert.match(MG.badge(g({ kcal: 100, p: 10 }), { title: '<b>' }), /title="&lt;b&gt;"/);
  assert.ok(MG.css.includes('.mg-A'));
});
