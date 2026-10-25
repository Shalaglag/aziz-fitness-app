/* Strength & muscle analytics for the fitness app (Progress tab).
 * Plain JS, no imports, no network. Reads the app's own collections:
 *   docs = { lb_workouts: [logger workout docs] or {id: doc}, lb_exercises (optional, custom names),
 *            workouts: {date: {date, session, sets:{"<exercise>":[{w, r, unit?}]}}}, weights: {date: {kg}} }
 *   lb_workouts is read first (warm-ups and unchecked sets dropped, lb converted to kg). workouts/{date}
 *   adds the rest: Quick log, Strong imports and days before the logger. On a day both have, a lift
 *   the logger has is taken from the logger only, so merged sets are never counted twice.
 * API:
 *   StrengthAnalytics.css                        -> string, inject once (uses the app's tokens)
 *   StrengthAnalytics.analyze(docs, opts)        -> numbers (see analyze() below)
 *   StrengthAnalytics.html(docs, opts)           -> HTML string: one card for the Progress tab
 *   StrengthAnalytics.summary(docs, opts)        -> plain text to paste into a chat / feed the coach
 *   StrengthAnalytics.unitsFrom(PROGRAM)         -> {name: "kg"|"lb"} from the app's PROGRAM tuples
 *   StrengthAnalytics.musclesFor(name)           -> {primary:[ids], secondary:[ids]} or null
 *   StrengthAnalytics.e1rm(kg, reps)             -> Epley estimate (null outside 1–20 reps)
 * opts (all optional):
 *   today        "YYYY-MM-DD", default the device's local date
 *   cutStart     "YYYY-MM-DD", the day the cut began; else targets.start
 *   targets      AppTargets.resolve(...) object; only .start is used here
 *   units        {exercise name: "kg"|"lb"} for sets saved without a unit (Quick log)
 *   mainLifts    [exercise names] listed first in the lift picker and used for the cut check
 *   names        {logger exId: name} on top of the logger's plan names; library {exId: {name}} for the rest
 *   muscles      {exercise name: {primary:[ids], secondary:[ids]}} overrides for unknown lifts
 *   volume       {lo, hi} weekly hard sets per major muscle, default 10–20
 *   weeks        how many 7-day windows to show, default 8
 * The lift picker (<select data-sa-lift>) re-draws its own chart; nothing for the host to wire.
 */
