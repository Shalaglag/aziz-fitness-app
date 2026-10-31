/* Muscle feedback → next week's sets (Train + Progress). Plain JS, no imports, no network.
 * After a muscle's last set, three quick taps (1–3 each): pump, soreness, workload. Saved on the day's
 * workout as workouts/{date}.feedback = { <muscleId>: {pump, soreness, workload, at} }.
 * Next week each muscle's sets go up, stay or go down by RP-style rules, inside its weekly set target.
 * API:
 *   MuscleFeedback.css                                   -> string, inject once (uses the app's tokens)
 *   MuscleFeedback.musclesTrained(workout, musclesFor)   -> [muscleId] primary muscles with a logged set
 *   MuscleFeedback.sessionDelta(fb)                      -> {delta:-2..+2, reason} for one {pump,soreness,workload}
 *   MuscleFeedback.plan(docs, opts)                      -> {from, to, rows:[{id,label,sets,sessions,delta,next,lo,hi,reason}], rated}
 *   MuscleFeedback.cardHtml(workout, date, opts)         -> taps card for Train ("" when nothing was lifted)
 *   MuscleFeedback.planHtml(docs, opts)                  -> "Next week's sets" card for Progress
 *   MuscleFeedback.handle(el, docs, date)                -> {collection:"workouts", id, doc} to save, or null
 *   MuscleFeedback.summary(docs, opts)                   -> plain text for the coach
 * opts (all optional):
 *   today        "YYYY-MM-DD", default the device's local date
 *   musclesFor   name -> {primary, secondary} | null; default window.StrengthAnalytics.musclesFor
 *   setTargets   {muscleId: {lo, hi}} weekly set targets (prefs/main.setTargets, Strength card)
 *   volume       {lo, hi} default range for muscles without a target, default 10–20
 *   weekSets     {muscleId: sets this week}; else analysis().muscles[].thisWeek; else counted here
 *   analysis     () => StrengthAnalytics.analyze(...) result, read lazily for this week's sets
 * Rules (per rated session, then averaged over the week and rounded):
 *   points = (2 − soreness) + (2 − pump) + (2 − workload)   → +3 … −3
 *   +2 when points ≥ 3 (fresh, no pump, easy), +1 when 1–2, 0 when 0 or −1, −1 when ≤ −2.
 *   Still sore (3) or too much workload (3) never adds sets; both together = −2.
 *   next = round(sets this week) + delta, capped at hi when adding and floored at lo when cutting;
 *   without feedback the sets stay (a muscle under or over its target is flagged, not moved).
 */
