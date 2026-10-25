// Run: node picker-engine.test.js
const assert = require('assert');
const P = require('./picker-engine.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const menu = [
  { name: 'Buffalo Chicken with Sweet Potato', kcal: 496, p: 65, c: 41, f: 8 },
  { name: 'Grilled Chicken Rice Bowl', kcal: 560, p: 55, c: 60, f: 12 },
  { name: 'Beef Burger Bowl', kcal: 640, p: 50, c: 55, f: 22 },
];

t('plan targets by default', () => {
  assert.strictEqual(P.TARGETS.kcal, 2000); assert.deepStrictEqual(P.TARGETS.fat, [55, 70]);
  assert.ok(P.pick({ meals: menu }).options.length > 0);
});

t('setTargets updates in place and drives the notes', () => {
  const ref = P.TARGETS;
  P.setTargets({ kcal: 2600, proteinMin: 230, proteinMax: 240, fatLo: 60, fatHi: 80, carbsLo: 230, carbsHi: 270 });
  assert.strictEqual(ref, P.TARGETS);
  assert.deepStrictEqual([P.TARGETS.kcal, P.TARGETS.proteinMin, P.TARGETS.fat[1], P.TARGETS.carbs[0]], [2600, 230, 80, 230]);
  const txt = JSON.stringify(P.pick({ meals: menu }));
  assert.ok(txt.includes('short of 230 g'), 'protein note uses the new target');
  assert.ok(/under 2,600/.test(txt), 'kcal note uses the new target');
  P.setTargets(null);
  assert.strictEqual(P.TARGETS.kcal, 2000); assert.deepStrictEqual(P.TARGETS.carbs, [180, 220]);
});

t('bad values fall back to the plan', () => {
  P.setTargets({ kcal: 'x', fatLo: 80, fatHi: 50 });
  assert.strictEqual(P.TARGETS.kcal, 2000); assert.deepStrictEqual(P.TARGETS.fat, [55, 70]);
  P.setTargets(null);
});

console.log(n + ' tests passed');
