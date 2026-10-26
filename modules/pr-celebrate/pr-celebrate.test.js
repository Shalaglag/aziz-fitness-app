// node --test modules/pr-celebrate/pr-celebrate.test.js
const test = require('node:test');
const assert = require('node:assert');
const P = require('./pr-celebrate.js');

const R = {
  weight: { v: 90, w: 90, r: 8, unit: 'kg', at: Date.UTC(2026, 9, 12) },
  e1rm: { v: 114, w: 90, r: 8, unit: 'kg', at: Date.UTC(2026, 9, 12) },
  volume: { v: 720, w: 90, r: 8, unit: 'kg', at: Date.UTC(2026, 9, 12) },
  reps: { v: 10, at: Date.UTC(2026, 9, 5) },
  km: { v: 3, at: 1 }, min: { v: 20, at: 1 }, sec: null,
};
const fmtDate = () => '12 Oct';

test('a weight record names the new weight and the old best set', () => {
  const d = P.describe(['Weight'], R, { w: '92.5', r: '8' }, { name: 'Bench', unit: 'kg', fmtDate });
  assert.strictEqual(d.headline, 'Bench: Weight record');
  assert.strictEqual(d.detail, '92.5 kg · was 90 kg × 8 on 12 Oct');
  assert.strictEqual(d.lines[0].was, '90 kg × 8');
});

test('est. 1RM uses the host formula and shows the old best in the set unit', () => {
  const d = P.describe(['Est. 1RM'], R, { w: '95', r: '8' }, { unit: 'kg', fmtDate });
  assert.strictEqual(d.lines[0].now, '120.3 kg');
  assert.strictEqual(d.lines[0].was, '114 kg (90 kg × 8)');
  const d2 = P.describe(['Est. 1RM'], R, { w: '95', r: '8' }, { unit: 'kg', e1rm: (w, r) => w + r });
  assert.strictEqual(d2.lines[0].now, '103 kg');
});

test('lb sets convert the kg-based bests back to lb', () => {
  const d = P.describe(['Volume', 'Weight'], { weight: { v: 45.359237, w: 100, r: 5, unit: 'lb', at: 0 }, volume: { v: 226.8, w: 100, r: 5, unit: 'lb', at: 0 } }, { w: '105', r: '5' }, { unit: 'lb' });
  assert.strictEqual(d.lines[0].now, '525 lb');
  assert.strictEqual(d.lines[0].was, '500 lb (100 lb × 5)');
  assert.strictEqual(d.lines[1].was, '100 lb × 5');
});

test('several records fold into one headline with the rest listed', () => {
  const d = P.describe(['Est. 1RM', 'Weight', 'Volume'], R, { w: '95', r: '9' }, { name: 'Squat', unit: 'kg', fmtDate });
  assert.strictEqual(d.headline, 'Squat: 3 records');
  assert.match(d.text, /^Squat: 3 records · 123\.5 kg · was 114 kg \(90 kg × 8\) on 12 Oct · also Weight \(was 90 kg × 8\), Volume \(was 720 kg \(90 kg × 8\)\)$/);
});

test('reps, distance and time records read naturally', () => {
  assert.strictEqual(P.describe(['Reps'], R, { r: '12' }).detail.slice(0, 20), '12 reps · was 10 rep');
  assert.strictEqual(P.describe(['Distance'], R, { km: '3.5' }).lines[0].was, '3 km');
  const t = P.describe(['Time'], R, { min: '25', sec: '30' }).lines[0];
  assert.strictEqual(t.now, '25 min 30 s'); assert.strictEqual(t.was, '20 min');
});

test('no history: the line still describes the set without a "was"', () => {
  const d = P.describe(['Weight'], {}, { w: '60', r: '5' }, { unit: 'kg' });
  assert.strictEqual(d.detail, '60 kg');
  assert.strictEqual(P.describe([], R, {}).text, 'New record');
});

test('vibration grows with the number of records and is empty for none', () => {
  assert.deepStrictEqual(P.vibration([]), []);
  assert.deepStrictEqual(P.vibration(['Weight']), [60, 60, 60]);
  assert.strictEqual(P.vibration(['a', 'b']).length, 5);
  assert.strictEqual(P.vibration(['a', 'b', 'c']).at(-1), 200);
});

test('fire toasts and vibrates through the host callbacks, and respects the setting', () => {
  const d = P.describe(['Weight'], R, { w: '92.5', r: '8' }, { name: 'Bench', unit: 'kg', fmtDate });
  const calls = [], nav = { vibrate: p => { calls.push(p); return true; } };
  const out = P.fire(d, { toast: m => calls.push(m), nav });
  assert.deepStrictEqual(out, { toasted: true, vibrated: true });
  assert.strictEqual(calls[0], '🏆 Bench: Weight record · 92.5 kg · was 90 kg × 8 on 12 Oct');
  assert.deepStrictEqual(calls[1], [60, 60, 60]);
  const quiet = P.fire(d, { toast: () => {}, nav, vibrate: false });
  assert.strictEqual(quiet.vibrated, false);
  assert.deepStrictEqual(P.fire(P.describe([], R, {}), { toast: () => assert.fail('no toast for no record'), nav }), { toasted: false, vibrated: false });
  assert.strictEqual(P.fire(d, { toast: () => {}, nav: { vibrate: () => { throw new Error('x'); } } }).vibrated, false);
});

test('banner html shows the headline, the new value and the old best, escaped', () => {
  const d = P.describe(['Weight'], R, { w: '92.5', r: '8' }, { name: 'Bench <A>', unit: 'kg' });
  const h = P.bannerHtml(d);
  assert.match(h, /lb-gym-pr pr-celebrate/);
  assert.match(h, /Bench &lt;A&gt;: Weight record/);
  assert.match(h, /Weight 92\.5 kg <small>was 90 kg × 8<\/small>/);
  assert.strictEqual(P.bannerHtml(P.describe([], R, {})), '');
});
