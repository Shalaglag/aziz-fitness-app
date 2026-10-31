// Run: node --test modules/copy-meals/copy-meals.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./copy-meals.js');

const SRC = {
  date: '2026-10-27',
  food: [
    { id: 'a', name: 'French Tacos Chicken', slot: 'Meal 1', kcal: 610, p: 52, c: 60, f: 18, eaten: true },
    { id: 'b', name: 'Chicken Biryani', slot: 'Meal 2', kcal: 650, p: 55, c: 70, f: 16, eaten: false },
    { id: 'c', name: 'Mango', slot: 'Snack', kcal: 52, p: 1, c: 12, f: 0, eaten: true },
    { id: 'e', name: 'Gatorade 1 L', slot: 'Drink', kcal: 240, p: 0, c: 60, f: 0, eaten: false, est: true, drink: { key: 'gatorade' } },
  ],
  water: 1500,
};
let n = 0; const uid = () => 'u' + (++n);
const fresh = () => JSON.parse(JSON.stringify(SRC));

test('copyDay copies every row as planned with new ids and keeps est/drink', () => {
  const src = fresh();
  const r = M.copyDay(src, { date: '2026-10-28', food: [] }, { uid });
  assert.equal(r.added.length, 4);
  assert.equal(r.skipped.length, 0);
  assert.equal(r.day.date, '2026-10-28');
  assert.ok(r.day.food.every(i => !i.eaten));
  assert.ok(r.day.food.every(i => /^u\d+$/.test(i.id)));
  assert.equal(r.day.food[3].est, true);
  assert.deepEqual(r.day.food[3].drink, { key: 'gatorade' });
  assert.deepEqual(src, SRC, 'source untouched');
});

test('copyToDay keeps the target day fields and never mutates it', () => {
  const target = { date: '2026-10-28', food: [{ id: 'z', name: 'Eggs', slot: 'Breakfast', kcal: 300, eaten: true }], water: 800, supps: { d3: true } };
  const snap = JSON.stringify(target);
  const r = M.copyToDay(target, M.select(SRC, ['a', 'c']), { uid });
  assert.equal(r.day.water, 800);
  assert.deepEqual(r.day.supps, { d3: true });
  assert.deepEqual(r.day.food.map(i => i.name), ['Eggs', 'French Tacos Chicken', 'Mango']);
  assert.equal(JSON.stringify(target), snap);
});

test('select picks rows by id; null means the whole day; unknown ids are ignored', () => {
  assert.deepEqual(M.select(SRC, ['c', 'a', 'nope']).map(i => i.id), ['a', 'c']);
  assert.equal(M.select(SRC, null).length, 4);
  assert.deepEqual(M.select(SRC, []), []);
  assert.deepEqual(M.select(null, null), []);
});

test('duplicates (same name + slot) are skipped unless allowed', () => {
  const target = M.copyDay(SRC, { date: '2026-10-28' }, { uid }).day;
  const again = M.copyDay(SRC, target, { uid });
  assert.equal(again.added.length, 0);
  assert.equal(again.skipped.length, 4);
  assert.equal(M.summary(again, 'tomorrow'), 'Everything is already on tomorrow');
  const dup = M.copyDay(SRC, target, { uid, allowDuplicates: true });
  assert.equal(dup.added.length, 4);
  assert.equal(dup.day.food.length, 8);
  // a different slot is not a duplicate
  const moved = M.copyToDay(target, M.select(SRC, ['c']), { uid, slot: 'Extra' });
  assert.equal(moved.added.length, 1);
  assert.equal(moved.added[0].slot, 'Extra');
});

test('slot override and eaten option', () => {
  const r = M.copyToDay({ date: '2026-10-28' }, M.select(SRC, ['a', 'b']), { uid, slot: 'Meal 2', eaten: true });
  assert.deepEqual(r.added.map(i => i.slot), ['Meal 2', 'Meal 2']);
  assert.ok(r.added.every(i => i.eaten === true));
  const keep = M.copyToDay({ date: '2026-10-28' }, M.select(SRC, ['a']), { uid, slot: M.KEEP });
  assert.equal(keep.added[0].slot, 'Meal 1');
  const noSlot = M.copyItem({ id: 'q', name: 'Thing', kcal: 1 }, { uid });
  assert.equal(noSlot.slot, 'Extra');
});

test('blank rows are ignored and removeIds undoes a copy', () => {
  const r = M.copyToDay({ date: '2026-10-28', food: [] }, [{ id: 'x', name: '  ' }, null, SRC.food[0]], { uid });
  assert.equal(r.added.length, 1);
  const undone = M.removeIds(r.day, r.added.map(i => i.id));
  assert.deepEqual(undone.food, []);
  assert.equal(r.day.food.length, 1, 'removeIds does not mutate');
});

