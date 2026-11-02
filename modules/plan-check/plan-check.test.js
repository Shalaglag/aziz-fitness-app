// Run: node --test modules/plan-check/plan-check.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const PC = require('./plan-check.js');
const G = require('../goal-setup/goal-setup.js');
const T = require('../trend-tdee/trend-tdee.js');

const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const PLAN_DAY = '2026-11-02';
const answers = { sex: 'male', age: 29, heightCm: 172, kg: 91.9, activity: 'moderate', goal: 'cut', pace: 'regular', targetKg: 80 };
const plan = () => ({ answers, result: G.compute(answers, { today: PLAN_DAY }), at: PLAN_DAY + 'T07:00:00Z' });

// days of weigh-ins falling `ratePerWeek` kg a week from 91.9, with `kcal` eaten on every day except `skip`.
function docs(days, { ratePerWeek = 0.5, kcal = 2370, skip = [], noise = 0, until } = {}) {
  const end = until || addDays(PLAN_DAY, days), d = { weights: {}, days: {} };
  for (let i = 0; i < days; i++) {
    const date = addDays(end, -(days - 1 - i)), wob = noise ? (i % 2 ? noise : -noise) : 0;
    d.weights[date] = { date, kg: Math.round((91.9 - ratePerWeek * i / 7 + wob) * 10) / 10 };
    if (!skip.includes(i)) d.days[date] = { date, food: [{ id: 'a', name: 'Food', kcal, p: 180, c: 250, f: 65, eaten: true }] };
  }
  return d;
}
const est = (D, today) => T.estimate(D, { today, kcal: 2370, floor: 1800, review: '2026-11-15' });
const opts = (D, today, extra) => Object.assign({ today, plan: plan(), targets: { kcal: 2370 }, tdee: est(D, today), compute: G.compute }, extra || {});

test('no plan → nothing; under 14 days → waiting with the date', () => {
  assert.equal(PC.recheck({}, { today: '2026-11-10', plan: null }).status, 'none');
  const R = PC.recheck(docs(8), opts(docs(8), '2026-11-10'));
  assert.equal(R.status, 'waiting'); assert.equal(R.nextAt, '2026-11-16'); assert.match(R.reasons[0], /6 more days/);
});

test('14 days in but food missing on too many days → waits and says so', () => {
  const today = '2026-11-16', D = docs(28, { skip: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], until: today });
  const R = PC.recheck(D, opts(D, today));
  assert.equal(R.status, 'waiting'); assert.match(R.reasons[0], /Food was logged on/);
});

test('ready: estimate labelled with a range; a difference under 100 kcal is "keep"', () => {
  const today = '2026-11-16', D = docs(28, { ratePerWeek: 0.46, kcal: 2370, until: today });
  const R = PC.recheck(D, opts(D, today));
  assert.equal(R.status, 'ready');
  assert.ok(R.estimate.lo <= R.estimate.kcal && R.estimate.kcal <= R.estimate.hi);
  // eating 2,370 and losing 0.46 kg/wk means maintenance ≈ 2,370 + 0.46 × 7700 / 7 ≈ 2,876, the formula's 2,874
  assert.ok(Math.abs(R.estimate.kcal - 2876) <= 30, 'estimate ' + R.estimate.kcal);
  assert.equal(R.verdict, 'keep');
  assert.match(PC.html(R), /Keep 2,370 kcal/);
  assert.doesNotMatch(PC.html(R), /real burn/i);
});

test('ready: a slower-than-planned loss means a lower estimate and an offer, never an automatic change', () => {
  const today = '2026-11-16', D = docs(28, { ratePerWeek: 0.15, kcal: 2370, until: today });
  const R = PC.recheck(D, opts(D, today));
  assert.equal(R.status, 'ready'); assert.equal(R.verdict, 'offer');
  assert.ok(R.estimate.kcal < 2600 && R.proposed.kcal < 2370, JSON.stringify([R.estimate.kcal, R.proposed.kcal]));
  assert.equal(R.proposed.tdeeSource, 'measured');
  assert.equal(R.proposed.answers.kg, R.estimate.trendNow, 'proposal uses the trend weight');
  const h = PC.html(R);
  assert.match(h, /estimate/i); assert.match(h, /data-pc="apply"/); assert.match(h, /data-pc="keep"/); assert.match(h, /data-pc="later"/);
  assert.ok(R.proposed.kcal >= R.proposed.floor, 'the safety floor still holds');
});

test('noisy weigh-ins widen the range past ±250 kcal → waits', () => {
  const today = '2026-11-16', D = docs(28, { ratePerWeek: 0.4, noise: 1.4, until: today });
  const R = PC.recheck(D, opts(D, today));
  assert.equal(R.status, 'waiting'); assert.match(R.reasons[0], /swing/);
});

