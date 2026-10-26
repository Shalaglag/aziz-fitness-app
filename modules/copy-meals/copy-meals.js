/*
 * Copy meals: copy one food row, several, or a whole day's food to another
 * date or slot (MacroFactor-style copy/paste), or pull another day's food
 * into the selected day. Pure logic plus one card builder and two small DOM
 * helpers (readForm/setDate) for the app's data-act wiring. No imports, no
 * network. Browser global window.CopyMeals, or CommonJS.
 *
 * Rows are days/{date}.food[] entries: {id,name,slot,kcal,p,c,f,eaten,est}.
 * Copies get a fresh id and start as planned (eaten:false) unless asked.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CopyMeals = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SLOTS = ['Meal 1', 'Meal 2', 'Snack', 'Breakfast', 'Extra'];
  const KEEP = 'keep';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = i => String(i.slot || '').toLowerCase() + '|' + String(i.name || '').trim().toLowerCase();
  const r0 = n => Math.round(+n || 0).toLocaleString('en-US');

  // ---- dates (ISO strings, timezone-safe) ----
  const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
  const iso = d => d.toISOString().slice(0, 10);
  const isDate = s => !!parse(s);
  function addDays(s, n) { const d = parse(s); if (!d) return s; d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function weekday(s) { const d = parse(s); return d ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] : ''; }
  function fmt(s, today) {
    if (!isDate(s)) return String(s || '');
    if (today && s === today) return 'today';
    if (today && s === addDays(today, 1)) return 'tomorrow';
    if (today && s === addDays(today, -1)) return 'yesterday';
    const d = parse(s);
    return weekday(s) + ' ' + d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  }

  // Quick target dates for a day: tomorrow, the day after, next same weekday (and yesterday for pulls).
  function targets(from, opts) {
    opts = opts || {};
    const out = [];
    const push = (date, label) => { if (date !== from && !out.some(o => o.date === date)) out.push({ date, label }); };
    if (opts.back) push(addDays(from, -1), 'Yesterday');
    push(addDays(from, 1), 'Tomorrow');
    push(addDays(from, 2), 'In 2 days');
    push(addDays(from, 7), 'Next ' + weekday(from));
    if (opts.back) push(addDays(from, -7), 'Last ' + weekday(from));
    return out;
  }

  // Dates near `from` that have food, most recent first (for "copy from another day").
  function recentWithFood(days, from, opts) {
    opts = opts || {};
    const n = opts.n || 5;
    return Object.keys(days || {}).filter(d => d !== from && isDate(d) && days[d] && days[d].food && days[d].food.length)
      .sort().reverse().filter(d => !opts.before || d < from).slice(0, n);
  }

  // ---- copying ----
  // A fresh row from a source row. opts: {uid, slot ('keep' or a slot name), eaten}
  function copyItem(i, opts) {
    opts = opts || {};
    const uid = opts.uid || (() => 'c' + Math.random().toString(36).slice(2, 10));
    const o = Object.assign({}, i, { id: uid(), eaten: !!opts.eaten });
    if (opts.slot && opts.slot !== KEEP) o.slot = String(opts.slot);
    if (!o.slot) o.slot = 'Extra';
    return o;
  }

  // Pick the rows of a day by id. ids omitted/null = the whole day.
  function select(day, ids) {
    const food = (day && day.food) || [];
    if (!ids) return food.slice();
    const want = new Set(ids);
    return food.filter(i => want.has(i.id));
  }

  // Copy rows onto a target day. Returns {day, added, skipped}; never mutates its input.
  // opts: {uid, slot, eaten, allowDuplicates (default false: a row with the same name + slot already on the target is skipped)}
  function copyToDay(target, items, opts) {
    opts = opts || {};
    const base = Object.assign({ food: [] }, target);
    const food = (base.food || []).slice();
    const have = new Set(food.map(key));
    const added = [], skipped = [];
    (items || []).forEach(it => {
      if (!it || !String(it.name || '').trim()) return;
      const o = copyItem(it, opts);
      const k = key(o);
      if (!opts.allowDuplicates && have.has(k)) { skipped.push(it.name); return; }
      have.add(k);
      food.push(o); added.push(o);
    });
    return { day: Object.assign({}, base, { food }), added, skipped };
  }

  // Whole day: copy source.food onto target. Same return as copyToDay.
  function copyDay(source, target, opts) { return copyToDay(target, (source && source.food) || [], opts); }

  // Remove rows by id (the undo of a copy). Returns a new day.
  function removeIds(day, ids) {
    const drop = new Set(ids || []);
    return Object.assign({}, day, { food: ((day && day.food) || []).filter(i => !drop.has(i.id)) });
  }

  function totals(items) {
    return (items || []).reduce((t, i) => ({ kcal: t.kcal + (+i.kcal || 0), p: t.p + (+i.p || 0), c: t.c + (+i.c || 0), f: t.f + (+i.f || 0) }), { kcal: 0, p: 0, c: 0, f: 0 });
  }

  // Toast text after a copy.
  function summary(r, dateLabel) {
    const n = r.added.length;
    if (!n) return r.skipped.length ? 'Everything is already on ' + dateLabel : 'Nothing to copy';
    return 'Copied ' + n + (n === 1 ? ' item' : ' items') + ' to ' + dateLabel + (r.skipped.length ? ' (' + r.skipped.length + ' already there)' : '');
  }

  // ---- UI ----
  // The Food tab card. opts: {today, days (all day docs, for "copy from"), open}
  function cardHTML(day, opts) {
    opts = opts || {};
    const d = (day && day.date) || opts.today || '';
    const food = (day && day.food) || [];
    const today = opts.today;
    const to = targets(d);
    const defTo = to[0] ? to[0].date : addDays(d, 1);
    const rows = food.map(i =>
      '<label class="item cm-row" style="cursor:pointer">' +
      '<input type="checkbox" name="cmSel" value="' + esc(i.id) + '" checked aria-label="Copy ' + esc(i.name) + '">' +
      '<div class="nm"><b>' + esc(i.name) + '</b><small>' + esc(i.slot) + (i.eaten ? ' · eaten' : ' · planned') + '</small></div>' +
      '<div class="mac">' + r0(i.kcal) + ' kcal</div></label>').join('');
    const chips = to.map(t => '<button type="button" class="chip" data-act="cm-date" data-date="' + t.date + '">' + esc(t.label) + '</button>').join('');
    const slotSel = '<select id="cmSlot" aria-label="Slot on the other day"><option value="' + KEEP + '">Keep slots</option>' +
      SLOTS.map(s => '<option>' + s + '</option>').join('') + '</select>';
    const copyOut = food.length
      ? '<div class="cm-out">' +
        '<div class="spread" style="margin-bottom:6px"><span class="label">Copy from ' + esc(fmt(d, today)) + '</span>' +
        '<span class="row" style="gap:6px"><button type="button" class="chip" data-act="cm-all" data-on="1">All</button><button type="button" class="chip" data-act="cm-all" data-on="0">None</button></span></div>' +
        '<div class="items">' + rows + '</div>' +
        '<div class="row" style="margin-top:10px;align-items:center">' +
        '<label class="field"><span class="label">To</span><input type="date" id="cmDate" value="' + defTo + '" aria-label="Target date"></label>' +
        slotSel +
        '<label class="row" style="font-size:.9rem"><input type="checkbox" id="cmEaten"> Mark as eaten</label></div>' +
        '<div class="row" style="margin-top:6px">' + chips + '</div>' +
        '<div class="row" style="margin-top:10px"><button type="button" class="btn small" data-act="cm-copy">Copy selected</button>' +
        '<button type="button" class="btn ghost small" data-act="cm-copy" data-go="1">Copy and open that day</button></div></div>'
      : '<p class="muted">Nothing on this day to copy yet.</p>';
    const recent = recentWithFood(opts.days, d, { n: 4 });
    const from = targets(d, { back: true }).filter(t => /Yesterday|Last/.test(t.label));
    const fromChips = from.concat(recent.filter(r => !from.some(f => f.date === r)).map(r => ({ date: r, label: fmt(r, today) })))
      .map(t => '<button type="button" class="chip" data-act="cm-pull" data-date="' + t.date + '">' + esc(t.label) +
        (opts.days && opts.days[t.date] && opts.days[t.date].food && opts.days[t.date].food.length ? ' · ' + opts.days[t.date].food.length : '') + '</button>').join('');
    const pull = '<div class="cm-in" style="margin-top:14px"><span class="label">Copy another day here</span>' +
      '<div class="row" style="margin-top:6px;align-items:center">' +
      '<input type="date" id="cmFrom" value="' + addDays(d, -1) + '" aria-label="Source date">' +
      '<button type="button" class="btn ghost small" data-act="cm-pull">Copy that day here</button></div>' +
      (fromChips ? '<div class="row" style="margin-top:6px">' + fromChips + '</div>' : '') +
      '<p class="muted" style="font-size:.85rem;margin:6px 0 0">Copies arrive as planned. Items already on the day (same name and slot) are skipped.</p></div>';
    return '<div class="card cm-card"><details data-keep="cm"' + (opts.open ? ' open' : '') + '><summary>Copy food to another day</summary>' + copyOut + pull + '</details></div>';
  }

  // Values of the card's controls. Returns {ids, date, slot, eaten, from}.
  function readForm(root) {
    const q = id => root.getElementById ? root.getElementById(id) : root.querySelector('#' + id);
    const ids = Array.prototype.map.call(root.querySelectorAll('input[name="cmSel"]:checked'), el => el.value);
    const date = q('cmDate'), slot = q('cmSlot'), eaten = q('cmEaten'), from = q('cmFrom');
    return {
      ids,
      date: date && isDate(date.value) ? date.value : null,
      slot: slot ? slot.value : KEEP,
      eaten: !!(eaten && eaten.checked),
      from: from && isDate(from.value) ? from.value : null,
    };
  }

  function setDate(root, date) { const el = root.getElementById ? root.getElementById('cmDate') : root.querySelector('#cmDate'); if (el && isDate(date)) el.value = date; }
  function selectAll(root, on) { Array.prototype.forEach.call(root.querySelectorAll('input[name="cmSel"]'), el => { el.checked = !!on; }); }

  return { copyItem, select, copyToDay, copyDay, removeIds, totals, summary, targets, recentWithFood, addDays, fmt, weekday, isDate, cardHTML, readForm, setDate, selectAll, SLOTS, KEEP };
});
