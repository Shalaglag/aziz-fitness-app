/* Lift goals with a projected date, for the Train tab of the Aziz Cut Tracker.
 * Plain JS, no imports, no network. Global `LiftGoals`.
 * A goal is a load (and reps) for a lift, e.g. "Bench Press 100 kg × 1" or "Hack Squat 180 kg × 8".
 * Progress is measured on the lift's est. 1RM (Epley) series from StrengthAnalytics.analyze(docs, opts).lifts,
 * and the date is projected from the slope of that series over the last 8 weeks.
 *
 * API:
 *   LiftGoals.css                                 -> string, inject once (uses the app's tokens)
 *   LiftGoals.empty()                             -> {goals: []}         (stored as prefs/liftGoals)
 *   LiftGoals.add(state, {name, w, r, unit, by})  -> new state (w in the lift's unit, r default 1, by = optional ISO date)
 *   LiftGoals.remove(state, id)                   -> new state
 *   LiftGoals.project(state, lifts, {today})      -> [{id, name, target, targetKg, w, r, unit, by, current, best,
 *                                                     pct, ratePerWeek, eta, status, note, onTrack, needPerWeek}]
 *     status: "reached" | "trend" (eta from the slope) | "early" (fewer than 3 sessions over 14+ days)
 *             | "stalled" (slope ≤ 0) | "none" (lift never logged)
 *   LiftGoals.html(state, lifts, {today, names})  -> one `.card` for the Train tab
 *   LiftGoals.handle(el, {state, root, today})    -> {state, toast} | null for a click on a [data-lg] element
 * `lifts` is StrengthAnalytics.analyze(...).lifts or the whole analyze() result; each lift has
 * {name, unit:"kg"|"lb", points:[{date, e1rm (kg)}]} and matching is by a case/punctuation-insensitive name key.
 */
