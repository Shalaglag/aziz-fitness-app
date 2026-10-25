/* Diet-break planner for the Aziz Cut Tracker.
 * Schedules a 1–2 week maintenance break after every 8–12 weeks of cutting
 * (default: 10 weeks cut, 2 weeks at maintenance) and tells the app which
 * calorie target applies on any day. Plain JS, no imports, no network.
 *
 * Reads the app's own collections:
 *   docs = { days: {date: {food:[{kcal,p,eaten}]}}, weights: {date: {kg}} }
 * plus a small state object the host stores (suggested: `prefs/main.dietBreak`):
 *   state = { blockWeeks: 8–12, breakWeeks: 1|2, auto: bool, breaks: [{start, end}] }   (all optional; {} is fine)
 *   auto (default true): planned breaks start on their own on the planned date (the day's
 *   target switches to maintenance). auto:false: the target stays at 2,000 until the user
 *   taps Start; the card shows the break as due. `breaks` records breaks the user started,
 *   ended early or resized.
 *
 * Maintenance (TDEE): uses TrendTDEE.estimate(docs, {today}) when that module is inlined
 * (or pass opts.tdee: a number or {kcal, lo, hi}). Without it the module
 * estimates TDEE itself from eaten kcal and the weight trend, and before there
 * is enough data it uses the plan's ~2,800 (handoff doc: 2,700–2,900).
 *
 * API:
 *   DietBreak.css                              -> string, inject once (uses the app's tokens)
 *   DietBreak.build(docs, state, {today, tdee})-> plan object (phase now, next break, schedule, targets)
 *   DietBreak.target(docs, state, date, opts)  -> {mode:"cut"|"break"|"maintain", kcal, lo, hi, protein, carbs, fat}
 *   DietBreak.html(docs, state, opts)          -> HTML card for the Progress tab (or Today)
 *   DietBreak.apply(state, action, today)      -> new state; action = "start" | "end" | "length:1" | "length:2" | "block:<8-12>" | "auto:on" | "auto:off"
 *   DietBreak.estimateTdee(docs, today)        -> {kcal, source, confidence, days, ratePerWeek} (fallback estimator)
 * Buttons carry data-db-action="<action>"; the host calls apply(), saves the state and re-renders.
 */
