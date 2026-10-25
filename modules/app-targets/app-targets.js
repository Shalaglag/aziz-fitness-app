/*
 * AppTargets: one place that turns the "Your numbers" profile into the targets every card uses.
 * Plain JS, no imports, no network. Browser global (window.AppTargets) or CommonJS.
 *
 * Why: calories, protein, fat, carbs, the goal weight and the review window used to be constants
 * inside each module (picker, protein gap, daily score, weekly report, budget recovery, Ramadan,
 * logger). Editing "Your numbers" only reached diet breaks and goal date. Modules should take the
 * object from AppTargets.resolve() as an option instead of hard-coding numbers.
 *
 *   AppTargets.resolve(profile, defaults) -> targets
 *     profile  = prefs/main.profile {start, startKg, goalKg, cutKcal, maintenance, protein, fat}, any field optional
 *     defaults = the host's plan numbers, same keys as the result (the module ships none of its own)
 *     targets  = {kcal, kcalLo, kcalHi, proteinMin, proteinMax, fatLo, fatHi, carbsLo, carbsHi,
 *                 goalKg, start, reviewDays, reviewDate, source:{<field>:"profile"|"default"|"derived"|"none"}}
 *   AppTargets.forKcal(targets, kcal)     -> same targets with a different calorie target (e.g. a diet-break day);
 *                                            carbs re-derived, protein kept
 *   AppTargets.lastDays(today, days)      -> {from, to} for the last `days` days ending today, inclusive
 *   AppTargets.reviewWindow(targets, today) -> {from, to, day, days, done} for the strict-tracking review
 *   AppTargets.validate(profile)          -> {clean, errors:[{field, msg}]}
 *
 * Never invents numbers: a field with no profile value and no default comes back null.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AppTargets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 864e5;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const KCAL_BAND = 150, FAT_BAND = 7.5, CARB_BAND = 20, PROTEIN_SPAN = 10, REVIEW_DAYS = 14;
  const LIMITS = {
    cutKcal: [1000, 6000, 'Calories should be between 1,000 and 6,000'],
    maintenance: [1000, 7000, 'Maintenance should be between 1,000 and 7,000'],
    protein: [40, 400, 'Protein should be between 40 and 400 g'],
    fat: [20, 250, 'Fat should be between 20 and 250 g'],
    goalKg: [30, 300, 'Goal weight should be between 30 and 300 kg'],
    startKg: [30, 300, 'Start weight should be between 30 and 300 kg'],
  };

  const isNum = v => v !== null && v !== '' && v !== undefined && isFinite(+v);
  const r5 = v => Math.round(v / 5) * 5;
  const r1 = v => Math.round(v * 10) / 10;
  const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
  const realDate = s => DATE.test(s || '') && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(Date.parse(s + 'T00:00:00Z')).toISOString().slice(0, 10) === s;

  function validate(profile) {
    const P = profile || {}, clean = {}, errors = [];
    Object.keys(LIMITS).forEach(k => {
      if (!isNum(P[k])) return;
      const v = +P[k], [lo, hi, msg] = LIMITS[k];
      if (v < lo || v > hi) errors.push({ field: k, msg });
      else clean[k] = v;
    });
    if (P.start) { if (realDate(P.start)) clean.start = P.start; else errors.push({ field: 'start', msg: 'Start date should look like 2026-10-25' }); }
    return { clean, errors };
  }

  function carbsFor(kcal, protein, fatMid) {
    if (!isNum(kcal) || !isNum(protein) || !isNum(fatMid)) return null;
    const mid = (kcal - protein * 4 - fatMid * 9) / 4;
    return mid > 0 ? r5(mid) : 0;
  }

  function resolve(profile, defaults) {
    const P = validate(profile).clean, D = defaults || {}, source = {};
    const pick = (key, profVal) => {
      if (isNum(profVal)) { source[key] = 'profile'; return +profVal; }
      if (isNum(D[key])) { source[key] = 'default'; return +D[key]; }
      source[key] = 'none'; return null;
    };
    const t = {};
    t.kcal = pick('kcal', P.cutKcal);
    if (source.kcal === 'profile' || !isNum(D.kcalLo) || !isNum(D.kcalHi)) {
      t.kcalLo = t.kcal != null ? t.kcal - KCAL_BAND : null; t.kcalHi = t.kcal != null ? t.kcal + KCAL_BAND : null;
      source.kcalBand = t.kcal != null ? 'derived' : 'none';
    } else { t.kcalLo = +D.kcalLo; t.kcalHi = +D.kcalHi; source.kcalBand = 'default'; }

    t.proteinMin = pick('proteinMin', P.protein);
    t.proteinMax = source.proteinMin === 'profile' ? t.proteinMin + PROTEIN_SPAN : isNum(D.proteinMax) ? +D.proteinMax : t.proteinMin != null ? t.proteinMin + PROTEIN_SPAN : null;

    if (isNum(P.fat)) { t.fatLo = r1(P.fat - FAT_BAND); t.fatHi = r1(P.fat + FAT_BAND); source.fat = 'profile'; }
    else if (isNum(D.fatLo) && isNum(D.fatHi)) { t.fatLo = +D.fatLo; t.fatHi = +D.fatHi; source.fat = 'default'; }
    else { t.fatLo = t.fatHi = null; source.fat = 'none'; }

    // Carbs: keep the plan's range unless a profile number moved the others; then fill the remainder.
    const moved = source.kcal === 'profile' || source.proteinMin === 'profile' || source.fat === 'profile';
    if (!moved && isNum(D.carbsLo) && isNum(D.carbsHi)) { t.carbsLo = +D.carbsLo; t.carbsHi = +D.carbsHi; source.carbs = 'default'; }
    else {
      const mid = carbsFor(t.kcal, t.proteinMin, t.fatLo != null ? (t.fatLo + t.fatHi) / 2 : null);
      t.carbsLo = mid != null ? Math.max(0, mid - CARB_BAND) : null; t.carbsHi = mid != null ? mid + CARB_BAND : null;
      source.carbs = mid != null ? 'derived' : 'none';
    }

    t.goalKg = pick('goalKg', P.goalKg);
    t.maintenance = pick('maintenance', P.maintenance);
    t.start = P.start || (realDate(D.start) ? D.start : null);
    source.start = P.start ? 'profile' : t.start ? 'default' : 'none';
    t.reviewDays = isNum(D.reviewDays) ? +D.reviewDays : REVIEW_DAYS;
    t.reviewDate = t.start ? addDays(t.start, t.reviewDays - 1) : null;
    t.source = source;
    return t;
  }

  function forKcal(targets, kcal) {
    const t = Object.assign({}, targets, { source: Object.assign({}, targets.source) });
    if (!isNum(kcal)) return t;
    t.kcal = +kcal; t.kcalLo = t.kcal - KCAL_BAND; t.kcalHi = t.kcal + KCAL_BAND;
    const mid = carbsFor(t.kcal, t.proteinMin, t.fatLo != null ? (t.fatLo + t.fatHi) / 2 : null);
    if (mid != null) { t.carbsLo = Math.max(0, mid - CARB_BAND); t.carbsHi = mid + CARB_BAND; t.source.carbs = 'derived'; }
    t.source.kcal = 'day'; t.source.kcalBand = 'derived';
    return t;
  }

  function lastDays(today, days) {
    if (!realDate(today) || !(days >= 1)) return null;
    return { from: addDays(today, -(Math.floor(days) - 1)), to: today };
  }

  function reviewWindow(targets, today) {
    if (!targets || !targets.start || !realDate(today)) return null;
    const days = targets.reviewDays || REVIEW_DAYS;
    const day = daysBetween(targets.start, today) + 1;
    return { from: targets.start, to: addDays(targets.start, days - 1), day: Math.max(0, Math.min(day, days)), days, done: day >= days, notStarted: day < 1 };
  }

  return { resolve, forKcal, lastDays, reviewWindow, validate, addDays, daysBetween };
});
