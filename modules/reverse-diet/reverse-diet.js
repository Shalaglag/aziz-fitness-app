/*
 * ReverseDiet: the climb back to maintenance once the cut is done.
 *
 * Nothing about one person is built in. The host passes the user's own
 * profile (goal weight, cut calories, maintenance if known, protein/fat)
 * and the logs; the module decides when the goal is reached, plans weekly
 * calorie steps from the cut target up to maintenance, and checks each week
 * whether the trend weight is drifting before taking the next step.
 *
 * API (global `ReverseDiet`, plain JS, no imports, no network):
 *   css                                      inject once
 *   plan(docs, state, {today, profile, tdee, trend})   full plan object
 *   target(docs, state, date, opts)          {mode:"cut"|"reverse"|"maintain", kcal, lo, hi, protein, carbs, fat, week, weeks}
 *   html(docs, state, opts)                  one card
 *   apply(state, action, today, docs, opts)  new state; actions from data-rd-action
 *
 * docs  = {days, weights} from the app (`weights/{date}.kg`, `days/{date}.food[]`).
 * state = host-stored object (prefs/main.reverseDiet), {} to start:
 *         {auto, started, startKg, fromKcal, toKcal, weeks, stepKcal, dismissedAt}
 * opts.profile = {goalKg, cutKcal, maintenance, protein, fat} (all optional)
 * opts.tdee    = {kcal, lo, hi} from TrendTDEE.estimate when ready
 * opts.trend   = TrendTDEE.series(weights) to share one trend line (optional)
 */
