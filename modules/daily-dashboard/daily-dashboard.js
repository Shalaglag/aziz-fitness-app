/* Daily dashboard ("Today at a glance") and workout calendar for the Aziz Cut Tracker.
 * Plain JS, no imports, no network. Reads the app's own collections:
 *   docs = { days: {date: {food:[{name,slot,kcal,p,eaten,est}], water, waterh:{ml}, sleep, treadmill}},
 *            weights: {date: {date, kg}},
 *            workouts: {date: {session, idx, sets:{name:[{w,r}]}, effort, deload, durationMin}} }
 * Nothing is tied to one person's numbers: targets come in through opts (AppTargets.resolve() from the profile).
 * No target means "no target set", never a made-up default.
 * Only logged data is shown. Missing data reads "Not logged", never a guess. Calories and protein
 * left count food ticked as eaten; planned items are shown separately.
 * API:
 *   DailyDashboard.css                                  -> string, inject once (uses the app's tokens)
 *   DailyDashboard.glance(docs, date, opts)              -> data for one day (see below)
 *   DailyDashboard.glanceHtml(docs, date, opts)          -> "Today at a glance" card
 *   DailyDashboard.month(docs, ym, opts)                 -> {ym, label, prev, next, weeks:[[cell|null x7]], totals}
 *   DailyDashboard.calendarHtml(docs, ym, opts)          -> calendar card
 *   DailyDashboard.projectSession(workouts, date, opts)  -> {session, idx, planned:true} | null
 * opts:
 *   today           ISO date (default: the device's local date)
 *   targets         AppTargets object {kcal, proteinMin, proteinMax}  (calories and protein)
 *   kcalTarget      number or fn(date) -> number, the day's calorie target (diet break / budget recovery); wins over targets.kcal
 *   waterGoal       fn(date, training) -> ml                         (no goal shown without it)
 *   readiness       fn(date) -> {score, verdict} (RecoveryFatigue.readiness), optional
 *   lbWorkouts      the full logger's lb_workouts docs, optional; read before workouts/{date}
 *                   ({start, name, templateName, exercises:[{sets:[{w,r,t,done}]}]}, warm-ups t:"w" skipped)
 *   rotation        session names in order, "Rest" for rest days     (default: none, no projection)
 *   freeWeekdays    weekdays (0 Sun..6 Sat) with no training planned (default [5], Friday)
 *   sessionFor      fn(date) -> {session, idx, chosen} for the selected day (the app's sessionFor)
 *   exerciseCount   fn(session) -> number of planned exercises
 *   selected        ISO date highlighted on the calendar (default: date / today)
 * Tile and calendar taps carry data-act for the host's click handler:
 *   gotrain, gofood, water (data-ml), dd-focus (data-target = element id), caldate (data-d), calmonth (data-ym)
 */
