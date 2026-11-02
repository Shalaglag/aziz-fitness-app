// node --test modules/menu-import/menu-import.test.js
// The PDF tests run when pdfjs-dist@3 is installed (npm i --no-save pdfjs-dist@3.11.174); otherwise they skip.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const M = require('./menu-import.js');
const E = require('../../tools/meal-picker/picker-engine.js');

const byName = (items, n) => items.find(i => i.name === n);
const nums = it => [it.kcal, it.protein, it.carbs, it.fat];

test('one item per line, with and without labels', () => {
  const { items } = M.parseText([
    'French Tacos Chicken 650 55 60 20',
    'Chicken Masala — 607 kcal | 67 P | 60 C | 11 F',
    'Buffalo Chicken with Sweet Potato: Calories 496, Protein 65g, Carbs 41g, Fat 8g',
  ].join('\n'));
  assert.equal(items.length, 3);
  assert.deepEqual(nums(byName(items, 'French Tacos Chicken')), [650, 55, 60, 20]);
  assert.deepEqual(nums(byName(items, 'Chicken Masala')), [607, 67, 60, 11]);
  assert.deepEqual(nums(byName(items, 'Buffalo Chicken with Sweet Potato')), [496, 65, 41, 8]);
  assert.ok(items.every(i => !i.needsCheck));
});

test('header row sets the column order; prices and sections are handled', () => {
  const { items, warnings } = M.parseText([
    'Weekly menu',
    'Mains',
    'Dish  Protein  Carbs  Fat  Calories  Price',
    'Grilled Steak with Potato  52  45  18  560  3.250 KD',
    'Desserts',
    'Protein Brownie  14  22  7  210  1.250 KD',
  ]);
  assert.deepEqual(nums(byName(items, 'Grilled Steak with Potato')), [560, 52, 45, 18]);
  assert.equal(byName(items, 'Grilled Steak with Potato').section, 'meal');
  const b = byName(items, 'Protein Brownie');
  assert.deepEqual(nums(b), [210, 14, 22, 7]);
  assert.equal(b.section, 'snack');
  assert.ok(!warnings.some(w => /label/.test(w)));
});

