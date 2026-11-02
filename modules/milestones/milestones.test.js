// Run: node --test modules/milestones/milestones.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./milestones.js');
const G = require('../goal-setup/goal-setup.js');
const T = require('../trend-tdee/trend-tdee.js');

const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const START = '2026-09-01';
const answers = { sex: 'male', age: 29, heightCm: 172, kg: 91.9, activity: 'moderate', goal: 'cut', pace: 'regular', targetKg: 80 };
const plan = (over) => { const a = Object.assign({}, answers, over); return { answers: a, result: G.compute(a, { today: START }), at: START }; };
function weights(days, ratePerWeek, from = 91.9, noise = 0) { const w = {}; for (let i = 0; i < days; i++) { const d = addDays(START, i); w[d] = { date: d, kg: Math.round((from - ratePerWeek * i / 7 + (noise ? (i % 2 ? noise : -noise) : 0)) * 10) / 10 }; } return w; }
const trendOf = (w, today) => T.series(w, { today });

test('weight: a milestone counts after three trend days past it, dated the first of them; a single weigh-in dip does not', () => {
  const today = addDays(START, 60), w = weights(61, 0.5);
  const R = M.detect({ weights: w }, { today, plan: plan(), trend: trendOf(w, today) });
  const kg = R.all.filter(i => i.kind === 'weight');
  assert.deepEqual(kg.map(i => i.id), ['kg:90'], JSON.stringify(kg.map(i => i.id)));
  const tr = trendOf(w, today), first = tr.find(x => x.trend <= 90).date;
  assert.equal(kg[0].date, first); assert.match(kg[0].text, /Three days with the trend under 90 kg/);
  assert.ok(R.next.some(n => n.kind === 'weight' && /85 kg/.test(n.title) && /kg to go on the trend/.test(n.text)), JSON.stringify(R.next));
  // one freak weigh-in under 85 moves the trend only a little: nothing fires
  const w2 = Object.assign({}, w); w2[today] = { date: today, kg: 84.0 };
  assert.equal(M.detect({ weights: w2 }, { today, plan: plan(), trend: trendOf(w2, today) }).all.some(i => i.id === 'kg:85'), false);
});

test('fresh vs old: an install with history records old milestones quietly; only the last three days celebrate, once', () => {
  const today = addDays(START, 60), w = weights(61, 0.5);
  const R = M.detect({ weights: w }, { today, plan: plan(), trend: trendOf(w, today) });
  assert.equal(R.fresh.length, 0, 'the 90 kg day was weeks ago');
  assert.ok(R.unseen.length >= 1);
  const seen = M.mark({}, R.unseen, today);
  const R2 = M.detect({ weights: w }, { today, plan: plan(), trend: trendOf(w, today), seen });
  assert.equal(R2.unseen.length, 0);
  // a milestone reached two days ago is fresh exactly until it is marked
  const w3 = weights(45, 1.0), full = trendOf(w3, addDays(START, 44));
  let run = 0, hitDate = null; for (const x of full) { if (x.trend <= 90) { run++; if (run === 3) { hitDate = full[full.indexOf(x) - 2].date; break; } } else run = 0; }
  assert.ok(hitDate, 'test setup: the trend crosses 90 kg');
  const t2 = addDays(hitDate, 2), tr3 = trendOf(w3, t2);
  const R3 = M.detect({ weights: w3 }, { today: t2, plan: plan(), trend: tr3 });
  assert.ok(R3.fresh.some(i => i.id === 'kg:90'), JSON.stringify(R3.fresh.map(i => i.id)));
  const marked = M.mark({}, R3.fresh, t2);
  assert.equal(M.detect({ weights: w3 }, { today: t2, plan: plan(), trend: tr3, seen: marked }).fresh.length, 0, 'fires once');
  assert.equal(M.detect({ weights: w3 }, { today: addDays(t2, 5), plan: plan(), trend: trendOf(w3, addDays(t2, 5)) }).fresh.some(i => i.id === 'kg:90'), false, 'and never as a late burst');
  assert.equal(M.toastText(R3.all[0]).length > 0, true);
});

