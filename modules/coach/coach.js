/* 14-day progress review + "Patterns in your logs" for the Mizan app (global Coach, name kept for
 * data and wiring compatibility). Rule-based only: no Claude, no network, no API key. The AI chat
 * ("Ask Claude" panel, server endpoint, proposed actions) was removed on Nov 2, 2026.
 * Reads the app's own collections (S.docs):
 *   weights/{date}.kg, days/{date}.food[{kcal,p,eaten,est}] (+ sleep, steps, water, waterh.ml),
 *   workouts/{date}{session, sets:{name:[{w,r}]}, effort, deload}, lb_workouts, prefs.main{profile, dietBreak}
 * API:
 *   Coach.css                                   -> string, inject once (uses the app's tokens)
 *   Coach.targets(docs, opts)                   -> {kcal, proteinMin, proteinMax, band, floor, paceLo, paceHi, start}
 *   Coach.periods(docs, {today})                -> [{from, to, end, partial}] 14-day blocks from the start
 *   Coach.review(docs, {today, from?, effort?}) -> the 14-day review (verdict, checks, recommendations)
 *   Coach.reviewHtml(docs, opts)                -> Progress card: the review, with period arrows
 *   Coach.summary(review)                       -> plain text of a review
 *   Coach.liftHistory(docs, today)              -> per-lift last 5 sessions, best e1RM, PR flag
 *   Coach.insights(docs, opts)                  -> up to 3 local insights [{id, kind, title, text, evidence}];
 *        opts.seen {id: date} hides ones shown in the last opts.repeatDays (7); opts.strength adds balance
 *   Coach.insightsHtml(docs, opts)              -> "Patterns in your logs" card
 *   Coach.bind(root, opts)                      -> wire the cards once (delegated on root)
 *        opts = { getDocs, render, today?, targets?, rules?, plan?, kcalTarget?,
 *                 onApply?: change => void,    // only called on a tap; omit it and no "Use" button is shown
 *                 onDismiss?: id => void }     // an insight was dismissed
 * Rules: only food marked eaten counts; nothing is assumed for days without logs; a target change is only
 * ever a suggestion with its reasons, and is applied by the host after an explicit tap.
 */
