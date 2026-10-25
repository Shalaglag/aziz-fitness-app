/* Cardio tracking for the Aziz Cut Tracker: treadmill sessions (and other machines) next to lifting.
 * Plain JS, no imports, no network. Reads and writes the app's own docs:
 *   cardio/{date}         = {date, sessions:[{id, kind, min, speed, incline, km, kmCalc, hrAvg, hrMax, kcal,
 *                             kcalSrc, effort, at, source, loggerId}]}   (new collection)
 *   days/{date}.treadmill = stays a boolean; set true when a treadmill session is saved, false when the
 *                           last one is deleted (DailyScore, the weekly report and the checklist read it)
 *   prefs/main.cardio     = {kind, min, speed, incline, hrCeiling, age} (the user's usual session; all optional)
 * Reads (never writes) workouts/{date} and lb_workouts (full logger, preferred when present) to find lift days.
 * `docs` below is the app's S.docs: {cardio, days, workouts, lb_workouts, prefs}.
 * Field rules (nothing is invented):
 *   km      typed distance; when left blank and speed + minutes are typed, speed × time (kmCalc: true, shown "≈")
 *   kcal    the machine's number when typed (kcalSrc "machine"); otherwise an ACSM estimate from speed,
 *           incline and the latest weigh-in (kcalSrc "est"), only for treadmill/walk with speed and weight
 *           known. Cardio calories are shown for context only and never added to the food budget.
 *   effort  1 easy (can talk easily) · 2 steady (can talk in short sentences) · 3 hard (can't talk)
 * API:
 *   Cardio.css                                         -> string, inject once (uses the app's tokens)
 *   Cardio.KINDS                                       -> [{id, label, machine}] treadmill, walk, bike, elliptical, rower, stairs
 *   Cardio.planFrom(prefs)                             -> the usual session from prefs/main.cardio
 *   Cardio.clean(input, {weightKg, now})               -> {ok, session, errors} validated session
 *   Cardio.sessions(doc)                               -> sessions of a cardio/{date} doc ([] when missing)
 *   Cardio.withSession(doc, session, date) / withoutSession(doc, id, date) -> new cardio/{date} docs
 *   Cardio.treadmillFlag(day, cardioDoc)               -> days/{date} copy with treadmill in step with the sessions
 *   Cardio.fromLogger(workout)                         -> sessions from a WorkoutLogger workout (onFinish's 1st arg)
 *   Cardio.mergeLogger(doc, sessions, date)            -> cardio doc with that workout's sessions updated
 *                                                         (speed/incline/HR typed on an earlier save are kept)
 *   Cardio.history(cardioMap)                          -> [{date, ...session}] oldest first
 *   Cardio.liftDates(docs)                             -> Set of dates with lifting (lb_workouts first, then workouts)
 *   Cardio.analyze(docs, {today})                      -> {week, prev, setting, suggestion, recent, ...}
 *   Cardio.cardHTML(date, docs, {weightKg, editId})    -> log card (Train / Today)
 *   Cardio.progressHTML(docs, {today})                 -> progress card (Progress tab)
 *   Cardio.summary(docs, {today})                      -> plain-text lines for reports / the coach
 *   Cardio.handle(el, ctx)                             -> true when it handled a click; ctx = {docs, put, weightKg,
 *                                                         toast, rerender}. Buttons carry data-cardio="save"|"del"|"edit"|"cancel".
 */
