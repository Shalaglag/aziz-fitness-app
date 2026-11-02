/*
 * GoalSetup: the step-by-step goal questionnaire (sex, age, height, weight, activity, goal, pace,
 * target weight or end date) that turns the answers into calorie and macro targets and a projected
 * timeline. Shown full screen to a new user, re-run from Settings, offered again when the weight moves.
 *
 * Plain JS, no imports, no network. Browser global (window.GoalSetup) or CommonJS.
 * Generic: nothing here knows the host's plan numbers. The host decides when to apply a result.
 *
 *   GoalSetup.compute(answers, {today})        -> result (see below), never throws, result.ok false with errors
 *   GoalSetup.validate(answers)                -> {clean, errors:[{field,msg}]}
 *   GoalSetup.needsRerun(saved, kg)            -> true when `kg` is 1+ kg away from the weight the plan was built on
 *   GoalSetup.compactHtml(saved, {today, kg})  -> one line "Bulk to 95 kg · about Mar 12" for gain/maintain goals
 *   GoalSetup.open({answers, today, existing, firstRun, onApply, onSkip, onClose}) -> {close, el}
 *   GoalSetup.css                              -> CSS string, inject once (uses the app's tokens)
 *
 * answers = {sex:'male'|'female', age, heightCm, kg, activity:'sedentary'|'light'|'moderate'|'active'|'very',
 *            goal:'cut'|'maintain'|'bulk'|'muscle', pace:<id from PACES[goal]>, mode:'pace'|'date',
 *            targetKg?, endDate?}
 * result  = {ok, errors, bmr, tdee, goal, direction, ratePct, rateKgWk, kcal, floor, floored, deficit,
 *            protein, fat, carbs, proteinPerKg, weeks, endDate, milestones:[{kg,date}], warnings:[], notes:[],
 *            profile:{start, startKg, goalKg, cutKcal, maintenance, protein, fat, kcalFloor}}
 *
 * Method (the sources are listed in SOURCES and shown in the app):
 *   BMR        Mifflin-St Jeor 1990: 10·kg + 6.25·cm − 5·age + 5 (men) / − 161 (women)
 *   TDEE       BMR × activity factor 1.2 / 1.375 / 1.55 / 1.725 / 1.9
 *   Loss pace  0.5–1 % of body weight a week (Helms 2014); 0.7 %/wk kept more strength than 1.4 %/wk (Garthe 2011)
 *   Gain pace  0.25–0.5 % a week (Iraki 2019); muscle-focused gain uses the low end
 *   Energy     7,700 kcal per kg of body weight change (the app's shared figure)
 *   Floor      never below 1,500 kcal (men) / 1,200 kcal (women), and never more than a 30 % deficit
 *   Protein    1.6–2.2 g/kg (Morton 2018): cut 2.0, muscle gain 2.0, bulk 1.8, maintain 1.6; for BMI over 30 the
 *              weight at BMI 30 is used so the number stays realistic
 *   Fat        25 % of calories, at least 0.6 g/kg; carbs fill the rest
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GoalSetup = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 864e5, KCAL_PER_KG = 7700, MAX_WEEKS = 260;
  const ACTIVITY = [
    { id: 'sedentary', f: 1.2, label: 'Mostly sitting', sub: 'Desk job, little walking, no regular exercise' },
    { id: 'light', f: 1.375, label: 'Lightly active', sub: 'On your feet some of the day, or 1–3 easy workouts a week' },
    { id: 'moderate', f: 1.55, label: 'Active', sub: 'Lifting 3–5 days a week, or a job that keeps you moving' },
    { id: 'active', f: 1.725, label: 'Very active', sub: 'Hard training 6–7 days a week, or a physical job plus training' },
    { id: 'very', f: 1.9, label: 'Athlete', sub: 'Two sessions a day or heavy manual work plus training' },
  ];
  const GOALS = [
    { id: 'cut', label: 'Lose fat', sub: 'Eat below maintenance, keep the muscle' },
    { id: 'maintain', label: 'Maintain', sub: 'Hold your weight, eat at maintenance' },
    { id: 'muscle', label: 'Build muscle', sub: 'A small surplus so most of the gain is muscle' },
    { id: 'bulk', label: 'Gain weight', sub: 'A bigger surplus, faster scale gain' },
  ];
  // pct = % of body weight a week; sign comes from the goal.
  const PACES = {
    cut: [
      { id: 'easy', pct: 0.35, label: 'Gentle', sub: '0.35 % of body weight a week · easiest to keep up' },
      { id: 'regular', pct: 0.5, label: 'Regular', sub: '0.5 % a week · the usual recommendation' },
      { id: 'aggressive', pct: 0.75, label: 'Aggressive', sub: '0.75 % a week · faster, needs tighter tracking' },
      { id: 'extreme', pct: 1.0, label: 'Extreme', sub: '1 % a week · the upper limit before muscle loss rises' },
    ],
    muscle: [
      { id: 'lean', pct: 0.25, label: 'Lean gain', sub: '0.25 % of body weight a week · mostly muscle' },
      { id: 'regular', pct: 0.4, label: 'Steady gain', sub: '0.4 % a week · a little more fat with it' },
    ],
    bulk: [
      { id: 'lean', pct: 0.25, label: 'Lean bulk', sub: '0.25 % of body weight a week · slow and clean' },
      { id: 'regular', pct: 0.5, label: 'Regular bulk', sub: '0.5 % a week · the upper end that stays mostly muscle' },
    ],
    maintain: [],
  };
  const PROTEIN_PER_KG = { cut: 2.0, maintain: 1.6, muscle: 2.0, bulk: 1.8 };
  const FLOOR = { male: 1500, female: 1200 };
  const MAX_DEFICIT = 0.30, FAT_SHARE = 0.25, FAT_MIN_PER_KG = 0.6, MIN_CARBS = 50;
  const LIMITS = {
    age: [13, 100, 'Age should be between 13 and 100'],
    heightCm: [120, 230, 'Height should be between 120 and 230 cm'],
    kg: [30, 300, 'Weight should be between 30 and 300 kg'],
    targetKg: [30, 300, 'Target weight should be between 30 and 300 kg'],
  };
  const SOURCES = [
    { t: 'Mifflin MD et al. 1990, Am J Clin Nutr', s: 'resting energy: 10·kg + 6.25·cm − 5·age (+5 men, −161 women)' },
    { t: 'Activity factors 1.2–1.9', s: 'the WHO/FAO style multipliers used by most calculators' },
    { t: 'Helms ER et al. 2014, JISSN', s: 'lose 0.5–1 % of body weight a week; protein 2.3–3.1 g per kg of lean mass when lean' },
    { t: 'Garthe I et al. 2011, IJSNEM', s: '0.7 %/wk kept strength and lean mass better than 1.4 %/wk' },
    { t: 'Morton RW et al. 2018, BJSM', s: 'protein benefits plateau around 1.6 g/kg, upper range 2.2 g/kg' },
    { t: 'Iraki J et al. 2019, Sports', s: 'gain 0.25–0.5 % of body weight a week when building muscle' },
    { t: '7,700 kcal per kg', s: 'the usual energy value of a kilogram of body weight change' },
  ];

  const isNum = v => v !== null && v !== '' && v !== undefined && isFinite(+v);
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const ms = d => Date.parse(d + 'T00:00:00Z');
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const addDays = (d, n) => iso(ms(d) + Math.round(n) * DAY);
  const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const realDate = s => DATE.test(s || '') && !isNaN(ms(s)) && iso(ms(s)) === s;
  const todayIso = () => { const n = new Date(); return iso(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = (d, ref) => { const t = new Date(ms(d)); return MON[t.getUTCMonth()] + ' ' + t.getUTCDate() + (d.slice(0, 4) !== String(ref || '').slice(0, 4) ? ', ' + d.slice(0, 4) : ''); };
  const r1 = v => Math.round(v * 10) / 10;
  const r2 = v => Math.round(v * 100) / 100;
  const r10 = v => Math.round(v / 10) * 10;
  const r5 = v => Math.round(v / 5) * 5;
  const fk = n => Math.round(+n || 0).toLocaleString('en-US');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const paceOf = (goal, id) => (PACES[goal] || []).find(p => p.id === id) || null;

  function validate(a) {
    const A = a || {}, clean = {}, errors = [];
    if (A.sex === 'male' || A.sex === 'female') clean.sex = A.sex; else errors.push({ field: 'sex', msg: 'Pick male or female (it sets the calorie formula)' });
    Object.keys(LIMITS).forEach(k => {
      if (!isNum(A[k])) { if (k !== 'targetKg') errors.push({ field: k, msg: ({ age: 'Enter your age', heightCm: 'Enter your height in cm', kg: 'Enter your weight in kg' })[k] }); return; }
      const v = +A[k], [lo, hi, msg] = LIMITS[k];
      if (v < lo || v > hi) errors.push({ field: k, msg }); else clean[k] = k === 'age' ? Math.round(v) : r1(v);
    });
    if (ACTIVITY.some(x => x.id === A.activity)) clean.activity = A.activity; else errors.push({ field: 'activity', msg: 'Pick an activity level' });
    if (GOALS.some(g => g.id === A.goal)) clean.goal = A.goal; else errors.push({ field: 'goal', msg: 'Pick a goal' });
    clean.mode = A.mode === 'date' ? 'date' : 'pace';
    if (clean.goal && clean.goal !== 'maintain') {
      if (clean.mode === 'pace') { if (paceOf(clean.goal, A.pace)) clean.pace = A.pace; else errors.push({ field: 'pace', msg: 'Pick a pace' }); }
      else {
        if (realDate(A.endDate)) clean.endDate = A.endDate; else errors.push({ field: 'endDate', msg: 'Pick the date you want to get there' });
        if (clean.targetKg == null) errors.push({ field: 'targetKg', msg: 'A date needs a target weight too' });
      }
      if (clean.targetKg != null && clean.kg != null) {
        if (clean.goal === 'cut' && clean.targetKg >= clean.kg) errors.push({ field: 'targetKg', msg: 'To lose fat the target should be below your weight now' });
        if (clean.goal !== 'cut' && clean.targetKg <= clean.kg) errors.push({ field: 'targetKg', msg: 'To gain the target should be above your weight now' });
      }
    }
    return { clean, errors };
  }

  function bmrOf(a) { return 10 * a.kg + 6.25 * a.heightCm - 5 * a.age + (a.sex === 'male' ? 5 : -161); }
  function activityOf(id) { return ACTIVITY.find(x => x.id === id) || ACTIVITY[2]; }

  function compute(answers, opts) {
    const today = (opts && realDate(opts.today)) ? opts.today : todayIso();
    const v = validate(answers);
    if (v.errors.length) return { ok: false, errors: v.errors };
    const a = v.clean, warnings = [], notes = [];
    const bmr = Math.round(bmrOf(a)), act = activityOf(a.activity), tdee = Math.round(bmr * act.f);
    const dir = a.goal === 'cut' ? -1 : a.goal === 'maintain' ? 0 : 1;
    const floor = Math.max(FLOOR[a.sex], Math.round(tdee * (1 - MAX_DEFICIT)));
    const diffKg = a.targetKg != null ? Math.abs(a.targetKg - a.kg) : null;

    // Weekly rate: from the picked pace, or from the date.
    let ratePct, rateKgWk, paceId = a.pace || null;
    if (dir === 0) { ratePct = 0; rateKgWk = 0; }
    else if (a.mode === 'date') {
      const weeks = Math.max(daysBetween(today, a.endDate), 1) / 7;
      rateKgWk = r2(diffKg / weeks); ratePct = r2(rateKgWk / a.kg * 100);
      const cap = dir < 0 ? 1.0 : 0.5;
      if (ratePct > cap) {
        const safeWeeks = diffKg / (cap / 100 * a.kg);
        warnings.push((dir < 0 ? 'Losing' : 'Gaining') + ' ' + rateKgWk.toFixed(2) + ' kg a week is ' + ratePct.toFixed(1) + ' % of your body weight, above the ' + cap + ' %/wk that the evidence supports' + (dir < 0 ? ' without losing muscle' : ' without gaining mostly fat') + '. The earliest realistic date is about ' + fmtDate(addDays(today, Math.ceil(safeWeeks * 7)), today) + '.');
      } else if (dir < 0 && ratePct < 0.2) notes.push('That is a very gentle pace (under 0.2 % a week). Fine if you like it slow, but weigh-in noise will hide progress for a while.');
    } else {
      const p = paceOf(a.goal, a.pace);
      ratePct = p.pct; rateKgWk = r2(p.pct / 100 * a.kg);
      if (a.goal === 'cut' && p.id === 'extreme') warnings.push('At 1 % a week the risk of losing strength and muscle goes up (Garthe 2011). Keep protein high and lift heavy, and drop to Aggressive if lifts fall.');
    }

    // Calories: TDEE ± the energy of the weekly change, kept above the floor.
    let kcal = r10(tdee + dir * rateKgWk * KCAL_PER_KG / 7), floored = false;
    if (dir < 0 && kcal < floor) {
      floored = true; kcal = r10(floor);
      const realRate = r2((tdee - kcal) / KCAL_PER_KG * 7);
      warnings.push('That pace would need about ' + fk(r10(tdee - rateKgWk * KCAL_PER_KG / 7)) + ' kcal a day, below your safe minimum of ' + fk(kcal) + '. Set to ' + fk(kcal) + ' kcal, which is about ' + realRate.toFixed(2) + ' kg a week instead.');
      rateKgWk = realRate; ratePct = r2(realRate / a.kg * 100);
    }
    const deficit = dir === 0 ? 0 : kcal - tdee;

    // Macros.
    const bmi = a.kg / Math.pow(a.heightCm / 100, 2);
    const proteinKg = bmi > 30 ? r1(30 * Math.pow(a.heightCm / 100, 2)) : a.kg;
    if (bmi > 30) notes.push('Protein is set from ' + proteinKg + ' kg (your weight at a BMI of 30) so the number stays realistic.');
    const proteinPerKg = PROTEIN_PER_KG[a.goal];
    let protein = r5(proteinKg * proteinPerKg);
    let fat = r5(Math.max(kcal * FAT_SHARE / 9, a.kg * FAT_MIN_PER_KG));
    let carbs = r5((kcal - protein * 4 - fat * 9) / 4);
    if (carbs < MIN_CARBS) { fat = r5(Math.max(kcal * 0.2 / 9, a.kg * FAT_MIN_PER_KG)); carbs = Math.max(0, r5((kcal - protein * 4 - fat * 9) / 4)); }
    if (carbs < MIN_CARBS) { protein = r5(Math.max(proteinKg * 1.6, (kcal - fat * 9 - MIN_CARBS * 4) / 4)); carbs = Math.max(0, r5((kcal - protein * 4 - fat * 9) / 4)); notes.push('Calories are tight, so protein sits at the low end of the 1.6–2.2 g/kg range to leave room for carbs.'); }

    // Timeline (linear at the weekly rate; the pace is set from today's weight).
    let weeks = null, endDate = null, milestones = [];
    if (dir !== 0 && a.targetKg != null && rateKgWk > 0) {
      weeks = r1(diffKg / rateKgWk);
      if (weeks > MAX_WEEKS) { weeks = null; notes.push('At this pace the target is more than five years away; set a nearer target.'); }
      else {
        endDate = addDays(today, Math.ceil(weeks * 7));
        const step = diffKg >= 20 ? 10 : 5;
        for (let m = dir < 0 ? Math.floor((a.kg - 0.01) / step) * step : Math.ceil((a.kg + 0.01) / step) * step; dir < 0 ? m > a.targetKg : m < a.targetKg; m += dir * step) {
          milestones.push({ kg: m, date: addDays(today, Math.ceil(Math.abs(m - a.kg) / rateKgWk * 7)) });
        }
        milestones.push({ kg: a.targetKg, date: endDate, final: true });
      }
    }
    if (dir < 0 && !floored && weeks != null && weeks >= 12) notes.push('Plan a one-week diet break at maintenance every 8–12 weeks; the app\'s Diet break card handles it.');
    if (dir > 0) notes.push('Weigh weekly averages, not single days. If the average climbs faster than planned for two weeks, trim 100–150 kcal.');
    if (dir === 0) notes.push('Maintenance is an estimate. After two weeks of logging, the Trend weight card shows your real burn; adjust by 100 kcal if the trend drifts.');

    const profile = { start: today, startKg: a.kg, goalKg: a.targetKg != null ? a.targetKg : a.kg, cutKcal: kcal, maintenance: tdee, protein, fat, kcalFloor: floor };
    return { ok: true, errors: [], today, bmr, tdee, activity: act.id, activityFactor: act.f, goal: a.goal, direction: dir, pace: paceId, mode: a.mode,
      ratePct: r2(ratePct), rateKgWk: r2(rateKgWk), kcal, floor, floored, deficit, protein, fat, carbs, proteinPerKg, proteinKg, bmi: r1(bmi),
      weeks, endDate, milestones, warnings, notes, profile, answers: a };
  }

  function needsRerun(saved, kg) {
    const base = saved && saved.answers && isNum(saved.answers.kg) ? +saved.answers.kg : null;
    return base != null && isNum(kg) && Math.abs(+kg - base) >= 1;
  }

  function compactHtml(saved, opts) {
    const r = saved && saved.result; if (!r || !r.ok || r.direction === 0 && r.goal !== 'maintain') return '';
    const today = (opts && opts.today) || todayIso(), kg = opts && isNum(opts.kg) ? +opts.kg : null;
    if (r.direction < 0) return '';
    if (r.direction === 0) return '<p class="gs-line muted">Maintaining around <b class="num">' + r.profile.goalKg + ' kg</b> at ' + fk(r.kcal) + ' kcal.</p>';
    const goal = r.profile.goalKg, verb = r.direction > 0 ? 'Gain to' : 'Lose to';
    let eta = r.endDate;
    if (kg != null && r.rateKgWk > 0) { const left = r.direction > 0 ? goal - kg : kg - goal; if (left <= 0) return '<p class="gs-line muted">You reached <b class="num">' + goal + ' kg</b>. Time to set the next goal in Settings.</p>'; eta = addDays(today, Math.ceil(left / r.rateKgWk * 7)); }
    return '<p class="gs-line muted">' + verb + ' <b class="num">' + goal + ' kg</b> at ' + r.rateKgWk.toFixed(2) + ' kg a week' + (eta ? ' · about <b>' + fmtDate(eta, today) + '</b>' : '') + '</p>';
  }

  /* ---------------- UI ---------------- */
  const css = `
.gs-wrap{position:fixed;inset:0;z-index:45;background:var(--bg);display:flex;flex-direction:column;animation:fit-fade-in 220ms var(--ease-out,ease-out)}
.gs-head{display:grid;grid-template-columns:44px 1fr 44px;align-items:center;gap:8px;padding:calc(10px + env(safe-area-inset-top,0px)) 8px 6px}
.gs-head .gs-x,.gs-head .gs-back{border:0;background:none;font-size:1.4rem;line-height:1;width:44px;height:44px;border-radius:12px;cursor:pointer;color:var(--ink)}
.gs-head .gs-x:active,.gs-head .gs-back:active{background:var(--sunk)}
.gs-dots{display:flex;justify-content:center;gap:6px}
.gs-dots i{width:8px;height:8px;border-radius:50%;background:var(--line);display:block}
.gs-dots i.on{background:var(--accent);width:22px;border-radius:4px}
.gs-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 16px 16px;display:flex;flex-direction:column;gap:14px;max-width:560px;width:100%;margin:0 auto;box-sizing:border-box}
.gs-body h2{font-size:var(--text-xl,1.6rem);line-height:1.15;margin:6px 0 0;letter-spacing:-.01em}
.gs-body .gs-sub{color:var(--muted);margin:-6px 0 0;font-size:.95rem}
.gs-opts{display:flex;flex-direction:column;gap:8px}
.gs-opt{display:flex;align-items:center;gap:12px;text-align:left;border:1px solid var(--line);background:var(--surface);border-radius:14px;padding:12px 14px;cursor:pointer;color:var(--ink);min-height:56px;width:100%}
.gs-opt b{display:block;font-size:1rem}
.gs-opt small{display:block;color:var(--muted);font-size:.84rem;margin-top:2px}
.gs-opt[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset;background:var(--accent-soft,var(--surface))}
.gs-opt .gs-radio{flex:none;width:20px;height:20px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center}
.gs-opt[aria-pressed="true"] .gs-radio{border-color:var(--accent)}
.gs-opt[aria-pressed="true"] .gs-radio::after{content:"";width:10px;height:10px;border-radius:50%;background:var(--accent)}
.gs-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.gs-grid .field.wide{grid-column:1/-1}
.gs-body .field input,.gs-body .field select{width:100%;font-size:1.1rem;padding:10px 12px;box-sizing:border-box}
.gs-unit{position:relative}
.gs-unit span.u{position:absolute;right:12px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:.9rem;pointer-events:none}
.gs-seg{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.gs-seg .gs-opt{justify-content:center;min-height:48px;padding:10px}
.gs-foot{padding:10px 16px calc(14px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:8px;max-width:560px;width:100%;margin:0 auto;box-sizing:border-box;border-top:1px solid var(--line);background:var(--bg)}
.gs-foot .btn{width:100%;padding:13px 16px;font-size:1.02rem;border-radius:12px}
.gs-foot .gs-skip{border:0;background:none;color:var(--muted);text-decoration:underline;cursor:pointer;padding:8px;font-size:.92rem}
.gs-err{color:var(--bad);font-size:.9rem;margin:0}
.gs-hero{background:var(--surface);border-radius:18px;padding:18px 16px;display:flex;flex-direction:column;gap:4px;box-shadow:var(--shadow-card,none);border:1px solid var(--card-line,transparent)}
.gs-hero .big{font-size:var(--text-2xl,2.4rem);font-weight:800;letter-spacing:-.02em;line-height:1}
.gs-hero .big small{font-size:1rem;font-weight:600;color:var(--muted);margin-left:4px;letter-spacing:0}
.gs-macros{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.gs-macros div{background:var(--surface);border-radius:14px;padding:12px 10px;text-align:center;border:1px solid var(--card-line,transparent)}
.gs-macros b{display:block;font-size:1.25rem}
.gs-macros span{display:block;color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;margin-top:2px}
.gs-macros em{display:block;font-style:normal;color:var(--muted);font-size:.78rem}
.gs-kv{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.gs-kv li{display:flex;justify-content:space-between;gap:12px;font-size:.95rem;padding:8px 0;border-bottom:1px solid var(--line)}
.gs-kv li:last-child{border-bottom:0}
.gs-kv li span:last-child{font-weight:600;text-align:right}
.gs-ms{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
.gs-ms::-webkit-scrollbar{display:none}
.gs-ms div{flex:none;background:var(--surface);border-radius:12px;padding:8px 12px;text-align:center;border:1px solid var(--card-line,transparent)}
.gs-ms b{display:block;font-size:1.05rem}
.gs-ms span{color:var(--muted);font-size:.8rem}
.gs-ms div.final{border-color:var(--accent)}
.gs-cmp{width:100%;border-collapse:collapse;font-size:.92rem}
.gs-cmp th{text-align:left;font-weight:600;color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;padding:4px 0}
.gs-cmp td{padding:7px 0;border-top:1px solid var(--line)}
.gs-cmp td:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}
.gs-cmp td.new{font-weight:700}
.gs-body details{border:1px solid var(--line);border-radius:12px;padding:0 12px}
.gs-body details summary{padding:10px 0;cursor:pointer;font-weight:600;font-size:.95rem}
.gs-body details ul{margin:0 0 12px;padding-left:18px;font-size:.88rem;color:var(--muted)}
.gs-body details li{margin:4px 0}
.gs-line{font-size:.9rem;margin:0}
body:has(.gs-wrap) .bottombar{display:none!important}
.gs-art{width:min(240px,70%);height:auto;margin:4px auto 0;color:var(--ink);display:block;flex:none}
.gs-art .a1{fill:var(--accent);stroke:var(--accent)}
.gs-art .a3{stroke:var(--accent)}
.gs-art .a4{color:var(--muted);opacity:.7}
.gs-art path,.gs-art circle,.gs-art rect{stroke-dasharray:420;stroke-dashoffset:420;animation:gs-draw 900ms var(--ease-out,ease-out) forwards}
.gs-art .a1{animation:gs-draw 900ms var(--ease-out,ease-out) forwards,gs-pop 500ms 500ms var(--ease-out,ease-out) both}
@keyframes gs-draw{to{stroke-dashoffset:0}}
@keyframes gs-pop{from{opacity:0;transform:scale(.6);transform-origin:center;transform-box:fill-box}to{opacity:1;transform:scale(1)}}
.gs-in-r{animation:gs-slide-r 260ms var(--ease-out,ease-out)}
.gs-in-l{animation:gs-slide-l 260ms var(--ease-out,ease-out)}
@keyframes gs-slide-r{from{opacity:0;transform:translateX(18px)}}
@keyframes gs-slide-l{from{opacity:0;transform:translateX(-18px)}}
.gs-rise{animation:gs-rise 360ms calc(var(--i,0) * 45ms) var(--ease-out,ease-out) both}
@keyframes gs-rise{from{opacity:0;transform:translateY(10px)}}
.gs-opt{transition:transform 120ms ease,border-color 160ms ease,background-color 160ms ease}
.gs-opt:active{transform:scale(.985)}
@media (prefers-reduced-motion:reduce){.gs-wrap,.gs-art *,.gs-in-r,.gs-in-l,.gs-rise{animation:none!important;stroke-dashoffset:0}}
`;

  const STEPS = ['about', 'activity', 'goal', 'plan', 'result'];

  // Inline line-art for each step (works offline, follows the theme: strokes in currentColor, fills in the accent).
  const svgWrap = inner => '<svg class="gs-art" viewBox="0 0 240 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  const ART = {
    about: svgWrap('<circle cx="120" cy="38" r="18" class="a1"/><path d="M84 110c4-26 18-38 36-38s32 12 36 38" class="a2"/><path d="M28 96V40M20 48l8-8 8 8M20 88l8 8 8-8" class="a3"/><path d="M186 100h30M186 86h30M186 72h30M186 58h30" class="a4"/><path d="M200 44v-8" class="a4"/>'),
    activity: svgWrap('<circle cx="128" cy="26" r="11" class="a1"/><path d="M118 42l-26 22 14 10 10-12 14 20-6 28" class="a2"/><path d="M118 42l24 8 20-8" class="a2"/><path d="M92 64l-14 30" class="a3"/><path d="M20 108h200" class="a4"/><path d="M160 84c10-6 20-6 30 0M172 70c8-4 16-4 24 0" class="a4"/>'),
    goal: svgWrap('<path d="M30 100h180" class="a4"/><path d="M60 100V52l30-16v64M150 100V70l30-14v44" class="a2"/><circle cx="120" cy="36" r="14" class="a1"/><path d="M120 50v30M108 68l12 12 12-12" class="a3"/>'),
    plan: svgWrap('<rect x="28" y="30" width="100" height="74" rx="10" class="a2"/><path d="M28 50h100M48 22v16M108 22v16" class="a2"/><circle cx="64" cy="72" r="5" class="a1"/><circle cx="88" cy="72" r="5" class="a1"/><circle cx="112" cy="72" r="5" class="a1"/><path d="M150 100c0-28 20-48 42-48s42 20 42 48" class="a2"/><path d="M192 100l24-30" class="a3"/><circle cx="192" cy="100" r="4" class="a1"/>'),
    result: svgWrap('<path d="M24 104h192" class="a4"/><path d="M36 84l34-20 34 10 36-30 34 12 30-24" class="a3"/><circle cx="70" cy="64" r="4" class="a1"/><circle cx="104" cy="74" r="4" class="a1"/><circle cx="140" cy="44" r="4" class="a1"/><circle cx="174" cy="56" r="4" class="a1"/><circle cx="204" cy="32" r="5" class="a1"/><path d="M190 18h28v28" class="a2"/>'),
  };

  function open(o) {
    const opts = o || {}, doc = (opts.document || (typeof document !== 'undefined' ? document : null));
    if (!doc) return null;
    const today = realDate(opts.today) ? opts.today : todayIso();
    const existing = opts.existing || null;                       // {profile, targets} of the current plan, if any
    const a = Object.assign({ mode: 'pace' }, opts.answers || {});
    let step = 0, errs = [], result = null;
    const el = doc.createElement('div'); el.className = 'gs-wrap'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Goal setup');
    let unBack = null;

    const steps = () => a.goal === 'maintain' ? STEPS.filter(s => s !== 'plan') : STEPS;
    const dots = () => '<div class="gs-dots" aria-hidden="true">' + steps().map((s, i) => '<i class="' + (i <= step ? 'on' : '') + '"></i>').join('') + '</div>';
    const opt = (key, id, label, sub) => '<button type="button" class="gs-opt" data-gs="pick" data-k="' + key + '" data-v="' + esc(id) + '" aria-pressed="' + String(a[key] === id) + '"><span class="gs-radio"></span><span><b>' + esc(label) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></button>';
    const field = (key, label, unit, attrs, cls) => '<label class="field ' + (cls || '') + '"><span class="label">' + label + '</span><span class="gs-unit"><input data-gs-f="' + key + '" ' + attrs + ' value="' + esc(a[key] == null ? '' : a[key]) + '">' + (unit ? '<span class="u">' + unit + '</span>' : '') + '</span></label>';
    const errFor = k => { const e = errs.find(x => x.field === k); return e ? '<p class="gs-err">' + esc(e.msg) + '</p>' : ''; };

    function readInputs() { el.querySelectorAll('[data-gs-f]').forEach(i => { const k = i.dataset.gsF, v = i.value.trim(); a[k] = v === '' ? undefined : (k === 'endDate' ? v : +v); }); }

    function body() {
      const s = steps()[step];
      if (s === 'about') return '<h2>' + (opts.firstRun ? 'Let’s set your targets' : 'About you') + '</h2><p class="gs-sub">' + (opts.firstRun ? 'A minute of questions, then the app works out your calories, protein and a realistic timeline. Nothing is shared.' : 'The calorie formula needs these four.') + '</p>'
        + '<div class="gs-seg">' + opt('sex', 'male', 'Male') + opt('sex', 'female', 'Female') + '</div>' + errFor('sex')
        + '<div class="gs-grid">' + field('age', 'Age', 'years', 'type="number" inputmode="numeric" min="13" max="100" step="1" placeholder="30"') + field('heightCm', 'Height', 'cm', 'type="number" inputmode="decimal" min="120" max="230" step="0.5" placeholder="170"')
        + field('kg', 'Weight today', 'kg', 'type="number" inputmode="decimal" min="30" max="300" step="0.1" placeholder="75.0"', 'wide') + '</div>' + errFor('age') + errFor('heightCm') + errFor('kg');
      if (s === 'activity') return '<h2>How active are you?</h2><p class="gs-sub">Count your job and your training together. Most people who lift 4–5 days and sit the rest of the day are "Active".</p><div class="gs-opts">' + ACTIVITY.map(x => opt('activity', x.id, x.label, x.sub)).join('') + '</div>' + errFor('activity');
      if (s === 'goal') return '<h2>What do you want?</h2><div class="gs-opts">' + GOALS.map(g => opt('goal', g.id, g.label, g.sub)).join('') + '</div>' + errFor('goal');
      if (s === 'plan') {
        const dir = a.goal === 'cut' ? 'lose' : 'gain', paces = PACES[a.goal] || [];
        const kgNow = isNum(a.kg) ? +a.kg : null;
        return '<h2>How fast?</h2><p class="gs-sub">The pace is a share of your body weight a week; the calories follow from it.' + (kgNow ? ' At ' + kgNow + ' kg, 0.5 % is ' + r2(kgNow * 0.005).toFixed(2) + ' kg a week.' : '') + '</p>'
          + '<div class="gs-seg">' + opt('mode', 'pace', 'Pick a pace') + opt('mode', 'date', 'I have a date') + '</div>'
          + (a.mode === 'date' ? '' : '<div class="gs-opts">' + paces.map(p => opt('pace', p.id, p.label, p.sub)).join('') + '</div>' + errFor('pace'))
          + '<div class="gs-grid">' + field('targetKg', (a.mode === 'date' ? 'Target weight' : 'Target weight (optional)'), 'kg', 'type="number" inputmode="decimal" min="30" max="300" step="0.1" placeholder="' + (kgNow ? (a.goal === 'cut' ? Math.round(kgNow * 0.9) : Math.round(kgNow * 1.05)) : '') + '"', a.mode === 'date' ? '' : 'wide')
          + (a.mode === 'date' ? field('endDate', 'By when', '', 'type="date" min="' + addDays(today, 7) + '"') : '') + '</div>' + errFor('targetKg') + errFor('endDate')
          + '<p class="gs-line muted">' + (a.mode === 'date' ? 'The app works out the weekly pace your date needs and tells you if it is faster than the evidence supports.' : 'Without a target weight you still get calories and macros, just no end date. You can ' + dir + ' toward a target later from Settings.') + '</p>';
      }
      return resultHtml();
    }

    function resultHtml() {
      result = compute(a, { today });
      if (!result.ok) { errs = result.errors; return '<h2>Something is missing</h2><ul class="gs-kv">' + errs.map(e => '<li><span>' + esc(e.msg) + '</span></li>').join('') + '</ul>'; }
      const r = result, g = GOALS.find(x => x.id === r.goal), pct = v => Math.round(v * 100 / r.kcal);
      const pace = r.direction === 0 ? 'Hold your weight' : (r.direction < 0 ? 'Lose' : 'Gain') + ' about <b>' + r.rateKgWk.toFixed(2) + ' kg a week</b> (' + r.ratePct.toFixed(2).replace(/0$/, '') + ' % of body weight)';
      const cur = existing && existing.targets ? existing.targets : null;
      const cmpRow = (l, was, now, unit) => '<tr><td>' + l + '</td><td>' + (was == null ? '—' : fk(was) + unit) + '</td><td class="new">' + fk(now) + unit + '</td></tr>';
      const changed = cur && [['kcal', r.kcal], ['proteinMin', r.protein], ['goalKg', r.profile.goalKg]].some(([k, v]) => cur[k] != null && Math.round(cur[k]) !== Math.round(v));
      return '<h2>Your plan</h2><p class="gs-sub">' + esc(g.label) + ' · ' + pace + '</p>'
        + '<div class="gs-hero"><span class="label">Daily calories</span><div class="big num">' + fk(r.kcal) + '<small>kcal</small></div><p class="gs-line muted">Maintenance about <b class="num">' + fk(r.tdee) + '</b> kcal (resting ' + fk(r.bmr) + ' × ' + r.activityFactor + ')' + (r.deficit ? ', so ' + (r.deficit < 0 ? 'a ' + fk(-r.deficit) + ' kcal deficit' : 'a ' + fk(r.deficit) + ' kcal surplus') : '') + '.' + (r.floored ? ' Kept at your safe minimum.' : '') + '</p></div>'
        + '<div class="gs-macros"><div><b class="num">' + r.protein + ' g</b><span>Protein</span><em>' + r.proteinPerKg + ' g/kg · ' + pct(r.protein * 4) + ' %</em></div><div><b class="num">' + r.fat + ' g</b><span>Fat</span><em>' + pct(r.fat * 9) + ' %</em></div><div><b class="num">' + r.carbs + ' g</b><span>Carbs</span><em>' + pct(r.carbs * 4) + ' %</em></div></div>'
        + (r.endDate ? '<div><span class="label">Projected</span><p class="gs-line" style="margin-top:4px">Reach <b>' + r.profile.goalKg + ' kg</b> around <b>' + fmtDate(r.endDate, today) + '</b>, about ' + Math.round(r.weeks) + ' weeks' + (r.weeks >= 9 ? ' (' + r1(r.weeks / 4.345).toFixed(1).replace(/\.0$/, '') + ' months)' : '') + '.</p>'
          + (r.milestones.length > 1 ? '<div class="gs-ms">' + r.milestones.map(m => '<div class="' + (m.final ? 'final' : '') + '"><b class="num">' + m.kg + ' kg</b><span>' + fmtDate(m.date, today) + '</span></div>').join('') + '</div>' : '') + '</div>' : '')
        + r.warnings.map(w => '<p class="note">' + esc(w) + '</p>').join('') + r.notes.map(n => '<p class="note info">' + esc(n) + '</p>').join('')
        + (cur ? '<div><span class="label">' + (changed ? 'Compared with your current numbers' : 'Same as your current numbers') + '</span><table class="gs-cmp"><tr><th></th><th>Now</th><th>New</th></tr>' + cmpRow('Calories', cur.kcal, r.kcal, '') + cmpRow('Protein', cur.proteinMin, r.protein, ' g') + cmpRow('Fat', cur.fatLo != null && cur.fatHi != null ? (cur.fatLo + cur.fatHi) / 2 : null, r.fat, ' g') + cmpRow('Goal weight', cur.goalKg, r.profile.goalKg, ' kg') + '</table><p class="gs-line muted" style="margin-top:6px">Nothing changes until you tap "Use these numbers". Your history is never touched.</p></div>' : '')
        + '<details><summary>How this is worked out</summary><ul>' + SOURCES.map(s => '<li><b>' + esc(s.t) + '</b>: ' + esc(s.s) + '</li>').join('') + '<li>The weekly pace is set from your weight today; re-run this when your weight has moved a kilo or more and the app offers it after a weigh-in.</li></ul></details>';
    }

    function foot() {
      const s = steps()[step], last = s === 'result';
      if (last) return (result && result.ok ? '<button type="button" class="btn" data-gs="apply">Use these numbers</button>' : '') + '<button type="button" class="btn ghost" data-gs="back">Change my answers</button>' + (existing ? '<button type="button" class="gs-skip" data-gs="close">Keep my current numbers</button>' : '');
      return '<button type="button" class="btn" data-gs="next">' + (steps()[step + 1] === 'result' ? 'See my plan' : 'Next') + '</button>' + (opts.firstRun && step === 0 ? '<button type="button" class="gs-skip" data-gs="skip">Skip for now</button>' : '');
    }

    function paint() {
      el.innerHTML = '<div class="gs-head">' + (step > 0 ? '<button type="button" class="gs-back" data-gs="back" aria-label="Back">‹</button>' : '<span></span>') + dots() + '<button type="button" class="gs-x" data-gs="close" aria-label="Close">×</button></div>'
        + '<div class="gs-body ' + (dirCls || '') + '">' + (ART[steps()[step]] || '') + body() + '</div><div class="gs-foot">' + foot() + '</div>';
      dirCls = '';
      const b = el.querySelector('.gs-body'); if (b) b.scrollTop = 0;
      el.querySelectorAll('.gs-opt, .gs-hero, .gs-macros > div, .gs-ms > div, .gs-cmp, .note').forEach((n, i) => { n.classList.add('gs-rise'); n.style.setProperty('--i', String(Math.min(i, 8))); });
      const big = el.querySelector('.gs-hero .big'); if (big && result && result.ok && !reduced(doc)) countUp(big, result.kcal);
    }
    let dirCls = '';
    function reduced(d) { try { return d.defaultView && d.defaultView.matchMedia && d.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
    function countUp(node, to) {
      const small = node.querySelector('small'), t0 = Date.now(), dur = 700, from = Math.max(0, to - 400);
      const tick = () => { const p = Math.min(1, (Date.now() - t0) / dur), e = 1 - Math.pow(1 - p, 3); node.firstChild.nodeValue = fk(from + (to - from) * e); if (p < 1) doc.defaultView.requestAnimationFrame(tick); };
      node.firstChild.nodeValue = fk(from); if (small) node.appendChild(small); tick();
    }

    function stepErrors() {
      const s = steps()[step], all = validate(a).errors;
      const keys = { about: ['sex', 'age', 'heightCm', 'kg'], activity: ['activity'], goal: ['goal'], plan: ['pace', 'targetKg', 'endDate'] }[s] || [];
      return all.filter(e => keys.includes(e.field));
    }

    function close(reason) {
      if (unBack) { try { unBack(); } catch (e) { } unBack = null; }
      if (el.parentNode) el.parentNode.removeChild(el);
      if (reason === 'skip' && opts.onSkip) opts.onSkip();
      if (opts.onClose) opts.onClose(reason || 'close');
    }

    el.addEventListener('click', e => {
      const t = e.target.closest('[data-gs]'); if (!t) return;
      const act = t.dataset.gs;
      if (act === 'pick') { readInputs(); a[t.dataset.k] = t.dataset.v; if (t.dataset.k === 'goal') { a.pace = undefined; } errs = errs.filter(x => x.field !== t.dataset.k); paint(); return; }
      if (act === 'next') { readInputs(); errs = stepErrors(); if (errs.length) { paint(); return; } if (a.goal === 'maintain') { a.pace = undefined; a.mode = 'pace'; a.targetKg = a.kg; a.endDate = undefined; } step = Math.min(step + 1, steps().length - 1); dirCls = 'gs-in-r'; paint(); return; }
      if (act === 'back') { readInputs(); errs = []; step = Math.max(0, step - 1); dirCls = 'gs-in-l'; paint(); return; }
      if (act === 'skip') { close('skip'); return; }
      if (act === 'close') { close('close'); return; }
      if (act === 'apply') { if (result && result.ok) { if (opts.onApply) opts.onApply(result, Object.assign({}, a)); close('apply'); } return; }
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); const n = el.querySelector('[data-gs="next"]'); if (n) n.click(); } });

    paint();
    (opts.mount || doc.body).appendChild(el);
    if (opts.onBack) { try { unBack = opts.onBack(() => { if (step > 0) { const b = el.querySelector('[data-gs="back"]'); if (b) b.click(); } else close('close'); return true; }); } catch (e) { } }
    return { el, close: () => close('close'), state: () => Object.assign({ step }, a) };
  }

  return { compute, validate, needsRerun, compactHtml, open, css, ACTIVITY, GOALS, PACES, SOURCES, PROTEIN_PER_KG, FLOOR };
});