const StrengthAnalytics = (() => {
  const DAY = 864e5, LB = 0.45359237;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // [id, label, region]; push/pull sides are set in BALANCE below.
  const MUSCLES = [
    ["chest", "Chest", "upper"], ["back", "Back", "upper"], ["traps", "Traps", "upper"],
    ["frontDelts", "Front delts", "upper"], ["sideDelts", "Side delts", "upper"], ["rearDelts", "Rear delts", "upper"],
    ["biceps", "Biceps", "upper"], ["triceps", "Triceps", "upper"], ["forearms", "Forearms", "upper"],
    ["quads", "Quads", "lower"], ["hamstrings", "Hamstrings", "lower"], ["glutes", "Glutes", "lower"],
    ["adductors", "Adductors", "lower"], ["abductors", "Abductors", "lower"], ["calves", "Calves", "lower"],
    ["abs", "Abs", "core"]
  ].map(([id, label, region]) => ({ id, label, region }));
  const LABEL = Object.fromEntries(MUSCLES.map(m => [m.id, m.label]));
  // Muscles the weekly volume range applies to. Small or heavily indirect ones are shown without a verdict.
  const MAJOR = ["chest", "back", "sideDelts", "rearDelts", "biceps", "triceps", "quads", "hamstrings", "glutes"];

  // Name rules, first match wins. [pattern, primary, secondary]; primary null = cardio (not counted).
  const RULES = [
    [/treadmill|bike|cycling|elliptical|rowing machine|rower|stair|\brun\b|walk(?!ing lunge)|cardio|jump rope/, null],
    [/calf|calves/, ["calves"]],
    [/leg curl|hamstring curl|nordic|glute[- ]ham/, ["hamstrings"]],
    [/hip thrust|glute|pull[- ]through|reverse hyper|back extension|hyperextension/, ["glutes"], ["hamstrings"]],
    [/close[- ]grip bench/, ["triceps"], ["chest", "frontDelts"]],
    [/tricep|pushdown|skull|french press|kickback/, ["triceps"]],
    [/reverse fly|rear delt|face pull|reverse pec/, ["rearDelts"], ["traps"]],
    [/upright row/, ["sideDelts"], ["traps"]],
    [/shrug|trap/, ["traps"]],
    [/\brows?\b|t-bar/, ["back"], ["rearDelts", "biceps"]],
    [/lateral raise|side delt|lateral/, ["sideDelts"]],
    [/front raise/, ["frontDelts"]],
    [/overhead press|shoulder press|military|arnold|\bohp\b/, ["frontDelts"], ["sideDelts", "triceps"]],
    [/bench|chest press|chest machine|gundam|incline.*press|decline.*press|db press|dumbbell press|push ?up|chest dip/, ["chest"], ["frontDelts", "triceps"]],
    [/fly|crossover|pec deck|cable cross/, ["chest"]],
    [/pulldown|pull[- ]?up|chin[- ]?up|pullover|straight[- ]arm/, ["back"], ["biceps"]],
    [/wrist curl|reverse curl|forearm|farmer/, ["forearms"]],
    [/curl|bicep/, ["biceps"], ["forearms"]],
    [/romanian|\brdl\b|stiff[- ]leg|good morning/, ["hamstrings"], ["glutes"]],
    [/deadlift/, ["glutes"], ["hamstrings", "back"]],
    [/abductor/, ["abductors"]],
    [/adductor/, ["adductors"]],
    [/leg extension/, ["quads"]],
    [/squat|leg press|lunge|step[- ]up|hack/, ["quads"], ["glutes"]],
    [/\babs\b|crunch|leg raise|plank|ab wheel|rollout|russian twist|sit[- ]?up|\bcore\b/, ["abs"]]
  ];

  // [id, label, side A muscles, side B muscles, flag lean?]
  const BALANCE = [
    ["pushPull", "Push vs pull", ["chest", "frontDelts", "triceps"], ["back", "rearDelts", "biceps"], true],
    ["quadHam", "Quads vs hamstrings", ["quads"], ["hamstrings"], true],
    ["delts", "Front vs rear delts", ["frontDelts"], ["rearDelts"], true],
    ["upperLower", "Upper vs lower body", ["chest", "back", "traps", "frontDelts", "sideDelts", "rearDelts", "biceps", "triceps", "forearms"], ["quads", "hamstrings", "glutes", "adductors", "abductors", "calves"], false]
  ];
  const SIDE_NAMES = { pushPull: ["push", "pull"], quadHam: ["quads", "hamstrings"], delts: ["front delts", "rear delts"], upperLower: ["upper", "lower"] };

  const ms = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => iso(ms(s) + n * DAY);
  const diff = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const short = s => { const d = new Date(ms(s)); return MON[d.getUTCMonth()] + " " + d.getUTCDate(); };
  const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const num = v => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const r1 = n => Math.round(n * 10) / 10;
  const f1 = n => r1(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const fint = n => Math.round(n).toLocaleString("en-US");
  const sgn = (n, d = 1) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n).toFixed(d);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // "Bench Press (Barbell)", "bench press barbell" and the logger's "bench-press-barbell" share one key.
  const keyOf = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  // Epley. Reps above ~12 make any 1RM formula rough, so the card marks those; above 20 it says nothing.
  const e1rm = (kg, r) => (!(kg > 0) || !(r >= 1) || r > 20) ? null : r === 1 ? kg : kg * (1 + r / 30);

  function musclesFor(name, overrides) {
    if (overrides) { const o = overrides[name] || overrides[keyOf(name)]; if (o) return { primary: o.primary || [], secondary: o.secondary || [] }; }
    const n = keyOf(name);
    for (const [re, p, s] of RULES) if (re.test(n)) return p ? { primary: p, secondary: s || [] } : { cardio: true, primary: [], secondary: [] };
    return null;
  }

  function unitsFrom(program) {
    const out = {};
    Object.values(program || {}).forEach(list => (list || []).forEach(e => { if (Array.isArray(e) && e[0] && (e[4] === "lb" || e[4] === "kg")) out[e[0]] = e[4]; }));
    return out;
  }

  function weighIns(weights) {
    return Object.entries(weights || {})
      .map(([k, w]) => ({ date: isDate(w && w.date) ? w.date : k, kg: num(w && w.kg) }))
      .filter(w => isDate(w.date) && w.kg != null && w.kg > 20 && w.kg < 400)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  // Average of weigh-ins within ±3 days, else the nearest one within 7 days.
  function bodyAt(ws, date) {
    const near = ws.filter(w => Math.abs(diff(w.date, date)) <= 3);
    if (near.length) return near.reduce((a, w) => a + w.kg, 0) / near.length;
    let best = null;
    ws.forEach(w => { const d = Math.abs(diff(w.date, date)); if (d <= 7 && (!best || d < best.d)) best = { d, kg: w.kg }; });
    return best ? best.kg : null;
  }

  // Names the full logger writes into workouts/{date} for plan lifts (its SHELL_NAMES), so a lift logged
  // in the logger and in Quick log stays one series. opts.names adds or overrides {exId: name}.
  const LOGGER_NAMES = {
    "incline-bench-press-dumbbell": "Incline DB Press", "triceps-pushdown-straight-bar": "Triceps Pushdown (Straight bar)",
    "standing-lateral-raise-machine": "Standing Side Delts (Machine)", "lat-pulldown-wide-grip-cable": "Lat Pulldown, Wide",
    "lat-pulldown-single-arm-cable": "Lat Pulldown, Single Arm", "bicep-curl-dumbbell": "DB Curl", "seated-bicep-curl-machine": "Seated Bicep Curl",
    "leg-extension-machine": "Leg Extension", "hack-squat-machine": "Hack Squat", "squat-smith-machine": "Smith Squat",
    "lying-leg-curl-machine": "Lying Leg Curl", "hip-adductor-machine": "Hip Adductor", "standing-calf-raise-machine": "Standing Calf Raise",
    "seated-abs-machine": "Seated Abs", "gundam-chest-press-machine": "Gundam (Chest Machine)", "seated-overhead-press-dumbbell": "Seated DB Overhead Press",
    "lateral-raise-dumbbell": "Side Delts", "front-raise-dumbbell": "Front Raise (DB)", "triceps-rope-pushdown-cable": "Triceps Rope",
    "iso-lateral-low-row-plate-loaded": "Iso-Lateral Low Row", "shrug-machine": "Traps Machine", "standing-bicep-curl-cable": "Cable Standing Biceps",
    "hip-abductor-machine": "Hip Abductor", "calf-press-leg-press": "Calf Press on Seated Leg Press"
  };
  const unslug = id => String(id).split("-").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
  function lbName(e, opts) {
    const id = e.exId;
    if (opts.names && opts.names[id]) return opts.names[id];
    if (LOGGER_NAMES[id]) return LOGGER_NAMES[id];
    const lib = opts.library && (opts.library[id] || (Array.isArray(opts.library) && opts.library.find(x => x.id === id)));
    if (lib && lib.name) return lib.name;
    const custom = opts.lbExercises && opts.lbExercises[id];
    return custom && custom.name ? custom.name : unslug(id);
  }
  const lbDate = w => { const d = new Date(w.start); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const asList = c => Array.isArray(c) ? c : Object.values(c || {});

  // One row per (date, exercise) with sets in kg. The full logger's lb_workouts come first (set types and
  // units); workouts/{date} fills in what the logger doesn't have (Quick log, Strong imports, older days).
  function entries(docs, opts) {
    const units = opts.units || {}, out = [], lbSeen = {};
    out.names = {}; // real names seen in workouts/{date} for lifts taken from the logger
    const push = (date, name, sets, guessed) => { if (sets.length) out.push({ date, name: String(name).trim(), sets, guessed: !!guessed }); };
    const mk = (w, r, unit) => ({ r, w, unit, kg: unit === "lb" ? w * LB : w });
    opts = Object.assign({}, opts, { lbExercises: Object.fromEntries(asList(docs.lb_exercises).filter(x => x && x.id).map(x => [x.id, x])) });
    asList(docs.lb_workouts).forEach(w => {
      if (!w || !w.end || !(w.start > 0) || !Array.isArray(w.exercises)) return;
      const date = lbDate(w);
      if (date > opts.today) return;
      w.exercises.forEach(e => {
        if (!e || !e.exId || !Array.isArray(e.sets)) return;
        const name = lbName(e, opts), guessed = name === unslug(e.exId), unit = e.unit === "lb" ? "lb" : "kg";
        const sets = e.sets.filter(s => s && s.t !== "w" && s.done !== false && num(s.r) > 0).map(s => mk(num(s.w) || 0, num(s.r), unit));
        if (!sets.length) return;
        (lbSeen[date] = lbSeen[date] || new Set()).add(keyOf(name));
        push(date, name, sets, guessed);
      });
    });
    Object.entries(docs.workouts || {}).forEach(([k, w]) => {
      const date = isDate(w && w.date) ? w.date : k;
      if (!isDate(date) || date > opts.today || !w || !w.sets || typeof w.sets !== "object") return;
      Object.entries(w.sets).forEach(([name, sets]) => {
        if (!Array.isArray(sets)) return;
        if (lbSeen[date] && lbSeen[date].has(keyOf(name))) { out.names[keyOf(name)] = name.trim(); return; }
        push(date, name, sets.map(s => {
          const r = num(s && s.r); if (!(r > 0)) return null;
          return mk(num(s.w) || 0, r, s.unit === "lb" || s.unit === "kg" ? s.unit : units[name] || "kg");
        }).filter(Boolean));
      });
    });
    const names = out.names;
    return Object.assign(out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)), { names });
  }

  function liftSeries(rows) {
    let best = 0;
    return rows.map(({ date, sets }) => {
      let top = null, vol = 0;
      sets.forEach(s => { vol += s.kg * s.r; const v = e1rm(s.kg, s.r); if (v != null && (!top || v > top.v)) top = { v, s }; });
      const pr = !!top && top.v > best + 1e-9 && best > 0;
      if (top && top.v > best) best = top.v;
      return { date, sets: sets.length, volKg: vol, e1rm: top ? top.v : null, top: top ? top.s : null, approx: !!top && top.s.r > 12, pr };
    });
  }

  function analyze(docs, opts = {}) {
    docs = docs || {};
    const today = isDate(opts.today) ? opts.today : localToday();
    const o = Object.assign({}, opts, { today });
    const lo = (opts.volume && num(opts.volume.lo)) ?? 10, hi = (opts.volume && num(opts.volume.hi)) ?? 20;
    const nWeeks = Math.max(1, Math.min(26, num(opts.weeks) || 8));
    const rows = entries(docs, o);
    const ws = weighIns(docs.weights);
    const notes = [];

    // ---- lifts ----
    const byKey = new Map(), unmapped = new Set();
    rows.forEach(e => {
      const k = keyOf(e.name);
      if (!byKey.has(k)) byKey.set(k, { name: e.name, guessed: e.guessed, key: k, rows: [], muscles: musclesFor(e.name, opts.muscles) });
      // Show the most recent real name; a name rebuilt from a logger id only when nothing better exists.
      const L = byKey.get(k); L.rows.push(e); if (!e.guessed || L.guessed) { L.name = e.name; L.guessed = e.guessed; }
    });
    const mainKeys = (opts.mainLifts || []).map(keyOf);
    const cutStart = isDate(opts.cutStart) ? opts.cutStart : opts.targets && isDate(opts.targets.start) ? opts.targets.start : null;
    const lifts = [];
    byKey.forEach(L => {
      if (L.guessed && rows.names[L.key]) L.name = rows.names[L.key];
      if (!L.muscles) unmapped.add(L.name);
      if (L.muscles && L.muscles.cardio) return;
      const pts = liftSeries(L.rows);
      const lastUnit = L.rows[L.rows.length - 1].sets[0].unit;
      const withE = pts.filter(p => p.e1rm != null);
      const best = withE.reduce((b, p) => (!b || p.e1rm > b.e1rm ? p : b), null);
      const last = withE[withE.length - 1] || null;
      // Change over the last 28 days: best of the 2 latest sessions vs the best session 21–35 days back.
      let change28 = null;
      if (last && diff(last.date, today) <= 21) {
        const recent = Math.max(...withE.slice(-2).map(p => p.e1rm));
        const old = withE.filter(p => { const d = diff(p.date, last.date); return d >= 21 && d <= 35; });
        if (old.length) { const b = Math.max(...old.map(p => p.e1rm)); change28 = { from: b, to: recent, pct: (recent - b) / b * 100 }; }
      }
      lifts.push({
        name: L.name, key: L.key, main: mainKeys.includes(L.key), unit: lastUnit,
        muscles: L.muscles || { primary: [], secondary: [] }, sessions: pts.length,
        points: pts, best, last, change28, cut: cutStart ? cutChange(withE, cutStart, today, ws) : null
      });
    });
    lifts.sort((a, b) => (b.main - a.main) || (a.main && b.main ? mainKeys.indexOf(a.key) - mainKeys.indexOf(b.key) : 0) || b.sessions - a.sessions || a.name.localeCompare(b.name));

    // ---- weekly sets per muscle (rolling 7-day windows ending today) ----
    const weeks = [];
    for (let i = nWeeks - 1; i >= 0; i--) {
      const to = add(today, -7 * i), from = add(to, -6);
      const sets = Object.fromEntries(MUSCLES.map(m => [m.id, 0])), direct = Object.fromEntries(MUSCLES.map(m => [m.id, 0]));
      const days = new Set(), hitDays = Object.fromEntries(MUSCLES.map(m => [m.id, new Set()]));
      rows.forEach(e => {
        if (e.date < from || e.date > to) return;
        const m = byKey.get(keyOf(e.name)).muscles;
        if (!m || m.cardio) return;
        days.add(e.date);
        const n = e.sets.length;
        m.primary.forEach(id => { if (id in sets) { sets[id] += n; direct[id] += n; hitDays[id].add(e.date); } });
        m.secondary.forEach(id => { if (id in sets) sets[id] += n / 2; });
      });
      weeks.push({ from, to, sessions: days.size, sets, direct, freq: Object.fromEntries(Object.entries(hitDays).map(([k, v]) => [k, v.size])) });
    }
    const cur = weeks[weeks.length - 1], last4 = weeks.slice(-4);
    // Only average over windows since the first logged workout, so a new user isn't averaged against empty weeks.
    const first = rows.length ? rows[0].date : null;
    const live4 = first ? last4.filter(w => w.to >= first) : [];
    const avg = (f) => live4.length ? live4.reduce((a, w) => a + f(w), 0) / live4.length : 0;
    const muscles = MUSCLES.map(m => {
      const thisWeek = cur.sets[m.id], avg4 = avg(w => w.sets[m.id]), freq4 = avg(w => w.freq[m.id]);
      const major = MAJOR.includes(m.id);
      const status = !major || !live4.length ? null : avg4 < lo ? "low" : avg4 > hi ? "high" : "ok";
      return { id: m.id, label: m.label, region: m.region, major, thisWeek, avg4, freq4, status };
    });

    // ---- balance (last 4 windows) ----
    const tot = id => live4.reduce((a, w) => a + w.sets[id], 0);
    const balance = BALANCE.map(([id, label, A, B, flag]) => {
      const a = A.reduce((s, m) => s + tot(m), 0), b = B.reduce((s, m) => s + tot(m), 0);
      if (!a && !b) return { id, label, a, b, ratio: null, lean: null, flag };
      const ratio = b ? a / b : Infinity;
      const lean = !flag ? null : ratio > 1.5 ? "a" : ratio < 2 / 3 ? "b" : "even";
      return { id, label, a, b, ratio, share: a / (a + b), lean, flag, sides: SIDE_NAMES[id] };
    });

    // ---- strength during the cut ----
    let cut = null;
    if (cutStart) {
      const tracked = lifts.filter(l => l.cut && (!mainKeys.length || l.main));
      const pool = tracked.length ? tracked : lifts.filter(l => l.cut);
      const up = pool.filter(l => l.cut.verdict === "up").length, down = pool.filter(l => l.cut.verdict === "down").length;
      const held = pool.length - up - down;
      const pcts = pool.map(l => l.cut.pct).sort((a, b) => a - b);
      const median = pcts.length ? (pcts.length % 2 ? pcts[(pcts.length - 1) / 2] : (pcts[pcts.length / 2 - 1] + pcts[pcts.length / 2]) / 2) : null;
      const kg0 = bodyAt(ws, cutStart), kg1 = ws.length ? bodyAt(ws, ws[ws.length - 1].date) : null;
      const bw = kg0 && kg1 ? { from: kg0, to: kg1, pct: (kg1 - kg0) / kg0 * 100 } : null;
      const days = diff(cutStart, today);
      let status, text;
      if (days < 14) { status = "early"; text = "The cut started " + short(cutStart) + ". Strength changes are readable from " + short(add(cutStart, 14)) + " on, once each lift has 2+ weeks of sessions."; }
      else if (pool.length < 3) { status = "early"; text = "Not enough lifts logged both near the cut start and in the last 3 weeks to judge yet (" + pool.length + " so far, needs 3)."; }
      else if (down * 2 >= pool.length) { status = "down"; text = down + " of " + pool.length + " lifts are down more than 5% since " + short(cutStart) + ". Check sleep, protein and pre-workout food first; this card never changes your calories."; }
      else if (down) { status = "mixed"; text = (up + held) + " of " + pool.length + " lifts held or improved since " + short(cutStart) + "; " + down + " dropped more than 5%."; }
      else { status = "good"; text = "Strength is holding: " + (up + held) + " of " + pool.length + " lifts held or improved since " + short(cutStart) + (bw && bw.pct < -0.5 ? " while body weight fell " + f1(-bw.pct) + "%." : "."); }
      cut = { start: cutStart, days, lifts: pool.length, up, held, down, median, bw, status, text };
    }

    if (unmapped.size) notes.push("Not counted toward muscles (unknown exercise): " + [...unmapped].join(", ") + ".");
    if (lifts.some(l => l.last && l.last.approx)) notes.push("Lifts done for 13–20 reps get a rough 1RM (marked ~).");
    return { today, cutStart, volume: { lo, hi }, lifts, weeks, muscles, balance, cut, unmapped: [...unmapped], notes, sessions: new Set(rows.map(r => r.date)).size };
  }

  // Baseline: best of the 2 sessions closest before the cut (within 21 days), else the first 2 in its first week.
  // Current: best of the 2 latest sessions, the latest within 21 days and 14+ days after the baseline.
  function cutChange(pts, start, today, ws) {
    if (!pts.length) return null;
    let base = pts.filter(p => p.date <= start && diff(p.date, start) <= 21).slice(-2);
    if (!base.length) base = pts.filter(p => p.date > start && diff(start, p.date) <= 7).slice(0, 2);
    if (!base.length) return null;
    const b = base.reduce((x, p) => (p.e1rm > x.e1rm ? p : x));
    const lastBase = base[base.length - 1].date;
    const recent = pts.filter(p => p.date > lastBase).slice(-2);
    if (!recent.length || diff(recent[recent.length - 1].date, today) > 21 || diff(b.date, recent[recent.length - 1].date) < 14) return null;
    const c = recent.reduce((x, p) => (p.e1rm > x.e1rm ? p : x));
    const pct = (c.e1rm - b.e1rm) / b.e1rm * 100;
    const kgB = bodyAt(ws, b.date), kgC = bodyAt(ws, c.date);
    const rel = kgB && kgC ? { from: b.e1rm / kgB, to: c.e1rm / kgC, pct: ((c.e1rm / kgC) - (b.e1rm / kgB)) / (b.e1rm / kgB) * 100 } : null;
    return { from: b, to: c, pct, rel, verdict: pct >= 2.5 ? "up" : pct <= -5 ? "down" : "held" };
  }

  // ---------- rendering ----------
  const toUnit = (kg, unit) => unit === "lb" ? kg / LB : kg;
  const showW = (kg, unit) => f1(toUnit(kg, unit)) + " " + unit;

  function chart(l, cutStart) {
    const pts = l.points.filter(p => p.e1rm != null);
    if (pts.length < 2) return '<p class="muted sa-empty">' + (pts.length ? "One session so far. The chart starts after the second." : "No weighted sets logged for this lift.") + "</p>";
    const W = 320, H = 150, L = 40, R = 10, T = 12, B = 22;
    const xs = pts.map(p => ms(p.date)), ys = pts.map(p => toUnit(p.e1rm, l.unit));
    let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x1 === x0) x1 = x0 + DAY;
    let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = Math.max((y1 - y0) * 0.15, y1 * 0.02, 1); y0 -= pad; y1 += pad;
    const X = t => L + (t - x0) / (x1 - x0) * (W - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    const ticks = [y0 + pad, (y0 + y1) / 2, y1 - pad];
    let s = '<svg class="sa-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Estimated 1RM for ' + esc(l.name) + ' over time">';
    ticks.forEach(v => { s += '<line class="sa-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/><text class="sa-ax" x="' + (L - 6) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + fint(v) + "</text>"; });
    if (cutStart) { const t = ms(cutStart); if (t > x0 && t < x1) s += '<line class="sa-cut" x1="' + X(t).toFixed(1) + '" x2="' + X(t).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '"/><text class="sa-ax" x="' + (X(t) + 4).toFixed(1) + '" y="' + (T + 8) + '">Cut start</text>'; }
    s += '<text class="sa-ax" x="' + L + '" y="' + (H - 6) + '">' + short(pts[0].date) + '</text><text class="sa-ax" x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end">' + short(pts[pts.length - 1].date) + "</text>";
    s += '<polyline class="sa-line" points="' + pts.map((p, i) => X(xs[i]).toFixed(1) + "," + Y(ys[i]).toFixed(1)).join(" ") + '"/>';
    pts.forEach((p, i) => {
      const tip = short(p.date) + ": " + (p.approx ? "~" : "") + f1(ys[i]) + " " + l.unit + " est. 1RM from " + showW(p.top.kg, l.unit) + " × " + p.top.r + (p.pr ? " (PR)" : "");
      s += '<g class="sa-pt' + (p.pr ? " pr" : "") + '"><title>' + esc(tip) + '</title><circle class="sa-hit" cx="' + X(xs[i]).toFixed(1) + '" cy="' + Y(ys[i]).toFixed(1) + '" r="11"/><circle class="sa-dot" cx="' + X(xs[i]).toFixed(1) + '" cy="' + Y(ys[i]).toFixed(1) + '" r="' + (p.pr ? 5 : 4) + '"/></g>';
    });
    return s + "</svg>";
  }

  function liftPanel(l, cutStart) {
    if (!l) return "";
    const b = l.best, last = l.last;
    const stat = (v, k) => '<div><b>' + v + "</b><span>" + k + "</span></div>";
    const ch = l.change28 ? sgn(l.change28.pct) + "%" : "—";
    const cut = l.cut ? sgn(l.cut.pct) + "%" : "—";
    const tiles = '<div class="sa-tiles">' +
      stat(last ? (last.approx ? "~" : "") + f1(toUnit(last.e1rm, l.unit)) : "—", "Latest est. 1RM (" + l.unit + ")") +
      stat(b ? f1(toUnit(b.e1rm, l.unit)) : "—", "Best" + (b ? " · " + short(b.date) : "")) +
      stat(ch, "Last 4 weeks") + (cutStart ? stat(cut, "Since cut start") : "") + "</div>";
    const rows = l.points.slice().reverse().slice(0, 12).map(p => "<tr><td>" + short(p.date) + "</td><td>" + (p.top ? showW(p.top.kg, l.unit) + " × " + p.top.r : "—") + "</td><td>" + p.sets + '</td><td class="r">' + (p.e1rm != null ? (p.approx ? "~" : "") + f1(toUnit(p.e1rm, l.unit)) : "—") + (p.pr ? ' <span class="sa-pr">PR</span>' : "") + "</td></tr>").join("");
    const muscles = l.muscles.primary.map(m => LABEL[m]).concat(l.muscles.secondary.map(m => LABEL[m] + " (½)")).join(", ");
    return tiles + chart(l, cutStart) +
      '<p class="muted small">Best set per session, estimated 1RM (Epley). Bigger dots are PRs. ' + (muscles ? "Counts toward: " + esc(muscles) + "." : "") + "</p>" +
      '<details class="sa-details"><summary>Sessions table</summary><table class="sa-tbl"><thead><tr><th>Date</th><th>Best set</th><th>Sets</th><th class="r">Est. 1RM</th></tr></thead><tbody>' + rows + "</tbody></table></details>";
  }

  let LAST = null, PICK = null, bound = false;
  function bind() {
    if (bound || typeof document === "undefined") return;
    bound = true;
    document.addEventListener("change", ev => {
      const sel = ev.target && ev.target.closest && ev.target.closest("[data-sa-lift]");
      if (!sel || !LAST) return;
      PICK = sel.value;
      const box = sel.closest(".sa-card") && sel.closest(".sa-card").querySelector(".sa-lift");
      if (box) box.innerHTML = liftPanel(LAST.lifts.find(l => l.key === PICK), LAST.cutStart);
    });
  }

  function html(docs, opts = {}) {
    const A = analyze(docs, opts);
    LAST = A; bind();
    const head = '<div class="spread"><h2>Strength</h2><span class="label">' + A.sessions + " session" + (A.sessions === 1 ? "" : "s") + " logged</span></div>";
    if (!A.lifts.length) return '<section class="card sa-card">' + head + '<p class="muted">Log a workout (Quick log, the full logger, or a Strong import) and your lift charts, weekly sets per muscle and balance show up here.</p></section>';

    // cut strength
    let cutHtml = "";
    if (A.cut) {
      const cls = { good: "good", mixed: "warn", down: "bad", early: "info" }[A.cut.status];
      const lbl = { good: "Holding", mixed: "Mixed", down: "Dropping", early: "Too early" }[A.cut.status];
      const list = A.lifts.filter(l => l.cut && (!(opts.mainLifts || []).length || l.main));
      const chips = (list.length ? list : A.lifts.filter(l => l.cut)).map(l => {
        const c = l.cut, k = c.verdict === "up" ? "good" : c.verdict === "down" ? "bad" : "";
        return '<li><span>' + esc(l.name) + '</span><span class="lb-mono sa-mono">' + f1(toUnit(c.from.e1rm, l.unit)) + " → " + f1(toUnit(c.to.e1rm, l.unit)) + " " + l.unit + '</span><b class="sa-chg ' + k + '">' + sgn(c.pct) + "%" + (c.verdict === "up" ? " ▲" : c.verdict === "down" ? " ▼" : "") + "</b></li>";
      }).join("");
      const bw = A.cut.bw ? '<p class="muted small">Body weight ' + f1(A.cut.bw.from) + " → " + f1(A.cut.bw.to) + " kg (" + sgn(A.cut.bw.pct) + "%). Held = within −5% to +2.5% of the lift's est. 1RM near the cut start.</p>" : "";
      cutHtml = '<div class="sa-sec"><div class="spread"><span class="label">Strength during the cut</span><span class="pill ' + cls + '">' + lbl + "</span></div><p>" + esc(A.cut.text) + "</p>" + (chips ? '<ul class="sa-cutlist">' + chips + "</ul>" : "") + bw + "</div>";
    }

    // lift picker
    if (!PICK || !A.lifts.some(l => l.key === PICK)) PICK = A.lifts[0].key;
    const opt = l => '<option value="' + esc(l.key) + '"' + (l.key === PICK ? " selected" : "") + ">" + esc(l.name) + " (" + l.sessions + ")</option>";
    const mains = A.lifts.filter(l => l.main), rest = A.lifts.filter(l => !l.main);
    const picker = '<select class="sa-select" data-sa-lift aria-label="Pick a lift">' + (mains.length ? '<optgroup label="Main lifts">' + mains.map(opt).join("") + '</optgroup><optgroup label="Other lifts">' + rest.map(opt).join("") + "</optgroup>" : A.lifts.map(opt).join("")) + "</select>";
    const liftHtml = '<div class="sa-sec"><div class="spread"><span class="label">Lift chart</span></div>' + picker + '<div class="sa-lift">' + liftPanel(A.lifts.find(l => l.key === PICK), A.cutStart) + "</div></div>";

    // weekly sets per muscle
    const shown = A.muscles.filter(m => m.thisWeek > 0 || m.avg4 > 0);
    const maxV = Math.max(A.volume.hi * 1.2, ...shown.map(m => Math.max(m.thisWeek, m.avg4)));
    const pc = v => (v / maxV * 100).toFixed(1) + "%";
    const statusTxt = { low: "avg < " + A.volume.lo, high: "avg > " + A.volume.hi, ok: "avg in range" };
    const bars = shown.map(m => '<div class="sa-mrow"><span class="sa-mname">' + m.label + '</span><span class="sa-track"><i class="sa-band" style="left:' + pc(A.volume.lo) + ";width:" + (((A.volume.hi - A.volume.lo) / maxV) * 100).toFixed(1) + '%"' + (m.major ? "" : " hidden") + '></i><i class="sa-bar" style="width:' + pc(m.thisWeek) + '"></i><i class="sa-avg" style="left:' + pc(m.avg4) + '" title="4-week average ' + f1(m.avg4) + '"></i></span><b>' + f1(m.thisWeek) + '</b><span class="sa-freq">' + f1(m.freq4) + "×/wk</span>" + (m.status ? '<span class="sa-st ' + m.status + '">' + statusTxt[m.status] + "</span>" : '<span class="sa-st"></span>') + "</div>").join("");
    const wk = A.weeks;
    const table = '<details class="sa-details"><summary>Week by week</summary><div class="sa-scroll"><table class="sa-tbl"><thead><tr><th>Muscle</th>' + wk.map(w => "<th class=\"r\">" + short(w.from) + "</th>").join("") + "</tr></thead><tbody><tr><td>Sessions</td>" + wk.map(w => '<td class="r">' + w.sessions + "</td>").join("") + "</tr>" + shown.map(m => "<tr><td>" + m.label + "</td>" + wk.map(w => '<td class="r">' + (w.sets[m.id] ? f1(w.sets[m.id]) : "·") + "</td>").join("") + "</tr>").join("") + "</tbody></table></div></details>";
    const volHtml = '<div class="sa-sec"><div class="spread"><span class="label">Sets per muscle, last 7 days</span><span class="muted small">' + short(add(A.today, -6)) + "–" + short(A.today) + "</span></div>" +
      (shown.length ? '<div class="sa-bars">' + bars + "</div>" : '<p class="muted">No sets in the last 4 weeks.</p>') +
      '<p class="muted small">Working sets; a set counts ½ for helper muscles (rows for biceps, presses for triceps). Tick = 4-week average, shaded band = ' + A.volume.lo + "–" + A.volume.hi + " sets, ×/wk = days that muscle was trained directly (4-week average).</p>" + table + "</div>";

    // balance
    const bal = A.balance.filter(b => b.ratio != null).map(b => {
      const [na, nb] = b.sides;
      const lean = b.lean === "a" ? "Leans " + na : b.lean === "b" ? "Leans " + nb : b.lean === "even" ? "Even" : "";
      return '<div class="sa-brow"><div class="spread"><span>' + b.label + '</span><span class="muted small">' + f1(b.a) + " : " + f1(b.b) + " sets" + (lean ? " · " + lean : "") + '</span></div><span class="sa-split"><i style="width:' + (b.share * 100).toFixed(1) + '%"></i></span><div class="spread small muted"><span>' + na + "</span><span>" + nb + "</span></div></div>";
    }).join("");
    const balHtml = bal ? '<div class="sa-sec"><span class="label">Balance, last 4 weeks</span>' + bal + '<p class="muted small">“Leans” shows past a 1.5 : 1 split. Upper vs lower is shown for reference only.</p></div>' : "";

    const notes = A.notes.length ? '<p class="muted small">' + A.notes.map(esc).join(" ") + "</p>" : "";
    return '<section class="card sa-card">' + head + cutHtml + liftHtml + volHtml + balHtml + notes + "</section>";
  }

  function summary(docs, opts = {}) {
    const A = analyze(docs, opts), out = [];
    out.push("Strength summary (" + short(A.today) + ", " + A.sessions + " sessions logged)");
    if (A.cut) {
      out.push("Strength during the cut: " + A.cut.text);
      A.lifts.filter(l => l.cut).forEach(l => out.push("- " + l.name + ": " + f1(toUnit(l.cut.from.e1rm, l.unit)) + " → " + f1(toUnit(l.cut.to.e1rm, l.unit)) + " " + l.unit + " est. 1RM (" + sgn(l.cut.pct) + "%)"));
    }
    const lifts = A.lifts.filter(l => l.last).slice(0, 12);
    if (lifts.length) {
      out.push("Lifts (latest est. 1RM, 4-week change):");
      lifts.forEach(l => out.push("- " + l.name + ": " + (l.last.approx ? "~" : "") + f1(toUnit(l.last.e1rm, l.unit)) + " " + l.unit + " on " + short(l.last.date) + (l.change28 ? " (" + sgn(l.change28.pct) + "%)" : "")));
    }
    const ms7 = A.muscles.filter(m => m.thisWeek > 0 || m.avg4 > 0);
    if (ms7.length) out.push("Sets per muscle, last 7 days (4-wk avg): " + ms7.map(m => m.label + " " + f1(m.thisWeek) + " (" + f1(m.avg4) + ")").join(", "));
    const low = A.muscles.filter(m => m.status === "low").map(m => m.label), high = A.muscles.filter(m => m.status === "high").map(m => m.label);
    if (low.length) out.push("Below " + A.volume.lo + " sets/week on average: " + low.join(", "));
    if (high.length) out.push("Above " + A.volume.hi + " sets/week on average: " + high.join(", "));
    A.balance.filter(b => b.ratio != null && b.flag).forEach(b => out.push(b.label + ": " + f1(b.a) + " : " + f1(b.b) + " sets (" + (b.lean === "even" ? "even" : "leans " + b.sides[b.lean === "a" ? 0 : 1]) + ")"));
    A.notes.forEach(n => out.push(n));
    return out.join("\n");
  }

  const css = [
    ".sa-card .sa-sec{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--line);padding-top:12px}",
    ".sa-card h2{margin:0;font-family:var(--display);font-size:1.2rem}",
    ".sa-card .small{font-size:.8rem}.sa-card p{margin:0}",
    ".sa-select{font:inherit;color:var(--ink);background:var(--sunk);border:1px solid var(--line);border-radius:10px;padding:8px 10px;min-height:40px;max-width:100%}",
    ".sa-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}",
    ".sa-tiles>div{background:var(--sunk);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;min-width:0}",
    ".sa-tiles b{font-family:var(--mono);font-size:1.05rem;font-variant-numeric:tabular-nums}.sa-tiles span{font-size:.72rem;color:var(--muted)}",
    ".sa-svg{width:100%;max-width:460px;height:auto;display:block;overflow:visible}",
    ".sa-grid{stroke:var(--line);stroke-width:1}.sa-ax{fill:var(--muted);font-size:10px;font-family:var(--mono)}",
    ".sa-cut{stroke:var(--muted);stroke-width:1;stroke-dasharray:3 3}",
    ".sa-line{fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}",
    ".sa-dot{fill:var(--accent);stroke:var(--surface);stroke-width:2}.sa-pt.pr .sa-dot{fill:var(--good)}",
    ".sa-hit{fill:transparent}.sa-pt:hover .sa-dot{stroke:var(--ink)}",
    ".sa-pr{font-size:.7rem;font-weight:700;color:var(--good)}",
    ".sa-details summary{cursor:pointer;color:var(--muted);font-size:.85rem;padding:4px 0}",
    ".sa-scroll{overflow-x:auto}",
    ".sa-tbl{width:100%;border-collapse:collapse;font-size:.82rem;font-variant-numeric:tabular-nums}.sa-tbl th,.sa-tbl td{padding:4px 6px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}.sa-tbl .r{text-align:right}.sa-tbl th{color:var(--muted);font-weight:600}",
    ".sa-bars{display:flex;flex-direction:column;gap:6px}",
    ".sa-mrow{display:grid;grid-template-columns:6.5em 1fr 2.6em 3.8em 6.2em;align-items:center;gap:8px;font-size:.85rem}",
    ".sa-mrow b{font-family:var(--mono);text-align:right;font-variant-numeric:tabular-nums}",
    ".sa-track{position:relative;height:10px;background:var(--sunk);border-radius:5px}",
    ".sa-band{position:absolute;top:0;bottom:0;background:var(--line);opacity:.8}",
    ".sa-bar{position:absolute;left:0;top:2px;bottom:2px;background:var(--accent);border-radius:0 4px 4px 0;min-width:2px}",
    ".sa-avg{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;background:var(--ink)}",
    ".sa-freq{color:var(--muted);font-size:.75rem;text-align:right}",
    ".sa-st{font-size:.72rem;color:var(--muted)}.sa-st.low{color:var(--warn)}.sa-st.high{color:var(--warn)}.sa-st.ok{color:var(--good)}",
    "@media (max-width:420px){.sa-mrow{grid-template-columns:5.6em 1fr 2.4em 3.4em}.sa-mrow .sa-st{grid-column:2/-1;margin-top:-4px}}",
    ".sa-cutlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}",
    ".sa-cutlist li{display:grid;grid-template-columns:1fr auto 5em;gap:8px;font-size:.85rem;align-items:baseline}",
    ".sa-mono{font-family:var(--mono);font-size:.8rem;color:var(--muted)}",
    ".sa-chg{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}.sa-chg.good{color:var(--good)}.sa-chg.bad{color:var(--bad)}",
    ".sa-brow{display:flex;flex-direction:column;gap:3px;font-size:.88rem}",
    ".sa-split{display:block;height:10px;border-radius:5px;background:var(--sunk);overflow:hidden}",
    ".sa-split i{display:block;height:100%;background:var(--accent);border-right:2px solid var(--surface)}",
    ".sa-empty{padding:8px 0}"
  ].join("\n");

  return { css, analyze, html, summary, unitsFrom, musclesFor, e1rm, MUSCLES, RULES };
})();
if (typeof window !== "undefined") window.StrengthAnalytics = StrengthAnalytics;
if (typeof module !== "undefined" && module.exports) module.exports = StrengthAnalytics;