test('blocks: name line, description, then labelled numbers on later lines', () => {
  const { items } = M.parseText([
    'Salads',
    'Chicken Caesar Salad',
    'Romaine, parmesan, light dressing',
    'Calories: 380 kcal Protein: 38g Carbs: 18g Fat: 17g',
    'Steak Fattoush',
    'Calories 450',
    'Protein 40g',
    'Carbs 30g',
    'Fat 19g',
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(nums(byName(items, 'Chicken Caesar Salad')), [380, 38, 18, 17]);
  assert.deepEqual(nums(byName(items, 'Steak Fattoush')), [450, 40, 30, 19]);
  assert.ok(items.every(i => i.section === 'salad'));
});

test('uncertain values are flagged, never filled in', () => {
  const { items } = M.parseText([
    'Calories  Protein  Carbs  Fat',
    'Beef Lasagna  900  45  58  32',      // 4*45+4*58+9*32 = 700, 900 is >15% off
    'Chicken Biryani  52  70  16',        // only 3 numbers under a 4-column header
  ].join('\n'));
  const lasagna = byName(items, 'Beef Lasagna');
  assert.ok(lasagna.needsCheck);
  assert.match(lasagna.checkReasons.join(), /15%/);
  const biryani = byName(items, 'Chicken Biryani');
  assert.equal(biryani.kcal, null);
  assert.ok(biryani.needsCheck);
  assert.match(biryani.checkReasons.join(), /missing kcal/);
  // Confirming does not clear a missing number.
  assert.ok(M.check({ ...biryani, confirmed: true }).needsCheck);
  // Confirming a complete item clears the flag.
  assert.ok(!M.check({ ...lasagna, confirmed: true }).needsCheck);
});

test('unlabelled columns: default order, reordered when the kcal says so, with a warning', () => {
  const { items, warnings } = M.parseText('Chicken Wrap 18 45 40 520\nRice Bowl 600 50 70 13');
  // 4*45+4*40+9*18 = 502 ≈ 520 with fat first and kcal last
  const wrap = byName(items, 'Chicken Wrap');
  assert.deepEqual(nums(wrap), [520, 40, 45, 18]);
  assert.ok(wrap.needsCheck, 'a reordered row asks for a check');
  assert.deepEqual(nums(byName(items, 'Rice Bowl')), [600, 50, 70, 13]);
  assert.match(warnings[0], /didn't label/);
});

test('decimal commas, thousands and duplicates', () => {
  const { items, warnings } = M.parseText('Big Plate 1,250 kcal 80 P 120 C 50,5 F\nBig Plate 1,250 kcal 80 P 120 C 50,5 F\nMini 300 20 30 11');
  assert.deepEqual(nums(byName(items, 'Big Plate')), [1250, 80, 120, 50.5]);
  assert.equal(items.length, 2);
  assert.match(warnings.join(), /appeared twice/);
});

test('Nutreeze Menu Reader JSON passes through', () => {
  const rec = { date: '2026-10-27', items: [
    { name: 'Buffalo Chicken with Sweet Potato', section: 'meal', kcal: 496, protein: 65, carbs: 41, fat: 8, needsCheck: false },
    { name: 'Grapes', section: 'snack', kcal: 68, protein: null, carbs: 16, fat: 0, needsCheck: true },
  ] };
  const r = M.parseText(JSON.stringify(rec));
  assert.equal(r.date, '2026-10-27');
  assert.equal(r.items.length, 2);
  assert.ok(byName(r.items, 'Grapes').needsCheck);
  assert.ok(!byName(r.items, 'Buffalo Chicken with Sweet Potato').needsCheck);
});

test('record round trip keeps confirmations and skips', () => {
  const { items } = M.parseText('Beef Lasagna 900 45 58 32\nRice Bowl 600 50 70 13');
  items[0] = M.check({ ...items[0], confirmed: true });
  items[1] = { ...items[1], skip: true };
  const rec = M.toRecord(items, { date: '2026-10-28', source: 'pdf', now: new Date('2026-10-25T00:00:00Z') });
  assert.equal(rec.updatedAt, '2026-10-25T00:00:00.000Z');
  const back = M.fromRecord(rec);
  assert.ok(back[0].confirmed && !back[0].needsCheck);
  assert.ok(back[1].skip);
});

test('pdf.js text items become lines, two-column pages read column by column', () => {
  const t = (s, x, y) => ({ str: s, transform: [10, 0, 0, 10, x, y], width: s.length * 5 });
  const content = { items: [
    t('Chicken Caesar Salad', 40, 760), t('Halloumi Quinoa Salad', 310, 760),
    t('Calories: 380 Protein: 38g Carbs: 18g Fat: 17g', 40, 732), t('Calories: 420 Protein: 22g Carbs: 35g Fat: 21g', 310, 732),
    t('Steak Fattoush', 40, 700),
    t('Calories: 450 Protein: 40g Carbs: 30g Fat: 19g', 40, 672),
  ] };
  const lines = M.linesFromTextContent(content, 595);
  assert.deepEqual(lines, [
    'Chicken Caesar Salad', 'Calories: 380 Protein: 38g Carbs: 18g Fat: 17g', 'Steak Fattoush', 'Calories: 450 Protein: 40g Carbs: 30g Fat: 19g',
    'Halloumi Quinoa Salad', 'Calories: 420 Protein: 22g Carbs: 35g Fat: 21g',
  ]);
  const { items } = M.parseText(lines);
  assert.deepEqual(nums(byName(items, 'Halloumi Quinoa Salad')), [420, 22, 35, 21]);
});

test('a table row stays one line', () => {
  const t = (s, x, y) => ({ str: s, transform: [10, 0, 0, 10, x, y], width: s.length * 5 });
  const lines = M.linesFromTextContent({ items: [
    t('Item', 40, 700), t('Calories', 270, 700), t('Protein', 340, 700), t('Carbs', 400, 700), t('Fat', 460, 700),
    t('French Tacos Chicken', 40, 680), t('650', 270, 680), t('55', 340, 680), t('60', 400, 680), t('20', 460, 680),
  ] }, 595);
  assert.deepEqual(lines, ['Item  Calories  Protein  Carbs  Fat', 'French Tacos Chicken  650  55  60  20']);
});

test("Claude's image reading: numbers copied, unsure and null values flagged", () => {
  const r = M.parseRead({ items: [
    { name: 'Chicken Biryani', section: 'meal', kcal: 640, protein: 52, carbs: 70, fat: 16, unsure: false },
    { name: 'Grapes', section: 'snack', kcal: '68', protein: null, carbs: 16, fat: 0, unsure: true },
    { name: '', kcal: 1 },
  ], note: 'Bottom row cut off' });
  assert.equal(r.items.length, 2);
  assert.ok(!byName(r.items, 'Chicken Biryani').needsCheck);
  const g = byName(r.items, 'Grapes');
  assert.equal(g.kcal, 68); assert.equal(g.protein, null); assert.ok(g.needsCheck);
  assert.match(r.warnings.join(), /cut off/);
  assert.deepEqual(M.parseRead('not json').items, []);
  assert.match(M.readPrompt({ pages: 2 }), /Never estimate/);
});

test('one never-pick check: built-in rules plus whole-word dislikes', () => {
  const banned = M.makeBanned(E, ['mushroom', 'egg']);
  assert.match(banned('Shrimp Alfredo Pasta'), /shrimp/i);
  assert.match(banned('Grilled Mushrooms Bowl'), /mushroom/);
  assert.equal(banned('Eggplant Moussaka'), null, 'whole words only');
  assert.equal(banned('Chicken Masala'), null);
});

const MENU = [
  'Main Meals',
  'Item  Calories  Protein  Carbs  Fat',
  'French Tacos Chicken  650  55  60  20',
  'Buffalo Chicken with Sweet Potato  496  65  41  8',
  'Chicken Masala with Rice  607  67  60  11',
  'Grilled Steak with Potato  560  52  45  18',
  'Shrimp Alfredo Pasta  580  40  62  18',
  'Chicken Shawarma Bowl  620  48  55  22',
  'Beef Lasagna  710  45  58  32',
  'Snacks',
  'Greek Yogurt Berry Cup  150  15  18  2',
  'Roasted Almonds  183  6  6  15',
  'Protein Brownie  210  14  22  7',
  'Fresh Fruit Cup  90  1  22  0',
  'Popcorn  61  7  6  1',
].join('\n');

test('optimiser: 2 meals + 2 menu snacks + Adonis around 2,000 kcal and 160+ g protein', () => {
  const { items } = M.parseText(MENU);
  const r = M.optimize(items, E, { dayType: 'training' });
  assert.ok(r.usedMenuSnacks);
  assert.ok(r.options.length >= 1);
  const best = r.options[0];
  assert.ok(best.check.fits, best.check.verdict);
  assert.ok(best.totals.p >= 160);
  assert.ok(Math.abs(best.totals.kcal - 2000) <= 100);
  assert.ok(r.fixed.some(x => x.slot === 'adonis'));
  const names = [best.meal1, best.meal2, ...best.snacks].map(x => x.name);
  assert.ok(!names.some(n => /shrimp|shawarma|popcorn/i.test(n)));
  assert.deepEqual(r.skipped.map(s => s.name).sort(), ['Chicken Shawarma Bowl', 'Popcorn', 'Shrimp Alfredo Pasta']);
  // The favourite fits, so it's picked.
  assert.ok(names.includes('French Tacos Chicken'));
});

test('optimiser respects Adonis off, dislikes, unconfirmed-only and missing numbers', () => {
  const { items } = M.parseText(MENU + '\nChicken Biryani  52  70  16');
  const noAdonis = M.optimize(items, E, { adonis: false });
  assert.ok(!noAdonis.fixed.some(x => x.slot === 'adonis'));
  assert.ok(noAdonis.skipped.some(s => s.name === 'Chicken Biryani' && /missing/.test(s.reason)));
  const r = M.optimize(items, E, { dislikes: ['french tacos'] });
  assert.ok(!r.options.some(o => [o.meal1.name, o.meal2.name].includes('French Tacos Chicken')));
  const flagged = items.map(i => i.name === 'Beef Lasagna' ? M.check({ ...i, kcal: 999 }) : i);
  const only = M.optimize(flagged, E, { onlyConfirmed: true });
  assert.ok(only.skipped.some(s => s.name === 'Beef Lasagna' && /not confirmed/.test(s.reason)));
  const loose = M.optimize(flagged, E, { onlyConfirmed: false, top: 10 });
  const withLasagna = loose.options.find(o => [o.meal1.name, o.meal2.name].includes('Beef Lasagna'));
  if (withLasagna) assert.ok(withLasagna.check.notes.some(n => /Beef Lasagna/.test(n)));
});

test('optimiser falls back to the fixed Nutreeze snacks when the menu has fewer than 2', () => {
  const { items } = M.parseText(MENU.split('\nSnacks')[0]);
  const r = M.optimize(items, E, {});
  assert.ok(!r.usedMenuSnacks);
  assert.match(r.notes.join(), /usual Nutreeze snack list/);
  const snackNames = E.SNACKS.map(s => s.name);
  assert.ok(r.options[0].snacks.every(s => snackNames.includes(s.name)));
});

test('optimiser takes the day targets from AppTargets instead of 2,000 / 160', () => {
  const { items } = M.parseText(MENU);
  const targets = { kcal: 1800, kcalLo: 1650, kcalHi: 1950, proteinMin: 150, proteinMax: 160, fatLo: 50, fatHi: 65, carbsLo: 150, carbsHi: 190 };
  const r = M.optimize(items, E, { targets, gatorade: false });
  const best = r.options[0];
  assert.ok(Math.abs(best.totals.kcal - 1800) <= 100, String(best.totals.kcal));
  assert.ok(best.totals.p >= 150);
  assert.ok(!/2,000/.test(best.check.verdict + best.check.notes.join()));
});

test('priority: most protein puts the highest-protein combo that fits the budget first, and says why', () => {
  const { items } = M.parseText(MENU + '\nChicken Burger with Fries  640  50  58  20');
  const bal = M.optimize(items, E, { dayType: 'training' });
  const pro = M.optimize(items, E, { dayType: 'training', priority: 'protein' });
  assert.equal(pro.priority, 'protein');
  const best = pro.options[0];
  assert.ok(Math.abs(best.totals.kcal - 2000) <= 100, String(best.totals.kcal)); // the budget never moves
  assert.ok(best.totals.p >= bal.options[0].totals.p);
  assert.ok(pro.options.every(o => o.totals.p <= best.totals.p + 0.5));
  assert.match(best.why[0], /^Most protein of the \d+ meal pairs that fit your 2,000 kcal budget: \d+ g/);
  assert.match(best.why.join(' '), /your 2,000 budget; \d+ g protein meets your 160 g goal/);
  assert.match(pro.options[1].why[0], /Against the best option: [−+]\d+ g protein/);
  // Alternatives are different meal pairs.
  const pairs = pro.options.map(o => o.meal1.name + o.meal2.name);
  assert.equal(new Set(pairs).size, pairs.length);
});

test('leave out: "fries" removes every item with fries in its name, and the reason says so', () => {
  const { items } = M.parseText(MENU + '\nChicken Burger with Fries  640  60  58  14\nLoaded Fries  450  12  50  22');
  const r = M.optimize(items, E, { priority: 'protein', avoid: ['fries'] });
  const used = r.options.flatMap(o => [o.meal1, o.meal2, ...o.snacks].map(x => x.name));
  assert.ok(!used.some(n => /fries/i.test(n)));
  assert.ok(r.skipped.some(s => s.name === 'Chicken Burger with Fries' && /leave out: fries/.test(s.reason)));
  assert.match(r.options[0].why.join(' '), /Nothing with fries, as you asked/);
  assert.deepEqual(M.avoidSuggestions(items, ['fries']).slice(0, 3), ['rice', 'pasta', 'potato']);
  assert.ok(M.avoidSuggestions(items, []).includes('fries'));
});

test('other priorities: lower fat, more carbs, favourites; balanced is the old order', () => {
  const { items } = M.parseText(MENU);
  const bal = M.optimize(items, E, {}), plain = M.optimize(items, E, { priority: 'balanced' });
  assert.deepEqual(bal.options.map(o => o.score), plain.options.map(o => o.score));
  const lf = M.optimize(items, E, { priority: 'lowfat' });
  assert.ok(lf.options[0].totals.f <= bal.options[0].totals.f + 0.5);
  assert.match(lf.options[0].why[0], /Lowest fat/);
  const cb = M.optimize(items, E, { priority: 'carbs' });
  assert.ok(cb.options[0].totals.c >= bal.options[0].totals.c - 0.5);
  const fav = M.optimize(items, E, { priority: 'liked' });
  assert.ok([fav.options[0].meal1.name, fav.options[0].meal2.name].includes('French Tacos Chicken'));
  assert.match(fav.options[0].why[0], /favourite/);
  assert.ok(M.optimize(items, E, { priority: 'nonsense' }).options.length);
});

test("Claude's answer wrapped in a code fence still parses", () => {
  const r = M.parseRead('```json\n{"items":[{"name":"Chicken Masala","section":"meal","kcal":607,"protein":67,"carbs":60,"fat":11}]}\n```');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].kcal, 607);
});

test('engine without menu snacks still uses the fixed list (old callers unchanged)', () => {
  const meals = E.parseMenu('French Tacos Chicken 650 55 60 20\nBuffalo Chicken with Sweet Potato 496 65 41 8\nChicken Masala 607 67 60 11');
  const r = E.pick({ meals, top: 1 });
  const snackNames = E.SNACKS.map(s => s.name);
  assert.ok(r.options[0].snacks.every(s => snackNames.includes(s.name)));
  assert.deepEqual(E.targetsFrom(null), E.TARGETS);
  assert.equal(E.snackCat('Roasted Almonds'), 'Nuts');
  assert.equal(E.snackCat('Greek Yogurt Berry Cup'), 'Protein');
  assert.equal(E.snackCat('Fresh Fruit Cup'), 'Fruit');
});

let pdfjs = null;
try { pdfjs = require('pdfjs-dist/legacy/build/pdf.js'); } catch (e) { /* optional */ }
const sample = f => new Uint8Array(fs.readFileSync(path.join(__dirname, 'samples', f)));

test('real PDF: table + two-column salad page', { skip: !pdfjs && 'pdfjs-dist not installed' }, async () => {
  const t = await M.textFromPdf(pdfjs, sample('table-menu.pdf'));
  assert.ok(t.hasText);
  assert.equal(t.pages, 2);
  const { items } = M.parseText(t.lines);
  assert.equal(items.length, 16);
  assert.deepEqual(nums(byName(items, 'Turkey Meatballs & Quinoa')), [540, 50, 52, 14]);
  assert.deepEqual(nums(byName(items, 'Halloumi Quinoa Salad')), [420, 22, 35, 21]);
  assert.equal(byName(items, 'Roasted Almonds').section, 'snack');
  assert.ok(items.every(i => !i.needsCheck));
  const r = M.optimize(items, E, { dayType: 'training' });
  assert.ok(r.options[0].check.fits);
});

test('real PDF: a scan has no text layer, so it goes to Claude as images', { skip: !pdfjs && 'pdfjs-dist not installed' }, async () => {
  const t = await M.textFromPdf(pdfjs, sample('scanned-menu.pdf'));
  assert.equal(t.hasText, false);
});
