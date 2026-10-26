// Run: node --test modules/workout-share/workout-share.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkoutShare: WS } = require('./workout-share.js');

const LIB = {
  bench: { name: 'Bench Press (Barbell)', cat: 'Barbell', unit: 'kg' },
  row: { name: 'Seated Row (Cable)', cat: 'Cable', unit: 'kg' },
  pullup: { name: 'Pull-up', cat: 'Bodyweight' },
  plank: { name: 'Plank', cat: 'Duration' },
  tread: { name: 'Treadmill', cat: 'Cardio' },
  curl: { name: 'Curl (Dumbbell)', cat: 'Dumbbell', unit: 'lb' },
};
const getEx = id => LIB[id] || { name: id };
const START = Date.UTC(2026, 9, 25, 15, 0), END = START + 58 * 6e4;

const workout = {
  id: 'w1', name: 'Push A', start: START, end: END, notes: 'Felt strong',
  exercises: [
    { exId: 'bench', unit: 'kg', sets: [
      { t: 'w', w: 40, r: 10, done: true },
      { t: 'n', w: 80, r: 8, done: true, pr: [] },
      { t: 'n', w: 80, r: 8, done: true, pr: [] },
      { t: 'n', w: 80, r: 8, done: true, pr: ['Est. 1RM', 'Volume'] }] },
    { exId: 'row', unit: 'kg', sets: [
      { t: 'n', w: 95, r: 10, done: true }, { t: 'n', w: 95, r: 9, done: true }, { t: 'n', w: 90, r: 10, done: false }] },
    { exId: 'pullup', unit: 'kg', sets: [{ t: 'n', r: 8, done: true }, { t: 'n', r: 6, done: true }] },
    { exId: 'plank', sets: [{ t: 'n', sec: 75, done: true }] },
    { exId: 'tread', sets: [{ t: 'n', km: 2.1, min: 30, done: true }] },
    { exId: 'curl', unit: 'lb', sets: [{ t: 'n', w: 30, r: 12, done: true }, { t: 'd', w: 20, r: 12, done: true }] },
    { exId: 'skipped', sets: [{ t: 'n', w: '', r: '' }] },
  ],
};

test('summarize counts working sets, volume in kg, PRs and skips unfinished or empty sets', () => {
  const s = WS.summarize(workout, getEx);
  assert.equal(s.name, 'Push A');
  assert.equal(s.durationMin, 58);
  assert.equal(s.sets, 3 + 2 + 2 + 1 + 1 + 2);
  // bench 3×80×8 = 1920, row 950 + 855 = 1805, curl (30 + 20) lb × 12 = 272.2 kg
  assert.equal(s.volumeKg, Math.round(1920 + 1805 + (30 * 12 + 20 * 12) * 0.45359237));
  assert.equal(s.prCount, 1);
  assert.deepEqual(s.prs[0], { exercise: 'Bench Press (Barbell)', text: '80 kg × 8', kinds: ['Est. 1RM', 'Volume'] });
  assert.equal(s.exercises.length, 6, 'the exercise with only blank sets is dropped');
  const bench = s.exercises[0];
  assert.equal(bench.warmups, 1);
  assert.equal(bench.compact, '3 × 8 @ 80 kg');
  assert.equal(bench.best, '80 kg × 8');
  assert.equal(bench.volumeKg, 1920);
  assert.equal(s.exercises[1].compact, '95×10, 95×9 kg');
  assert.equal(s.exercises[2].compact, '8, 6 reps');
  assert.equal(s.exercises[3].compact, '1:15');
  assert.equal(s.exercises[4].compact, '2.1 km · 30 min');
  assert.equal(s.exercises[5].sets[1].label, 'D', 'drop sets keep their tag');
});

test('summarize survives missing getEx, missing end and unknown exercises', () => {
  const s = WS.summarize({ name: 'Ad hoc', start: START, exercises: [{ exId: 'mystery', sets: [{ t: 'n', w: 10, r: 5 }] }] });
  assert.equal(s.exercises[0].name, 'mystery');
  assert.equal(s.volumeKg, 50);
  assert.ok(s.durationMin >= 0);
});

test('text is WhatsApp-ready: bold name, stats line, one line per exercise, PR list, notes, footer', () => {
  const s = WS.summarize(workout, getEx);
  const t = WS.text(s, { footer: 'Logged with my app' });
  const lines = t.split('\n');
  assert.match(lines[0], /^🏋️ \*Push A\* — /);
  assert.equal(lines[1], '⏱ 58 min · 📦 ' + s.volumeKg.toLocaleString('en-US') + ' kg · 🔢 11 sets · 🏆 1 PR');
  assert.equal(lines[2], '');
  assert.equal(lines[3], '🏆 *Bench Press (Barbell)* 3 × 8 @ 80 kg');
  assert.equal(lines[4], '• *Seated Row (Cable)* 95×10, 95×9 kg');
  assert.ok(t.includes('🏆 *New records*\n• Bench Press (Barbell) 80 kg × 8 (Est. 1RM, Volume)'));
  assert.ok(t.includes('📝 Felt strong'));
  assert.ok(t.endsWith('\nLogged with my app'));
});

test('text without PRs, volume or notes stays short', () => {
  const s = WS.summarize({ name: 'Core', start: START, end: END, exercises: [{ exId: 'plank', sets: [{ t: 'n', sec: 60 }] }] }, getEx);
  const t = WS.text(s);
  assert.equal(t, '🏋️ *Core* — ' + t.split(' — ')[1].split('\n')[0] + '\n⏱ 58 min · 🔢 1 sets\n\n• *Plank* 1:00');
  assert.ok(!t.includes('New records'));
});

