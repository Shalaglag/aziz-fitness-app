/*
 * Milestones: small, once-only celebrations for weight milestones reached on the trend, strength round numbers
 * and consistency (workouts logged, food-logging streaks), for cut, gain and maintenance plans.
 * Plain JS, no imports, no network. Browser global (window.Milestones) or CommonJS.
 *
 *   Milestones.detect(docs, {today, plan, trend, lifts, seen, workoutDates})
 *     plan   = prefs/main.goalSetup {answers, result:{direction, milestones:[{kg, date, final}], answers:{kg}, today}}
 *     trend  = TrendTDEE.series(weights, {today}) → [{date, kg, trend}]
 *     lifts  = StrengthAnalytics.analyze(...).lifts → [{name, unit, points:[{date, e1rm}]}]
 *     seen   = prefs/main.milestones {id: dateMarked}
 *     -> {all:[item], fresh:[item], next:[item]}   item = {id, kind, title, text, date, emoji}
 *        fresh = reached within the last FRESH_DAYS days and not yet in `seen` (the ones to celebrate now);
 *        anything older is recorded quietly (an install with history never gets a burst of old toasts).
 *   Milestones.mark(seen, items, today)  -> new seen map
 *   Milestones.html(R, {today})           -> compact card: latest reached + what is next
 *   Milestones.toastText(item)           -> one line for a toast
 *
 * Rules
 *   - A weight milestone counts only when the trend line (not a single weigh-in) has been at or past the number
 *     for SUSTAIN consecutive trend days; the date is the first of those days. Direction follows the plan.
 *   - A maintenance plan gets "N weeks steady" every 4 weeks the trend stayed within ±1 kg of the plan weight.
 *   - Strength: a lift's estimated 1RM crossing a round number (every 20 kg from 40; 50 lb from 100 for lb lifts).
 *   - Consistency: workouts logged in total (10, 25, 50, 100, 150, 200, 300, 500) and days in a row with food
 *     logged (7, 14, 30, 60, 100, 200, 365).
 *   - Each id fires once; `seen` is the record. Animation is CSS only and off under prefers-reduced-motion.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Milestones = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 864e5, SUSTAIN = 3, FRESH_DAYS = 3, STEADY_WEEKS = 4, STEADY_BAND = 1;
  const WORKOUT_COUNTS = [10, 25, 50, 100, 150, 200, 300, 500];
  const FOOD_STREAKS = [7, 14, 30, 60, 100, 200, 365];
  const ms = d => Date.parse(d + 'T00:00:00Z');
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const addDays = (d, n) => iso(ms(d) + Math.round(n) * DAY);
  const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const todayIso = () => { const n = new Date(); return iso(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmt = d => { const t = new Date(ms(d)); return MON[t.getUTCMonth()] + ' ' + t.getUTCDate(); };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const isNum = v => typeof v === 'number' && isFinite(v);
  const r1 = v => Math.round(v * 10) / 10;

  function planOk(plan) { return !!(plan && plan.result && plan.result.ok); }

  // Weight milestones from the plan, reached on the trend for SUSTAIN days.
  function weightItems(plan, trend, today) {
    const out = [], next = [];
    if (!planOk(plan) || !Array.isArray(trend) || !trend.length) return { out, next };
    const r = plan.result, dir = r.direction, since = isDate(r.today) ? r.today : null;
    const ser = trend.filter(x => x && isDate(x.date) && isNum(x.trend) && x.date <= today && (!since || x.date >= since));
    if (dir === 0) {
      const kg0 = r.answers && isNum(r.answers.kg) ? r.answers.kg : null;
      if (kg0 == null || !since) return { out, next };
      const weeks = Math.floor(daysBetween(since, today) / 7);
      for (let w = STEADY_WEEKS; w <= weeks; w += STEADY_WEEKS) {
        const end = addDays(since, w * 7), win = ser.filter(x => x.date <= end && x.date > addDays(end, -w * 7));
        if (win.length >= w * 3 && win.every(x => Math.abs(x.trend - kg0) <= STEADY_BAND)) out.push({ id: 'steady:' + w, kind: 'steady', emoji: '⚖️', date: end, title: w + ' weeks steady', text: 'Your trend weight stayed within a kilo of ' + kg0 + ' kg for ' + w + ' weeks. That is maintenance working.' });
      }
      const nw = (Math.floor(weeks / STEADY_WEEKS) + 1) * STEADY_WEEKS;
      next.push({ kind: 'steady', title: nw + ' weeks steady', text: 'on ' + fmt(addDays(since, nw * 7)) + ' if the trend stays within a kilo' });
      return { out, next };
    }
    const past = (t, kg) => dir < 0 ? t <= kg : t >= kg;
    (r.milestones || []).forEach(m => {
      if (!isNum(m.kg)) return;
      let run = 0, hit = null;
      for (const x of ser) { if (past(x.trend, m.kg)) { run++; if (run === SUSTAIN) { hit = ser[ser.indexOf(x) - SUSTAIN + 1].date; break; } } else run = 0; }
      if (hit) out.push({ id: 'kg:' + m.kg, kind: 'weight', emoji: m.final ? '🏁' : '🎯', date: hit, title: m.final ? 'Goal reached: ' + m.kg + ' kg' : m.kg + ' kg on the trend', text: (m.final ? 'Your trend weight has been at ' + m.kg + ' kg for ' + SUSTAIN + ' days. ' : 'Three days with the trend ' + (dir < 0 ? 'under' : 'over') + ' ' + m.kg + ' kg. ') + (isDate(m.date) ? (hit <= m.date ? 'Planned for ' + fmt(m.date) + ', so you are on or ahead of plan.' : 'Planned for ' + fmt(m.date) + '; later than planned still counts.') : '') });
      else if (!next.length) { const now = ser.length ? ser[ser.length - 1].trend : null; next.push({ kind: 'weight', title: m.kg + ' kg', text: now != null ? r1(Math.abs(now - m.kg)) + ' kg to go on the trend' + (isDate(m.date) ? ', planned around ' + fmt(m.date) : '') : (isDate(m.date) ? 'planned around ' + fmt(m.date) : '') }); }
    });
    return { out, next };
  }

  // Strength round numbers from est. 1RM points.
  function strengthItems(lifts, today) {
    const out = [];
    (Array.isArray(lifts) ? lifts : []).forEach(l => {
      const pts = (l && Array.isArray(l.points) ? l.points : []).filter(p => p && isDate(p.date) && isNum(p.e1rm) && p.date <= today).sort((a, b) => a.date < b.date ? -1 : 1);
      if (pts.length < 2) return;
      const lb = l.unit === 'lb', step = lb ? 50 : 20, start = lb ? 100 : 40, toUnit = v => lb ? v / 0.45359237 : v;
      const first = toUnit(pts[0].e1rm), best = Math.max.apply(null, pts.map(p => toUnit(p.e1rm)));
      for (let t = start; t <= best; t += step) {
        if (t <= first) continue;                               // already there on day one: nothing new to celebrate
        const p = pts.find(x => toUnit(x.e1rm) >= t);
        out.push({ id: 'lift:' + String(l.name).toLowerCase().replace(/[^a-z0-9]+/g, '-') + ':' + t, kind: 'strength', emoji: '🏋️', date: p.date, title: l.name + ': ' + t + ' ' + (lb ? 'lb' : 'kg') + ' est. 1RM', text: 'Your best set on ' + fmt(p.date) + ' works out to ' + Math.round(toUnit(p.e1rm)) + ' ' + (lb ? 'lb' : 'kg') + ' for one rep (Epley).' });
      }
    });
    return out;
  }

  function workoutDatesOf(docs, extra) {
    const set = new Set(Array.isArray(extra) ? extra.filter(isDate) : []);
    Object.entries((docs && docs.workouts) || {}).forEach(([d, w]) => { if (isDate(d) && w && w.sets && Object.values(w.sets).some(a => Array.isArray(a) && a.some(s => s && (s.w || s.r)))) set.add(d); });
    Object.values((docs && docs.lb_workouts) || {}).forEach(w => { if (w && w.start) { const t = typeof w.start === 'number' ? w.start : Date.parse(w.start); if (isFinite(t)) set.add(new Date(t).toISOString().slice(0, 10)); } });
    return [...set].sort();
  }

  function consistencyItems(docs, today, workoutDates) {
    const out = [], next = [];
    const wd = workoutDatesOf(docs, workoutDates).filter(d => d <= today);
    WORKOUT_COUNTS.forEach(n => { if (wd.length >= n) out.push({ id: 'workouts:' + n, kind: 'consistency', emoji: '💪', date: wd[n - 1], title: n + ' workouts logged', text: 'Workout number ' + n + ' went in on ' + fmt(wd[n - 1]) + '. Showing up is the whole game.' }); });
    const nn = WORKOUT_COUNTS.find(n => wd.length < n); if (nn) next.push({ kind: 'consistency', title: nn + ' workouts', text: (nn - wd.length) + ' to go' });
    // food-logging streak ending today or yesterday
    const days = (docs && docs.days) || {};
    const logged = d => { const day = days[d]; return !!(day && Array.isArray(day.food) && day.food.some(f => f && f.eaten !== false && (+f.kcal > 0 || f.name))); };
    let end = logged(today) ? today : addDays(today, -1), run = 0, d = end;
    while (logged(d) && run < 2000) { run++; d = addDays(d, -1); }
    FOOD_STREAKS.forEach(n => { if (run >= n) out.push({ id: 'food:' + n + ':' + addDays(end, -(run - 1)), kind: 'consistency', emoji: '📒', date: addDays(end, -(run - 1) + (n - 1)), title: n + ' days of food logged in a row', text: 'Every day since ' + fmt(addDays(end, -(run - 1))) + '. Consistent logging is what makes the plan checks trustworthy.' }); });
    const fn = FOOD_STREAKS.find(n => run < n); if (fn && run > 0) next.push({ kind: 'consistency', title: fn + '-day logging streak', text: 'day ' + run + ' now' });
    return { out, next };
  }

  function detect(docs, opts) {
    const o = opts || {}, today = isDate(o.today) ? o.today : todayIso(), seen = o.seen && typeof o.seen === 'object' ? o.seen : {};
    const w = weightItems(o.plan, o.trend, today), c = consistencyItems(docs, today, o.workoutDates), s = strengthItems(o.lifts, today);
    const all = w.out.concat(s, c.out).filter(it => it.date <= today).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
    const fresh = all.filter(it => !seen[it.id] && daysBetween(it.date, today) <= FRESH_DAYS);
    return { today, all, fresh, unseen: all.filter(it => !seen[it.id]), next: w.next.concat(c.next).slice(0, 3) };
  }

  function mark(seen, items, today) {
    const out = Object.assign({}, seen || {}), t = isDate(today) ? today : todayIso();
    (items || []).forEach(it => { if (it && it.id && !out[it.id]) out[it.id] = t; });
    return out;
  }

  const toastText = it => it ? (it.emoji ? it.emoji + ' ' : '') + it.title : '';

  function html(R, opts) {
    const o = opts || {};
    if (!R) return '';
    const recent = R.all.slice(0, o.max || 4);
    if (!recent.length && !R.next.length) return '';
    const li = it => '<li class="ms-' + it.kind + (R.fresh.some(f => f.id === it.id) ? ' ms-new' : '') + '"><span class="ms-ic" aria-hidden="true">' + (it.emoji || '•') + '</span><div><b>' + esc(it.title) + '</b> <small>' + esc(fmt(it.date)) + '</small><p>' + esc(it.text) + '</p></div></li>';
    return '<div class="card ms-card"><div class="spread"><h3>Milestones</h3><span class="muted" style="font-size:.85rem">' + (R.all.length ? R.all.length + ' reached' : 'none yet') + '</span></div>'
      + (recent.length ? '<ul class="ms-list">' + recent.map(li).join('') + '</ul>' : '')
      + (R.next.length ? '<p class="muted ms-next"><b>Next up:</b> ' + R.next.map(n => esc(n.title) + (n.text ? ' (' + esc(n.text) + ')' : '')).join(' · ') + '</p>' : '') + '</div>';
  }

  const css = '.ms-list{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}.ms-list li{display:flex;gap:10px;align-items:flex-start}.ms-ic{flex:none;width:30px;height:30px;border-radius:50%;background:var(--sunk);display:grid;place-items:center;font-size:1rem}.ms-list b{font-size:.95rem}.ms-list small{color:var(--muted);font-size:.78rem;margin-left:4px}.ms-list p{margin:2px 0 0;font-size:.86rem;color:var(--muted);line-height:1.4}.ms-next{font-size:.86rem;margin:10px 0 0}'
    + '@media (prefers-reduced-motion:no-preference){.ms-new .ms-ic{animation:ms-pop .6s cubic-bezier(.2,1.4,.4,1) 1}@keyframes ms-pop{0%{transform:scale(.4);opacity:0}100%{transform:scale(1);opacity:1}}}';

  return { detect, mark, html, toastText, css, SUSTAIN, FRESH_DAYS, WORKOUT_COUNTS, FOOD_STREAKS };
});
