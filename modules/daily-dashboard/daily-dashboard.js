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
 *   DailyDashboard.glanceHtml(docs, date, opts)          -> "Today at a glance" scoreboard card
 *   DailyDashboard.day(docs, date, opts) / dayHtml(...)  -> "Your day" timeline (data / card)
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
 *   slots           meal slot order for the calorie strip and timeline (default Breakfast, Meal 1, Snack, Meal 2, Extra)
 *   trainTime       fn(date) -> "HH:MM" or null, when the workout sits on the Your day timeline
 * Tile and calendar taps carry data-act for the host's click handler:
 *   gotrain, gofood, water (data-ml), dd-focus (data-target = element id: wkg, waterCard, sleepH), caldate (data-d), calmonth (data-ym)
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
      slots: slotsOf(food, opts.slots),
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

  const SLOT_ORDER = ["Breakfast", "Meal 1", "Snack", "Meal 2", "Extra"];
  const SLOT_SHORT = { Breakfast: "Brk", "Meal 1": "Meal 1", Snack: "Snack", "Meal 2": "Meal 2", Extra: "Extra", Fixed: "Fixed" };
  // Rough clock hour of each meal slot, only used to put the workout between meals on the timeline. Never shown.
  const SLOT_HOUR = { Breakfast: 8, "Meal 1": 13, Snack: 16.5, "Meal 2": 20, Extra: 21.5 };
  const hourOf = hhmm => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ""); return m ? +m[1] + +m[2] / 60 : null; };
  const ampm = hhmm => { const h = hourOf(hhmm); if (h == null) return null; const H = Math.floor(h), M = Math.round((h - H) * 60); return (H % 12 || 12) + (M ? ":" + String(M).padStart(2, "0") : "") + (H < 12 ? " am" : " pm"); };
  const litres = ml => (ml / 1000).toFixed(2).replace(/0$/, "") + " L";

  // Food grouped by slot in meal order: [{slot, items, kcal, p, eatenKcal, eatenP, eaten, total}]
  function slotsOf(food, order) {
    const by = {};
    food.forEach(i => { const s = i.slot || "Extra"; (by[s] = by[s] || []).push(i); });
    const keys = (order || SLOT_ORDER).filter(s => by[s]).concat(Object.keys(by).filter(s => !(order || SLOT_ORDER).includes(s)));
    return keys.map(slot => {
      const items = by[slot], all = sumFood(items), e = sumFood(items.filter(i => i.eaten));
      return { slot, items, kcal: all.kcal, p: all.p, eatenKcal: e.kcal, eatenP: e.p, eaten: items.filter(i => i.eaten).length, total: items.length };
    });
  }

  function workoutLine(w) {
    const cardio = w.treadmill ? "cardio ✓" + (w.cardioMin ? " " + Math.round(w.cardioMin) + " min" : "") : "";
    if (w.status === "done") return { title: w.session || "Workout", sub: [w.sets + " sets", w.exercises + " exercises", w.durationMin ? Math.round(w.durationMin) + " min" : "", cardio].filter(Boolean).join(" · "), btn: "Done" };
    if (w.status === "rest") return { title: w.free ? "Free day" : "Rest day", sub: cardio || "Recovery day", btn: "" };
    if (w.status === "planned") return { title: w.session, sub: [w.planned ? w.planned + " exercises" : "", w.chosen ? "" : "next in rotation", "not logged yet"].filter(Boolean).join(" · "), btn: "Start" };
    return { title: "Pick", sub: "Choose today's session", btn: "Pick" };
  }

  function glanceHtml(docs, date, opts = {}) {
    const g = glance(docs, date, opts), w = g.workout, k = g.kcal, p = g.protein, wi = g.weighin, wa = g.water, r = g.recovery;
    const head = g.isToday ? "Today" : new Date(ms(g.date)).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

    // Calorie strip: one segment per meal slot, eaten solid, planned hatched.
    let strip;
    if (k.target == null) strip = `<div class="dd-cap"><span>Calories</span><span>no calorie target set</span></div>`;
    else {
      const scale = Math.max(k.target, k.planned, 1);
      const segs = [], labels = [];
      g.meals.slots.forEach(s => {
        const e = s.eatenKcal / scale * 100, pl = (s.kcal - s.eatenKcal) / scale * 100;
        if (e > 0) segs.push(`<i style="width:${e.toFixed(1)}%"></i>`);
        if (pl > 0) segs.push(`<i class="pl" style="width:${pl.toFixed(1)}%"></i>`);
        labels.push(`<span style="width:${(e + pl).toFixed(1)}%">${e + pl >= 12 ? esc(SLOT_SHORT[s.slot] || s.slot) : ""}</span>`);
      });
      const right = !g.meals.total ? "Nothing planned yet" : k.planned > k.eaten ? (k.planLeft >= 0 ? "plan leaves " + fint(k.planLeft) : "plan is " + fint(-k.planLeft) + " over") : g.meals.eaten + " of " + g.meals.total + " eaten";
      strip = `<div class="dd-cap"><span>Calories · ${fint(k.target)}</span><span>${right}</span></div>
<button type="button" class="dd-kbar" data-act="gofood" aria-label="${fint(k.eaten)} of ${fint(k.target)} calories eaten${k.planned > k.eaten ? ", " + fint(k.planned - k.eaten) + " more planned" : ""}">${segs.join("")}</button>
<div class="dd-klab" aria-hidden="true">${labels.join("")}</div>`;
    }

    const cell = (cls, cap, big, sub, act, extra = "") => {
      const attrs = act ? Object.entries(act).map(([a, v]) => ` data-${a}="${esc(v)}"`).join("") : "";
      // A cell holding its own button (Water's +) can't be a <button>: it stays a div that still carries data-act.
      const tag = act && !/<button/.test(extra) ? "button" : "div";
      return `<${tag} class="dd-cell ${cls}"${tag === "button" ? ' type="button"' : ""}${attrs}><span class="dd-crow"><span class="dd-cap1">${cap}</span>${extra}</span><span class="dd-v">${big}</span><span class="dd-sub">${sub}</span></${tag}>`;
    };
    const cells = [];
    const over = k.left != null && k.left < 0;
    if (k.target == null) cells.push(cell("dd-kcal", "Kcal eaten", fint(k.eaten), "no calorie target set", { act: "gofood" }));
    else cells.push(cell("dd-kcal" + (over ? " bad" : ""), over ? "Kcal over" : "Kcal left", fint(Math.abs(k.left)), fint(k.eaten) + " eaten" + (g.meals.estimated ? ` · ${g.meals.estimated} estimated` : ""), { act: "gofood" }));
    const pHit = p.min != null && p.eaten >= p.min;
    if (p.min == null) cells.push(cell("dd-protein", "Protein", Math.round(p.eaten) + "<small> g</small>", "no protein target set", { act: "gofood" }));
    else cells.push(cell("dd-protein" + (pHit ? " good" : ""), pHit ? "Protein" : "Protein to go", pHit ? "Hit" : Math.round(p.left) + "<small> g</small>", `${Math.round(p.eaten)} of ${p.min}${p.max > p.min ? "–" + p.max : ""} g`, { act: "gofood" }));
    cells.push(cell("dd-water" + (wa.hit ? " good" : ""), "Water", (wa.ml / 1000).toFixed(2) + "<small> L</small>", wa.goal == null ? "today" : `of ${(wa.goal / 1000).toFixed(1)} L` + (wa.hit ? " · goal hit" : ""), { act: "dd-focus", target: "waterCard" },
      `<button type="button" class="dd-plus" data-act="water" data-ml="250" aria-label="Add 250 ml of water">+</button>`));
    if (wi.kg != null) cells.push(cell("dd-weight", "Weight", wi.kg.toFixed(1) + "<small> kg</small>",
      (wi.delta != null ? `<b class="${wi.delta <= 0 ? "dn" : "up"}">${wi.delta > 0 ? "↑ " : wi.delta < 0 ? "↓ " : ""}${Math.abs(wi.delta).toFixed(1)}</b>` : "First weigh-in") + (wi.avg7 != null && wi.avgN > 1 ? ` · ${wi.avgN}-day avg ${wi.avg7.toFixed(1)}` : ""), { act: "dd-focus", target: "wkg" }));
    else cells.push(cell("dd-weight muted", "Weight", "—", wi.prev ? `Not logged · last ${wi.prev.kg.toFixed(1)}, ${diff(wi.prev.date, g.date)}d ago` : "Not logged", { act: "dd-focus", target: "wkg" }));

    // Workout row, with sleep / readiness underneath.
    const wl = workoutLine(w);
    const rec = [r.sleep != null ? "slept " + r.sleep + " h" : "", r.ready ? "ready " + r.ready.score + "/100" : "", r.effort ? `last effort ${r.effort.n}/10` : "", r.deload ? "lighter week" : ""].filter(Boolean).join(" · ");
    const wbtn = wl.btn ? `<span class="dd-go${w.status === "done" ? " done" : ""}">${wl.btn}</span>` : "";
    const workout = `<button type="button" class="dd-wk${w.status === "unset" ? " warn" : ""}" data-act="gotrain"><span class="dd-wt"><span class="dd-wn">${esc(wl.title)}</span><span class="dd-sub">${esc(wl.sub)}${rec ? "<br>" + esc(rec) : ""}</span></span>${wbtn}</button>`;
    const flags = r.flags.length ? `<p class="dd-flags">${r.flags.map(esc).join(" · ")}</p>` : "";
    const sleepLink = r.sleep == null && g.isToday ? `<button type="button" class="dd-mini" data-act="dd-focus" data-target="sleepH">Log sleep</button>` : "";

    return `<section class="card dd"><div class="dd-head"><h3>${head}</h3><button type="button" class="dd-mini" data-act="dd-day">Your day ›</button></div>${strip}<div class="dd-sb">${cells.join("")}</div>${workout}${flags}${sleepLink}</section>`;
  }

  // "Your day": the day in order (weigh-in, meals, workout) with a Now marker on today.
  function day(docs, date, opts = {}) {
    docs = docs || {};
    const g = glance(docs, date, opts), w = g.workout, wi = g.weighin, past = date < g.today, future = date > g.today;
    const steps = [];
    // Weigh-in + sleep
    steps.push({ key: "weigh", hour: 6, label: "Morning", state: wi.kg != null ? "done" : past ? "miss" : "todo",
      title: wi.kg != null ? `Weighed in · ${wi.kg.toFixed(1)} kg` : "Weigh-in",
      meta: [wi.kg != null ? (wi.delta != null ? (wi.delta > 0 ? "↑ " : wi.delta < 0 ? "↓ " : "± ") + Math.abs(wi.delta).toFixed(1) + " vs last" : "first weigh-in") : past ? "Not logged" : "Not logged yet",
        g.recovery.sleep != null ? "slept " + g.recovery.sleep + " h" : ""].filter(Boolean).join(" · "),
      act: { act: "gotab", tab: "today" } });
    // Meals
    g.meals.slots.forEach(s => {
      const state = s.eaten === s.total ? "done" : s.eaten ? "part" : past ? "miss" : "todo";
      const names = s.items.map(i => i.name).filter(Boolean);
      steps.push({ key: "slot:" + s.slot, hour: SLOT_HOUR[s.slot] ?? 22, label: s.slot, state,
        title: names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : ""),
        meta: [state === "done" ? "" : state === "part" ? `${s.eaten} of ${s.total} eaten` : past ? "Not ticked" : "Planned", fint(s.kcal) + " kcal", Math.round(s.p) + " g protein"].filter(Boolean).join(" · "),
        act: { act: "gofood" } });
    });
    // Workout
    const t = typeof opts.trainTime === "function" ? opts.trainTime(date) : null;
    const wl = workoutLine(w);
    steps.push({ key: "train", hour: hourOf(t) ?? 17.5, label: w.status === "rest" ? "Rest" : ampm(t) || "Workout",
      state: w.status === "done" || w.status === "rest" ? "done" : past ? "miss" : "todo",
      title: w.status === "unset" ? "Pick today's session" : wl.title,
      meta: w.status === "unset" ? "Opens Train" : w.status === "planned" ? [w.planned ? w.planned + " exercises" : "", "then 30 min treadmill"].filter(Boolean).join(" · ").replace(/^then/, "Then") : wl.sub,
      act: { act: "gotrain" } });
    steps.sort((a, b) => a.hour - b.hour);
    const done = steps.filter(s => s.state === "done").length;
    let now = null;
    if (g.isToday) { const i = steps.findIndex(s => s.state !== "done"); now = { at: i < 0 ? steps.length : i }; }
    return { date, isToday: g.isToday, past, future, steps, done, total: steps.length, now, kcal: g.kcal, protein: g.protein, water: g.water };
  }

  function dayHtml(docs, date, opts = {}) {
    const d = day(docs, date, opts), k = d.kcal, p = d.protein, wa = d.water;
    const head = d.isToday ? "Your day" : new Date(ms(date)).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
    const step = s => `<li class="dd-st ${s.state}"><button type="button"${Object.entries(s.act).map(([a, v]) => ` data-${a}="${esc(v)}"`).join("")}><span class="dd-t">${esc(s.label)}</span><span class="dd-rail" aria-hidden="true"><i></i></span><span class="dd-tx"><span class="dd-tt">${esc(s.title)}${s.state === "done" ? '<span class="dd-sr"> (done)</span>' : ""}</span><span class="dd-sub">${esc(s.meta)}</span></span></button></li>`;
    const nums = [k.left != null ? `<span><b class="dd-n">${fint(Math.abs(k.left))}</b> kcal ${k.left < 0 ? "over" : "left"}</span>` : `<span><b class="dd-n">${fint(k.eaten)}</b> kcal eaten</span>`,
      p.left != null ? (p.left > 0 ? `<span><b class="dd-n dd-np">${Math.round(p.left)} g</b> protein to go</span>` : `<span><b class="dd-n dd-np">${Math.round(p.eaten)} g</b> protein, hit</span>`) : `<span><b class="dd-n dd-np">${Math.round(p.eaten)} g</b> protein</span>`].join("");
    let drops = "";
    if (wa.goal) {
      const unit = wa.goal / 250 <= 16 ? 250 : 500, n = Math.ceil(wa.goal / unit), on = Math.min(n, Math.floor(wa.ml / unit));
      drops = `<div class="dd-drops" role="img" aria-label="Water ${litres(wa.ml)} of ${litres(wa.goal)}">${Array.from({ length: n }, (_, i) => `<i class="${i < on ? "on" : ""}"></i>`).join("")}</div>`;
    }
    const water = `<div class="dd-wrow">${drops}<span class="dd-sub">${litres(wa.ml)}${wa.goal ? " of " + litres(wa.goal) : ""}</span><button type="button" class="dd-plus" data-act="water" data-ml="250" aria-label="Add 250 ml of water">+</button></div>`;
    const nowBlock = `<li class="dd-st now"><div class="dd-nowrow"><span class="dd-t">Now</span><span class="dd-rail" aria-hidden="true"><i></i></span><div class="dd-nowbox"><div class="dd-nums">${nums}</div>${water}</div></div></li>`;
    const items = d.steps.map(step);
    if (d.now) items.splice(d.now.at, 0, nowBlock);
    else if (d.past) items.push(`<li class="dd-st total"><div class="dd-nowrow"><span class="dd-t">Total</span><span class="dd-rail" aria-hidden="true"><i></i></span><div class="dd-nowbox"><div class="dd-nums">${nums}</div>${water}</div></div></li>`);
    return `<section class="card dd dd-day"><div class="dd-head"><h3>${head}</h3><span class="dd-sub">${d.future ? "Planned" : d.done + " of " + d.total + " done"}</span></div><ol class="dd-tl">${items.join("")}</ol></section>`;
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
    ".dd.card{gap:8px}",
    ".dd-mini{border:0;background:none;padding:6px 2px;min-height:36px;font:inherit;font-size:.85rem;font-weight:600;color:var(--accent);cursor:pointer}",
    ".dd-cap,.dd-cap1{font-family:var(--mono);font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}",
    ".dd-cap{display:flex;justify-content:space-between;gap:8px}",
    ".dd-kbar{display:flex;gap:2px;width:100%;height:14px;padding:0;border:0;border-radius:5px;overflow:hidden;background:var(--sunk);cursor:pointer}",
    ".dd-kbar i{display:block;height:100%;background:var(--accent);flex:none}",
    ".dd-kbar i.pl{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--accent) 32%,var(--surface)) 0 4px,color-mix(in srgb,var(--accent) 12%,var(--surface)) 4px 8px)}",
    ".dd-klab{display:flex;gap:2px;margin-top:-4px;font-family:var(--mono);font-size:.66rem;color:var(--muted);text-transform:uppercase}",
    ".dd-klab span{flex:none;overflow:hidden;white-space:nowrap}",
    ".dd-sb{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}",
    ".dd-cell{display:flex;flex-direction:column;gap:2px;min-width:0;padding:12px 4px 12px 0;border:0;background:none;font:inherit;color:var(--ink);text-align:left}",
    "button.dd-cell,div.dd-cell[data-act]{cursor:pointer}",
    ".dd-sb>.dd-cell:nth-child(odd){border-right:1px solid var(--line);padding-right:12px}",
    ".dd-sb>.dd-cell:nth-child(even){padding-left:14px}",
    ".dd-sb>.dd-cell:nth-child(-n+2){border-bottom:1px solid var(--line)}",
    ".dd-crow{display:flex;align-items:center;justify-content:space-between;gap:6px;min-height:20px}",
    ".dd-v{font-family:var(--display);font-weight:800;font-size:2.6rem;line-height:.95;letter-spacing:-.01em;font-variant-numeric:tabular-nums;white-space:nowrap}",
    ".dd-v small{font-size:1.15rem;font-weight:700;letter-spacing:0}",
    ".dd-protein .dd-v{color:var(--protein)}",
    ".dd-cell.bad .dd-v{color:var(--bad)}",
    ".dd-cell.muted .dd-v{color:var(--muted)}",
    ".dd-sub{font-size:.8rem;color:var(--muted);line-height:1.3}",
    ".dd-sub b.dn{color:var(--good);font-weight:600} .dd-sub b.up{color:var(--muted);font-weight:600}",
    ".dd-plus{flex:none;width:36px;height:36px;margin:-10px 0 -6px;border-radius:50%;border:0;background:color-mix(in srgb,var(--water,#2F8FE8) 16%,var(--surface));color:var(--water-ink,#0B4F9C);font:700 1.3rem/1 var(--body);cursor:pointer}",
    ".dd-wk{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:56px;padding:10px 0 4px;border:0;border-top:1px solid var(--line);background:none;font:inherit;color:var(--ink);text-align:left;cursor:pointer}",
    ".dd-wt{display:flex;flex-direction:column;min-width:0}",
    ".dd-wn{font-family:var(--display);font-weight:700;font-size:1.3rem;letter-spacing:.03em;text-transform:uppercase;line-height:1.1}",
    ".dd-wk.warn .dd-wn{color:var(--warn)}",
    ".dd-go{flex:none;height:38px;padding:0 16px;border-radius:19px;background:var(--accent);color:var(--accent-ink);font-weight:700;font-size:.9rem;display:grid;place-items:center}",
    ".dd-go.done{background:var(--sunk);color:var(--good)}",
    ".dd-flags{margin:0;font-size:.8rem;font-weight:600;color:var(--warn)}",
    ".dd-tl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}",
    ".dd-st>button,.dd-nowrow{display:grid;grid-template-columns:74px 18px minmax(0,1fr);gap:8px;align-items:stretch;width:100%;border:0;background:none;padding:0;font:inherit;color:var(--ink);text-align:left}",
    ".dd-st>button{cursor:pointer;min-height:48px}",
    ".dd-t{font-family:var(--mono);font-size:.68rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding-top:3px;overflow-wrap:anywhere}",
    ".dd-rail{position:relative;display:flex;justify-content:center}",
    ".dd-rail::before{content:'';position:absolute;top:0;bottom:0;width:2px;background:var(--line)}",
    ".dd-st:first-child .dd-rail::before{top:6px} .dd-st:last-child .dd-rail::before{bottom:auto;height:10px}",
    ".dd-rail i{position:relative;margin-top:4px;width:12px;height:12px;border-radius:50%;box-sizing:border-box;background:var(--surface);border:2px solid var(--fg-faint,#8C847C)}",
    ".dd-st.done .dd-rail i{background:var(--good);border-color:var(--good)}",
    ".dd-st.part .dd-rail i{background:linear-gradient(90deg,var(--good) 50%,var(--surface) 50%);border-color:var(--good)}",
    ".dd-st.miss .dd-rail i{border-color:var(--warn)}",
    ".dd-st.now .dd-rail i,.dd-st.total .dd-rail i{border:3px solid var(--accent)}",
    ".dd-st.now .dd-t{color:var(--accent);font-weight:600}",
    ".dd-tx{display:flex;flex-direction:column;padding-bottom:12px;min-width:0}",
    ".dd-tt{font-weight:600;font-size:.95rem;line-height:1.25}",
    ".dd-st.done .dd-tt{color:var(--muted)}",
    ".dd-nowbox{background:var(--sunk);border-radius:12px;padding:10px 12px;margin-bottom:12px;display:flex;flex-direction:column;gap:8px;min-width:0}",
    ".dd-nums{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:.8rem;color:var(--muted)}",
    ".dd-n{font-family:var(--display);font-weight:700;font-size:1.6rem;line-height:1;color:var(--ink)} .dd-n.dd-np{color:var(--protein)}",
    ".dd-wrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
    ".dd-drops{display:flex;gap:3px;flex-wrap:wrap;flex-basis:100%}",
    ".dd-drops i{width:12px;height:12px;border-radius:3px;background:color-mix(in srgb,var(--water,#2F8FE8) 18%,var(--surface))} .dd-drops i.on{background:var(--water,#2F8FE8)}",
    ".dd-wrow .dd-plus{margin:0 0 0 auto;background:var(--surface)}",
    ".dd-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}",
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

  return { css, glance, glanceHtml, day, dayHtml, month, calendarHtml, projectSession };
})();

if (typeof module !== "undefined") module.exports = DailyDashboard;
if (typeof window !== "undefined") window.DailyDashboard = DailyDashboard;
