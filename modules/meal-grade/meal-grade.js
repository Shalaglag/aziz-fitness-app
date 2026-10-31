/*
 * Meal grade: an A–D grade for one food row, one planned meal, or a whole day.
 * Pure logic plus two tiny HTML helpers, no network. Browser global (window.MealGrade) or CommonJS.
 *
 * A row is graded mainly on protein per 100 kcal (the day's plan needs about 8 g/100 kcal:
 * 160 g in 2,000 kcal) and on how it fits the day's budget (kcal share, fat share).
 * A day is graded on protein, calories, fat and carbs against the targets (AppTargets shape,
 * the picker's {kcal, proteinMin, proteinMax, fat:[lo,hi], carbs:[lo,hi]}, or the shell's TARGET).
 *
 *   MealGrade.density(item)                    -> g protein per 100 kcal, or null
 *   MealGrade.kindOf(item)                     -> 'meal' | 'snack'
 *   MealGrade.gradeItem(item, {kind, targets}) -> {grade, score, density, kcalShare, fatShare, kind, reasons} or null
 *   MealGrade.gradeDay(food, {targets, basis}) -> {grade, score, totals, parts, reasons} or null (basis: plan | eaten)
 *   MealGrade.badge(res, opts) / dayBadge(res) -> small HTML pill; MealGrade.css
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MealGrade = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = { kcal: 2000, kcalLo: 1850, kcalHi: 2150, proteinMin: 160, proteinMax: 170, fatLo: 55, fatHi: 70, carbsLo: 180, carbsHi: 220 };
  const BANDS = [[80, 'A'], [60, 'B'], [40, 'C'], [0, 'D']];
  const LABEL = { A: 'Great pick', B: 'Good', C: 'Okay', D: 'Poor fit' };

  const num = v => { const x = typeof v === 'string' && v.trim() ? +v : v; return typeof x === 'number' && isFinite(x) ? x : null; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (v, from, to, max) => clamp((v - from) / (to - from), 0, 1) * max; // 0 at `from`, `max` at `to`
  const letter = s => BANDS.find(([min]) => s >= min)[1];

  // Accept AppTargets, the picker engine's shape, or the shell's TARGET.
  function targetsFrom(t) {
    t = t || {};
    const kcal = num(t.kcal) || DEFAULTS.kcal;
    const pMin = num(t.proteinMin) || num(t.pMin) || DEFAULTS.proteinMin;
    const pMax = num(t.proteinMax) || num(t.pMax) || pMin + 10;
    const fat = Array.isArray(t.fat) ? t.fat : [num(t.fatLo) ?? num(t.fMin) ?? DEFAULTS.fatLo, num(t.fatHi) ?? num(t.fMax) ?? DEFAULTS.fatHi];
    const carbs = Array.isArray(t.carbs) ? t.carbs : [num(t.carbsLo) ?? num(t.cMin) ?? DEFAULTS.carbsLo, num(t.carbsHi) ?? num(t.cMax) ?? DEFAULTS.carbsHi];
    const kcalLo = num(t.kcalLo) ?? kcal - 150, kcalHi = num(t.kcalHi) ?? kcal + 150;
    return { kcal, kcalLo, kcalHi, proteinMin: pMin, proteinMax: pMax, fatLo: fat[0], fatHi: fat[1], carbsLo: carbs[0], carbsHi: carbs[1] };
  }

  const protein = it => num(it.p) ?? num(it.protein);
  const fatOf = it => num(it.f) ?? num(it.fat);

  function density(it) {
    const k = num(it && it.kcal), p = it && protein(it);
    if (!k || k <= 0 || p == null) return null;
    return p / k * 100;
  }

  // A row's kind from its slot (app food), section (menu item) or size.
  function kindOf(it) {
    if (!it) return 'snack';
    if (it.kind === 'meal' || it.kind === 'snack') return it.kind;
    const slot = String(it.slot || '').toLowerCase(), sec = String(it.section || '').toLowerCase();
    if (/meal|breakfast/.test(slot)) return 'meal';
    if (/snack|extra|adonis|gatorade/.test(slot)) return 'snack';
    if (['meal', 'salad', 'soup'].includes(sec)) return 'meal';
    if (sec) return 'snack';
    return (num(it.kcal) || 0) >= 350 ? 'meal' : 'snack';
  }

  function gradeItem(it, opts) {
    const o = opts || {};
    const T = targetsFrom(o.targets);
    const kcal = num(it && it.kcal), p = it && protein(it);
    if (!kcal || kcal <= 0 || p == null) return null;
    const kind = o.kind === 'meal' || o.kind === 'snack' ? o.kind : kindOf(it);
    const d = p / kcal * 100, f = fatOf(it);
    const fatShare = f == null ? null : f * 9 / kcal;
    const kcalShare = kcal / T.kcal;
    const reasons = [];
    let score;
    if (kind === 'meal') {
      const dp = lerp(d, 4, 12, 70);                 // 4 g/100 kcal = 0, 12+ = full
      let fit = 30;
      if (kcalShare < 0.25) fit -= (0.25 - kcalShare) * 100;
      if (kcalShare > 0.40) fit -= (kcalShare - 0.40) * 100;
      fit = clamp(fit, 0, 30);
      let pen = 0;
      if (fatShare != null && fatShare > 0.40) { pen = 10; reasons.push(`${Math.round(fatShare * 100)}% of its calories are fat`); }
      score = clamp(dp + fit - pen, 0, 100);
      reasons.unshift(`${d.toFixed(1)} g protein per 100 kcal`, `${Math.round(kcalShare * 100)}% of the day's ${T.kcal.toLocaleString('en-US')} kcal`);
    } else {
      const dp = lerp(d, 0, 8, 50);
      const fit = kcal <= 120 ? 50 : lerp(kcal, 300, 120, 50);
      let pen = 0;
      if (f != null && f >= 15) { pen = 15; reasons.push(`${Math.round(f)} g fat for a snack`); }
      score = clamp(dp + fit - pen, 0, 100);
      reasons.unshift(`${d.toFixed(1)} g protein per 100 kcal`, `${Math.round(kcal)} kcal`);
    }
    score = Math.round(score);
    const grade = letter(score);
    return { grade, score, density: +d.toFixed(1), kcalShare: +kcalShare.toFixed(3), fatShare: fatShare == null ? null : +fatShare.toFixed(3), kind, label: LABEL[grade], reasons };
  }

  function sum(items) {
    return items.reduce((a, i) => ({ kcal: a.kcal + (num(i.kcal) || 0), p: a.p + (protein(i) || 0), c: a.c + (num(i.c) ?? num(i.carbs) ?? 0), f: a.f + (fatOf(i) || 0) }), { kcal: 0, p: 0, c: 0, f: 0 });
  }

  function gradeDay(food, opts) {
    const o = opts || {};
    const T = targetsFrom(o.targets);
    const items = (food || []).filter(i => i && (o.basis === 'eaten' ? i.eaten : true));
    if (!items.length) return null;
    const t = sum(items), parts = [], reasons = [];
    const r0 = v => Math.round(v);
    // Protein 40: full at proteinMin, nothing 40 g below it.
    let pp = lerp(t.p, T.proteinMin - 40, T.proteinMin, 40);
    if (t.p > T.proteinMax + 30) pp -= 5;
    pp = clamp(Math.round(pp), 0, 40);
    parts.push({ key: 'protein', label: 'Protein', got: pp, max: 40, detail: `${r0(t.p)} g of ${T.proteinMin}–${T.proteinMax} g` });
    if (t.p < T.proteinMin) reasons.push(`${r0(T.proteinMin - t.p)} g protein short`);
    // Calories 35: full inside the band, −1 per 10 kcal outside it.
    const out = t.kcal < T.kcalLo ? T.kcalLo - t.kcal : t.kcal > T.kcalHi ? t.kcal - T.kcalHi : 0;
    const kp = clamp(Math.round(35 - out / 10), 0, 35);
    parts.push({ key: 'kcal', label: 'Calories', got: kp, max: 35, detail: `${r0(t.kcal)} of ${r0(T.kcalLo)}–${r0(T.kcalHi)} kcal` });
    if (out) reasons.push(`${r0(out)} kcal ${t.kcal > T.kcalHi ? 'over' : 'under'} the ${r0(T.kcalLo)}–${r0(T.kcalHi)} band`);
    // Fat 15: full at or under fatHi, −1 per 2 g over.
    const fp = clamp(Math.round(15 - Math.max(0, t.f - T.fatHi) / 2), 0, 15);
    parts.push({ key: 'fat', label: 'Fat', got: fp, max: 15, detail: `${r0(t.f)} g (max ${T.fatHi} g)` });
    if (t.f > T.fatHi) reasons.push(`fat ${r0(t.f - T.fatHi)} g over ${T.fatHi} g`);
    // Carbs 10: in range 10, within 20 g 5, else 0.
    const cout = t.c < T.carbsLo ? T.carbsLo - t.c : t.c > T.carbsHi ? t.c - T.carbsHi : 0;
    const cp = cout === 0 ? 10 : cout <= 20 ? 5 : 0;
    parts.push({ key: 'carbs', label: 'Carbs', got: cp, max: 10, detail: `${r0(t.c)} g of ${T.carbsLo}–${T.carbsHi} g` });
    if (cout > 20) reasons.push(`carbs ${r0(cout)} g outside ${T.carbsLo}–${T.carbsHi} g`);
    const score = parts.reduce((a, x) => a + x.got, 0);
    const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D';
    return { grade, score, totals: t, parts, reasons, basis: o.basis === 'eaten' ? 'eaten' : 'plan', count: items.length };
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function badge(res, opts) {
    if (!res) return '';
    const o = opts || {};
    const title = o.title || `${res.label}: ${res.reasons.join(' · ')}`;
    return `<span class="mg mg-${res.grade}${o.small ? ' mg-s' : ''}" title="${esc(title)}" aria-label="Grade ${res.grade}, ${esc(title)}">${res.grade}</span>`;
  }

  function dayBadge(res) {
    if (!res) return '';
    const why = res.reasons.length ? res.reasons.join('; ') : 'protein, calories, fat and carbs all on target';
    return `<span class="mg mg-day mg-${res.grade}" title="${esc(why)}" aria-label="Day grade ${res.grade}: ${esc(why)}">Day ${res.grade}<small>${res.basis === 'eaten' ? 'eaten' : 'planned'}</small></span>`;
  }

  const css = `
.mg{display:inline-flex;align-items:center;justify-content:center;min-width:1.5em;height:1.5em;padding:0 .35em;border-radius:6px;font-weight:800;font-size:.78rem;line-height:1;color:#fff;background:var(--muted);vertical-align:middle;flex:none}
.mg.mg-s{min-width:1.3em;height:1.3em;font-size:.7rem}
.mg-A{background:var(--good)}.mg-B{background:var(--accent)}.mg-C{background:var(--warn)}.mg-D{background:var(--bad)}
.mg-day{border-radius:999px;padding:2px 10px;height:auto;gap:6px;font-size:.78rem}
.mg-day small{font-weight:500;opacity:.85;font-size:.7rem}
`;

  return { DEFAULTS, LABEL, targetsFrom, density, kindOf, gradeItem, gradeDay, badge, dayBadge, css };
});
