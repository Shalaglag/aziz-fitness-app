// Run: node --test modules/goal-setup/goal-setup.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('./goal-setup.js');

const TODAY = '2026-11-02';
const AZIZ = { sex: 'male', age: 29, heightCm: 172, kg: 91.9, activity: 'moderate', goal: 'cut', pace: 'regular', targetKg: 80 };
const run = (over, today) => G.compute(Object.assign({}, AZIZ, over), { today: today || TODAY });

test('Mifflin-St Jeor BMR and activity multiplier', () => {
  const r = run({});
  assert.equal(r.bmr, 1854);                       // 10*91.9 + 6.25*172 - 5*29 + 5
  assert.equal(r.tdee, Math.round(1854 * 1.55));
  const f = run({ sex: 'female', age: 30, heightCm: 165, kg: 70, activity: 'sedentary', targetKg: 62 });
  assert.equal(f.bmr, Math.round(10 * 70 + 6.25 * 165 - 150 - 161));
  assert.equal(f.tdee, Math.round(f.bmr * 1.2));
});

test('regular cut: 0.5 %/wk of body weight, 7,700 kcal/kg deficit, rounded to 10', () => {
  const r = run({});
  assert.equal(r.rateKgWk, 0.46);
  assert.equal(r.kcal, Math.round((r.tdee - 0.46 * 7700 / 7) / 10) * 10);
  assert.equal(r.deficit, r.kcal - r.tdee);
  assert.ok(r.deficit < -450 && r.deficit > -560);
});

test('protein 1.6–2.2 g/kg by goal, BMI-30 weight used when heavier; fat 25 %; carbs fill', () => {
  const r = run({});
  assert.equal(r.proteinPerKg, 2.0);
  assert.equal(r.proteinKg, 88.8);                 // 30 × 1.72²
  assert.equal(r.protein, Math.round(88.8 * 2 / 5) * 5);
  assert.equal(r.fat, Math.round(Math.max(r.kcal * 0.25 / 9, 91.9 * 0.6) / 5) * 5);
  assert.equal(r.carbs, Math.round((r.kcal - r.protein * 4 - r.fat * 9) / 4 / 5) * 5);
  const m = run({ goal: 'maintain', pace: undefined, targetKg: undefined, kg: 75 });
  assert.equal(m.proteinPerKg, 1.6); assert.equal(m.protein, 120); assert.equal(m.kcal, Math.round(m.tdee / 10) * 10); assert.equal(m.deficit, 0);
  assert.equal(run({ goal: 'bulk', pace: 'lean', targetKg: 95 }).proteinPerKg, 1.8);
  assert.equal(run({ goal: 'muscle', pace: 'lean', targetKg: 95 }).proteinPerKg, 2.0);
});

test('timeline: linear at the weekly rate, 5 kg milestones, final equals the end date', () => {
  const r = run({});
  assert.equal(r.weeks, Math.round(11.9 / 0.46 * 10) / 10);
  assert.equal(r.endDate, '2027-05-03');
  assert.deepEqual(r.milestones.map(m => m.kg), [90, 85, 80]);
  assert.equal(r.milestones[2].date, r.endDate);
  assert.ok(r.milestones[0].date < r.milestones[1].date);
  const big = run({ kg: 130, targetKg: 95, heightCm: 180 });
  assert.deepEqual(big.milestones.map(m => m.kg), [120, 110, 100, 95]);
});

test('every cut pace is within the 0.35–1 %/wk evidence band; extreme warns about muscle', () => {
  G.PACES.cut.forEach(p => assert.ok(p.pct >= 0.35 && p.pct <= 1.0, p.id));
  G.PACES.bulk.concat(G.PACES.muscle).forEach(p => assert.ok(p.pct >= 0.25 && p.pct <= 0.5, p.id));
  const x = run({ pace: 'extreme' });
  assert.ok(x.warnings.some(w => /muscle/.test(w)));
  assert.equal(x.floored, true, 'for Aziz 1 %/wk needs ~1,860 kcal, under his 2,012 floor');
  assert.ok(x.ratePct < 1 && x.kcal === 2010);
  const light = run({ pace: 'extreme', activity: 'very' });
  assert.equal(light.ratePct, 1); assert.equal(light.floored, false);
});

