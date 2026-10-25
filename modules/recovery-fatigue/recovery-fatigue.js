/* Recovery + fatigue tracker for the Aziz Cut Tracker.
 * Plain JS, no imports, no network. Global `RecoveryFatigue`.
 *
 * Reads the app's own docs (S.docs):
 *   days/{date}.sleep        hours slept the night before (the app's existing Today input)
 *   days/{date}.recovery     {quality, soreness, energy, joints:{<area>:1|2|3}, note}  <- new, written by this module
 *                              quality/energy 1-5 (5 = best), soreness 1-5 (5 = not sore), joints 1 mild, 2 moderate, 3 sharp
 *   lb_workouts/{id}         full logger sessions {start (ms), exercises:[{exId, unit:"kg"|"lb", sets:[{t, w, r, done}]}]}, read first
 *   workouts/{date}          {session, sets:{"<exercise>":[{w,r}]}, effort 1-10, deload}; sets used for dates the logger has no session
 *   prefs/main.deloadFrom/deloadUntil  (EffortDeload's lighter week)
 *
 * API:
 *   RecoveryFatigue.css                                 -> string, inject once (app tokens)
 *   RecoveryFatigue.JOINTS                              -> [{id, label}]
 *   RecoveryFatigue.readiness(docs, {date, sleepMin, sleepTarget})
 *       -> {date, status:"ok"|"no-checkin", score 0-100|null, verdict:"green"|"amber"|"red"|null,
 *           advice, parts:[{id,label,got,of,text}], joints:[{id,label,level}]}
 *   RecoveryFatigue.fatigue(docs, {today, sleepMin, deloadFrom, deloadUntil})
 *       -> {level:"low"|"watch"|"high", warnings:[{id, level:"watch"|"act", title, text, evidence:[string]}],
 *           lifts:[{name, last, best, change, down}], onDeload, notes:[string]}
 *   RecoveryFatigue.series(docs, {today, days})         -> [{date, sleep, quality, soreness, energy, joints, score}]
 *   RecoveryFatigue.checkinHtml(docs, {date, ...})      -> Today card: check-in buttons + readiness verdict
 *   RecoveryFatigue.warningsHtml(fatigueResult)         -> Train/Today card, "" when level is "low"
 *   RecoveryFatigue.html(docs, {today, ...})            -> Progress card: 14-day trend, averages, warnings
 *   RecoveryFatigue.handle(target, docs, date)          -> {collection:"days", id, doc} to put(), or null
 *       Buttons carry data-rf="quality|soreness|energy|joint|clear" plus data-rf-v and data-rf-date.
 *   RecoveryFatigue.summary(docs, {today})              -> plain text for the AI coach / copy
 *
 * Nothing here changes calorie or training targets. Missing data is reported as missing, never guessed.
 */
