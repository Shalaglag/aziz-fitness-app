/* Diet-break planner. Works for anyone; nothing about one person is built in.
 * Schedules a 1–2 week maintenance break after every 8–12 weeks of cutting and tells
 * the app which calorie target applies on any day. Plain JS, no imports, no network.
 *
 * Adaptive:
 *   - Maintenance (TDEE) comes from TrendTDEE.estimate(docs, {today}) when that module is
 *     inlined, else from logged food and the weight trend, else from the profile or body weight.
 *   - Cut calories come from the profile, else the person's own average intake, else 80% of maintenance.
 *   - Block length follows the deficit: bigger deficits get breaks sooner (8 weeks at 25%+,
 *     10 at 15–25%, 12 under 15%); break length is 2 weeks at 20%+ deficit, else 1.
 *     Tapping Sooner/Later or choosing a length overrides this.
 *   - A stall from week 8 (under 0.25% of body weight lost in 2 weeks while on target)
 *     suggests starting the break early.
 *   - With a goal weight it projects the goal date and stops planning breaks before it;
 *     without one it keeps planning breaks a few blocks ahead.
 *
 * Reads the app's own collections:
 *   docs = { days: {date: {food:[{kcal,p,eaten}]}}, weights: {date: {kg}} }
 * opts.profile (all optional): { start, startKg, goalKg, cutKcal, protein, fat, maintenance }
 *   start defaults to the first logged day; startKg to the first weigh-in.
 * state, stored by the host (suggested `prefs/main.dietBreak`), all optional, {} is fine:
 *   { blockWeeks: 8–12 | null, breakWeeks: 1 | 2 | null, auto: bool, breaks: [{start, end}] }
 *   null block/break lengths mean "adapt". auto (default true): planned breaks start on their
 *   own; auto:false: the target stays at the cut level until the user taps Start.
 *
 * API:
 *   DietBreak.css                                    -> string, inject once (uses the app's tokens)
 *   DietBreak.build(docs, state, {today, tdee, profile}) -> plan object
 *   DietBreak.target(docs, state, date, opts)        -> {mode:"cut"|"break"|"maintain", kcal, lo, hi, protein, carbs, fat}
 *   DietBreak.html(docs, state, opts)                -> HTML card
 *   DietBreak.apply(state, action, today, docs, opts)-> new state; action = "start" | "end" | "length:1" | "length:2" |
 *                                                       "length:auto" | "block:<8-12>" | "block:auto" | "auto:on" | "auto:off"
 *   DietBreak.estimateTdee(docs, today, breaks, profile) -> {kcal, source, confidence, ...}
 * Buttons carry data-db-action="<action>"; the host calls apply(), saves the state and re-renders.
 */