const Coach = (() => {
  const DAY = 864e5, BLOCK = 14, KCAL_PER_KG = 7700;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Coaching rules, not personal targets: on-target band, safety floor for a suggested cut, size of one
  // suggested change, and the healthy loss pace in % of body weight a week. Overridable via opts.rules.
  const RULES = { band: 150, floor: 1800, step: 150, paceLo: 0.5, paceHi: 1.0 };

  const ms = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => iso(ms(s) + n * DAY);
  const diff = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const dow = s => new Date(ms(s)).getUTCDay(); // 5 = Friday
  const short = s => { const d = new Date(ms(s)); return MON[d.getUTCMonth()] + " " + d.getUTCDate(); };
  const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const num = v => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const pos = v => { const n = num(v); return n != null && n > 0 ? n : null; };
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const fint = n => Math.round(n).toLocaleString("en-US");
  const r50 = n => Math.round(n / 50) * 50;
  const sgn = (n, d = 1) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n).toFixed(d);
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dates = (from, to) => { const out = []; for (let d = from; d <= to; d = add(d, 1)) out.push(d); return out; };

  /* ---------- reading the app's data ---------- */
  function weighIns(weights) {
    return Object.entries(weights || {})
      .map(([k, w]) => ({ date: isDate(w && w.date) ? w.date : k, kg: num(w && w.kg) }))
      .filter(w => isDate(w.date) && w.kg != null && w.kg > 20 && w.kg < 400)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  // Eaten totals for a day, or null when nothing on it is marked eaten (an unlogged day, not a 0 kcal day).
  function eaten(day) {
    const food = Array.isArray(day && day.food) ? day.food : [];
    const ate = food.filter(i => i && i.eaten);
    if (!ate.length) return null;
    return {
      kcal: ate.reduce((s, i) => s + (pos(i.kcal) || 0), 0),
      p: ate.reduce((s, i) => s + (pos(i.p) || 0), 0),
      est: ate.filter(i => i.est).length,
      planned: food.filter(i => i && !i.eaten).length,
    };
  }
  const epley = (w, r) => r === 1 ? w : w * (1 + r / 30);
  const LB = 0.45359237;
  const localDate = t => { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const prettyId = id => String(id || "").replace(/^c-/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  // One list of sessions from both logs: the full logger (lb_workouts, per-set units and set types) wins
  // for a date; Quick log (workouts/{date}.sets) fills dates the logger has nothing for. Weights in kg.
  function workoutList(docs) {
    docs = docs || {};
    const shell = docs.workouts || {}, names = docs.lb_exercises || {}, byDate = {};
    Object.values(docs.lb_workouts || {}).forEach(w => {
      if (!w || !num(w.start) || !Array.isArray(w.exercises)) return;
      const date = localDate(num(w.start)), lifts = {};
      w.exercises.forEach(e => {
        if (!e || !Array.isArray(e.sets)) return;
        const name = (names[e.exId] && names[e.exId].name) || e.name || prettyId(e.exId);
        const sets = e.sets.filter(s => s && s.t !== "w" && s.done !== false && pos(s.w) && pos(s.r)).map(s => ({ kg: e.unit === "lb" ? pos(s.w) * LB : pos(s.w), r: pos(s.r) }));
        if (sets.length) lifts[name] = (lifts[name] || []).concat(sets);
      });
      const d = byDate[date] || (byDate[date] = { date, session: w.templateName || w.name || null, lifts: {}, src: "logger" });
      Object.entries(lifts).forEach(([n, s]) => { d.lifts[n] = (d.lifts[n] || []).concat(s); });
    });
    Object.entries(shell).forEach(([k, wo]) => {
      const date = isDate(wo && wo.date) ? wo.date : k;
      if (!isDate(date) || !wo) return;
      let d = byDate[date];
      if (!d) {
        const lifts = {};
        Object.entries(wo.sets && typeof wo.sets === "object" ? wo.sets : {}).forEach(([name, sets]) => {
          const ok = (Array.isArray(sets) ? sets : []).filter(s => s && !s.warmup && pos(s.w) && pos(s.r)).map(s => ({ kg: s.unit === "lb" ? pos(s.w) * LB : pos(s.w), r: pos(s.r) }));
          if (ok.length) lifts[name] = ok;
        });
        d = byDate[date] = { date, session: wo.session || null, lifts, src: "quick" };
      }
      d.effort = num(wo.effort); d.deload = !!wo.deload;
      if (!d.session && wo.session) d.session = wo.session;
    });
    return Object.values(byDate).sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  function bestLifts(list, from, to) {
    const best = {};
    list.forEach(w => {
      if (w.date < from || w.date > to) return;
      Object.entries(w.lifts).forEach(([name, sets]) => sets.forEach(s => {
        if (s.r > 15) return;
        const e = epley(s.kg, s.r);
        if (!best[name] || e > best[name].e1rm) best[name] = { e1rm: e, w: Math.round(s.kg * 10) / 10, r: s.r, date: w.date };
      }));
    });
    return best;
  }
  const sessions = (list, from, to) => list.filter(w => w.date >= from && w.date <= to && Object.keys(w.lifts).length);
  function fit(points) { // least squares kg ~ day
    const n = points.length;
    if (n < 2) return null;
    const mx = mean(points.map(p => p.x)), my = mean(points.map(p => p.y));
    let sxy = 0, sxx = 0;
    points.forEach(p => { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; });
    return sxx ? { slope: sxy / sxx } : null;
  }

  /* ---------- targets and periods ---------- */
  // Personal numbers come from AppTargets (opts.targets = AppTargets.resolve(...)); with no host object,
  // only what the profile says. Nothing personal is hard-coded: a missing target stays null.
  function targets(docs, opts = {}) {
    const pr = ((docs && docs.prefs && docs.prefs.main) || {}).profile || {};
    let A = opts.targets;
    if (!A && typeof AppTargets !== "undefined" && AppTargets && AppTargets.resolve) { try { A = AppTargets.resolve(pr, {}); } catch (e) { A = null; } }
    A = A || { kcal: pos(pr.cutKcal), proteinMin: pos(pr.protein), proteinMax: pos(pr.protein) ? pos(pr.protein) + 10 : null, start: pr.start };
    const T = Object.assign({}, RULES);
    T.kcal = pos(A.kcal); T.proteinMin = pos(A.proteinMin); T.proteinMax = pos(A.proteinMax) || T.proteinMin;
    if (pos(A.kcalLo) && pos(A.kcalHi) && A.kcalHi > A.kcalLo) T.band = Math.round((A.kcalHi - A.kcalLo) / 2);
    // The goal plan (prefs/main.goalSetup, from GoalSetup): direction and chosen pace set the band the review judges against.
    const gp = opts.plan && opts.plan.result && opts.plan.result.ok ? opts.plan : null;
    T.plan = null;
    if (gp) {
      const r = gp.result, a = gp.answers || {}, pct = pos(r.ratePct) || 0;
      T.plan = { goal: r.goal, direction: r.direction, ratePct: pct, rateKgWk: pos(r.rateKgWk) || 0, pace: r.pace || null, activity: r.activity || a.activity || null,
        sex: a.sex || null, age: pos(a.age), heightCm: pos(a.heightCm), kg: pos(a.kg), targetKg: pos(r.profile && r.profile.goalKg), endDate: isDate(r.endDate) ? r.endDate : null, kcal: pos(r.kcal), since: isDate(r.today) ? r.today : null };
      if (r.direction === 0) { T.paceLo = 0; T.paceHi = 0; }
      else if (pct) { T.paceLo = Math.round(Math.max(0.2, pct * 0.6) * 100) / 100; T.paceHi = Math.round(Math.min(1.2, pct * 1.5) * 100) / 100; }
    }
    ["paceLo", "paceHi", "floor", "step", "band"].forEach(k => { if (pos((opts.rules || {})[k])) T[k] = pos(opts.rules[k]); });
    const firstW = weighIns(docs && docs.weights)[0];
    const firstFood = Object.keys((docs && docs.days) || {}).filter(d => isDate(d) && eaten(docs.days[d])).sort()[0];
    T.start = isDate(A.start) ? A.start : [firstW && firstW.date, firstFood].filter(Boolean).sort()[0] || null;
    return T;
  }
  function periods(docs, opts = {}) {
    const today = isDate(opts.today) ? opts.today : localToday();
    const T = targets(docs, opts), out = [];
    if (!T.start) return out;
    const last = add(today, -1); // today is half-logged, so a review ends yesterday at the latest
    for (let from = T.start; from <= last; from = add(from, BLOCK)) {
      const end = add(from, BLOCK - 1);
      out.push({ from, end, to: end < last ? end : last, partial: end > last });
    }
    return out;
  }

  /* ---------- the 14-day review ---------- */
  function review(docs, opts = {}) {
    docs = docs || {};
    const today = isDate(opts.today) ? opts.today : localToday();
    const T = targets(docs, opts);
    const ps = periods(docs, Object.assign({}, opts, { today }));
    let P = isDate(opts.from) ? ps.find(p => p.from === opts.from) : null;
    if (!P) P = ps.filter(p => !p.partial).pop() || ps[ps.length - 1] || null;
    const R = { today, targets: T, period: P, verdict: "empty", headline: "", checks: [], recs: [], missing: [], numbers: {} };
    if (!P) { R.headline = "Log a weigh-in and a day of food to start your first 14-day review."; return R; }
    const { from, to } = P, span = dates(from, to), mid = add(from, 7);
    const N = R.numbers;
    N.days = span.length;

    // weight
    const ws = weighIns(docs.weights).filter(w => w.date >= from && w.date <= to);
    const early = ws.filter(w => w.date < mid), late = ws.filter(w => w.date >= mid);
    N.weighIns = ws.length;
    N.avgEarly = mean(early.map(w => w.kg)); N.avgLate = mean(late.map(w => w.kg));
    const f = ws.length >= 4 && diff(ws[0].date, ws[ws.length - 1].date) >= 6 ? fit(ws.map(w => ({ x: diff(from, w.date), y: w.kg }))) : null;
    N.rateKgWk = f ? f.slope * 7 : (N.avgEarly != null && N.avgLate != null ? N.avgLate - N.avgEarly : null);
    N.avgKg = mean(ws.map(w => w.kg));
    N.lossPctWk = N.rateKgWk != null && N.avgKg ? -N.rateKgWk / N.avgKg * 100 : null;
    const dir = T.plan ? T.plan.direction : -1;                     // -1 cut (default), +1 gain, 0 maintain
    N.progressPctWk = N.lossPctWk == null ? null : dir >= 0 ? -N.lossPctWk : N.lossPctWk;   // % a week in the planned direction
    const weightOk = ws.length >= 6 && early.length >= 2 && late.length >= 2;

    // food
    const food = span.map(d => ({ date: d, fri: dow(d) === 5, e: eaten((docs.days || {})[d]) }));
    const logged = food.filter(x => x.e), core = logged.filter(x => !x.fri);
    const tgt = d => (typeof opts.kcalTarget === "function" && pos(opts.kcalTarget(d))) || T.kcal;
    const hasK = T.kcal != null, hasP = T.proteinMin != null;
    N.foodDays = logged.length;
    N.unlogged = food.filter(x => !x.e).map(x => x.date);
    N.kcalAvg = mean(logged.map(x => x.e.kcal));
    N.proteinAvg = mean(logged.map(x => x.e.p));
    N.onTarget = hasK ? core.filter(x => Math.abs(x.e.kcal - tgt(x.date)) <= T.band).length : null;
    N.over = hasK ? core.filter(x => x.e.kcal > tgt(x.date) + T.band).length : null;
    N.under = hasK ? core.filter(x => x.e.kcal < tgt(x.date) - T.band).length : null;
    N.coreDays = core.length;
    N.adherence = hasK && core.length ? N.onTarget / core.length : null;
    N.proteinHit = hasP ? logged.filter(x => x.e.p >= T.proteinMin).length : null;
    N.estDays = logged.filter(x => x.e.est).length;
    const fris = logged.filter(x => x.fri);
    N.fridayAvg = mean(fris.map(x => x.e.kcal));
    const foodOk = logged.length >= 7;

    // training
    const WL = workoutList(docs), ss = sessions(WL, from, to);
    N.sessions = ss.length;
    N.sets = ss.reduce((s, w) => s + Object.values(w.lifts).reduce((a, x) => a + x.length, 0), 0);
    const efforts = ss.map(w => num(w.effort)).filter(e => e != null && e >= 1 && e <= 10);
    N.effortAvg = mean(efforts);
    const before = bestLifts(WL, add(from, -7), add(mid, -1)), after = bestLifts(WL, mid, to);
    N.lifts = Object.keys(after).filter(n => before[n]).map(name => {
      const change = after[name].e1rm / before[name].e1rm - 1;
      return { name, before: before[name], after: after[name], change, status: change > 0.01 ? "up" : change < -0.02 ? "down" : "held" };
    }).sort((a, b) => a.change - b.change);
    const down = N.lifts.filter(l => l.status === "down").length;
    N.liftsDown = down; N.liftsUp = N.lifts.filter(l => l.status === "up").length;
    N.deloadInWindow = ss.some(w => w.deload);

    // recovery
    const sleeps = span.map(d => num(((docs.days || {})[d] || {}).sleep)).filter(h => h != null && h > 0 && h <= 16);
    N.sleepNights = sleeps.length; N.sleepAvg = mean(sleeps);
    const steps = span.map(d => pos(((docs.days || {})[d] || {}).steps)).filter(Boolean);
    N.stepDays = steps.length; N.stepsAvg = mean(steps);

    // diet break overlap
    const breaks = (((docs.prefs || {}).main || {}).dietBreak || {}).breaks || [];
    N.breakDays = span.filter(d => breaks.some(b => b && isDate(b.start) && d >= b.start && (!isDate(b.end) || d <= b.end))).length;

    // ---- checks ----
    const chk = (key, label, status, value, detail) => R.checks.push({ key, label, status, value, detail });
    if (!ws.length) chk("weight", "Weight", "none", "No weigh-ins", "Weigh in each morning after the bathroom, before food.");
    else if (N.rateKgWk == null) chk("weight", "Weight", "none", plural(ws.length, "weigh-in"), "Not enough spread to measure a pace yet.");
    else {
      const lp = N.progressPctWk, pw = dir === 0 ? Math.abs(N.rateKgWk) : null;
      const st = dir === 0 ? (pw <= 0.3 ? "good" : pw <= 0.6 ? "warn" : "bad") : lp > T.paceHi ? "warn" : lp >= T.paceLo ? "good" : lp >= T.paceLo / 2 ? "warn" : "bad";
      chk("weight", "Weight", st, sgn(N.rateKgWk) + " kg/week",
        (dir === 0 ? (pw <= 0.3 ? "steady" : "drifting " + (N.rateKgWk > 0 ? "up" : "down")) : lp >= 0 ? f1(lp) + "% of body weight a week" : (dir < 0 ? "gaining" : "losing")) + " · " + (N.avgEarly != null && N.avgLate != null ? "week avg " + f1(N.avgEarly) + " → " + f1(N.avgLate) + " kg" : plural(ws.length, "weigh-in")) + " · plan " + (dir === 0 ? "hold steady" : T.paceLo + "–" + T.paceHi + "%"));
    }
    if (!logged.length) chk("kcal", "Calories", "none", "No food logged", "Only food marked eaten counts.");
    else if (!hasK) chk("kcal", "Calories", "none", fint(N.kcalAvg) + " kcal avg", "No calorie target set. Add one in Your numbers to check adherence.");
    else chk("kcal", "Calories", N.adherence == null ? "none" : N.adherence >= 0.8 ? "good" : N.adherence >= 0.6 ? "warn" : "bad",
      fint(N.kcalAvg) + " kcal avg", N.onTarget + " of " + N.coreDays + " days within ±" + T.band + " of " + fint(T.kcal) + (fris.length ? " (Fridays left out, avg " + fint(N.fridayAvg) + ")" : "") + " · " + N.foodDays + "/" + N.days + " days logged");
    if (logged.length && !hasP) chk("protein", "Protein", "none", Math.round(N.proteinAvg) + " g avg", "No protein target set.");
    else if (logged.length) chk("protein", "Protein", N.proteinAvg >= T.proteinMin ? "good" : N.proteinAvg >= T.proteinMin * 0.9 ? "warn" : "bad",
      Math.round(N.proteinAvg) + " g avg", N.proteinHit + " of " + N.foodDays + " days at " + T.proteinMin + " g+");
    chk("training", "Training", !ss.length ? "none" : ss.length >= Math.round(N.days * 5 / 8) ? "good" : "warn",
      plural(ss.length, "session"), ss.length ? N.sets + " working sets" + (N.effortAvg != null ? " · effort " + f1(N.effortAvg) + "/10" : "") : "No sets logged in this period.");
    if (N.lifts.length) chk("strength", "Strength", down * 2 >= N.lifts.length && down >= 2 ? "bad" : down ? "warn" : "good",
      N.liftsUp + " up · " + (N.lifts.length - N.liftsUp - down) + " held · " + down + " down", "Best estimated 1RM, second week vs the 7 days before it");
    else chk("strength", "Strength", "none", "Not enough repeats", "Each lift needs a logged set in both weeks to compare.");
    if (N.sleepNights) chk("sleep", "Sleep", N.sleepAvg >= 7 ? "good" : N.sleepAvg >= 6 ? "warn" : "bad", f1(N.sleepAvg) + " h avg", plural(N.sleepNights, "night") + " logged");

    // ---- missing data ----
    if (!weightOk) R.missing.push("At least 6 weigh-ins with 2+ in each week (" + plural(ws.length, "weigh-in") + " so far)");
    if (!foodOk) R.missing.push("At least 7 days with food marked eaten (" + logged.length + " so far)");

    // ---- verdict ----
    const rec = (id, kind, title, why, evidence, change) => R.recs.push({ id, kind, title, why, evidence: evidence.filter(Boolean), change: change || null });
    const evW = N.rateKgWk != null ? "Weight " + sgn(N.rateKgWk) + " kg/week (" + (dir === 0 ? "plan: hold steady" : N.progressPctWk >= 0 ? f1(N.progressPctWk) + "% a week " + (dir < 0 ? "down" : "up") : (dir < 0 ? "gaining" : "losing")) + ") from " + plural(ws.length, "weigh-in") : null;
    const evA = N.adherence != null ? N.onTarget + " of " + N.coreDays + " non-Friday days within ±" + T.band + " kcal of target, avg " + fint(N.kcalAvg) + " kcal" : null;
    const evS = N.lifts.length ? N.liftsUp + " lifts up, " + down + " down of " + N.lifts.length + " compared" : null;
    const firstWeeks = T.start && diff(T.start, from) < 14;
    const goodAdh = N.adherence != null && N.adherence >= 0.7 && N.foodDays >= N.days * 0.7;
    const lp = N.progressPctWk;
    const lower = hasK ? Math.max(T.floor, r50(T.kcal - T.step)) : null, higher = hasK ? r50(T.kcal + T.step) : null;
    const kT = hasK ? fint(T.kcal) + " kcal" : "your current intake";
    const gaining = dir > 0, verb = gaining ? "Gaining" : "Losing", noun = gaining ? "gain" : "cut";
    const small = hasK ? Math.round(Math.max(50, Math.min(T.step, 100)) / 50) * 50 : 100;
    const paceWord = T.plan && T.plan.pace ? T.plan.pace : null;

    // What this verdict rests on: the plan, the targets and how much was logged.
    R.basis = "Based on " + (T.plan ? "your plan (" + ({ cut: "lose fat", maintain: "maintain", muscle: "build muscle", bulk: "gain weight" })[T.plan.goal] + (dir ? ", " + f1(T.plan.ratePct) + " % of body weight a week" + (paceWord ? ", " + paceWord : "") : "") + (T.plan.activity ? ", " + T.plan.activity : "") + ")" : "your targets") + (hasK ? ", " + fint(T.kcal) + " kcal" : "") + " and " + N.days + " days of logs: " + plural(N.weighIns, "weigh-in") + ", " + plural(N.foodDays, "food day") + ", " + plural(N.sessions, "session") + (N.sleepNights ? ", " + plural(N.sleepNights, "night") + " of sleep" : "") + ".";

    if (!weightOk || !foodOk) {
      R.verdict = "not-enough-data";
      R.headline = P.partial ? "Review in progress: day " + (diff(from, to) + 1) + " of 14." : "Not enough logged to judge this period.";
    } else if (dir === 0) {
      const drift = N.rateKgWk;
      if (Math.abs(drift) <= 0.3) { R.verdict = "on-track"; R.headline = "Weight is steady. Maintenance is working."; rec("keep", "keep", "Keep " + kT, "The two-week trend moved " + sgn(drift) + " kg a week, inside the ±0.3 kg band for holding steady.", [evW, evA]); }
      else if (goodAdh && hasK) { R.verdict = "drift"; R.headline = "Weight is drifting " + (drift > 0 ? "up" : "down") + " on a maintenance plan."; const to2 = drift > 0 ? Math.max(T.floor, r50(T.kcal - small)) : r50(T.kcal + small); rec("nudge", "change", "Consider " + fint(to2) + " kcal (" + (to2 > T.kcal ? "+" : "−") + Math.abs(to2 - T.kcal) + ")", "Two weeks of on-target eating while the trend moved " + sgn(drift) + " kg a week means your maintenance is a little " + (drift > 0 ? "lower" : "higher") + " than the plan assumes. A small nudge keeps the weight steady.", [evW, evA], { key: "profile.cutKcal", from: T.kcal, to: to2 }); }
      else { R.verdict = "adherence"; R.headline = "Weight is drifting " + (drift > 0 ? "up" : "down") + ", and the logs don't show a steady " + kT + " yet."; rec("adhere", "keep", "Hit the target on more days before changing it", "A drift with uneven eating is an adherence signal first.", [evW, evA, N.unlogged.length ? plural(N.unlogged.length, "day") + " not logged" : null]); }
    } else if (!hasK && lp < T.paceLo) {
      R.verdict = lp >= T.paceLo / 2 ? "slow" : "stalled";
      R.headline = verb + " slower than planned, and there's no calorie target to compare your eating against.";
      rec("target", "keep", "Set a calorie target in Your numbers", "Without one the coach can't tell whether the pace is a target problem or an adherence problem.", [evW, N.kcalAvg != null ? "You ate " + fint(N.kcalAvg) + " kcal a day on average" : null]);
    } else if (N.breakDays >= 4) {
      R.verdict = "diet-break";
      R.headline = "This period includes " + plural(N.breakDays, "diet-break day") + ", so the pace isn't a fair read of the " + noun + ".";
      rec("break", "keep", "Judge the cut on the next full period", "Eating at maintenance on break days stalls the scale on purpose (water and glycogen come back).", [evW, N.breakDays + " break days in this period"]);
    } else if (lp > T.paceHi) {
      R.verdict = "too-fast";
      R.headline = verb + " faster than planned.";
      if (firstWeeks) rec("water", "keep", "Keep " + kT + " for now", "The first two weeks of a " + noun + " move water and glycogen, so the pace reads high. Recheck at the next review before changing anything.", [evW, "Period starts " + short(from) + ", within 2 weeks of the plan start (" + short(T.start) + ")"]);
      else if (gaining) { if (!hasK) rec("trim", "keep", "Eat about " + T.step + " kcal less a day", "Gaining more than " + T.paceHi + "% a week past the first weeks adds mostly fat.", [evW, evS]); else rec("trim", "change", "Consider " + fint(lower) + " kcal (−" + (T.kcal - lower) + ")", "Gaining more than " + T.paceHi + "% a week past the first weeks adds mostly fat, not muscle.", [evW, evS, evA], { key: "profile.cutKcal", from: T.kcal, to: lower }); }
      else if (!hasK) rec("raise", "keep", "Eat about " + T.step + " kcal more a day", "Losing more than " + T.paceHi + "% a week past the first weeks raises the chance of losing muscle.", [evW, evS]);
      else rec("raise", "change", "Consider " + fint(higher) + " kcal (+" + T.step + ")", "Losing more than " + T.paceHi + "% a week past the first weeks raises the chance of losing muscle" + (down ? ", and some lifts are already dropping" : "") + ".", [evW, evS, evA], { key: "profile.cutKcal", from: T.kcal, to: higher });
    } else if (lp >= T.paceLo) {
      R.verdict = "on-track";
      R.headline = gaining ? "Your gain is on plan. Keep going." : "Your fat-loss strategy is working. Keep going.";
      rec("keep", "keep", "Keep " + kT, "The pace is inside the plan band of " + T.paceLo + "–" + T.paceHi + "% of body weight a week.", [evW, evA]);
    } else if (lp >= T.paceLo / 2) {
      R.verdict = "slow";
      R.headline = verb + ", but slower than planned.";
      rec("hold", "keep", "Hold " + kT + " for one more period", "A slow two weeks is often water or a few unlogged meals. One more period tells a real slowdown from noise.", [evW, evA, N.unlogged.length ? plural(N.unlogged.length, "day") + " without food logged" : null]);
    } else if (goodAdh) {
      R.verdict = "stalled";
      R.headline = "Weight has stalled even with good adherence.";
      const viaSteps = N.stepDays >= 5 ? "Or keep calories and add about 2,000 steps a day (now " + fint(N.stepsAvg) + ")." : "";
      const evT = opts.tdee && opts.tdee.ready ? "Estimated burn ~" + fint(opts.tdee.tdee) + " kcal (" + fint(opts.tdee.tdeeLo) + "–" + fint(opts.tdee.tdeeHi) + ")" : null;
      if (gaining) rec("more", "change", "Consider " + fint(higher) + " kcal (+" + T.step + ")", "Two weeks of on-target eating without gain means your calorie burn is higher than the target assumes.", [evW, evA, evT], { key: "profile.cutKcal", from: T.kcal, to: higher });
      else if (lower < T.kcal) rec("lower", "change", "Consider " + fint(lower) + " kcal (−" + (T.kcal - lower) + ")", "Two weeks of on-target eating without loss means your calorie burn is lower than the target assumes. " + viaSteps, [evW, evA, evT], { key: "profile.cutKcal", from: T.kcal, to: lower });
      else rec("steps", "keep", "Add movement instead of cutting food", "Calories are already at the floor of " + fint(T.floor) + ". " + (viaSteps || "Add about 2,000 steps a day."), [evW, evA]);
    } else {
      R.verdict = "adherence";
      R.headline = "Weight isn't moving, but the logs don't show a steady " + fint(T.kcal) + " yet.";
      rec("adhere", "keep", "Hit the target on more days before changing it", "Lowering calories won't help if the current target isn't being eaten consistently. Fix logging and adherence first.", [evW, evA, N.over ? plural(N.over, "day") + " over target" : null, N.unlogged.length ? plural(N.unlogged.length, "day") + " not logged" : null]);
    }

    // ---- extra tips, each from data in this period ----
    if (hasP && N.proteinAvg != null && N.proteinAvg < T.proteinMin && foodOk)
      rec("protein", "tip", "Protein is " + Math.round(T.proteinMin - N.proteinAvg) + " g short on average", "Hitting " + T.proteinMin + " g+ helps " + (gaining ? "turn the surplus into muscle." : "keep muscle while cutting."), [Math.round(N.proteinAvg) + " g a day on average", N.proteinHit + " of " + N.foodDays + " days reached " + T.proteinMin + " g"]);
    if (down >= 2 && down * 2 >= N.lifts.length && R.verdict !== "too-fast")
      rec("strength", "tip", "Protect strength", "Several lifts dropped. Keep the weights heavy, cut a set before cutting load, and check protein and sleep.", [evS, "Biggest drops: " + N.lifts.filter(l => l.status === "down").slice(0, 3).map(l => l.name + " " + Math.round(l.change * 100) + "%").join(", ")]);
    if (opts.effort && opts.effort.nudge)
      rec("deload", "tip", "Time for a lighter week", "Effort has been rising while lifts stopped improving.", [opts.effort.text || null]);
    if (N.sleepNights >= 5 && N.sleepAvg < 7)
      rec("sleep", "tip", "Sleep is averaging " + f1(N.sleepAvg) + " h", "Under 7 hours makes hunger, recovery and gym performance worse on a cut.", [plural(N.sleepNights, "night") + " logged"]);
    if (N.estDays >= 3)
      rec("estimates", "tip", "Confirm estimated foods", N.estDays + " days include estimated items. Swap them for label values when you can so the numbers above get sharper.", []);
    return R;
  }

  // Per-lift history from the logs: last sessions (top set, est. 1RM) and the all-time best, for lifts
  // trained in the last 8 weeks. The coach can answer "did I get stronger" and "how much should I lift".
  function liftHistory(docs, today, limit = 14) {
    const list = workoutList(docs).filter(w => w.date <= today), out = {};
    list.forEach(w => Object.entries(w.lifts).forEach(([name, sets]) => {
      const top = sets.reduce((b, x) => { const e = epley(x.kg, x.r); return !b || e > b.e ? { e, kg: x.kg, r: x.r } : b; }, null);
      if (!top) return;
      (out[name] = out[name] || []).push({ date: w.date, top: top.kg + "x" + top.r, e1rm: Math.round(top.e), sets: sets.length, effort: w.effort != null ? w.effort : undefined });
    }));
    const recent = add(today, -56);
    return Object.entries(out).filter(([, h]) => h[h.length - 1].date >= recent)
      .sort((a, b) => b[1][b[1].length - 1].date.localeCompare(a[1][a[1].length - 1].date)).slice(0, limit)
      .map(([name, h]) => {
        const best = h.reduce((b, x) => (!b || x.e1rm > b.e1rm ? x : b), null), last = h[h.length - 1];
        const prev = h.length > 1 ? h[h.length - 2] : null;
        return { name, last5: h.slice(-5), bestE1rm: best.e1rm, bestOn: best.date, latestIsPR: best === last && h.length > 1, vsPrevious: prev ? sgn((last.e1rm / prev.e1rm - 1) * 100, 0) + "%" : null };
      });
  }
  /* ---------- rendering ---------- */
  const VERDICT = {
    "on-track": ["good", "Working"], "slow": ["warn", "Slow"], "stalled": ["bad", "Stalled"], "too-fast": ["warn", "Too fast"],
    "adherence": ["warn", "Check adherence"], "drift": ["warn", "Drifting"], "diet-break": ["muted", "Diet break"], "not-enough-data": ["muted", "Building"], "empty": ["muted", "No data"],
  };
  const css = `
.co-head{display:flex;align-items:center;gap:8px;justify-content:space-between}
.co-head h3{margin:0}
.co-nav{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:.8rem;color:var(--muted)}
.co-nav button{border:1px solid var(--line);background:var(--sunk);color:var(--ink);border-radius:var(--r);width:30px;height:30px;cursor:pointer}
.co-nav button:disabled{opacity:.35;cursor:default}
.co-pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.78rem;font-weight:600;border:1px solid currentColor}
.co-good{color:var(--good)}.co-warn{color:var(--warn)}.co-bad{color:var(--bad)}.co-muted,.co-none{color:var(--muted)}
.co-headline{font-size:1.05rem;margin:10px 0 4px;color:var(--ink)}
.co-checks{display:grid;gap:6px;margin:10px 0;padding:0;list-style:none}
.co-checks li{display:grid;grid-template-columns:10px 5.5em 1fr;gap:8px;align-items:start;font-size:.9rem;color:var(--ink)}
.co-dot{width:8px;height:8px;border-radius:50%;background:currentColor;margin-top:.45em}
.co-checks b{font-family:var(--mono);font-weight:600}
.co-checks small{display:block;color:var(--muted);font-size:.78rem}
.co-rec{border:1px solid var(--line);border-radius:var(--r);padding:10px 12px;margin-top:8px;background:var(--sunk)}
.co-rec p{margin:4px 0 0;color:var(--ink);font-size:.9rem}
.co-rec .co-kind{font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.co-rec details{margin-top:6px;font-size:.82rem;color:var(--muted)}
.co-rec ul{margin:4px 0 0;padding-left:18px}
.co-btn{margin-top:8px;border:0;background:var(--accent);color:var(--accent-ink);border-radius:var(--r);padding:8px 12px;font-weight:600;cursor:pointer}
.co-miss{font-size:.85rem;color:var(--muted);margin:6px 0 0;padding-left:18px}
.co-ins{border:1px solid var(--line);border-left:4px solid var(--muted);border-radius:var(--r);padding:10px 12px;background:var(--sunk)}
.co-ins+.co-ins{margin-top:8px}
.co-ins-good{border-left-color:var(--good)}.co-ins-warn{border-left-color:var(--warn)}.co-ins-info{border-left-color:var(--accent)}
.co-ins-head{display:flex;justify-content:space-between;align-items:start;gap:8px}
.co-ins p{margin:4px 0 0;font-size:.9rem;color:var(--ink)}
.co-ins details{margin-top:6px;font-size:.8rem;color:var(--muted)}
.co-ins ul{margin:4px 0 0;padding-left:18px}
.co-x{border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:.9rem;padding:0 2px}
.co-src{font-size:.7rem;color:var(--muted);margin-top:6px}
`;
  const S = { from: null };
  let O = null;

  // ---------- Insights: patterns in the logs, worked out locally (no Claude, no cost) ----------
  // Each rule returns null unless it has enough data. Ids are stable so the host can remember what was
  // shown (opts.seen = {id: "YYYY-MM-DD"}); an insight repeats only after opts.repeatDays (7).
  const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const pctChange = (a, b) => b ? (a / b - 1) * 100 : null;
  function insights(docs, opts = {}) {
    docs = docs || {};
    const today = isDate(opts.today) ? opts.today : localToday();
    const T = targets(docs, opts), days = docs.days || {}, out = [];
    const push = (id, kind, title, text, evidence, ask) => out.push({ id, kind, title, text, evidence: (evidence || []).filter(Boolean), ask: ask || null });
    const lifts = liftHistory(docs, today, 30);
    const list = workoutList(docs).filter(w => w.date <= today && Object.keys(w.lifts).length);
    const dayAt = d => days[d] || {};
    const ask = q => q;

    // 1. New personal records this week.
    const prs = lifts.filter(l => l.latestIsPR && l.last5[l.last5.length - 1].date > add(today, -7));
    if (prs.length) push("pr-" + prs.map(l => l.bestOn).sort().pop(), "good", prs.length === 1 ? "New best on " + prs[0].name : prs.length + " new personal bests this week",
      prs.map(l => l.name + " " + l.last5[l.last5.length - 1].top + " (est. 1RM " + l.bestE1rm + " kg)").join("; ") + ".", [], ask("Which of my lifts are improving fastest?"));

    // 2. Strength falling across several lifts (3 sessions each, each lower than the one before).
    const falling = lifts.filter(l => l.last5.length >= 3 && l.last5.slice(-3).every((s, i, a) => i === 0 || s.e1rm < a[i - 1].e1rm) && pctChange(l.last5[l.last5.length - 1].e1rm, l.last5[l.last5.length - 3].e1rm) <= -3);
    if (falling.length >= 2) push("strength-down", "warn", "Strength is slipping on " + falling.length + " lifts",
      "Three sessions in a row went down on " + falling.slice(0, 3).map(l => l.name).join(", ") + (falling.length > 3 ? " and more" : "") + ". In a cut that usually means food, sleep or fatigue, not the plan.",
      falling.slice(0, 4).map(l => l.name + ": " + l.last5.slice(-3).map(s => s.e1rm).join(" → ") + " kg est. 1RM"), ask("Why has my strength decreased recently?"));

    // 3. Protein missed on most logged days this week.
    if (T.proteinMin) {
      const wk = dates(add(today, -7), add(today, -1)).map(d => ({ d, e: eaten(dayAt(d)) })).filter(x => x.e);
      const short = wk.filter(x => x.e.p < T.proteinMin);
      if (wk.length >= 4 && short.length >= Math.ceil(wk.length / 2)) push("protein-week-" + add(today, -1), "warn", "Protein under target on " + short.length + " of " + wk.length + " logged days",
        "Average " + Math.round(mean(wk.map(x => x.e.p))) + " g against a " + T.proteinMin + " g minimum. Protein is what keeps muscle while the calories are down.",
        short.map(x => x.d + ": " + Math.round(x.e.p) + " g"), ask("How can I hit my protein target more often?"));
    }

    // 4. Training effort high on most recent sessions (possible fatigue).
    const eff = list.filter(w => w.effort != null).slice(-4);
    if (eff.length === 4 && eff.filter(w => w.effort >= 4).length >= 3) push("fatigue-" + eff[eff.length - 1].date, "warn", "Hard sessions piling up",
      "Effort was 4 or 5 on " + eff.filter(w => w.effort >= 4).length + " of the last 4 sessions. A lighter week may protect your lifts.",
      eff.map(w => w.date + " " + (w.session || "") + ": effort " + w.effort), ask("Should I take a lighter week?"));

    // 5. Lifts after short sleep vs after a full night (3+ sessions each).
    const withSleep = list.map(w => { const h = num(dayAt(add(w.date, -1)).sleep); const e = Object.values(w.lifts).map(sets => Math.max(...sets.map(x => epley(x.kg, x.r)))); return h != null && e.length ? { h, e: mean(e), date: w.date } : null; }).filter(Boolean).filter(w => w.date > add(today, -56));
    const shortN = withSleep.filter(w => w.h < 6.5), fullN = withSleep.filter(w => w.h >= 7);
    if (shortN.length >= 3 && fullN.length >= 3) {
      const diff = pctChange(mean(shortN.map(w => w.e)), mean(fullN.map(w => w.e)));
      if (diff <= -4) push("sleep-lifts", "info", "Short nights cost you strength", "Sessions after under 6.5 h of sleep averaged " + Math.abs(Math.round(diff)) + "% lower est. 1RM than after 7 h or more.",
        [shortN.length + " sessions after short sleep, " + fullN.length + " after a full night, last 8 weeks"], ask("How does my sleep affect my lifts?"));
    }

    // 6. Weight-loss pace slowing (last 14 days vs the 14 before, 4+ weigh-ins each).
    const ws = weighIns(docs.weights).filter(w => w.date <= today);
    const slope = (from, to) => { const pts = ws.filter(w => w.date > from && w.date <= to).map(w => ({ x: diff(from, w.date), y: w.kg })); const f = pts.length >= 4 ? fit(pts) : null; return f ? { kgWk: f.slope * 7, n: pts.length } : null; };
    const now = slope(add(today, -14), today), before = slope(add(today, -28), add(today, -14));
    const bw = ws.length ? ws[ws.length - 1].kg : null;
    if (now && before && bw) {
      const pNow = -now.kgWk / bw * 100, pBefore = -before.kgWk / bw * 100;
      if (pBefore >= 0.4 && pNow < 0.25) push("pace-slowing-" + today.slice(0, 7), "info", "Weight loss has slowed", "The trend was " + f1(pBefore) + "% of body weight a week, now " + f1(Math.max(0, pNow)) + "%. Two weeks is early; check adherence first, then the 14-day review.",
        ["Last 14 days: " + f1(now.kgWk) + " kg/week (" + now.n + " weigh-ins)", "14 days before: " + f1(before.kgWk) + " kg/week (" + before.n + " weigh-ins)"], ask("Why has my weight stopped decreasing?"));
    }

    // 7. Recovery improving (readiness parts, 7 days vs the 7 before, 4+ check-ins each).
    const rScore = d => { const r = dayAt(d).readiness; if (!r) return null; const v = [r.quality, r.soreness, r.energy].map(num).filter(x => x != null); return v.length ? mean(v) : null; };
    const r1 = dates(add(today, -6), today).map(rScore).filter(x => x != null), r0 = dates(add(today, -13), add(today, -7)).map(rScore).filter(x => x != null);
    if (r1.length >= 4 && r0.length >= 4 && mean(r1) - mean(r0) >= 0.6) push("recovery-up-" + today, "good", "Recovery is improving", "Your check-ins average " + f1(mean(r1)) + "/5 this week against " + f1(mean(r0)) + "/5 last week.", [], null);

    // 8. Volume imbalance (from StrengthAnalytics when passed).
    const lean = opts.strength && (opts.strength.balance || []).filter(b => b.lean && b.ratio != null);
    if (lean && lean.length) push("balance-" + lean.map(b => b.id || b.label).join("-"), "info", "Training volume leans " + lean[0].lean, lean.map(b => b.label + " " + Math.round(b.ratio * 100) / 100 + " : 1").join("; ") + ". Worth a look over a few weeks, not one.", [], ask("Am I training every muscle enough?"));

    // 9. Protein on rest days vs training days (28 days, 3+ of each).
    const trainDates = new Set(list.map(w => w.date));
    const pr28 = dates(add(today, -28), add(today, -1)).map(d => ({ d, e: eaten(dayAt(d)) })).filter(x => x.e);
    const pT = pr28.filter(x => trainDates.has(x.d)).map(x => x.e.p), pR = pr28.filter(x => !trainDates.has(x.d)).map(x => x.e.p);
    if (pT.length >= 3 && pR.length >= 3 && Math.abs(mean(pT) - mean(pR)) >= 20) {
      const lower = mean(pR) < mean(pT) ? "rest" : "training";
      push("protein-rest-vs-train", "info", "Protein drops on " + lower + " days", "Training days average " + Math.round(mean(pT)) + " g protein, rest days " + Math.round(mean(pR)) + " g. Muscle is kept on rest days too.", [pT.length + " training days, " + pR.length + " rest days logged in 4 weeks"], ask("What should I eat on rest days?"));
    }

    // 10. The weekday that goes over target most (28 days, 3+ of that weekday logged).
    if (T.kcal) {
      const byWd = {};
      dates(add(today, -28), add(today, -1)).forEach(d => { const e = eaten(dayAt(d)); if (!e) return; const tgt = opts.kcalTarget ? num(opts.kcalTarget(d)) || T.kcal : T.kcal; (byWd[dow(d)] = byWd[dow(d)] || []).push(e.kcal - tgt); });
      const worst = Object.entries(byWd).filter(([, v]) => v.length >= 3).map(([k, v]) => ({ wd: +k, over: mean(v), n: v.length })).sort((a, b) => b.over - a.over)[0];
      if (worst && worst.over >= 150) push("weekday-over-" + worst.wd, "info", WD[worst.wd] + "s run over target", "On " + WD[worst.wd] + "s you average " + Math.round(worst.over) + " kcal over, across " + worst.n + " logged " + WD[worst.wd] + "s. Planning that day ahead usually fixes it.", [], ask("How can I keep " + WD[worst.wd] + "s on target?"));
    }

    // Keep it calm: hide what was shown in the last repeatDays, max `limit`.
    const seen = opts.seen || {}, repeat = opts.repeatDays || 7, limit = opts.limit || 3;
    const order = { warn: 0, good: 1, info: 2 };
    return out.filter(i => !(seen[i.id] && diff(seen[i.id], today) < repeat)).sort((a, b) => order[a.kind] - order[b.kind]).slice(0, limit);
  }

  function insightsHtml(docs, opts = {}) {
    const list = insights(docs, opts);
    if (!list.length) return "";
    const items = list.map(i => '<div class="co-ins co-ins-' + i.kind + '" data-coach-insight="' + esc(i.id) + '"><div class="co-ins-head"><b>' + esc(i.title) + '</b><button class="co-x" data-coach-dismiss="' + esc(i.id) + '" aria-label="Dismiss">✕</button></div><p>' + esc(i.text) + "</p>" +
      (i.evidence.length ? '<details><summary>Based on</summary><ul>' + i.evidence.map(e => "<li>" + esc(e) + "</li>").join("") + "</ul></details>" : "") +
      "</div>").join("");
    return '<div class="card co-insights"><h3>Patterns in your logs</h3><p class="co-src" style="margin-top:0">Worked out from your logs. Each shows once a week at most.</p>' + items + "</div>";
  }

  function recHtml(r, canApply) {
    const kind = { change: "Suggested change", keep: "Recommendation", tip: "Tip" }[r.kind];
    const ev = r.evidence.length ? "<details><summary>Why, from your logs</summary><ul>" + r.evidence.map(e => "<li>" + esc(e) + "</li>").join("") + "</ul></details>" : "";
    const btn = r.change && canApply ? '<button class="co-btn" data-coach-apply="' + esc(JSON.stringify(r.change)) + '">Use ' + fint(r.change.to) + " kcal</button> <span class=\"co-src\">Only changes when you tap. Your current target is " + fint(r.change.from) + ".</span>" : "";
    return '<div class="co-rec"><span class="co-kind">' + kind + "</span><p><b>" + esc(r.title) + "</b></p><p>" + esc(r.why) + "</p>" + ev + btn + "</div>";
  }

  function reviewHtml(docs, opts = {}) {
    const ps = periods(docs, opts);
    const R = review(docs, Object.assign({}, opts, { from: opts.from || S.from }));
    const [cls, label] = VERDICT[R.verdict] || VERDICT.empty;
    if (!R.period) return '<div class="card co-review"><h3>14-day review</h3><p class="co-headline">' + esc(R.headline) + "</p></div>";
    const i = ps.findIndex(p => p.from === R.period.from);
    const nav = '<div class="co-nav"><button data-coach-period="' + esc(i > 0 ? ps[i - 1].from : "") + '" aria-label="Previous period"' + (i > 0 ? "" : " disabled") + ">‹</button><span>" + short(R.period.from) + " – " + short(R.period.end) + "</span><button data-coach-period=\"" + esc(i < ps.length - 1 ? ps[i + 1].from : "") + '" aria-label="Next period"' + (i < ps.length - 1 ? "" : " disabled") + ">›</button></div>";
    const checks = '<ul class="co-checks">' + R.checks.map(c => '<li><span class="co-dot co-' + c.status + '"></span><span>' + esc(c.label) + '</span><span><b>' + esc(c.value) + "</b><small>" + esc(c.detail) + "</small></span></li>").join("") + "</ul>";
    const miss = R.missing.length ? '<p class="co-src">Still needed for a verdict:</p><ul class="co-miss">' + R.missing.map(m => "<li>" + esc(m) + "</li>").join("") + "</ul>" : "";
    const partial = R.period.partial ? '<p class="co-src">In progress, through ' + short(R.period.to) + ". Today is left out until it's fully logged.</p>" : "";
    const basis = R.basis ? '<p class="co-src">' + esc(R.basis) + "</p>" : "";
    return '<div class="card co-review"><div class="co-head"><h3>14-day review</h3>' + nav + '</div><p class="co-headline"><span class="co-pill co-' + cls + '">' + label + "</span> " + esc(R.headline) + "</p>" + partial + checks + miss + basis + R.recs.map(r => recHtml(r, !!(opts.onApply || (O && O.onApply)))).join("") + "</div>";
  }

  function summary(R) {
    if (!R || !R.period) return "14-day review: no data yet.";
    const lines = ["14-day review " + short(R.period.from) + " – " + short(R.period.to) + (R.period.partial ? " (in progress)" : ""), R.headline];
    R.checks.forEach(c => lines.push("- " + c.label + ": " + c.value + " (" + c.detail + ")"));
    R.missing.forEach(m => lines.push("- Needed: " + m));
    R.recs.forEach(r => lines.push("> " + r.title + ": " + r.why));
    return lines.join("\n");
  }

  function bind(root, opts) {
    O = Object.assign(O || {}, opts);
    root.addEventListener("click", e => {
      const t = e.target.closest("[data-coach-period],[data-coach-apply],[data-coach-dismiss]");
      if (!t) return;
      if (t.dataset.coachDismiss) { if (O.onDismiss) O.onDismiss(t.dataset.coachDismiss); const box = t.closest("[data-coach-insight]"); if (box) box.remove(); return; }
      if (t.dataset.coachPeriod !== undefined) { if (t.dataset.coachPeriod) { S.from = t.dataset.coachPeriod; if (O.render) O.render(); } }
      else if (t.dataset.coachApply) { try { const ch = JSON.parse(t.dataset.coachApply); if (O.onApply) O.onApply(ch); } catch (err) {} }
    });
  }

  return { css, targets, periods, review, reviewHtml, summary, liftHistory, insights, insightsHtml, bind, _state: S };
})();
if (typeof module !== "undefined") module.exports = Coach;
