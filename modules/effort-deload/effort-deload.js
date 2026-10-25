/* Workout effort rating + deload nudge for the Aziz Cut Tracker.
 * Plain JS, no imports, no network. Reads and writes the app's own workouts/{date} docs:
 *   {date, session, idx, sets:{"<exercise>":[{w,r}]}, effort: 1-10, deload: true (optional)}
 * API:
 *   EffortDeload.css                              -> string, inject once (uses the app's tokens)
 *   EffortDeload.LEVELS                           -> [{n, label}] for 1..10
 *   EffortDeload.clean(value)                     -> integer 1..10 or null
 *   EffortDeload.withEffort(workoutDoc, n)        -> copy of the doc with effort set (null clears it)
 *   EffortDeload.pickerHtml(date, current)        -> "How hard was it?" card, buttons carry
 *                                                    data-effort="<n>" data-effort-date="<date>"
 *   EffortDeload.analyze(workouts, {today, dismissedAt}) -> {nudge, reason, text, weeks, lifts}
 *   EffortDeload.nudgeHtml(result)                -> lighter-week card ("" when no nudge); its buttons
 *                                                    carry data-deload="dismiss" | "start"
 * Host wiring: show pickerHtml after a workout is finished (Quick log save and the Full logger's
 * onFinish); on click put("workouts", date, EffortDeload.withEffort(doc, n)). Render nudgeHtml on
 * Train (and/or Today). "dismiss" stores prefs/main.deloadDismissedAt = today; "start" sets prefs/main.deloadFrom/deloadUntil (today..today+6)
 * and workouts saved in that range get deload:true.
 *
 * The rule (rolling 7-day windows ending today: C = last 7 days, B = the 7 before, A = the 7 before that):
 *   effort rising  = avg(C) >= avg(B) >= avg(A) and avg(C) - avg(A) >= 1, or B and C both average >= 8.5
 *   e1RM stalled   = across lifts logged in A..C, fewer than a third set a best in B or C that beats
 *                    their best from the 4 weeks before B by more than 1% (needs 2+ lifts)
 *   nudge          = both, with 2+ rated sessions in B and in C and 1+ in A,
 *                    no deload-marked workout in the last 21 days, and not dismissed in the last 14 days.
 */
