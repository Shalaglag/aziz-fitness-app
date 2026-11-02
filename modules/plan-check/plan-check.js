/*
 * PlanCheck: the two-week plan re-check and the weekly "vs plan" line.
 * Plain JS, no imports, no network. Browser global (window.PlanCheck) or CommonJS.
 * Generic: everything comes from the saved goal plan (prefs/main.goalSetup) and the host's data.
 *
 *   PlanCheck.recheck(docs, {today, plan, targets, tdee, compute})
 *     plan    = prefs/main.goalSetup {answers, result, at, recheck?}
 *     targets = AppTargets.resolve(...) (current numbers)
 *     tdee    = TrendTDEE.estimate(...) (trend weight + estimated burn)
 *     compute = GoalSetup.compute (so the proposal uses the same maths as the questionnaire)
 *     -> {status:'none'|'waiting'|'ready'|'decided', reasons[], since, nextAt,
 *         estimate:{kcal, lo, hi}, formulaTdee, currentKcal, proposed, delta, verdict:'keep'|'offer', window}
 *   PlanCheck.html(R, {canApply})            -> card HTML with data-pc="apply|keep|later" buttons
 *   PlanCheck.decide(plan, R, decision, today) -> the new plan object to save (and profile fields when applied)
 *   PlanCheck.weekLine(docs, {today, plan, trend}) -> [cls, label, text] for the weekly report, or null
 *
 * Rules
 *   - A check is offered 14+ days after the plan (or the last decision), only when the trend estimate is
 *     ready (14+ days, 10+ logged food days, 8+ weigh-ins), food is logged on 65 %+ of the days and the
 *     burn range is under ±250 kcal. Otherwise it says what is missing and waits.
 *   - The estimate is labelled an estimate with its range; it never claims a "real burn".
 *   - A difference under 100 kcal is within noise: the card says "keep" and offers no change.
 *   - Nothing changes until the person taps "Use N kcal". "Keep" and "Ask again in a week" are always there.
 *   - Weekly line: compares the 14-day trend change (7-day when that is all there is) with the plan's pace.
 *     Needs 4+ weigh-ins in the week. One slow or fast week never changes targets by itself.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanCheck = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 864e5, INTERVAL = 14, LATER = 7, MIN_FOOD_SHARE = 0.65, MAX_BAND = 250, NOISE_KCAL = 100;
  const ms = d => Date.parse(d + 'T00:00:00Z');
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const addDays = (d, n) => iso(ms(d) + Math.round(n) * DAY);
  const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const todayIso = () => { const n = new Date(); return iso(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmt = d => { const t = new Date(ms(d)); return MON[t.getUTCMonth()] + ' ' + t.getUTCDate(); };
  const fk = n => Math.round(+n || 0).toLocaleString('en-US');
  const r10 = v => Math.round(v / 10) * 10;
  const r1 = v => Math.round(v * 10) / 10;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const isNum = v => typeof v === 'number' && isFinite(v);

  function planOk(plan) { return !!(plan && plan.answers && plan.result && plan.result.ok); }
  function sinceDate(plan) {
    const rc = plan.recheck;
    if (rc && isDate((rc.at || '').slice(0, 10))) return rc.at.slice(0, 10);
    if (plan.result && isDate(plan.result.today)) return plan.result.today;
    return isDate((plan.at || '').slice(0, 10)) ? plan.at.slice(0, 10) : null;
  }

  function recheck(docs, opts) {
    const o = opts || {}, today = isDate(o.today) ? o.today : todayIso(), plan = o.plan;
    const R = { status: 'none', reasons: [], today, since: null, nextAt: null, estimate: null, formulaTdee: null, currentKcal: null, proposed: null, delta: null, verdict: null, window: null };
    if (!planOk(plan)) return R;
    R.since = sinceDate(plan);
    R.formulaTdee = plan.result.tdee;
    R.currentKcal = o.targets && isNum(o.targets.kcal) ? o.targets.kcal : plan.result.kcal;
    const rc = plan.recheck || null;
    if (rc && rc.decision === 'later' && isDate(rc.nextAt) && today < rc.nextAt) { R.status = 'waiting'; R.nextAt = rc.nextAt; R.reasons.push('You asked to be reminded on ' + fmt(rc.nextAt) + '.'); return R; }
    if (rc && rc.decision && rc.decision !== 'later' && R.since && daysBetween(R.since, today) < INTERVAL) {
      R.status = 'decided'; R.nextAt = addDays(R.since, INTERVAL); R.decision = rc;
      return R;
    }
    if (R.since && daysBetween(R.since, today) < INTERVAL) {
      R.status = 'waiting'; R.nextAt = addDays(R.since, INTERVAL);
      const left = INTERVAL - daysBetween(R.since, today);
      R.reasons.push('The first check comes two weeks into the plan: ' + left + ' more day' + (left === 1 ? '' : 's') + ', on ' + fmt(R.nextAt) + '.');
      return R;
    }
    const E = o.tdee;
    if (!E || !E.ready) {
      R.status = 'waiting';
      R.reasons.push((E && E.notes && E.notes.length) ? E.notes[0] : 'Needs 14 days of weigh-ins and logged food to estimate your burn.');
      return R;
    }
    R.window = { from: E.from, to: E.to, days: E.days, foodDays: E.foodDays, weighIns: E.weighIns };
    if (E.days && E.foodDays / E.days < MIN_FOOD_SHARE) {
      R.status = 'waiting';
      R.reasons.push('Food was logged on ' + E.foodDays + ' of the last ' + E.days + ' days. The estimate needs most days logged; unlogged days make the burn read too low.');
      return R;
    }
    const band = (E.tdeeHi - E.tdeeLo) / 2;
    if (band > MAX_BAND) {
      R.status = 'waiting';
      R.reasons.push('Weigh-ins swing too much over this window (±' + fk(band) + ' kcal on the estimate). A few more consistent morning weigh-ins will narrow it.');
      return R;
    }
    R.status = 'ready';
    R.estimate = { kcal: r10(E.tdee), lo: r10(E.tdeeLo), hi: r10(E.tdeeHi), rateKgWk: E.rateKgWk != null ? r1(E.rateKgWk * -1) : null, trendNow: E.trendNow != null ? r1(E.trendNow) : null };
    if (typeof o.compute === 'function') {
      const a = Object.assign({}, plan.answers);
      if (R.estimate.trendNow) a.kg = R.estimate.trendNow;
      const p = o.compute(a, { today, maintenance: R.estimate.kcal });
      if (p && p.ok) { R.proposed = p; R.delta = p.kcal - R.currentKcal; }
    }
    R.verdict = R.proposed && Math.abs(R.delta) >= NOISE_KCAL ? 'offer' : 'keep';
    return R;
  }

  // The plan object to store after a tap. 'apply' also returns the profile fields to merge.
  function decide(plan, R, decision, today) {
    const t = isDate(today) ? today : todayIso();
    const out = { plan: Object.assign({}, plan), profile: null };
    const rec = { at: t, decision, estimate: R && R.estimate ? R.estimate.kcal : null, estimateLo: R && R.estimate ? R.estimate.lo : null, estimateHi: R && R.estimate ? R.estimate.hi : null };
    if (decision === 'later') rec.nextAt = addDays(t, LATER);
    if (decision === 'apply' && R && R.proposed) {
      const p = R.proposed;
      out.plan.answers = Object.assign({}, plan.answers, { kg: p.answers.kg });
      out.plan.result = Object.assign({}, p, { today: plan.result.today || p.today });   // keep the plan's start date
      // Start date and start weight stay: the plan continues, its calories move.
      out.profile = { cutKcal: p.kcal, maintenance: p.tdee, protein: p.protein, fat: p.fat, kcalFloor: p.floor };
      rec.from = R.currentKcal; rec.to = p.kcal;
    }
    out.plan.recheck = rec;
    return out;
  }

  function html(R, opts) {
    const o = opts || {};
    if (!R || R.status === 'none') return '';
    const head = '<div class="spread"><h3>Plan check</h3><span class="muted" style="font-size:.85rem">every two weeks</span></div>';
    if (R.status === 'waiting') return '<div class="card pc-card">' + head + '<p class="muted" style="font-size:.92rem">' + esc(R.reasons[0] || '') + '</p></div>';
    if (R.status === 'decided') {
      const d = R.decision, what = d.decision === 'apply' ? 'changed to ' + fk(d.to) + ' kcal' : 'kept ' + fk(R.currentKcal) + ' kcal';
      return '<div class="card pc-card">' + head + '<p class="muted" style="font-size:.92rem">Checked ' + fmt(d.at.slice(0, 10)) + ': estimated maintenance ' + (d.estimate ? fk(d.estimate) + ' kcal' : 'n/a') + ', you ' + what + '. Next check ' + fmt(R.nextAt) + '.</p></div>';
    }
    const E = R.estimate, diff = E.kcal - R.formulaTdee;
    const est = '<div class="pc-stats"><div><span class="label">Estimated maintenance</span><b class="num">' + fk(E.kcal) + '</b><small>about ' + fk(E.lo) + '–' + fk(E.hi) + ' kcal, from ' + R.window.foodDays + ' logged days and ' + R.window.weighIns + ' weigh-ins</small></div>'
      + '<div><span class="label">Formula said</span><b class="num">' + fk(R.formulaTdee) + '</b><small>' + (Math.abs(diff) < 50 ? 'the same within noise' : (diff > 0 ? fk(diff) + ' kcal higher than the formula' : fk(-diff) + ' kcal lower than the formula')) + '</small></div></div>';
    let body, btns;
    if (R.verdict === 'keep' || !R.proposed) {
      body = '<p style="font-size:.95rem">Your logs say the plan\'s numbers are about right' + (R.proposed ? ' (the same pace would be ' + fk(R.proposed.kcal) + ' kcal, within 100 of your ' + fk(R.currentKcal) + ')' : '') + '. Keep going.</p>';
      btns = '<div class="row"><button type="button" class="btn small" data-pc="keep">Keep ' + fk(R.currentKcal) + ' kcal</button><button type="button" class="btn ghost small" data-pc="later">Ask again in a week</button></div>';
    } else {
      const p = R.proposed, up = R.delta > 0;
      body = '<p style="font-size:.95rem">To hold your chosen pace (' + (p.direction < 0 ? 'lose' : p.direction > 0 ? 'gain' : 'hold') + (p.direction ? ' about ' + p.rateKgWk.toFixed(2) + ' kg a week' : ' your weight') + '), the estimate points to <b>' + fk(p.kcal) + ' kcal</b> instead of ' + fk(R.currentKcal) + ' (' + (up ? '+' : '−') + fk(Math.abs(R.delta)) + '). Protein would be ' + p.protein + ' g, fat ' + p.fat + ' g, carbs ' + p.carbs + ' g' + (p.endDate ? ', goal around ' + fmt(p.endDate) : '') + '.</p>'
        + '<p class="muted" style="font-size:.88rem">This is an estimate from two weeks of logs, not an exact number. Nothing changes unless you tap it.</p>';
      btns = '<div class="row">' + (o.canApply !== false ? '<button type="button" class="btn small" data-pc="apply">Use ' + fk(p.kcal) + ' kcal</button>' : '') + '<button type="button" class="btn ghost small" data-pc="keep">Keep ' + fk(R.currentKcal) + '</button><button type="button" class="btn ghost small" data-pc="later">Ask again in a week</button></div>';
    }
    return '<div class="card pc-card">' + head + est + body + btns + '</div>';
  }

  // Weekly report line. trend = TrendTDEE.series(...) ([{date, kg, trend}]).
  function weekLine(docs, opts) {
    const o = opts || {}, today = isDate(o.today) ? o.today : todayIso(), plan = o.plan, ser = Array.isArray(o.trend) ? o.trend : null;
    if (!planOk(plan)) return null;
    const r = plan.result, dir = r.direction, planned = r.rateKgWk || 0;
    const weights = (docs && docs.weights) || {};
    const count = (from, to) => Object.keys(weights).filter(d => d >= from && d <= to && weights[d] && weights[d].kg > 0).length;
    const n7 = count(addDays(today, -6), today), n14 = count(addDays(today, -13), today);
    const at = d => { if (!ser) return null; const row = ser.find(x => x.date === d) || (d >= today && ser.length ? ser[ser.length - 1] : null); return row ? row.trend : null; };
    const now = at(today), wk = at(addDays(today, -7)), two = at(addDays(today, -14));
    const paceText = dir === 0 ? 'hold your weight' : (dir < 0 ? 'lose' : 'gain') + ' about ' + planned.toFixed(2) + ' kg a week';
    if (n7 < 4 || now == null || wk == null) return ['neutral', 'Plan', 'Only ' + n7 + ' of 7 weigh-ins this week, so there is no fair comparison with the plan (' + paceText + ') yet. Four or more weigh-ins a week are enough.'];
    const useTwo = two != null && n14 >= 8;
    const perWeek = useTwo ? (now - two) / 2 : now - wk;
    const basis = useTwo ? 'two-week trend' : 'one-week trend';
    const noise = ' One week can swing by half a kilo with water, salt and sleep, so a single week never changes your targets; two in a row is the signal.';
    const ch = (perWeek > 0 ? '+' : perWeek < 0 ? '−' : '±') + Math.abs(perWeek).toFixed(2);
    if (dir === 0) {
      if (Math.abs(perWeek) <= 0.3) return ['good', 'Plan', 'Trend ' + ch + ' kg a week (' + basis + '): steady, as planned.' + noise];
      return ['warn', 'Plan', 'Trend ' + ch + ' kg a week (' + basis + ') while the plan is to hold steady. If it keeps drifting for another week, adjust by 100 kcal.' + noise];
    }
    const actual = perWeek * dir;                       // positive = moving the planned way
    const ratio = planned > 0 ? actual / planned : 0;
    const vs = 'Plan: ' + paceText + '. ' + basis.charAt(0).toUpperCase() + basis.slice(1) + ': ' + ch + ' kg a week.';
    if (ratio >= 0.6 && ratio <= 1.5) return ['good', 'Plan', vs + ' On plan.' + noise];
    if (ratio > 1.5) return ['warn', 'Plan', vs + ' Faster than planned. Fine for a week or two; if it stays this fast, the Plan check will suggest easing the calories.' + noise];
    if (actual <= 0) return ['warn', 'Plan', vs + ' Not moving the planned way this week.' + noise];
    return ['warn', 'Plan', vs + ' Slower than planned.' + noise];
  }

  const css = '.pc-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px}.pc-stats>div{background:var(--sunk);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:2px}.pc-stats b{font-size:1.35rem}.pc-stats small{color:var(--muted);font-size:.78rem;line-height:1.3}@media (max-width:380px){.pc-stats{grid-template-columns:1fr}}';

  return { recheck, decide, html, weekLine, css, INTERVAL, LATER, NOISE_KCAL, MAX_BAND, MIN_FOOD_SHARE };
});