const LiftGoals = (() => {
  const LB = 0.45359237, DAY = 864e5, WINDOW = 56, MIN_POINTS = 3, MIN_SPAN = 14, MAX_WEEKS = 104, STALL = 0.05;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ms = d => Date.parse(d + "T00:00:00Z");
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const addDays = (d, n) => iso(ms(d) + Math.round(n) * DAY);
  const days = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(ms(s));
  const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const short = (d, withYear) => { const t = new Date(ms(d)); return MON[t.getUTCMonth()] + " " + t.getUTCDate() + (withYear ? " " + t.getUTCFullYear() : ""); };
  const keyOf = s => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = v => { const n = typeof v === "number" ? v : parseFloat(v); return isFinite(n) ? n : null; };
  const f1 = n => (Math.round(n * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });
  const toKg = (w, unit) => unit === "lb" ? w * LB : w;
  const fromKg = (kg, unit) => unit === "lb" ? kg / LB : kg;
  const e1rm = (kg, r) => (!(kg > 0) || !(r >= 1) || r > 20) ? null : r === 1 ? kg : kg * (1 + r / 30);
  const uid = () => "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const empty = () => ({ goals: [] });
  const norm = state => ({ goals: Array.isArray(state && state.goals) ? state.goals.slice() : [] });

  function add(state, g) {
    const s = norm(state);
    const name = String((g && g.name) || "").trim(), w = num(g && g.w), r = Math.round(num(g && g.r) || 1);
    if (!name || !(w > 0) || !(r >= 1) || r > 20) return s;
    const unit = g.unit === "lb" ? "lb" : "kg";
    const by = isDate(g && g.by) ? g.by : null;
    // one goal per lift: a new target for the same lift replaces the old one
    s.goals = s.goals.filter(x => keyOf(x.name) !== keyOf(name));
    s.goals.push({ id: (g && g.id) || uid(), name, w, r, unit, by, created: isDate(g && g.created) ? g.created : localToday() });
    return s;
  }
  function remove(state, id) { const s = norm(state); s.goals = s.goals.filter(g => g.id !== id); return s; }

  // Least-squares slope (kg/day) and fitted value at `at` over the points inside the window.
  function fit(points, today) {
    const pts = points.filter(p => p.e1rm != null && isDate(p.date) && days(p.date, today) <= WINDOW && days(p.date, today) >= 0);
    if (pts.length < MIN_POINTS || days(pts[0].date, pts[pts.length - 1].date) < MIN_SPAN) return null;
    const xs = pts.map(p => days(pts[0].date, p.date)), ys = pts.map(p => p.e1rm);
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxx = 0, sxy = 0; xs.forEach((x, i) => { sxx += (x - mx) * (x - mx); sxy += (x - mx) * (ys[i] - my); });
    const slope = sxx ? sxy / sxx : 0;
    const lastX = days(pts[0].date, today);
    return { slope, at: my + slope * (lastX - mx), n, span: days(pts[0].date, pts[pts.length - 1].date) };
  }

  function liftsOf(lifts) { return Array.isArray(lifts) ? lifts : lifts && Array.isArray(lifts.lifts) ? lifts.lifts : []; }

  function project(state, lifts, opts = {}) {
    const today = isDate(opts.today) ? opts.today : localToday();
    const byKey = new Map(); liftsOf(lifts).forEach(l => byKey.set(keyOf(l.name), l));
    return norm(state).goals.map(g => {
      const lift = byKey.get(keyOf(g.name)) || null;
      const unit = g.unit === "lb" ? "lb" : "kg";
      const targetKg = e1rm(toKg(g.w, unit), g.r);
      const out = { id: g.id, name: lift ? lift.name : g.name, w: g.w, r: g.r, unit, by: g.by || null, created: g.created || null,
        target: fromKg(targetKg, unit), targetKg, current: null, best: null, pct: 0, ratePerWeek: null, eta: null, status: "none", note: "", onTrack: null, needPerWeek: null, sessions: 0 };
      if (!lift) { out.note = "Not logged yet. Log this lift and the bar fills from its est. 1RM."; return out; }
      const pts = (lift.points || []).filter(p => p.e1rm != null).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      out.sessions = pts.length;
      if (!pts.length) { out.note = "Logged, but no set with load and 1–20 reps yet."; return out; }
      const last = pts[pts.length - 1], best = pts.reduce((b, p) => (p.e1rm > b.e1rm ? p : b));
      out.current = fromKg(last.e1rm, unit); out.currentDate = last.date;
      out.best = fromKg(best.e1rm, unit); out.bestDate = best.date;
      out.pct = Math.max(0, Math.min(100, best.e1rm / targetKg * 100));
      if (best.e1rm >= targetKg - 1e-9) {
        out.status = "reached"; out.pct = 100; out.reachedOn = pts.find(p => p.e1rm >= targetKg - 1e-9).date;
        out.note = "Reached on " + short(out.reachedOn) + ". Set the next one.";
        return out;
      }
      const f = fit(pts, today);
      const gapKg = targetKg - (f ? Math.min(f.at, targetKg) : last.e1rm);
      if (g.by && isDate(g.by) && days(today, g.by) > 0) out.needPerWeek = fromKg(gapKg / days(today, g.by) * 7, unit);
      if (!f) {
        out.status = "early";
        out.note = (pts.length < MIN_POINTS ? pts.length + " of 3 sessions" : "Sessions span " + f0(days(pts[0].date, last.date)) + " days, needs 14") + " logged in the last 8 weeks. The date shows once there is a trend.";
        return out;
      }
      out.ratePerWeek = fromKg(f.slope * 7, unit);
      if (f.slope * 7 <= STALL) {
        out.status = "stalled";
        out.note = "Est. 1RM is " + (f.slope < 0 ? "slipping" : "flat") + " over the last 8 weeks (" + sgn(out.ratePerWeek) + " " + unit + "/wk). " + "On a cut, holding strength is the win; the date returns when it climbs.";
        return out;
      }
      const daysLeft = gapKg / f.slope;
      if (daysLeft > MAX_WEEKS * 7) { out.status = "stalled"; out.note = "At " + sgn(out.ratePerWeek) + " " + unit + "/wk this is more than two years out. The date shows when the pace picks up."; return out; }
      out.status = "trend"; out.eta = addDays(today, Math.max(1, Math.ceil(daysLeft)));
      out.weeksLeft = Math.ceil(daysLeft / 7);
      out.note = "At " + sgn(out.ratePerWeek) + " " + unit + "/wk on the est. 1RM, about " + short(out.eta, true) + ".";
      if (g.by && isDate(g.by)) { out.onTrack = out.eta <= g.by; out.note += out.onTrack ? " Ahead of " + short(g.by) + "." : " Needs " + sgn(out.needPerWeek) + " " + unit + "/wk to make " + short(g.by) + "."; }
      return out;
    });
  }
  const f0 = n => String(Math.round(n));
  const sgn = n => (n > 0 ? "+" : n < 0 ? "−" : "") + f1(Math.abs(n));

  const css = `
.lg-card .lg-list{display:grid;gap:12px;margin-top:10px}
.lg-goal{display:grid;gap:5px}
.lg-goal .lg-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}
.lg-goal .lg-top b{font-size:1rem}
.lg-goal .lg-nums{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:.85rem;color:var(--muted)}
.lg-bar{height:10px;border-radius:999px;background:var(--sunk,var(--surface-2,#eee));overflow:hidden;position:relative}
.lg-bar>span{display:block;height:100%;border-radius:999px;background:var(--accent);transition:width .4s ease}
.lg-goal.reached .lg-bar>span{background:var(--good)}
.lg-goal.stalled .lg-bar>span{background:var(--warn)}
.lg-goal.none .lg-bar>span,.lg-goal.early .lg-bar>span{background:var(--muted);opacity:.6}
.lg-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:.86rem;color:var(--muted)}
.lg-foot .lg-eta{color:var(--ink);font-weight:600}
.lg-foot .lg-eta.good{color:var(--good)} .lg-foot .lg-eta.warn{color:var(--warn)}
.lg-form{display:grid;grid-template-columns:1fr;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.lg-form .lg-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.lg-form input,.lg-form select{font:inherit;padding:7px 9px;border:1px solid var(--line);border-radius:var(--r,10px);background:var(--surface);color:var(--ink);min-width:0}
.lg-form input[type=number]{width:5.5em}
.lg-form input[type=date]{width:auto}
.lg-form select{flex:1 1 160px}
.lg-form .lg-x{color:var(--muted);font-size:.86rem}
.lg-del{background:none;border:0;color:var(--muted);cursor:pointer;font-size:1rem;line-height:1;padding:2px 6px}
.lg-del:hover{color:var(--bad)}
.lg-rule{font-size:.82rem;color:var(--muted);margin-top:8px}`;

  function html(state, lifts, opts = {}) {
    const today = isDate(opts.today) ? opts.today : localToday();
    const rows = project(state, lifts, { today });
    const all = liftsOf(lifts);
    const extra = (opts.names || []).filter(n => !all.some(l => keyOf(l.name) === keyOf(n)));
    const options = all.map(l => '<option value="' + esc(l.name) + '" data-unit="' + (l.unit === "lb" ? "lb" : "kg") + '">' + esc(l.name) + "</option>").join("") +
      (extra.length ? '<optgroup label="Not logged yet">' + extra.map(n => '<option value="' + esc(n) + '">' + esc(n) + "</option>").join("") + "</optgroup>" : "") +
      '<option value="__other">Other lift…</option>';
    const list = rows.length ? '<div class="lg-list">' + rows.map(goalHtml).join("") + "</div>"
      : '<p class="muted" style="font-size:.9rem">No lift goals yet. Pick a lift, set the load and reps you want, and a bar tracks your est. 1RM towards it with a projected date from your trend.</p>';
    return '<section class="card lg-card" data-lg-root><div class="spread"><h3>Lift goals</h3><span class="pill info">' + rows.filter(r => r.status === "reached").length + " / " + rows.length + " reached</span></div>" + list +
      '<div class="lg-form" data-lg-form>' +
      '<div class="lg-row"><select data-lg-field="name" aria-label="Lift">' + options + '</select><input type="text" data-lg-field="other" placeholder="Lift name" aria-label="Other lift name" hidden></div>' +
      '<div class="lg-row"><input type="number" inputmode="decimal" step="0.5" min="1" data-lg-field="w" placeholder="100" aria-label="Target load"><select data-lg-field="unit" aria-label="Unit"><option value="kg">kg</option><option value="lb">lb</option></select><span class="lg-x">×</span><input type="number" inputmode="numeric" min="1" max="20" data-lg-field="r" value="1" aria-label="Reps"><span class="lg-x">reps</span></div>' +
      '<div class="lg-row"><span class="lg-x">by</span><input type="date" data-lg-field="by" aria-label="Target date (optional)"><button class="btn small" type="button" data-lg="add">Add goal</button></div>' +
      "</div>" +
      '<p class="lg-rule">Progress is your best est. 1RM (Epley, best set per session) against the goal. The date is a straight line through the last 8 weeks of sessions and moves as you lift.</p>' +
      "</section>";
  }

  function goalHtml(r) {
    const tgt = f1(r.w) + " " + r.unit + (r.r > 1 ? " × " + r.r : "");
    const cur = r.best != null ? f1(r.best) + " " + r.unit + (r.r > 1 ? " (est. 1RM " + f1(r.target) + " needed)" : "") : "—";
    let eta = "", cls = "";
    if (r.status === "reached") { eta = "Reached " + short(r.reachedOn); cls = "good"; }
    else if (r.status === "trend") { eta = "~" + short(r.eta, true); cls = r.onTrack === false ? "warn" : r.onTrack ? "good" : ""; }
    else if (r.status === "stalled") { eta = "No date yet"; cls = "warn"; }
    else if (r.status === "early") { eta = "Needs more sessions"; }
    else eta = "Not logged";
    return '<div class="lg-goal ' + r.status + '" data-lg-id="' + esc(r.id) + '">' +
      '<div class="lg-top"><b>' + esc(r.name) + '</b><span class="lg-nums">' + esc(cur) + " → " + esc(tgt) + '</span><button class="lg-del" type="button" data-lg="remove" data-id="' + esc(r.id) + '" aria-label="Remove goal for ' + esc(r.name) + '">×</button></div>' +
      '<div class="lg-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(r.pct) + '"><span style="width:' + Math.round(r.pct) + '%"></span></div>' +
      '<div class="lg-foot"><span>' + Math.round(r.pct) + "%" + (r.ratePerWeek != null && r.status !== "reached" ? " · " + sgn(r.ratePerWeek) + " " + r.unit + "/wk" : "") + (r.by && r.status !== "reached" ? " · by " + short(r.by) : "") + '</span><span class="lg-eta ' + cls + '">' + esc(eta) + "</span></div>" +
      (r.note ? '<div class="muted" style="font-size:.84rem">' + esc(r.note) + "</div>" : "") +
      "</div>";
  }

  // Click handling for the shell: returns {state, toast} when the state changed, null otherwise.
  function handle(el, ctx = {}) {
    const btn = el && el.closest ? el.closest("[data-lg]") : null;
    if (!btn) return null;
    const act = btn.getAttribute("data-lg");
    const state = norm(ctx.state);
    if (act === "remove") {
      const id = btn.getAttribute("data-id"), g = state.goals.find(x => x.id === id);
      return { state: remove(state, id), toast: g ? "Removed the " + g.name + " goal" : "" };
    }
    if (act === "add") {
      const root = ctx.root || btn.closest("[data-lg-root]") || (typeof document !== "undefined" ? document : null);
      const q = f => root && root.querySelector ? root.querySelector('[data-lg-field="' + f + '"]') : null;
      const sel = q("name"), other = q("other");
      const name = sel && sel.value === "__other" ? (other && other.value || "") : (sel && sel.value || "");
      const g = { name: String(name).trim(), w: q("w") && q("w").value, r: q("r") && q("r").value || 1, unit: q("unit") && q("unit").value, by: q("by") && q("by").value || null };
      if (!g.name) return { state, toast: "Pick a lift first" };
      if (!(num(g.w) > 0)) return { state, toast: "Enter the target load" };
      if (!(num(g.r) >= 1 && num(g.r) <= 20)) return { state, toast: "Reps must be 1–20" };
      return { state: add(state, g), toast: "Goal set: " + g.name + " " + f1(num(g.w)) + " " + (g.unit === "lb" ? "lb" : "kg") + (num(g.r) > 1 ? " × " + Math.round(num(g.r)) : "") };
    }
    return null;
  }

  // Change handling: the "Other lift…" option reveals the text input and the lift's unit follows the pick.
  function onChange(el) {
    const sel = el && el.closest ? el.closest('[data-lg-field="name"]') : null;
    if (!sel) return false;
    const root = sel.closest("[data-lg-root]"), other = root && root.querySelector('[data-lg-field="other"]'), unit = root && root.querySelector('[data-lg-field="unit"]');
    if (other) other.hidden = sel.value !== "__other";
    const opt = sel.options && sel.options[sel.selectedIndex];
    if (unit && opt && opt.dataset && opt.dataset.unit) unit.value = opt.dataset.unit;
    return true;
  }

  return { css, empty, add, remove, project, html, handle, onChange, e1rm, keyOf, RULES: { WINDOW, MIN_POINTS, MIN_SPAN, STALL, MAX_WEEKS } };
})();
if (typeof module !== "undefined" && module.exports) module.exports = LiftGoals;