test('safety floor: 1,200/1,500 kcal or a 30 % deficit, whichever is higher; the pace slows and says so', () => {
  const f = run({ sex: 'female', age: 45, heightCm: 158, kg: 58, activity: 'sedentary', pace: 'extreme', targetKg: 52 });
  assert.equal(f.floored, true);
  assert.equal(f.kcal, Math.round(Math.max(1200, f.tdee * 0.7) / 10) * 10);
  assert.ok(f.rateKgWk < 0.58, 'rate slowed to what the floor allows');
  assert.ok(f.warnings.some(w => /safe minimum/.test(w)));
  assert.equal(f.profile.kcalFloor, f.floor);
  const a = run({});
  assert.equal(a.floor, Math.round(a.tdee * 0.7));   // 2,012 for Aziz: his own 2,000 rule falls out of the maths
  assert.equal(a.floored, false);
});

test('date mode: works out the rate the date needs and flags one faster than 1 %/wk with an earliest date', () => {
  const ok = run({ mode: 'date', pace: undefined, endDate: '2027-05-02', targetKg: 80 });
  assert.equal(ok.mode, 'date');
  assert.equal(ok.rateKgWk, Math.round(11.9 / (181 / 7) * 100) / 100);
  assert.equal(ok.warnings.length, 0);
  const fast = run({ mode: 'date', pace: undefined, endDate: '2026-12-14', targetKg: 80 });
  assert.ok(fast.warnings.some(w => /earliest realistic date/.test(w)));
  assert.equal(fast.floored, true, 'and the calories still stop at the floor');
  const gain = run({ goal: 'bulk', mode: 'date', pace: undefined, endDate: '2026-12-14', targetKg: 100 });
  assert.ok(gain.warnings.some(w => /mostly fat/.test(w)));
});

test('validation: missing or impossible answers come back as field errors, never a throw', () => {
  assert.equal(G.compute({}).ok, false);
  const e = G.compute({ sex: 'male', age: 5, heightCm: 172, kg: 90, activity: 'moderate', goal: 'cut', pace: 'regular', targetKg: 95 }).errors;
  assert.ok(e.some(x => x.field === 'age'));
  assert.ok(e.some(x => x.field === 'targetKg' && /below/.test(x.msg)));
  const d = G.compute(Object.assign({}, AZIZ, { mode: 'date', targetKg: undefined })).errors;
  assert.ok(d.some(x => x.field === 'endDate') && d.some(x => x.field === 'targetKg'));
  assert.ok(G.compute(Object.assign({}, AZIZ, { goal: 'bulk', pace: 'lean', targetKg: 85 })).errors.some(x => x.field === 'targetKg'));
});

test('profile for AppTargets: start today, start/goal kg, calories, maintenance, protein, fat', () => {
  const r = run({});
  assert.deepEqual(Object.keys(r.profile).sort(), ['cutKcal', 'fat', 'goalKg', 'kcalFloor', 'maintenance', 'protein', 'start', 'startKg']);
  assert.equal(r.profile.start, TODAY); assert.equal(r.profile.startKg, 91.9); assert.equal(r.profile.goalKg, 80);
  assert.equal(r.profile.cutKcal, r.kcal); assert.equal(r.profile.maintenance, r.tdee);
  const m = run({ goal: 'maintain', targetKg: undefined, pace: undefined });
  assert.equal(m.profile.goalKg, 91.9);
});

test('needsRerun: a kilo or more away from the weight the plan used', () => {
  const saved = { answers: AZIZ, result: run({}) };
  assert.equal(G.needsRerun(saved, 91.2), false);
  assert.equal(G.needsRerun(saved, 90.9), true);
  assert.equal(G.needsRerun(saved, 93), true);
  assert.equal(G.needsRerun(null, 80), false);
});

test('compactHtml: gain and maintain lines, re-dated from the latest weight; empty for a cut (GoalDate owns it)', () => {
  const bulk = { answers: AZIZ, result: run({ goal: 'bulk', pace: 'lean', targetKg: 95 }) };
  assert.match(G.compactHtml(bulk, { today: TODAY, kg: 92 }), /Gain to .*95 kg.* 0\.23 kg a week · about/);
  assert.match(G.compactHtml(bulk, { today: TODAY, kg: 96 }), /reached/);
  assert.match(G.compactHtml({ result: run({ goal: 'maintain', pace: undefined, targetKg: undefined }) }, { today: TODAY }), /Maintaining/);
  assert.equal(G.compactHtml({ result: run({}) }, { today: TODAY, kg: 90 }), '');
});

