/* Weekly progress report for the Aziz Cut Tracker ("Check progress").
 * Plain JS, no imports, no network. Reads the app's own collections:
 *   docs = { days: {date: {food:[{kcal,p,eaten,...}]}}, weights: {date: {kg}}, workouts: {date: {session, sets:{name:[{w,r}]}}} }
 * API:
 *   WeeklyReport.css                         -> string, inject once (uses the app's tokens)
 *   WeeklyReport.build(docs, {week, today})  -> report object (numbers + verdict lines)
 *   WeeklyReport.html(docs, {week, today})   -> HTML string for the Progress tab
 *   WeeklyReport.summary(docs, {week, today})-> plain-text summary to paste into a chat
 *   WeeklyReport.weekOf(isoDate)             -> week index (0 = the first 7 days from the start date)
 *   WeeklyReport.setTargets(targets)         -> use an AppTargets object (+ optional startKg); opts.targets on build/html/summary does the same
 * Week navigation buttons carry data-wr-week="<n>"; the host handles the click and re-renders.
 * Calories and protein count only food marked eaten (planned food is not counted).
 */
const WeeklyReport = (() => {
  // Plan numbers; setTargets / opts.targets (an AppTargets object, plus optional startKg) replace them.
  const PLAN = { START: "2026-10-25", START_KG: 91.9, GOAL: 80, KCAL: 2000, KCAL_LO: 1850, KCAL_HI: 2150, PRO: 160, PRO_MAX: 170, REVIEW: "2026-11-07" };
  let START, START_KG, GOAL, KCAL, KCAL_LO, KCAL_HI, PRO, PRO_MAX, REVIEW;
  function setTargets(t) {
    t = t || {};
    const n = v => typeof v === "number" && isFinite(v) && v > 0 ? v : typeof v === "string" && v.trim() && isFinite(+v) && +v > 0 ? +v : null;
    const d = v => /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : null;
    START = d(t.start) || PLAN.START; START_KG = n(t.startKg) || PLAN.START_KG; GOAL = n(t.goalKg) || PLAN.GOAL;
    KCAL = n(t.kcal) || PLAN.KCAL;
    const lo = n(t.kcalLo), hi = n(t.kcalHi);
    KCAL_LO = lo && hi ? lo : n(t.kcal) ? KCAL - 150 : PLAN.KCAL_LO; KCAL_HI = lo && hi ? hi : n(t.kcal) ? KCAL + 150 : PLAN.KCAL_HI;
    PRO = n(t.proteinMin) || PLAN.PRO; PRO_MAX = n(t.proteinMax) || (n(t.proteinMin) ? PRO + 10 : PLAN.PRO_MAX);
    REVIEW = d(t.reviewDate) || (d(t.start) ? add(START, 13) : PLAN.REVIEW);
  }
  // [app exercise name, short label, unit, baseline weight, baseline reps]
  const LIFTS = [
    ["Bench Press (Barbell)", "Bench Press", "kg", 90, 8],
    ["Incline DB Press", "Incline DB Press", "lb", 65, 10],
    ["Gundam (Chest Machine)", "Gundam", "kg", 60, 8],
    ["Seated DB Overhead Press", "DB Overhead Press", "lb", 60, 8],
    ["Lat Pulldown, Wide", "Wide Pulldown", "kg", 80, 8],
    ["Seated Row (Cable)", "Seated Row", "kg", 95, 8],
    ["T-Bar Row", "T-Bar Row", "kg", 50, 8],
    ["Hack Squat", "Hack Squat", "kg", 70, 8],
    ["Leg Extension", "Leg Extension", "kg", 122, 8],
    ["Lying Leg Curl", "Lying Leg Curl", "kg", 63, 8],
  ];
  const DAY = 864e5, WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const ms = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => iso(ms(s) + n * DAY);
  const wday = s => new Date(ms(s)).getUTCDay();
  const short = s => { const d = new Date(ms(s)); return MON[d.getUTCMonth()] + " " + d.getUTCDate(); };
  const longDate = t => { const d = new Date(t); return MON[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear(); };
  const weekOf = s => Math.floor((ms(s) - ms(START)) / (7 * DAY));
  const kc = n => Math.round(n).toLocaleString("en-US");
  const reviewLabel = () => new Date(ms(REVIEW)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  setTargets(null);
  const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const num = v => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const fint = n => Math.round(n).toLocaleString("en-US");
  const sgn = (n, d = 1) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n).toFixed(d);
  const e1rm = (w, r) => w * (1 + Math.min(r, 30) / 30);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- adapters from the app's collections ----------
  function dayRow(docs, date) {
    const w = docs.weights && docs.weights[date];
    const food = ((docs.days && docs.days[date] && docs.days[date].food) || []).filter(i => i && i.eaten);
    const wk = docs.workouts && docs.workouts[date];
    const type = wday(date) === 5 ? "free" : wk && wk.session === "Rest" ? "rest" : "training";
    return {
      date, type,
      weight: w ? num(w.kg) : null,
      kcal: food.length ? food.reduce((s, i) => s + (num(i.kcal) || 0), 0) : null,
      protein: food.length ? food.reduce((s, i) => s + (num(i.p) || 0), 0) : null,
      est: food.some(i => i.est),
    };
  }

  function sessions(docs, name, uptoIso) {
    const [, , , bw, br] = LIFTS.find(l => l[0] === name);
    const out = [{ date: "baseline", w: bw, r: br, e: e1rm(bw, br) }];
    Object.values(docs.workouts || {}).filter(x => x && x.date && x.date <= uptoIso && x.sets && x.sets[name])
      .sort((a, b) => a.date < b.date ? -1 : 1)
      .forEach(x => {
        let best = null;
        x.sets[name].forEach(s => { const w = num(s.w), r = num(s.r); if (w && r) { const e = e1rm(w, r); if (!best || e > best.e) best = { date: x.date, w, r, e }; } });
        if (best) out.push(best);
      });
    return out;
  }

  // A drop = estimated max more than 1% below the session before.
  function liftStatus(s) {
    const n = s.length, D = 0.99;
    if (n < 2) return { cls: "none", label: "Not logged", level: 0 };
    if (n >= 3 && s[n - 1].e < s[n - 2].e * D && s[n - 2].e < s[n - 3].e * D) return { cls: "bad", label: "Down 2 in a row", level: 3 };
    if (s[n - 1].e < s[n - 2].e * D) return { cls: "warn", label: "Down", level: 2 };
    if (s[n - 1].e > s[0].e * 1.01) return { cls: "good", label: "Up", level: 1 };
    return { cls: "good", label: "Holding", level: 1 };
  }

  function weekStats(docs, w) {
    const dates = Array.from({ length: 7 }, (_, i) => add(START, w * 7 + i));
    const rows = dates.map(d => dayRow(docs, d));
    const ws = rows.filter(r => r.weight != null).map(r => r.weight);
    const k = rows.filter(r => r.kcal != null), tgt = k.filter(r => r.type !== "free"), pr = rows.filter(r => r.protein != null);
    return {
      w, dates, rows, weighIns: ws.length,
      avg: ws.length ? mean(ws) : null, min: ws.length ? Math.min(...ws) : null, max: ws.length ? Math.max(...ws) : null,
      kcalDays: k.length, kcalAvg: k.length ? mean(k.map(r => r.kcal)) : null,
      targetDays: tgt.length, onTarget: tgt.filter(r => r.kcal >= KCAL_LO && r.kcal <= KCAL_HI).length,
      over: tgt.filter(r => r.kcal > KCAL_HI).length, tooLow: tgt.filter(r => r.kcal < 1700).length,
      freeKcal: k.filter(r => r.type === "free").map(r => r.kcal),
      proDays: pr.length, proHit: pr.filter(r => r.protein >= PRO).length, proAvg: pr.length ? mean(pr.map(r => r.protein)) : null,
    };
  }

  function lastWeek(docs, today) {
    let last = Math.max(0, weekOf(today));
    for (const c of ["weights", "days", "workouts"]) for (const d of Object.keys(docs[c] || {})) if (d >= START) last = Math.max(last, weekOf(d));
    return last;
  }

  function rateVerdict(rate, w) {
    const loss = -rate.pct;
    if (loss > 1) return w === 0
      ? ["neutral", "Fast (expected)", "Faster than 1% a week, which is normal in week 1 from water and glycogen."]
      : ["warn", "Faster than plan", "Losing more than 1% of body weight a week. Fine for a week, but watch strength and hunger."];
    if (loss >= 0.5) return ["good", "On pace", "Inside the 0.5–1% a week target."];
    if (loss > 0) return ["warn", "Slower than plan", "Under 0.5% a week. One slow week is normal; look at the 2-week trend."];
    return ["bad", "Not dropping", "The average did not go down. Check water, salt and logged calories before changing anything."];
  }

  function build(docs, opts = {}) {
    if (opts.targets) setTargets(opts.targets);
    docs = docs || {};
    const today = opts.today || localToday();
    const lastW = lastWeek(docs, today);
    const weeks = [];
    for (let i = 0; i <= lastW; i++) weeks.push(weekStats(docs, i));
    weeks.forEach((s, i) => {
      s.prevAvg = i === 0 ? START_KG : weeks[i - 1].avg;
      s.prevLabel = i === 0 ? "start weigh-in" : "last week's average";
      s.rate = s.avg != null && s.prevAvg != null ? { ch: s.avg - s.prevAvg, pct: (s.avg - s.prevAvg) / s.prevAvg * 100 } : null;
    });
    const week = Math.min(Math.max(0, opts.week ?? Math.min(Math.max(0, weekOf(today)), lastW)), lastW);
    const s = weeks[week], end = s.dates[6];

    const lifts = LIFTS.map(([name, label, unit]) => {
      const ss = sessions(docs, name, end);
      const inWeek = ss.filter(x => x.date !== "baseline" && x.date >= s.dates[0]);
      const best = inWeek.length ? inWeek.reduce((a, b) => b.e > a.e ? b : a) : null;
      return { name, label, unit, base: ss[0], best, vsBase: best ? (best.e / ss[0].e - 1) * 100 : null, status: liftStatus(ss) };
    });

    // Road to 80 kg: latest weekly average up to this week
    let cur = null, curWeek = null;
    for (let i = week; i >= 0; i--) if (weeks[i].avg != null) { cur = weeks[i].avg; curWeek = i; break; }
    let road = null;
    if (cur != null) {
      const left = Math.max(0, cur - GOAL), lost = START_KG - cur, endMs = ms(end);
      const withAvg = weeks.slice(0, week + 1).filter(x => x.avg != null);
      let pace;
      if (withAvg.length >= 2) {
        const a = withAvg[0], b = withAvg[withAvg.length - 1], per = (a.avg - b.avg) / (b.w - a.w);
        pace = per > 0.05
          ? "At your pace of " + f1(per) + " kg a week (week " + (a.w + 1) + " to week " + (b.w + 1) + " averages), about " + Math.ceil(left / per) + " more weeks: around " + longDate(endMs + left / per * 7 * DAY) + "."
          : "Your weekly averages are flat so far, so there is no finish date to estimate yet.";
      } else {
        pace = "At the planned 0.5–0.8 kg a week, about " + Math.ceil(left / 0.8) + "–" + Math.ceil(left / 0.5) + " more weeks: between " + longDate(endMs + left / 0.8 * 7 * DAY) + " and " + longDate(endMs + left / 0.5 * 7 * DAY) + ". Your own pace shows after 2 weekly averages.";
      }
      road = { cur, curWeek, lost, left, pct: Math.max(0, Math.min(100, lost / (START_KG - GOAL) * 100)), pace };
    }

    // Verdict lines: [cls, label, text]
    const v = [];
    if (!s.weighIns) v.push(["none", "No weigh-ins", "No morning weights logged this week yet."]);
    else {
      const avgText = "Average " + f1(s.avg) + " kg, " + sgn(s.rate.ch) + " kg (" + sgn(s.rate.pct, 2) + "%) vs " + s.prevLabel + ". ";
      if (s.weighIns < 4) v.push(["neutral", "Too early", avgText + "Only " + s.weighIns + " of 7 weigh-ins so far. The pace verdict shows from 4 weigh-ins."]);
      else { const [c, l, t] = rateVerdict(s.rate, week); v.push([c, l, avgText + t]); }
    }
    if (s.targetDays) {
      let t = s.onTarget + " of " + s.targetDays + " logged days on target (1,850–2,150 kcal eaten).";
      if (s.over) t += " " + s.over + " over.";
      if (s.tooLow) t += " " + s.tooLow + " under 1,700, which the plan says to avoid.";
      v.push([s.onTarget >= s.targetDays * 0.7 ? "good" : "warn", "Calories", t]);
    } else v.push(["none", "Calories", "No eaten food ticked this week yet."]);
    if (s.proDays) v.push([s.proHit >= s.proDays * 0.7 ? "good" : "warn", "Protein", "Hit " + PRO + " g on " + s.proHit + " of " + s.proDays + " logged days (average " + fint(s.proAvg) + " g)."]);
    const two = lifts.filter(l => l.status.level === 3), one = lifts.filter(l => l.status.level === 2), logged = lifts.filter(l => l.status.level > 0);
    if (two.length) v.push(["bad", "Strength", two.map(l => l.label).join(", ") + " dropped 2 sessions in a row. Check sleep, pre-workout food and volume before touching calories."]);
    else if (one.length) v.push(["warn", "Strength", one.map(l => l.label).join(", ") + " dipped last session. One dip is normal on a cut; act only if it drops again."]);
    else if (logged.length) v.push(["good", "Strength", "All " + logged.length + " logged main lifts are holding or up."]);
    if (end < REVIEW) v.push(["neutral", "Plan", "Keep " + kc(KCAL) + " kcal. The calorie review comes after " + reviewLabel() + ", based on the 2-week average."]);
    else if (end === REVIEW) {
      const a = weeks[0].avg, b = weeks[1] && weeks[1].avg;
      let t = "Log both weeks to get the review.";
      if (a != null && b != null) {
        const p = (b - a) / a * 100;
        t = "Week 2 average is " + sgn(p, 2) + "% vs week 1, " + (-p > 1 ? "faster than target. Keep " + kc(KCAL) + " kcal; don't go lower." : -p >= 0.5 ? "inside target. Keep " + kc(KCAL) + " kcal." : "slower than target. Worth a calorie review.");
      }
      v.push(["neutral", "Review", "14-day tracking ends this week. " + t]);
    }
    return { week, lastWeek: lastW, weeks, s, lifts, road, verdict: v };
  }

  // ---------- rendering ----------
  const pill = (c, t) => '<span class="wr-pill ' + c + '">' + esc(t) + '</span>';
  const stat = (lab, v, sub) => '<div class="wr-stat"><span class="label">' + lab + '</span><span class="v">' + v + '</span><span class="wr-sub">' + sub + '</span></div>';

  function weightSvg(s) {
    const vals = s.rows.filter(r => r.weight != null).map(r => r.weight);
    if (!vals.length) return '<p class="muted wr-empty">No weigh-ins this week. Log one on the Today tab.</p>';
    const refs = [s.avg, s.prevAvg].filter(x => x != null);
    let lo = Math.floor((Math.min(...vals, ...refs) - 0.3) * 2) / 2, hi = Math.ceil((Math.max(...vals, ...refs) + 0.3) * 2) / 2;
    if (hi - lo < 1.5) { const m = (hi + lo) / 2; lo = Math.floor((m - 0.75) * 2) / 2; hi = lo + 1.5; }
    const W = 480, H = 230, L = 40, R = 92, T = 12, B = 30;
    const x = i => L + (W - L - R) * (i + 0.5) / 7, y = v => T + (H - T - B) * (hi - v) / (hi - lo);
    let g = "";
    const step = hi - lo > 3 ? 1 : 0.5;
    for (let v = lo; v <= hi + 1e-9; v += step) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v.toFixed(1) + '</text>';
    s.rows.forEach((r, i) => { g += '<text x="' + x(i) + '" y="' + (H - 10) + '" text-anchor="middle">' + WD[wday(r.date)] + " " + new Date(ms(r.date)).getUTCDate() + '</text>'; });
    const labs = [];
    if (s.prevAvg != null) labs.push({ v: s.prevAvg, t: (s.w === 0 ? "Start " : "Last wk ") + f1(s.prevAvg), dash: true });
    if (s.avg != null) labs.push({ v: s.avg, t: "Avg " + f1(s.avg) });
    if (labs.length === 2 && Math.abs(y(labs[0].v) - y(labs[1].v)) < 14) { const up = labs[0].v > labs[1].v ? 0 : 1; labs[up].off = -7; labs[1 - up].off = 7; }
    labs.forEach(l => {
      g += '<line x1="' + L + '" x2="' + (W - R + 6) + '" y1="' + y(l.v) + '" y2="' + y(l.v) + '" stroke="' + (l.dash ? "var(--muted)" : "var(--accent)") + '" stroke-width="1.5"' + (l.dash ? ' stroke-dasharray="5 4"' : "") + '/>';
      g += '<text class="lab" x="' + (W - R + 10) + '" y="' + (y(l.v) + 4 + (l.off || 0)) + '">' + l.t + '</text>';
    });
    let p = "", on = false;
    s.rows.forEach((r, i) => { if (r.weight == null) { on = false; return; } p += (on ? "L" : "M") + x(i).toFixed(1) + " " + y(r.weight).toFixed(1); on = true; });
    g += '<path d="' + p + '" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>';
    s.rows.forEach((r, i) => { if (r.weight != null) g += '<circle cx="' + x(i) + '" cy="' + y(r.weight) + '" r="5" fill="var(--ink)" stroke="var(--surface)" stroke-width="2"><title>' + WD[wday(r.date)] + " " + short(r.date) + ": " + f1(r.weight) + ' kg</title></circle>'; });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Morning weights this week with the weekly average">' + g + '</svg>';
  }

  function kcalSvg(s) {
    const vals = s.rows.map(r => r.kcal).filter(v => v != null);
    const hi = Math.max(2500, Math.ceil((Math.max(0, ...vals) + 100) / 500) * 500);
    const W = 480, H = 210, L = 44, R = 6, T = 12, B = 30;
    const x = i => L + (W - L - R) * (i + 0.5) / 7, y = v => T + (H - T - B) * (hi - v) / hi;
    const bw = Math.min(44, (W - L - R) / 7 * 0.55);
    let g = '<defs><pattern id="wr-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--surface)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--muted)" stroke-width="2.5"/></pattern></defs>';
    g += '<rect x="' + L + '" y="' + y(KCAL_HI) + '" width="' + (W - L - R) + '" height="' + (y(KCAL_LO) - y(KCAL_HI)) + '" fill="var(--sunk)"/>';
    for (let v = 0; v <= hi; v += 500) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + fint(v) + '</text>';
    g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(KCAL) + '" y2="' + y(KCAL) + '" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="5 4"/>';
    g += '<text class="lab" x="' + (W - R - 4) + '" y="' + (y(KCAL_HI) - 5) + '" text-anchor="end">Target ' + kc(KCAL) + '</text>';
    s.rows.forEach((r, i) => {
      g += '<text x="' + x(i) + '" y="' + (H - 10) + '" text-anchor="middle">' + WD[wday(r.date)] + (r.type === "free" ? "*" : "") + '</text>';
      if (r.kcal == null) { g += '<text x="' + x(i) + '" y="' + (y(0) - 6) + '" text-anchor="middle">—</text>'; return; }
      const h = Math.max(2, y(0) - y(r.kcal)), rx = Math.min(4, h / 2), x0 = x(i) - bw / 2, x1 = x(i) + bw / 2, top = y(0) - h;
      const fill = r.type === "free" ? "url(#wr-hatch)" : r.kcal > KCAL_HI || r.kcal < 1700 ? "var(--warn)" : "var(--accent)";
      g += '<path d="M' + x0 + ' ' + y(0) + 'V' + (top + rx) + 'Q' + x0 + ' ' + top + ' ' + (x0 + rx) + ' ' + top + 'H' + (x1 - rx) + 'Q' + x1 + ' ' + top + ' ' + x1 + ' ' + (top + rx) + 'V' + y(0) + 'Z" fill="' + fill + '"' + (r.type === "free" ? ' stroke="var(--muted)"' : "") + '><title>' + WD[wday(r.date)] + " " + short(r.date) + ": " + fint(r.kcal) + " kcal" + (r.protein != null ? ", " + fint(r.protein) + " g protein" : "") + (r.est ? " (includes estimates)" : "") + '</title></path>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Calories eaten each day against the ' + kc(KCAL) + ' kcal target">' + g + '</svg>';
  }

  function html(docs, opts) {
    const R = build(docs, opts), s = R.s, road = R.road;
    const nav = '<div class="wr-nav"><button class="iconbtn" data-wr-week="' + (R.week - 1) + '" aria-label="Previous week"' + (R.week === 0 ? " disabled" : "") + '>‹</button>' +
      '<div><span class="label">Week ' + (R.week + 1) + '</span><b>' + short(s.dates[0]) + " – " + short(s.dates[6]) + '</b></div>' +
      '<button class="iconbtn" data-wr-week="' + (R.week + 1) + '" aria-label="Next week"' + (R.week >= R.lastWeek ? " disabled" : "") + '>›</button></div>';
    const verdict = '<ul class="wr-verdict">' + R.verdict.map(([c, l, t]) => '<li>' + pill(c, l) + '<span>' + esc(t) + '</span></li>').join("") + '</ul>';
    const weight = '<div class="wr-stats">' +
      stat("7-day average", s.avg != null ? f1(s.avg) + ' <small>kg</small>' : "—", s.weighIns + " of 7 weigh-ins") +
      stat("Change", s.rate ? sgn(s.rate.ch) + ' <small>kg</small>' : "—", s.rate ? sgn(s.rate.pct, 2) + "% vs " + s.prevLabel : "vs " + s.prevLabel) +
      stat("Range", s.min != null ? f1(s.min) + "–" + f1(s.max) : "—", "lowest to highest") + '</div><div class="wr-chart">' + weightSvg(s) + '</div>';
    const tick = v => (START_KG - v) / (START_KG - GOAL) * 100;
    const roadHtml = road
      ? '<div class="wr-stats">' + stat("Lost", f1(road.lost) + ' <small>kg</small>', Math.round(road.pct) + "% of 11.9 kg") + stat("To go", f1(road.left) + ' <small>kg</small>', "from the week " + (road.curWeek + 1) + " average") + stat("Now", f1(road.cur) + ' <small>kg</small>', "goal 80.0 kg") + '</div>' +
        '<div class="prog" role="progressbar" aria-label="Progress to 80 kg" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(road.pct) + '"><i style="width:' + road.pct + '%"></i></div>' +
        '<div class="wr-ticks"><span style="left:0">91.9 start</span><span style="left:' + tick(88) + '%">88</span><span style="left:' + tick(85) + '%">85</span><span style="left:100%">80 goal</span></div>' +
        '<p class="wr-small">' + esc(road.pace) + '</p>'
      : '<p class="muted">Log a weigh-in to see progress.</p>';
    const food = '<div class="wr-stats">' +
      stat("Average eaten", s.kcalAvg != null ? fint(s.kcalAvg) + ' <small>kcal</small>' : "—", s.kcalDays + " of 7 days logged") +
      stat("On target", s.targetDays ? s.onTarget + '<small> / ' + s.targetDays + '</small>' : "—", "1,850–2,150, free day excluded") +
      stat("Protein ≥ " + PRO + " g", s.proDays ? s.proHit + '<small> / ' + s.proDays + '</small>' : "—", s.proAvg != null ? "average " + fint(s.proAvg) + " g" : "nothing logged") +
      stat("Free day", s.freeKcal.length ? s.freeKcal.map(fint).join(", ") + ' <small>kcal</small>' : "—", "Friday, usually under maintenance") + '</div>' +
      '<div class="wr-chart">' + kcalSvg(s) + '</div>' +
      '<div class="wr-pro">' + s.rows.map(r => '<div class="' + (r.protein == null ? "" : r.protein >= PRO ? "ok" : "low") + '"><span>' + WD[wday(r.date)] + '</span><b class="num">' + (r.protein == null ? "—" : fint(r.protein)) + '</b></div>').join("") + '</div>' +
      '<p class="wr-small muted">* Friday free day, not counted against the target. Protein by day in grams. Counts only food ticked as eaten.</p>';
    const set = (l, x) => x.w + " " + l.unit + " × " + x.r;
    const lifts = '<div class="tablewrap"><table><thead><tr><th>Lift</th><th>Baseline</th><th>Best this week</th><th class="n">vs baseline</th><th>Trend</th></tr></thead><tbody>' +
      R.lifts.map(l => '<tr><td>' + esc(l.label) + '</td><td class="num">' + set(l, l.base) + '</td><td class="num">' + (l.best ? set(l, l.best) + ' <span class="muted">' + short(l.best.date) + '</span>' : '<span class="muted">—</span>') + '</td><td class="n">' + (l.vsBase == null ? "—" : sgn(l.vsBase) + "%") + '</td><td>' + pill(l.status.cls, l.status.label) + '</td></tr>').join("") +
      '</tbody></table></div><p class="wr-small muted">Best set compared by estimated 1-rep max. A drop means more than 1% below the session before.</p>';
    const hist = '<div class="tablewrap"><table><thead><tr><th>Week</th><th class="n">Avg weight</th><th class="n">Change</th><th class="n">Avg kcal</th><th class="n">On target</th><th class="n">Protein ≥' + PRO + '</th></tr></thead><tbody>' +
      R.weeks.map(w => '<tr><td><button class="wr-link" data-wr-week="' + w.w + '">Week ' + (w.w + 1) + '</button> <span class="muted">' + short(w.dates[0]) + '</span></td><td class="n">' + (w.avg != null ? f1(w.avg) : "—") + '</td><td class="n">' + (w.rate ? sgn(w.rate.ch) + " kg" : "—") + '</td><td class="n">' + (w.kcalAvg != null ? fint(w.kcalAvg) : "—") + '</td><td class="n">' + (w.targetDays ? w.onTarget + "/" + w.targetDays : "—") + '</td><td class="n">' + (w.proDays ? w.proHit + "/" + w.proDays : "—") + '</td></tr>').join("") +
      '</tbody></table></div>';
    return '<div class="wr">' +
      '<div class="card hero"><div class="spread"><h2>Weekly report</h2>' + nav + '</div>' + verdict + '<div class="row"><button class="btn ghost small" data-wr-copy>Copy summary</button></div></div>' +
      '<section class="grid"><div class="card"><h3>Weight</h3>' + weight + '</div><div class="card"><h3>Road to 80 kg</h3>' + roadHtml + '</div></section>' +
      '<div class="card"><div class="spread"><h3>Calories and protein</h3><span class="muted wr-small">Target ' + kc(KCAL) + ' kcal and ' + PRO + '–' + PRO_MAX + ' g protein</span></div>' + food + '</div>' +
      '<div class="card"><h3>Main lifts</h3>' + lifts + '</div>' +
      '<div class="card"><h3>All weeks</h3>' + hist + '</div>' +
      '</div>';
  }

  function summary(docs, opts) {
    const R = build(docs, opts), s = R.s;
    const out = ["Week " + (R.week + 1) + " (" + short(s.dates[0]) + " – " + short(s.dates[6]) + ")"];
    R.verdict.forEach(([, l, t]) => out.push("- " + l + ": " + t));
    s.rows.forEach(r => {
      const b = [r.weight != null ? f1(r.weight) + " kg" : null, r.kcal != null ? fint(r.kcal) + " kcal" : null, r.protein != null ? fint(r.protein) + " g P" : null].filter(Boolean);
      if (b.length) out.push("  " + WD[wday(r.date)] + " " + short(r.date) + ": " + b.join(", ") + (r.type === "free" ? " (free day)" : ""));
    });
    R.lifts.filter(l => l.best).forEach(l => out.push("  " + l.label + ": " + l.best.w + " " + l.unit + " × " + l.best.r + " (" + l.status.label + ")"));
    return out.join("\n");
  }

  const css = [
    ".wr{display:flex;flex-direction:column;gap:18px}",
    ".wr-nav{display:flex;align-items:center;gap:8px;text-align:center}.wr-nav b{display:block;font-family:var(--display);font-size:1.15rem}",
    ".wr-nav .iconbtn:disabled{opacity:.4;cursor:default}",
    ".wr-verdict{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}",
    ".wr-verdict li{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start}",
    ".wr-pill{display:inline-block;border-radius:999px;padding:2px 10px;font-size:.78rem;font-weight:600;border:1px solid currentColor;white-space:nowrap}",
    ".wr-pill.good{color:var(--good)}.wr-pill.warn{color:var(--warn)}.wr-pill.bad{color:var(--bad)}.wr-pill.neutral{color:var(--accent)}.wr-pill.none{color:var(--muted)}",
    ".wr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px}",
    ".wr-stat{display:flex;flex-direction:column;gap:2px}.wr-stat .v{font-family:var(--display);font-size:1.8rem;font-weight:700;line-height:1.05}",
    ".wr-stat .v small{font-size:1rem;color:var(--muted)}.wr-sub,.wr-small{font-size:.85rem;color:var(--muted)}",
    ".wr-chart svg{display:block;width:100%;height:auto;overflow:visible}.wr-chart text{fill:var(--muted);font-family:var(--body);font-size:13px}.wr-chart .lab{fill:var(--ink);font-weight:600}",
    ".wr-empty{padding:24px 8px;text-align:center}",
    ".wr-ticks{position:relative;height:18px;font-size:.75rem;color:var(--muted)}.wr-ticks span{position:absolute;transform:translateX(-50%);white-space:nowrap}",
    ".wr-ticks span:first-child{transform:none}.wr-ticks span:last-child{transform:translateX(-100%)}",
    ".wr-pro{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}",
    ".wr-pro div{border:1px solid var(--line);border-radius:8px;padding:5px 2px;text-align:center;display:flex;flex-direction:column}",
    ".wr-pro span{font-size:.7rem;color:var(--muted)}.wr-pro .ok{border-color:var(--good)}.wr-pro .ok b{color:var(--good)}.wr-pro .low b{color:var(--warn)}",
    ".wr-link{border:0;background:none;padding:0;color:var(--accent);font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:3px}",
  ].join("\n");

  return { css, build, html, summary, weekOf, setTargets, get START() { return START; }, LIFTS };
})();