test('summary wording', () => {
  assert.equal(M.summary({ added: [1], skipped: [] }, 'tomorrow'), 'Copied 1 item to tomorrow');
  assert.equal(M.summary({ added: [1, 2], skipped: ['x'] }, 'Tue 3 Nov'), 'Copied 2 items to Tue 3 Nov (1 already there)');
  assert.equal(M.summary({ added: [], skipped: [] }, 'x'), 'Nothing to copy');
});

test('dates: addDays across month and year ends, fmt, targets', () => {
  assert.equal(M.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(M.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(M.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(M.addDays('bad', 3), 'bad');
  assert.equal(M.weekday('2026-10-27'), 'Tue');
  assert.equal(M.fmt('2026-10-27', '2026-10-27'), 'today');
  assert.equal(M.fmt('2026-10-28', '2026-10-27'), 'tomorrow');
  assert.equal(M.fmt('2026-10-26', '2026-10-27'), 'yesterday');
  assert.equal(M.fmt('2026-11-03', '2026-10-27'), 'Tue 3 Nov');
  assert.deepEqual(M.targets('2026-10-27'), [
    { date: '2026-10-28', label: 'Tomorrow' }, { date: '2026-10-29', label: 'In 2 days' }, { date: '2026-11-03', label: 'Next Tue' }]);
  const back = M.targets('2026-10-27', { back: true });
  assert.equal(back[0].label, 'Yesterday');
  assert.equal(back[back.length - 1].label, 'Last Tue');
  assert.ok(M.isDate('2026-10-27') && !M.isDate('2026-1-7') && !M.isDate(''));
});

test('recentWithFood lists days that have food, newest first, excluding the day itself', () => {
  const days = { '2026-10-27': SRC, '2026-10-25': { food: [{ name: 'x' }] }, '2026-10-20': { food: [] }, '2026-10-30': { food: [{ name: 'y' }] }, '2026-10-24': { food: [{ name: 'z' }] } };
  assert.deepEqual(M.recentWithFood(days, '2026-10-27'), ['2026-10-30', '2026-10-25', '2026-10-24']);
  assert.deepEqual(M.recentWithFood(days, '2026-10-27', { before: true, n: 1 }), ['2026-10-25']);
  assert.deepEqual(M.recentWithFood(undefined, '2026-10-27'), []);
});

test('cardHTML renders a checkbox per row, escapes names, and the empty state', () => {
  const day = fresh(); day.food[0].name = 'Tacos <b>"x"</b>';
  const html = M.cardHTML(day, { today: '2026-10-27', days: { '2026-10-27': day, '2026-10-26': { food: [{ name: 'q' }] } } });
  assert.equal((html.match(/name="cmSel"/g) || []).length, 4);
  assert.ok(html.includes('Tacos &lt;b&gt;&quot;x&quot;&lt;/b&gt;'));
  assert.ok(!html.includes('<b>"x"</b>'));
  assert.ok(html.includes('id="cmDate" value="2026-10-28"'));
  assert.ok(html.includes('data-act="cm-copy"'));
  assert.ok(html.includes('data-act="cm-pull" data-date="2026-10-26"'));
  assert.ok(html.includes('Yesterday · 1'));
  assert.ok(html.includes('data-keep="cm"'));
  const empty = M.cardHTML({ date: '2026-10-27', food: [] }, {});
  assert.ok(empty.includes('Nothing on this day to copy yet'));
  assert.ok(empty.includes('id="cmFrom" value="2026-10-26"'));
});

test('readForm / setDate / selectAll work on a minimal DOM', () => {
  const els = {};
  const mk = (id, value, checked) => { els[id] = { id, value, checked: !!checked }; return els[id]; };
  mk('cmDate', '2026-10-29'); mk('cmSlot', 'Snack'); mk('cmEaten', '', true); mk('cmFrom', 'nope');
  const sel = [{ name: 'cmSel', value: 'a', checked: true }, { name: 'cmSel', value: 'b', checked: false }, { name: 'cmSel', value: 'c', checked: true }];
  const root = {
    getElementById: id => els[id] || null,
    querySelectorAll: q => q.includes(':checked') ? sel.filter(s => s.checked) : sel,
  };
  assert.deepEqual(M.readForm(root), { ids: ['a', 'c'], date: '2026-10-29', slot: 'Snack', eaten: true, from: null });
  M.setDate(root, '2026-11-01'); assert.equal(els.cmDate.value, '2026-11-01');
  M.setDate(root, 'junk'); assert.equal(els.cmDate.value, '2026-11-01');
  M.selectAll(root, false); assert.ok(sel.every(s => !s.checked));
  assert.deepEqual(M.readForm({ getElementById: () => null, querySelectorAll: () => [] }), { ids: [], date: null, slot: 'keep', eaten: false, from: null });
});