const DailyDashboard = (() => {
  const DAY = 864e5;
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const ms = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => iso(ms(s) + n * DAY);
  const diff = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const wday = s => new Date(ms(s)).getUTCDay();
  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const num = v => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const fint = n => Math.round(n).toLocaleString("en-US");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // "Push A" -> "Push A", "Lower B" -> "Lowr B", "Upper body day" -> "UBD": short enough for a phone calendar cell.
  const short = name => {
    const w = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!w.length) return "";
    if (w.length === 2 && w[1].length <= 2) return (w[0].length > 4 ? w[0][0] + w[0].slice(1).replace(/[aeiou]/gi, "").slice(0, 3) : w[0]) + " " + w[1];
    if (w.length === 1) return w[0].slice(0, 5);
    return w.map(x => x[0]).join("").slice(0, 3).toUpperCase();
  };

  // Full-logger workouts by local date, with only working sets.
  function lbByDate(list) {
    const out = {};
    (Array.isArray(list) ? list : Object.values(list || {})).forEach(w => {
      if (!w || !num(w.start) || !Array.isArray(w.exercises)) return;
      const t = new Date(w.start), date = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
      const sets = {};
      w.exercises.forEach((e, i) => { const ws = (e.sets || []).filter(x => x && x.t !== "w" && x.done !== false && (num(x.w) || num(x.r))); if (ws.length) sets[e.exId || e.name || "ex" + i] = ws; });
      const prev = out[date];
      out[date] = { date, session: w.templateName || w.name || (prev && prev.session) || null, sets: Object.assign({}, prev && prev.sets, sets),
        durationMin: (prev && prev.durationMin || 0) + (num(w.end) ? Math.round((w.end - w.start) / 6e4) : 0) || null };
    });
    return out;
  }

  function settings(opts = {}) {
    const kt = opts.kcalTarget, tg = opts.targets || {};
    return {
      today: isDate(opts.today) ? opts.today : localToday(),
      kcal: d => { const v = typeof kt === "function" ? num(kt(d)) : num(kt); return v != null ? v : num(tg.kcal); },
      pMin: num(tg.proteinMin),
      pMax: num(tg.proteinMax) ?? num(tg.proteinMin),
      water: (d, training) => typeof opts.waterGoal === "function" ? num(opts.waterGoal(d, training)) : null,
      readiness: typeof opts.readiness === "function" ? opts.readiness : null,
      lb: lbByDate(opts.lbWorkouts),
      rotation: Array.isArray(opts.rotation) ? opts.rotation : null,
      free: Array.isArray(opts.freeWeekdays) ? opts.freeWeekdays : [5],
      sessionFor: typeof opts.sessionFor === "function" ? opts.sessionFor : null,
      exCount: typeof opts.exerciseCount === "function" ? opts.exerciseCount : () => null,
    };
  }

  const setsOf = wk => Object.values((wk && wk.sets) || {}).reduce((n, a) => n + (a || []).filter(x => x && (num(x.w) || num(x.r))).length, 0);
  const exercisesOf = wk => Object.values((wk && wk.sets) || {}).filter(a => (a || []).some(x => x && (num(x.w) || num(x.r)))).length;
  const sumFood = items => items.reduce((a, i) => ({ kcal: a.kcal + (num(i.kcal) || 0), p: a.p + (num(i.p) || 0) }), { kcal: 0, p: 0 });
  const waterOf = day => (num(day.water) || 0) + ((day.waterh && num(day.waterh.ml)) || 0);

  // Next sessions after the last chosen one, one rotation step per day, skipping free weekdays.
  function projectSession(workouts, date, opts = {}) {
    const st = settings(opts);
    if (!st.rotation || !st.rotation.length) return null;
    const own = workouts && workouts[date];
    if (own && own.session) return { session: own.session, idx: own.idx, planned: false };
    const prev = Object.values(workouts || {}).filter(w => w && isDate(w.date) && w.date < date && w.session && Number.isInteger(w.idx))
      .sort((a, b) => a.date < b.date ? 1 : -1)[0];
    if (!prev) return null;
    if (st.free.includes(wday(date))) return null;
    let steps = 0;
    for (let d = add(prev.date, 1); d <= date; d = add(d, 1)) if (!st.free.includes(wday(d))) steps++;
    const idx = (prev.idx + steps) % st.rotation.length;
    return { session: st.rotation[idx], idx, planned: true };
  }

  // lb_workouts first (sets, duration), the shell's workouts/{date} for session, idx, effort, deload.
  function workoutOn(docs, date, st) {
    const shell = (docs.workouts && docs.workouts[date]) || {}, lb = st.lb[date];
    if (!lb) return shell;
    return Object.assign({}, shell, { session: shell.session || lb.session, sets: lb.sets, durationMin: lb.durationMin || shell.durationMin });
  }

  function glance(docs, date, opts = {}) {
    docs = docs || {};
    const st = settings(opts);
    const day = (docs.days && docs.days[date]) || {};
    const wk = workoutOn(docs, date, st);
    const free = st.free.includes(wday(date));

    // Workout
    let ses = st.sessionFor ? st.sessionFor(date) : null;
    if (!ses) { const p = projectSession(docs.workouts, date, opts); if (p) ses = { session: p.session, idx: p.idx, chosen: !p.planned }; }
    const session = wk.session || (ses && ses.session) || null;
    const sets = setsOf(wk);
    const rest = session === "Rest" || (free && !sets);
    const cardio = (docs.cardio && docs.cardio[date]) || null;
    const workout = {
      session, chosen: !!(wk.session || (ses && ses.chosen)), rest, free: free && !sets,
      sets, exercises: exercisesOf(wk), planned: session && session !== "Rest" ? st.exCount(session) : null,
      treadmill: !!(day.treadmill || wk.treadmill || cardio), durationMin: num(wk.durationMin),
      cardioMin: cardio ? num(cardio.durationMin ?? cardio.minutes ?? cardio.min) : null,
      status: sets ? "done" : rest ? "rest" : session ? "planned" : "unset",
    };

    // Meals and macros
    const food = (day.food || []).filter(Boolean);
    const eatenItems = food.filter(i => i.eaten), eaten = sumFood(eatenItems), plannedAll = sumFood(food);
    const target = st.kcal(date);
    const meals = {
      items: food.map(i => ({ name: i.name, slot: i.slot || "", kcal: num(i.kcal), eaten: !!i.eaten, est: !!i.est })),
      total: food.length, eaten: eatenItems.length, estimated: food.filter(i => i.est).length,
    };
    const kcal = { target, eaten: eaten.kcal, planned: plannedAll.kcal, left: target != null ? target - eaten.kcal : null, planLeft: target != null ? target - plannedAll.kcal : null };
    const pm = st.pMin;
    const protein = { min: pm, max: st.pMax, eaten: eaten.p, planned: plannedAll.p, left: pm != null ? Math.max(0, pm - eaten.p) : null, planLeft: pm != null ? Math.max(0, pm - plannedAll.p) : null };

    // Weigh-in
    const ws = Object.values(docs.weights || {}).filter(w => w && isDate(w.date) && num(w.kg) != null && w.date <= date).sort((a, b) => a.date < b.date ? -1 : 1);
    const todayW = ws.length && ws[ws.length - 1].date === date ? ws[ws.length - 1] : null;
    const prev = ws.filter(w => w.date < date).pop() || null;
    const win = ws.filter(w => diff(w.date, date) < 7);
    const weighin = {
      kg: todayW ? num(todayW.kg) : null,
      prev: prev ? { date: prev.date, kg: num(prev.kg) } : null,
      delta: todayW && prev ? num(todayW.kg) - num(prev.kg) : null,
      avg7: win.length ? win.reduce((s, w) => s + num(w.kg), 0) / win.length : null, avgN: win.length,
    };

    // Water
    const training = !free && session !== "Rest";
    const ml = waterOf(day), goal = st.water(date, training);
    const water = { ml, goal, pct: goal ? Math.min(1, ml / goal) : 0, hit: goal != null && ml >= goal };

    // Recovery: only what was logged
    const sleep = num(day.sleep);
    const lastRated = Object.values(docs.workouts || {}).filter(w => w && isDate(w.date) && w.date <= date && num(w.effort) != null)
      .sort((a, b) => a.date < b.date ? 1 : -1)[0];
    let streak = 0;
    for (let d = sets ? date : add(date, -1); ; d = add(d, -1)) { if (!setsOf(workoutOn(docs, d, st))) break; streak++; if (streak > 30) break; }
    const deload = !!wk.deload;
    const flags = [];
    if (sleep != null && sleep < 6) flags.push("Short sleep");
    if (lastRated && num(lastRated.effort) >= 9 && diff(lastRated.date, date) <= 2) flags.push("Last session near max");
    if (streak >= 4) flags.push(streak + " lifting days in a row");
    let ready = null;
    if (st.readiness) { try { const x = st.readiness(date); if (x && num(x.score) != null) ready = { score: num(x.score), verdict: x.verdict || null }; } catch (e) { } }
    if (ready && ready.verdict === "red") flags.unshift("Readiness low");
    const recovery = {
      ready, sleep, effort: lastRated ? { date: lastRated.date, n: num(lastRated.effort) } : null, streak, deload, flags,
      logged: sleep != null || !!lastRated || !!ready,
    };

    return { date, today: st.today, isToday: date === st.today, workout, meals, kcal, protein, weighin, water, recovery };
  }

  function tile(cls, label, value, sub, act, extra = "") {
    const attrs = act ? Object.entries(act).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("") : "";
    const tag = act ? "button" : "div";
    return `<${tag} class="dd-tile ${cls}"${act ? ' type="button"' : ""}${attrs}><span class="label">${label}</span><span class="dd-v num">${value}</span><span class="dd-sub">${sub}</span>${extra}</${tag}>`;
  }

  function glanceHtml(docs, date, opts = {}) {
    const g = glance(docs, date, opts), w = g.workout, k = g.kcal, p = g.protein, wi = g.weighin, wa = g.water, r = g.recovery;
    const tiles = [];

    // Workout
    let wv, ws, wc = "";
    if (w.status === "done") { wv = esc(w.session || "Workout"); ws = `${w.sets} sets · ${w.exercises} exercises${w.durationMin ? " · " + Math.round(w.durationMin) + " min" : ""}${w.treadmill ? " · cardio ✓" + (w.cardioMin ? " " + Math.round(w.cardioMin) + " min" : "") : ""}`; wc = "good"; }
    else if (w.status === "rest") { wv = w.free ? "Free day" : "Rest"; ws = w.treadmill ? "Cardio ✓" + (w.cardioMin ? " " + Math.round(w.cardioMin) + " min" : "") : "Recovery day"; }
    else if (w.status === "planned") { wv = esc(w.session); ws = (w.chosen ? "Set" : "Next in rotation") + (w.planned ? ` · ${w.planned} exercises` : "") + " · not logged yet"; }
    else { wv = "Pick"; ws = "Choose today's session"; wc = "warn"; }
    tiles.push(tile("dd-workout " + wc, "Workout", wv, ws, { act: "gotrain" }));

    // Meals
    const mv = g.meals.total ? `${g.meals.eaten}/${g.meals.total}` : "None";
    const ms_ = g.meals.total ? "eaten · " + (g.meals.total - g.meals.eaten ? (g.meals.total - g.meals.eaten) + " still planned" : "all ticked") + (g.meals.estimated ? ` · ${g.meals.estimated} estimated` : "") : "Nothing planned yet";
    tiles.push(tile("dd-meals", "Meals", mv, ms_, { act: "gofood" }));

    // Calories left
    const over = k.left != null && k.left < 0;
    if (k.target == null) tiles.push(tile("dd-kcal warn", "Calories", fint(k.eaten), "eaten · no calorie target set", { act: "gofood" }));
    else tiles.push(tile("dd-kcal " + (over ? "bad" : ""), over ? "Calories over" : "Calories left", fint(Math.abs(k.left)),
      `${fint(k.eaten)} eaten of ${fint(k.target)}` + (k.planned > k.eaten ? ` · plan leaves ${fint(k.planLeft)}` : ""), { act: "gofood" },
      `<span class="dd-bar" aria-hidden="true"><i class="pl" style="width:${Math.min(100, k.planned / (k.target || 1) * 100)}%"></i><i style="width:${Math.min(100, k.eaten / (k.target || 1) * 100)}%"></i></span>`));

    // Protein left
    const pHit = p.min != null && p.eaten >= p.min;
    if (p.min == null) tiles.push(tile("dd-protein warn", "Protein", Math.round(p.eaten) + " g", "eaten · no protein target set", { act: "gofood" }));
    else tiles.push(tile("dd-protein " + (pHit ? "good" : ""), pHit ? "Protein" : "Protein left", pHit ? "Hit" : Math.round(p.left) + " g",
      `${Math.round(p.eaten)} g eaten · aim ${p.min}${p.max > p.min ? "–" + p.max : "+"} g` + (!pHit && p.planned > p.eaten ? ` · plan leaves ${Math.round(p.planLeft)} g` : ""), { act: "gofood" },
      `<span class="dd-bar p" aria-hidden="true"><i class="pl" style="width:${Math.min(100, p.planned / (p.min || 1) * 100)}%"></i><i style="width:${Math.min(100, p.eaten / (p.min || 1) * 100)}%"></i></span>`));

    // Weigh-in
    if (wi.kg != null) tiles.push(tile("dd-weight good", "Weigh-in", wi.kg.toFixed(1) + " kg",
      (wi.delta != null ? (wi.delta > 0 ? "+" : "") + wi.delta.toFixed(1) + " vs last" : "First weigh-in") + (wi.avg7 != null ? ` · ${wi.avgN}-day avg ${wi.avg7.toFixed(1)}` : ""), { act: "dd-focus", target: "wkg" }));
    else tiles.push(tile("dd-weight warn", "Weigh-in", "Not logged", wi.prev ? `Last ${wi.prev.kg.toFixed(1)} kg, ${diff(wi.prev.date, g.date)} day${diff(wi.prev.date, g.date) === 1 ? "" : "s"} ago` : "Log a morning weight", { act: "dd-focus", target: "wkg" }));

    // Water
    tiles.push(tile("dd-water " + (wa.hit ? "good" : ""), "Water", (wa.ml / 1000).toFixed(2) + " L", wa.goal == null ? "today" : `of ${(wa.goal / 1000).toFixed(1)} L` + (wa.hit ? " · goal hit" : ` · ${((wa.goal - wa.ml) / 1000).toFixed(2)} L to go`), null,
      (wa.goal == null ? "" : `<span class="dd-bar w" aria-hidden="true"><i style="width:${Math.round(wa.pct * 100)}%"></i></span>`) + `<span class="dd-row"><button type="button" class="chip" data-act="water" data-ml="250">+250 ml</button><button type="button" class="chip" data-act="water" data-ml="500">+500 ml</button></span>`));

    // Recovery
    const rv = r.ready ? r.ready.score + "/100" : r.sleep != null ? r.sleep + " h" : "Not logged";
    const rs = [r.ready ? "readiness" : "", r.sleep != null ? (r.ready ? r.sleep + " h sleep" : "sleep last night") : "log hours slept", r.effort ? `last effort ${r.effort.n}/10` : "", r.deload ? "lighter week" : ""].filter(Boolean).join(" · ");
    tiles.push(tile("dd-recovery " + (r.flags.length ? "warn" : r.ready || r.sleep != null ? "good" : ""), "Recovery", rv,
      rs + (r.flags.length ? `<br><b>${r.flags.map(esc).join(" · ")}</b>` : ""), { act: "dd-focus", target: "sleepH" }));

    const head = g.isToday ? "Today at a glance" : new Date(ms(g.date)).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
    return `<section class="card dd"><div class="dd-head"><h3>${head}</h3><span class="muted dd-note">Counts food ticked as eaten</span></div><div class="dd-grid">${tiles.join("")}</div></section>`;
  }

  function month(docs, ym, opts = {}) {
    docs = docs || {};
    const st = settings(opts);
    if (!/^\d{4}-\d{2}$/.test(ym || "")) ym = st.today.slice(0, 7);
    const [y, m] = ym.split("-").map(Number);
    const first = ym + "-01", days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const prevYm = iso(Date.UTC(y, m - 2, 1)).slice(0, 7), nextYm = iso(Date.UTC(y, m, 1)).slice(0, 7);
    const selected = isDate(opts.selected) ? opts.selected : st.today;
    const cells = [];
    const totals = { workouts: 0, weighins: 0, kcalOn: 0, kcalLogged: 0, proteinHit: 0, waterHit: 0, treadmill: 0 };
    for (let i = 0; i < days; i++) {
      const date = add(first, i), day = (docs.days && docs.days[date]) || {}, wk = workoutOn(docs, date, st);
      const future = date > st.today, free = st.free.includes(wday(date));
      const sets = setsOf(wk);
      let session = wk.session || null, planned = false;
      if (!session && !sets && date >= st.today) { const p = projectSession(docs.workouts, date, opts); if (p) { session = p.session; planned = true; } }
      const eaten = (day.food || []).filter(x => x && x.eaten), f = sumFood(eaten);
      const target = st.kcal(date);
      let kcal = null;
      if (eaten.length && (free || target != null)) kcal = free ? "free" : f.kcal > target + 100 ? "over" : f.kcal < target - 150 ? "under" : "on";
      const training = !free && session !== "Rest";
      const cell = {
        date, d: i + 1, today: date === st.today, selected: date === selected, future, free,
        session, planned, lifted: sets > 0, rest: session === "Rest", missed: !future && date !== st.today && !sets && !!session && session !== "Rest" && !free,
        weighed: !!(docs.weights && docs.weights[date] && num(docs.weights[date].kg) != null),
        kcal, protein: eaten.length && st.pMin != null ? f.p >= st.pMin : null,
        water: st.water(date, training) == null || !waterOf(day) ? null : waterOf(day) >= st.water(date, training),
        treadmill: !!(day.treadmill || wk.treadmill || (docs.cardio && docs.cardio[date])),
      };
      if (cell.lifted) totals.workouts++;
      if (cell.weighed) totals.weighins++;
      if (kcal && kcal !== "free") { totals.kcalLogged++; if (kcal === "on") totals.kcalOn++; }
      if (cell.protein) totals.proteinHit++;
      if (cell.water) totals.waterHit++;
      if (cell.treadmill) totals.treadmill++;
      cells.push(cell);
    }
    const lead = wday(first), flat = Array(lead).fill(null).concat(cells);
    while (flat.length % 7) flat.push(null);
    const weeks = []; for (let i = 0; i < flat.length; i += 7) weeks.push(flat.slice(i, i + 7));
    return { ym, label: MONTHS[m - 1] + " " + y, prev: prevYm, next: nextYm, weeks, totals, days };
  }

  function calendarHtml(docs, ym, opts = {}) {
    const mo = month(docs, ym, opts), t = mo.totals;
    const KC = { on: "On target", over: "Over", under: "Under", free: "Free day" };
    const cell = c => {
      if (!c) return `<span class="dd-c empty" aria-hidden="true"></span>`;
      const tag = c.lifted ? short(c.session || "W") : c.rest ? "R" : c.session && c.planned && !c.free ? short(c.session) : "";
      const desc = [new Date(ms(c.date)).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }),
        c.lifted ? (c.session || "Workout") + " logged" : c.missed ? (c.session) + " not logged" : c.rest ? "Rest" : c.session && c.planned ? c.session + " planned" : c.free ? "Free day" : "",
        c.weighed ? "weighed in" : "", c.kcal ? "calories " + KC[c.kcal].toLowerCase() : "", c.protein ? "protein hit" : "", c.water ? "water goal hit" : ""].filter(Boolean).join(", ");
      const cls = ["dd-c", c.today && "today", c.selected && "sel", c.future && "future", c.lifted && "lifted", c.missed && "missed", c.planned && "planned", c.rest && "rest"].filter(Boolean).join(" ");
      const dots = (c.weighed ? `<i class="d-w"></i>` : "") + (c.kcal ? `<i class="d-k ${c.kcal}"></i>` : "") + (c.protein ? `<i class="d-p"></i>` : "") + (c.water ? `<i class="d-h"></i>` : "");
      return `<button type="button" class="${cls}" data-act="caldate" data-d="${c.date}" aria-label="${esc(desc)}"${c.selected ? ' aria-current="date"' : ""}><span class="n num">${c.d}</span><span class="s">${esc(tag)}</span><span class="dots">${dots}</span></button>`;
    };
    return `<section class="card dd-cal">
  <div class="dd-head"><h3>${esc(mo.label)}</h3><span class="dd-row"><button type="button" class="iconbtn" data-act="calmonth" data-ym="${mo.prev}" aria-label="Previous month">‹</button><button type="button" class="iconbtn" data-act="calmonth" data-ym="${mo.next}" aria-label="Next month">›</button></span></div>
  <div class="dd-cgrid" role="grid">${WD.map(w => `<span class="dd-wd">${w[0]}</span>`).join("")}${mo.weeks.map(wk => wk.map(cell).join("")).join("")}</div>
  <div class="dd-legend"><span><b class="sw lifted"></b>Lifted</span><span><b class="sw missed"></b>Not logged</span><span><b class="sw planned"></b>Planned</span><span><i class="d-w"></i>Weigh-in</span><span><i class="d-k on"></i>Kcal on target</span><span><i class="d-k over"></i>Over</span><span><i class="d-p"></i>Protein hit</span><span><i class="d-h"></i>Water hit</span></div>
  <p class="muted dd-note">${t.workouts} workout${t.workouts === 1 ? "" : "s"} · ${t.weighins} weigh-in${t.weighins === 1 ? "" : "s"} · calories on target ${t.kcalOn}/${t.kcalLogged} logged days · protein hit ${t.proteinHit} · water hit ${t.waterHit}. Tap a day to open it.</p>
</section>`;
  }

  const css = [
    ".dd-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}",
    ".dd-head h3{margin:0}",
    ".dd-note{font-size:.8rem}",
    ".dd-row{display:flex;gap:6px;flex-wrap:wrap}",
    ".dd-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}",
    "@media (min-width:640px){.dd-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}",
    ".dd-tile{display:flex;flex-direction:column;gap:4px;text-align:left;font:inherit;color:var(--ink);background:var(--sunk);border:1px solid var(--line);border-left:3px solid var(--line);border-radius:10px;padding:10px 12px;min-width:0}",
    "button.dd-tile{cursor:pointer}",
    "button.dd-tile:hover{border-color:var(--ink)}",
    ".dd-tile.good{border-left-color:var(--good)} .dd-tile.warn{border-left-color:var(--warn)} .dd-tile.bad{border-left-color:var(--bad)}",
    ".dd-tile.bad .dd-v{color:var(--bad)}",
    ".dd-v{font-size:1.35rem;font-weight:700;line-height:1.15;overflow-wrap:anywhere}",
    ".dd-sub{font-size:.8rem;color:var(--muted);line-height:1.3}",
    ".dd-sub b{color:var(--warn);font-weight:600}",
    ".dd-bar{position:relative;display:block;height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin-top:2px}",
    ".dd-bar i{position:absolute;left:0;top:0;bottom:0;background:var(--accent);border-radius:3px}",
    ".dd-bar i.pl{opacity:.35}",
    ".dd-bar.p i{background:var(--protein)} .dd-bar.w i{background:var(--accent)}",
    ".dd-tile .chip{padding:3px 9px;font-size:.8rem}",
    ".dd-cgrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}",
    ".dd-wd{text-align:center;font-size:.72rem;color:var(--muted);font-weight:600}",
    ".dd-c{display:flex;flex-direction:column;align-items:center;gap:1px;min-height:52px;padding:4px 2px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit;cursor:pointer;min-width:0}",
    ".dd-c.empty{border:0;background:none;cursor:default}",
    ".dd-c .n{font-size:.85rem}",
    ".dd-c .s{font-size:.62rem;font-weight:700;min-height:.9em;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".dd-c .dots{display:flex;gap:2px;min-height:6px}",
    ".dd-c.future{opacity:.75}",
    ".dd-c.lifted{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}",
    ".dd-c.missed .s{color:var(--warn)}",
    ".dd-c.planned .s{color:var(--muted);font-weight:600}",
    ".dd-c.rest .s{color:var(--muted)}",
    ".dd-c.today{box-shadow:inset 0 0 0 2px var(--ink)}",
    ".dd-c.sel{outline:2px solid var(--accent);outline-offset:1px}",
    ".dd-cal i,.dd-legend i{display:inline-block;width:6px;height:6px;border-radius:50%}",
    ".d-w{background:var(--ink)} .d-k.on{background:var(--good)} .d-k.over{background:var(--bad)} .d-k.under{background:var(--warn)} .d-k.free{background:var(--muted)} .d-p{background:var(--protein)} .d-h{background:var(--carbs)}",
    ".dd-c.lifted .d-w{background:var(--accent-ink)}",
    ".dd-legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:.75rem;color:var(--muted)}",
    ".dd-legend span{display:inline-flex;align-items:center;gap:4px}",
    ".dd-legend .sw{display:inline-block;width:10px;height:10px;border-radius:3px;border:1px solid var(--line)}",
    ".dd-legend .sw.lifted{background:var(--accent);border-color:var(--accent)} .dd-legend .sw.missed{border-color:var(--warn)} .dd-legend .sw.planned{border-style:dashed}",
  ].join("\n");

  return { css, glance, glanceHtml, month, calendarHtml, projectSession };
})();

if (typeof module !== "undefined") module.exports = DailyDashboard;
if (typeof window !== "undefined") window.DailyDashboard = DailyDashboard;