test('layout grows with exercises and PRs, caps the exercise list', () => {
  const s = WS.summarize(workout, getEx);
  const L = WS.layout(s);
  assert.equal(L.width, 1080);
  const types = L.rows.map(r => r.type);
  assert.deepEqual(types.slice(0, 3), ['title', 'sub', 'tiles']);
  assert.equal(types.filter(t => t === 'exercise').length, 6);
  assert.ok(types.includes('heading') && types.includes('pr') && types.at(-1) === 'footer');
  assert.deepEqual(L.rows[2].tiles.map(t => t[0]), ['58 min', s.volumeKg.toLocaleString('en-US'), '11', '1']);
  assert.equal(L.rows[2].tiles[3][1], 'Record');
  const many = { ...workout, exercises: Array.from({ length: 15 }, (_, i) => ({ exId: 'bench', sets: [{ t: 'n', w: 50 + i, r: 5 }] })) };
  const L2 = WS.layout(WS.summarize(many, getEx), { maxExercises: 12 });
  assert.equal(L2.rows.filter(r => r.type === 'exercise').length, 12);
  assert.equal(L2.rows.find(r => r.type === 'more').text, '+ 3 more exercises');
  assert.ok(L2.height > L.height - 200, 'height tracks the row count');
  assert.equal(L.height, L.rows.at(-1).y + 70 + 32);
});

// A recording 2D context so draw() runs without a browser.
function fakeCanvas() {
  const calls = [];
  const ctx = new Proxy({ measureText: s => ({ width: String(s).length * 16 }) }, {
    get(t, k) { if (k in t) return t[k]; return (...a) => { calls.push([k, ...a]); }; },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { canvas: { getContext: () => ctx, width: 0, height: 0 }, calls };
}

test('draw paints every row onto the given canvas and sizes it from the layout', () => {
  const s = WS.summarize(workout, getEx);
  const { canvas, calls } = fakeCanvas();
  const out = WS.draw(s, { canvas, theme: { accent: '#ff0000' } });
  assert.equal(out, canvas);
  const L = WS.layout(s);
  assert.equal(canvas.width, L.width);
  assert.equal(canvas.height, L.height);
  const texts = calls.filter(c => c[0] === 'fillText').map(c => c[1]);
  assert.ok(texts.includes('Push A'));
  assert.ok(texts.includes('★ Bench Press (Barbell)'));
  assert.ok(texts.includes('NEW RECORDS'));
  assert.ok(texts.some(t => t.startsWith('🏆 Bench Press (Barbell) · 80 kg × 8')));
  assert.ok(texts.includes('Duration') && texts.includes('Volume kg') && texts.includes('Sets') && texts.includes('Record'));
  assert.ok(calls.some(c => c[0] === 'fillRect' && c[1] === 0 && c[2] === 0 && c[3] === L.width && c[4] === L.height), 'background fills the whole card');
});

test('draw truncates long names instead of overflowing', () => {
  const long = { name: 'A'.repeat(200), start: START, end: END, exercises: [{ exId: 'bench', sets: [{ t: 'n', w: 1, r: 1 }] }] };
  const { canvas, calls } = fakeCanvas();
  WS.draw(WS.summarize(long, getEx), { canvas, theme: {} });
  const title = calls.find(c => c[0] === 'fillText' && String(c[1]).startsWith('AAA'))[1];
  assert.ok(title.endsWith('…') && title.length < 100);
});

test('share: Web Share with files when supported, text otherwise, copy + download as the last resort', async () => {
  const s = WS.summarize(workout, getEx);
  const mk = () => ({ getContext: () => new Proxy({ measureText: () => ({ width: 10 }) }, { get: (t, k) => k in t ? t[k] : () => { }, set: (t, k, v) => { t[k] = v; return true; } }), toBlob: cb => cb(new Blob(['x'])), toDataURL: () => 'data:image/png;base64,AA==' });
  const g = globalThis;
  const old = { navigator: g.navigator, File: g.File };
  try {
    let got = null;
    g.File = class { constructor(parts, name, o) { this.name = name; this.type = o.type; } };
    Object.defineProperty(g, 'navigator', { value: { share: async d => { got = d; }, canShare: () => true }, configurable: true });
    assert.equal(await WS.share(s, { canvas: mk() }), 'shared');
    assert.equal(got.files[0].name, 'push-a-2026-10-25.png');
    assert.match(got.text, /^🏋️ \*Push A\*/);

    Object.defineProperty(g, 'navigator', { value: { share: async d => { got = d; }, canShare: () => false }, configurable: true });
    assert.equal(await WS.share(s, { canvas: mk() }), 'shared-text');
    assert.equal(got.files, undefined);

    Object.defineProperty(g, 'navigator', { value: { share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }, canShare: () => true }, configurable: true });
    assert.equal(await WS.share(s, { canvas: mk() }), 'cancelled');

    let copied = null;
    Object.defineProperty(g, 'navigator', { value: { clipboard: { writeText: async t => { copied = t; } } }, configurable: true });
    assert.equal(await WS.share(s, { canvas: mk() }), 'copied', 'no document here, so the download fails but the copy stands');
    assert.match(copied, /New records/);
  } finally {
    Object.defineProperty(g, 'navigator', { value: old.navigator, configurable: true });
    g.File = old.File;
  }
});
