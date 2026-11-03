/* AI coach + 14-day progress review for the Aziz Cut Tracker.
 * Plain JS, no imports, no network of its own. Claude is reached through the page's `sample`
 * capability, which the host passes in (the app already declares {sample: {images: true}}).
 * Reads the app's own collections (S.docs):
 *   weights/{date}.kg, days/{date}.food[{kcal,p,eaten,est}] (+ sleep, steps, water, waterh.ml),
 *   workouts/{date}{session, sets:{name:[{w,r}]}, effort, deload}, prefs.main{profile, dietBreak, dislikes}
 * API:
 *   Coach.css                                   -> string, inject once (uses the app's tokens)
 *   Coach.targets(docs, opts)                   -> {kcal, proteinMin, proteinMax, band, floor, paceLo, paceHi, start}
 *   Coach.periods(docs, {today})                -> [{from, to, end, partial}] 14-day blocks from the cut start
 *   Coach.review(docs, {today, from?, effort?}) -> the 14-day review (verdict, checks, recommendations)
 *   Coach.reviewHtml(docs, opts)                -> Progress card: the review, with period arrows
 *   Coach.summary(review)                       -> plain text of a review, to copy into a chat
 *   Coach.context(docs, opts)                   -> the facts the coach is allowed to use (JSON-able); with
 *        opts.strength (StrengthAnalytics.analyze), recoveryText (RecoveryFatigue.summary), cardioText
 *        (Cardio.summary), planToday {session, exercises:[{name,w,reps,sets,unit}]}, exerciseNames[],
 *        exercise(name) -> form-guide entry + demo, and question (to attach the exercise asked about)
 *   Coach.liftHistory(docs, today)              -> per-lift last 5 sessions, best e1RM, PR flag
 *   Coach.insights(docs, opts)                  -> up to 3 local insights [{id, kind, title, text, evidence, ask}];
 *        opts.seen {id: date} hides ones shown in the last opts.repeatDays (7); opts.strength adds balance
 *   Coach.ACTIONS / Coach.cleanActions(list)   -> the only actions Claude may propose; opts.actionHost
 *        {check(a) -> {ok, change|error}, apply(a) -> Promise<{ok, message}>} shows the exact change and
 *        applies it after a Confirm tap (show_exercise opens without changing data)
 *   Coach.trimContext(ctx, q) / langOf(q) / effortFor(q, history) -> what the coach service receives: only the data
 *        sections a question needs, "ar"/"en", and low or medium effort. opts.endpoint (URL or getter) = the
 *        Mizan coach service (worker/); opts.consent()/setConsent(bool), opts.setService(url) from the host
 *   Coach.insightsHtml(docs, opts)              -> "Patterns in your logs" card; opts.onDismiss(id) via bind
 *   Coach.exerciseIn(question, names)           -> the exercise name a question mentions, or null
 *   Coach.prompt(question, ctx, history)        -> the instruction sent to Claude
 *   Coach.parseAnswer(value)                    -> {answer, evidence[], missing[], suggestion|null}
 *   Coach.localAnswer(topic, docs, opts)        -> same shape, worked out without Claude
 *   Coach.chatHtml()                            -> compact "Ask Claude" card (opens the panel)
 *   Coach.panelHtml() / Coach.mountPanel(el, opts) -> floating "Ask Claude" button + chat panel; mount once
 *                                                  outside the re-rendered area, the panel owns its DOM
 *   Coach.open(true|false)                      -> open or close the panel
 *   Coach.suggestions(tab)                      -> suggested questions for a screen (today/train/food/progress/guide)
 *   Coach.partialAnswer(text)                   -> the "answer" text inside a partly streamed JSON reply
 *   Coach.bind(root, opts)                      -> wire the cards and the panel once (delegated on root)
 *        opts = { getDocs: () => S.docs, getSample: () => Promise<sample|null>, render: () => void,
 *                 today?: () => "YYYY-MM-DD", effort?: () => EffortDeload result, tdee?: () => TrendTDEE result,
 *                 onApply?: change => void,    // only called on a tap; omit it and no "Use" button is shown
 *                 tab?: () => "today"|..., chats?: {load: () => msgs[], save: msgs => void},
 *                 endpoint?: "/api/coach", getToken?: () => Promise<idToken|null> }
 * Transports, in order: the page's `sample` capability (inside the Claude app, free); else POST `endpoint`
 * with the Firebase ID token (the website; the server holds the API key and streams the reply); else the
 * quick questions only, with a note. Chat history goes through opts.chats (the host stores it).
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
      T.plan = { goals: Array.isArray(r.goals) && r.goals.length ? r.goals.slice(0, 4) : Array.isArray(a.goals) && a.goals.length ? a.goals.slice(0, 4) : [r.goal || a.goal].filter(Boolean), label: typeof r.label === "string" ? r.label.slice(0, 60) : null, goal: r.goal, direction: r.direction, ratePct: pct, rateKgWk: pos(r.rateKgWk) || 0, pace: r.pace || null, activity: r.activity || a.activity || null,
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

  /* ---------- coach context + Claude ---------- */
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
  // The exercise a question is about, matched against names the app knows (logs + plan + guide).
  const plain = s => String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  function exerciseIn(question, names) {
    const q = " " + plain(question) + " ";
    if (q.trim().length < 3) return null;
    let hit = null, hitLen = 0;
    (names || []).forEach(n => {
      const p = plain(n); if (!p) return;
      const words = p.split(" ");
      const forms = [p, words.slice(0, 2).join(" ")].concat(words[0].length >= 5 ? [words[0]] : []);
      forms.forEach(fm => { const k = " " + fm + " "; if (fm && q.includes(k) && (fm.length > hitLen || (fm.length === hitLen && p.length < plain(hit).length))) { hit = n; hitLen = fm.length; } });
    });
    return hit;
  }

  function context(docs, opts = {}) {
    docs = docs || {};
    const today = isDate(opts.today) ? opts.today : localToday();
    const T = targets(docs, opts), rv = opts.review || review(docs, Object.assign({}, opts, { today }));
    const ws = weighIns(docs.weights).filter(w => w.date <= today);
    const avgOf = n => { const xs = ws.filter(w => w.date > add(today, -n)); return xs.length ? { avg: +f1(mean(xs.map(w => w.kg))), weighIns: xs.length } : null; };
    const d0 = (docs.days || {})[today] || {}, e0 = eaten(d0);
    const recent = sessions(workoutList(docs), add(today, -13), today).map(w => ({
      date: w.date, session: w.session || null, effort: w.effort != null ? w.effort : null,
      bestSetKg: Object.values(bestLifts([w], w.date, w.date)).length ? Object.entries(bestLifts([w], w.date, w.date)).map(([n, b]) => n + " " + b.w + "x" + b.r) : [],
    }));
    const food14 = dates(add(today, -13), add(today, -1)).map(d => { const e = eaten((docs.days || {})[d]); return e ? { date: d, kcal: Math.round(e.kcal), protein: Math.round(e.p) } : { date: d, logged: false }; });
    const ctx = {
      today, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow(today)],
      targets: { kcal: T.kcal, proteinMin: T.proteinMin, proteinMax: T.proteinMax, pacePctPerWeek: [T.paceLo, T.paceHi], cutStart: T.start },
      plan: T.plan ? { goals: T.plan.goals, label: T.plan.label, goal: T.plan.goal, direction: T.plan.direction, pace: T.plan.pace, ratePctPerWeek: T.plan.ratePct, rateKgPerWeek: T.plan.rateKgWk, activity: T.plan.activity, sex: T.plan.sex, age: T.plan.age, heightCm: T.plan.heightCm, startKg: T.plan.kg, targetKg: T.plan.targetKg, projectedEnd: T.plan.endDate, since: T.plan.since, note: "From the goal questionnaire. Judge pace against this plan, not a generic cut." } : null,
      basis: rv.basis || null,
      weight: { latest: ws.length ? ws[ws.length - 1] : null, avg7: avgOf(7), avg14: avgOf(14), avg30: avgOf(30), last30: ws.filter(w => w.date > add(today, -30)).map(w => [w.date, w.kg]) },
      todaySoFar: e0 ? { eatenKcal: Math.round(e0.kcal), eatenProtein: Math.round(e0.p), plannedNotEaten: e0.planned, kcalLeft: T.kcal != null ? Math.round(T.kcal - e0.kcal) : null, proteinLeft: T.proteinMin != null ? Math.max(0, Math.round(T.proteinMin - e0.p)) : null } : { logged: false },
      food14,
      workouts14: recent,
      review: rv.period ? {
        from: rv.period.from, to: rv.period.to, partial: rv.period.partial, verdict: rv.verdict, headline: rv.headline,
        checks: rv.checks.map(c => c.label + ": " + c.value + " (" + c.detail + ")"),
        lifts: rv.numbers.lifts.map(l => l.name + " " + sgn(l.change * 100, 0) + "% e1RM"),
        suggestions: rv.recs.map(r => r.title + ": " + r.why),
        missing: rv.missing,
      } : null,
      sleepLast7: dates(add(today, -7), add(today, -1)).map(d => num(((docs.days || {})[d] || {}).sleep)).filter(h => h != null),
      dislikes: ((((docs.prefs || {}).main || {}).dislikes) || []).slice(0, 30),
    };
    // ---- phase 4: training, nutrition and recovery detail ----
    const prefsMain = (docs.prefs || {}).main || {};
    ctx.lifts = liftHistory(docs, today);
    if (opts.planToday) ctx.planToday = opts.planToday;
    if (opts.strength) {
      const st = opts.strength;
      ctx.strength = {
        lifts: (st.lifts || []).slice(0, 14).map(l => ({ name: l.name, sessions: l.sessions, bestE1rm: l.best && Math.round(l.best.e1rm), lastE1rm: l.last && Math.round(l.last.e1rm), change28: l.change28 != null ? sgn(l.change28 * 100, 0) + "%" : null, cut: l.cut && l.cut.pct != null ? sgn(l.cut.pct * 100, 0) + "%" : null })),
        weeklySetsPerMuscle: (st.muscles || []).map(m => ({ muscle: m.label, thisWeek: Math.round(m.thisWeek), avg4: Math.round(m.avg4 * 10) / 10, daysPerWeek: m.freq4, status: m.status })),
        balance: (st.balance || []).filter(b => b.ratio != null).map(b => ({ pair: b.label, ratio: Math.round(b.ratio * 100) / 100, lean: b.lean || null })),
      };
    }
    if (opts.recoveryText) ctx.recovery = String(opts.recoveryText).slice(0, 1200);
    ctx.readiness7 = dates(add(today, -6), today).map(d => { const r = ((docs.days || {})[d] || {}).readiness; return r ? { date: d, quality: r.quality, soreness: r.soreness, energy: r.energy, joints: Object.keys(r.joints || {}).filter(j => r.joints[j]) } : null; }).filter(Boolean);
    ctx.steps7 = dates(add(today, -6), today).map(d => { const v = num(((docs.days || {})[d] || {}).steps); return v != null ? [d, Math.round(v)] : null; }).filter(Boolean);
    if (prefsMain.stepGoal) ctx.stepGoal = num(prefsMain.stepGoal);
    if (opts.cardioText) ctx.cardio = String(opts.cardioText).slice(0, 800);
    else { const cd = docs.cardio || {}; ctx.cardio14 = dates(add(today, -13), today).map(d => cd[d] && Array.isArray(cd[d].sessions) ? { date: d, sessions: cd[d].sessions.map(x => [x.kind, x.min, x.speed, x.incline].filter(v => v != null).join(" ")) } : null).filter(Boolean); }
    const planned = ((d0.food || [])).filter(x => x && x.eaten === false).map(x => ({ name: x.name, slot: x.slot, kcal: Math.round(num(x.kcal) || 0), p: Math.round(num(x.p) || 0) }));
    if (planned.length) ctx.plannedToday = planned.slice(0, 20);
    const eatenItems = ((d0.food || [])).filter(x => x && x.eaten === true).map(x => ({ name: x.name, slot: x.slot, kcal: Math.round(num(x.kcal) || 0), p: Math.round(num(x.p) || 0), est: x.est ? true : undefined }));
    if (eatenItems.length) ctx.eatenToday = eatenItems.slice(0, 30);
    if (eatenItems.length) { const ef = (d0.food || []).filter(x => x && x.eaten === true); ctx.todaySoFar.eatenCarbs = Math.round(ef.reduce((a, x) => a + (num(x.c) || 0), 0)); ctx.todaySoFar.eatenFat = Math.round(ef.reduce((a, x) => a + (num(x.f) || 0), 0)); }
    if (T.carbsLo != null || T.carbsHi != null) ctx.targets.carbs = [T.carbsLo, T.carbsHi]; if (T.fatLo != null || T.fatHi != null) ctx.targets.fat = [T.fatLo, T.fatHi];
    const meals = Object.values(docs.meals || {}).filter(m => m && m.name && Array.isArray(m.items));
    if (meals.length) ctx.savedMeals = meals.sort((a, b) => (b.uses || 0) - (a.uses || 0)).slice(0, 12).map(m => ({ name: m.name, kcal: Math.round(m.items.reduce((s_, i) => s_ + (num(i.kcal) || 0), 0)), protein: Math.round(m.items.reduce((s_, i) => s_ + (num(i.p) || 0), 0)) }));
    const menu = (docs.menus || {})[today];
    if (menu && Array.isArray(menu.items)) ctx.menuToday = menu.items.filter(i => i && i.name && !i.skip).slice(0, 40).map(i => ({ name: i.name, kcal: num(i.kcal), protein: num(i.p != null ? i.p : i.protein) }));
    if (opts.kcalTarget) { const kt = num(opts.kcalTarget(today)); if (kt != null && kt !== T.kcal) ctx.targets.kcalToday = Math.round(kt); }
    if (prefsMain.cycling && prefsMain.cycling.on) ctx.calorieCycling = { on: true, deltaKcal: num(prefsMain.cycling.delta) };
    if (prefsMain.dietBreak && prefsMain.dietBreak.started) ctx.dietBreak = { started: prefsMain.dietBreak.started, until: prefsMain.dietBreak.until || null };
    const hurt = ((docs.prefs || {}).swaps || {}).hurt || {};
    const hurtNames = Object.values(hurt).filter(h => h && h.name).map(h => h.name + (h.note ? " (" + clip(h.note, 60) + ")" : ""));
    if (hurtNames.length) ctx.exercisesThatHurt = hurtNames.slice(0, 10);
    const swapped = {}; dates(add(today, -27), today).forEach(d => { const w = (docs.workouts || {})[d]; if (w && w.swapped) Object.entries(w.swapped).forEach(([used, plan]) => { swapped[used] = plan; }); });
    if (Object.keys(swapped).length) ctx.recentSwaps = Object.entries(swapped).map(([used, plan]) => used + " instead of " + plan).slice(0, 10);
    if (opts.question && opts.exercise) {
      const names = ctx.lifts.map(l => l.name).concat((opts.planToday && opts.planToday.exercises || []).map(x => x.name), opts.exerciseNames || []);
      const hit = exerciseIn(opts.question, names);
      const ex = hit && opts.exercise(hit);
      if (ex) ctx.exerciseAsked = { name: ex.name || hit, setup: (ex.setup || []).slice(0, 6), cues: (ex.cues || []).slice(0, 6), mistakes: (ex.mistakes || []).slice(0, 6), muscles: { primary: ex.primary || [], secondary: ex.secondary || [] }, demoVideo: ex.demo ? "verified demo available in the app (the app opens it; do not give a URL)" : "no verified demo yet", logged: ctx.lifts.find(l => l.name === hit) || null };
    }
    if (opts.tdee && opts.tdee.ready) ctx.calorieBurn = { kcal: Math.round(opts.tdee.tdee), lo: Math.round(opts.tdee.tdeeLo), hi: Math.round(opts.tdee.tdeeHi), trendRateKgWk: +f1(opts.tdee.rateKgWk) };
    if (opts.effort) ctx.deloadCheck = { nudge: !!opts.effort.nudge, reason: opts.effort.reason || null };
    return ctx;
  }

  function prompt(question, ctx, history) {
    const past = (history || []).slice(-4).map(h => "Q: " + h.q + "\nA: " + h.a).join("\n");
    return [
      "You are the personal fitness coach inside the user's own tracking app. DATA.plan.goals lists every goal from the user's goal questionnaire (for example cut + muscle = lose fat while building muscle); judge advice against those goals. With no plan, assume a fat-loss cut.",
      "Answer the question using ONLY the DATA below, which is everything the app has logged.",
      "Rules:",
      "- Never invent numbers, foods, nutrition values, workouts or dates. If something you need isn't in DATA, say it isn't logged and what to log.",
      "- Days marked logged:false have no food data; do not treat them as zero or as on target.",
      "- Explain WHY: tie each point to specific values from DATA and put those values in evidence.",
      "- You cannot change targets or settings. You may suggest a change and give the reason; the user decides in the app.",
      "- Judge weight by averages and trends, never by one weigh-in.",
      "- For pain, injury or medical questions, give general guidance and suggest seeing a professional.",
      "- Lifting advice: base loads on lifts.last5 and planToday; suggest at most one small step (2.5 kg, or one rep) when the last session hit its reps with effort 3 or less, hold when effort was 4-5 or readiness is low, and name the set. Never suggest exercises listed in exercisesThatHurt.",
      "- Food advice: pick only from plannedToday, savedMeals, menuToday or foods already in the logs, and respect dislikes; say what fits kcalLeft and proteinLeft.",
      "- Exercise technique: use exerciseAsked only. Say the app has a verified demo when demoVideo says so; never give a video link.",
      "- You may propose at most 2 actions in \"actions\", only from this list and only when the user asks for a change or it clearly helps: set_calorie_target {kcal} (at most 150 kcal from the current target per step), add_saved_meal {name} (a name from savedMeals), add_menu_item {name} (a name from menuToday), swap_exercise {from, to} (from = an exercise in planToday, to = a similar exercise not in exercisesThatHurt), show_exercise {name}. Give each a short \"why\". The app shows the exact change and the user must confirm it, so never say a change is done; otherwise use [].",
      "- If something you need is missing, ask one short clarifying question in answer instead of guessing.",
      "- Reply in the language of the question; for Arabic use simple Modern Standard Arabic with numbers as digits.",
      "- Plain, friendly language, under 120 words in answer. No markdown headings.",
      past ? "Earlier in this chat:\n" + past : "",
      "DATA:\n" + JSON.stringify(ctx),
      "Question: " + JSON.stringify(String(question || "").slice(0, 600)),
      "Reply with only JSON in this shape:",
      '{"answer":"...","evidence":["Weight 7-day avg 90.8 kg vs 91.6 kg the week before"],"missing":["what isn\'t logged that would help"],"suggestion":null,"actions":[]}',
      'suggestion is null or {"title":"short action","why":"one sentence"}.',
    ].filter(Boolean).join("\n");
  }

  const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  // ---------- Safe actions: Claude proposes, the person confirms, the host applies ----------
  // Only these types exist. Anything else in a reply is dropped. The host (opts.actionHost) checks each
  // one against the real data, shows the exact change, and applies it only after a tap on Confirm.
  const ACTIONS = {
    set_calorie_target: { fields: { kcal: "num" }, label: "Change your calorie target" },
    add_saved_meal: { fields: { name: "str" }, label: "Add a saved meal to today" },
    add_menu_item: { fields: { name: "str" }, label: "Add a menu item to today" },
    swap_exercise: { fields: { from: "str", to: "str" }, label: "Swap an exercise today" },
    show_exercise: { fields: { name: "str" }, label: "Show how to do it", view: true },
  };
  function cleanActions(list) {
    return (Array.isArray(list) ? list : []).slice(0, 4).map(a => {
      if (!a || typeof a !== "object" || !Object.prototype.hasOwnProperty.call(ACTIONS, a.type)) return null;
      const out = { type: a.type };
      for (const [k, t] of Object.entries(ACTIONS[a.type].fields)) {
        const v = t === "num" ? num(a[k]) : clip(a[k], 80);
        if (v == null || v === "") return null;
        out[k] = t === "num" ? Math.round(v) : v;
      }
      out.why = clip(a.why, 200);
      return out;
    }).filter(Boolean).slice(0, 2);
  }
  // Ask the host whether an action can be done right now and what exactly it would change.
  function checkAction(a) {
    if (!O || !O.actionHost || !O.actionHost.check) return { ok: false, error: "Changes from the chat aren't available here." };
    try { const r = O.actionHost.check(a) || {}; return r.ok ? { ok: true, change: String(r.change || ""), view: !!(ACTIONS[a.type] && ACTIONS[a.type].view) } : { ok: false, error: String(r.error || "This can't be done right now.") }; }
    catch (e) { return { ok: false, error: "This can't be done right now." }; }
  }
  function prepareActions(m) {
    (m.actions || []).forEach(a => { const c = checkAction(a); a.status = c.ok ? "proposed" : "blocked"; a.change = c.change || ""; a.error = c.error || ""; a.view = !!c.view; });
  }
  async function runAction(a) {
    if (!a || a.status !== "proposed") return;
    const c = checkAction(a); // the data may have changed since the answer arrived
    if (!c.ok) { a.status = "failed"; a.result = c.error; return; }
    a.status = "applying"; renderPanel();
    try {
      const r = await Promise.resolve(O.actionHost.apply(a));
      a.status = r && r.ok ? "done" : "failed";
      a.result = (r && r.message) || (a.status === "done" ? "Done." : "That didn't work. Nothing was changed.");
    } catch (e) { a.status = "failed"; a.result = "That didn't work. Nothing was changed."; }
  }
  function actionHtml(a, mi, ai) {
    const spec = ACTIONS[a.type] || {}, key = mi + ":" + ai;
    const why = a.why ? '<p class="co-act-why">' + esc(a.why) + "</p>" : "";
    let body;
    if (a.status === "blocked") body = '<p class="co-act-res co-warn">Can\'t do this: ' + esc(a.error) + "</p>";
    else if (a.status === "proposed") body = '<p class="co-act-change">' + esc(a.change) + "</p>" + why + '<div class="co-act-btns">' +
      (a.view ? '<button class="co-btn" style="margin:0" data-coach-act="' + key + '">Show</button>'
        : '<button class="co-btn" style="margin:0" data-coach-act="' + key + '">Confirm</button><button class="co-btn co-ghost" style="margin:0" data-coach-skip="' + key + '">Not now</button>') + "</div>";
    else if (a.status === "applying") body = '<p class="co-act-change">' + esc(a.change) + '</p><p class="co-act-res">Applying…</p>';
    else if (a.status === "done") body = '<p class="co-act-change">' + esc(a.change) + '</p><p class="co-act-res co-good">✓ ' + esc(a.result || "Done.") + "</p>";
    else if (a.status === "failed") body = '<p class="co-act-change">' + esc(a.change) + '</p><p class="co-act-res co-bad">✗ ' + esc(a.result || "Nothing was changed.") + "</p>";
    else body = '<p class="co-act-change">' + esc(a.change) + '</p><p class="co-act-res co-muted">Not applied.</p>';
    return '<div class="co-act"><div class="co-kind">' + (a.view ? "Exercise" : "Proposed change") + '</div><b>' + esc(spec.label || a.type) + "</b>" + body + "</div>";
  }

  // Claude is asked for bare JSON, but a reply wrapped in ```json fences or with a line before the object
  // must still read as an answer, not show up as raw JSON.
  function readJson(text) {
    const t = String(text).trim();
    try { return JSON.parse(t); } catch (e) {}
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
    return { answer: t.replace(/^```(?:json)?\s*|\s*```$/g, "") };
  }
  function parseAnswer(value) {
    let v = value;
    if (typeof v === "string") v = readJson(v);
    if (!v || typeof v !== "object" || !clip(v.answer, 1)) return { answer: "", evidence: [], missing: [], suggestion: null, error: "Claude's answer couldn't be read. Try again." };
    const list = x => (Array.isArray(x) ? x : []).map(s => clip(s, 200)).filter(Boolean).slice(0, 6);
    const sg = v.suggestion && typeof v.suggestion === "object" && clip(v.suggestion.title, 1) ? { title: clip(v.suggestion.title, 100), why: clip(v.suggestion.why, 300) } : null;
    return { answer: String(v.answer).trim().slice(0, 1500), evidence: list(v.evidence), missing: list(v.missing), suggestion: sg, actions: cleanActions(v.actions) };
  }

  const TOPICS = [
    { id: "progress", label: "Is my cut working?" },
    { id: "plateau", label: "Why isn't my weight moving?" },
    { id: "protein", label: "Am I eating enough protein?" },
    { id: "lifts", label: "Which lifts are stalling?" },
    { id: "today", label: "What's left today?" },
  ];

  // Answers the quick questions from the numbers alone, so they work without Claude.
  function localAnswer(topic, docs, opts = {}) {
    const rv = opts.review || review(docs, opts), N = rv.numbers, T = rv.targets;
    const out = (answer, evidence, missing, suggestion) => ({ answer, evidence: (evidence || []).filter(Boolean), missing: missing || [], suggestion: suggestion || null, local: true });
    const head = r => r ? { title: r.title, why: r.why } : null;
    if (!rv.period) return out(rv.headline, [], ["Weigh-ins", "Food marked eaten"]);
    const per = short(rv.period.from) + "–" + short(rv.period.to);
    switch (topic) {
      case "progress":
        return out(rv.headline + " (" + per + ")", rv.checks.filter(c => c.status !== "none").map(c => c.label + ": " + c.value).concat(rv.basis ? [rv.basis] : []), rv.missing, head(rv.recs[0]));
      case "plateau": {
        if (N.rateKgWk == null) return out("There aren't enough weigh-ins in " + per + " to measure a pace yet.", [], rv.missing);
        if (N.progressPctWk != null && N.progressPctWk >= T.paceLo) return out("It is moving: " + sgn(N.rateKgWk) + " kg a week on the trend, inside your plan. Day-to-day jumps are water, salt and food weight.", [rv.checks[0] && rv.checks[0].detail]);
        const why = [];
        if (N.adherence != null && N.adherence < 0.7) why.push("only " + N.onTarget + " of " + N.coreDays + " days were within ±" + T.band + " kcal of target");
        if (N.unlogged.length) why.push(plural(N.unlogged.length, "day") + " have no food logged, so intake may be higher than it looks");
        if (N.breakDays) why.push(plural(N.breakDays, "diet-break day") + " at maintenance");
        if (N.fridayAvg != null && N.fridayAvg > T.kcal + 500) why.push("Fridays averaged " + fint(N.fridayAvg) + " kcal");
        if (!why.length && N.adherence != null) why.push("intake looks on target, so your burn is likely lower than " + fint(T.kcal) + " kcal assumes");
        return out("Weight changed " + sgn(N.rateKgWk) + " kg a week in " + per + ". Likely reasons: " + why.join("; ") + ".", [rv.checks[0] && rv.checks[0].value, rv.checks[1] && rv.checks[1].detail], rv.missing, head(rv.recs.find(r => r.kind !== "tip")));
      }
      case "protein":
        if (T.proteinMin == null) return out(N.proteinAvg == null ? "No food is marked eaten in " + per + "." : "You averaged " + Math.round(N.proteinAvg) + " g a day in " + per + ". Set a protein target in Your numbers and I can tell you if that's enough.", [], ["Protein target"]);
        if (N.proteinAvg == null) return out("No food is marked eaten in " + per + ", so protein can't be checked.", [], ["Food marked eaten"]);
        return out(N.proteinAvg >= T.proteinMin ? "Yes. You averaged " + Math.round(N.proteinAvg) + " g, above your " + T.proteinMin + " g minimum." : "Not quite. You averaged " + Math.round(N.proteinAvg) + " g, " + Math.round(T.proteinMin - N.proteinAvg) + " g under your " + T.proteinMin + " g minimum.",
          [N.proteinHit + " of " + N.foodDays + " logged days reached " + T.proteinMin + " g (" + per + ")"]);
      case "lifts": {
        if (!N.lifts.length) return out("No lift has a logged set in both weeks of " + per + " yet, so nothing can be compared.", [], ["The same exercise logged in both weeks"]);
        const dn = N.lifts.filter(l => l.status !== "up");
        return out(dn.length ? dn.map(l => l.name + " (" + sgn(l.change * 100, 0) + "%)").join(", ") + (dn.length === 1 ? " is" : " are") + " not improving. Holding strength on a cut is a win; a drop of more than a few percent across lifts is the warning sign." : "Every compared lift went up. Nice.",
          N.lifts.map(l => l.name + ": " + l.before.w + "x" + l.before.r + " → " + l.after.w + "x" + l.after.r + " (est. 1RM " + sgn(l.change * 100, 0) + "%)"), [], null);
      }
      case "today": {
        const today = rv.today, e = eaten(((docs || {}).days || {})[today]);
        if (T.kcal == null || T.proteinMin == null) return out(e ? "So far today: " + fint(e.kcal) + " kcal and " + Math.round(e.p) + " g protein eaten. Set your targets in Your numbers to see what's left." : "Nothing is marked eaten today yet.", [], ["Calorie and protein targets"]);
        if (!e) return out("Nothing is marked eaten today yet. Target: " + fint(T.kcal) + " kcal and " + T.proteinMin + " g protein.", [], []);
        return out("You have " + fint(Math.max(0, T.kcal - e.kcal)) + " kcal and " + Math.max(0, Math.round(T.proteinMin - e.p)) + " g protein left today" + (e.kcal > T.kcal ? " (over by " + fint(e.kcal - T.kcal) + " kcal)" : "") + ".",
          ["Eaten so far: " + fint(e.kcal) + " kcal, " + Math.round(e.p) + " g protein", e.planned ? plural(e.planned, "planned item") + " not marked eaten yet (not counted)" : null]);
      }
    }
    return out("", [], []);
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
.co-ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.co-miss{font-size:.85rem;color:var(--muted);margin:6px 0 0;padding-left:18px}
.co-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.co-ins{border:1px solid var(--line);border-left:4px solid var(--muted);border-radius:var(--r);padding:10px 12px;background:var(--sunk)}
.co-ins+.co-ins{margin-top:8px}
.co-ins-good{border-left-color:var(--good)}.co-ins-warn{border-left-color:var(--warn)}.co-ins-info{border-left-color:var(--accent)}
.co-ins-head{display:flex;justify-content:space-between;align-items:start;gap:8px}
.co-ins p{margin:4px 0 0;font-size:.9rem;color:var(--ink)}
.co-ins details{margin-top:6px;font-size:.8rem;color:var(--muted)}
.co-ins ul{margin:4px 0 0;padding-left:18px}
.co-act{margin-top:10px;border:1px solid var(--line);border-radius:var(--r);padding:10px 12px;background:var(--surface)}
.co-act b{display:block;margin-top:2px}
.co-act-change{margin:6px 0 0;font-size:.88rem;color:var(--ink)}
.co-act-why{margin:4px 0 0;font-size:.8rem;color:var(--muted)}
.co-act-res{margin:6px 0 0;font-size:.85rem;font-weight:600}
.co-act-btns{display:flex;gap:8px;margin-top:8px}
.co-list{margin:6px 0 0;padding-left:18px;font-size:.85rem;color:var(--ink)}
.co-month{margin-top:6px}
.co-bar{height:6px;border-radius:999px;background:var(--line);overflow:hidden}
.co-bar i{display:block;height:100%;background:var(--good)}
.co-bar i.co-warn{background:var(--warn)}.co-bar i.co-bad{background:var(--bad)}
.co-settings select{margin-left:6px;font:inherit;padding:4px 6px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
.co-x{border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:.9rem;padding:0 2px}
.co-chip{margin-top:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:6px 12px;font-size:.85rem;cursor:pointer}
.co-chips button{border:1px solid var(--line);background:var(--sunk);color:var(--ink);border-radius:999px;padding:6px 12px;font-size:.85rem;cursor:pointer}
.co-ask{display:flex;gap:6px;margin-top:6px}
.co-ask input{flex:1;min-width:0;padding:10px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface);color:var(--ink);font:inherit}
.co-msgs{display:grid;gap:10px;margin-top:10px}
.co-q{justify-self:end;max-width:85%;min-width:0;overflow-wrap:anywhere;background:var(--accent);color:var(--accent-ink);padding:8px 12px;border-radius:14px 14px 4px 14px;font-size:.9rem}
.co-a{max-width:95%;min-width:0;overflow-wrap:anywhere;background:var(--sunk);border:1px solid var(--line);padding:10px 12px;border-radius:14px 14px 14px 4px;font-size:.9rem;color:var(--ink)}
.co-a details{margin-top:6px;color:var(--muted);font-size:.8rem}
.co-a ul{margin:4px 0 0;padding-left:18px}
.co-src{font-size:.7rem;color:var(--muted);margin-top:6px}
.co-err{color:var(--bad);font-size:.85rem;margin-top:6px}
.co-mic{min-width:44px;padding:0 10px;margin:0}
.co-mic.on{background:var(--bad);color:#fff;border-color:var(--bad)}
.co-vstat{margin:6px 0 0}
.co-linkbtn{background:none;border:0;padding:0;color:var(--accent,inherit);text-decoration:underline;font:inherit;cursor:pointer}
.co-vlang{min-width:44px;padding:0 8px;margin:0;font-size:.8rem}
.co-toggle{display:flex;gap:8px;align-items:center;margin:8px 0 0}
@media (prefers-reduced-motion:no-preference){.co-new{animation:co-in .25s ease-out}@keyframes co-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}}
/* Ask Claude: floating button + panel (bottom sheet on phones, side panel on desktop) */
.co-fab{position:fixed;right:max(16px,env(safe-area-inset-right,0px));bottom:calc(88px + env(safe-area-inset-bottom,0px));z-index:30;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:11px 15px;background:var(--accent);color:var(--accent-ink);font:inherit;font-weight:700;box-shadow:0 6px 18px rgb(0 0 0/.16);cursor:pointer}
.co-fab .co-fab-i{font-size:1.1rem;line-height:1}
.co-fab:active{transform:scale(.97)}
@media (min-width:721px){.co-fab{bottom:24px;right:24px}}
.co-scrim{position:fixed;inset:0;z-index:31;background:rgb(0 0 0/.35)}
.co-panel{position:fixed;z-index:32;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);box-shadow:0 -10px 40px rgb(0 0 0/.25);left:0;right:0;bottom:0;max-height:min(86vh,860px);border-radius:18px 18px 0 0;transform:translateY(102%);transition:transform .28s cubic-bezier(.2,.8,.2,1);visibility:hidden}
.co-panel.co-open{transform:none;visibility:visible}
@media (min-width:721px){.co-panel{left:auto;top:0;width:min(440px,92vw);max-height:none;border-radius:0;border-width:0 0 0 1px;transform:translateX(102%);box-shadow:-10px 0 40px rgb(0 0 0/.25)}}
.co-ph{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 16px;border-bottom:1px solid var(--line)}
.co-ph b{font-family:var(--display);font-size:1.25rem;letter-spacing:.02em;text-transform:uppercase}
.co-body{flex:1;overflow:auto;overflow-x:hidden;padding:12px 16px;overscroll-behavior:contain;min-width:0}
.co-panel{max-width:100vw;box-sizing:border-box}
.co-pf{padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line);background:var(--surface)}
.co-pf .co-ask{margin-top:0}
.co-note{margin:0 0 8px}
.co-live{white-space:pre-wrap;overflow-wrap:anywhere}
.co-cursor{display:inline-block;width:.5em;height:1em;vertical-align:-.15em;margin-left:2px;background:var(--accent);animation:co-blink 1s steps(2) infinite}
@keyframes co-blink{to{opacity:0}}
@media (prefers-reduced-motion:reduce){.co-panel{transition:none}.co-cursor{animation:none}}
`;
  const S = { from: null, msgs: [], busy: false, error: "", ctl: null, draft: "", hidden: false, noClaude: false, noClaudeWhy: "", open: false, stream: "", loaded: false, consentQ: null, month: null, monthErr: "", monthAt: 0, settings: false, capMsg: "", voice: null, voiceErr: "", voiceLang: null, voiceRaw: null, tidying: false, sendAfterTidy: false };
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
      (i.ask ? '<button class="co-chip" data-coach-ask="' + esc(i.ask) + '">Ask Claude about this</button>' : "") + "</div>").join("");
    return '<div class="card co-insights"><h3>Patterns in your logs</h3><p class="co-src" style="margin-top:0">Worked out from your logs, no Claude needed. Each shows once a week at most.</p>' + items + "</div>";
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

  function answerHtml(m, mi) {
    const nw = m.seen ? "" : " co-new";
    if (m.pending) return '<div class="co-a">Thinking…</div>';
    const ev = m.evidence && m.evidence.length ? "<details open><summary>Based on</summary><ul>" + m.evidence.map(e => "<li>" + esc(e) + "</li>").join("") + "</ul></details>" : "";
    const ms_ = m.missing && m.missing.length ? "<details><summary>Not logged yet</summary><ul>" + m.missing.map(e => "<li>" + esc(e) + "</li>").join("") + "</ul></details>" : "";
    const sg = m.suggestion ? '<p style="margin:8px 0 0"><b>Suggestion:</b> ' + esc(m.suggestion.title) + (m.suggestion.why ? " — " + esc(m.suggestion.why) : "") + "</p>" : "";
    const acts = (m.actions || []).length && mi != null ? m.actions.map((a, ai) => actionHtml(a, mi, ai)).join("") : "";
    return '<div class="co-a' + nw + '" dir="auto">' + esc(m.answer) + sg + acts + ev + ms_ + '<div class="co-src">' + (m.local ? "Worked out from your logs" : "Claude, from your logs only" + (m.costUsd != null && showCost() ? " · " + money(m.costUsd) : "")) + "</div></div>";
  }

  // ---------- What gets sent to the coach service ----------
  const langOf = q => /[\u0600-\u06FF]/.test(String(q || "")) ? "ar" : "en";
  // Harder, personal "why / should I / plan" questions get medium effort; everything else low (cheaper, faster).
  const DEEP = /\b(why|should i|should we|plan|compare|explain|how come|what if|adjust|change my)\b|لماذا|ليش|ليه|هل يجب|هل لازم|خطة|خطتي|قارن|اشرح|وش اسوي|ماذا أفعل/i;
  const effortFor = (q, history) => DEEP.test(String(q || "")) || (history || []).length >= 3 ? "medium" : "low";
  // Only the parts of the data pack a question needs. Unclear questions keep everything.
  const SECTIONS = {
    weight: { re: /weigh|scale|kg\b|trend|plateau|stall|pace|loss|losing|gain|body|fat|وزن|الميزان|كيلو|نزول|ثبات|دهون|جسم/i, keys: ["weight", "review", "calorieBurn", "dietBreak", "food14"] },
    food: { re: /eat|food|meal|protein|calor|kcal|carb|fat\b|snack|menu|dinner|lunch|breakfast|hungry|diet|اكل|أكل|وجبة|بروتين|سعرات|كارب|دهون|عشاء|غداء|فطور|جوع|سناك|منيو/i, keys: ["todaySoFar", "food14", "plannedToday", "eatenToday", "savedMeals", "menuToday", "dislikes", "calorieCycling", "dietBreak", "review"] },
    training: { re: /train|lift|bench|squat|deadlift|press|row|curl|set|rep|gym|workout|exercise|muscle|strong|deload|swap|form|تمرين|تمارين|جيم|عضل|قوة|بنش|سكوات|ديدلفت|مجموعة|عدات|تبديل/i, keys: ["lifts", "planToday", "strength", "workouts14", "exercisesThatHurt", "recentSwaps", "exerciseAsked", "deloadCheck", "readiness7"] },
    recovery: { re: /sleep|tired|sore|rest|recover|fatigue|energy|steps|cardio|walk|run|نوم|تعب|إرهاق|ارهاق|راحة|استشفاء|طاقة|خطوات|كارديو|مشي|جري/i, keys: ["sleepLast7", "readiness7", "recovery", "steps7", "stepGoal", "cardio", "cardio14", "deloadCheck", "workouts14"] },
  };
  const CORE = ["today", "weekday", "targets", "plan", "basis", "todaySoFar"];
  function trimContext(ctx, question) {
    const hits = Object.values(SECTIONS).filter(sec => sec.re.test(String(question || "")));
    if (!hits.length || hits.length === Object.keys(SECTIONS).length) return ctx;
    const keep = new Set(CORE.concat(...hits.map(h => h.keys)));
    const out = {}; Object.keys(ctx).forEach(k => { if (keep.has(k)) out[k] = ctx[k]; });
    if (ctx.weight && !keep.has("weight")) out.weight = { latest: ctx.weight.latest, avg7: ctx.weight.avg7 };
    return out;
  }

  function errorText(code) {
    switch (code) {
      case "not_granted": case "sampling_disabled": case "not_declared": case "capability_disabled": case "capability_removed":
        return "Claude isn't available on this page right now. The quick questions still work.";
      case "rate_limited": return "Claude is busy for a moment. Wait a minute and try again.";
      case "session_expired": return "You've been signed out. Reload the page and try again.";
      case "refused": return "Claude couldn't answer that one. Try asking it another way.";
      case "invalid_json": case "empty_completion": return "Claude's answer couldn't be read. Try again.";
      case "prompt_too_large": return "Too much data to send at once. Try a shorter question.";
      case "not_signed_in": return "Sign in to ask Claude. The quick questions still work.";
      case "daily_cap": return "You've reached today's question limit. It resets at midnight; the quick questions still work.";
      case "no_key": return "The coach service is running but has no API key yet. The quick questions still work.";
      case "no_endpoint": return "The coach service isn't set up yet. Add its address in AI settings. The quick questions still work.";
      case "offline": return "You're offline. Logging works; Claude needs a connection.";
      case "not_allowed": return "This account isn't allowed to use the AI chat. Only the owner's account can spend the API credit.";
      case "cap_reached": return "The AI chat has reached this month's limit, so no new questions are sent. The quick questions still work.";
      case "out_of_credit": return "The Anthropic API credit has run out. Add credit in the Claude Console to keep using the AI chat.";
      case "daily_limit": return "You've asked a lot today, so the AI chat is paused until tomorrow. The quick questions still work.";
      case "busy": return "One answer is still on its way. Wait for it, then ask again.";
      case "upstream_busy": return "Claude is busy right now. Try again in a minute.";
      case "upstream_unreachable": case "stream_broken": return "The answer was cut off. Try again; only what was used is counted.";
      case "timeout": return "Claude took too long to answer. Try again or ask something shorter.";
      case "bad_key": return "The API key in the coach service isn't valid. Check it in Cloudflare (see the setup steps).";
      case "too_large": return "Too much data to send at once. Try a shorter question.";
      case "no_consent": return "Turn on the AI chat first. The quick questions work without it.";
      default: return "Something went wrong reaching Claude. Try again.";
    }
  }

  // ---------- Ask Claude: the chat panel ----------
  // Suggested questions per screen. `topic` = answered from the numbers without Claude.
  const SUGGEST = {
    today: [{ q: "What's left today?", topic: "today" }, { q: "Should I take a rest day?" }, { q: "How am I doing this week?" }],
    train: [{ q: "What should I train today?" }, { q: "Did I get stronger this week?" }, { q: "Which lifts are stalling?", topic: "lifts" }, { q: "Should I increase my bench press weight?" }],
    food: [{ q: "Am I eating enough protein?", topic: "protein" }, { q: "What should I eat today?" }, { q: "How many calories have I eaten today?" }],
    progress: [{ q: "Is my plan working?", topic: "progress" }, { q: "Why isn't my weight moving?", topic: "plateau" }, { q: "Is my pace right for my goal?" }],
    guide: [{ q: "Explain my calorie target" }, { q: "What's left today?", topic: "today" }],
  };
  function suggestions(tab) { return SUGGEST[tab] || SUGGEST.today; }

  // While Claude streams its JSON reply, show the text of "answer" as it grows.
  function partialAnswer(text) {
    const m = /"answer"\s*:\s*"/.exec(text || "");
    if (!m) return "";
    let out = "", i = m.index + m[0].length;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "\\") { const n = text[i + 1]; if (n === undefined) break; out += n === "n" ? "\n" : n === "t" ? " " : n === "u" ? "" : n; i += n === "u" ? 5 : 1; continue; }
      if (c === '"') break;
      out += c;
    }
    return out;
  }

  // The compact card (Progress tab): opens the panel.
  function chatHtml() {
    const chips = suggestions("progress").slice(0, 3).map(s => '<button data-coach-ask="' + esc(s.q) + '"' + (s.topic ? ' data-coach-topic="' + s.topic + '"' : "") + ">" + esc(s.q) + "</button>").join("");
    return '<div class="card co-chat"><div class="co-head"><h3>Ask Claude</h3><button class="co-btn co-ghost" style="margin:0" data-coach-open>Open chat</button></div>' +
      '<p class="co-src" style="margin-top:0">Your coach answers from what you\'ve logged. Nothing changes unless you confirm it.</p><div class="co-chips">' + chips + "</div></div>";
  }

  function transportNote() {
    if (S.noClaude) return S.noClaudeWhy || "Free-form questions need Claude, which isn't available here. The suggested questions still work.";
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "You're offline. Logging works; Claude needs a connection. The quick questions still work.";
    return "";
  }

  const money = usd => usd == null ? "" : usd < 0.01 ? "under $0.01" : "$" + (usd < 10 ? usd.toFixed(2) : usd.toFixed(0));
  const SENT = ["your question and the last few questions and answers in this chat",
    "the goal questionnaire answers (goals, pace, sex, age, height, weights) and your targets",
    "summaries the question needs: weight averages, food totals and today's food, workouts and lifts, sleep, readiness, steps and cardio"];
  const NOT_SENT = "Not sent: your name, email, password, photos, friends, notes from other screens or the full log history.";
  function consentHtml() {
    return '<div class="co-act co-consent"><b>Turn on the AI chat?</b><p class="co-act-change">To answer, Mizan sends this to Anthropic (the company behind Claude) through your own coach service:</p><ul class="co-list">' +
      SENT.map(x => "<li>" + esc(x) + "</li>").join("") + '</ul><p class="co-act-why">' + esc(NOT_SENT) + " Answers use your Anthropic API credit; a monthly limit on the service stops it before the limit is passed. You can turn it off any time in AI settings.</p>" +
      '<div class="co-act-btns"><button class="co-btn" style="margin:0" data-coach-consent="yes">Turn on and ask</button><button class="co-btn co-ghost" style="margin:0" data-coach-consent="no">Not now</button></div></div>';
  }
  // Spending amounts stay hidden unless "Show spending details" is on in AI settings (Aziz, Nov 2: people
  // looking at his phone shouldn't see what the API costs). The server's limit works the same either way.
  const showCost = () => !!(O && O.showCost && O.showCost());
  function statusHtml() {
    const mo = S.month;
    if (!mo) return S.monthErr ? '<p class="co-src co-warn">' + esc(S.monthErr) + "</p>" : "";
    return mo.stopped ? '<p class="co-src co-bad">Monthly limit reached: new questions are stopped until next month.</p>'
      : mo.warn ? '<p class="co-src co-warn">Close to this month\'s limit.</p>' : '<p class="co-src co-good">AI chat is on.</p>';
  }
  function monthHtml() {
    if (!showCost()) return statusHtml();
    const mo = S.month;
    if (!mo) return S.monthErr ? '<p class="co-src co-warn">' + esc(S.monthErr) + "</p>" : '<p class="co-src">Spending: loading…</p>';
    const spent = mo.usedUsd + mo.pendingUsd, pct = mo.capUsd ? Math.min(100, Math.round(spent / mo.capUsd * 100)) : 100;
    const cls = mo.stopped ? "co-bad" : mo.warn ? "co-warn" : "co-good";
    return '<div class="co-month"><div class="co-bar"><i class="' + cls + '" style="width:' + Math.max(2, pct) + '%"></i></div>' +
      '<p class="co-src" style="margin:4px 0 0"><b>' + money(mo.usedUsd) + "</b> of your $" + mo.capUsd + " cap this month (" + mo.requests + " answer" + (mo.requests === 1 ? "" : "s") + ")" +
      (mo.pendingUsd ? " · " + money(mo.pendingUsd) + " on its way" : "") + (mo.unsettledUsd ? " · " + money(mo.unsettledUsd) + " counted at its estimate (answer lost)" : "") + "</p>" +
      (mo.stopped ? '<p class="co-src co-bad">Cap reached: new questions are stopped until next month or until you raise the cap.</p>' : mo.warn ? '<p class="co-src co-warn">Over 80 % of the cap is used.</p>' : "") +
      '<p class="co-src" style="margin:2px 0 0">Counted from the tokens Anthropic reports, at Claude Haiku 5.5 list prices. Since setup: ' + money(mo.allTimeUsd) + ". Your Claude Console shows the actual bill.</p></div>";
  }
  function settingsHtml() {
    const url = serviceUrl() || "", mo = S.month, caps = [5, 10, 20, 50, 100];
    return '<div class="co-act co-settings"><b>AI settings</b>' +
      (url && consented() ? monthHtml() + '<label class="co-src co-toggle"><input type="checkbox" data-coach-showcost' + (showCost() ? " checked" : "") + "> Show spending details</label>" + (!showCost() ? (S.capMsg ? '<p class="co-src">' + esc(S.capMsg) + "</p>" : "") : '<div class="co-act-btns" style="flex-wrap:wrap;align-items:center"><label class="co-src" style="margin:0">Monthly cap <select data-coach-capsel>' +
        caps.map(c => '<option value="' + c + '"' + (mo && mo.capUsd === c ? " selected" : "") + ">$" + c + "</option>").join("") + '</select></label><button class="co-btn co-ghost" style="margin:0" data-coach-capsave>Save cap</button><button class="co-btn co-ghost" style="margin:0" data-coach-refresh>Refresh</button></div>' +
        (S.capMsg ? '<p class="co-src">' + esc(S.capMsg) + "</p>" : "")) : "") +
      '<form data-coach-svcform class="co-ask" style="margin-top:8px"><input data-coach-svc placeholder="https://mizan-coach.….workers.dev" value="' + esc(url) + '" inputmode="url" autocomplete="off"><button class="co-btn co-ghost" style="margin:0">Save address</button></form>' +
      '<p class="co-src">Coach service base address, without /v1/…. Leave it as it is unless you run your own service. It is not a secret; the API key stays in the service.</p>' +
      (consented() ? '<button class="co-btn co-ghost" style="margin:6px 0 0" data-coach-consent="off">Turn off the AI chat</button>' : "") + "</div>";
  }
  // ---------- Voice questions ----------
  // Uses the speech service the app already has (VoiceLog.speech: the Android Speech plugin, or the browser's
  // SpeechRecognition). Aziz, Nov 3: keep listening while he pauses to think or breathe, and never send by
  // itself. Each time the phone's recogniser ends a phrase the mic starts again and the words are added, until he
  // taps ■ (stop and check the words) or Ask (send). Then the coach service tidies the transcript (misheard or
  // mixed-up words, repeats, "no I mean…"); "Use what I said" puts the raw words back. English or Arabic (EN / ع).
  const speechApi = () => { const sp = O && O.speech && O.speech(); return sp && sp.supported && sp.supported() ? sp : null; };
  const voiceLang = () => S.voiceLang || (() => { const last = S.msgs.filter(m => m.q).slice(-1)[0];
    if (last) return langOf(last.q); return typeof navigator !== "undefined" && /^ar/i.test(navigator.language || "") ? "ar" : "en"; })();
  const SPEECH_LANG = { en: "en-US", ar: "ar-KW" };
  const VOICE = { quietRounds: 6, maxMs: 5 * 60e3, restartMs: 200, stopWaitMs: 1500, tidyMs: 12000 };
  function voiceErrorText(code) {
    if (O && O.speechError) { try { return O.speechError(code); } catch (e) {} }
    return code === "not-allowed" ? "Mizan isn't allowed to use the microphone. Allow it in the phone's settings, or type the question." : "Couldn't hear that. Tap the mic and try again, or type the question.";
  }
  const voiceText = v => v.segs.concat(v.cur ? [v.cur] : []).map(x => String(x).trim()).filter(Boolean).join(" ");
  function showDraft(v) { S.draft = voiceText(v); const inp = host && host.querySelector("[data-coach-input]"); if (inp) inp.value = S.draft; }
  function startVoice() {
    const sp = speechApi(); if (!sp || S.busy || S.tidying) return;
    S.voiceErr = ""; S.error = ""; S.voiceRaw = null;
    const base = String(S.draft || "").trim();
    const v = S.voice = { segs: base ? [base] : [], cur: "", ctl: null, stopping: false, then: "review", quiet: 0, at: Date.now(), timer: null };
    renderPanel(); segment(v, sp);
  }
  function segment(v, sp) {
    if (S.voice !== v || v.stopping) return;
    let ended = false;
    const end = code => { if (ended) return; ended = true; segEnd(v, sp, code); };
    v.ctl = sp.start({
      lang: SPEECH_LANG[voiceLang()],
      onText: (text, final) => {
        if (S.voice !== v || ended) return;
        if (final) { if (String(text).trim()) { v.segs.push(String(text).trim()); v.quiet = 0; } v.cur = ""; } else v.cur = String(text || "");
        showDraft(v);
      },
      onEnd: () => end(null),
      onError: code => end(code || "error"),
    }) || null;
  }
  function segEnd(v, sp, code) {
    if (S.voice !== v) return;
    if (v.cur) { v.segs.push(v.cur.trim()); v.cur = ""; }
    if (v.stopping) return finishVoice(v);
    if (code && code !== "no-speech" && code !== "busy") { S.voiceErr = voiceErrorText(code); return finishVoice(v); }
    if (code) v.quiet++; // silence, or the recogniser still releasing the last phrase: listen again
    // A long silence or a very long recording stops the mic, but nothing is sent.
    if (v.quiet >= VOICE.quietRounds || Date.now() - v.at > VOICE.maxMs) { S.voiceErr = "Stopped listening after a long pause. Tap 🎤 to carry on, or press Ask."; return finishVoice(v); }
    v.timer = setTimeout(() => segment(v, sp), VOICE.restartMs);
  }
  // then: "review" (■: tidy and show the words), "send" (Ask: tidy, then send), "keep" (panel closed: keep the words)
  function stopVoice(then) {
    const v = S.voice; if (!v) return;
    v.stopping = true; v.then = then || "keep"; clearTimeout(v.timer);
    if (v.ctl) { try { v.ctl.stop(); } catch (e) {} }
    setTimeout(() => finishVoice(v), VOICE.stopWaitMs); // in case the recogniser never reports its end
    if (!v.ctl) finishVoice(v);
  }
  function finishVoice(v) {
    if (S.voice !== v) return;
    S.voice = null; clearTimeout(v.timer);
    const raw = voiceText(v);
    S.draft = raw.slice(0, 600);
    if (!raw || v.then === "keep") { renderPanel(); return; }
    S.tidying = true; renderPanel();
    tidyVoice(raw).then(clean => {
      S.tidying = false;
      if (clean && clean !== raw) { S.voiceRaw = raw.slice(0, 600); S.draft = clean.slice(0, 600); }
      if (v.then === "send" || S.sendAfterTidy) { S.sendAfterTidy = false; S.voiceRaw = null; ask(S.draft); return; }
      renderPanel();
    });
  }
  // Names from his own logs help the clean-up spell exercises and meals ("Romanian deadlift", not "Romanian dead lift").
  function voiceHints() {
    try {
      const o = oo(), c = context(O.getDocs(), o);
      return [].concat((c.lifts || []).map(l => l.name), ((o.planToday || {}).exercises || []).map(x => x.name), (c.savedMeals || []).map(m => m.name),
        (c.menuToday || []).map(m => m && m.name), o.exerciseNames || []).filter(x => typeof x === "string" && x).filter((x, i, a) => a.indexOf(x) === i).slice(0, 80);
    } catch (e) { return []; }
  }
  // Gives back the tidied text, or the words as spoken when the service isn't set up, isn't turned on, or fails.
  async function tidyVoice(text) {
    if (!serviceUrl() || !consented()) return text;
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t = setTimeout(() => ctl && ctl.abort(), VOICE.tidyMs);
    try {
      const r = await service("/v1/tidy", { method: "POST", body: JSON.stringify({ text, lang: langOf(text), hints: voiceHints() }), signal: ctl && ctl.signal });
      const j = await r.json();
      const out = String((j && j.text) || "").trim();
      return out && out.length <= text.length * 2 + 40 ? out : text;
    } catch (e) { S.voiceErr = "Couldn't tidy the words, so they're as heard. Check them before you press Ask."; return text; }
    finally { clearTimeout(t); }
  }
  function voiceStatusHtml() {
    const ar = voiceLang() === "ar";
    if (S.voice) return '<p class="co-src co-vstat">' + (ar ? "أسمعك. خذ وقتك، وإذا خلصت اضغط ■ لتراجع الكلام أو Ask للإرسال." : "Listening. Pause whenever you like; tap ■ to check the words, or Ask to send.") + "</p>";
    if (S.tidying) return '<p class="co-src co-vstat">' + (ar ? "أصلّح الكلمات…" : "Fixing misheard words…") + "</p>";
    if (S.voiceRaw && S.voiceRaw !== S.draft) return '<p class="co-src co-vstat">' + (ar ? "صلّحت الكلمات. راجعها واضغط Ask." : "Words tidied. Check them, then press Ask.") + ' <button type="button" class="co-linkbtn" data-coach-voiceraw>' + (ar ? "رجّع كلامي" : "Use what I said") + "</button></p>";
    return "";
  }
  function micHtml() {
    if (!speechApi()) return "";
    const on = !!S.voice, ar = voiceLang() === "ar";
    return '<button type="button" class="co-btn co-ghost co-vlang" data-coach-vlang aria-label="Voice language: ' + (ar ? "Arabic" : "English") + '" title="Voice language">' + (ar ? "ع" : "EN") + "</button>" +
      '<button type="button" class="co-btn co-ghost co-mic' + (on ? " on" : "") + '" data-coach-mic aria-label="' + (on ? "Stop listening" : "Ask by voice") + '" aria-pressed="' + on + '"' + (S.busy || S.tidying ? " disabled" : "") + ">" + (on ? "■" : "🎤") + "</button>";
  }
  function panelHtml() {
    const tab = O && O.tab ? O.tab() : "today";
    const sugg = suggestions(tab);
    const chips = '<div class="co-chips">' + sugg.map(s => '<button data-coach-ask="' + esc(s.q) + '"' + (s.topic ? ' data-coach-topic="' + s.topic + '"' : "") + ">" + esc(s.q) + "</button>").join("") + "</div>";
    const note = transportNote();
    const live = S.busy && S.stream ? '<div class="co-q" dir="auto">' + esc(S.msgs[S.msgs.length - 1].q) + '</div><div class="co-a co-live" dir="auto">' + esc(S.stream) + '<span class="co-cursor"></span></div>' : "";
    const msgs = S.msgs.map((m, i) => (m.pending && live) ? "" : (m.q ? '<div class="co-q" dir="auto">' + esc(m.q) + "</div>" : "") + answerHtml(m, i)).join("") + live;
    S.msgs.forEach(m => { m.seen = true; });
    const form = (S.voiceErr ? '<p class="co-err" style="margin:0 0 6px">' + esc(S.voiceErr) + "</p>" : "") + '<form class="co-ask" data-coach-form><input data-coach-input dir="auto" placeholder="' + (S.voice ? (voiceLang() === "ar" ? "أسمعك… خذ راحتك" : "Listening… take your time") : "Ask about training, food or weight · اسأل بالعربي") + '" value="' + esc(S.draft) + '" maxlength="600"' + (S.busy ? " disabled" : "") + ' autocomplete="off">' + micHtml() + '<button class="co-btn" style="margin:0"' + (S.busy ? " disabled" : "") + ">Ask</button>" + (S.busy ? '<button type="button" class="co-btn co-ghost" style="margin:0" data-coach-stop>Stop</button>' : "") + "</form>" + voiceStatusHtml();
    return '<button class="co-fab" data-coach-open aria-label="Ask the coach" title="Ask the coach"><span class="co-fab-i">✦</span><span class="co-fab-t">Coach</span></button>' +
      '<div class="co-scrim" data-coach-close' + (S.open ? "" : " hidden") + '></div>' +
      '<section class="co-panel' + (S.open ? " co-open" : "") + '" role="dialog" aria-label="Ask Claude" aria-hidden="' + (S.open ? "false" : "true") + '">' +
      '<header class="co-ph"><div><b>Ask Claude</b><div class="co-src" style="margin:0">' + (serviceUrl() ? "Claude Haiku 5.5 · answers use only what you\'ve logged" : "Answers use only what you\'ve logged") + '</div></div><div class="co-nav">' +
      '<button data-coach-settings title="AI settings" aria-label="AI settings"' + (S.settings ? ' aria-pressed="true"' : "") + ">⚙</button>" +
      (S.msgs.length ? '<button data-coach-clear title="Clear chat">⌫</button>' : "") + '<button data-coach-close aria-label="Close">✕</button></div></header>' +
      '<div class="co-body" data-coach-body>' + (S.settings ? settingsHtml() : "") + (S.msgs.length ? "" : '<p class="co-src">Try one of these, or type your own question.</p>') + chips +
      (S.msgs.length ? '<div class="co-msgs">' + msgs + "</div>" : "") + (S.consentQ ? consentHtml() : "") + (S.error && !S.noClaude ? '<p class="co-err">' + esc(S.error) + "</p>" : "") + "</div>" +
      '<footer class="co-pf">' + (note ? '<p class="co-src co-note">' + esc(note) + "</p>" : "") + form + "</footer></section>";
  }

  let host = null;
  function renderPanel() {
    if (!host) return;
    const body = host.querySelector("[data-coach-body]"), atBottom = body ? body.scrollTop + body.clientHeight >= body.scrollHeight - 40 : true;
    const active = typeof document !== "undefined" && document.activeElement && document.activeElement.matches && document.activeElement.matches("[data-coach-input]");
    host.innerHTML = panelHtml();
    const nb = host.querySelector("[data-coach-body]");
    if (nb && (atBottom || S.busy)) nb.scrollTop = nb.scrollHeight;
    if (active && S.open && !S.busy) { const inp = host.querySelector("[data-coach-input]"); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
  }
  function loadHistory() {
    if (S.loaded || !O || !O.chats) return;
    S.loaded = true;
    try { const h = O.chats.load(); if (Array.isArray(h)) S.msgs = h.filter(m => m && m.q && m.answer).slice(-40).map(m => Object.assign({ seen: true }, m, { actions: (m.actions || []).map(a => Object.assign({}, a, a.status === "applying" ? { status: "failed", result: "Interrupted. Check the screen before trying again." } : a.status === "proposed" ? { status: "expired" } : {})) })); } catch (e) {}
  }
  function saveHistory() {
    if (!O || !O.chats) return;
    try { O.chats.save(S.msgs.filter(m => m.q && m.answer).slice(-40).map(m => ({ q: m.q, answer: m.answer, evidence: m.evidence || [], missing: m.missing || [], suggestion: m.suggestion || null, local: !!m.local, at: m.at || Date.now(), costUsd: m.costUsd != null ? m.costUsd : undefined, actions: (m.actions || []).map(a => Object.assign({}, a)) }))); } catch (e) {}
  }
  function openPanel(on) {
    loadHistory();
    S.open = on !== false;
    if (!S.open) stopVoice("keep");
    renderPanel();
    if (S.open) refreshMonth(false);
    if (S.open) { const inp = host && host.querySelector("[data-coach-input]"); if (inp && window.matchMedia && !window.matchMedia("(max-width:720px)").matches) inp.focus(); }
  }
  // Mount once, outside the host's re-rendered area. The panel keeps its own DOM.
  function mountPanel(el, opts) {
    if (opts) O = Object.assign(O || {}, opts);
    host = el;
    renderPanel();
    if (typeof window !== "undefined") { window.addEventListener("online", renderPanel); window.addEventListener("offline", renderPanel); }
  }

  const call = k => { try { return O[k] ? O[k]() : undefined; } catch (e) { return undefined; } };
  const oo = () => ({ today: call("today"), effort: call("effort"), tdee: call("tdee"), targets: call("targets"), rules: call("rules"), plan: call("plan"), kcalTarget: O.kcalTarget,
    strength: call("strength"), recoveryText: call("recoveryText"), cardioText: call("cardioText"), planToday: call("planToday"), exerciseNames: call("exerciseNames"), exercise: O.exercise });
  const rerender = () => { renderPanel(); if (O.render && !host) O.render(); };

  // Transport 2: the app's own server endpoint (website build). Streams the model text back.
  // The service's BASE address. People often paste the health-check link (…/v1/health) or an endpoint link;
  // those suffixes are dropped so the app never calls …/v1/health/v1/chat.
  function normalizeService(u) {
    let v = String(u == null ? "" : u).trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
    v = v.replace(/\/v1(\/(health|chat|usage|cap))?$/i, "").replace(/\/+$/, "");
    return v;
  }
  const serviceOk = v => /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w\-./]*)?$/i.test(v);
  const serviceUrl = () => { if (!O) return null; const u = normalizeService(typeof O.endpoint === "function" ? O.endpoint() : O.endpoint); return u && serviceOk(u) ? u : null; };
  const consented = () => !!(O && O.consent && O.consent());
  const errOf = code => { const x = new Error(code); x.code = code; return x; };
  async function service(path, init) {
    const token = O.getToken ? await O.getToken().catch(() => null) : null;
    if (!token) throw errOf("not_signed_in");
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw errOf("offline");
    let res;
    try { res = await fetch(serviceUrl() + path, Object.assign({}, init, { headers: Object.assign({ authorization: "Bearer " + token }, init && init.body ? { "content-type": "application/json" } : {}) })); }
    catch (e) { if (e && e.name === "AbortError") throw e; throw errOf(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "upstream_unreachable"); }
    if ((res.headers.get("content-type") || "").toLowerCase().includes("text/html")) throw errOf("no_endpoint");
    if (!res.ok) {
      let j = {}; try { j = await res.json(); } catch (_) {}
      const x = errOf(j.error || (res.status === 401 ? "not_signed_in" : "http_" + res.status));
      if (j.month) S.month = j.month;
      if (j.uid) x.uid = j.uid;
      throw x;
    }
    return res;
  }
  async function askEndpoint(question, ctx, history, signal, onDelta) {
    const body = JSON.stringify({ question, ctx, history: history.slice(-4).map(h => ({ q: String(h.q).slice(0, 600), a: String(h.a).slice(0, 1200) })), effort: effortFor(question, history), lang: langOf(question) });
    const res = await service("/v1/chat", { method: "POST", body, signal });
    let text = "", done = null, buf = "";
    const take = line => { if (!line.trim()) return; let o; try { o = JSON.parse(line); } catch (e) { return; }
      if (o.t === "d") { text += o.text; onDelta(text); } else if (o.t === "done") done = o; else if (o.t === "error") { if (o.month) S.month = o.month; const x = errOf(o.error); x.costUsd = o.costUsd; throw x; } };
    if (res.body && res.body.getReader) {
      const rd = res.body.getReader(), dec = new TextDecoder();
      for (;;) { const { value, done: end } = await rd.read(); if (end) break; buf += dec.decode(value, { stream: true }); let k; while ((k = buf.indexOf("\n")) >= 0) { take(buf.slice(0, k)); buf = buf.slice(k + 1); } }
    } else (await res.text()).split("\n").forEach(take);
    take(buf);
    if (!done) throw errOf("stream_broken");
    if (done.month) { S.month = done.month; S.monthAt = Date.now(); }
    if (done.stop === "refusal") throw errOf("refused");
    return { text, costUsd: done.costUsd, usage: done.usage };
  }
  // One read of this month's spending when the panel opens (never polled).
  async function refreshMonth(force) {
    if (!serviceUrl() || !consented() || (!force && Date.now() - S.monthAt < 60e3)) return;
    S.monthAt = Date.now();
    try { const r = await service("/v1/usage", { method: "GET" }); S.month = await r.json(); S.monthErr = ""; }
    catch (e) { S.monthErr = errorText(e && e.code) + (e && e.uid ? " Account id: " + e.uid : ""); }
    renderPanel();
  }
  async function setCap(usd) {
    S.capMsg = "Saving…"; renderPanel();
    try { const r = await service("/v1/cap", { method: "POST", body: JSON.stringify({ capUsd: usd }) }); S.month = await r.json(); S.capMsg = "Cap saved: $" + S.month.capUsd + " a month."; }
    catch (e) { S.capMsg = "Couldn't save the cap: " + errorText(e && e.code); }
    renderPanel();
  }

  async function ask(q) {
    q = String(q || "").trim();
    if (!q || S.busy) return;
    loadHistory();
    const useService = !!serviceUrl();
    if (useService && !consented()) { S.consentQ = q; S.draft = q; renderPanel(); return; }
    const sample = useService ? null : O.getSample ? await O.getSample() : null;
    if (!sample && !useService) { S.noClaude = true; S.error = errorText("no_endpoint"); rerender(); return; }
    const history = S.msgs.filter(m => m.q && m.answer && !m.local).slice(-4).map(m => ({ q: m.q, a: m.answer }));
    const m = { q, pending: true, at: Date.now() };
    S.msgs.push(m); S.busy = true; S.error = ""; S.draft = ""; S.stream = ""; S.ctl = typeof AbortController === "function" ? new AbortController() : null; rerender();
    try {
      const full = context(O.getDocs(), Object.assign(oo(), { question: q }));
      const ctx = useService ? trimContext(full, q) : full;
      let v;
      if (sample) v = await sample.json(prompt(q, ctx, history), { signal: S.ctl && S.ctl.signal, modelTier: "default" });
      else {
        const timer = setTimeout(() => { if (S.ctl) { S.ctl.timedOut = true; S.ctl.abort(); } }, 75000);
        try { const r = await askEndpoint(q, ctx, history, S.ctl && S.ctl.signal, t => { S.stream = partialAnswer(t); renderPanel(); }); v = r.text; m.costUsd = r.costUsd; }
        finally { clearTimeout(timer); }
      }
      const a = parseAnswer(v);
      if (a.error) { S.msgs.pop(); S.error = a.error; } else { Object.assign(m, a, { pending: false }); prepareActions(m); saveHistory(); }
    } catch (e) {
      S.msgs.pop();
      const code = e && e.code;
      if (S.ctl && S.ctl.timedOut) S.error = errorText("timeout");
      else if (code !== "cancelled" && !(e && e.name === "AbortError")) {
        S.error = errorText(code) + (e && e.uid ? " Account id: " + e.uid : "");
        if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed", "no_key", "no_endpoint"].includes(code)) { S.noClaude = true; S.noClaudeWhy = code === "no_key" ? "Claude isn't connected to this website yet (no API key configured). The quick questions still work." : ""; }
      }
    }
    S.busy = false; S.ctl = null; S.stream = ""; rerender();
  }

  function askLocal(topic) {
    loadHistory();
    const t = TOPICS.find(x => x.id === topic);
    if (!t) return;
    S.msgs.push(Object.assign({ q: t.label, at: Date.now() }, localAnswer(t.id, O.getDocs(), oo())));
    saveHistory();
    rerender();
  }

  function bind(root, opts) {
    O = Object.assign(O || {}, opts);
    root.addEventListener("click", e => {
      const t = e.target.closest("[data-coach-topic],[data-coach-period],[data-coach-apply],[data-coach-clear],[data-coach-stop],[data-coach-open],[data-coach-close],[data-coach-ask],[data-coach-dismiss],[data-coach-act],[data-coach-skip],[data-coach-consent],[data-coach-settings],[data-coach-refresh],[data-coach-capsave],[data-coach-mic],[data-coach-vlang],[data-coach-voiceraw]");
      if (!t) return;
      if (t.dataset.coachAct || t.dataset.coachSkip) {
        const [mi, ai] = String(t.dataset.coachAct || t.dataset.coachSkip).split(":").map(Number), msg = S.msgs[mi], a = msg && msg.actions && msg.actions[ai];
        if (!a || a.status !== "proposed") return;
        if (t.dataset.coachSkip) { a.status = "skipped"; saveHistory(); renderPanel(); return; }
        runAction(a).then(() => { saveHistory(); renderPanel(); if (O.render) O.render(); });
        return;
      }
      if (t.dataset.coachConsent) {
        const v = t.dataset.coachConsent, q = S.consentQ; S.consentQ = null;
        if (v === "yes") { if (O.setConsent) O.setConsent(true); S.monthAt = 0; refreshMonth(true); if (q) { S.draft = ""; ask(q); return; } }
        else if (v === "off") { if (O.setConsent) O.setConsent(false); S.month = null; }
        renderPanel(); return;
      }
      if (t.hasAttribute("data-coach-settings")) { S.settings = !S.settings; S.capMsg = ""; renderPanel(); if (S.settings) refreshMonth(true); return; }
      if (t.hasAttribute("data-coach-refresh")) { refreshMonth(true); return; }
      if (t.hasAttribute("data-coach-mic")) { if (S.voice) stopVoice("review"); else startVoice(); return; }
      if (t.hasAttribute("data-coach-vlang")) { S.voiceLang = voiceLang() === "ar" ? "en" : "ar"; if (S.voice) { const v = S.voice; v.then = "keep"; stopVoice("keep"); finishVoice(v); startVoice(); } else renderPanel(); return; }
      if (t.hasAttribute("data-coach-voiceraw")) { if (S.voiceRaw) S.draft = S.voiceRaw; S.voiceRaw = null; renderPanel(); return; }
      if (t.hasAttribute("data-coach-capsave")) { const sel = host && host.querySelector("[data-coach-capsel]"); if (sel) setCap(+sel.value); return; }
      if (t.dataset.coachDismiss) { if (O.onDismiss) O.onDismiss(t.dataset.coachDismiss); const box = t.closest("[data-coach-insight]"); if (box) box.remove(); return; }
      if (t.hasAttribute("data-coach-open")) openPanel(true);
      else if (t.hasAttribute("data-coach-close")) openPanel(false);
      else if (t.dataset.coachAsk !== undefined) {
        if (!host) { /* no panel mounted: answer inline on the card */ }
        else if (!S.open) openPanel(true);
        if (t.dataset.coachTopic) askLocal(t.dataset.coachTopic); else ask(t.dataset.coachAsk);
      }
      else if (t.dataset.coachTopic) askLocal(t.dataset.coachTopic);
      else if (t.dataset.coachPeriod !== undefined) { if (t.dataset.coachPeriod) { S.from = t.dataset.coachPeriod; O.render(); } }
      else if (t.dataset.coachApply) { try { const ch = JSON.parse(t.dataset.coachApply); if (O.onApply) O.onApply(ch); } catch (err) {} }
      else if (t.hasAttribute("data-coach-clear")) { S.msgs = []; S.error = ""; saveHistory(); rerender(); }
      else if (t.hasAttribute("data-coach-stop")) { if (S.ctl) S.ctl.abort(); }
    });
    root.addEventListener("change", e => {
      if (e.target.matches && e.target.matches("[data-coach-showcost]")) { if (O.setShowCost) O.setShowCost(!!e.target.checked); S.capMsg = ""; renderPanel(); }
    });
    root.addEventListener("input", e => { if (e.target.matches && e.target.matches("[data-coach-input]")) S.draft = e.target.value; });
    root.addEventListener("submit", e => {
      if (e.target.matches && e.target.matches("[data-coach-svcform]")) {
        e.preventDefault();
        const raw = String((e.target.querySelector("[data-coach-svc]") || {}).value || "").trim(), v = normalizeService(raw);
        if (v && !serviceOk(v)) { S.capMsg = "The address must start with https:// (for example https://mizan-coach.<name>.workers.dev)."; renderPanel(); return; }
        if (O.setService) O.setService(v || null); S.month = null; S.monthAt = 0; S.noClaude = false; S.error = "";
        S.capMsg = !v ? "Custom address removed; the app's built-in address is used." : v !== raw.replace(/\/+$/, "") ? "Saved as " + v + " (the base address; the /v1/… part isn't needed)." : "Address saved.";
        renderPanel(); refreshMonth(true); return;
      }
      if (!e.target.matches || !e.target.matches("[data-coach-form]")) return;
      e.preventDefault();
      if (S.voice) { stopVoice("send"); return; }          // Ask while listening: stop, tidy, then send
      if (S.tidying) { S.sendAfterTidy = true; return; }
      const inp = e.target.querySelector("[data-coach-input]");
      S.voiceRaw = null;
      ask(inp ? inp.value : S.draft);
    });
    root.addEventListener("keydown", e => { if (e.key === "Escape" && S.open) openPanel(false); });
  }

  return { css, targets, periods, review, reviewHtml, summary, context, prompt, parseAnswer, localAnswer, chatHtml, panelHtml, mountPanel, open: openPanel, suggestions, partialAnswer, liftHistory, exerciseIn, insights, insightsHtml, ACTIONS, cleanActions, trimContext, langOf, effortFor, normalizeService, bind, errorText, TOPICS, _state: S };
})();
if (typeof module !== "undefined") module.exports = Coach;
