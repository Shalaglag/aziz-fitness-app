/* Goal date to 80 kg for the Aziz Cut Tracker.
 * Plain JS, no imports, no network. Reads the app's weights collection:
 *   weights = { "YYYY-MM-DD": {date, kg} }  (an array of {date, kg} works too)
 * API:
 *   GoalDate.css                               -> string, inject once (uses the app's tokens)
 *   GoalDate.trend(weights, {alpha})           -> [{date, kg, trend}] smoothed weight (EWMA, gap-aware)
 *   GoalDate.project(weights, {today, trend})  -> projection object (see below)
 *   GoalDate.html(weights, {today, trend})     -> card body HTML for the Progress tab
 *   GoalDate.compact(weights, {today, trend})  -> one-line HTML for the Today tab
 * opts.trend: optional series from the trend weight module, TrendTDEE.series(weights, {today}) -> [{date, kg, trend}].
 *   When given it is used as is, so both features show the same trend line. Without it the same
 *   smoothing is computed here (daily interpolation + EWMA 0.1). The weekly rate is always a
 *   least-squares slope on raw weigh-ins over the last 28 days, needing 5+ weigh-ins across 14+ days.
 * project() returns
 *   {status, today, current, start, goal, ratePerWeek, goalDate, range:{early, late}, daysLeft,
 *    weeksLeft, pctDone, milestones:[{kg, reachedOn, eta}], note}
 *   status: "empty" | "plan" (too little data, dates use the 0.5–0.8 kg/wk plan pace)
 *           | "trend" (dates from the trend slope) | "stalled" (trend not going down) | "reached"
 */