const EffortDeload = (() => {
  const DAY = 864e5;
  const LEVELS = [
    [1, "Barely a workout"], [2, "Very easy"], [3, "Easy"], [4, "Comfortable"], [5, "Moderate"],
    [6, "Solid work"], [7, "Hard"], [8, "Very hard"], [9, "Near my limit"], [10, "Everything I had"],
  ].map(([n, label]) => ({ n, label }));

  const ms = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => iso(ms(s) + n * DAY);
  const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const num = v => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const e1rm = (w, r) => w * (1 + Math.min(r, 30) / 30);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

  function clean(v) {
    const n = num(v);
    return n == null ? null : Math.min(10, Math.max(1, Math.round(n)));
  }

  function withEffort(doc, n) {
    const out = Object.assign({}, doc);
    const e = clean(n);
    if (e == null) delete out.effort; else out.effort = e;
    return out;
  }

  // workouts: {date: doc} or [doc]
  function list(workouts) {
    const arr = Array.isArray(workouts) ? workouts : Object.values(workouts || {});
    return arr.filter(w => w && isDate(w.date) && w.session !== "Rest");
  }

  function bestByLift(ws) {
    const out = {};
    ws.forEach(w => Object.entries(w.sets || {}).forEach(([name, sets]) => (sets || []).forEach(s => {
      const wt = num(s && s.w), r = num(s && s.r);
      if (wt > 0 && r > 0) { const e = e1rm(wt, r); if (!out[name] || e > out[name]) out[name] = e; }
    })));
    return out;
  }

  function analyze(workouts, opts = {}) {
    const today = isDate(opts.today) ? opts.today : localToday();
    const ws = list(workouts).filter(w => w.date <= today);
    const win = (from, to) => ws.filter(w => w.date >= from && w.date <= to);
    // C: today-6..today, B: today-13..today-7, A: today-20..today-14, prior: 4 weeks before B
    const bounds = { A: [add(today, -20), add(today, -14)], B: [add(today, -13), add(today, -7)], C: [add(today, -6), today] };
    const weeks = ["A", "B", "C"].map(k => {
      const rated = win(...bounds[k]).map(w => clean(w.effort)).filter(e => e != null);
      return { key: k, from: bounds[k][0], to: bounds[k][1], sessions: win(...bounds[k]).length, rated: rated.length, avg: mean(rated) };
    });
    const [A, B, C] = weeks;

    const prior = bestByLift(win(add(today, -41), add(today, -14)));
    const recent = bestByLift(win(bounds.B[0], today));
    const lifts = Object.keys(recent).filter(n => prior[n]).map(name => {
      const change = recent[name] / prior[name] - 1;
      return { name, before: prior[name], recent: recent[name], change, progressed: change > 0.01 };
    }).sort((a, b) => a.change - b.change);
    const progressed = lifts.filter(l => l.progressed).length;

    const enough = A.rated >= 1 && B.rated >= 2 && C.rated >= 2;
    const rising = enough && ((C.avg >= B.avg && B.avg >= A.avg && C.avg - A.avg >= 1) || (B.avg >= 8.5 && C.avg >= 8.5));
    const stalled = lifts.length >= 2 && progressed < lifts.length / 3;
    const recentDeload = ws.some(w => w.deload && w.date >= add(today, -20));
    const dismissed = isDate(opts.dismissedAt) && opts.dismissedAt > add(today, -14) && opts.dismissedAt <= today;

    let reason;
    if (!enough) reason = "not-enough-ratings";
    else if (!rising) reason = "effort-ok";
    else if (lifts.length < 2) reason = "not-enough-lifts";
    else if (!stalled) reason = "still-progressing";
    else if (recentDeload) reason = "recent-deload";
    else if (dismissed) reason = "dismissed";
    else reason = "deload";
    const nudge = reason === "deload";

    const text = nudge
      ? `Effort is up from ${f1(A.avg)} to ${f1(C.avg)} out of 10 over 2 weeks while your lifts have stalled (${progressed} of ${lifts.length} improved). ` +
        "Take a lighter week: same exercises, one less set each, about 90% of your usual weights, and stop 3 or more reps before failure. Keep protein and steps as normal. Then go back to your normal loads."
      : "";
    return { nudge, reason, text, today, weeks, lifts, rising: !!rising, stalled };
  }

  function pickerHtml(date, current) {
    const cur = clean(current);
    const lab = cur ? LEVELS[cur - 1].label : "Tap a number";
    return `<div class="card ed-card"><div class="ed-head"><b>How hard was it?</b><span class="ed-lab">${cur ? cur + " · " : ""}${esc(lab)}</span></div>` +
      `<div class="ed-scale" role="group" aria-label="Effort from 1 to 10">` +
      LEVELS.map(l => `<button type="button" class="ed-n${l.n === cur ? " on" : ""}${l.n >= 9 ? " hi" : ""}" data-effort="${l.n}" data-effort-date="${esc(date)}" aria-pressed="${l.n === cur}" title="${esc(l.label)}">${l.n}</button>`).join("") +
      `</div><div class="ed-ends"><span>Easy</span><span>Max</span></div></div>`;
  }

  function nudgeHtml(res) {
    if (!res || !res.nudge) return "";
    const C = res.weeks[2], A = res.weeks[0];
    const top = res.lifts.slice(0, 3).map(l => `<li>${esc(l.name)} <span class="ed-muted">${l.change >= 0 ? "+" : "−"}${f1(Math.abs(l.change) * 100)}%</span></li>`).join("");
    return `<div class="card ed-nudge"><div class="ed-head"><b>Time for a lighter week?</b><span class="ed-lab">Effort ${f1(A.avg)} → ${f1(C.avg)}</span></div>` +
      `<p>${esc(res.text)}</p>${top ? `<ul class="ed-lifts">${top}</ul>` : ""}` +
      `<div class="ed-row"><button type="button" class="ed-btn" data-deload="start">Start lighter week</button><button type="button" class="ed-btn ghost" data-deload="dismiss">Not now</button></div></div>`;
  }

  const css = `
.ed-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px}
.ed-lab,.ed-muted{color:var(--muted);font-size:.85em}
.ed-scale{display:grid;grid-template-columns:repeat(10,1fr);gap:4px}
.ed-n{min-height:44px;border:1px solid var(--line);border-radius:calc(var(--r,12px)*.6);background:var(--sunk);color:var(--ink);font:600 15px var(--mono,monospace);cursor:pointer;padding:0}
.ed-n.hi{color:var(--warn)}
.ed-n.on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.ed-ends{display:flex;justify-content:space-between;color:var(--muted);font-size:.75em;margin-top:4px}
.ed-nudge{border-left:4px solid var(--warn)}
.ed-nudge p{margin:0 0 8px}
.ed-lifts{margin:0 0 10px;padding-left:18px}
.ed-row{display:flex;gap:8px;flex-wrap:wrap}
.ed-btn{min-height:44px;padding:0 16px;border-radius:calc(var(--r,12px)*.6);border:1px solid var(--accent);background:var(--accent);color:var(--accent-ink);font-weight:600;cursor:pointer}
.ed-btn.ghost{background:transparent;color:var(--ink);border-color:var(--line)}
`;

  return { css, LEVELS, clean, withEffort, pickerHtml, analyze, nudgeHtml };
})();

if (typeof module !== "undefined") module.exports = { EffortDeload };