const Cardio = (() => {
  const DAY = 864e5;
  const KINDS = [
    { id: "treadmill", label: "Treadmill", machine: true },
    { id: "walk", label: "Outdoor walk", machine: false },
    { id: "bike", label: "Bike", machine: true },
    { id: "elliptical", label: "Elliptical", machine: true },
    { id: "rower", label: "Rower", machine: true },
    { id: "stairs", label: "Stair climber", machine: true },
  ];
  const KIND = Object.fromEntries(KINDS.map(k => [k.id, k]));
  const EFFORT = [null, "Easy", "Steady", "Hard"];
  const LIMITS = { min: [1, 300], speed: [0.5, 25], incline: [-3, 40], km: [0, 100], hrAvg: [40, 230], hrMax: [40, 230], kcal: [0, 3000] };
  const STEP_KM_H = 0.3, STEP_INCLINE = 1, MAX_INCLINE = 12;

  const ms = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => iso(ms(s) + n * DAY);
  const localISO = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const num = v => {
    if (typeof v === "string") { v = v.trim().replace(",", "."); if (v === "") return null; v = Number(v); }
    return typeof v === "number" && isFinite(v) ? v : null;
  };
  const r1 = n => Math.round(n * 10) / 10;
  const r2 = n => Math.round(n * 100) / 100;
  const f1 = n => r1(n).toFixed(1);
  const fmtNum = n => (Number.isInteger(r1(n)) ? String(r1(n)) : f1(n));
  const sum = a => a.reduce((s, x) => s + x, 0);
  const mean = a => a.length ? sum(a) / a.length : null;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fmtDate = s => { const d = new Date(ms(s)); return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); };

  function planFrom(prefs) {
    const c = (prefs && prefs.cardio) || {};
    return {
      kind: KIND[c.kind] ? c.kind : "treadmill",
      min: num(c.min) ?? 30,
      speed: num(c.speed),
      incline: num(c.incline),
      hrCeiling: num(c.hrCeiling),
      age: num(c.age),
    };
  }

  // Top of the easy (talk-test) zone: the user's own ceiling, else ~70% of 220 - age, else unknown.
  function hrCeiling(plan, prefs) {
    if (plan.hrCeiling) return plan.hrCeiling;
    const age = plan.age ?? num(prefs && prefs.profile && prefs.profile.age);
    return age ? Math.round(0.7 * (220 - age)) : null;
  }

  // ACSM metabolic equations (ml O2 / kg / min). Walking up to 6.5 km/h, running above.
  function vo2(speedKmh, inclinePct) {
    if (!(speedKmh > 0)) return null;
    const s = speedKmh * 1000 / 60, g = Math.max(0, inclinePct || 0) / 100;
    return speedKmh <= 6.5 ? 0.1 * s + 1.8 * s * g + 3.5 : 0.2 * s + 0.9 * s * g + 3.5;
  }
  const mets = (speed, incline) => { const v = vo2(speed, incline); return v == null ? null : v / 3.5; };
  function estKcal(s, weightKg) {
    if (!(weightKg > 0) || !(s.kind === "treadmill" || s.kind === "walk")) return null;
    const v = vo2(s.speed, s.kind === "walk" ? 0 : s.incline);
    return v == null ? null : Math.round(v * weightKg / 1000 * 5 * s.min);
  }

  function clean(input, opts = {}) {
    const errors = [];
    const kind = KIND[input.kind] ? input.kind : "treadmill";
    const out = { id: input.id || uid(), kind };
    for (const k of ["min", "speed", "incline", "km", "hrAvg", "hrMax", "kcal"]) {
      const v = num(input[k]);
      if (v == null) { out[k] = null; continue; }
      const [lo, hi] = LIMITS[k];
      if (v < lo || v > hi) { errors.push(k); out[k] = null; continue; }
      out[k] = k === "hrAvg" || k === "hrMax" || k === "kcal" ? Math.round(v) : r2(v);
    }
    if (out.min == null) errors.push("min");
    if (kind !== "treadmill") out.incline = kind === "walk" ? null : out.incline;
    if (out.hrAvg != null && out.hrMax != null && out.hrMax < out.hrAvg) errors.push("hrMax");
    out.kmCalc = false;
    if (out.km == null && out.speed != null && out.min != null) { out.km = r2(out.speed * out.min / 60); out.kmCalc = true; }
    if (out.speed == null && out.km != null && out.min) out.speed = r1(out.km / (out.min / 60));
    out.kcalSrc = out.kcal != null ? "machine" : null;
    if (out.kcal == null && out.min != null) {
      const e = estKcal(out, num(opts.weightKg));
      if (e != null) { out.kcal = e; out.kcalSrc = "est"; }
    }
    const eff = num(input.effort);
    out.effort = eff >= 1 && eff <= 3 ? Math.round(eff) : null;
    out.at = input.at || (opts.now || new Date()).toISOString();
    out.source = input.source || "manual";
    if (input.loggerId) out.loggerId = input.loggerId;
    return { ok: !errors.length, session: out, errors: [...new Set(errors)] };
  }

  function sessions(doc) {
    return Array.isArray(doc && doc.sessions) ? doc.sessions.filter(s => s && num(s.min) > 0) : [];
  }
  function withSession(doc, s, date) {
    const list = sessions(doc).filter(x => x.id !== s.id);
    return { date: (doc && doc.date) || date, sessions: [...list, s] };
  }
  function withoutSession(doc, id, date) {
    return { date: (doc && doc.date) || date, sessions: sessions(doc).filter(x => x.id !== id) };
  }
  // A treadmill session sets the day's checkbox; deleting the last one clears it. Ticking the checkbox by
  // hand (no numbers) still works and is left alone while the day has no sessions at all.
  const hasTm = doc => sessions(doc).some(s => s.kind === "treadmill");
  function treadmillFlag(day, doc, before) {
    const out = Object.assign({}, day);
    if (hasTm(doc)) out.treadmill = true;
    else if (hasTm(before)) out.treadmill = false;
    else out.treadmill = !!out.treadmill;
    return out;
  }

  // WorkoutLogger exercise ids for its Cardio category.
  const LOGGER_KIND = [[/treadmill/, "treadmill"], [/bike|cycle/, "bike"], [/elliptical/, "elliptical"], [/row(ing)?-machine|rower/, "rower"], [/stair/, "stairs"], [/walk/, "walk"]];
  function fromLogger(w) {
    if (!w || !Array.isArray(w.exercises)) return [];
    const date = w.start ? localISO(new Date(w.start)) : null;
    const out = [];
    w.exercises.forEach((e, i) => {
      const id = String(e.exId || "");
      const hit = LOGGER_KIND.find(([re]) => re.test(id));
      if (!hit) return;
      const sets = (e.sets || []).filter(s => s.t !== "w" && s.done !== false);
      const min = sum(sets.map(s => num(s.min) || 0)), km = sum(sets.map(s => num(s.km) || 0));
      if (!(min > 0)) return;
      const { session } = clean({ kind: hit[1], min, km: km > 0 ? km : null, source: "logger", loggerId: (w.id || "w") + ":" + i, at: w.end ? new Date(w.end).toISOString() : undefined });
      session.date = date;
      out.push(session);
    });
    return out;
  }
  // Logger finish (or a re-save of the same workout): minutes and distance come from the logger, anything
  // typed in the app afterwards (speed, incline, heart rate, effort) is kept.
  function mergeLogger(doc, list, date) {
    let out = { date: (doc && doc.date) || date || (list[0] && list[0].date), sessions: sessions(doc) };
    list.forEach(s => {
      const old = out.sessions.find(x => x.loggerId && x.loggerId === s.loggerId);
      const c = Object.assign({}, s); delete c.date;
      if (old) {
        const keep = {};
        ["speed", "incline", "hrAvg", "hrMax", "effort"].forEach(k => { if (old[k] != null) keep[k] = old[k]; });
        if (old.kcalSrc === "machine") { keep.kcal = old.kcal; keep.kcalSrc = "machine"; }
        Object.assign(c, keep, { id: old.id });
        if (c.km == null && c.speed != null) { c.km = r2(c.speed * c.min / 60); c.kmCalc = true; }
      }
      out = withSession(out, c);
    });
    return out;
  }

  function history(cardio) {
    const arr = Array.isArray(cardio) ? cardio : Object.values(cardio || {});
    const out = [];
    arr.forEach(d => { if (d && isDate(d.date)) sessions(d).forEach(s => out.push(Object.assign({ date: d.date }, s))); });
    return out.sort((a, b) => (a.date + (a.at || "")).localeCompare(b.date + (b.at || "")));
  }

  // Lift days: the full logger's finished workouts (lb_workouts) first, then Quick log's workouts/{date}.
  const isCardioEx = id => LOGGER_KIND.some(([re]) => re.test(String(id || "")));
  function liftDates(docs) {
    const out = new Set();
    Object.values((docs && docs.lb_workouts) || {}).forEach(w => {
      if (!w || !w.start || !w.end) return;
      const lifted = (w.exercises || []).some(e => !isCardioEx(e.exId) && (e.sets || []).some(s => s.t !== "w" && s.done !== false && (num(s.w) || num(s.r))));
      if (lifted) out.add(localISO(new Date(w.start)));
    });
    Object.values((docs && docs.workouts) || {}).forEach(w => {
      if (w && isDate(w.date) && w.session !== "Rest" &&
        Object.values(w.sets || {}).some(a => (a || []).some(x => x && (num(x.w) || num(x.r))))) out.add(w.date);
    });
    return out;
  }

  const settingKey = s => s.kind + "|" + (s.speed ?? "") + "|" + (s.incline ?? "");
  const settingLabel = s => KIND[s.kind].label + (s.speed != null ? " · " + fmtNum(s.speed) + " km/h" : "") + (s.incline != null ? " · incline " + fmtNum(s.incline) : "");

  function windowStats(list, from, to, lifts, daysMap) {
    const inW = list.filter(s => s.date >= from && s.date <= to);
    const liftIn = [...lifts].filter(d => d >= from && d <= to);
    const cardioDates = new Set(inW.map(s => s.date));
    // Old days only have the checkbox: they count as done, with no numbers.
    Object.values(daysMap || {}).forEach(d => { if (d && d.treadmill && isDate(d.date) && d.date >= from && d.date <= to) cardioDates.add(d.date); });
    return {
      from, to,
      sessions: inW.length,
      min: Math.round(sum(inW.map(s => s.min))),
      km: r1(sum(inW.map(s => s.km || 0))),
      climbM: Math.round(sum(inW.filter(s => s.kind === "treadmill" && s.km && s.incline > 0).map(s => s.km * 10 * s.incline))),
      liftDays: liftIn.length,
      liftDaysWithCardio: liftIn.filter(d => cardioDates.has(d)).length,
      checkboxOnly: [...cardioDates].filter(d => !inW.some(s => s.date === d)).length,
    };
  }

  const prefsOf = docs => (docs && docs.prefs && docs.prefs.main) || {};

  function analyze(docs, opts = {}) {
    docs = docs || {};
    const today = opts.today || localISO(new Date());
    const prefs = prefsOf(docs);
    const plan = planFrom(prefs);
    const daysMap = docs.days || {};
    const list = history(docs.cardio).filter(s => s.date <= today);
    const lifts = liftDates(docs);
    const week = windowStats(list, add(today, -6), today, lifts, daysMap);
    const prev = windowStats(list, add(today, -13), add(today, -7), lifts, daysMap);
    const ceiling = hrCeiling(plan, prefs);

    // The setting used most recently, and how heart rate at that setting has moved.
    const last = list[list.length - 1] || null;
    let setting = null;
    if (last) {
      const same = list.filter(s => settingKey(s) === settingKey(last) && s.date >= add(today, -55));
      const hr = same.filter(s => s.hrAvg);
      setting = {
        label: settingLabel(last), kind: last.kind, speed: last.speed, incline: last.incline,
        count: same.length,
        hrFirst: hr.length >= 2 ? hr[0].hrAvg : null, hrLast: hr.length >= 2 ? hr[hr.length - 1].hrAvg : null,
        hrFrom: hr.length >= 2 ? hr[0].date : null, hrTo: hr.length >= 2 ? hr[hr.length - 1].date : null,
        mets: last.kind === "treadmill" ? mets(last.speed, last.incline) : null,
      };
    }
    return { today, plan, ceiling, week, prev, setting, last, suggestion: suggest(list, plan, ceiling, today), recent: list.slice(-12), total: list.length };
  }

  // A step up is offered only when the last 3 sessions at the same treadmill setting were full length and
  // clearly easy (all heart rates 5+ bpm under the ceiling, or all rated Easy). It is never applied by itself.
  function suggest(list, plan, ceiling, today) {
    const tm = list.filter(s => s.kind === "treadmill" && s.date >= add(today, -20));
    if (!tm.length) return { action: "none", text: "Log a few treadmill sessions to get progression tips." };
    const last = tm[tm.length - 1];
    if (last.speed == null) return { action: "none", text: "Add speed and incline to your sessions to get progression tips." };
    const same = tm.filter(s => settingKey(s) === settingKey(last)).slice(-3);
    const target = plan.min || 30;
    if (same.length < 3) return { action: "hold", text: `Keep ${settingLabel(last).replace("Treadmill · ", "")} for now (${same.length} of 3 sessions at this setting).` };
    if (same.some(s => s.min < target)) return { action: "hold", text: `Stay at this setting until you finish the full ${target} minutes 3 times in a row.` };
    const hrAll = same.every(s => s.hrAvg);
    let easy = false, why = "";
    if (hrAll && ceiling) {
      const top = Math.max(...same.map(s => s.hrAvg));
      if (top <= ceiling - 5) { easy = true; why = `heart rate stayed at ${top} bpm or lower, under your easy-zone top of ${ceiling}`; }
      else if (top > ceiling) return { action: "hold", text: `Heart rate reached ${top} bpm, above your easy-zone top of ${ceiling}. Keep this setting until it settles lower.` };
      else return { action: "hold", text: `Heart rate is near the top of your easy zone (${top} of ${ceiling} bpm). Keep this setting.` };
    } else if (ceiling && same.some(s => s.hrAvg > ceiling)) {
      return { action: "hold", text: `Heart rate went above your easy-zone top of ${ceiling} bpm recently. Keep this setting.` };
    } else if (same.every(s => s.effort === 1)) { easy = true; why = "you rated the last 3 sessions Easy"; }
    else if (same.some(s => s.effort === 3)) return { action: "hold", text: "You rated a recent session Hard. Keep this setting. During a cut, cardio should stay easy enough to talk." };
    else if (!hrAll && !same.some(s => s.effort)) return { action: "hold", text: "Rate how each session felt (or add heart rate) and the app will tell you when to step up." };
    if (!easy) return { action: "hold", text: "Keep this setting until it feels Easy three times in a row." };
    const next = (last.incline ?? 0) < MAX_INCLINE
      ? { speed: last.speed, incline: r1((last.incline ?? 0) + STEP_INCLINE), change: `incline ${fmtNum(last.incline ?? 0)} → ${fmtNum((last.incline ?? 0) + STEP_INCLINE)}` }
      : { speed: r1(last.speed + STEP_KM_H), incline: last.incline, change: `speed ${fmtNum(last.speed)} → ${fmtNum(last.speed + STEP_KM_H)} km/h` };
    return { action: "up", next, text: `Ready for a small step: ${next.change}. Why: ${why}. Keep ${target} minutes.` };
  }

  const css = `
.cdo-card .cdo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px}
.cdo-card label.cdo-f{display:flex;flex-direction:column;gap:3px;font-size:.8rem;color:var(--muted)}
.cdo-card label.cdo-f input,.cdo-card label.cdo-f select{font:inherit;font-size:1rem;color:var(--ink);background:var(--sunk);border:1px solid var(--line);border-radius:8px;padding:8px;min-width:0;width:100%;box-sizing:border-box}
.cdo-card .cdo-bad input{border-color:var(--bad)}
.cdo-card .cdo-eff{display:flex;gap:6px;flex-wrap:wrap}
.cdo-card .cdo-eff label{border:1px solid var(--line);border-radius:999px;padding:6px 12px;cursor:pointer;font-size:.9rem}
.cdo-card .cdo-eff input{position:absolute;opacity:0;pointer-events:none}
.cdo-card .cdo-eff label:has(input:checked){background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.cdo-card .cdo-sess{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 10px;background:var(--sunk);border-radius:8px}
.cdo-card .cdo-sess b{font-family:var(--mono);font-weight:600}
.cdo-card .cdo-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.cdo-card .cdo-stat{background:var(--sunk);border-radius:8px;padding:8px;text-align:center}
.cdo-card .cdo-stat b{display:block;font-family:var(--mono);font-size:1.15rem}
.cdo-card .cdo-stat span{font-size:.75rem;color:var(--muted)}
.cdo-card .cdo-tip{border-left:3px solid var(--accent);padding:6px 10px;background:var(--sunk);border-radius:0 8px 8px 0}
.cdo-card .cdo-tip.up{border-color:var(--good)}
.cdo-card table{width:100%;border-collapse:collapse;font-size:.85rem}
.cdo-card td,.cdo-card th{padding:5px 4px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
.cdo-card td:first-child,.cdo-card th:first-child{text-align:left}
.cdo-card th{color:var(--muted);font-weight:500}
.cdo-card .cdo-scroll{overflow-x:auto}
.cdo-card svg{width:100%;height:auto;display:block}
.cdo-card .cdo-err{color:var(--bad);font-size:.85rem}
@media (max-width:420px){.cdo-card .cdo-stats{grid-template-columns:repeat(2,1fr)}}`;

  function sessionLine(s) {
    const bits = [`<b>${fmtNum(s.min)} min</b>`];
    if (s.speed != null) bits.push(`${fmtNum(s.speed)} km/h`);
    if (s.incline != null) bits.push(`incline ${fmtNum(s.incline)}`);
    if (s.km != null) bits.push(`${s.kmCalc ? "≈" : ""}${f1(s.km)} km`);
    if (s.hrAvg) bits.push(`HR ${s.hrAvg}${s.hrMax ? "/" + s.hrMax : ""}`);
    if (s.kcal != null) bits.push(`${s.kcalSrc === "est" ? "≈" : ""}${s.kcal} kcal${s.kcalSrc === "est" ? " est." : ""}`);
    if (s.effort) bits.push(EFFORT[s.effort]);
    return `${esc(KIND[s.kind] ? KIND[s.kind].label : s.kind)} · ${bits.join(" · ")}`;
  }

  function field(id, label, value, attrs) {
    return `<label class="cdo-f" data-cdo-f="${id}">${label}<input id="cdo-${id}" inputmode="decimal" ${attrs} value="${value == null ? "" : esc(value)}"></label>`;
  }

  // Log card. The form is prefilled from the last session of the same kind (else the usual session), and
  // nothing is saved until Save is tapped.
  function cardHTML(date, docs, opts = {}) {
    docs = docs || {};
    const plan = planFrom(prefsOf(docs));
    const list = sessions((docs.cardio || {})[date]);
    const day = (docs.days || {})[date] || {};
    const all = history(docs.cardio).filter(s => s.date < date);
    const edit = opts.editId ? list.find(s => s.id === opts.editId) : null;
    const lastSame = [...all].reverse().find(s => s.kind === plan.kind);
    const src = edit || lastSame || plan;
    const kind = edit ? edit.kind : plan.kind;
    const legacy = day.treadmill && !list.length;
    const liftDay = liftDates(docs).has(date);
    const target = plan.min || 30;
    const head = list.length
      ? `<div class="row" style="justify-content:space-between"><h3 style="margin:0">Cardio</h3><span class="muted">${Math.round(sum(list.map(s => s.min)))} of ${target} min</span></div>`
      : `<h3 style="margin:0">Cardio${liftDay ? " after lifting" : ""}</h3>`;
    const rows = list.map(s => `<div class="cdo-sess"><span>${sessionLine(s)}</span><span class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn small ghost" data-cardio="edit" data-id="${esc(s.id)}">Edit</button><button class="btn small ghost" data-cardio="del" data-id="${esc(s.id)}" aria-label="Delete session">✕</button></span></div>`).join("");
    const eff = v => `<div class="cdo-eff" role="radiogroup" aria-label="How did it feel?">${[1, 2, 3].map(n => `<label><input type="radio" name="cdo-effort" value="${n}" ${v === n ? "checked" : ""}>${EFFORT[n]}</label>`).join("")}</div>`;
    const form = `
      <div class="cdo-form" data-date="${esc(date)}" data-edit="${edit ? esc(edit.id) : ""}">
        <div class="cdo-grid">
          <label class="cdo-f">Type<select id="cdo-kind">${KINDS.map(k => `<option value="${k.id}" ${k.id === kind ? "selected" : ""}>${k.label}</option>`).join("")}</select></label>
          ${field("min", "Minutes", edit ? edit.min : target, 'type="number" min="1" max="300" step="1"')}
          ${field("speed", "Speed km/h", src.speed, 'type="number" min="0.5" max="25" step="0.1"')}
          ${field("incline", "Incline %", src.incline, 'type="number" min="-3" max="40" step="0.5"')}
          ${field("km", "Distance km", edit && !edit.kmCalc ? edit.km : null, 'type="number" min="0" max="100" step="0.01" placeholder="auto"')}
          ${field("hrAvg", "Avg HR", edit ? edit.hrAvg : null, 'type="number" min="40" max="230" step="1" placeholder="bpm"')}
          ${field("hrMax", "Max HR", edit ? edit.hrMax : null, 'type="number" min="40" max="230" step="1" placeholder="bpm"')}
          ${field("kcal", "Machine kcal", edit && edit.kcalSrc === "machine" ? edit.kcal : null, 'type="number" min="0" max="3000" step="1" placeholder="optional"')}
        </div>
        <div class="muted" style="font-size:.85rem">How did it feel?</div>
        ${eff(edit ? edit.effort : null)}
        <p class="cdo-err" hidden></p>
        <div class="row"><button class="btn" data-cardio="save">${edit ? "Save changes" : "Save session"}</button>${edit ? '<button class="btn ghost" data-cardio="cancel">Cancel</button>' : ""}</div>
        <p class="muted" style="font-size:.8rem;margin:0">Filled in from ${edit ? "this session" : lastSame ? "your last session" : "your usual session"}. Distance is worked out from speed × time if you leave it blank.</p>
      </div>`;
    const body = list.length && !edit
      ? `${rows}<details><summary class="muted">Add another session</summary>${form}</details>`
      : `${rows}${legacy ? '<p class="muted" style="margin:0">Marked done. Add the numbers below if you have them.</p>' : ""}${form}`;
    return `<div class="card cdo-card" id="cdoCard">${head}${body}</div>`;
  }

  function chartSVG(recent, ceiling) {
    const pts = recent.filter(s => s.kind === "treadmill" && s.speed != null);
    if (pts.length < 2) return "";
    const W = 320, H = 120, P = 22, bw = (W - 2 * P) / pts.length;
    const m = pts.map(s => mets(s.speed, s.incline));
    const mMax = Math.max(...m) * 1.15;
    const hrs = pts.map(s => s.hrAvg).filter(Boolean);
    const hLo = hrs.length ? Math.min(...hrs, ceiling || Infinity) - 10 : 0, hHi = hrs.length ? Math.max(...hrs, ceiling || 0) + 5 : 1;
    const hy = h => H - P - (h - hLo) / (hHi - hLo) * (H - 2 * P);
    const bars = pts.map((s, i) => { const h = m[i] / mMax * (H - 2 * P); return `<rect x="${(P + i * bw + bw * 0.15).toFixed(1)}" y="${(H - P - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="var(--accent)" opacity="0.75"><title>${esc(fmtDate(s.date))}: ${fmtNum(s.speed)} km/h, incline ${fmtNum(s.incline ?? 0)} (${f1(m[i])} METs)</title></rect>`; }).join("");
    const line = hrs.length >= 2 ? `<polyline fill="none" stroke="var(--ink)" stroke-width="2" points="${pts.map((s, i) => s.hrAvg ? `${(P + i * bw + bw / 2).toFixed(1)},${hy(s.hrAvg).toFixed(1)}` : "").filter(Boolean).join(" ")}"/>` +
      pts.map((s, i) => s.hrAvg ? `<circle cx="${(P + i * bw + bw / 2).toFixed(1)}" cy="${hy(s.hrAvg).toFixed(1)}" r="3" fill="var(--ink)"><title>${esc(fmtDate(s.date))}: ${s.hrAvg} bpm</title></circle>` : "").join("") : "";
    const ceil = hrs.length >= 2 && ceiling ? `<line x1="${P}" x2="${W - P}" y1="${hy(ceiling).toFixed(1)}" y2="${hy(ceiling).toFixed(1)}" stroke="var(--warn)" stroke-dasharray="4 3"/><text x="${W - P}" y="${(hy(ceiling) - 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">easy top ${ceiling}</text>` : "";
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Treadmill intensity per session${hrs.length >= 2 ? " with average heart rate" : ""}">${bars}${ceil}${line}<text x="${P}" y="${H - 6}" font-size="9" fill="var(--muted)">${esc(fmtDate(pts[0].date))}</text><text x="${W - P}" y="${H - 6}" text-anchor="end" font-size="9" fill="var(--muted)">${esc(fmtDate(pts[pts.length - 1].date))}</text></svg>
      <p class="muted" style="font-size:.8rem;margin:0">Bars: intensity (speed + incline, in METs). ${hrs.length >= 2 ? "Line: average heart rate. Same bar with a lower line means you are getting fitter." : "Add heart rate to see fitness change at the same setting."}</p>`;
  }

  function progressHTML(docs, opts = {}) {
    const a = analyze(docs, opts);
    if (!a.total && !a.week.checkboxOnly && !a.prev.checkboxOnly) {
      return `<div class="card cdo-card"><h3 style="margin:0">Cardio progress</h3><p class="muted" style="margin:0">No cardio logged yet. Log your treadmill on the Train tab after lifting and your weekly minutes, distance and progression show up here.</p></div>`;
    }
    const w = a.week, p = a.prev;
    const delta = (x, y, unit) => y ? `<span>${x >= y ? "+" : ""}${fmtNum(x - y)}${unit} vs prior week</span>` : `<span>last 7 days</span>`;
    const stats = `<div class="cdo-stats">
      <div class="cdo-stat"><b>${w.sessions + w.checkboxOnly}</b><span>sessions</span></div>
      <div class="cdo-stat"><b>${w.min}</b>${delta(w.min, p.min, " min")}</div>
      <div class="cdo-stat"><b>${f1(w.km)}</b><span>km</span></div>
      <div class="cdo-stat"><b>${w.climbM}</b><span>m climbed</span></div></div>`;
    const comp = w.liftDays ? `<p style="margin:0">Cardio after lifting: <b>${w.liftDaysWithCardio} of ${w.liftDays}</b> lift days this week${p.liftDays ? ` (${p.liftDaysWithCardio} of ${p.liftDays} the week before)` : ""}.</p>` : "";
    const legacy = w.checkboxOnly ? `<p class="muted" style="margin:0;font-size:.85rem">${w.checkboxOnly} day${w.checkboxOnly > 1 ? "s were" : " was"} ticked done without numbers, so ${w.checkboxOnly > 1 ? "they count" : "it counts"} as sessions but not in minutes or distance.</p>` : "";
    const s = a.setting;
    const hr = s && s.hrFirst != null ? `<p style="margin:0">At ${esc(s.label)}: average heart rate <b>${s.hrFirst} → ${s.hrLast} bpm</b> (${esc(fmtDate(s.hrFrom))} to ${esc(fmtDate(s.hrTo))}). ${s.hrLast < s.hrFirst ? "Same work, lower heart rate: your fitness is improving." : s.hrLast > s.hrFirst + 3 ? "Higher at the same work. Poor sleep, heat, low food or fatigue can do this." : "About the same."}</p>` : "";
    const tip = `<div class="cdo-tip ${a.suggestion.action === "up" ? "up" : ""}">${esc(a.suggestion.text)}${a.suggestion.action === "up" ? '<br><span class="muted" style="font-size:.8rem">A suggestion only. Your settings change when you log the new numbers.</span>' : ""}</div>`;
    const rows = a.recent.slice(-8).reverse().map(x => `<tr><td>${esc(fmtDate(x.date))}</td><td>${fmtNum(x.min)}</td><td>${x.speed != null ? fmtNum(x.speed) : "–"}</td><td>${x.incline != null ? fmtNum(x.incline) : "–"}</td><td>${x.km != null ? (x.kmCalc ? "≈" : "") + f1(x.km) : "–"}</td><td>${x.hrAvg || "–"}</td></tr>`).join("");
    const table = rows ? `<div class="cdo-scroll"><table><thead><tr><th>Date</th><th>Min</th><th>km/h</th><th>Incl.</th><th>km</th><th>HR</th></tr></thead><tbody>${rows}</tbody></table></div>` : "";
    return `<div class="card cdo-card"><h3 style="margin:0">Cardio progress</h3>${stats}${comp}${legacy}${chartSVG(a.recent, a.ceiling)}${hr}${tip}${table}</div>`;
  }

  function summary(docs, opts = {}) {
    const a = analyze(docs, opts), w = a.week;
    const lines = [`Cardio, last 7 days: ${w.sessions + w.checkboxOnly} sessions, ${w.min} min, ${f1(w.km)} km${w.climbM ? ", " + w.climbM + " m climbed" : ""}.`];
    if (w.liftDays) lines.push(`Cardio after lifting on ${w.liftDaysWithCardio} of ${w.liftDays} lift days.`);
    if (a.setting && a.setting.hrFirst != null) lines.push(`Avg HR at ${a.setting.label}: ${a.setting.hrFirst} → ${a.setting.hrLast} bpm.`);
    lines.push(a.suggestion.text);
    return lines.join("\n");
  }

  function readForm(root) {
    const v = id => { const el = root.querySelector("#cdo-" + id); return el ? el.value : null; };
    const eff = root.querySelector('input[name="cdo-effort"]:checked');
    return { kind: v("kind"), min: v("min"), speed: v("speed"), incline: v("incline"), km: v("km"), hrAvg: v("hrAvg"), hrMax: v("hrMax"), kcal: v("kcal"), effort: eff ? eff.value : null };
  }
  const LABEL = { min: "minutes", speed: "speed", incline: "incline", km: "distance", hrAvg: "average heart rate", hrMax: "max heart rate", kcal: "calories" };

  // Click handler for the log card. ctx.rerender(opts) is called for Edit/Cancel so the host can redraw
  // the card with cardHTML(day, {...opts}).
  function handle(el, ctx) {
    const b = el && el.closest && el.closest("[data-cardio]");
    if (!b) return false;
    const act = b.dataset.cardio, card = b.closest(".cdo-card");
    const form = card && card.querySelector(".cdo-form");
    const date = (form && form.dataset.date) || ctx.date;
    const docs = ctx.docs || {};
    const before = (docs.cardio || {})[date];
    const save = doc => {
      ctx.put("cardio", date, doc);
      const day = Object.assign({ date }, (docs.days || {})[date]);
      const next = treadmillFlag(day, doc, before);
      if (!!next.treadmill !== !!day.treadmill) ctx.put("days", date, next);
    };
    if (act === "del") {
      save(withoutSession(before, b.dataset.id, date));
      ctx.toast && ctx.toast("Cardio session removed");
    } else if (act === "edit") {
      ctx.rerender && ctx.rerender({ editId: b.dataset.id });
    } else if (act === "cancel") {
      ctx.rerender && ctx.rerender({});
    } else if (act === "save" && form) {
      const editId = form.dataset.edit;
      const prevS = editId ? sessions(before).find(s => s.id === editId) : null;
      const input = Object.assign(readForm(form), editId ? { id: editId, at: prevS && prevS.at, source: prevS && prevS.source, loggerId: prevS && prevS.loggerId } : {});
      const res = clean(input, { weightKg: ctx.weightKg });
      form.querySelectorAll(".cdo-bad").forEach(x => x.classList.remove("cdo-bad"));
      const err = form.querySelector(".cdo-err");
      if (!res.ok) {
        res.errors.forEach(k => { const f = form.querySelector(`[data-cdo-f="${k}"]`); if (f) f.classList.add("cdo-bad"); });
        if (err) { err.hidden = false; err.textContent = "Check " + res.errors.map(k => LABEL[k]).join(", ") + "."; }
        return true;
      }
      save(withSession(before, res.session, date));
      ctx.toast && ctx.toast(editId ? "Cardio session updated" : `Cardio saved: ${fmtNum(res.session.min)} min${res.session.km != null ? ", " + f1(res.session.km) + " km" : ""}`);
    }
    return true;
  }

  return { css, KINDS, planFrom, hrCeiling, mets, estKcal, clean, sessions, withSession, withoutSession, treadmillFlag, fromLogger, mergeLogger, history, liftDates, analyze, cardHTML, progressHTML, summary, handle };
})();

if (typeof module !== "undefined") module.exports = { Cardio };