test('gain and maintenance plans: milestones go up, and steady weeks count for a hold', () => {
  const today = addDays(START, 60), up = weights(61, -0.8, 80);
  const gain = M.detect({ weights: up }, { today, plan: plan({ goal: 'bulk', pace: 'lean', targetKg: 90, kg: 80 }), trend: trendOf(up, today) });
  assert.ok(gain.all.some(i => i.id === 'kg:85'), JSON.stringify(gain.all.map(i => i.id)));
  assert.match(gain.all.find(i => i.id === 'kg:85').text, /over 85 kg/);
  const flat = weights(61, 0, 91.9, 0.3);
  const hold = M.detect({ weights: flat }, { today, plan: plan({ goal: 'maintain', pace: undefined, targetKg: undefined }), trend: trendOf(flat, today) });
  assert.deepEqual(hold.all.filter(i => i.kind === 'steady').map(i => i.id), ['steady:8', 'steady:4']);
  assert.ok(hold.next.some(n => /12 weeks steady/.test(n.title)));
  const drift = weights(61, 0.6);
  assert.equal(M.detect({ weights: drift }, { today, plan: plan({ goal: 'maintain', pace: undefined, targetKg: undefined }), trend: trendOf(drift, today) }).all.some(i => i.kind === 'steady'), false);
});

test('strength: round numbers crossed by the est. 1RM, skipping ones already held on day one; lb lifts use lb steps', () => {
  const lifts = [
    { name: 'Bench Press', unit: 'kg', points: [{ date: '2026-09-01', e1rm: 95 }, { date: '2026-09-15', e1rm: 101 }, { date: '2026-10-01', e1rm: 112 }, { date: '2026-10-20', e1rm: 121 }] },
    { name: 'Lat Pulldown', unit: 'lb', points: [{ date: '2026-09-01', e1rm: 60 }, { date: '2026-10-01', e1rm: 70 }] },   // kg internally: 132 → 154 lb crosses 150
    { name: 'Curl', unit: 'kg', points: [{ date: '2026-10-01', e1rm: 30 }] },
  ];
  const R = M.detect({}, { today: '2026-10-21', lifts });
  assert.deepEqual(R.all.filter(i => i.kind === 'strength').map(i => i.id).sort(), ['lift:bench-press:100', 'lift:bench-press:120', 'lift:lat-pulldown:150']);
  const b = R.all.find(i => i.id === 'lift:bench-press:100'); assert.equal(b.date, '2026-09-15'); assert.match(b.title, /Bench Press: 100 kg est. 1RM/);
  assert.match(R.all.find(i => i.id === 'lift:lat-pulldown:150').title, /150 lb/);
});

test('consistency: workout counts from both logs and food streaks ending today or yesterday; html is compact and marks fresh items', () => {
  const today = '2026-10-21', docs = { workouts: {}, lb_workouts: {}, days: {} };
  for (let i = 0; i < 9; i++) docs.workouts[addDays('2026-09-01', i * 2)] = { sets: { Squat: [{ w: 100, r: 5 }] } };
  docs.lb_workouts.a = { start: Date.parse('2026-09-20T10:00:00Z') }; docs.lb_workouts.b = { start: '2026-09-22T10:00:00Z' };
  docs.workouts['2026-09-20'] = { sets: { Bench: [{ w: 80, r: 5 }] } };        // same day as a logger workout counts once
  for (let i = 0; i < 7; i++) docs.days[addDays(today, -1 - i)] = { food: [{ name: 'Meal', kcal: 2000, eaten: true }] };
  const R = M.detect(docs, { today });
  assert.ok(R.all.some(i => i.id === 'workouts:10'), JSON.stringify(R.all.map(i => i.id)));
  assert.equal(R.all.find(i => i.id === 'workouts:10').date, '2026-09-20');
  const food = R.all.find(i => i.id.startsWith('food:7:')); assert.ok(food); assert.equal(food.date, addDays(today, -1));
  assert.ok(R.fresh.some(i => i.id === food.id), 'yesterday counts as fresh');
  assert.ok(R.next.some(n => /25 workouts/.test(n.title) && /14 to go/.test(n.text)));
  const h = M.html(R, { today });
  assert.match(h, /ms-card/); assert.match(h, /ms-new/); assert.match(h, /Next up:/); assert.ok(!/<table/.test(h));
  assert.equal(M.html({ all: [], fresh: [], next: [] }), '');
  assert.match(M.css, /prefers-reduced-motion:no-preference/);
  assert.deepEqual(M.detect({}, { today }).all, []);
});
