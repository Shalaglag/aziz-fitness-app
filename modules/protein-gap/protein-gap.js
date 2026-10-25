/*
 * Protein gap closer.
 * Pure logic, no DOM. Works as a browser global (window.ProteinGap)
 * or as a CommonJS module, so the main app can inline it as-is.
 *
 * Given today's food items (the app's days/{date}.food shape), it says how
 * much protein and kcal are left against the plan (2,000 kcal, 160-170 g
 * protein) and suggests the smallest add, in kcal, that reaches 160 g
 * protein without going over 2,000 kcal. Dislikes are never suggested.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProteinGap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TARGETS = { kcal: 2000, proteinMin: 160, proteinMax: 170 };

  // Things Aziz can add on the day. `est` marks values not yet from a label.
  // `max` is how many servings one suggestion may use.
  const CATALOG = [
    { id: 'iso100', name: 'Dymatize ISO100 scoop (in water)', kcal: 120, p: 25, c: 2, f: 0.5, max: 2, est: true },
    { id: 'milk', name: 'Low-fat milk 250 ml', kcal: 115, p: 8.5, c: 12, f: 4, max: 1, est: true },
    { id: 'adonis', name: 'Adonis Protein Cookie Dough (50 g)', kcal: 192, p: 22, c: 11.4, f: 6.2, max: 1 },
    { id: 'eggs', name: '2 boiled eggs', kcal: 155, p: 13, c: 1, f: 11, max: 1, est: true },
    { id: 'seeds', name: 'Tamari Roasted Seeds (Pumpkin & Sunflower)', kcal: 167, p: 6, c: 11, f: 11, max: 1 },
    { id: 'almonds', name: 'Roasted Rosemary Almonds', kcal: 183, p: 6, c: 6, f: 15, max: 1 },
    { id: 'walnut', name: 'Herbs Roasted Walnut', kcal: 248, p: 6, c: 11, f: 20, max: 1 },
    { id: 'cookies', name: 'Chocolate Chip Cookies', kcal: 113, p: 3, c: 14, f: 5, max: 1 },
    { id: 'zaafaran', name: 'Zaafaran Cake', kcal: 105, p: 2, c: 13, f: 5, max: 1 },
    { id: 'pro-mud', name: 'Pro Mud Cake', kcal: 252, p: 4, c: 14, f: 20, max: 1 },
    { id: 'kinder', name: 'Kinder Protein Ball', kcal: 162, p: 3, c: 15, f: 10, max: 1 },
    { id: 'popcorn', name: 'Popcorn', kcal: 61, p: 7, c: 6, f: 1, max: 1 },
    { id: 'muffin', name: 'Blueberry Vanilla Muffin', kcal: 166, p: 8, c: 11, f: 10, max: 1 },
  ];

  // Never-pick entries from meal-preferences.js (snacks and rules that can hit an add).
  const DEFAULT_NEVER = [
    { list: 'never', terms: ['protein ball', 'Kinder'], except: [] },
    { list: 'never', terms: ['Popcorn'], except: [] },
    { list: 'never', terms: ['Blueberry Vanilla Muffin', 'Blueberry Muffin'], except: [] },
    { list: 'never', terms: ['tuna', 'fish', 'shrimp', 'prawn', 'salmon', 'hammour', 'seafood', 'cod', 'sea bass', 'calamari'], except: [] },
    { list: 'never', terms: ['Chicken Shawarma', 'Shawarma'], except: [] },
    { list: 'never', terms: ['sandwich', 'panini', 'sub'], except: ['French Tacos'] },
  ];

  const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const hasPhrase = (text, phrase) => {
    const p = norm(phrase);
    if (!p) return false;
    const re = new RegExp('(^| )' + p + '(e?s)?( |$)');
    return re.test(norm(text));
  };

  /*
   * True when `name` is disliked. `dislikes` are free-text strings (the app's
   * prefs/main.dislikes, matched as substrings like the app does); `never` are
   * meal-preferences entries (whole-word terms with except).
   */
  function isDisliked(name, opts) {
    const o = opts || {};
    const n = norm(name);
    if ((o.dislikes || []).some(d => norm(d) && n.includes(norm(d)))) return true;
    const never = (o.never || DEFAULT_NEVER).filter(e => !e.list || e.list === 'never');
    return never.some(e => (e.terms || []).some(t => hasPhrase(name, t)) && !(e.except || []).some(t => hasPhrase(name, t)));
  }

  const r1 = x => Math.round(x * 10) / 10;
  function sum(items) {
    return items.reduce((t, x) => {
      const k = x.servings || 1;
      t.kcal += (+x.kcal || 0) * k; t.p += (+x.p || 0) * k; t.c += (+x.c || 0) * k; t.f += (+x.f || 0) * k;
      return t;
    }, { kcal: 0, p: 0, c: 0, f: 0 });
  }

  /*
   * What is left today. basis "plan" counts every item (eaten + planned),
   * basis "eaten" counts only items ticked as eaten.
   */
  function remaining(food, opts) {
    const o = Object.assign({ basis: 'plan', targets: TARGETS }, opts);
    const items = (food || []).filter(i => i && (o.basis === 'eaten' ? i.eaten : true));
    const t = sum(items);
    return {
      basis: o.basis,
      totals: { kcal: Math.round(t.kcal), p: r1(t.p), c: r1(t.c), f: r1(t.f) },
      kcalLeft: Math.round(o.targets.kcal - t.kcal),
      proteinLeft: r1(Math.max(0, o.targets.proteinMin - t.p)),
      proteinToMax: r1(o.targets.proteinMax - t.p),
    };
  }

  // Every multiset of candidates with at most `maxItems` servings in total.
  function combos(cands, maxItems) {
    const out = [];
    const walk = (i, picked, count) => {
      if (i === cands.length) { if (picked.length) out.push(picked.slice()); return; }
      walk(i + 1, picked, count);
      for (let n = 1; n <= (cands[i].max || 1) && count + n <= maxItems; n++) {
        picked.push({ c: cands[i], n }); walk(i + 1, picked, count + n); picked.pop();
      }
    };
    walk(0, [], 0);
    return out;
  }

  function describe(combo) {
    const items = combo.map(({ c, n }) => ({ id: c.id, name: c.name, servings: n, kcal: c.kcal, p: c.p, c: c.c, f: c.f, est: !!c.est }));
    const t = sum(items);
    return { items, add: { kcal: Math.round(t.kcal), p: r1(t.p), c: r1(t.c), f: r1(t.f) }, servings: items.reduce((s, x) => s + x.servings, 0) };
  }

  /*
   * Suggest the smallest add that closes the protein gap.
   * opts: basis ("plan" | "eaten"), dislikes (strings), never (meal-preferences
   *       entries), extra (more candidates: {name,kcal,p,c,f,max?}), exclude
   *       (ids or names to skip, e.g. "adonis" when he's had his), maxItems (3),
   *       targets.
   * status: "met"      protein already at 160 g or more
   *         "closable" best closes the gap within the kcal left
   *         "partial"  nothing closes it; best is the most protein that fits
   *         "no-room"  no kcal left, or nothing fits at all
   */
  function suggest(food, opts) {
    const o = Object.assign({ basis: 'plan', maxItems: 3, targets: TARGETS, extra: [], exclude: [] }, opts);
    const left = remaining(food, o);
    const res = Object.assign({}, left, { status: 'met', best: null, alternatives: [], skipped: [] });
    if (left.proteinLeft <= 0) return res;
    if (left.kcalLeft <= 0) { res.status = 'no-room'; return res; }

    const excl = new Set(o.exclude.map(norm));
    const pool = CATALOG.concat((o.extra || []).map((x, i) => Object.assign({ id: 'extra-' + i, max: 1 }, x)));
    const cands = [];
    pool.forEach(c => {
      if (excl.has(norm(c.id)) || excl.has(norm(c.name))) return;
      if (isDisliked(c.name, o)) { res.skipped.push(c.name); return; }
      if (!(c.p > 0) || c.kcal > left.kcalLeft) return;
      cands.push(c);
    });

    const fits = combos(cands, o.maxItems).map(describe).filter(d => d.add.kcal <= left.kcalLeft);
    if (!fits.length) { res.status = 'no-room'; return res; }

    const closes = fits.filter(d => d.add.p >= left.proteinLeft - 0.05);
    let ranked;
    if (closes.length) {
      res.status = 'closable';
      // Smallest add first; then fewer servings; then less overshoot past 170 g.
      ranked = closes.sort((a, b) => a.add.kcal - b.add.kcal || a.servings - b.servings || a.add.p - b.add.p);
    } else {
      res.status = 'partial';
      ranked = fits.sort((a, b) => b.add.p - a.add.p || a.add.kcal - b.add.kcal || a.servings - b.servings);
    }
    const withAfter = d => Object.assign(d, {
      after: { kcal: left.totals.kcal + d.add.kcal, p: r1(left.totals.p + d.add.p) },
      short: r1(Math.max(0, left.proteinLeft - d.add.p)),
    });
    res.best = withAfter(ranked[0]);
    // Alternatives: different item sets, not the best plus something on top.
    const bestIds = ranked[0].items.map(x => x.id);
    for (const d of ranked.slice(1)) {
      if (res.alternatives.length >= 2) break;
      if (bestIds.every(id => d.items.some(x => x.id === id))) continue;
      res.alternatives.push(withAfter(d));
    }
    return res;
  }

  const label = it => (it.servings > 1 ? it.servings + ' × ' : '') + it.name;

  // One-line summary for a card or the copyable day text.
  function summary(res) {
    const head = `${res.proteinLeft} g protein and ${res.kcalLeft} kcal left`;
    if (res.status === 'met') return `Protein is covered (${res.totals.p} g). ${res.kcalLeft} kcal left.`;
    if (res.status === 'no-room') return `${head}. No add fits without going over 2,000 kcal.`;
    const b = res.best;
    const what = b.items.map(label).join(' + ');
    if (res.status === 'closable') return `${head}. Add ${what}: +${b.add.p} g protein, +${b.add.kcal} kcal (ends at ${b.after.p} g, ${b.after.kcal} kcal).`;
    return `${head}. Nothing closes it under 2,000 kcal; ${what} gets closest (+${b.add.p} g, still ${b.short} g short).`;
  }

  // Map a suggestion into days/{date}.food items (planned, slot "add").
  function toFoodItems(s) {
    const out = [];
    (s && s.items || []).forEach(it => {
      for (let i = 0; i < it.servings; i++) {
        out.push({ id: 'add:' + it.id + ':' + Date.now().toString(36) + i, name: it.name, slot: 'add', kcal: it.kcal, p: it.p, c: it.c, f: it.f, eaten: false, est: it.est });
      }
    });
    return out;
  }

  return { TARGETS, CATALOG, DEFAULT_NEVER, isDisliked, remaining, suggest, summary, toFoodItems };
});