test('open(): walks the steps in a DOM, validates each, and only calls onApply on the last tap', () => {
  // A tiny DOM stand-in is more than this needs; use jsdom when present, otherwise skip.
  let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (e) { return; }
  const dom = new JSDOM('<body></body>', { pretendToBeVisual: true }), doc = dom.window.document;
  let applied = null, closed = null;
  const h = G.open({ document: doc, today: TODAY, firstRun: true, onApply: r => { applied = r; }, onClose: r => { closed = r; } });
  const click = sel => doc.querySelector(sel).click();
  assert.ok(doc.querySelector('.gs-wrap[role="dialog"]'));
  assert.ok(doc.querySelector('[data-gs="skip"]'), 'first run offers Skip');
  click('[data-gs="next"]');
  assert.ok(doc.querySelector('.gs-err'), 'empty About step shows errors');
  click('[data-gs="pick"][data-v="male"]');
  doc.querySelector('[data-gs-f="age"]').value = '29'; doc.querySelector('[data-gs-f="heightCm"]').value = '172'; doc.querySelector('[data-gs-f="kg"]').value = '91.9';
  click('[data-gs="next"]'); click('[data-gs="pick"][data-v="moderate"]'); click('[data-gs="next"]');
  click('[data-gs="pick"][data-v="cut"]'); click('[data-gs="next"]');
  click('[data-gs="pick"][data-v="regular"]'); doc.querySelector('[data-gs-f="targetKg"]').value = '80'; click('[data-gs="next"]');
  assert.ok(/2,370/.test(doc.querySelector('.gs-hero').textContent) || doc.querySelector('.gs-hero .big'));
  assert.equal(applied, null);
  click('[data-gs="apply"]');
  assert.equal(applied.kcal, 2370); assert.equal(closed, 'apply');
  assert.equal(doc.querySelector('.gs-wrap'), null);
  h.close();
});

test('body fat (optional): lean-mass formula averaged in, labelled with the method\'s error band; protein from lean mass; nothing predicted', () => {
  const r = run({ bodyFatPct: 22, bodyFatMethod: 'scale', bodyFatAt: '2026-11-01' });
  assert.equal(r.tdeeSource, 'bodyfat');
  assert.equal(r.body.leanKg, 71.7); assert.equal(r.body.fatKg, 20.2); assert.equal(r.body.pm, 6); assert.equal(r.body.at, '2026-11-01');
  const katch = Math.round(370 + 21.6 * 71.7);
  assert.equal(r.body.bmrKatch, katch); assert.equal(r.tdee, Math.round((1854 + katch) / 2 * 1.55));
  assert.ok(r.body.tdeeLo <= r.tdee && r.tdee <= r.body.tdeeHi, JSON.stringify([r.body.tdeeLo, r.tdee, r.body.tdeeHi]));
  assert.ok(r.notes.some(n => /smart scale \(bia\) \(usually within ±6 points, measured Nov 1\)/.test(n) && /treat it as a range, not a reading/.test(n)));
  assert.equal(r.protein, 185, '2.6 g × 71.7 kg lean = 186 → 185');
  assert.ok(r.notes.some(n => /lean mass \(2\.6 g per kg/.test(n)));
  assert.ok(!r.notes.concat(r.warnings).some(n => /body fat will|will be \d+ %/.test(n)), 'no future body-fat promise');
  const dexa = run({ bodyFatPct: 22, bodyFatMethod: 'dexa' });
  assert.equal(dexa.body.pm, 3); assert.ok(dexa.body.tdeeHi - dexa.body.tdeeLo < r.body.tdeeHi - r.body.tdeeLo, 'a scan narrows the band');
  assert.equal(run({ bodyFatPct: 22 }).body.method, 'scale', 'method defaults to the least certain');
  assert.equal(run({}).body, null); assert.equal(run({}).tdeeSource, 'formula');
});

test('waist (optional): ratio to height with the health note, never a body-fat claim or a formula change', () => {
  const r = run({ waistCm: 95, waistAt: '2026-11-01' });
  assert.equal(r.tdeeSource, 'formula'); assert.equal(r.tdee, Math.round(1854 * 1.55));
  assert.equal(r.body.whtr, 0.55); assert.equal(r.body.waistAt, '2026-11-01');
  assert.ok(r.notes.some(n => /Waist 95 cm is 0\.55 of your height \(over 0\.5/.test(n) && /not a body-fat measurement/.test(n)));
  assert.ok(run({ waistCm: 80 }).notes.some(n => /under 0\.5, the usual healthy marker/.test(n)));
  const e = G.compute(Object.assign({}, AZIZ, { bodyFatPct: 70, waistCm: 30 })).errors;
  assert.ok(e.some(x => x.field === 'bodyFatPct') && e.some(x => x.field === 'waistCm'));
  assert.equal(G.compute(Object.assign({}, AZIZ, { bodyFatPct: '' , waistCm: undefined })).ok, true, 'blank optional fields are fine');
});