const DietBreak = (() => {
  const KCAL_PER_KG = 7700, MIN_BLOCK = 8, MAX_BLOCK = 12;
  const DAY = 864e5;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  const ms = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => iso(ms(s) + n * DAY);
  const diff = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const short = s => { const d = new Date(ms(s)); return MON[d.getUTCMonth()] + " " + d.getUTCDate(); };
  const longDate = s => short(s) + ", " + new Date(ms(s)).getUTCFullYear();
  const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const num = v => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const pos = v => { const n = num(v); return n != null && n > 0 ? n : null; };
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const r50 = n => Math.round(n / 50) * 50;
  const r5 = n => Math.round(n / 5) * 5;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fint = n => Math.round(n).toLocaleString("en-US");
  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const kcalTxt = n => n == null ? "—" : fint(n);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- state and profile ----------
  function norm(state) {
    state = state || {};
    const b = num(state.blockWeeks), k = num(state.breakWeeks);
    const breaks = (Array.isArray(state.breaks) ? state.breaks : [])
      .filter(x => x && DATE.test(x.start))
      .map(x => ({ start: x.start, end: DATE.test(x.end || "") && x.end >= x.start ? x.end : add(x.start, 13) }))
      .sort((a, c) => a.start < c.start ? -1 : 1);
    return {
      blockWeeks: b != null ? clamp(Math.round(b), MIN_BLOCK, MAX_BLOCK) : null,
      breakWeeks: k === 1 || k === 2 ? k : null,
      breaks, auto: state.auto !== false,
    };
  }

  function firstLogged(docs) {
    let first = null;
    for (const [d, w] of Object.entries(docs.weights || {})) { const date = (w && w.date) || d; if (DATE.test(date) && num(w && w.kg) && (!first || date < first)) first = date; }
    for (const [d, x] of Object.entries(docs.days || {})) { const date = (x && x.date) || d; if (DATE.test(date) && ((x && x.food) || []).some(i => i && i.eaten) && (!first || date < first)) first = date; }
    return first;
  }

  function profileOf(docs, opts, today) {
    const P = opts.profile || {};
    const start = DATE.test(P.start || "") ? P.start : firstLogged(docs) || today;
    const first = weightSeries(docs, start, today)[0];
    return {
      start,
      startKg: pos(P.startKg) || (first ? first.kg : null),
      goalKg: pos(P.goalKg),
      cutKcal: pos(P.cutKcal), protein: pos(P.protein), fat: pos(P.fat), maintenance: pos(P.maintenance),
    };
  }

  // ---------- data ----------
  function weightSeries(docs, from, upto) {
    return Object.entries(docs.weights || {})
      .map(([d, w]) => ({ date: (w && w.date) || d, kg: pos(w && w.kg) }))
      .filter(x => x.kg != null && DATE.test(x.date) && x.date >= from && x.date <= upto)
      .sort((a, b) => a.date < b.date ? -1 : 1);
  }

  // Exponentially smoothed trend weight (10% per day, gaps carried forward).
  function trend(series) {
    const out = [];
    let t = null, prev = null;
    series.forEach(p => {
      t = t == null ? p.kg : t + (1 - Math.pow(0.9, Math.max(1, diff(prev, p.date)))) * (p.kg - t);
      out.push({ date: p.date, kg: t });
      prev = p.date;
    });
    return out;
  }

  // Least-squares slope, kg per day.
  function slope(points) {
    if (points.length < 2) return null;
    const xs = points.map(p => diff(points[0].date, p.date)), ys = points.map(p => p.kg);
    const mx = mean(xs), my = mean(ys);
    let n = 0, d = 0;
    xs.forEach((x, i) => { n += (x - mx) * (ys[i] - my); d += (x - mx) * (x - mx); });
    return d ? n / d : null;
  }

  function eatenKcal(docs, date) {
    const food = ((docs.days && docs.days[date] && docs.days[date].food) || []).filter(i => i && i.eaten);
    return food.length ? food.reduce((s, i) => s + (num(i.kcal) || 0), 0) : null;
  }

  const inAny = (breaks, d) => breaks.some(b => b.start <= d && d <= b.end);

  function intake(docs, from, to, breaks) {
    const k = [];
    for (let d = from; d <= to; d = add(d, 1)) if (!inAny(breaks, d)) { const x = eatenKcal(docs, d); if (x != null && x > 0) k.push(x); }
    return k;
  }

  // TDEE from the last 28 days: average eaten kcal minus the trend change in stored energy.
  // Break days and the first cut week (water and glycogen) are left out.
  function estimateTdee(docs, today, breaks, profile) {
    docs = docs || {};
    today = today || localToday();
    breaks = breaks || [];
    const prof = profile && profile.start ? profile : profileOf(docs, { profile }, today);
    const from = add(today, -27) < add(prof.start, 7) ? add(prof.start, 7) : add(today, -27);
    const all = weightSeries(docs, prof.start, today);
    const series = all.filter(p => p.date >= from && !inAny(breaks, p.date));
    const tr = trend(all).filter(p => p.date >= from && !inAny(breaks, p.date));
    const kcals = intake(docs, from, today, breaks);
    const span = series.length ? diff(series[0].date, series[series.length - 1].date) : 0;
    if (series.length >= 10 && kcals.length >= 10 && span >= 13) {
      const sl = slope(tr), kcal = r50(mean(kcals) - sl * KCAL_PER_KG);
      if (kcal >= 1200 && kcal <= 5000) return { kcal, source: "estimate", confidence: span >= 24 && kcals.length >= 20 ? "high" : "medium", days: span + 1, ratePerWeek: sl * 7 };
    }
    if (prof.maintenance) return { kcal: r50(prof.maintenance), source: "profile", confidence: "low", days: span ? span + 1 : 0 };
    // Rough starting point from body weight (~30 kcal per kg for an active adult).
    const kg = all.length ? all[all.length - 1].kg : prof.startKg;
    if (kg) return { kcal: r50(kg * 30), source: "bodyweight", confidence: "low", days: span ? span + 1 : 0 };
    return { kcal: null, source: "none", confidence: "low", days: 0 };
  }

  // opts.tdee: a number, {kcal, lo, hi} (TrendTDEE shape) or {kcal, confidence}. Left out,
  // TrendTDEE is used when it is inlined in the app, then the fallback estimator.
  function readTdee(opt, docs, today, breaks, prof) {
    if (opt === undefined && typeof TrendTDEE !== "undefined" && TrendTDEE.estimate) {
      try { const E = TrendTDEE.estimate(docs, { today }); if (E && E.ready) opt = { kcal: E.tdee, lo: E.tdeeLo, hi: E.tdeeHi }; } catch (e) { /* fall through */ }
    }
    if (opt != null) {
      const o = typeof opt === "object" ? opt : { kcal: opt };
      const kcal = num(o.kcal);
      if (kcal && kcal >= 1200 && kcal <= 5000) {
        const w = num(o.hi) != null && num(o.lo) != null ? (num(o.hi) - num(o.lo)) / 2 : null;
        return { kcal: r50(kcal), source: o.source || "trend", confidence: o.confidence || (w == null ? "medium" : w <= 150 ? "high" : w <= 350 ? "medium" : "low") };
      }
    }
    return estimateTdee(docs, today, breaks, prof);
  }

  // ---------- plan ----------
  // Cut blocks of blockWeeks, each followed by a break, honouring breaks the user recorded,
  // until the projected weight reaches the goal (or a year past today without a goal).
  function schedule(st, start, today, cutDaysLeft) {
    const phases = [], taken = st.breaks.slice(), horizon = add(today, 365);
    let cursor = start, guard = 0;
    while (guard++ < 60) {
      const next = taken.find(b => b.start >= cursor);
      // Manual mode: a planned break never starts by itself; the cut runs on until the user taps Start.
      let plannedStart = add(cursor, st.blockWeeks * 7);
      if (!st.auto && plannedStart <= today) plannedStart = add(today, 1);
      if (next && next.start <= plannedStart) {
        if (next.start > cursor) phases.push({ type: "cut", start: cursor, end: add(next.start, -1) });
        phases.push({ type: "break", start: next.start, end: next.end, taken: true });
        taken.splice(taken.indexOf(next), 1);
        cursor = add(next.end, 1);
        continue;
      }
      // Future cut days count toward the goal; past ones are already in the weight.
      const blockEnd = add(plannedStart, -1);
      const futureFrom = cursor > today ? cursor : add(today, 1);
      const futureDays = blockEnd >= futureFrom ? diff(futureFrom, blockEnd) + 1 : 0;
      if (futureDays >= cutDaysLeft && blockEnd >= today) {
        let end = add(futureFrom, Math.max(0, cutDaysLeft - 1));
        if (end < cursor) end = cursor;
        phases.push({ type: "cut", start: cursor, end, last: true });
        phases.push({ type: "maintain", start: add(end, 1) });
        break;
      }
      cutDaysLeft -= futureDays;
      phases.push({ type: "cut", start: cursor, end: blockEnd });
      const bEnd = add(plannedStart, st.breakWeeks * 7 - 1);
      phases.push({ type: "break", start: plannedStart, end: bEnd, planned: true });
      cursor = add(bEnd, 1);
      if (cursor > horizon) break;
    }
    return phases;
  }

  function macros(kcal, prof, kg) {
    const ref = prof.goalKg && kg ? Math.max(prof.goalKg, kg * 0.85) : kg;
    const protein = prof.protein || (ref ? r5(ref * 1.8) : null);
    const fat = prof.fat || (ref ? r5(ref * 0.8) : null);
    const carbs = kcal != null && protein != null && fat != null ? Math.max(0, r5((kcal - protein * 4 - fat * 9) / 4)) : null;
    return { protein, fat, carbs };
  }

  function build(docs, state, opts = {}) {
    docs = docs || {};
    const today = opts.today || localToday();
    const st = norm(state);
    const prof = profileOf(docs, opts, today);
    const tdee = readTdee(opts.tdee, docs, today, st.breaks, prof);
    const series = weightSeries(docs, prof.start, today), tr = trend(series);
    const kgNow = tr.length ? tr[tr.length - 1].kg : prof.startKg;

    // Cut calories: profile, else the person's own average over cut days, else 80% of maintenance.
    const own = intake(docs, add(today, -27) < prof.start ? prof.start : add(today, -27), today, st.breaks);
    const cutKcal = prof.cutKcal || (own.length >= 7 ? r50(mean(own)) : tdee.kcal ? r50(tdee.kcal * 0.8) : null);
    const cutSource = prof.cutKcal ? "profile" : own.length >= 7 ? "intake" : tdee.kcal ? "default" : "none";
    const deficit = tdee.kcal && cutKcal ? clamp((tdee.kcal - cutKcal) / tdee.kcal, 0, 0.5) : null;

    // Adapt block and break length to the size of the deficit unless the user chose them.
    const adaptBlock = deficit == null ? 10 : deficit >= 0.25 ? 8 : deficit >= 0.15 ? 10 : 12;
    const adaptBreak = deficit != null && deficit < 0.2 ? 1 : 2;
    const plan = { ...st, blockWeeks: st.blockWeeks || adaptBlock, breakWeeks: st.breakWeeks || adaptBreak,
      blockAdaptive: st.blockWeeks == null, breakAdaptive: st.breakWeeks == null };

    // Expected rate: observed trend with 2+ weeks of data, else from the deficit; 0.25–1.25% of body weight a week.
    const recent = tr.filter(p => p.date >= add(today, -20) && !inAny(st.breaks, p.date));
    const obs = recent.length >= 10 && diff(recent[0].date, recent[recent.length - 1].date) >= 14 ? -slope(recent) * 7 : null;
    const fromDeficit = tdee.kcal && cutKcal ? (tdee.kcal - cutKcal) * 7 / KCAL_PER_KG : null;
    const raw = obs != null && obs > 0 ? obs : fromDeficit;
    const rate = raw != null && kgNow ? clamp(raw, kgNow * 0.0025, kgNow * 0.0125) : null;

    // Days since the last weigh-in are assumed to follow the plan, so a logging gap does not push the goal out.
    let cutDaysLeft = Infinity;
    if (prof.goalKg && kgNow && rate) {
      const known = tr.length ? tr[tr.length - 1] : { date: prof.start, kg: prof.startKg };
      const rough = schedule(plan, prof.start, today, Infinity);
      let gap = 0;
      for (let d = add(known.date, 1); d <= today; d = add(d, 1)) if (!rough.some(x => x.type === "break" && x.start <= d && d <= x.end)) gap++;
      const kg = known.kg - rate * gap / 7;
      cutDaysLeft = kg > prof.goalKg ? Math.ceil((kg - prof.goalKg) / rate * 7) : 0;
    }
    const phases = schedule(plan, prof.start, today, cutDaysLeft);
    const now = phases.find(p => p.start <= today && (!p.end || today <= p.end)) || phases[0];
    const blockIdx = phases.filter(p => p.type === "cut" && p.start <= now.start).length;
    const nextBreak = phases.find(p => p.type === "break" && p.start > today) || null;
    const curBreak = now.type === "break" ? now : null;
    const cutStart = now.type === "cut" ? now.start : null;
    const weekInBlock = cutStart ? Math.floor(diff(cutStart, today) / 7) + 1 : null;

    // Early break: from week 8, raw weigh-ins (the trend lags a stall) dropped under 0.25% of
    // body weight in 2 weeks while eating on target.
    let early = null;
    if (now.type === "cut" && weekInBlock >= MIN_BLOCK && kgNow && cutKcal) {
      const last14 = series.filter(p => p.date > add(today, -14));
      const sl = last14.length >= 6 ? slope(last14) : null;
      const loss = sl != null ? -sl * 13 : null;
      const k = intake(docs, add(today, -13), today, []);
      if (loss != null && loss < kgNow * 0.0025 && k.length >= 8 && mean(k) <= cutKcal * 1.075) early = { loss, avgKcal: mean(k) };
    }

    const lastCut = phases.find(p => p.type === "cut" && p.last);
    return {
      today, state: plan, profile: prof, tdee, kgNow, cutKcal, cutSource, deficit,
      rate, rateSource: obs != null && obs > 0 ? "trend" : "deficit",
      phases, now, blockIdx, weekInBlock, cutStart, curBreak, nextBreak, early,
      daysToBreak: nextBreak ? diff(today, nextBreak.start) : null,
      breakDay: curBreak ? diff(curBreak.start, today) + 1 : null,
      breakKcal: tdee.kcal, breakMacros: macros(tdee.kcal, prof, kgNow), cutMacros: macros(cutKcal, prof, kgNow),
      goalDate: lastCut ? add(lastCut.end, 1) : null,
      plannedBreaks: phases.filter(p => p.type === "break"),
    };
  }

  function target(docs, state, date, opts = {}) {
    const p = build(docs, state, { ...opts, today: opts.today || date });
    const ph = p.phases.find(x => x.start <= date && (!x.end || date <= x.end)) || p.now;
    const kcal = ph.type === "cut" ? p.cutKcal : p.breakKcal;
    const band = kcal != null ? r50(kcal * 0.075) : null;
    return { mode: ph.type, kcal, lo: kcal != null ? kcal - band : null, hi: kcal != null ? kcal + band : null, ...macros(kcal, p.profile, p.kgNow), phase: ph };
  }

  // Records what the user does. Pass docs/opts so a break that started on its own can be ended or resized.
  function apply(state, action, today, docs, opts) {
    today = today || localToday();
    const p = build(docs || {}, state, { ...(opts || {}), today });
    const s = norm(state);
    const out = { blockWeeks: s.blockWeeks, breakWeeks: s.breakWeeks, breaks: s.breaks.map(b => ({ ...b })), auto: s.auto };
    let cur = out.breaks.find(b => b.start <= today && today <= b.end);
    if (!cur && p.curBreak) { cur = { start: p.curBreak.start, end: p.curBreak.end }; out.breaks.push(cur); }
    const weeks = out.breakWeeks || p.state.breakWeeks;
    if (action === "start" && !cur) out.breaks.push({ start: today, end: add(today, weeks * 7 - 1) });
    else if (action === "end" && cur) {
      if (cur.start >= today) out.breaks.splice(out.breaks.indexOf(cur), 1);
      else cur.end = add(today, -1);
    } else if (/^length:[12]$/.test(action)) {
      out.breakWeeks = Number(action.slice(7));
      if (cur) cur.end = add(cur.start, out.breakWeeks * 7 - 1);
    } else if (action === "length:auto") out.breakWeeks = null;
    else if (action === "block:auto") out.blockWeeks = null;
    else if (/^block:\d+$/.test(action)) out.blockWeeks = clamp(Number(action.slice(6)), MIN_BLOCK, MAX_BLOCK);
    else if (action === "auto:on" || action === "auto:off") out.auto = action === "auto:on";
    out.breaks.sort((a, b) => a.start < b.start ? -1 : 1);
    return out;
  }

  // ---------- rendering ----------
  const pill = (c, t) => '<span class="db-pill ' + c + '">' + esc(t) + '</span>';
  const btn = (a, t, ghost) => '<button class="btn ' + (ghost ? "ghost " : "") + 'small" data-db-action="' + a + '">' + esc(t) + '</button>';
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");

  function timeline(p) {
    const shown = p.phases.filter(x => x.end || x.type === "maintain");
    const first = ms(p.profile.start), lastP = shown[shown.length - 1];
    const lastMs = ms(lastP.end || add(lastP.start, 14));
    const span = Math.max(1, lastMs - first + DAY);
    const pct = t => ((t - first) / span * 100).toFixed(2);
    let bars = "";
    shown.forEach(x => {
      const s = ms(x.start), e = x.end ? ms(x.end) + DAY : lastMs + DAY;
      bars += '<div class="db-seg ' + x.type + '" style="left:' + pct(s) + '%;width:' + ((e - s) / span * 100).toFixed(2) + '%" title="' +
        esc((x.type === "cut" ? "Cut" : x.type === "break" ? "Maintenance break" : "At goal") + ": " + short(x.start) + (x.end ? " – " + short(x.end) : "")) + '"></div>';
    });
    bars += '<div class="db-now" style="left:' + clamp(Number(pct(ms(p.today) + DAY / 2)), 0, 100) + '%"><span>Today</span></div>';
    return '<div class="db-track" role="img" aria-label="Cut and break schedule">' + bars + '</div>' +
      '<div class="db-legend"><span><i class="cut"></i>Cut, ' + kcalTxt(p.cutKcal) + ' kcal</span><span><i class="break"></i>Break, ~' + kcalTxt(p.breakKcal) + ' kcal</span>' +
      (p.goalDate ? '<span><i class="maintain"></i>At goal</span>' : "") + '</div>';
  }

  function html(docs, state, opts = {}) {
    const p = build(docs, state, opts);
    if (p.breakKcal == null) {
      return '<div class="card db-card"><h3>Diet breaks</h3><p>Log a weigh-in to plan your diet breaks. Maintenance calories are estimated from your weight first, then from your logged food and weight trend.</p></div>';
    }
    const m = p.breakMacros, cut = kcalTxt(p.cutKcal);
    const src = { estimate: "estimated from your logged food and weight trend", trend: "from your trend weight and calorie burn", profile: "your starting estimate", bodyweight: "a rough start from your body weight" }[p.tdee.source];
    const tdeeNote = "Maintenance ~" + fint(p.breakKcal) + " kcal, " + src + (p.tdee.source === "estimate" || p.tdee.source === "trend" ? " (" + esc(p.tdee.confidence) + " confidence)." : ". It updates once there are 2+ weeks of weigh-ins and logged food.");
    const deficitNote = p.deficit != null ? " Your deficit is about " + Math.round(p.deficit * 100) + "%." : "";
    let head, body, actions;
    if (p.now.type === "break") {
      const len = diff(p.curBreak.start, p.curBreak.end) + 1;
      head = pill("neutral", "Diet break") + ' <b>Day ' + p.breakDay + ' of ' + len + '</b>';
      body = '<p>Eat at maintenance: <b>~' + fint(p.breakKcal) + ' kcal</b>.' +
        (m.protein ? ' Keep protein at ' + m.protein + ' g; put the extra calories mostly into carbs (~' + m.carbs + ' g) with fat ~' + m.fat + ' g.' : "") + '</p>' +
        '<p class="db-small">Expect the scale to rise a little in the first days (about 0.5–1.5% of body weight). That is glycogen and water, not fat. Keep training as usual. The cut restarts on <b>' + short(add(p.curBreak.end, 1)) + '</b> at ' + cut + ' kcal.</p>';
      actions = btn("end", "End break today", true) + (len === 7 ? btn("length:2", "Make it 2 weeks", true) : btn("length:1", "Make it 1 week", true));
    } else if (p.now.type === "maintain") {
      head = pill("good", "Goal reached") + ' <b>Maintenance</b>';
      body = '<p>Projected at your goal of ' + f1(p.profile.goalKg) + ' kg. Eat ~' + fint(p.breakKcal) + ' kcal to hold it.</p>';
      actions = "";
    } else {
      const due = p.weekInBlock > (p.state.auto ? MAX_BLOCK : p.state.blockWeeks);
      head = pill(p.early || due ? "warn" : "good", p.early ? "Break suggested" : due ? "Break due" : "Cutting") + ' <b>Week ' + p.weekInBlock + ' of block ' + p.blockIdx + '</b>';
      if (due && !p.state.auto) body = '<p>Your planned maintenance break is due (' + plural(p.state.blockWeeks, "week") + ' of cutting done). Tap <b>Start break today</b> when you are ready; the target stays at ' + cut + ' until you do.</p>';
      else if (p.early) body = '<p>Your weight dropped only ' + f1(p.early.loss) + ' kg in 2 weeks while eating ~' + fint(p.early.avgKcal) + ' kcal. You are past week 8, so start the maintenance break now instead of waiting.</p>';
      else if (p.nextBreak) body = '<p>Next maintenance break: <b>' + short(p.nextBreak.start) + ' – ' + short(p.nextBreak.end) + '</b>' +
        ' (in ' + (p.daysToBreak <= 14 ? plural(p.daysToBreak, "day") : Math.round(p.daysToBreak / 7) + ' weeks') + '), at ~' + fint(p.breakKcal) + ' kcal a day. Until then stay at ' + cut + '.</p>';
      else body = '<p>No more breaks planned: the last stretch to your goal is shorter than a full block.</p>';
      if (p.weekInBlock < MIN_BLOCK) body += '<p class="db-small">Stalls before week 8 are usually water. Ride them out rather than starting a break early.</p>';
      actions = p.weekInBlock >= MIN_BLOCK ? btn("start", "Start break today", !(p.early || due)) : "";
    }
    const goal = p.goalDate ? 'Projected ' + f1(p.profile.goalKg) + ' kg around <b>' + longDate(p.goalDate) + '</b> at ~' + f1(p.rate) + ' kg/week (' + (p.rateSource === "trend" ? "your trend" : "from your deficit") + '), including ' + plural(p.plannedBreaks.length, "break") + '.' : "";
    const list = p.plannedBreaks.slice(0, 6).map(b =>
      '<li>' + short(b.start) + ' – ' + short(b.end) + (b.start <= p.today ? (b.end < p.today ? " · done" : " · now") : "") + '</li>').join("");
    const why = p.state.blockAdaptive ? " (set by your deficit)" : "";
    const len = '<div class="db-row db-small">Breaks every ' + plural(p.state.blockWeeks, "week") + ' of cutting' + why + ', ' + plural(p.state.breakWeeks, "week") + ' long. ' +
      (p.state.blockWeeks > MIN_BLOCK ? btn("block:" + (p.state.blockWeeks - 1), "Sooner", true) : "") +
      (p.state.blockWeeks < MAX_BLOCK ? btn("block:" + (p.state.blockWeeks + 1), "Later", true) : "") +
      (!p.state.blockAdaptive || !p.state.breakAdaptive ? btn("block:auto", "Adapt automatically", true) : "") + '</div>';
    return '<div class="card db-card"><div class="spread"><h3>Diet breaks</h3><span class="db-small">' + head + '</span></div>' +
      body + (actions ? '<div class="db-row">' + actions + '</div>' : "") + timeline(p) +
      (list ? '<ul class="db-list">' + list + '</ul>' : "") +
      (goal ? '<p class="db-small">' + goal + '</p>' : "") +
      '<p class="db-small">' + tdeeNote + deficitNote + '</p>' + len + '</div>';
  }

  const css = [
    ".db-card p{margin:.4em 0}",
    ".db-small{font-size:.85rem;color:var(--muted)}.db-small b{color:var(--ink)}",
    ".db-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}",
    ".db-pill{display:inline-block;border-radius:999px;padding:2px 10px;font-size:.78rem;font-weight:600;border:1px solid currentColor;white-space:nowrap}",
    ".db-pill.good{color:var(--good)}.db-pill.warn{color:var(--warn)}.db-pill.bad{color:var(--bad)}.db-pill.neutral{color:var(--accent)}",
    ".db-track{position:relative;height:16px;border-radius:999px;background:var(--sunk);margin:22px 0 6px;overflow:visible}",
    ".db-seg{position:absolute;top:0;bottom:0}.db-seg.cut{background:var(--accent);opacity:.85}.db-seg.break{background:var(--carbs)}.db-seg.maintain{background:var(--good);opacity:.6}",
    ".db-seg:first-child{border-radius:999px 0 0 999px}",
    ".db-now{position:absolute;top:-6px;bottom:-6px;width:2px;background:var(--ink);transform:translateX(-1px)}",
    ".db-now span{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);font-size:.7rem;color:var(--muted);white-space:nowrap}",
    ".db-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:.78rem;color:var(--muted)}",
    ".db-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}",
    ".db-legend i.cut{background:var(--accent)}.db-legend i.break{background:var(--carbs)}.db-legend i.maintain{background:var(--good);opacity:.6}",
    ".db-list{margin:8px 0;padding-left:18px;font-size:.9rem}",
  ].join("\n");

  return { css, build, target, html, apply, estimateTdee };
})();

if (typeof module !== "undefined") module.exports = DietBreak;