const RecoveryFatigue = (() => {
  const DAY = 864e5;
  const JOINTS = [
    ["shoulder", "Shoulder"], ["elbow", "Elbow"], ["wrist", "Wrist"], ["neck", "Neck"],
    ["lowerBack", "Lower back"], ["hip", "Hip"], ["knee", "Knee"], ["ankle", "Ankle"],
  ].map(([id, label]) => ({ id, label }));
  const JOINT_LEVELS = ["", "Mild", "Moderate", "Sharp"];
  const SCALES = {
    quality: { label: "Sleep quality", ends: ["Awful", "Great"] },
    soreness: { label: "Soreness", ends: ["Very sore", "Not sore"] },
    energy: { label: "Energy", ends: ["Drained", "Fresh"] },
  };
  const DEF = { sleepMin: 7, sleepTarget: 8 };

  const ms = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => iso(ms(s) + n * DAY);
  const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const num = v => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const ramp = (x, lo, hi) => clamp((x - lo) / (hi - lo), 0, 1);
  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const pct = n => (n >= 0 ? "+" : "−") + f1(Math.abs(n) * 100) + "%";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const e1rm = (w, r) => w * (1 + Math.min(r, 30) / 30);
  const short = d => { const t = new Date(ms(d)); return t.getUTCDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][t.getUTCMonth()]; };
  const jointLabel = id => (JOINTS.find(j => j.id === id) || { label: id }).label;

  const opt = o => ({
    sleepMin: num(o && o.sleepMin) || DEF.sleepMin,
    sleepTarget: num(o && o.sleepTarget) || DEF.sleepTarget,
  });

  function scale(v) { const n = num(v); return n == null ? null : clamp(Math.round(n), 1, 5); }
  function sleepOf(day) { const n = num(day && day.sleep); return n != null && n >= 0 && n <= 16 ? n : null; }
  function rec(day) {
    const r = (day && day.recovery) || {};
    const joints = {};
    Object.entries(r.joints || {}).forEach(([k, v]) => { const n = num(v); if (n >= 1) joints[k] = clamp(Math.round(n), 1, 3); });
    return { quality: scale(r.quality), soreness: scale(r.soreness), energy: scale(r.energy), joints };
  }
  const hasCheckin = r => r.quality != null || r.soreness != null || r.energy != null || Object.keys(r.joints).length > 0;

  // ---------- readiness (one day) ----------
  function readiness(docs, o = {}) {
    const { sleepMin, sleepTarget } = opt(o);
    const date = isDate(o.date) ? o.date : localToday();
    const days = (docs && docs.days) || {};
    const day = days[date] || {};
    const r = rec(day);
    const sleep = sleepOf(day);
    const prev = [1, 2].map(i => sleepOf(days[add(date, -i)])).filter(x => x != null);
    const joints = Object.entries(r.joints).map(([id, level]) => ({ id, label: jointLabel(id), level }));
    const parts = [];
    const part = (id, label, of, got, text) => parts.push({ id, label, of, got: Math.round(got * of * 10) / 10, text });

    if (sleep != null) part("sleep", "Sleep last night", 25, ramp(sleep, 5, sleepTarget), sleep + " h");
    if (sleep != null && prev.length) {
      const avg = mean([sleep, ...prev]);
      part("sleep3", "Sleep, last 3 nights", 10, ramp(avg, 5, sleepTarget), f1(avg) + " h average");
    }
    if (r.quality != null) part("quality", "Sleep quality", 15, (r.quality - 1) / 4, r.quality + "/5");
    if (r.soreness != null) part("soreness", "Soreness", 15, (r.soreness - 1) / 4, r.soreness + "/5" + (r.soreness <= 2 ? " (sore)" : ""));
    if (r.energy != null) part("energy", "Energy", 15, (r.energy - 1) / 4, r.energy + "/5");
    if (hasCheckin(r)) {
      const worst = Math.max(0, ...joints.map(j => j.level));
      part("joints", "Joints", 10, [1, 0.6, 0.3, 0][worst], worst ? joints.map(j => j.label + " " + JOINT_LEVELS[j.level].toLowerCase()).join(", ") : "No discomfort");
    }

    if (!parts.length) return { date, status: "no-checkin", score: null, verdict: null, advice: "", parts, joints };
    const of = parts.reduce((s, p) => s + p.of, 0);
    const score = Math.round(parts.reduce((s, p) => s + p.got, 0) / of * 100);
    const sharp = joints.filter(j => j.level === 3);
    let verdict = score >= 75 ? "green" : score < 50 ? "red" : "amber";
    if ((sleep != null && sleep < 5.5) || sharp.length) verdict = "red";
    else if (verdict === "green" && sleep != null && sleep < sleepMin) verdict = "amber";

    const advice = [{
      green: "Train as planned and try to beat last session.",
      amber: "Train as planned. Aim to match last session's numbers; don't chase PRs.",
      red: "Train, but keep the same loads and drop the last set of each exercise. If you feel awful in warm-ups, make it a rest day.",
    }[verdict]];
    if (sharp.length) advice.push(`Sharp ${sharp.map(j => j.label.toLowerCase()).join(" and ")} pain: skip or swap lifts that load it today. If sharp pain keeps coming back or lasts more than 2 weeks, get it checked by a physio or doctor.`);
    else if (joints.some(j => j.level === 2)) advice.push("For the sore joint, pick a pain-free range or swap the lift that bothers it.");
    return { date, status: "ok", score, verdict, advice: advice.join(" "), parts, joints, sleep, ...r };
  }

  // ---------- lift trend ----------
  // Full logger (lb_workouts) first, Quick log (workouts/{date}.sets) for dates the logger doesn't cover.
  // Lifts are keyed by slug so both sources line up; lb weights are converted to kg.
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const LB = 0.45359237;
  const localDate = t => { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  function sessionsByLift(docs, from, to) {
    const workouts = (docs && docs.workouts) || {};
    const lbList = Array.isArray(docs && docs.lb_workouts) ? docs.lb_workouts : Object.values((docs && docs.lb_workouts) || {});
    const lbEx = (docs && docs.lb_exercises) || {};
    const names = {}, perDate = {};
    const keep = (date, key, e) => { const m = perDate[date] = perDate[date] || {}; m[key] = Math.max(m[key] || 0, e); };
    const lbDates = new Set();
    lbList.forEach(w => {
      if (!w || !num(w.start) || !Array.isArray(w.exercises)) return;
      const date = localDate(w.start);
      if (date < from || date > to) return;
      lbDates.add(date);
      w.exercises.forEach(e => {
        if (!e || !e.exId) return;
        const key = slug(e.exId);
        names[key] = names[key] || (lbEx[e.exId] && lbEx[e.exId].name) || null;
        (e.sets || []).forEach(st => {
          if (!st || st.t === "w" || st.done === false) return;
          const wt = num(st.w), r = num(st.r);
          if (wt > 0 && r > 0) keep(date, key, e1rm(e.unit === "lb" ? wt * LB : wt, r));
        });
      });
    });
    Object.values(workouts).forEach(w => {
      if (!w || !isDate(w.date) || w.session === "Rest") return;
      Object.keys(w.sets || {}).forEach(n => { names[slug(n)] = n; });
      if (w.date < from || w.date > to || lbDates.has(w.date)) return;
      Object.entries(w.sets || {}).forEach(([name, sets]) => (sets || []).forEach(st => {
        if (!st || st.warmup || st.wu || st.t === "w") return;
        const wt = num(st.w), r = num(st.r);
        if (wt > 0 && r > 0) keep(w.date, slug(name), e1rm(st.unit === "lb" ? wt * LB : wt, r));
      }));
    });
    const out = {};
    Object.entries(perDate).forEach(([date, lifts]) => Object.entries(lifts).forEach(([key, e]) => {
      const name = names[key] || key.replace(/-/g, " ").replace(/^./, c => c.toUpperCase());
      (out[name] = out[name] || []).push({ date, e, deload: !!(workouts[date] && workouts[date].deload) });
    }));
    Object.values(out).forEach(a => a.sort((x, y) => x.date < y.date ? -1 : 1));
    return out;
  }

  // ---------- fatigue (trend over the last 2 weeks) ----------
  function fatigue(docs, o = {}) {
    const { sleepMin } = opt(o);
    const today = isDate(o.today) ? o.today : localToday();
    const days = (docs && docs.days) || {};
    const workouts = (docs && docs.workouts) || {};
    const main = (docs && docs.prefs && docs.prefs.main) || {};
    const dFrom = isDate(o.deloadFrom) ? o.deloadFrom : main.deloadFrom;
    const dUntil = isDate(o.deloadUntil) ? o.deloadUntil : main.deloadUntil;
    const onDeload = (isDate(dFrom) && isDate(dUntil) && today >= dFrom && today <= dUntil) ||
      Object.values(workouts).some(w => w && w.deload && isDate(w.date) && w.date >= add(today, -6) && w.date <= today);
    const warnings = [], notes = [];
    const signals = new Set();

    // 1. Lifts: last session vs best of the up-to-3 sessions before it (last 6 weeks), ignoring deload sessions.
    const by = sessionsByLift(docs, add(today, -41), today);
    const lifts = Object.entries(by).map(([name, ss]) => {
      const normal = ss.filter(s => !s.deload);
      if (normal.length < 2) return null;
      const last = normal[normal.length - 1];
      if (last.date < add(today, -9)) return null;
      const before = normal.slice(-4, -1);
      const best = Math.max(...before.map(s => s.e));
      const change = last.e / best - 1;
      const prev = normal[normal.length - 2];
      const twice = normal.length >= 3 && last.e < prev.e && prev.e < normal[normal.length - 3].e;
      return { name, date: last.date, last: Math.round(last.e * 10) / 10, best: Math.round(best * 10) / 10, change, down: change <= -0.03 || twice };
    }).filter(Boolean).sort((a, b) => a.change - b.change);
    const down = lifts.filter(l => l.down);
    if (lifts.length < 2) notes.push("Lift trends need 2+ sessions of the same lifts in the last 6 weeks.");
    else if (!onDeload && down.length >= 2 && down.length >= lifts.length / 2) {
      signals.add("lifts");
      warnings.push({
        id: "lifts-down", level: "act", title: "Lifts are slipping",
        text: `${down.length} of ${lifts.length} recent lifts are below their last few sessions. Check sleep, pre-workout food and volume before changing calories.`,
        evidence: down.slice(0, 4).map(l => `${l.name}: ${f1(l.last)} kg est. 1RM vs ${f1(l.best)} kg (${pct(l.change)})`),
      });
    } else if (!onDeload && down.length === 1) {
      notes.push(`${down[0].name} is down ${pct(down[0].change)} on its recent best. One lift alone is normal noise.`);
    }

    // 2. Effort ratings (EffortDeload's workouts/{date}.effort): last 7 days vs the 14 before.
    const eff = (from, to) => Object.values(workouts).filter(w => w && isDate(w.date) && w.date >= from && w.date <= to && num(w.effort) != null && !w.deload).map(w => num(w.effort));
    const eC = eff(add(today, -6), today), eAB = eff(add(today, -20), add(today, -7));
    if (eC.length >= 2 && eAB.length >= 2 && mean(eC) - mean(eAB) >= 1) {
      signals.add("effort");
      warnings.push({ id: "effort-up", level: "watch", title: "Workouts feel harder",
        text: `Average effort is ${f1(mean(eC))}/10 this week vs ${f1(mean(eAB))}/10 the two weeks before.`,
        evidence: [`${eC.length} rated sessions this week, ${eAB.length} before`] });
    }

    // 3. Sleep: last 7 nights.
    const nights = [...Array(7)].map((_, i) => sleepOf(days[add(today, -i)])).filter(x => x != null);
    if (nights.length >= 4) {
      const avg = mean(nights), shortN = nights.filter(n => n < sleepMin).length;
      if (avg < sleepMin || shortN >= Math.ceil(nights.length / 2)) {
        signals.add("sleep");
        warnings.push({ id: "short-sleep", level: avg < sleepMin - 1 ? "act" : "watch", title: "Sleep is running short",
          text: `${f1(avg)} h a night on average this week; ${shortN} of ${nights.length} logged nights under ${sleepMin} h. Short sleep on a cut costs muscle and strength first.`,
          evidence: [`Target ${sleepMin}+ h`] });
      }
    } else notes.push("Sleep trend needs 4+ logged nights this week.");

    // 4. Check-ins: soreness / energy over the last 5 days.
    const recent = [...Array(5)].map((_, i) => rec(days[add(today, -i)])).filter(hasCheckin);
    if (recent.length >= 3) {
      const sore = recent.filter(r => r.soreness != null && r.soreness <= 2).length;
      const flat = recent.filter(r => r.energy != null && r.energy <= 2).length;
      if (sore >= 3) { signals.add("sore"); warnings.push({ id: "sore", level: "watch", title: "Soreness isn't clearing", text: `Very sore on ${sore} of the last ${recent.length} check-ins. Recovery between sessions may be falling behind.`, evidence: [] }); }
      if (flat >= 3) { signals.add("energy"); warnings.push({ id: "low-energy", level: "watch", title: "Energy has been low", text: `Low energy on ${flat} of the last ${recent.length} check-ins.`, evidence: [] }); }
    }

    // 5. Joints: same area 3+ times in 10 days, or any sharp in 7 days.
    const jc = {};
    for (let i = 0; i < 10; i++) {
      const d = add(today, -i);
      Object.entries(rec(days[d]).joints).forEach(([k, lv]) => { const j = jc[k] = jc[k] || { n: 0, max: 0, sharp: 0, last: d }; j.n++; j.max = Math.max(j.max, lv); if (lv === 3 && i < 7) j.sharp++; });
    }
    Object.entries(jc).forEach(([k, j]) => {
      if (j.sharp || j.n >= 3) warnings.push({ id: "joint-" + k, level: j.sharp ? "act" : "watch", title: `${jointLabel(k)} keeps bothering you`,
        text: (j.sharp ? `Sharp ${jointLabel(k).toLowerCase()} pain logged this week. ` : `${jointLabel(k)} discomfort on ${j.n} of the last 10 days. `) +
          "Swap the lifts that load it (Swap in Quick log) and keep the rest. If it's sharp, getting worse, or lasts more than 2 weeks, see a physio or doctor.",
        evidence: [`Logged ${j.n}× in 10 days, worst: ${JOINT_LEVELS[j.max].toLowerCase()}`] });
    });

    const s = signals.size;
    let level = s >= 2 || warnings.some(w => w.level === "act") ? "high" : warnings.length ? "watch" : "low";
    if (s >= 2) {
      const names = { lifts: "lifts slipping", effort: "harder workouts", sleep: "short sleep", sore: "lasting soreness", energy: "low energy" };
      warnings.unshift({ id: "fatigue", level: "act", title: "Fatigue is building",
        text: `${[...signals].map(k => names[k]).join(", ").replace(/, ([^,]*)$/, " and $1")} at the same time. ` +
          (signals.has("sleep") ? "Fix sleep first. " : "") + "If it's still there next week, take a lighter week: same exercises, one less set each, about 90% of usual weights. Don't cut calories for it.",
        evidence: [] });
    }
    if (onDeload) notes.push("Lighter week in progress, so lower loads aren't counted as a drop.");
    return { today, level, warnings, lifts, onDeload, notes };
  }

  function series(docs, o = {}) {
    const today = isDate(o.today) ? o.today : localToday();
    const n = num(o.days) || 14;
    const days = (docs && docs.days) || {};
    return [...Array(n)].map((_, i) => {
      const date = add(today, i - n + 1);
      const r = rec(days[date]);
      const rd = readiness(docs, Object.assign({}, o, { date }));
      return { date, sleep: sleepOf(days[date]), quality: r.quality, soreness: r.soreness, energy: r.energy, joints: r.joints, score: rd.score, verdict: rd.verdict };
    });
  }

  // ---------- writes ----------
  function handle(target, docs, date) {
    const b = target && target.closest ? target.closest("[data-rf]") : null;
    if (!b) return null;
    const d = b.dataset.rfDate || date;
    if (!isDate(d)) return null;
    const day = Object.assign({ date: d }, ((docs && docs.days) || {})[d]);
    const r = Object.assign({}, day.recovery || {});
    r.joints = Object.assign({}, r.joints || {});
    const kind = b.dataset.rf, v = b.dataset.rfV;
    if (SCALES[kind]) { const n = scale(v); if (r[kind] === n) delete r[kind]; else r[kind] = n; }
    else if (kind === "joint") { if (!JOINTS.some(j => j.id === v)) return null; const lv = ((num(r.joints[v]) || 0) + 1) % 4; if (lv) r.joints[v] = lv; else delete r.joints[v]; }
    else if (kind === "clear") { delete day.recovery; return { collection: "days", id: d, doc: day }; }
    else return null;
    if (!Object.keys(r.joints).length) delete r.joints;
    r.at = new Date().toISOString();
    day.recovery = r;
    return { collection: "days", id: d, doc: day };
  }

  // ---------- HTML ----------
  const VERD = { green: "Ready to push", amber: "Train, hold steady", red: "Go easier today" };
  function scaleRow(kind, cur, date) {
    const s = SCALES[kind];
    return `<div class="rf-row"><span class="rf-lab">${s.label}</span><div class="rf-scale" role="group" aria-label="${s.label} 1 to 5">` +
      [1, 2, 3, 4, 5].map(n => `<button type="button" class="rf-n${n === cur ? " on" : ""}" data-rf="${kind}" data-rf-v="${n}" data-rf-date="${esc(date)}" aria-pressed="${n === cur}">${n}</button>`).join("") +
      `</div><span class="rf-ends"><span>${s.ends[0]}</span><span>${s.ends[1]}</span></span></div>`;
  }

  function checkinHtml(docs, o = {}) {
    const date = isDate(o.date) ? o.date : localToday();
    const rd = readiness(docs, Object.assign({}, o, { date }));
    const r = rec(((docs && docs.days) || {})[date]);
    const head = rd.status === "ok"
      ? `<div class="rf-verdict rf-${rd.verdict}"><b class="rf-score">${rd.score}</b><div><b>${VERD[rd.verdict]}</b><p>${esc(rd.advice)}</p></div></div>`
      : `<p class="rf-muted">Tap how you feel this morning. Hours slept come from the checklist above.</p>`;
    const joints = `<div class="rf-row"><span class="rf-lab">Joints <span class="rf-muted">(tap: mild → moderate → sharp → off)</span></span><div class="rf-joints">` +
      JOINTS.map(j => { const lv = r.joints[j.id] || 0; return `<button type="button" class="rf-j lv${lv}" data-rf="joint" data-rf-v="${j.id}" data-rf-date="${esc(date)}" aria-pressed="${lv > 0}">${j.label}${lv ? " · " + JOINT_LEVELS[lv] : ""}</button>`; }).join("") + `</div></div>`;
    const why = rd.parts.length ? `<details class="rf-why"><summary>Why this score</summary><ul>${rd.parts.map(p => `<li>${esc(p.label)}: ${esc(p.text)} <span class="rf-muted">${p.got}/${p.of}</span></li>`).join("")}</ul></details>` : "";
    return `<div class="card rf-card"><div class="rf-head"><b>Recovery check-in</b><span class="rf-muted">${short(date)}</span></div>${head}` +
      scaleRow("quality", r.quality, date) + scaleRow("soreness", r.soreness, date) + scaleRow("energy", r.energy, date) + joints + why + `</div>`;
  }

  function warningsHtml(res) {
    if (!res || res.level === "low" || !res.warnings.length) return "";
    return `<div class="card rf-warn rf-${res.level}"><div class="rf-head"><b>${res.level === "high" ? "Recovery warning" : "Recovery: keep an eye on"}</b></div>` +
      res.warnings.map(w => `<div class="rf-w ${w.level}"><b>${esc(w.title)}</b><p>${esc(w.text)}</p>${w.evidence.length ? `<ul>${w.evidence.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}</div>`).join("") + `</div>`;
  }

  function spark(vals, max, cls) {
    const W = 280, H = 40, n = vals.length, x = i => n < 2 ? 0 : i / (n - 1) * W;
    let path = "", pen = false;
    vals.forEach((v, i) => { if (v == null) { pen = false; return; } path += (pen ? "L" : "M") + x(i).toFixed(1) + "," + (H - 3 - (v / max) * (H - 6)).toFixed(1); pen = true; });
    const dots = vals.map((v, i) => v == null ? "" : `<circle cx="${x(i).toFixed(1)}" cy="${(H - 3 - (v / max) * (H - 6)).toFixed(1)}" r="2.2"/>`).join("");
    return `<svg class="rf-spark ${cls}" viewBox="-3 0 ${W + 6} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"/>${dots}</svg>`;
  }

  function html(docs, o = {}) {
    const today = isDate(o.today) ? o.today : localToday();
    const s = series(docs, Object.assign({}, o, { today, days: 14 }));
    const fa = fatigue(docs, Object.assign({}, o, { today }));
    const last7 = s.slice(-7);
    const avg = k => { const v = last7.map(x => x[k]).filter(x => x != null); return v.length ? f1(mean(v)) : "—"; };
    const logged = s.filter(x => x.score != null).length;
    const tiles = [["Sleep", avg("sleep"), "h"], ["Quality", avg("quality"), "/5"], ["Soreness", avg("soreness"), "/5"], ["Energy", avg("energy"), "/5"]]
      .map(([l, v, u]) => `<div class="rf-tile"><span class="rf-muted">${l}</span><b>${v}${v === "—" ? "" : `<small>${u}</small>`}</b></div>`).join("");
    const body = logged
      ? `<div class="rf-chart"><span class="rf-muted">Readiness, last 14 days</span>${spark(s.map(x => x.score), 100, "score")}<div class="rf-ends"><span>${short(s[0].date)}</span><span>${short(today)}</span></div></div>`
      : `<p class="rf-muted">No check-ins yet. Log sleep and the morning check-in on Today to see a trend here.</p>`;
    const lv = { low: "No fatigue signs", watch: "Some signs to watch", high: "Fatigue building" }[fa.level];
    return `<div class="card rf-card"><div class="rf-head"><b>Recovery &amp; fatigue</b><span class="rf-pill rf-${fa.level}">${lv}</span></div>` +
      `<div class="rf-tiles">${tiles}</div><p class="rf-muted rf-small">7-day averages · ${logged} of 14 days logged</p>${body}` +
      (fa.warnings.length ? `<ul class="rf-list">${fa.warnings.map(w => `<li class="rf-w ${w.level}"><b>${esc(w.title)}</b></li>`).join("")}</ul><p class="rf-muted rf-small">Details and what to do are on the Train tab.</p>` : "") +
      (fa.notes.length ? `<ul class="rf-notes">${fa.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : "") + `</div>`;
  }

  function summary(docs, o = {}) {
    const today = isDate(o.today) ? o.today : localToday();
    const rd = readiness(docs, Object.assign({}, o, { date: today }));
    const fa = fatigue(docs, Object.assign({}, o, { today }));
    const lines = [`Recovery (${today})`];
    lines.push(rd.status === "ok" ? `Readiness ${rd.score}/100 (${VERD[rd.verdict]}). ${rd.parts.map(p => p.label + ": " + p.text).join("; ")}.` : "No check-in today.");
    lines.push(`Fatigue: ${fa.level}.`);
    fa.warnings.forEach(w => lines.push(`- ${w.title}: ${w.text}${w.evidence.length ? " (" + w.evidence.join("; ") + ")" : ""}`));
    fa.notes.forEach(n => lines.push(`  note: ${n}`));
    return lines.join("\n");
  }

  const css = `
.rf-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px}
.rf-muted{color:var(--muted);font-size:.85em}
.rf-small{margin:6px 0 10px}
.rf-row{margin:10px 0}
.rf-lab{display:block;font-size:.9em;margin-bottom:4px}
.rf-scale{display:grid;grid-template-columns:repeat(5,1fr);gap:4px}
.rf-n{min-height:44px;border:1px solid var(--line);border-radius:calc(var(--r,12px)*.6);background:var(--sunk);color:var(--ink);font:600 15px var(--mono,monospace);cursor:pointer;padding:0}
.rf-n.on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.rf-ends{display:flex;justify-content:space-between;color:var(--muted);font-size:.72em;margin-top:3px}
.rf-joints{display:flex;flex-wrap:wrap;gap:6px}
.rf-j{min-height:40px;padding:0 12px;border:1px solid var(--line);border-radius:999px;background:var(--sunk);color:var(--ink);font-size:.88em;cursor:pointer}
.rf-j.lv1{border-color:var(--warn)}
.rf-j.lv2{background:color-mix(in srgb,var(--warn) 22%,var(--sunk));border-color:var(--warn)}
.rf-j.lv3{background:var(--bad);border-color:var(--bad);color:#fff;font-weight:600}
.rf-verdict{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border-radius:calc(var(--r,12px)*.7);background:var(--sunk);border-left:4px solid var(--muted)}
.rf-verdict p{margin:2px 0 0;font-size:.9em}
.rf-verdict.rf-green{border-left-color:var(--good)}.rf-verdict.rf-amber{border-left-color:var(--warn)}.rf-verdict.rf-red{border-left-color:var(--bad)}
.rf-score{font:700 28px/1 var(--mono,monospace);min-width:2.2em}
.rf-why{margin-top:8px;font-size:.88em}.rf-why ul{margin:6px 0 0;padding-left:18px}
.rf-warn{border-left:4px solid var(--warn)}.rf-warn.rf-high{border-left-color:var(--bad)}
.rf-w{margin:8px 0}.rf-w p{margin:2px 0 0;font-size:.92em}.rf-w ul{margin:4px 0 0;padding-left:18px;font-size:.85em;color:var(--muted)}
.rf-w.act b{color:var(--bad)}.rf-w.watch b{color:var(--warn)}
.rf-pill{font-size:.78em;padding:2px 10px;border-radius:999px;background:var(--sunk);border:1px solid var(--line)}
.rf-pill.rf-watch{color:var(--warn);border-color:var(--warn)}.rf-pill.rf-high{color:var(--bad);border-color:var(--bad)}.rf-pill.rf-low{color:var(--good)}
.rf-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.rf-tile{background:var(--sunk);border-radius:calc(var(--r,12px)*.6);padding:8px;display:flex;flex-direction:column;gap:2px}
.rf-tile b{font:700 18px var(--mono,monospace)}.rf-tile small{font-size:.65em;color:var(--muted);font-weight:400}
.rf-chart{margin:4px 0 6px}
.rf-spark{width:100%;height:44px;display:block;margin-top:4px}
.rf-spark path{fill:none;stroke:var(--accent);stroke-width:2;vector-effect:non-scaling-stroke}
.rf-spark circle{fill:var(--accent)}
.rf-list{margin:8px 0 0;padding-left:18px}.rf-list .rf-w{margin:2px 0}
.rf-notes{margin:8px 0 0;padding-left:18px;color:var(--muted);font-size:.82em}
`;

  return { css, JOINTS, SCALES, readiness, fatigue, series, handle, checkinHtml, warningsHtml, html, summary };
})();

if (typeof module !== "undefined") module.exports = { RecoveryFatigue };
