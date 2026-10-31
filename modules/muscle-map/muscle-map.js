/* Muscle recovery map for the fitness app (Train tab, above the session).
 * A front/back body diagram coloured by how recovered each muscle is, built from the sets logged per
 * muscle and the hours since. Plain JS, no imports, no network. Global `MuscleMap`.
 * Reads:
 *   lb_workouts/{id}   full logger sessions {start, end (ms), exercises:[{exId, sets:[{t, r, done}]}]}, read first
 *   lb_exercises/{id}  custom exercise names (optional)
 *   workouts/{date}    {session, sets:{"<exercise>":[{w, r}]}}; used only for dates the logger has no session
 *   days/{date}.readiness.soreness (1-5, 5 = not sore; RecoveryFatigue) stretches today's recovery windows
 * Exercise → muscles comes from StrengthAnalytics.musclesFor (same mapping as the Strength card); pass
 * opts.musclesFor to override, opts.muscles for per-exercise overrides ({name: {primary, secondary}}).
 * API:
 *   MuscleMap.css                      -> string, inject once
 *   MuscleMap.analyze(docs, opts)      -> {now, muscles:[{id, label, region, pct, status, sets, hoursSince, lastDate, readyInH}], next, soreness, notes}
 *   MuscleMap.html(docs, opts)         -> HTML string: one card (diagram + list + next-session verdict)
 *   MuscleMap.summary(docs, opts)      -> plain text for the coach / a chat
 *   MuscleMap.svg(analysis)            -> the diagram alone
 * opts (all optional):
 *   now          ms, default Date.now(); today "YYYY-MM-DD" (defaults from now, local)
 *   nextSession  {name, exercises:[names]} the session Aziz is about to do → verdict per muscle
 *   names        {logger exId: name}; library {exId: {name}} (logger exercise library)
 *   musclesFor   (name) => {primary, secondary, cardio?} | null; muscles {name: {primary, secondary}}
 *   windows      {large, small} base recovery hours, default 48 / 36; fullSets default 8
 * Model (see README): a session loads a muscle with dose = min(1, hardSets / 8) (helper muscles count ½ a set),
 * that fades linearly over window = base × (0.6 + hardSets / 10) hours (base 48 h for big muscles, 36 h for
 * small ones), capped at 1.6 × base. Doses from different sessions add up. Recovered % = 100 × (1 − fatigue).
 */
