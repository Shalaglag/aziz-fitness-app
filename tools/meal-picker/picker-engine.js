/*
 * Nutreeze daily meal picker engine.
 * Pure logic, no DOM. Works as a browser global (window.NutreezePicker)
 * or as a CommonJS module, so the main app can import it as-is.
 *
 * Rules come from Aziz's plan (sections 3, 5-8 and 14):
 *   2 main meals + 2 Nutreeze snacks + Adonis (+ Gatorade on training days),
 *   ~2,000 kcal, 160-170 g protein minimum, fat ~55-70 g, carbs ~180-220 g.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NutreezePicker = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TARGETS = { kcal: 2000, proteinMin: 160, proteinMax: 170, fat: [55, 70], carbs: [180, 220] };

  // Fixed "Sweet" tab snack menu. Banned snacks are kept so they can be shown as removed.
  const SNACKS = [
    { name: 'Chopped Pineapple', cat: 'Fruit', kcal: 44, p: 0, c: 11, f: 0 },
    { name: 'Fruit Salad', cat: 'Fruit', kcal: 48, p: 1, c: 11, f: 0 },
    { name: 'Mango', cat: 'Fruit', kcal: 52, p: 1, c: 12, f: 0 },
    { name: 'Pomegranate', cat: 'Fruit', kcal: 60, p: 1, c: 14, f: 0 },
    { name: 'Grapes', cat: 'Fruit', kcal: 68, p: 1, c: 16, f: 0 },
    { name: 'Dry Fruits', cat: 'Fruit', kcal: 93, p: 1, c: 20, f: 1 },
    { name: 'Green Apple', cat: 'Fruit', kcal: 104, p: 1, c: 25, f: 0 },
    { name: 'Banana', cat: 'Fruit', kcal: 121, p: 1, c: 27, f: 1 },
    { name: 'Zaafaran Cake', cat: 'Sweet', kcal: 105, p: 2, c: 13, f: 5 },
    { name: 'Chocolate Chip Cookies', cat: 'Sweet', kcal: 113, p: 3, c: 14, f: 5 },
    { name: 'Pro Mud Cake', cat: 'Sweet', kcal: 252, p: 4, c: 14, f: 20 },
    { name: 'Tamari Roasted Seeds (Pumpkin & Sunflower)', cat: 'Nuts', kcal: 167, p: 6, c: 11, f: 11 },
    { name: 'Roasted Rosemary Almonds', cat: 'Nuts', kcal: 183, p: 6, c: 6, f: 15 },
    { name: 'Herbs Roasted Walnut', cat: 'Nuts', kcal: 248, p: 6, c: 11, f: 20 },
    { name: 'Kinder Protein Ball', cat: 'Sweet', kcal: 162, p: 3, c: 15, f: 10 },
    { name: 'Popcorn', cat: 'Sweet', kcal: 61, p: 7, c: 6, f: 1 },
    { name: 'Blueberry Vanilla Muffin', cat: 'Sweet', kcal: 166, p: 8, c: 11, f: 10 },
  ];

  const ADONIS = { name: 'Adonis Protein Cookie Dough (50 g)', kcal: 192, p: 22, c: 11.4, f: 6.2 };
  const GATORADE = { name: 'Gatorade 1 L', kcal: 240, p: 0, c: 60, f: 0, estimate: true };
  // Midpoint of the plan's ~460-520 kcal | 31 P | 40-50 C | 20 F estimate.
  const SATURDAY_EGGS = { name: '3 eggs + Kraft spread + 1½ khubz', kcal: 490, p: 31, c: 45, f: 20, estimate: true };

  // Never pick. Each rule: label shown to the user + matcher on the lowercased name.
  const NEVER = [
    { label: 'Creamy Garlic Cheesy Chicken & Potato', test: n => /creamy garlic/.test(n) },
    { label: 'Chicken Mushroom with Sourdough', test: n => /mushroom/.test(n) && /chicken/.test(n) || /sourdough/.test(n) },
    { label: 'Chicken Shawarma', test: n => /shawarma/.test(n) },
    { label: 'Champion Chicken', test: n => /champion/.test(n) },
    { label: 'Minced Beef with Rice', test: n => /minced beef/.test(n) },
    { label: 'Tandoori Chicken with Grilled Tomato Jam', test: n => /tandoori/.test(n) },
    { label: 'Tuna, fish or shrimp', test: n => /\b(tuna|fish|shrimps?|prawns?|salmon|hammour|hamour|cod|tilapia|sea ?bass|zubaidi|seafood|calamari|sushi)\b/.test(n) },
    { label: 'Sandwiches (except French Tacos Chicken)', test: n => /\b(sandwich|sandwiches|panini|sub)\b/.test(n) && !/french tacos/.test(n) },
    { label: 'Protein balls', test: n => /protein ball|kinder/.test(n) },
    { label: 'Popcorn', test: n => /popcorn/.test(n) },
    { label: 'Blueberry Vanilla Muffin', test: n => /blueberry vanilla muffin/.test(n) },
  ];

  // Preference bonuses (subtracted from the penalty score).
  const LIKES = [
    { label: 'Favorite', bonus: 40, test: n => /french tacos/.test(n) },
    { label: 'Liked', bonus: 15, test: n => /buffalo/.test(n) && /sweet potato/.test(n) },
    { label: 'Liked', bonus: 15, test: n => /(majboos|machboos|biryani)/.test(n) },
    { label: 'Liked', bonus: 15, test: n => /steak/.test(n) && /potato/.test(n) },
    { label: 'Likes this type', bonus: 5, test: n => /(chicken|rice|steak|pasta|beef)/.test(n) },
  ];

  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

  function bannedReason(name, extraBans) {
    if (name && typeof name === 'object') {
      if (name.bannedReason) return name.bannedReason;
      name = name.name;
    }
    const n = norm(name);
    for (const r of NEVER) if (r.test(n)) return r.label;
    for (const b of extraBans || []) if (b && n.includes(norm(b))) return 'Your never-pick list: ' + b;
    return null;
  }

  function likeOf(name) {
    const n = norm(name);
    for (const l of LIKES) if (l.test(n)) return l;
    return null;
  }

  /*
   * Parse a pasted menu. One meal per line; the last four numbers are kcal, protein, carbs, fat.
   * Accepts "French Tacos Chicken — 620 kcal | 55 P | 60 C | 18 F", "Name, 620, 55, 60, 18", etc.
   */
  function parseMenu(text) {
    const json = parseMenuJson(text);
    if (json) return json;
    const out = [];
    String(text || '').split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const nums = [...line.matchAll(/\d+(?:\.\d+)?/g)];
      if (nums.length < 4) {
        out.push({ line: i + 1, raw: line, name: line.replace(/[\s,|:—–-]+$/, ''), error: 'Needs 4 numbers: kcal, protein, carbs, fat' });
        return;
      }
      const last = nums.slice(-4);
      const name = line.slice(0, last[0].index).replace(/[\s,|:;—–\-=(]+$/, '').trim();
      const [kcal, p, c, f] = last.map(m => parseFloat(m[0]));
      if (!name) {
        out.push({ line: i + 1, raw: line, name: '', error: 'Missing meal name' });
        return;
      }
      out.push({ line: i + 1, raw: line, name, kcal, p, c, f });
    });
    return out;
  }

  /*
   * Accepts the Menu Reader's saved record or exported file (nutreeze-menus/FORMAT.md):
   * { date, items: [{ name, section, kcal, protein, carbs, fat, banned, bannedReason, needsCheck }] }.
   * Only section "meal" items are used; snacks come from the fixed snack menu.
   */
  function parseMenuJson(text) {
    const t = String(text || '').trim();
    if (!/^[\[{]/.test(t)) return null;
    let data;
    try { data = JSON.parse(t); } catch (e) { return null; }
    const items = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : null;
    if (!items) return null;
    const out = [];
    items.forEach((it, i) => {
      if (!it || (it.section && it.section !== 'meal')) return;
      const m = { line: i + 1, raw: it.name, name: String(it.name || '').trim(), kcal: it.kcal, p: it.protein, c: it.carbs, f: it.fat };
      if (!m.name) return;
      if ([m.kcal, m.p, m.c, m.f].some(v => typeof v !== 'number')) m.error = 'A number was unreadable on the screenshot; fix it in the Menu Reader';
      if (it.banned) m.bannedReason = it.bannedReason || 'Marked never-pick in the Menu Reader';
      if (it.needsCheck) m.needsCheck = true;
      out.push(m);
    });
    out.date = typeof data.date === 'string' ? data.date : null;
    return out;
  }

  const sum = items => items.reduce((t, x) => ({
    kcal: t.kcal + x.kcal, p: t.p + x.p, c: t.c + x.c, f: t.f + x.f,
  }), { kcal: 0, p: 0, c: 0, f: 0 });

  const outside = (v, [lo, hi]) => (v < lo ? lo - v : v > hi ? v - hi : 0);

  // Lower is better.
  function score(meal1, meal2, snacks, totals, opts) {
    let s = 0;
    const dk = totals.kcal - TARGETS.kcal;
    const adk = Math.abs(dk);
    s += adk <= 50 ? adk * 0.2 : 10 + (adk - 50) * (dk > 0 ? 1.3 : 1);
    // Protein minimum is a hard rule: missing it outweighs even the favorite bonus.
    if (totals.p < TARGETS.proteinMin - 0.5) s += 60 + (TARGETS.proteinMin - totals.p) * 8;
    s += outside(totals.f, TARGETS.fat) * 2;
    s += outside(totals.c, TARGETS.carbs) * 0.5;
    // Meal 1 sits ~1.5 h before training on weekdays: keep it lower in fat.
    if (opts.dayType === 'training' && meal1.f > 20) s += (meal1.f - 20);
    for (const m of [meal1, meal2]) { const l = likeOf(m.name); if (l) s -= l.bonus; }
    if (snacks.some(x => x.cat === 'Sweet')) s -= 10;
    else if (snacks.some(x => x.cat === 'Fruit')) s -= 4;
    return s;
  }

  // Meal 1 = the lighter, lower-fat, higher-carb meal.
  function orderMeals(a, b) {
    const key = m => m.f * 9 - m.c * 2 + m.kcal * 0.2;
    return key(a) <= key(b) ? [a, b] : [b, a];
  }

  // Which time slot each snack goes with.
  function snackTiming(snacks, meal1, opts) {
    const heavyMeal1 = meal1.kcal >= 700;
    return snacks.map(s => {
      const evening = s.cat === 'Nuts' || /pro mud cake/i.test(s.name) || (heavyMeal1 && s.cat === 'Sweet');
      return { ...s, with: evening ? 'meal2' : 'meal1' };
    });
  }

  function slotLabels(dayType) {
    if (dayType === 'saturday') return { meal1: 'lunch, after training', meal2: 'evening' };
    if (dayType === 'rest') return { meal1: 'lunch', meal2: 'evening' };
    if (dayType === 'friday') return { meal1: 'midday', meal2: 'evening' };
    return { meal1: '2 pm, pre-workout', meal2: '8–9 pm' };
  }

  /*
   * opts: {
   *   meals: [{name,kcal,p,c,f}], dayType: 'training'|'rest'|'saturday'|'friday',
   *   adonis: bool, gatorade: bool, eggs: bool, extraBans: [str], unavailableSnacks: [name],
   *   lockMeals: [name], lockSnacks: [name], exclude: [name], top: n
   * }
   */
  function pick(opts) {
    const o = Object.assign({ dayType: 'training', adonis: true, gatorade: true, eggs: false, extraBans: [], unavailableSnacks: [], lockMeals: [], lockSnacks: [], exclude: [], top: 5 }, opts);
    const excluded = new Set(o.exclude.map(norm));
    const fixed = [];
    if (o.eggs) fixed.push({ ...SATURDAY_EGGS, slot: 'breakfast' });
    if (o.adonis) fixed.push({ ...ADONIS, slot: 'adonis' });
    if (o.gatorade) fixed.push({ ...GATORADE, slot: 'gatorade' });
    const fixedTotals = sum(fixed);

    const meals = (o.meals || []).filter(m => !m.error && !bannedReason(m, o.extraBans) && !excluded.has(norm(m.name)));
    const snacks = SNACKS.filter(s => !bannedReason(s.name, o.extraBans) && !o.unavailableSnacks.map(norm).includes(norm(s.name)) && !excluded.has(norm(s.name)));
    const lockM = o.lockMeals.map(norm), lockS = o.lockSnacks.map(norm);

    const combos = [];
    for (let i = 0; i < meals.length; i++) for (let j = i + 1; j < meals.length; j++) {
      const pair = [meals[i], meals[j]];
      if (!lockM.every(l => pair.some(m => norm(m.name) === l))) continue;
      const [m1, m2] = orderMeals(meals[i], meals[j]);
      for (let a = 0; a < snacks.length; a++) for (let b = a + 1; b < snacks.length; b++) {
        const sp = [snacks[a], snacks[b]];
        if (!lockS.every(l => sp.some(s => norm(s.name) === l))) continue;
        const totals = sum([fixedTotals, m1, m2, ...sp]);
        combos.push({ meal1: m1, meal2: m2, snacks: snackTiming(sp, m1, o), totals, score: score(m1, m2, sp, totals, o) });
      }
    }
    combos.sort((x, y) => x.score - y.score);

    // Alternatives: best combo per distinct meal pair first, so the list isn't five snack swaps.
    const seen = new Set(), options = [];
    for (const c of combos) {
      const k = c.meal1.name + '|' + c.meal2.name;
      if (seen.has(k)) continue;
      seen.add(k); options.push(c);
      if (options.length >= o.top) break;
    }
    if (options.length < o.top) for (const c of combos) {
      if (options.length >= o.top) break;
      if (!options.includes(c)) options.push(c);
    }
    options.forEach(c => { c.check = evaluate(c); });

    return { fixed, fixedTotals, options, mealCount: meals.length, snackCount: snacks.length, labels: slotLabels(o.dayType) };
  }

  // How well a plan fits, plus warnings to show.
  function evaluate(c) {
    const t = c.totals, notes = [];
    const dk = Math.round(t.kcal - TARGETS.kcal);
    const kcalOk = Math.abs(dk) <= 100;
    const proteinOk = t.p >= TARGETS.proteinMin;
    if (!kcalOk) notes.push(`${Math.abs(dk)} kcal ${dk > 0 ? 'over' : 'under'} 2,000`);
    if (!proteinOk) notes.push(`${Math.round(TARGETS.proteinMin - t.p)} g protein short of 160 g (snacks can't close this; flag it rather than assume a shake)`);
    if (outside(t.f, TARGETS.fat)) notes.push(`fat ${Math.round(t.f)} g is outside 55–70 g`);
    if (outside(t.c, TARGETS.carbs) > 15) notes.push(`carbs ${Math.round(t.c)} g are outside 180–220 g`);
    for (const m of [c.meal1, c.meal2]) if (m.needsCheck) notes.push(`check the numbers for ${m.name} (the Menu Reader flagged them)`);
    if (c.meal1.kcal >= 700) notes.push('Meal 1 is 700+ kcal, so the sweet moves to the evening');
    const fits = kcalOk && proteinOk;
    let verdict;
    if (fits && !notes.length) verdict = `On target: ${fmt(t.kcal)} kcal and ${Math.round(t.p)} g protein.`;
    else if (fits) verdict = `Good fit (${fmt(t.kcal)} kcal, ${Math.round(t.p)} g protein); note: ${notes.join('; ')}.`;
    else verdict = `Closest option from today's menu; misses by ${notes.join('; ')}.`;
    return { fits, notes, verdict };
  }

  const r = n => Math.round(n);
  const fmt = n => r(n).toLocaleString('en-US');

  // Section 14 reply format.
  function formatPlan(plan, fixed, opts) {
    const o = Object.assign({ date: '', dayType: 'training' }, opts);
    const L = slotLabels(o.dayType);
    const lines = [`### ${o.date} — My Meals`];
    const eggs = fixed.find(x => x.slot === 'breakfast');
    if (eggs) lines.push(`**Breakfast (8 am):** ${eggs.name} — ~${eggs.kcal} kcal | ${eggs.p} g protein (estimate)`);
    lines.push(`**Meal 1 (${L.meal1}):** ${plan.meal1.name} — ${r(plan.meal1.kcal)} kcal | ${r(plan.meal1.p)} g protein`);
    lines.push(`**Meal 2 (${L.meal2}):** ${plan.meal2.name} — ${r(plan.meal2.kcal)} kcal | ${r(plan.meal2.p)} g protein`);
    plan.snacks.forEach((s, i) => lines.push(`**Snack ${i + 1} (with Meal ${s.with === 'meal1' ? 1 : 2}):** ${s.name} — ${s.kcal} kcal | ${s.p} g protein`));
    if (fixed.some(x => x.slot === 'adonis')) lines.push(`**Adonis Cookie Dough:** 192 kcal | 22 g protein`);
    if (fixed.some(x => x.slot === 'gatorade')) lines.push(`**Gatorade 1 L (training days):** ~240 kcal | 0 g protein`);
    const t = plan.totals;
    lines.push(`**TOTAL: ${fmt(t.kcal)} kcal | ${r(t.p)} g protein | ${r(t.c)} g carbs | ${r(t.f)} g fat**`);
    lines.push(`**Verdict:** ${plan.check.verdict}`);
    return lines.join('\n');
  }

  /*
   * Convert a chosen plan into the main app's days/{date}.food items
   * ({id, name, slot, kcal, p, c, f, eaten, est}). Planned only: eaten stays false.
   */
  function toFoodItems(plan, fixed) {
    const items = [];
    const add = (x, slot) => items.push({
      id: slot + ':' + norm(x.name).replace(/[^a-z0-9]+/g, '-'),
      name: x.name, slot, kcal: x.kcal, p: x.p, c: x.c, f: x.f, eaten: false, est: !!x.estimate,
    });
    (fixed || []).filter(x => x.slot === 'breakfast').forEach(x => add(x, 'breakfast'));
    add(plan.meal1, 'meal1');
    add(plan.meal2, 'meal2');
    plan.snacks.forEach((s, i) => add(s, 'snack' + (i + 1)));
    (fixed || []).filter(x => x.slot !== 'breakfast').forEach(x => add(x, x.slot));
    return items;
  }

  return { toFoodItems, TARGETS, SNACKS, ADONIS, GATORADE, SATURDAY_EGGS, NEVER, bannedReason, likeOf, parseMenu, pick, formatPlan, slotLabels };
});
