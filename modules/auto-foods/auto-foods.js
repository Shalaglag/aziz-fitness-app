/*
 * Auto foods: foods that repeat on a schedule (Adonis every day, Gatorade 1 L on
 * training days, ...) are added to the day as planned rows (eaten:false) the first
 * time the day is opened. Nothing counts until Aziz ticks the row; removing the
 * row marks the rule skipped for that day so it is not added again.
 *
 * Pure logic plus one HTML card builder: no DOM access, no imports, no network.
 * Browser global window.AutoFoods or CommonJS.
 *
 * Data
 *   prefs/main.autoFoods = { [id]: {id, name, slot, kcal, p, c, f, est, when, drink, off, created} }
 *     when: "daily" | "training" | "rest" | "saturday" | "friday"
 *     drink: a SuppDrinks drink key ("gatorade"); the row is then planned through
 *            SuppDrinks.planDrink so it carries the drink tag and counts as fluid.
 *   prefs/main.autoFoodsSeeded = true once the two default rules were written.
 *   days/{date}.auto = { [ruleId]: "added" | "skipped" }
 *   food rows added here carry auto: ruleId.
 *
 * Supplements are not handled here: SuppDrinks owns the supplement schedule.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AutoFoods = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WHEN = {
    daily: 'Every day', training: 'Training days', rest: 'Rest days (incl. Friday)',
    saturday: 'Saturdays', friday: 'Fridays'
  };
  const SLOTS = ['Fixed', 'Extra', 'Snack', 'Breakfast', 'Meal 1', 'Meal 2', 'Drink'];
  const num = v => { const n = +v; return isFinite(n) ? Math.round(n * 10) / 10 : 0; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o == null ? null : o));
  const norm = s => String(s || '').trim().toLowerCase();
  const rid = () => 'af' + Math.random().toString(36).slice(2, 9);

  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'food';
  }

  // The two rules the app's "Add Adonis + Gatorade" button used to cover.
  function defaults(now) {
    const t = now || Date.now();
    return {
      adonis: { id: 'adonis', name: 'Adonis Protein Cookie Dough (50 g)', slot: 'Fixed', kcal: 192, p: 22, c: 11.4, f: 6.2, when: 'daily', created: t },
      gatorade: { id: 'gatorade', name: 'Gatorade 1 L', slot: 'Drink', kcal: 240, p: 0, c: 60, f: 0, est: true, when: 'training', drink: 'gatorade', created: t }
    };
  }

  // Add the default rules once. Returns a new prefs object, or null when nothing changed.
  function seed(prefs, now) {
    prefs = prefs || {};
    if (prefs.autoFoodsSeeded || prefs.autoFoods) return null;
    return Object.assign({}, prefs, { autoFoods: defaults(now), autoFoodsSeeded: true });
  }

  function rules(prefs) { return (prefs && prefs.autoFoods) || {}; }
  function list(map) { return Object.values(map || {}).filter(Boolean).sort((a, b) => (a.created || 0) - (b.created || 0)); }

  // Does a rule apply on this day? ctx: { training: bool, type: "training"|"saturday"|"friday" }
  function due(rule, ctx) {
    if (!rule || rule.off) return false;
    ctx = ctx || {};
    switch (rule.when) {
      case 'training': return !!ctx.training;
      case 'rest': return !ctx.training;
      case 'saturday': return ctx.type === 'saturday';
      case 'friday': return ctx.type === 'friday';
      default: return true;
    }
  }

  // Build a rule from a food row (or form values). opts: { when, id, now, existing }
  function fromFood(item, opts) {
    opts = opts || {};
    const name = String(item && item.name || '').trim();
    if (!name) return null;
    const when = WHEN[opts.when] ? opts.when : 'daily';
    let id = opts.id || slug(name);
    const taken = opts.existing || {};
    if (!opts.id) { let n = 2, base = id; while (taken[id]) id = base + '-' + n++; }
    const r = { id, name, slot: SLOTS.includes(item.slot) ? item.slot : 'Extra', kcal: num(item.kcal), p: num(item.p), c: num(item.c), f: num(item.f), when, created: opts.now || Date.now() };
    if (item.est) r.est = true;
    if (item.drink && item.drink.key) { r.drink = item.drink.key; r.slot = 'Drink'; }
    return r;
  }

  const matches = (rule, row) => !!row && (
    (rule.drink && row.drink && row.drink.key === rule.drink) || norm(row.name) === norm(rule.name));

  // Add every due rule the day hasn't seen yet, as planned rows.
  // ctx: { date, today, training, type }; opts: { uid, planDrink: (day, key) => {day} | {error} }
  // Returns { day, added: [names], changed }. Never mutates its input.
  function plan(day, prefsOrRules, ctx, opts) {
    ctx = ctx || {}; opts = opts || {};
    const map = prefsOrRules && prefsOrRules.autoFoods ? prefsOrRules.autoFoods : (prefsOrRules || {});
    const out = Object.assign({ food: [] }, clone(day || {}));
    out.food = out.food || [];
    const added = [];
    if (ctx.today && ctx.date && ctx.date < ctx.today) return { day: out, added, changed: false };
    const seen = Object.assign({}, out.auto || {});
    let changed = false;
    for (const rule of list(map)) {
      if (seen[rule.id] || !due(rule, ctx)) continue;
      if (out.food.some(r => matches(rule, r))) { seen[rule.id] = 'added'; changed = true; continue; }
      let row = null;
      if (rule.drink && opts.planDrink) {
        const r = opts.planDrink(out, rule.drink);
        if (r && r.day && r.day.food && r.day.food.length > out.food.length) {
          out.food = r.day.food; row = out.food[out.food.length - 1];
        } else if (r && r.error) continue; // needs a label first: leave it for SuppDrinks to ask
      }
      if (!row) {
        row = { id: (opts.uid || rid)(), name: rule.name, slot: rule.slot, kcal: rule.kcal, p: rule.p, c: rule.c, f: rule.f, eaten: false };
        if (rule.est) row.est = true;
        if (rule.drink) row.drink = { key: rule.drink, ml: 0 };
        out.food.push(row);
      }
      row.auto = rule.id;
      seen[rule.id] = 'added'; added.push(rule.name); changed = true;
    }
    if (changed) out.auto = seen;
    return { day: out, added, changed };
  }

  // A removed auto row counts as skipped for that day; an auto row added back clears it.
  function onRemove(day, item) {
    if (!item || !item.auto) return day;
    const out = clone(day); out.auto = Object.assign({}, out.auto, { [item.auto]: 'skipped' }); return out;
  }
  function onRestore(day, item) {
    if (!item || !item.auto) return day;
    const out = clone(day); out.auto = Object.assign({}, out.auto, { [item.auto]: 'added' }); return out;
  }

  // Rule map edits: each returns a new map.
  function upsert(map, rule) { return Object.assign({}, map, { [rule.id]: rule }); }
  function remove(map, id) { const o = Object.assign({}, map); delete o[id]; return o; }
  function toggle(map, id) { const r = map && map[id]; return r ? upsert(map, Object.assign({}, r, { off: !r.off })) : map; }

  function status(rule, day, ctx) {
    const st = day && day.auto && day.auto[rule.id];
    if (rule.off) return 'off';
    if (st === 'skipped') return 'skipped';
    if (st === 'added') { const row = (day.food || []).find(r => r.auto === rule.id || matches(rule, r)); return row && row.eaten ? 'eaten' : 'planned'; }
    return due(rule, ctx) ? 'due' : 'not today';
  }

  // The Food-tab card. opts: { day, training, type, hasDrinks (SuppDrinks present) }
  function html(map, opts) {
    opts = opts || {};
    const day = opts.day || { food: [] };
    const rs = list(map);
    const r0 = n => Math.round(n).toLocaleString('en-US');
    const rows = rs.map(r => {
      const st = status(r, day, opts);
      const col = st === 'eaten' ? 'var(--good)' : st === 'skipped' ? 'var(--warn)' : st === 'off' ? 'var(--muted)' : 'var(--muted)';
      return '<div class="item af-row' + (r.off ? ' planned' : '') + '">' +
        '<div class="nm"><b>' + esc(r.name) + '</b><small>' + esc(WHEN[r.when] || WHEN.daily) + ' · ' + esc(r.slot) + (r.est ? ' · estimate' : '') +
        ' · <span style="color:' + col + '">' + esc(st) + '</span></small></div>' +
        '<div class="mac">' + r0(r.kcal) + ' kcal<br><span style="color:var(--protein)">' + num(r.p) + 'P</span> <span style="color:var(--carbs)">' + num(r.c) + 'C</span> <span style="color:var(--fat)">' + num(r.f) + 'F</span></div>' +
        '<button class="btn ghost small" data-af="toggle" data-id="' + esc(r.id) + '" aria-pressed="' + (!r.off) + '">' + (r.off ? 'Off' : 'On') + '</button>' +
        '<button class="x" data-af="del" data-id="' + esc(r.id) + '" aria-label="Delete rule">×</button>' +
        '</div>';
    }).join('');
    const known = new Set(rs.map(r => norm(r.name)));
    const chips = (day.food || []).filter(i => i && i.name && !i.auto && !known.has(norm(i.name)))
      .map(i => '<button class="chip" data-af="from" data-id="' + esc(i.id) + '" title="Repeat this food">↻ ' + esc(String(i.name).split(' (')[0]) + '</button>').join('');
    const whenOpts = Object.keys(WHEN).map(k => '<option value="' + k + '">' + esc(WHEN[k]) + '</option>').join('');
    const slotOpts = SLOTS.filter(s => s !== 'Drink').map(s => '<option' + (s === 'Extra' ? ' selected' : '') + '>' + s + '</option>').join('');
    return '<div class="card af-card">' +
      '<div class="spread"><h3>Repeats automatically</h3><span class="muted" style="font-size:.85rem">Added as planned when you open the day</span></div>' +
      (rows ? '<div class="items">' + rows + '</div>' : '<p class="muted">Nothing repeats yet. Add a food below and it shows up planned on the days you choose; tick it when eaten or remove it to skip that day.</p>') +
      (chips ? '<div style="margin-top:8px"><span class="label">Repeat a food from this day</span><div class="row" style="margin-top:6px">' + chips + '</div></div>' : '') +
      '<details style="margin-top:10px"><summary>Add a repeating food</summary>' +
      '<form data-form="af-save" style="display:flex;flex-direction:column;gap:10px;margin-top:8px">' +
      '<div class="row"><input type="text" id="afName" placeholder="Name, e.g. ISO100 scoop" style="flex:1;min-width:12em" required maxlength="80" aria-label="Food name">' +
      '<select id="afSlot" aria-label="Slot">' + slotOpts + '</select></div>' +
      '<div class="row"><label class="field"><span class="label">kcal</span><input type="number" id="afK" step="1" required></label>' +
      '<label class="field"><span class="label">Protein</span><input type="number" id="afP" step="0.1"></label>' +
      '<label class="field"><span class="label">Carbs</span><input type="number" id="afC" step="0.1"></label>' +
      '<label class="field"><span class="label">Fat</span><input type="number" id="afF" step="0.1"></label></div>' +
      '<div class="row"><select id="afWhen" aria-label="When">' + whenOpts + '</select>' +
      '<label class="row" style="font-size:.9rem"><input type="checkbox" id="afEst"> Estimate</label>' +
      '<button class="btn small" type="submit">Repeat it</button></div>' +
      '</form></details>' +
      (opts.hasDrinks ? '<p class="muted" style="font-size:.85rem;margin-top:8px">Supplements (creatine, D3, omega-3, magnesium) are scheduled in the Drinks and supplements card on Today, not here.</p>' : '') +
      '</div>';
  }

  function readForm(doc) {
    const g = id => { const el = doc.getElementById(id); return el ? el.value : ''; };
    const est = doc.getElementById('afEst');
    return { name: g('afName'), slot: g('afSlot'), kcal: g('afK'), p: g('afP'), c: g('afC'), f: g('afF'), when: g('afWhen'), est: !!(est && est.checked) };
  }

  // One entry point for the shell's click/submit handlers.
  // Returns { prefs?, day?, toast? }. opts: { now }
  function apply(action, data, prefs, day, opts) {
    data = data || {}; prefs = prefs || {}; opts = opts || {};
    const map = rules(prefs);
    const setRules = m => Object.assign({}, prefs, { autoFoods: m, autoFoodsSeeded: true });
    if (action === 'toggle') { const r = map[data.id]; if (!r) return {}; return { prefs: setRules(toggle(map, data.id)), toast: r.name + (r.off ? ' repeats again.' : ' paused. It stays on this day; tomorrow it is not added.') }; }
    if (action === 'del') { const r = map[data.id]; if (!r) return {}; return { prefs: setRules(remove(map, data.id)), toast: 'Stopped repeating ' + r.name + '.' }; }
    if (action === 'from') {
      const item = ((day && day.food) || []).find(i => i.id === data.id);
      const r = fromFood(item, { when: data.when || 'daily', existing: map, now: opts.now });
      if (!r) return { toast: 'That food is no longer on this day.' };
      let out = day;
      if (out) { out = clone(out); out.food = out.food.map(i => i.id === item.id ? Object.assign({}, i, { auto: r.id }) : i); out.auto = Object.assign({}, out.auto, { [r.id]: 'added' }); }
      return { prefs: setRules(upsert(map, r)), day: out, toast: r.name + ' now repeats every day. Change when in the Repeats card.' };
    }
    if (action === 'save') {
      const r = fromFood(data, { when: data.when, existing: map, now: opts.now });
      if (!r) return { toast: 'Give the food a name.' };
      return { prefs: setRules(upsert(map, r)), toast: r.name + ' repeats ' + WHEN[r.when].toLowerCase() + ', starting with today.' };
    }
    return {};
  }

  // For Coach/weekly review: how often auto foods were eaten vs skipped over n days.
  function adherence(getDay, date, prefs, n) {
    const out = {};
    const d0 = new Date(date + 'T00:00:00');
    for (let i = 0; i < (n || 14); i++) {
      const dt = new Date(d0); dt.setDate(d0.getDate() - i);
      const iso = dt.toISOString().slice(0, 10);
      const day = getDay(iso); if (!day || !day.auto) continue;
      for (const id of Object.keys(day.auto)) {
        const o = out[id] || (out[id] = { id, name: (rules(prefs)[id] || {}).name || id, added: 0, eaten: 0, skipped: 0 });
        if (day.auto[id] === 'skipped') { o.skipped++; continue; }
        o.added++;
        if ((day.food || []).some(r => r.auto === id && r.eaten)) o.eaten++;
      }
    }
    return Object.values(out);
  }

  return { WHEN, SLOTS, defaults, seed, rules, list, due, fromFood, plan, onRemove, onRestore, upsert, remove, toggle, status, html, readForm, apply, adherence, slug };
});