const ReverseDiet = (() => {
  const DAY = 864e5;
  const ALPHA = 0.1;             // trend EWMA, same as TrendTDEE / GoalDate
  const STEP_LO = 100, STEP_HI = 150; // kcal added per week
  const MIN_WEEKS = 2, MAX_WEEKS = 10;
  const HOLD_PCT = 0.01;         // trend above goal by 1 % of goal weight: hold this week's step
  const BACK_PCT = 0.02;         // above by 2 %: step back one week
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  const ms = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => iso(ms(s) + n * DAY);
  const diff = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const short = s => { const d = new Date(ms(s)); return MON[d.getUTCMonth()] + " " + d.getUTCDate(); };
  const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const num = v => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const pos = v => { const n = num(v); return n != null && n > 0 ? n : null; };
  const r50 = n => Math.round(n / 50) * 50;
  const r5 = n => Math.round(n / 5) * 5;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fint = n => Math.round(n).toLocaleString("en-US");
  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- data ----------
  function weighIns(docs) {
    const w = (docs && docs.weights) || {};
    return Object.keys(w).filter(d => DATE.test(d) && pos(w[d] && w[d].kg) != null)
      .sort().map(d => ({ date: d, kg: pos(w[d].kg) }));
  }

  // Daily trend series: EWMA 0.1 over interpolated weigh-ins, flat after the last one.
  function trendSeries(docs, today, given) {
    if (Array.isArray(given) && given.length && given[0].date && given[0].trend != null) return given;
    const ws = weighIns(docs);
    if (!ws.length) return [];
    const out = [];
    let t = ws[0].kg, i = 0;
    const last = today > ws[ws.length - 1].date ? today : ws[ws.length - 1].date;
    for (let d = ws[0].date; d <= last; d = add(d, 1)) {
      while (i + 1 < ws.length && ws[i + 1].date <= d) i++;
      let kg = null;
      if (ws[i].date === d) kg = ws[i].kg;
      else if (i + 1 < ws.length) { const a = ws[i], b = ws[i + 1]; kg = a.kg + (b.kg - a.kg) * diff(a.date, d) / diff(a.date, b.date); }
      if (kg != null) t = d === ws[0].date ? kg : t + ALPHA * (kg - t);
      out.push({ date: d, kg: ws[i].date === d ? ws[i].kg : null, trend: Math.round(t * 100) / 100 });
    }
    return out;
  }
  const trendAt = (series, date) => {
    if (!series.length || date < series[0].date) return null;
    let v = null;
    for (const r of series) { if (r.date > date) break; v = r.trend; }
    return v;
  };

  function intakeAvg(docs, from, to) {
    const days = (docs && docs.days) || {};
    const vals = [];
    Object.keys(days).forEach(d => {
      if (!DATE.test(d) || d < from || d > to) return;
      const food = (days[d] && days[d].food) || [];
      const eaten = food.filter(f => f && f.eaten);
      if (!eaten.length) return;
      vals.push(eaten.reduce((s, f) => s + (num(f.kcal) || 0), 0));
    });
    return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
  }

  // ---------- numbers ----------
  function maintenance(profile, tdee, goalKg) {
    if (tdee && pos(tdee.kcal)) return { kcal: r50(tdee.kcal), lo: pos(tdee.lo) ? r50(tdee.lo) : null, hi: pos(tdee.hi) ? r50(tdee.hi) : null, source: "trend" };
    if (pos(profile.maintenance)) return { kcal: r50(profile.maintenance), lo: null, hi: null, source: "profile" };
    if (goalKg) return { kcal: r50(goalKg * 31), lo: r50(goalKg * 28), hi: r50(goalKg * 34), source: "estimate" };
    return { kcal: null, lo: null, hi: null, source: "none" };
  }

  // Weekly steps from `from` to `to`: +100–150 kcal a week, 2–10 weeks, last week lands exactly on `to`.
  function schedule(from, to) {
    const gap = Math.max(0, to - from);
    if (gap <= 0) return { weeks: 0, step: 0, kcal: [] };
    const weeks = clamp(Math.ceil(gap / STEP_HI), MIN_WEEKS, MAX_WEEKS);
    const step = gap / weeks;
    const kcal = [];
    for (let w = 1; w <= weeks; w++) kcal.push(w === weeks ? to : r50(from + step * w));
    return { weeks, step: Math.round(step), kcal };
  }

  function macros(kcal, profile, goalKg) {
    if (!kcal) return { protein: null, carbs: null, fat: null };
    const kg = goalKg || null;
    const protein = pos(profile.protein) || (kg ? r5(kg * 1.8) : null);
    const fat = pos(profile.fat) || (kg ? r5(kg * 0.9) : null);
    const carbs = protein != null && fat != null ? Math.max(0, r5((kcal - protein * 4 - fat * 9) / 4)) : null;
    return { protein, carbs, fat };
  }

  // ---------- the plan ----------
  function plan(docs, state, opts = {}) {
    state = state || {};
    const profile = opts.profile || {};
    const today = DATE.test(opts.today || "") ? opts.today : localToday();
    const goalKg = pos(profile.goalKg);
    const series = trendSeries(docs, today, opts.trend);
    const trendNow = trendAt(series, today);
    const ws = weighIns(docs);
    const cutKcal = pos(profile.cutKcal) || (ws.length ? intakeAvg(docs, add(today, -27), add(today, -1)) : null);
    const auto = state.auto !== false;
    const P = { today, goalKg, trendNow, lastWeighIn: ws.length ? ws[ws.length - 1] : null, cutKcal: cutKcal ? r50(cutKcal) : null, auto, state, status: "off", notes: [] };

    if (!goalKg) { P.status = "off"; P.notes.push("Set a goal weight in Your numbers and this card plans the way back to maintenance."); return P; }
    if (!ws.length) { P.status = "off"; P.notes.push("Log a weigh-in to start the trend."); return P; }

    const m = maintenance(profile, opts.tdee, goalKg);
    P.maintenance = m;

    const started = DATE.test(state.started || "") ? state.started : null;
    const reachedDate = series.find(r => r.trend <= goalKg) ? series.find(r => r.trend <= goalKg).date : null;
    P.reached = reachedDate != null && trendNow != null && trendNow <= goalKg + goalKg * HOLD_PCT;
    P.reachedOn = reachedDate;
    P.kgToGo = trendNow != null ? Math.max(0, trendNow - goalKg) : null;

    if (!started) {
      const from = P.cutKcal, to = m.kcal;
      const s = from != null && to != null ? schedule(from, to) : null;
      P.preview = s && to > from ? { from, to, weeks: s.weeks, step: s.step, kcal: s.kcal, source: m.source } : null;
      if (reachedDate && P.reached) {
        P.status = "ready";
        if (auto && P.preview) {
          const st = apply(state, "start", reachedDate > today ? today : reachedDate, docs, opts);
          if (st.started) return plan(docs, st, opts);
        }
        P.notes.push("Trend weight is at the goal. Start the reverse to add calories back a step at a time instead of jumping to maintenance.");
      } else {
        P.status = "cutting";
        if (P.kgToGo != null && P.kgToGo <= 1) P.notes.push("Under 1 kg to go. Keep eating to plan; the reverse starts when the trend crosses " + f1(goalKg) + " kg.");
        if (!P.preview) P.notes.push(from == null ? "Log eaten food so the plan knows the cut calories." : "Maintenance is not above the cut calories yet; check Your numbers.");
      }
      return P;
    }

    // Active reverse: fixed at start so the plan does not move under the user.
    const from = pos(state.fromKcal) || P.cutKcal, to = pos(state.toKcal) || m.kcal;
    const s = schedule(from, to);
    const startKg = pos(state.startKg) || trendAt(series, started) || goalKg;
    const base = Math.min(startKg, goalKg);
    const weekOf = d => Math.floor(Math.max(0, diff(started, d)) / 7); // 0 = first week of the reverse
    const scheduledWeek = weekOf(today);

    // Drift check at each completed week boundary: hold or step back when the trend is above the goal band.
    let eff = 0; const checks = [];
    for (let k = 1; k <= scheduledWeek; k++) {
      const at = add(started, k * 7);
      const t = trendAt(series, at);
      let verdict = "step";
      if (t != null) {
        const over = t - base;
        if (over > base * BACK_PCT) verdict = "back";
        else if (over > base * HOLD_PCT) verdict = "hold";
      }
      if (verdict === "step") eff = Math.min(s.weeks, eff + 1);
      else if (verdict === "back") eff = Math.max(0, eff - 1);
      checks.push({ date: at, trend: t, verdict });
    }
    const effWeek = Math.min(eff, s.weeks); // steps actually taken
    const kcalToday = effWeek === 0 ? from : s.kcal[effWeek - 1];
    const done = effWeek >= s.weeks && s.weeks > 0 || s.weeks === 0;
    P.status = done ? "maintain" : "reverse";
    P.from = from; P.to = to; P.weeks = s.weeks; P.step = s.step; P.steps = s.kcal;
    P.started = started; P.startKg = startKg; P.band = { lo: base - base * HOLD_PCT, hi: base + base * HOLD_PCT, back: base + base * BACK_PCT };
    P.scheduledWeek = scheduledWeek; P.effWeek = effWeek; P.checks = checks;
    P.kcalToday = kcalToday;
    P.macros = macros(kcalToday, profile, goalKg);
    P.nextStep = done ? null : { date: add(started, (scheduledWeek + 1) * 7), kcal: s.kcal[Math.min(s.weeks - 1, effWeek)] };
    P.drift = trendNow != null ? trendNow - base : null;
    P.eatenAvg = intakeAvg(docs, add(today, -6), add(today, -1));
    const holds = checks.filter(c => c.verdict === "hold").length, backs = checks.filter(c => c.verdict === "back").length;
    if (holds) P.notes.push(holds + (holds === 1 ? " week held" : " weeks held") + " because the trend sat more than 1 % above the goal.");
    if (backs) P.notes.push("Stepped back " + backs + (backs === 1 ? " week" : " weeks") + " after the trend rose more than 2 % above the goal.");
    if (P.drift != null && P.drift > base * BACK_PCT) P.notes.push(done ? "Trend is " + f1(P.drift) + " kg above the goal. Hold here or trim 100–150 kcal until it settles." : "Trend is " + f1(P.drift) + " kg above the goal; the next step waits until it comes back under " + f1(P.band.hi) + " kg.");
    else if (P.drift != null && P.drift < -base * HOLD_PCT) P.notes.push("Still losing on the reverse. Fine for a week; if it keeps falling, take the next step early.");
    if (P.eatenAvg != null && kcalToday && Math.abs(P.eatenAvg - kcalToday) > 150) P.notes.push("Last 7 days averaged " + fint(P.eatenAvg) + " kcal against a target of " + fint(kcalToday) + ". The drift check only means something when intake matches the step.");
    if (m.source === "estimate" && state.toKcal == null) P.notes.push("Maintenance is an estimate (about 31 kcal/kg). The trend check corrects it on the way up.");
    return P;
  }

  function target(docs, state, date, opts = {}) {
    const P = plan(docs, state, Object.assign({}, opts, { today: DATE.test(date || "") ? date : opts.today }));
    const out = { mode: "cut", kcal: null, lo: null, hi: null, protein: null, carbs: null, fat: null, week: null, weeks: null };
    if (P.status !== "reverse" && P.status !== "maintain") return out;
    out.mode = P.status; out.kcal = P.kcalToday; out.lo = P.kcalToday - 100; out.hi = P.kcalToday + 100;
    out.protein = P.macros.protein; out.carbs = P.macros.carbs; out.fat = P.macros.fat;
    out.week = P.effWeek; out.weeks = P.weeks;
    return out;
  }

  // ---------- state changes ----------
  function apply(state, action, today, docs, opts = {}) {
    const s = Object.assign({}, state || {});
    today = DATE.test(today || "") ? today : localToday();
    if (action === "start") {
      const P = plan(docs, Object.assign({}, s, { started: null, auto: false }), Object.assign({}, opts, { today }));
      if (!P.preview) return s;
      s.started = today;
      s.startKg = P.trendNow;
      s.fromKcal = P.preview.from; s.toKcal = P.preview.to;
      s.weeks = P.preview.weeks; s.stepKcal = P.preview.step;
      s.toSource = P.preview.source;
      return s;
    }
    if (action === "cancel") { delete s.started; delete s.startKg; delete s.fromKcal; delete s.toKcal; delete s.weeks; delete s.stepKcal; delete s.toSource; return s; }
    if (action === "auto") { s.auto = true; return s; }
    if (action === "manual") { s.auto = false; return s; }
    if (action === "faster" || action === "slower") {
      if (!s.started) return s;
      // Shift the start date one week so the scheduled week moves without touching the logs.
      s.started = add(s.started, action === "faster" ? -7 : 7);
      if (s.started > today) s.started = today;
      return s;
    }
    return s;
  }

  // ---------- card ----------
  const pill = (c, t) => '<span class="rd-pill ' + c + '">' + esc(t) + '</span>';
  const btn = (a, t, primary) => '<button type="button" class="' + (primary ? "btn" : "btn ghost") + '" data-rd-action="' + a + '">' + esc(t) + '</button>';
  const smallP = t => '<p class="rd-small">' + t + '</p>';

  function stepsTable(P, current) {
    const rows = P.steps.map((k, i) => {
      const w = i + 1, on = current != null && w === current;
      const date = P.started ? short(add(P.started, i * 7)) : "Week " + w;
      return '<tr' + (on ? ' class="rd-on"' : "") + '><td>' + esc(P.started ? "Wk " + w + " · " + date : date) + '</td><td class="n">' + fint(k) + '</td></tr>';
    });
    return '<div class="tablewrap"><table class="rd-table"><thead><tr><th>Week</th><th class="n">kcal</th></tr></thead><tbody>' + rows.join("") + '</tbody></table></div>';
  }

  function html(docs, state, opts = {}) {
    const P = plan(docs, state, opts);
    const h = ['<div class="card rd-card"><div class="spread"><h3>Back to maintenance</h3>'];
    if (P.status === "off") {
      h.push("</div>" + smallP(esc(P.notes[0])) + "</div>");
      return h.join("");
    }
    const g = f1(P.goalKg);
    if (P.status === "cutting") {
      h.push(pill("neutral", P.kgToGo != null ? f1(P.kgToGo) + " kg to go" : "cutting") + "</div>");
      h.push('<p>Trend <b>' + (P.trendNow != null ? f1(P.trendNow) : "—") + ' kg</b>, goal <b>' + g + ' kg</b>. When the trend reaches the goal this card plans the climb back instead of a jump.</p>');
      if (P.preview) h.push(smallP("Plan so far: <b>" + fint(P.preview.from) + "</b> → <b>" + fint(P.preview.to) + " kcal</b> over " + P.preview.weeks + " weeks (about +" + fint(P.preview.step) + " a week). Maintenance from " + (P.preview.source === "trend" ? "your trend and food logs" : P.preview.source === "profile" ? "Your numbers" : "a ~31 kcal/kg estimate") + "."));
      P.notes.forEach(n => h.push(smallP(esc(n))));
      h.push('<div class="rd-row">' + (P.auto ? btn("manual", "I'll start it myself") : btn("auto", "Start automatically at goal")) + "</div></div>");
      return h.join("");
    }
    if (P.status === "ready") {
      h.push(pill("good", "goal reached") + "</div>");
      h.push('<p>Trend <b>' + f1(P.trendNow) + ' kg</b> is at your goal of <b>' + g + ' kg</b>' + (P.reachedOn ? " (crossed " + short(P.reachedOn) + ")" : "") + ".</p>");
      if (P.preview) { h.push(smallP("Reverse: <b>" + fint(P.preview.from) + "</b> → <b>" + fint(P.preview.to) + " kcal</b> in " + P.preview.weeks + " weekly steps of about " + fint(P.preview.step) + ". Each step waits if the trend climbs more than 1 % above the goal.")); h.push(stepsTable({ steps: P.preview.kcal, started: null }, null)); }
      P.notes.forEach(n => h.push(smallP(esc(n))));
      h.push('<div class="rd-row">' + (P.preview ? btn("start", "Start the reverse today", true) : "") + (P.auto ? btn("manual", "Manual") : btn("auto", "Automatic")) + "</div></div>");
      return h.join("");
    }
    // reverse or maintain
    const done = P.status === "maintain";
    h.push(pill(done ? "good" : "neutral", done ? "at maintenance" : "week " + (P.scheduledWeek + 1) + " of " + P.weeks) + "</div>");
    h.push('<div class="rd-big"><div class="rd-num">' + fint(P.kcalToday) + ' <small>kcal today</small></div>' +
      (P.macros.protein != null ? '<div class="rd-small">P ' + P.macros.protein + ' g · C ' + P.macros.carbs + ' g · F ' + P.macros.fat + ' g</div>' : "") + "</div>");
    h.push('<p>Trend <b>' + (P.trendNow != null ? f1(P.trendNow) : "—") + ' kg</b> · goal ' + g + ' kg · band ' + f1(P.band.lo) + "–" + f1(P.band.hi) + " kg" + (P.drift != null ? " · drift " + (P.drift >= 0 ? "+" : "−") + f1(Math.abs(P.drift)) + " kg" : "") + "</p>");
    if (!done && P.nextStep) h.push(smallP("Next step <b>" + fint(P.nextStep.kcal) + " kcal</b> on " + short(P.nextStep.date) + ", if the trend is still inside the band."));
    if (done) h.push(smallP("Hold <b>" + fint(P.to) + " kcal</b>. Weigh in as usual; this card flags a drift of more than 2 % either way."));
    h.push('<details class="rd-details"><summary>Steps and weekly checks</summary>' + stepsTable(P, P.effWeek) +
      (P.checks.length ? '<ul class="rd-checks">' + P.checks.map(c => '<li>' + esc(short(c.date)) + ': trend ' + (c.trend != null ? f1(c.trend) : "—") + ' kg → ' + esc(c.verdict === "step" ? "stepped up" : c.verdict === "hold" ? "held" : "stepped back") + '</li>').join("") + '</ul>' : "") + "</details>");
    P.notes.forEach(n => h.push(smallP(esc(n))));
    h.push('<div class="rd-row">' + (done ? "" : btn("faster", "Faster") + btn("slower", "Slower")) + btn("cancel", done ? "Back to cutting" : "Stop, back to cut") + "</div></div>");
    return h.join("");
  }

  const css = [
    ".rd-card p{margin:.4em 0}",
    ".rd-small{font-size:.85rem;color:var(--muted)}.rd-small b{color:var(--ink)}",
    ".rd-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0 0}",
    ".rd-pill{display:inline-block;border-radius:999px;padding:2px 10px;font-size:.78rem;font-weight:600;border:1px solid currentColor;white-space:nowrap}",
    ".rd-pill.good{color:var(--good)}.rd-pill.warn{color:var(--warn)}.rd-pill.neutral{color:var(--accent)}",
    ".rd-big{margin:6px 0 2px}.rd-num{font-size:1.7rem;font-weight:700;font-variant-numeric:tabular-nums}.rd-num small{font-size:.8rem;font-weight:500;color:var(--muted)}",
    ".rd-table td,.rd-table th{padding:3px 8px}.rd-table tr.rd-on td{font-weight:700;color:var(--accent)}",
    ".rd-checks{margin:6px 0 0;padding-left:18px;font-size:.85rem;color:var(--muted)}",
    ".rd-details{margin-top:6px}.rd-details summary{cursor:pointer;font-size:.9rem}"
  ].join("\n");

  return { css, plan, target, html, apply, schedule, trendSeries };
})();

if (typeof module !== "undefined") module.exports = ReverseDiet;