const DietBreak = (() => {
  const START = "2026-10-25", START_KG = 91.9, GOAL = 80;
  const CUT_KCAL = 2000, PLAN_TDEE = 2800, PRO = 160, FAT = 70, KCAL_PER_KG = 7700;
  const MIN_BLOCK = 8, MAX_BLOCK = 12, DEF_BLOCK = 10, DEF_BREAK = 2;
  const DAY = 864e5;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const ms = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => iso(ms(s) + n * DAY);
  const diff = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const short = s => { const d = new Date(ms(s)); return MON[d.getUTCMonth()] + " " + d.getUTCDate(); };
  const longDate = s => short(s) + ", " + new Date(ms(s)).getUTCFullYear();
  const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const num = v => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const r50 = n => Math.round(n / 50) * 50;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fint = n => Math.round(n).toLocaleString("en-US");
  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- state ----------
  function norm(state) {
    state = state || {};
    const blockWeeks = clamp(Math.round(num(state.blockWeeks) || DEF_BLOCK), MIN_BLOCK, MAX_BLOCK);
    const breakWeeks = num(state.breakWeeks) === 1 ? 1 : DEF_BREAK;
    const breaks = (Array.isArray(state.breaks) ? state.breaks : [])
      .filter(b => b && /^\d{4}-\d{2}-\d{2}$/.test(b.start))
      .map(b => ({ start: b.start, end: /^\d{4}-\d{2}-\d{2}$/.test(b.end || "") ? b.end : add(b.start, breakWeeks * 7 - 1) }))
      .sort((a, b) => a.start < b.start ? -1 : 1);
    return { blockWeeks, breakWeeks, breaks, auto: state.auto !== false };
  }

  // Breaks start on their own on the planned date; apply() records changes the user makes.
  function apply(state, action, today) {
    const s = norm(state);
    today = today || localToday();
    const out = { blockWeeks: s.blockWeeks, breakWeeks: s.breakWeeks, breaks: s.breaks.map(b => ({ ...b })), auto: s.auto };
    const ph = schedule(s, today, 999, 0.5).find(p => p.start <= today && (!p.end || today <= p.end));
    let cur = out.breaks.find(b => b.start <= today && today <= b.end);
    if (!cur && ph && ph.type === "break") { cur = { start: ph.start, end: ph.end }; out.breaks.push(cur); }
    if (action === "start" && !cur) out.breaks.push({ start: today, end: add(today, s.breakWeeks * 7 - 1) });
    else if (action === "end" && cur) {
      if (cur.start >= today) out.breaks.splice(out.breaks.indexOf(cur), 1);
      else cur.end = add(today, -1);
    } else if (/^length:[12]$/.test(action)) {
      out.breakWeeks = Number(action.slice(7));
      if (cur) cur.end = add(cur.start, out.breakWeeks * 7 - 1);
    } else if (action === "auto:on" || action === "auto:off") out.auto = action === "auto:on";
    else if (/^block:\d+$/.test(action)) out.blockWeeks = clamp(Number(action.slice(6)), MIN_BLOCK, MAX_BLOCK);
    out.breaks.sort((a, b) => a.start < b.start ? -1 : 1);
    return out;
  }

  // ---------- data ----------
  function weightSeries(docs, upto) {
    return Object.entries(docs.weights || {})
      .map(([d, w]) => ({ date: (w && w.date) || d, kg: num(w && w.kg) }))
      .filter(x => x.kg != null && x.date >= START && x.date <= upto)
      .sort((a, b) => a.date < b.date ? -1 : 1);
  }

  // Exponentially smoothed trend weight (10% per day, gaps carried forward).
  function trend(series) {
    if (!series.length) return [];
    const out = [];
    let t = series[0].kg, prev = series[0].date;
    series.forEach(p => {
      const gap = Math.max(1, diff(prev, p.date));
      const a = 1 - Math.pow(0.9, gap);
      t = out.length ? t + a * (p.kg - t) : p.kg;
      out.push({ date: p.date, kg: t });
      prev = p.date;
    });
    return out;
  }

  // Least-squares slope of the trend, kg per day.
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

  // Fallback TDEE: average eaten kcal minus the trend change in energy, over the last 28 days.
  // Days inside a diet break are left out of the window so the cut rate is not diluted.
  function estimateTdee(docs, today, breaks) {
    docs = docs || {};
    today = today || localToday();
    // Skip week 1 of the cut: its water and glycogen drop would inflate the rate.
    const from = add(today, -27) < add(START, 7) ? add(START, 7) : add(today, -27);
    const inBreak = d => (breaks || []).some(b => b.start <= d && d <= b.end);
    const series = weightSeries(docs, today).filter(p => p.date >= from && !inBreak(p.date));
    const kcals = [];
    for (let d = from; d <= today; d = add(d, 1)) if (!inBreak(d)) { const k = eatenKcal(docs, d); if (k != null && k > 0) kcals.push(k); }
    const tr = trend(weightSeries(docs, today)).filter(p => p.date >= from && !inBreak(p.date));
    const span = series.length ? diff(series[0].date, series[series.length - 1].date) : 0;
    if (series.length >= 10 && kcals.length >= 10 && span >= 13) {
      const sl = slope(tr);
      const kcal = r50(mean(kcals) - sl * KCAL_PER_KG);
      const confidence = span >= 24 && kcals.length >= 20 ? "high" : "medium";
      if (kcal >= 1800 && kcal <= 4000) return { kcal, source: "estimate", confidence, days: span + 1, ratePerWeek: sl * 7 };
    }
    return { kcal: PLAN_TDEE, source: "plan", confidence: "low", days: span ? span + 1 : 0, ratePerWeek: null };
  }

  // opts.tdee: a number, {kcal, lo, hi} (TrendTDEE shape) or {kcal, confidence}. Left out, the
  // TrendTDEE module is used when it is inlined in the app, then the fallback estimator.
  function readTdee(opt, docs, today, breaks) {
    if (opt === undefined && typeof TrendTDEE !== "undefined" && TrendTDEE.estimate) {
      try { const E = TrendTDEE.estimate(docs, { today }); if (E && E.ready) opt = { kcal: E.tdee, lo: E.tdeeLo, hi: E.tdeeHi }; } catch (e) { /* fall through */ }
    }
    if (opt != null) {
      const o = typeof opt === "object" ? opt : { kcal: opt };
      const kcal = num(o.kcal);
      if (kcal && kcal >= 1500 && kcal <= 4500) {
        const w = num(o.hi) != null && num(o.lo) != null ? (num(o.hi) - num(o.lo)) / 2 : null;
        const confidence = o.confidence || (w == null ? "medium" : w <= 150 ? "high" : w <= 350 ? "medium" : "low");
        return { kcal: r50(kcal), source: o.source || "trend", confidence };
      }
    }
    return estimateTdee(docs, today, breaks);
  }

  // ---------- plan ----------
  // Walks forward from the cut start: cut blocks of blockWeeks, each followed by a break,
  // honouring breaks actually taken, until the projected weight reaches the goal.
  function schedule(st, today, trendKg, ratePerWeek) {
    const phases = [];
    let cursor = START, kg = trendKg, guard = 0;
    const cutLeftWeeks = kg > GOAL && ratePerWeek > 0 ? (kg - GOAL) / ratePerWeek : 0;
    let cutDaysLeft = Math.ceil(cutLeftWeeks * 7);
    const taken = st.breaks.slice();
    while (guard++ < 40) {
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
      // Future cut days count toward the goal; past ones are already in the trend.
      const blockEnd = add(plannedStart, -1);
      const futureFrom = cursor > today ? cursor : add(today, 1);
      const futureDays = blockEnd >= futureFrom ? diff(futureFrom, blockEnd) + 1 : 0;
      if (futureDays >= cutDaysLeft && cutDaysLeft >= 0 && blockEnd >= today) {
        const end = add(futureFrom, Math.max(0, cutDaysLeft - 1));
        phases.push({ type: "cut", start: cursor, end: end < cursor ? cursor : end, last: true });
        phases.push({ type: "maintain", start: add(end < cursor ? cursor : end, 1) });
        break;
      }
      cutDaysLeft -= futureDays;
      phases.push({ type: "cut", start: cursor, end: blockEnd });
      const bEnd = add(plannedStart, st.breakWeeks * 7 - 1);
      phases.push({ type: "break", start: plannedStart, end: bEnd, planned: true, auto: plannedStart <= today });
      cursor = add(bEnd, 1);
    }
    return phases;
  }

  function macros(kcal) {
    const carbs = Math.max(0, Math.round((kcal - PRO * 4 - FAT * 9) / 4 / 5) * 5);
    return { protein: PRO, fat: FAT, carbs };
  }

  function build(docs, state, opts = {}) {
    docs = docs || {};
    const st = norm(state);
    const today = opts.today || localToday();
    const tdee = readTdee(opts.tdee, docs, today, st.breaks);
    const series = weightSeries(docs, today), tr = trend(series);
    const trendKg = tr.length ? tr[tr.length - 1].kg : null;

    // Expected cut rate: observed trend when there are 3+ weeks of data, else from the deficit.
    const recent = tr.filter(p => p.date >= add(today, -20) && !st.breaks.some(b => b.start <= p.date && p.date <= b.end));
    const obs = recent.length >= 10 && diff(recent[0].date, recent[recent.length - 1].date) >= 14 ? -slope(recent) * 7 : null;
    const fromDeficit = (tdee.kcal - CUT_KCAL) * 7 / KCAL_PER_KG;
    const rate = clamp(obs != null && obs > 0 ? obs : fromDeficit, 0.25, 1.0);

    // Days since the last weigh-in are assumed to follow the plan, so a gap in logging
    // does not push the projected goal date out.
    const known = tr.length ? tr[tr.length - 1] : { date: START, kg: START_KG };
    const rough = schedule(st, today, 999, rate);
    let cutDays = 0;
    for (let d = add(known.date, 1); d <= today; d = add(d, 1)) if (!rough.some(x => x.type === "break" && x.start <= d && d <= x.end)) cutDays++;
    const phases = schedule(st, today, known.kg - rate * cutDays / 7, rate);
    const now = phases.find(p => p.start <= today && (!p.end || today <= p.end)) || phases[0];
    const blockIdx = phases.filter(p => p.type === "cut" && p.start <= now.start).length; // 1-based
    const nextBreak = phases.find(p => p.type === "break" && p.start > today) || null;
    const curBreak = now.type === "break" ? now : null;
    const cutStart = now.type === "cut" ? now.start : null;
    const weekInBlock = cutStart ? Math.floor(diff(cutStart, today) / 7) + 1 : null;

    // Early-break check: from week 8 of a block, a 2-week stall while on target means the break is due.
    let early = null;
    if (now.type === "cut" && weekInBlock >= MIN_BLOCK) {
      // Raw weigh-ins, not the smoothed trend: the trend lags a stall by a week or more.
      const last14 = series.filter(p => p.date > add(today, -14));
      const sl = last14.length >= 6 ? slope(last14) : null;
      const loss = sl != null ? -sl * 13 : null;
      const k = [];
      for (let d = add(today, -13); d <= today; d = add(d, 1)) { const x = eatenKcal(docs, d); if (x) k.push(x); }
      const onTarget = k.length >= 8 && mean(k) <= CUT_KCAL + 150;
      if (loss != null && loss < 0.2 && onTarget) early = { loss, avgKcal: mean(k) };
    }

    const breakKcal = tdee.kcal;
    const lastCut = phases.find(p => p.type === "cut" && p.last);
    const goalDate = lastCut ? add(lastCut.end, 1) : null;
    const plannedBreaks = phases.filter(p => p.type === "break");
    return {
      today, state: st, tdee, trendKg, rate, rateSource: obs != null && obs > 0 ? "trend" : "deficit",
      phases, now, blockIdx, weekInBlock, cutStart, curBreak, nextBreak, early,
      daysToBreak: nextBreak ? diff(today, nextBreak.start) : null,
      breakDay: curBreak ? diff(curBreak.start, today) + 1 : null,
      breakKcal, breakMacros: macros(breakKcal), goalDate, plannedBreaks,
    };
  }

  function target(docs, state, date, opts = {}) {
    const p = build(docs, state, { ...opts, today: opts.today || date });
    const ph = p.phases.find(x => x.start <= date && (!x.end || date <= x.end)) || p.now;
    const mode = ph.type;
    const kcal = mode === "cut" ? CUT_KCAL : p.breakKcal;
    return { mode, kcal, lo: kcal - 150, hi: kcal + 150, ...macros(kcal), protein: PRO, phase: ph };
  }

  // ---------- rendering ----------
  const pill = (c, t) => '<span class="db-pill ' + c + '">' + esc(t) + '</span>';
  const btn = (a, t, ghost) => '<button class="btn ' + (ghost ? "ghost " : "") + 'small" data-db-action="' + a + '">' + esc(t) + '</button>';

  function timeline(p) {
    const shown = p.phases.filter(x => x.end || x.type === "maintain");
    const first = ms(START), lastP = shown[shown.length - 1];
    const lastMs = ms(lastP.end || add(lastP.start, 14));
    const span = Math.max(1, lastMs - first + DAY);
    const pct = t => ((t - first) / span * 100).toFixed(2);
    let bars = "";
    shown.forEach(x => {
      const s = ms(x.start), e = x.end ? ms(x.end) + DAY : lastMs + DAY;
      bars += '<div class="db-seg ' + x.type + '" style="left:' + pct(s) + '%;width:' + ((e - s) / span * 100).toFixed(2) + '%" title="' +
        esc((x.type === "cut" ? "Cut" : x.type === "break" ? "Maintenance break" : "At goal") + ": " + short(x.start) + (x.end ? " – " + short(x.end) : "")) + '"></div>';
    });
    const nowPct = clamp(Number(pct(ms(p.today) + DAY / 2)), 0, 100);
    bars += '<div class="db-now" style="left:' + nowPct + '%"><span>Today</span></div>';
    return '<div class="db-track" role="img" aria-label="Cut and break schedule">' + bars + '</div>' +
      '<div class="db-legend"><span><i class="cut"></i>Cut, ' + fint(CUT_KCAL) + ' kcal</span><span><i class="break"></i>Break, ~' + fint(p.breakKcal) + ' kcal</span><span><i class="maintain"></i>At 80 kg</span></div>';
  }

  function html(docs, state, opts = {}) {
    const p = build(docs, state, opts);
    const m = p.breakMacros;
    const tdeeNote = p.tdee.source === "plan"
      ? "Maintenance is the plan's estimate (2,700–2,900) until there are 2+ weeks of weigh-ins and logged food."
      : "Maintenance " + fint(p.tdee.kcal) + " kcal, " + (p.tdee.source === "estimate" ? "estimated from your logged food and trend weight" : "from your trend weight and calorie burn") + " (" + esc(p.tdee.confidence) + " confidence).";
    let head, body, actions;
    if (p.now.type === "break") {
      const len = diff(p.curBreak.start, p.curBreak.end) + 1;
      head = pill("neutral", "Diet break") + ' <b>Day ' + p.breakDay + ' of ' + len + '</b>';
      body = '<p>Eat at maintenance: <b>~' + fint(p.breakKcal) + ' kcal</b> (' + fint(p.breakKcal - 150) + '–' + fint(p.breakKcal + 150) + '). Protein stays ' + m.protein + ' g; put the extra calories into carbs (~' + m.carbs + ' g) with fat ~' + m.fat + ' g.</p>' +
        '<p class="db-small">Expect the scale to rise 0.5–1.5 kg in the first days. That is glycogen and water, not fat. Keep lifting the same program and the 30 min treadmill. The cut restarts on <b>' + short(add(p.curBreak.end, 1)) + '</b> at 2,000 kcal.</p>';
      actions = btn("end", "End break today", true) + (len === 7 ? btn("length:2", "Make it 2 weeks", true) : btn("length:1", "Make it 1 week", true));
    } else if (p.now.type === "maintain") {
      head = pill("good", "Goal reached") + ' <b>Maintenance</b>';
      body = '<p>Projected at 80 kg. Eat ~' + fint(p.breakKcal) + ' kcal and hold the weight.</p>';
      actions = "";
    } else {
      const due = p.weekInBlock > (p.state.auto ? MAX_BLOCK : p.state.blockWeeks);
      head = pill(p.early || due ? "warn" : "good", p.early ? "Break suggested" : due ? "Break due" : "Cutting") +
        ' <b>Week ' + p.weekInBlock + ' of block ' + p.blockIdx + '</b>';
      if (due && !p.state.auto) body = '<p>Your planned maintenance break is due (' + p.state.blockWeeks + ' weeks of cutting done). Tap <b>Start break today</b> when you are ready; the target stays 2,000 until you do.</p>';
      else if (p.early) body = '<p>Trend weight dropped only ' + f1(p.early.loss) + ' kg in 2 weeks while eating ~' + fint(p.early.avgKcal) + ' kcal. You are past week 8, so start the maintenance break now instead of waiting.</p>';
      else if (p.nextBreak) body = '<p>Next maintenance break: <b>' + short(p.nextBreak.start) + ' – ' + short(p.nextBreak.end) + '</b>' +
        (p.daysToBreak <= 14 ? ' (in ' + p.daysToBreak + ' day' + (p.daysToBreak === 1 ? "" : "s") + ')' : ' (in ' + Math.round(p.daysToBreak / 7) + ' weeks)') +
        ', at ~' + fint(p.breakKcal) + ' kcal a day. Until then stay at 2,000.</p>';
      else body = '<p>No more breaks planned: the last stretch to 80 kg is shorter than a full block.</p>';
      if (p.weekInBlock < MIN_BLOCK) body += '<p class="db-small">Stalls before week 8 are usually water. Ride them out rather than starting a break early.</p>';
      actions = p.weekInBlock >= MIN_BLOCK ? btn("start", "Start break today", !(p.early || due)) : "";
    }
    const goal = p.goalDate ? 'Projected 80 kg around <b>' + longDate(p.goalDate) + '</b> at ~' + f1(p.rate) + ' kg/week (' + (p.rateSource === "trend" ? "your trend" : "from the deficit") + '), including ' + p.plannedBreaks.length + ' break' + (p.plannedBreaks.length === 1 ? "" : "s") + '.' : "";
    const list = p.phases.filter(x => x.type === "break").map(b =>
      '<li>' + short(b.start) + ' – ' + short(b.end) + (b.start <= p.today ? (b.end < p.today ? " · done" : " · now") : "") + '</li>').join("");
    const len = '<div class="db-row db-small">Breaks every ' + p.state.blockWeeks + ' weeks of cutting, ' + p.state.breakWeeks + ' week' + (p.state.breakWeeks === 1 ? "" : "s") + ' long. ' +
      (p.state.blockWeeks > MIN_BLOCK ? btn("block:" + (p.state.blockWeeks - 1), "Sooner", true) : "") +
      (p.state.blockWeeks < MAX_BLOCK ? btn("block:" + (p.state.blockWeeks + 1), "Later", true) : "") + '</div>';
    return '<div class="card db-card"><div class="spread"><h3>Diet breaks</h3><span class="db-small">' + head + '</span></div>' +
      body + (actions ? '<div class="db-row">' + actions + '</div>' : "") +
      timeline(p) +
      (list ? '<ul class="db-list">' + list + '</ul>' : "") +
      (goal ? '<p class="db-small">' + goal + '</p>' : "") +
      '<p class="db-small">' + tdeeNote + '</p>' + len + '</div>';
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

  return { css, build, target, html, apply, estimateTdee, START, CUT_KCAL, PLAN_TDEE };
})();

if (typeof module !== "undefined") module.exports = DietBreak;
