/*
 * Saved meals: keep a food combo (for example a usual Nutreeze day) and add it
 * back to any day with one tap. Pure logic plus one HTML card builder, no DOM
 * access, no imports, no network. Works as a browser global (window.SavedMeals)
 * or as a CommonJS module.
 *
 * Stored as one doc per combo in the app's `meals` collection, keyed by id:
 *   meals/{id}: { id, name, items:[{name,slot,kcal,p,c,f,est}], created, lastUsed, uses }
 * Items use the same shape as days/{date}.food[] minus the per-day id/eaten.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SavedMeals = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_ITEMS = 30;
  const num = v => { const n = +v; return isFinite(n) ? Math.round(n * 10) / 10 : 0; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = i => String(i.slot || '').toLowerCase() + '|' + String(i.name || '').trim().toLowerCase();

  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'meal';
  }

  // Strip a food item down to what a combo stores.
  function cleanItem(i) {
    const o = { name: String(i.name || '').trim(), slot: String(i.slot || 'Extra'), kcal: num(i.kcal), p: num(i.p), c: num(i.c), f: num(i.f) };
    if (i.est) o.est = true;
    return o;
  }

  function totals(items) {
    return (items || []).reduce((t, i) => ({ kcal: t.kcal + num(i.kcal), p: t.p + num(i.p), c: t.c + num(i.c), f: t.f + num(i.f) }), { kcal: 0, p: 0, c: 0, f: 0 });
  }

  // A default name from the day's main meals, e.g. "French Tacos Chicken + Chicken Biryani".
  function suggestName(items) {
    const meals = (items || []).filter(i => /meal/i.test(i.slot)).map(i => String(i.name).split(' (')[0]);
    if (meals.length) return meals.slice(0, 2).join(' + ');
    return (items && items[0] && String(items[0].name).split(' (')[0]) || 'My usual day';
  }

  // Build a combo from a day's food (or any list of food items).
  // opts: { name, id, onlyEaten, now (ms), existing (meals map, for unique ids) }
  function fromItems(items, opts) {
    opts = opts || {};
    let list = (items || []).filter(i => i && String(i.name || '').trim());
    if (opts.onlyEaten) list = list.filter(i => i.eaten);
    list = list.slice(0, MAX_ITEMS).map(cleanItem);
    if (!list.length) return null;
    const name = String(opts.name || '').trim() || suggestName(list);
    let id = opts.id || slug(name);
    const taken = opts.existing || {};
    if (!opts.id) { let n = 2, base = id; while (taken[id]) id = base + '-' + n++; }
    return { id, name, items: list, created: opts.now || Date.now(), lastUsed: 0, uses: 0 };
  }

  // Add a combo to a day. Returns { day, added, skipped } and never mutates its input.
  // opts: { uid: () => string (required for unique item ids), eaten: bool,
  //         mode: 'append' (default) | 'replace' (drop the day's planned items, keep eaten ones),
  //         allowDuplicates: bool (default false: skip items already on the day, same name + slot) }
  function applyToDay(day, combo, opts) {
    opts = opts || {};
    const uid = opts.uid || (() => 'm' + Math.random().toString(36).slice(2, 10));
    const base = Object.assign({ food: [] }, day);
    let food = (base.food || []).slice();
    if (opts.mode === 'replace') food = food.filter(i => i.eaten);
    const have = new Set(food.map(key));
    const added = [], skipped = [];
    (combo && combo.items || []).forEach(it => {
      const k = key(it);
      if (!opts.allowDuplicates && have.has(k)) { skipped.push(it.name); return; }
      have.add(k);
      const o = Object.assign({ id: uid() }, cleanItem(it), { eaten: !!opts.eaten });
      food.push(o); added.push(o);
    });
    return { day: Object.assign({}, base, { food }), added, skipped };
  }

  // Bump usage stats after a combo was added. Returns a new combo object.
  function markUsed(combo, now) {
    return Object.assign({}, combo, { uses: (combo.uses || 0) + 1, lastUsed: now || Date.now() });
  }

  // meals map or array -> array, most used first, then most recent, then name.
  function sorted(meals) {
    const arr = Array.isArray(meals) ? meals.slice() : Object.values(meals || {});
    return arr.filter(m => m && m.items && m.items.length)
      .sort((a, b) => (b.uses || 0) - (a.uses || 0) || (b.lastUsed || 0) - (a.lastUsed || 0) || String(a.name).localeCompare(String(b.name)));
  }

  function rename(combo, name) {
    name = String(name || '').trim();
    return name ? Object.assign({}, combo, { name }) : combo;
  }

  // Read a combo from JSON text (export/import, or a pasted share). Returns null if invalid.
  function parse(text, opts) {
    let o; try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return null; }
    if (!o || !Array.isArray(o.items)) return null;
    return fromItems(o.items, Object.assign({ name: o.name }, opts));
  }

  // The Food tab card. Buttons use the app's data-act click convention:
  //   data-act="meal-add"  data-id   one-tap add to the selected day
  //   data-act="meal-del"  data-id   delete (first tap asks to confirm via data-confirm)
  //   data-act="meal-save"           save the selected day's food as a new combo
  //   form data-form="meal-save" with input #mealName (optional name)
  // opts: { day (the selected day's doc), open (id of combo to expand, optional) }
  function cardHTML(meals, opts) {
    opts = opts || {};
    const list = sorted(meals);
    const dayFood = (opts.day && opts.day.food) || [];
    const r0 = n => Math.round(n).toLocaleString('en-US');
    const rows = list.map(m => {
      const t = totals(m.items);
      const names = m.items.map(i => esc(String(i.name).split(' (')[0])).join(', ');
      return '<div class="item sm-row">' +
        '<div class="nm"><b>' + esc(m.name) + '</b><small>' + m.items.length + ' items · ' + names + '</small></div>' +
        '<div class="mac">' + r0(t.kcal) + ' kcal<br><span style="color:var(--protein)">' + r0(t.p) + 'P</span> <span style="color:var(--carbs)">' + r0(t.c) + 'C</span> <span style="color:var(--fat)">' + r0(t.f) + 'F</span></div>' +
        '<button class="btn small" data-act="meal-add" data-id="' + esc(m.id) + '" aria-label="Add ' + esc(m.name) + '">Add</button>' +
        '<button class="x" data-act="meal-del" data-id="' + esc(m.id) + '" aria-label="Delete saved meal">×</button>' +
        '</div>';
    }).join('');
    const save = dayFood.length
      ? '<form data-form="meal-save" class="row" style="margin-top:10px">' +
        '<input type="text" id="mealName" placeholder="' + esc(suggestName(dayFood)) + '" style="flex:1;min-width:10em" aria-label="Name for this combo" maxlength="60">' +
        '<button class="btn ghost small" type="submit">Save this day as a combo</button></form>'
      : '';
    return '<div class="card sm-card">' +
      '<div class="spread"><h3>Saved meals</h3><span class="muted" style="font-size:.85rem">One tap adds the whole combo as planned</span></div>' +
      (rows ? '<div class="items">' + rows + '</div>' : '<p class="muted">No saved combos yet. Plan a day you like, then save it here to add it again with one tap.</p>') +
      save + '</div>';
  }

  return { fromItems, applyToDay, markUsed, sorted, totals, suggestName, rename, parse, cardHTML, cleanItem, slug, MAX_ITEMS };
});