const MuscleFeedback = (() => {
  const DAY = 864e5;
  const MUSCLES = [
    ["chest", "Chest"], ["back", "Back"], ["traps", "Traps"], ["frontDelts", "Front delts"], ["sideDelts", "Side delts"],
    ["rearDelts", "Rear delts"], ["biceps", "Biceps"], ["triceps", "Triceps"], ["forearms", "Forearms"], ["quads", "Quads"],
    ["hamstrings", "Hamstrings"], ["glutes", "Glutes"], ["adductors", "Adductors"], ["abductors", "Abductors"], ["calves", "Calves"], ["abs", "Abs"]
  ];
  const ORDER = MUSCLES.map(m => m[0]);
  const LABEL = Object.fromEntries(MUSCLES);
  const MAJOR = ["chest", "back", "sideDelts", "rearDelts", "biceps", "triceps", "quads", "hamstrings", "glutes"];
  const KEYS = ["pump", "soreness", "workload"];
  const SCALE = {
    pump: { title: "Pump", words: ["Low", "Good", "Great"] },
    soreness: { title: "Soreness", words: ["None", "Gone in time", "Still sore"] },
    workload: { title: "Workload", words: ["Easy", "Hard", "Too much"] }
  };

  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const localToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const add = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lvl = v => { v = +v; return v >= 1 && v <= 3 ? Math.round(v) : null; };
  const defaultMusclesFor = () => (typeof window !== "undefined" && window.StrengthAnalytics && window.StrengthAnalytics.musclesFor) || (() => null);
  const docsOf = col => col ? (Array.isArray(col) ? col : Object.values(col)) : [];

  function hasSets(workout) {
    return !!(workout && workout.sets && Object.values(workout.sets).some(a => (a || []).some(x => x && (+x.w || +x.r))));
  }

  // Primary muscles with a logged set in this workout, in a stable body order.
  function musclesTrained(workout, musclesFor) {
    musclesFor = musclesFor || defaultMusclesFor();
    const out = new Set();
    if (workout && workout.sets) Object.entries(workout.sets).forEach(([name, arr]) => {
      if (!(arr || []).some(x => x && (+x.w || +x.r))) return;
      const m = musclesFor(name); if (!m || m.cardio || !m.primary) return;
      m.primary.forEach(id => { if (id in LABEL) out.add(id); });
    });
    return ORDER.filter(id => out.has(id));
  }

  function complete(fb) { return !!fb && KEYS.every(k => lvl(fb[k]) != null); }

  function sessionDelta(fb) {
    if (!complete(fb)) return { delta: null, reason: "Not rated" };
    const p = lvl(fb.pump), s = lvl(fb.soreness), w = lvl(fb.workload);
    if (s === 3 && w === 3) return { delta: -2, reason: "Still sore and too much work" };
    const pts = (2 - s) + (2 - p) + (2 - w);
    let d = pts >= 3 ? 2 : pts >= 1 ? 1 : pts >= -1 ? 0 : -1;
    if ((s === 3 || w === 3) && d > 0) d = 0;
    const reason = s === 3 ? "Still sore" : w === 3 ? "Workload too much" : d >= 2 ? "Fresh, little pump, easy" : d === 1 ? "Recovered with room to spare" : d === 0 ? "Right where it should be" : "Hard to recover from";
    return { delta: d, reason };
  }

  // Sets per muscle over the last 7 days, primary 1 / helper ½ (same count as StrengthAnalytics, workouts only).
  function countSets(workouts, from, to, musclesFor) {
    const sets = Object.fromEntries(ORDER.map(id => [id, 0]));
    docsOf(workouts).forEach(w => {
      if (!w || !isDate(w.date) || w.date < from || w.date > to || !w.sets) return;
      Object.entries(w.sets).forEach(([name, arr]) => {
        const n = (arr || []).filter(x => x && (+x.w || +x.r)).length; if (!n) return;
        const m = musclesFor(name); if (!m || m.cardio) return;
        (m.primary || []).forEach(id => { if (id in sets) sets[id] += n; });
        (m.secondary || []).forEach(id => { if (id in sets) sets[id] += n / 2; });
      });
    });
    return sets;
  }

  function weekSets(docs, from, to, opts) {
    if (opts.weekSets) return opts.weekSets;
    try {
      const a = typeof opts.analysis === "function" ? opts.analysis() : opts.analysis;
      if (a && Array.isArray(a.muscles)) return Object.fromEntries(a.muscles.map(m => [m.id, m.thisWeek || 0]));
    } catch (e) { /* fall through to our own count */ }
    return countSets(docs.workouts, from, to, opts.musclesFor);
  }

  function plan(docs, opts = {}) {
    docs = docs || {};
    const today = isDate(opts.today) ? opts.today : localToday();
    const o = Object.assign({}, opts, { musclesFor: opts.musclesFor || defaultMusclesFor() });
    const to = today, from = add(today, -6);
    const sets = weekSets(docs, from, to, o);
    const lo0 = (opts.volume && +opts.volume.lo) || 10, hi0 = (opts.volume && +opts.volume.hi) || 20;
    const targets = opts.setTargets || {};
    const fbs = Object.fromEntries(ORDER.map(id => [id, []]));
    docsOf(docs.workouts).forEach(w => {
      if (!w || !isDate(w.date) || w.date < from || w.date > to || !w.feedback) return;
      Object.entries(w.feedback).forEach(([id, fb]) => { if (id in fbs && complete(fb)) fbs[id].push(Object.assign({ date: w.date }, fb)); });
    });
    const rows = [];
    ORDER.forEach(id => {
      const s = +sets[id] || 0, list = fbs[id];
      if (!s && !list.length) return;
      const t = targets[id] && +targets[id].lo >= 0 && +targets[id].hi > 0 ? { lo: +targets[id].lo, hi: +targets[id].hi } : MAJOR.includes(id) ? { lo: lo0, hi: hi0 } : null;
      const ds = list.map(sessionDelta);
      const mean = ds.length ? ds.reduce((a, d) => a + d.delta, 0) / ds.length : 0;
      const delta = ds.length ? Math.round(mean) : null;
      const cur = Math.round(s);
      const raw = cur + (delta || 0);
      const next = Math.max(0, t && delta > 0 ? Math.min(raw, Math.max(t.hi, cur)) : t && delta < 0 ? Math.max(raw, Math.min(t.lo, cur)) : raw);
      const last = ds[ds.length - 1];
      let reason = !ds.length ? "No feedback yet" : ds.length === 1 ? last.reason : ds.map(d => d.reason).filter((r, i, a) => a.indexOf(r) === i).join(" / ");
      if (t && delta && next === cur) reason += delta > 0 ? " · already at the top of the target" : " · already at the bottom of the target";
      else if (t && cur < t.lo) reason += " · under target"; else if (t && cur > t.hi) reason += " · over target";
      rows.push({ id, label: LABEL[id], major: MAJOR.includes(id), sets: s, sessions: ds.length, delta, next, lo: t ? t.lo : null, hi: t ? t.hi : null, reason, last: list.length ? list[list.length - 1] : null });
    });
    return { from, to, rows, rated: rows.some(r => r.sessions) };
  }

  // ---- Train card: taps for today's muscles ----
  function cardHtml(workout, date, opts = {}) {
    if (!hasSets(workout)) return "";
    const ids = musclesTrained(workout, opts.musclesFor);
    if (!ids.length) return "";
    const fb = (workout && workout.feedback) || {};
    const done = ids.filter(id => complete(fb[id])).length;
    const row = id => {
      const f = fb[id] || {};
      return `<div class="mf-row${complete(f) ? " done" : ""}" data-mf-row="${id}"><div class="mf-name">${esc(LABEL[id])}</div>
        ${KEYS.map(k => `<div class="mf-scale"><span class="mf-k">${SCALE[k].title}</span>${[1, 2, 3].map(v =>
          `<button type="button" class="mf-tap${lvl(f[k]) === v ? " on" : ""}" data-mf="${k}" data-muscle="${id}" data-v="${v}" data-date="${esc(date)}" title="${esc(SCALE[k].words[v - 1])}" aria-label="${esc(SCALE[k].title + ": " + SCALE[k].words[v - 1])}" aria-pressed="${lvl(f[k]) === v}">${v}</button>`).join("")}</div>`).join("")}
      </div>`;
    };
    return `<div class="card mf-card" data-mf-card="${esc(date)}"><h3>How did it feel? <small class="muted">${done}/${ids.length} rated</small></h3>
      <p class="muted mf-legend">After a muscle's last set: pump 1 low · 3 great, soreness 1 none · 3 still sore, workload 1 easy · 3 too much. Next week's sets follow from this.</p>
      ${ids.map(row).join("")}</div>`;
  }

  function arrow(d) { return d == null ? "·" : d > 0 ? "▲" : d < 0 ? "▼" : "="; }
  function fmtSets(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }

  // ---- Progress card: next week's sets ----
  function planHtml(docs, opts = {}) {
    const p = plan(docs, opts);
    const body = !p.rows.length
      ? `<p class="muted mf-empty">Log some sets, then tap how each muscle felt on the Train tab. Next week's sets per muscle appear here.</p>`
      : `<div class="tablewrap"><table class="mf-table"><thead><tr><th>Muscle</th><th class="n">This week</th><th class="n">Next week</th><th>Why</th></tr></thead><tbody>
        ${p.rows.map(r => `<tr class="${r.delta > 0 ? "up" : r.delta < 0 ? "down" : r.delta === 0 ? "hold" : "none"}"><td>${esc(r.label)}</td><td class="n">${fmtSets(r.sets)}</td>
          <td class="n"><b>${r.next}</b> <span class="mf-arrow">${arrow(r.delta)}</span>${r.lo != null ? `<small class="muted"> ${r.lo}–${r.hi}</small>` : ""}</td>
          <td class="mf-why">${esc(r.reason)}${r.sessions > 1 ? ` <small class="muted">(${r.sessions} sessions)</small>` : ""}</td></tr>`).join("")}
        </tbody></table></div>
        ${p.rated ? "" : `<p class="muted mf-empty">No feedback this week yet, so every muscle stays. Rate pump, soreness and workload on the Train tab after training.</p>`}`;
    return `<div class="card mf-plan"><h3>Next week's sets <small class="muted">from how each muscle felt</small></h3>${body}</div>`;
  }

  // ---- click handler: el inside [data-mf] ----
  function handle(el, docs, date) {
    const b = el && el.closest ? el.closest("[data-mf]") : null;
    if (!b) return null;
    const k = b.dataset.mf, id = b.dataset.muscle, v = lvl(b.dataset.v), d = isDate(b.dataset.date) ? b.dataset.date : date;
    if (!KEYS.includes(k) || !(id in LABEL) || v == null || !isDate(d)) return null;
    const cur = (docs && docs.workouts && docs.workouts[d]) || {};
    const doc = JSON.parse(JSON.stringify(Object.assign({ date: d }, cur)));
    doc.feedback = Object.assign({}, doc.feedback);
    const f = Object.assign({}, doc.feedback[id]);
    if (f[k] === v) delete f[k]; else f[k] = v;   // tapping the same level again clears it
    f.at = Date.now();
    if (KEYS.some(x => f[x] != null)) doc.feedback[id] = f; else delete doc.feedback[id];
    if (!Object.keys(doc.feedback).length) delete doc.feedback;
    return { collection: "workouts", id: d, doc };
  }

  function summary(docs, opts = {}) {
    const p = plan(docs, opts);
    if (!p.rows.length) return "Muscle feedback: nothing logged this week.";
    const moved = p.rows.filter(r => r.delta);
    const lines = p.rows.map(r => `${r.label}: ${fmtSets(r.sets)} → ${r.next}${r.lo != null ? ` (target ${r.lo}–${r.hi})` : ""}${r.sessions ? ` — ${r.reason}` : ""}`);
    return `Next week's sets per muscle (${p.from} to ${p.to}, ${moved.length} change${moved.length === 1 ? "" : "s"}):\n` + lines.join("\n");
  }

  const css = [
    ".mf-card h3 small,.mf-plan h3 small{font-weight:400;font-size:.8em;margin-left:6px}",
    ".mf-legend{margin:0 0 8px;font-size:12px}",
    ".mf-row{display:grid;grid-template-columns:minmax(72px,1fr) repeat(3,auto);gap:6px 10px;align-items:center;padding:8px 0;border-top:1px solid var(--line,rgba(127,127,127,.25))}",
    ".mf-row.done .mf-name::after{content:' ✓';color:var(--good,#2a9d5c)}",
    ".mf-name{font-weight:600}",
    ".mf-scale{display:flex;align-items:center;gap:3px}",
    ".mf-k{font-size:11px;color:var(--muted,#888);margin-right:4px;min-width:3.6em}",
    ".mf-tap{min-width:30px;height:30px;padding:0 6px;border-radius:8px;border:1px solid var(--line,rgba(127,127,127,.35));background:var(--surface-2,transparent);color:inherit;font:inherit;font-size:13px;cursor:pointer}",
    ".mf-tap.on{background:var(--accent,#3b82f6);color:var(--on-accent,#fff);border-color:var(--accent,#3b82f6)}",
    "@media (max-width:420px){.mf-row{grid-template-columns:1fr 1fr}.mf-name{grid-column:1/-1}}",
    ".mf-table td.mf-why{font-size:12px;color:var(--muted,#888);max-width:46vw}",
    ".mf-table tr.up .mf-arrow{color:var(--good,#2a9d5c)}.mf-table tr.down .mf-arrow{color:var(--warn,#d97706)}.mf-table tr.hold .mf-arrow,.mf-table tr.none .mf-arrow{color:var(--muted,#888)}",
    ".mf-empty{margin:6px 0 0}"
  ].join("\n");

  return { css, musclesTrained, sessionDelta, plan, cardHtml, planHtml, handle, summary, SCALE, MUSCLES: ORDER.slice() };
})();
if (typeof window !== "undefined") window.MuscleFeedback = MuscleFeedback;
if (typeof module !== "undefined" && module.exports) module.exports = MuscleFeedback;