const GoalDate = (() => {
  const START = "2026-10-25", START_KG = 91.9, GOAL = 80, MILESTONES = [90, 85, 80];
  const ALPHA = 0.1, WINDOW = 28, MIN_SPAN = 14, MIN_POINTS = 5;
  const PLAN_FAST = 0.8, PLAN_SLOW = 0.5, WATER_FAST = 1.2, STALL = 0.1, RECENT = 14;
  const DAY = 864e5, WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const ms = d => Date.parse(d + "T00:00:00Z");
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const add = (d, n) => iso(ms(d) + Math.round(n) * DAY);
  const days = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const r1 = n => Math.round(n * 10) / 10;
  const todayIso = () => { const n = new Date(); return iso(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
  // Dates show the year only when it differs from the year of `ref` (today).
  const yr = (d, ref) => (d.slice(0, 4) !== String(ref || "").slice(0, 4) ? ", " + d.slice(0, 4) : "");
  const fmt = (d, ref) => { const t = new Date(ms(d)); return WD[t.getUTCDay()] + ", " + MON[t.getUTCMonth()] + " " + t.getUTCDate() + yr(d, ref); };
  const fmtShort = (d, ref) => { const t = new Date(ms(d)); return MON[t.getUTCMonth()] + " " + t.getUTCDate() + yr(d, ref); };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function clean(weights) {
    const list = Array.isArray(weights) ? weights : Object.values(weights || {});
    return list.filter(w => w && /^\d{4}-\d{2}-\d{2}$/.test(w.date) && +w.kg > 30 && +w.kg < 250)
      .map(w => ({ date: w.date, kg: +w.kg })).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // Same smoothing as TrendTDEE.series: one point per calendar day, gaps filled by linear interpolation
  // between weigh-ins, then an EWMA (alpha 0.1) seeded at the first weigh-in. kg is null on filled days.
  function trend(weights, opts = {}) {
    const a = opts.alpha || ALPHA, ws = clean(weights), out = [];
    let t = null;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i], next = ws[i + 1];
      const gap = next ? days(w.date, next.date) : 1;
      for (let d = 0; d < gap; d++) {
        const v = w.kg + (next ? (next.kg - w.kg) * d / gap : 0);
        t = t == null ? v : t + a * (v - t);
        out.push({ date: add(w.date, d), kg: d ? null : w.kg, trend: Math.round(t * 100) / 100 });
      }
    }
    return out;
  }

  function fromExternal(series) {
    return (series || []).map(p => ({ date: p.date, kg: p.kg ?? null, trend: +(p.trend ?? p.kg) }))
      .filter(p => p.date && isFinite(p.trend)).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // Least-squares slope (kg/day) and its standard error over points [{x: day number, y: kg}].
  function fit(pts) {
    const n = pts.length, mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
    let sxx = 0, sxy = 0;
    for (const p of pts) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); }
    const b = sxx ? sxy / sxx : 0, a = my - b * mx;
    const rss = pts.reduce((s, p) => s + (p.y - a - b * p.x) ** 2, 0);
    const se = n > 2 && sxx ? Math.sqrt(rss / (n - 2) / sxx) : 0;
    return { a, b, se };
  }

  function project(weights, opts = {}) {
    const today = opts.today || todayIso(), goal = opts.goal || GOAL;
    const raw = clean(weights).filter(w => w.date <= today);
    const series = (opts.trend ? fromExternal(opts.trend) : trend(raw)).filter(p => p.date <= today);
    const base = { today, goal, start: START_KG, milestones: [], range: { early: null, late: null } };
    if (!series.length) {
      return Object.assign(base, { status: "empty", current: null, ratePerWeek: null, goalDate: null, daysLeft: null, weeksLeft: null, pctDone: 0,
        note: "Log a morning weigh-in to get your goal date." });
    }
    // Anchor on the last real weigh-in: a series padded to today holds the trend flat after it.
    const last = series.filter(p => p.kg != null).pop() || series[series.length - 1], current = last.trend;
    const pctDone = Math.max(0, Math.min(100, (START_KG - current) / (START_KG - goal) * 100));
    const reachedOn = kg => { const p = series.find(s => s.trend <= kg); return p ? p.date : null; };
    const ms_ = (kg, eta) => ({ kg, reachedOn: reachedOn(kg), eta: reachedOn(kg) ? null : eta(kg) });
    const marks = MILESTONES.filter(k => k >= goal);

    if (current <= goal) {
      return Object.assign(base, { status: "reached", current, ratePerWeek: null, goalDate: reachedOn(goal), daysLeft: 0, weeksLeft: 0, pctDone: 100,
        milestones: marks.map(k => ms_(k, () => null)), note: "You reached " + goal + " kg. Time to plan maintenance." });
    }

    // Rate is a least-squares slope on the raw weigh-ins of the last 28 days (as TrendTDEE does): the EWMA lags.
    const from = add(last.date, -(WINDOW - 1));
    const win = raw.filter(w => w.date >= from && w.date <= last.date);
    const span = win.length ? days(win[0].date, last.date) : 0;
    const left = current - goal;
    // The trend's own date is the anchor: projections count forward from the last weigh-in, not from today.
    const at = (rate, kg) => add(last.date, (current - kg) / rate * 7);

    if (win.length < MIN_POINTS || span < MIN_SPAN) {
      const eta = kg => at((PLAN_FAST + PLAN_SLOW) / 2, kg);
      return Object.assign(base, {
        status: "plan", current, ratePerWeek: null, pctDone,
        goalDate: eta(goal), range: { early: at(PLAN_FAST, goal), late: at(PLAN_SLOW, goal) },
        daysLeft: days(today, eta(goal)), weeksLeft: r1(left / ((PLAN_FAST + PLAN_SLOW) / 2)),
        milestones: marks.map(k => ms_(k, eta)),
        note: "Based on the plan pace of " + PLAN_SLOW + "–" + PLAN_FAST + " kg a week. Your own trend takes over once you have " +
          MIN_POINTS + "+ weigh-ins across 2 weeks (" + (win.length >= MIN_POINTS ? "from " : "earliest ") + fmtShort(add(win.length ? win[0].date : last.date, MIN_SPAN), today) + ").",
      });
    }

    const f = fit(win.map(w => ({ x: days(START, w.date), y: w.kg })));
    const rate = -f.b * 7;
    const recent = win.filter(w => w.date >= add(last.date, -(RECENT - 1)));
    const recentRate = recent.length >= 4 ? -fit(recent.map(w => ({ x: days(START, w.date), y: w.kg }))).b * 7 : rate;
    if (rate < STALL || recentRate < STALL) {
      return Object.assign(base, { status: "stalled", current, ratePerWeek: r1(Math.min(rate, recentRate)) || 0, goalDate: null, daysLeft: null, weeksLeft: null, pctDone,
        milestones: marks.map(k => ms_(k, () => null)),
        note: "Your weight has not gone down over the last " + (rate < STALL ? Math.round(span / 7) : 2) + " weeks, so there's no date to show. Check the weekly report before changing calories." });
    }
    const fast = -(f.b - f.se) * 7, slow = -(f.b + f.se) * 7;
    const eta = kg => at(rate, kg);
    const note = rate > WATER_FAST && days(START, last.date) < 28
      ? "Early weeks include water loss, so this date will likely move later as the trend settles."
      : rate < PLAN_SLOW ? "Slower than the " + PLAN_SLOW + "–" + PLAN_FAST + " kg a week plan." : rate > PLAN_FAST ? "Faster than the " + PLAN_SLOW + "–" + PLAN_FAST + " kg a week plan." : "On the plan pace of " + PLAN_SLOW + "–" + PLAN_FAST + " kg a week.";
    return Object.assign(base, {
      status: "trend", current, ratePerWeek: r1(rate), pctDone,
      goalDate: eta(goal), range: { early: at(fast, goal), late: slow > 0.05 ? at(slow, goal) : null },
      daysLeft: days(today, eta(goal)), weeksLeft: r1(left / rate),
      milestones: marks.map(k => ms_(k, eta)), note,
    });
  }

  function rangeText(p) {
    const { early, late } = p.range;
    if (!early || early === late) return "";
    if (!late) return "earliest " + fmtShort(early, p.today);
    const sameYear = early.slice(0, 4) === late.slice(0, 4);
    return (sameYear ? fmtShort(early, late) : fmtShort(early, p.today)) + " – " + fmtShort(late, p.today);
  }

  function html(weights, opts = {}) {
    const p = project(weights, opts);
    if (p.status === "empty") return '<div class="gd"><p class="gd-sub">' + esc(p.note) + "</p></div>";
    const head = p.status === "reached"
      ? '<div class="gd-big">' + esc(p.goal) + " kg reached</div><div class=\"gd-sub\">" + (p.goalDate ? "On " + esc(fmt(p.goalDate, p.today)) : "") + "</div>"
      : p.status === "stalled"
        ? '<div class="gd-big">No date yet</div><div class="gd-sub">Trend ' + esc(r1(p.current)) + " kg, not going down</div>"
        : '<div class="gd-big">' + esc(fmt(p.goalDate, p.today)) + '</div><div class="gd-sub">' +
          (p.status === "plan" ? "Plan estimate" : "At " + esc(p.ratePerWeek) + " kg a week") + " · " + esc(p.weeksLeft) + " weeks to go" +
          (rangeText(p) ? " · likely " + esc(rangeText(p)) : "") + "</div>";
    const bar = '<div class="gd-bar" role="img" aria-label="' + Math.round(p.pctDone) + '% of the way from ' + START_KG + " to " + p.goal + ' kg"><i style="width:' + p.pctDone.toFixed(1) + '%"></i>' +
      p.milestones.map(m => '<b class="' + (m.reachedOn ? "on" : "") + '" style="left:' + ((START_KG - m.kg) / (START_KG - p.goal) * 100).toFixed(1) + '%"></b>').join("") + "</div>" +
      '<div class="gd-ends"><span>' + START_KG + " kg</span><span>Trend " + r1(p.current) + " kg</span><span>" + p.goal + " kg</span></div>";
    const list = '<ul class="gd-ms">' + p.milestones.map(m => "<li" + (m.reachedOn ? ' class="on"' : "") + "><b>" + m.kg + " kg</b><span>" +
      (m.reachedOn ? "Reached " + esc(fmtShort(m.reachedOn, p.today)) : m.eta ? esc(fmt(m.eta, p.today)) : "–") + "</span></li>").join("") + "</ul>";
    return '<div class="gd">' + head + bar + list + '<p class="gd-note">' + esc(p.note) + "</p></div>";
  }

  function compact(weights, opts = {}) {
    const p = project(weights, opts);
    if (p.status === "empty") return "";
    const next = p.milestones.find(m => !m.reachedOn && m.eta && m.kg !== p.goal);
    const txt = p.status === "reached" ? "You reached " + p.goal + " kg."
      : p.status === "stalled" ? "Trend " + r1(p.current) + " kg and flat, no goal date yet."
        : p.goal + " kg around <b>" + esc(fmtShort(p.goalDate, p.today)) + "</b>" + (p.status === "plan" ? " (plan pace)" : "") +
          (next ? " · " + next.kg + " kg by " + esc(fmtShort(next.eta, p.today)) : "");
    return '<div class="gd-line">' + txt + "</div>";
  }

  const css = [
    ".gd{display:flex;flex-direction:column;gap:10px}",
    ".gd-big{font-family:var(--display);font-size:1.8rem;font-weight:700;line-height:1.05}",
    ".gd-sub,.gd-note,.gd-ends{font-size:.85rem;color:var(--muted)}.gd-note{margin:0}",
    ".gd-bar{position:relative;height:10px;border-radius:999px;background:var(--sunk);margin-top:4px}",
    ".gd-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:inherit;background:var(--accent);transition:width .4s}",
    ".gd-bar b{position:absolute;top:-3px;width:4px;height:16px;margin-left:-2px;border-radius:2px;background:var(--line)}.gd-bar b.on{background:var(--good)}",
    ".gd-ends{display:flex;justify-content:space-between}",
    ".gd-ms{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}",
    ".gd-ms li{border:1px solid var(--line);border-radius:var(--r,10px);padding:6px 8px;display:flex;flex-direction:column;gap:2px}",
    ".gd-ms li span{font-size:.8rem;color:var(--muted)}.gd-ms li.on{border-color:var(--good)}.gd-ms li.on b{color:var(--good)}",
    ".gd-line{font-size:.92rem;color:var(--muted)}.gd-line b{color:var(--ink)}",
  ].join("\n");

  return { css, trend, project, html, compact, START, START_KG, GOAL, MILESTONES };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GoalDate;