test('decide: apply moves calories/macros but keeps start date, weight and goal; keep/later are recorded', () => {
  const today = '2026-11-16', D = docs(28, { ratePerWeek: 0.15, until: today });
  const P = plan(), R = PC.recheck(D, opts(D, today, { plan: P }));
  const ap = PC.decide(P, R, 'apply', today);
  assert.equal(ap.profile.cutKcal, R.proposed.kcal); assert.equal(ap.profile.protein, R.proposed.protein);
  assert.equal(ap.plan.result.today, PLAN_DAY, 'plan start date kept');
  assert.equal(ap.plan.result.profile.goalKg, 80);
  assert.equal(ap.plan.recheck.decision, 'apply'); assert.equal(ap.plan.recheck.from, 2370); assert.equal(ap.plan.recheck.to, R.proposed.kcal);
  assert.ok(!('start' in ap.profile) && !('startKg' in ap.profile) && !('goalKg' in ap.profile), 'only the calorie fields move');
  const kp = PC.decide(P, R, 'keep', today);
  assert.equal(kp.profile, null); assert.equal(kp.plan.recheck.decision, 'keep');
  const lt = PC.decide(P, R, 'later', today);
  assert.equal(lt.plan.recheck.nextAt, '2026-11-23');
  // after a decision the card shows what happened and the next date; "later" waits a week
  const R2 = PC.recheck(D, opts(D, '2026-11-18', { plan: kp.plan }));
  assert.equal(R2.status, 'decided'); assert.equal(R2.nextAt, '2026-11-30'); assert.match(PC.html(R2), /kept 2,370 kcal/);
  const R3 = PC.recheck(D, opts(D, '2026-11-18', { plan: lt.plan }));
  assert.equal(R3.status, 'waiting'); assert.match(R3.reasons[0], /Nov 23/);
});

test('weekLine: needs 4 weigh-ins, compares the two-week trend with the plan, never blames water', () => {
  const today = '2026-11-16';
  const line = D => PC.weekLine(D, { today, plan: plan(), trend: T.series(D.weights, { today }) });
  const few = docs(28, { until: today }); ['2026-11-16', '2026-11-15', '2026-11-14', '2026-11-13'].forEach(d => delete few.weights[d]);
  assert.match(line(few)[2], /Only 3 of 7 weigh-ins/);
  const on = line(docs(28, { ratePerWeek: 0.46, until: today }));
  assert.equal(on[0], 'good'); assert.match(on[2], /On plan/); assert.match(on[2], /two-week trend/i);
  const slow = line(docs(28, { ratePerWeek: 0.1, until: today }));
  assert.equal(slow[0], 'warn'); assert.match(slow[2], /Slower than planned/);
  const fast = line(docs(28, { ratePerWeek: 1.2, until: today }));
  assert.match(fast[2], /Faster than planned/); assert.doesNotMatch(fast[2], /water likely/);
  assert.match(fast[2], /single week never changes your targets/);
  const gaining = line(docs(28, { ratePerWeek: -0.3, until: today }));
  assert.match(gaining[2], /Not moving the planned way/);
});

test('weekLine for maintain and gain plans', () => {
  const today = '2026-11-16';
  const mk = (goal, extra) => { const a = Object.assign({}, answers, { goal }, extra); return { answers: a, result: G.compute(a, { today: PLAN_DAY }), at: PLAN_DAY }; };
  const steady = docs(28, { ratePerWeek: 0.05, until: today });
  const m = PC.weekLine(steady, { today, plan: mk('maintain', { pace: undefined, targetKg: undefined }), trend: T.series(steady.weights, { today }) });
  assert.equal(m[0], 'good'); assert.match(m[2], /steady/);
  const up = docs(28, { ratePerWeek: -0.25, until: today });
  const b = PC.weekLine(up, { today, plan: mk('bulk', { pace: 'lean', targetKg: 95 }), trend: T.series(up.weights, { today }) });
  assert.equal(b[0], 'good'); assert.match(b[2], /gain about 0.23 kg a week/);
});

test('phases: cut shows start, optional breaks, goal and an optional return to maintenance; gain and maintain explain maintenance', () => {
  const P = PC.phases(plan(), { today: '2026-11-16', kg: 90.5, maintenanceKcal: 2850, breaks: [{ start: '2026-12-28', end: '2027-01-03' }, { start: '2026-10-05', end: '2026-10-11' }], reverse: { weeks: 5, to: 2850 } });
  assert.deepEqual(P.items.map(i => i.kind), ['start', 'break', 'goal', 'after']);
  assert.equal(P.items[1].optional, true); assert.match(P.items[1].text, /nothing starts by itself/);
  assert.match(P.items[2].text, /80 kg around May 3 \(10.5 kg to go\)/);
  assert.match(P.items[3].text, /over about 5 weeks, adding 100 kcal a week/); assert.match(P.items[3].text, /Maintenance means eating about what you burn/);
  assert.match(P.note, /never switches your calories on its own/);
  const h = PC.phasesHtml(P);
  assert.match(h, /pc-tl/); assert.match(h, /class="break opt"/); assert.doesNotMatch(h, /mandatory|must/i);
  const mk = (goal, extra) => { const a = Object.assign({}, answers, { goal }, extra); return { answers: a, result: G.compute(a, { today: PLAN_DAY }), at: PLAN_DAY }; };
  const gain = PC.phases(mk('bulk', { pace: 'lean', targetKg: 95 }), { today: '2026-11-16' });
  assert.deepEqual(gain.items.map(i => i.kind), ['start', 'goal', 'after']); assert.match(gain.items[2].text, /Hold the new weight/);
  const hold = PC.phases(mk('maintain', { pace: undefined, targetKg: undefined }), { today: '2026-11-16' });
  assert.deepEqual(hold.items.map(i => i.kind), ['start', 'after']); assert.match(hold.items[1].text, /about 2,8\d\d kcal for you/);
  assert.equal(PC.phases(null, {}), null); assert.equal(PC.phasesHtml(null), '');
});