const MuscleMap = (() => {
  const H = 36e5, DAY = 864e5, WINDOW_DAYS = 7, FULL_SETS = 8;
  const LARGE = new Set(["chest", "back", "quads", "hamstrings", "glutes"]);
  const FALLBACK_MUSCLES = [
    ["chest", "Chest", "upper"], ["back", "Back", "upper"], ["traps", "Traps", "upper"],
    ["frontDelts", "Front delts", "upper"], ["sideDelts", "Side delts", "upper"], ["rearDelts", "Rear delts", "upper"],
    ["biceps", "Biceps", "upper"], ["triceps", "Triceps", "upper"], ["forearms", "Forearms", "upper"],
    ["quads", "Quads", "lower"], ["hamstrings", "Hamstrings", "lower"], ["glutes", "Glutes", "lower"],
    ["adductors", "Adductors", "lower"], ["abductors", "Abductors", "lower"], ["calves", "Calves", "lower"],
    ["abs", "Abs", "core"]
  ].map(([id, label, region]) => ({ id, label, region }));
  const STATUS = [[80, "ready", "Ready"], [50, "recovering", "Recovering"], [0, "fatigued", "Still fatigued"]];

  const num = v => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const localIso = t => { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const atHour = (s, h) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, h).getTime(); };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const keyOf = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const unslug = id => String(id).split("-").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
  const asList = c => Array.isArray(c) ? c : Object.values(c || {});
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hrs = h => h < 1 ? "<1 h" : h < 48 ? Math.round(h) + " h" : (Math.round(h / 24 * 10) / 10).toString().replace(/\.0$/, "") + " d";

  const SA = () => (typeof window !== "undefined" && window.StrengthAnalytics) || (typeof StrengthAnalytics !== "undefined" ? StrengthAnalytics : null);
  function mapper(opts) {
    const sa = SA();
    const base = opts.musclesFor || (sa && sa.musclesFor) || (() => null);
    const over = opts.muscles || {};
    return name => {
      const o = over[name] || over[keyOf(name)];
      if (o) return { primary: o.primary || [], secondary: o.secondary || [] };
      return base(name, opts.musclesFor ? undefined : over) || null;
    };
  }
  function muscleList(opts) {
    const sa = SA();
    return opts.muscleList || (sa && sa.MUSCLES) || FALLBACK_MUSCLES;
  }

  function lbName(e, opts, lbEx) {
    const id = e.exId;
    if (opts.names && opts.names[id]) return opts.names[id];
    const lib = opts.library && (opts.library[id] || (Array.isArray(opts.library) && opts.library.find(x => x.id === id)));
    if (lib && lib.name) return lib.name;
    const c = lbEx[id];
    return c && c.name ? c.name : unslug(id);
  }

  // Sessions in the last WINDOW_DAYS: [{at (ms), date, sets:{muscleId: hardSets}, names:[exercise]}]
  function sessions(docs, opts) {
    const now = opts.now, from = now - WINDOW_DAYS * DAY, to = mapper(opts), out = [], lbDates = new Set();
    const lbEx = Object.fromEntries(asList(docs.lb_exercises).filter(x => x && x.id).map(x => [x.id, x]));
    const addSets = (sess, name, n) => {
      const m = to(name);
      if (!m || m.cardio) { if (!m) sess.unknown.push(name); return; }
      m.primary.forEach(id => { sess.sets[id] = (sess.sets[id] || 0) + n; });
      (m.secondary || []).forEach(id => { sess.sets[id] = (sess.sets[id] || 0) + n / 2; });
    };
    asList(docs.lb_workouts).forEach(w => {
      if (!w || !(w.start > 0) || !Array.isArray(w.exercises)) return;
      const at = w.end > 0 ? w.end : w.start;
      const date = localIso(w.start);
      if (at <= now) lbDates.add(date);
      if (at < from || at > now) return;
      const sess = { at, date, name: w.templateName || w.name || "", sets: {}, unknown: [] };
      w.exercises.forEach(e => {
        if (!e || !e.exId || !Array.isArray(e.sets)) return;
        const n = e.sets.filter(s => s && s.t !== "w" && s.done !== false && num(s.r) > 0).length;
        if (n) addSets(sess, lbName(e, opts, lbEx), n);
      });
      if (Object.keys(sess.sets).length) out.push(sess);
    });
    Object.entries(docs.workouts || {}).forEach(([k, w]) => {
      const date = isDate(w && w.date) ? w.date : k;
      if (!isDate(date) || lbDates.has(date) || !w || !w.sets || typeof w.sets !== "object") return;
      const at = atHour(date, 18); // Quick log has no clock time: assume an evening session
      if (at < from || at > now) return;
      const sess = { at, date, name: w.session || "", sets: {}, unknown: [] };
      Object.entries(w.sets).forEach(([name, sets]) => {
        if (!Array.isArray(sets)) return;
        const n = sets.filter(s => s && num(s.r) > 0).length;
        if (n) addSets(sess, name, n);
      });
      if (Object.keys(sess.sets).length) out.push(sess);
    });
    return out.sort((a, b) => a.at - b.at);
  }

  const baseHours = (id, opts) => ((opts.windows || {})[LARGE.has(id) ? "large" : "small"]) || (LARGE.has(id) ? 48 : 36);
  const windowFor = (id, sets, opts) => clamp(baseHours(id, opts) * (0.6 + sets / 10), baseHours(id, opts) * 0.6, baseHours(id, opts) * 1.6);
  const fullSets = opts => num(opts.fullSets) || FULL_SETS;

  // Fatigue (0..1) on one muscle at time t, from the sessions that hit it.
  function fatigueAt(loads, t, stretch) {
    let f = 0;
    loads.forEach(L => {
      const h = (t - L.at) / H;
      if (h < 0) return;
      const w = L.window * stretch;
      if (h < w) f += L.dose * (1 - h / w);
    });
    return Math.min(1, f);
  }
  const statusOf = pct => STATUS.find(([min]) => pct >= min);

  function analyze(docs, opts = {}) {
    docs = docs || {};
    const now = num(opts.now) || Date.now();
    const today = isDate(opts.today) ? opts.today : localIso(now);
    const o = Object.assign({}, opts, { now, today });
    const list = muscleList(o), sess = sessions(docs, o);
    const day = (docs.days || {})[today];
    const sore = num(day && day.readiness && day.readiness.soreness);
    const stretch = sore === 1 ? 1.25 : sore === 2 ? 1.1 : 1;
    const notes = [];
    const muscles = list.map(m => {
      const loads = sess.filter(s => s.sets[m.id] > 0).map(s => ({ at: s.at, date: s.date, sets: s.sets[m.id], dose: Math.min(1, s.sets[m.id] / fullSets(o)), window: windowFor(m.id, s.sets[m.id], o) }));
      const f = fatigueAt(loads, now, stretch);
      const pct = Math.round(100 * (1 - f));
      const last = loads[loads.length - 1] || null;
      let readyInH = 0;
      if (pct < 80) { for (let h = 1; h <= 24 * WINDOW_DAYS; h++) if (100 * (1 - fatigueAt(loads, now + h * H, stretch)) >= 80) { readyInH = h; break; } }
      const [, status, statusLabel] = statusOf(pct);
      return {
        id: m.id, label: m.label, region: m.region, pct, status: last ? status : "fresh", statusLabel: last ? statusLabel : "Fresh",
        sets: loads.reduce((a, L) => a + L.sets, 0), lastSets: last ? last.sets : 0,
        hoursSince: last ? (now - last.at) / H : null, lastDate: last ? last.date : null, readyInH
      };
    });
    const unknown = [...new Set(sess.flatMap(s => s.unknown))];
    if (unknown.length) notes.push("Not mapped to a muscle: " + unknown.join(", ") + ".");
    if (stretch > 1) notes.push("You logged soreness " + sore + "/5 today, so recovery windows are stretched " + Math.round((stretch - 1) * 100) + "%.");
    if (!sess.length) notes.push("No sets logged in the last 7 days, so everything shows as fresh.");

    let next = null;
    if (opts.nextSession && Array.isArray(opts.nextSession.exercises) && opts.nextSession.exercises.length) {
      const to = mapper(o), hit = new Map();
      opts.nextSession.exercises.forEach(n => { const m = to(n); if (!m || m.cardio) return; m.primary.forEach(id => hit.set(id, "primary")); (m.secondary || []).forEach(id => { if (!hit.has(id)) hit.set(id, "secondary"); }); });
      const rows = [...hit].map(([id, role]) => { const m = muscles.find(x => x.id === id); return m ? { id, label: m.label, pct: m.pct, role, readyInH: m.readyInH } : null; }).filter(Boolean).sort((a, b) => a.pct - b.pct);
      const prim = rows.filter(r => r.role === "primary"), low = (prim.length ? prim : rows).filter(r => r.pct < 80);
      const worst = (prim.length ? prim : rows)[0];
      let verdict, note;
      if (!rows.length) { verdict = "unknown"; note = "No muscles recognised in this session."; }
      else if (!worst || worst.pct >= 80) { verdict = "go"; note = "Everything this session hits is recovered."; }
      else if (worst.pct >= 50) { verdict = "ok"; note = low.map(r => r.label + " " + r.pct + "%").join(", ") + " still recovering: train, but don't chase PRs there."; }
      else { verdict = "wait"; note = low.map(r => r.label + " " + r.pct + "%").join(", ") + " still fatigued. Swap the sorest lifts, go lighter, or rest a day" + (worst.readyInH ? " (ready in about " + hrs(worst.readyInH) + ")" : "") + "."; }
      next = { name: opts.nextSession.name || "", muscles: rows, verdict, note };
    }
    const fresh = muscles.filter(m => m.pct >= 80).map(m => m.label);
    return { now, today, muscles, sessions: sess.length, next, soreness: sore, stretch, notes, fresh };
  }

  // ---------- diagram ----------
  const RGB = { bad: [200, 53, 46], warn: [184, 110, 0], good: [30, 138, 76] };
  function colour(pct) {
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const c = pct <= 50 ? mix(RGB.bad, RGB.warn, pct / 50) : mix(RGB.warn, RGB.good, (pct - 50) / 50);
    return "rgb(" + c.join(",") + ")";
  }
  // Shapes per view. Coordinates in a 100 × 220 box; each shape is mirrored where `mirror` is set.
  const FRONT = [
    ["chest", "M34 52 Q50 48 66 52 L64 68 Q50 74 36 68 Z"],
    ["frontDelts", "M26 50 Q33 44 36 52 L34 64 Q28 62 26 50 Z", 1],
    ["sideDelts", "M20 54 Q24 46 28 50 L26 64 Q20 62 20 54 Z", 1],
    ["biceps", "M22 66 Q29 64 33 68 L31 86 Q26 88 22 84 Z", 1],
    ["forearms", "M20 88 Q26 86 30 90 L26 114 Q22 116 18 112 Z", 1],
    ["abs", "M41 72 L59 72 L58 104 Q50 108 42 104 Z"],
    ["abductors", "M33 100 Q38 104 40 112 L36 124 Q32 118 33 100 Z", 1],
    ["adductors", "M44 110 Q48 108 50 112 L48 136 Q44 136 42 128 Z", 1],
    ["quads", "M34 114 Q41 110 47 114 L46 158 Q40 162 36 158 Z", 1],
    ["calves", "M35 166 Q41 164 46 168 L44 198 Q40 200 36 196 Z", 1]
  ];
  const BACK = [
    ["traps", "M38 42 Q50 36 62 42 L60 56 Q50 60 40 56 Z"],
    ["rearDelts", "M22 50 Q28 44 34 50 L32 64 Q26 64 22 56 Z", 1],
    ["back", "M36 58 Q50 54 64 58 L62 98 Q50 104 38 98 Z"],
    ["triceps", "M22 66 Q29 64 33 68 L31 86 Q26 88 22 84 Z", 1],
    ["forearms", "M20 88 Q26 86 30 90 L26 114 Q22 116 18 112 Z", 1],
    ["glutes", "M36 102 Q50 98 64 102 L62 126 Q50 132 38 126 Z"],
    ["hamstrings", "M35 128 Q41 124 47 128 L46 164 Q40 168 36 164 Z", 1],
    ["calves", "M35 168 Q41 166 46 170 L44 200 Q40 202 36 198 Z", 1]
  ];
  const OUTLINE = "M50 8 a10 11 0 1 0 0.1 0 M44 30 L56 30 L68 44 L82 54 L84 90 L80 118 L72 116 L70 90 L66 70 L66 110 L60 160 L62 212 L50 212 L50 162 L50 212 L38 212 L40 160 L34 110 L34 70 L30 90 L28 116 L20 118 L16 90 L18 54 L32 44 Z";
  const mirrorPath = d => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => (100 - Number(x)) + " " + y);

  function figure(shapes, byId, title) {
    const parts = shapes.map(([id, d, mirror]) => {
      const m = byId[id], c = m ? colour(m.pct) : "var(--line)";
      const t = m ? m.label + ": " + m.pct + "% recovered" : id;
      const p = x => '<path d="' + x + '" fill="' + c + '" data-mm="' + id + '"><title>' + esc(t) + "</title></path>";
      return p(d) + (mirror ? p(mirrorPath(d)) : "");
    }).join("");
    return '<svg viewBox="0 0 100 222" class="mm-fig" role="img" aria-label="' + esc(title) + '"><path d="' + OUTLINE + '" class="mm-outline"/>' + parts + '<text x="50" y="220" class="mm-cap">' + esc(title) + "</text></svg>";
  }
  function svg(A) {
    const byId = Object.fromEntries(A.muscles.map(m => [m.id, m]));
    return '<div class="mm-figs">' + figure(FRONT, byId, "Front") + figure(BACK, byId, "Back") + "</div>";
  }

  const css = `
.mm-card .mm-figs{display:flex;gap:12px;justify-content:center;margin:6px 0 4px}
.mm-fig{width:46%;max-width:170px;height:auto}
.mm-outline{fill:color-mix(in srgb,var(--text,#222) 7%,transparent);stroke:var(--line,#ccc);stroke-width:1}
.mm-fig path[data-mm]{stroke:var(--surface,#fff);stroke-width:.6;opacity:.92}
.mm-cap{font-size:9px;fill:var(--muted,#777);text-anchor:middle}
.mm-legend{display:flex;gap:10px;justify-content:center;font-size:12px;color:var(--muted,#777);flex-wrap:wrap}
.mm-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.mm-next{border-radius:10px;padding:8px 10px;margin:8px 0;background:var(--accent-soft,#eef)}
.mm-next.mm-go{background:color-mix(in srgb,var(--good,#1E8A4C) 14%,var(--surface,#fff))}
.mm-next.mm-ok{background:color-mix(in srgb,var(--warn,#B86E00) 14%,var(--surface,#fff))}
.mm-next.mm-wait{background:color-mix(in srgb,var(--bad,#C8352E) 14%,var(--surface,#fff))}
.mm-list{display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;font-size:13px;margin:6px 0}
.mm-row{display:flex;align-items:center;gap:6px}
.mm-row .mm-bar{flex:1;height:6px;border-radius:3px;background:var(--line,#ddd);overflow:hidden}
.mm-row .mm-bar b{display:block;height:100%}
.mm-row .mm-pct{width:36px;text-align:right;font-variant-numeric:tabular-nums}
.mm-row .mm-ago{color:var(--muted,#777);font-size:11px;width:54px;text-align:right;white-space:nowrap}
@media (max-width:360px){.mm-list{grid-template-columns:1fr}}
`;

  function html(docs, opts = {}) {
    const A = analyze(docs, opts);
    const trained = A.muscles.filter(m => m.lastDate).sort((a, b) => a.pct - b.pct);
    let out = '<section class="card mm-card"><h3>Muscle recovery</h3>';
    if (A.next) {
      const cls = { go: "mm-go", ok: "mm-ok", wait: "mm-wait" }[A.next.verdict] || "";
      const head = { go: "Good to go", ok: "Train, hold steady", wait: "Still recovering" }[A.next.verdict] || "Next session";
      out += '<div class="mm-next ' + cls + '"><b>' + esc(head) + (A.next.name ? " · " + esc(A.next.name) : "") + "</b><br>" + esc(A.next.note) + "</div>";
    }
    out += svg(A);
    out += '<div class="mm-legend"><span><i style="background:' + colour(100) + '"></i>Ready ≥80%</span><span><i style="background:' + colour(65) + '"></i>Recovering</span><span><i style="background:' + colour(20) + '"></i>Fatigued &lt;50%</span></div>';
    if (trained.length) {
      out += '<div class="mm-list">' + trained.map(m => '<div class="mm-row"><span>' + esc(m.label) + '</span><span class="mm-bar"><b style="width:' + m.pct + "%;background:" + colour(m.pct) + '"></b></span><span class="mm-pct">' + m.pct + '%</span><span class="mm-ago">' + hrs(m.hoursSince) + " ago</span></div>").join("") + "</div>";
    }
    if (A.notes.length) out += '<p class="muted small">' + A.notes.map(esc).join(" ") + "</p>";
    out += '<p class="muted small">Recovered % = how much of the fatigue from the last 7 days of logged sets has faded: a full session (8+ hard sets) on a big muscle takes about 2–3 days, a small muscle about 1½–2 days; helper muscles count half a set.</p></section>';
    return out;
  }

  function summary(docs, opts = {}) {
    const A = analyze(docs, opts);
    const trained = A.muscles.filter(m => m.lastDate).sort((a, b) => a.pct - b.pct);
    const lines = ["Muscle recovery (" + A.today + "):"];
    if (!trained.length) lines.push("Nothing logged in the last 7 days; all muscles fresh.");
    else lines.push(trained.map(m => m.label + " " + m.pct + "% (" + hrs(m.hoursSince) + " ago)").join(", ") + ".");
    if (A.next) lines.push("Next session " + (A.next.name ? A.next.name + ": " : "") + A.next.note);
    return lines.join("\n");
  }

  return { css, analyze, html, svg, summary, colour, FULL_SETS, WINDOW_DAYS };
})();
if (typeof window !== "undefined") window.MuscleMap = MuscleMap;
if (typeof module !== "undefined" && module.exports) module.exports = MuscleMap;
