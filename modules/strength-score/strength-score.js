/**
 * StrengthScore — one overall strength score (0–100) from each lift's est. 1RM relative to body
 * weight, a level per muscle group, and push/pull, upper/lower and quad/hamstring imbalance flags.
 * (The Fitbod "Strength Score" idea.) Plain JS, no imports, no network. Global `StrengthScore`.
 *
 *   StrengthScore.css
 *   StrengthScore.compute(lifts, opts)      -> {overall, level, groups, muscles, lifts, flags, skipped, notes, bodyKg}
 *   StrengthScore.fromDocs(docs, opts)      -> same, lifts from StrengthAnalytics.analyze(docs, opts) and body weight from docs.weights
 *   StrengthScore.html(docs, opts)          -> one .card for the Progress tab
 *   StrengthScore.summary(docs, opts)       -> plain text for the coach / a chat
 *   StrengthScore.patternFor(name)          -> {id, ratios, kind, group} or null
 *   StrengthScore.scoreOf(ratio, ratios)    -> 0–100
 *   StrengthScore.levelOf(score)            -> "Starting" | "Beginner" | "Novice" | "Intermediate" | "Advanced" | "Elite"
 *
 * Method: a lift's ratio = est. 1RM (kg) ÷ body weight (kg). Each movement pattern has five ratio
 * breakpoints (beginner, novice, intermediate, advanced, elite), mapped to 20 / 40 / 60 / 80 / 100 by
 * straight lines, capped at 100. Dumbbell patterns use the per-hand load. Machine loads differ by
 * brand, so machine lifts count 0.6 and cable lifts 0.8 toward a muscle. Standards are a generic
 * table (opts.standards overrides it, opts.sex "female" scales it); nothing about one person is hard-coded.
 */
const StrengthScore = (() => {
  "use strict";

  const DAY = 864e5;
  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const localIso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const diff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);
  const num = v => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(+v) ? +v : null);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f0 = n => (n == null || !isFinite(n) ? "—" : String(Math.round(n)));
  const f2 = n => (n == null || !isFinite(n) ? "—" : (Math.round(n * 100) / 100).toFixed(2));
  const keyOf = s => String(s || "").toLowerCase().replace(/\(.*?\)/g, m => " " + m + " ").replace(/[^a-z0-9]+/g, " ").trim();

  const LEVELS = ["Starting", "Beginner", "Novice", "Intermediate", "Advanced", "Elite"];
  const STEPS = [20, 40, 60, 80, 100];

  // Movement patterns. ratios = est. 1RM ÷ body weight at beginner / novice / intermediate / advanced / elite
  // (male; generic standards in the spirit of strengthlevel-style tables, rounded). kind: free | cable | machine | bw.
  // group: push | pull | legs. Dumbbell ("db") patterns are per hand.
  const STANDARDS = {
    benchBB:     { label: "Barbell bench press",      ratios: [0.50, 0.75, 1.00, 1.25, 1.50], kind: "free",    group: "push" },
    benchDB:     { label: "Dumbbell press (per hand)", ratios: [0.15, 0.25, 0.35, 0.45, 0.55], kind: "free",    group: "push" },
    chestMach:   { label: "Chest press (machine)",     ratios: [0.60, 0.90, 1.20, 1.50, 1.80], kind: "machine", group: "push" },
    flyCable:    { label: "Fly / crossover",           ratios: [0.15, 0.25, 0.35, 0.45, 0.55], kind: "cable",   group: "push" },
    ohpBB:       { label: "Barbell overhead press",    ratios: [0.35, 0.50, 0.65, 0.85, 1.05], kind: "free",    group: "push" },
    ohpDB:       { label: "Dumbbell shoulder press (per hand)", ratios: [0.10, 0.17, 0.25, 0.33, 0.42], kind: "free", group: "push" },
    ohpMach:     { label: "Shoulder press (machine)",  ratios: [0.40, 0.60, 0.80, 1.05, 1.30], kind: "machine", group: "push" },
    lateral:     { label: "Lateral raise (per hand)",  ratios: [0.05, 0.08, 0.12, 0.17, 0.22], kind: "free",    group: "push" },
    tricepsCable:{ label: "Triceps pushdown / rope",   ratios: [0.30, 0.45, 0.60, 0.80, 1.00], kind: "cable",   group: "push" },
    dip:         { label: "Dip (body weight + load)",  ratios: [1.00, 1.15, 1.40, 1.70, 2.00], kind: "bw",      group: "push" },
    pulldown:    { label: "Lat pulldown",              ratios: [0.50, 0.70, 0.90, 1.10, 1.30], kind: "cable",   group: "pull" },
    pullup:      { label: "Pull-up (body weight + load)", ratios: [1.00, 1.10, 1.30, 1.50, 1.70], kind: "bw",   group: "pull" },
    rowBB:       { label: "Barbell / T-bar row",       ratios: [0.50, 0.75, 1.00, 1.25, 1.50], kind: "free",    group: "pull" },
    rowDB:       { label: "Dumbbell row (per hand)",   ratios: [0.20, 0.30, 0.40, 0.50, 0.60], kind: "free",    group: "pull" },
    rowCable:    { label: "Seated / machine row",      ratios: [0.60, 0.85, 1.10, 1.35, 1.60], kind: "cable",   group: "pull" },
    rearDelt:    { label: "Reverse fly / face pull",   ratios: [0.20, 0.35, 0.50, 0.65, 0.80], kind: "cable",   group: "pull" },
    curlBB:      { label: "Barbell curl",              ratios: [0.20, 0.30, 0.45, 0.60, 0.75], kind: "free",    group: "pull" },
    curlDB:      { label: "Dumbbell curl (per hand)",  ratios: [0.08, 0.13, 0.19, 0.26, 0.33], kind: "free",    group: "pull" },
    curlCable:   { label: "Cable / machine curl",      ratios: [0.20, 0.30, 0.45, 0.60, 0.75], kind: "cable",   group: "pull" },
    squatBB:     { label: "Barbell squat",             ratios: [0.75, 1.00, 1.50, 1.90, 2.30], kind: "free",    group: "legs" },
    hackSquat:   { label: "Hack squat (machine)",      ratios: [0.75, 1.10, 1.50, 2.00, 2.50], kind: "machine", group: "legs" },
    legPress:    { label: "Leg press",                 ratios: [1.00, 1.50, 2.20, 3.00, 3.80], kind: "machine", group: "legs" },
    lunge:       { label: "Lunge / split squat (per hand)", ratios: [0.15, 0.25, 0.35, 0.45, 0.55], kind: "free", group: "legs" },
    deadlift:    { label: "Deadlift",                  ratios: [1.00, 1.25, 1.75, 2.25, 2.75], kind: "free",    group: "legs" },
    rdl:         { label: "Romanian deadlift / hip hinge", ratios: [0.75, 1.00, 1.40, 1.80, 2.20], kind: "free", group: "legs" },
    legCurl:     { label: "Leg curl",                  ratios: [0.30, 0.50, 0.70, 0.90, 1.10], kind: "machine", group: "legs" },
    legExt:      { label: "Leg extension",             ratios: [0.50, 0.75, 1.00, 1.30, 1.60], kind: "machine", group: "legs" },
    hipThrust:   { label: "Hip thrust / glute bridge", ratios: [1.00, 1.40, 1.90, 2.40, 2.90], kind: "free",    group: "legs" },
    calf:        { label: "Calf raise / press",        ratios: [0.80, 1.20, 1.70, 2.20, 2.70], kind: "machine", group: "legs" }
  };
  // Confidence per equipment kind (machine loads differ by brand; body-weight moves need the added load logged).
  const KIND_WEIGHT = { free: 1, cable: 0.8, machine: 0.6, bw: 0.8 };
  // Female standards: upper-body ratios × 0.65, lower × 0.75 (population averages, rounded).
  const SEX_SCALE = { male: { push: 1, pull: 1, legs: 1 }, female: { push: 0.65, pull: 0.65, legs: 0.75 } };

  // Name rules, first match wins (same key normalisation as StrengthAnalytics).
  const RULES = [
    [/treadmill|bike|cycling|elliptical|rower\b|rowing machine|stair|walk\b|run\b|jog|swim|cardio|hiit/, null],
    [/\bcrunch|\babs\b|\bab\b|plank|leg raise|sit up|situp|russian twist|woodchop|cable twist/, null],
    [/hip abduct|hip adduct|abductor|adductor|shrug|trap|forearm|wrist|neck|back extension|hyperextension|good morning/, null],
    [/dip\b|dips\b/, "dip"],
    [/pull up|pullup|chin up|chinup/, "pullup"],
    [/lat pulldown|pulldown|pull down/, "pulldown"],
    [/upright row/, "lateral"],
    [/calf|calves/, "calf"],
    [/glute kickback|hip thrust|glute bridge|glute/, "hipThrust"],
    [/\bt bar\b|barbell row|bent over row|pendlay/, "rowBB"],
    [/row.*(dumbbell|db)|(dumbbell|db).*row|single arm row|one arm row/, "rowDB"],
    [/row|iso lateral|hammer strength/, "rowCable"],
    [/reverse fly|rear delt|face pull|pec deck reverse|reverse pec/, "rearDelt"],
    [/fly|flye|crossover|pec deck|chest machine|gundam/, (n) => /machine|gundam|press/.test(n) ? "chestMach" : "flyCable"],
    [/(incline|flat|decline)?.*bench.*(dumbbell|db)|(dumbbell|db).*(bench|chest|incline).*press|(incline|flat|decline) (dumbbell|db) press|incline db/, "benchDB"],
    [/chest press|incline press.*machine|press.*machine.*(chest|incline)|smith.*(bench|incline)/, "chestMach"],
    [/bench press|incline press|floor press|close grip/, "benchBB"],
    [/(shoulder|overhead|military|arnold).*(dumbbell|db)|(dumbbell|db).*(shoulder|overhead|arnold)/, "ohpDB"],
    [/(shoulder|overhead).*(machine|smith)|(machine|smith).*(shoulder|overhead)/, "ohpMach"],
    [/overhead press|shoulder press|military press|push press|ohp|strict press/, "ohpBB"],
    [/lateral raise|side delt|side raise/, "lateral"],
    [/triceps|tricep|pushdown|skull|skullcrusher|overhead extension/, "tricepsCable"],
    [/(curl).*(dumbbell|db|hammer|incline|concentration|preacher dumbbell)|(dumbbell|db|hammer).*curl/, (n) => /leg|hamstring/.test(n) ? "legCurl" : "curlDB"],
    [/(leg|lying|seated|standing|hamstring|nordic).*curl|leg curl/, "legCurl"],
    [/(curl).*(barbell|ez|bb)|(barbell|ez|bb).*curl/, "curlBB"],
    [/curl|bicep|biceps/, "curlCable"],
    [/hack squat|hack/, "hackSquat"],
    [/leg press|pendulum/, "legPress"],
    [/leg extension|leg ext/, "legExt"],
    [/lunge|split squat|bulgarian|step up/, "lunge"],
    [/romanian|rdl|stiff leg|hip hinge|pull through/, "rdl"],
    [/deadlift|trap bar/, "deadlift"],
    [/squat|goblet|front squat|smith squat|belt squat/, "squatBB"]
  ];

  function patternFor(name, overrides) {
    if (overrides) { const o = overrides[name] || overrides[keyOf(name)]; if (o) return STANDARDS[o] ? { id: o, ...STANDARDS[o] } : null; }
    const n = keyOf(name);
    for (const [re, id] of RULES) if (re.test(n)) {
      const r = typeof id === "function" ? id(n) : id;
      return r ? { id: r, ...STANDARDS[r] } : null;
    }
    return null;
  }

  // Piecewise-linear map from a ratio to 0–100 over the five breakpoints; below the first is 0–20, above elite capped.
  function scoreOf(ratio, ratios) {
    if (!(ratio > 0) || !ratios || ratios.length !== 5) return null;
    if (ratio >= ratios[4]) return 100;
    if (ratio < ratios[0]) return Math.max(0, 20 * ratio / ratios[0]);
    for (let i = 0; i < 4; i++) if (ratio < ratios[i + 1]) return STEPS[i] + (STEPS[i + 1] - STEPS[i]) * (ratio - ratios[i]) / (ratios[i + 1] - ratios[i]);
    return 100;
  }
  const levelOf = s => (s == null ? "—" : s >= 100 ? LEVELS[5] : s >= 80 ? LEVELS[4] : s >= 60 ? LEVELS[3] : s >= 40 ? LEVELS[2] : s >= 20 ? LEVELS[1] : LEVELS[0]);
  const levelIdx = s => (s == null ? -1 : Math.min(5, Math.floor(s / 20)));

  const MUSCLE_LABEL = { chest: "Chest", back: "Back", frontDelts: "Front delts", sideDelts: "Side delts", rearDelts: "Rear delts", biceps: "Biceps", triceps: "Triceps", quads: "Quads", hamstrings: "Hamstrings", glutes: "Glutes", calves: "Calves", traps: "Traps", forearms: "Forearms", abs: "Abs", adductors: "Adductors", abductors: "Abductors" };
  const GROUPS = {
    push:  { label: "Push",  muscles: ["chest", "frontDelts", "sideDelts", "triceps"] },
    pull:  { label: "Pull",  muscles: ["back", "rearDelts", "biceps"] },
    legs:  { label: "Legs",  muscles: ["quads", "hamstrings", "glutes", "calves"] }
  };
  const REGIONS = { upper: ["push", "pull"], lower: ["legs"] };
  const GAP = 15; // points between two sides before a flag
  const STALE_DAYS = 60;

  function weighIns(weights) {
    return Object.entries(weights || {})
      .map(([k, w]) => ({ date: isDate(w && w.date) ? w.date : k, kg: num(w && w.kg) }))
      .filter(w => isDate(w.date) && w.kg != null && w.kg > 20 && w.kg < 400)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  function bodyAt(ws, date) {
    const upTo = ws.filter(w => w.date <= date);
    const pool = upTo.length ? upTo : ws;
    if (!pool.length) return null;
    const last = pool[pool.length - 1];
    const near = pool.filter(w => Math.abs(diff(w.date, last.date)) <= 3);
    return { kg: near.reduce((a, w) => a + w.kg, 0) / near.length, date: last.date };
  }

  /**
   * lifts: StrengthAnalytics.analyze(...).lifts — [{name, muscles:{primary,secondary}, points:[{date, e1rm}], unit}]
   * or a plain [{name, e1rmKg, date, muscles?}] list. opts: today, bodyKg, bodyDate, sex, asOf, window, standards, patterns, sexScale.
   */
  function compute(lifts, opts) {
    opts = opts || {};
    const today = isDate(opts.today) ? opts.today : localIso(new Date());
    const asOf = isDate(opts.asOf) ? opts.asOf : today;
    const windowDays = opts.window > 0 ? opts.window : STALE_DAYS;
    const sex = opts.sex === "female" ? "female" : "male";
    const scale = opts.sexScale || SEX_SCALE[sex];
    const std = Object.assign({}, STANDARDS, opts.standards || {});
    const notes = [], skipped = [], rows = [];
    const bodyKg = num(opts.bodyKg);
    if (!bodyKg) return { today, asOf, bodyKg: null, overall: null, level: "—", groups: {}, regions: {}, muscles: [], lifts: [], flags: [], skipped: [], notes: ["Log a weigh-in first: the score is strength relative to body weight."] };

    (lifts || []).forEach(l => {
      const name = l.name || "";
      const pat = patternFor(name, opts.patterns);
      // Latest est. 1RM at or before asOf.
      let e = null, date = null;
      if (Array.isArray(l.points)) {
        for (let i = l.points.length - 1; i >= 0; i--) { const p = l.points[i]; if (p.e1rm != null && p.date <= asOf) { e = p.e1rm; date = p.date; break; } }
      } else if (num(l.e1rmKg) != null) { e = num(l.e1rmKg); date = isDate(l.date) ? l.date : asOf; }
      if (!pat) { if (e != null) skipped.push({ name, why: "no standard for this exercise" }); return; }
      const base = std[pat.id] || pat;
      if (e == null) return; // cardio, no load, or never estimated: not a strength lift to score
      if (diff(date, asOf) > windowDays) { skipped.push({ name, why: "last session " + diff(date, asOf) + " days ago" }); return; }
      const ratios = base.ratios.map(r => r * (scale[base.group] || 1));
      const ratio = base.kind === "bw" ? (bodyKg + e) / bodyKg : e / bodyKg;
      const score = scoreOf(ratio, ratios);
      const muscles = l.muscles && (l.muscles.primary || []).length ? l.muscles : { primary: GROUPS[base.group].muscles.slice(0, 1), secondary: [] };
      rows.push({ name, pattern: pat.id, patternLabel: base.label, group: base.group, kind: base.kind, weight: KIND_WEIGHT[base.kind] || 0.6,
        e1rmKg: e, date, ratio, score, level: levelOf(score), muscles, unit: l.unit || "kg" });
    });

    // Per muscle: weighted mean of lift scores (primary 1, secondary 0.5, × equipment confidence).
    const acc = {};
    rows.forEach(r => {
      (r.muscles.primary || []).forEach(m => { (acc[m] = acc[m] || { s: 0, w: 0, lifts: [] }); acc[m].s += r.score * r.weight; acc[m].w += r.weight; acc[m].lifts.push(r.name); });
      (r.muscles.secondary || []).forEach(m => { (acc[m] = acc[m] || { s: 0, w: 0, lifts: [] }); acc[m].s += r.score * r.weight * 0.5; acc[m].w += r.weight * 0.5; });
    });
    const muscleScore = {};
    const muscles = Object.keys(acc).filter(m => acc[m].w > 0).map(m => {
      const s = acc[m].s / acc[m].w; muscleScore[m] = s;
      return { id: m, label: MUSCLE_LABEL[m] || m, score: s, level: levelOf(s), lifts: acc[m].lifts, weight: acc[m].w };
    }).sort((a, b) => b.score - a.score);

    // Groups: mean of the muscles present, weighted by the evidence behind each.
    const groups = {};
    Object.entries(GROUPS).forEach(([id, g]) => {
      const ms = g.muscles.filter(m => muscleScore[m] != null);
      if (!ms.length) { groups[id] = { id, label: g.label, score: null, level: "—", muscles: [], lifts: 0 }; return; }
      const w = ms.reduce((a, m) => a + acc[m].w, 0);
      const s = ms.reduce((a, m) => a + muscleScore[m] * acc[m].w, 0) / w;
      groups[id] = { id, label: g.label, score: s, level: levelOf(s), muscles: ms, lifts: rows.filter(r => r.group === id).length };
    });
    const regions = {};
    Object.entries(REGIONS).forEach(([id, gs]) => {
      const have = gs.map(g => groups[g]).filter(g => g.score != null);
      regions[id] = have.length ? have.reduce((a, g) => a + g.score, 0) / have.length : null;
    });

    const scored = Object.values(groups).filter(g => g.score != null);
    const overall = scored.length ? scored.reduce((a, g) => a + g.score, 0) / scored.length : null;
    const missing = Object.values(groups).filter(g => g.score == null).map(g => g.label);
    if (overall != null && missing.length) notes.push("No " + missing.join(" or ").toLowerCase() + " lifts in the last " + windowDays + " days, so the overall score covers " + scored.map(g => g.label.toLowerCase()).join(" and ") + " only.");
    if (rows.length && rows.length < 3) notes.push("Only " + rows.length + " scorable lift" + (rows.length === 1 ? "" : "s") + "; the score firms up with 3 or more.");
    if (rows.some(r => r.kind === "machine")) notes.push("Machine loads differ by brand, so machine lifts count 0.6 toward a muscle.");
    if (sex === "male" && !opts.sex) notes.push("Standards assume male; pass sex: \"female\" for female standards.");

    // Imbalance flags.
    const flags = [];
    const gap = (a, b, aLabel, bLabel, what) => {
      if (a == null || b == null) return;
      const d = a - b;
      if (Math.abs(d) < GAP) return;
      const lag = d > 0 ? bLabel : aLabel, lead = d > 0 ? aLabel : bLabel;
      flags.push({ id: what, lag, lead, gap: Math.abs(d), text: lag + " lags " + lead.toLowerCase() + " by " + f0(Math.abs(d)) + " points (" + f0(Math.max(a, b)) + " vs " + f0(Math.min(a, b)) + ")." });
    };
    gap(groups.push.score, groups.pull.score, "Push", "Pull", "push-pull");
    gap(regions.upper, regions.lower, "Upper body", "Lower body", "upper-lower");
    gap(muscleScore.quads, muscleScore.hamstrings, "Quads", "Hamstrings", "quads-hams");
    gap(muscleScore.chest, muscleScore.back, "Chest", "Back", "chest-back");
    const flagged = new Set(flags.flatMap(f => [f.lag, f.lead]));
    // Advice line per flag: the lagging side gets the extra set.
    flags.forEach(f => { f.advice = "Add a set or two per session for " + f.lag.toLowerCase() + ", or push its loads a little harder, and re-check in 4 weeks."; });
    if (!flags.length && scored.length >= 2) notes.push("Push, pull and legs are within " + GAP + " points of each other: no imbalance to act on.");

    return { today, asOf, bodyKg, bodyDate: isDate(opts.bodyDate) ? opts.bodyDate : null, sex, overall, level: levelOf(overall), groups, regions, muscles, lifts: rows.sort((a, b) => b.score - a.score), flags, skipped, notes, flagged: [...flagged] };
  }

  // Lifts from StrengthAnalytics (opts.lifts, opts.analytics, or the global), body weight from docs.weights.
  function fromDocs(docs, opts) {
    opts = opts || {};
    const today = isDate(opts.today) ? opts.today : localIso(new Date());
    const asOf = isDate(opts.asOf) ? opts.asOf : today;
    let lifts = opts.lifts;
    if (!lifts) {
      const SA = opts.analytics || (typeof StrengthAnalytics !== "undefined" ? StrengthAnalytics : null);
      if (SA && SA.analyze) { try { lifts = SA.analyze(docs || {}, Object.assign({}, opts, { today })).lifts; } catch (e) { lifts = []; } }
      else lifts = [];
    }
    const ws = weighIns(docs && docs.weights);
    const bw = num(opts.bodyKg) ? { kg: num(opts.bodyKg), date: null } : bodyAt(ws, asOf);
    const out = compute(lifts, Object.assign({}, opts, { today, bodyKg: bw ? bw.kg : null, bodyDate: bw ? bw.date : null }));
    if (bw && bw.date && diff(bw.date, asOf) > 14) out.notes.unshift("Body weight is from " + bw.date + "; log a weigh-in for a current score.");
    // Change over 28 days: same lifts and the body weight back then.
    if (out.overall != null && !opts.asOf) {
      const back = compute(lifts, Object.assign({}, opts, { today, asOf: shift(asOf, -28), bodyKg: (bodyAt(ws, shift(asOf, -28)) || bw).kg }));
      out.change28 = back.overall != null ? out.overall - back.overall : null;
    }
    return out;
  }
  const shift = (d, n) => { const t = new Date(Date.parse(d + "T00:00:00Z") + n * DAY); return t.toISOString().slice(0, 10); };

  // ---- rendering ----
  const css = `
.ss-card .ss-hero{display:flex;align-items:center;gap:16px;margin:6px 0 10px}
.ss-ring{position:relative;width:92px;height:92px;flex:none}
.ss-ring svg{width:92px;height:92px;transform:rotate(-90deg)}
.ss-ring circle{fill:none;stroke-width:9}
.ss-ring .bg{stroke:var(--line,#2a2a35)}
.ss-ring .fg{stroke:var(--accent,#6c8cff);stroke-linecap:round;transition:stroke-dasharray .4s}
.ss-ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:26px;font-variant-numeric:tabular-nums}
.ss-level{font-size:18px;font-weight:600}
.ss-sub{color:var(--muted,#9a9aa8);font-size:13px;margin-top:2px}
.ss-chg{font-size:13px;margin-left:6px}
.ss-chg.up{color:var(--ok,#3ccf7a)} .ss-chg.down{color:var(--bad,#ff6b6b)}
.ss-groups{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0}
.ss-g{background:var(--panel2,rgba(255,255,255,.04));border-radius:10px;padding:8px 10px}
.ss-g .n{font-size:20px;font-variant-numeric:tabular-nums}
.ss-g .l{font-size:12px;color:var(--muted,#9a9aa8)}
.ss-g.lag{outline:1px solid var(--warn,#ffb347)}
.ss-bar{height:6px;border-radius:3px;background:var(--line,#2a2a35);margin:6px 0 2px;overflow:hidden}
.ss-bar i{display:block;height:100%;background:var(--accent,#6c8cff)}
.ss-flag{border-left:3px solid var(--warn,#ffb347);padding:6px 10px;margin:8px 0;background:var(--panel2,rgba(255,255,255,.04));border-radius:0 8px 8px 0;font-size:14px}
.ss-flag small{display:block;color:var(--muted,#9a9aa8);margin-top:2px}
.ss-muscles{display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;margin:6px 0;font-size:13px}
.ss-m{display:flex;align-items:center;gap:8px}
.ss-m span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ss-m .ss-bar{flex:1.2;margin:0}
.ss-m b{width:26px;text-align:right;font-variant-numeric:tabular-nums;font-weight:500}
.ss-card table{width:100%;border-collapse:collapse;font-size:13px}
.ss-card td,.ss-card th{padding:4px 6px;text-align:left;border-bottom:1px solid var(--line,#2a2a35)}
.ss-card td.r,.ss-card th.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.ss-notes{color:var(--muted,#9a9aa8);font-size:12px;margin:8px 0 0;padding-left:16px}
.ss-card details summary{cursor:pointer;color:var(--muted,#9a9aa8);font-size:13px;margin-top:8px}
`;

  function ring(score) {
    const r = 40, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, score || 0)) / 100;
    return '<div class="ss-ring"><svg viewBox="0 0 92 92"><circle class="bg" cx="46" cy="46" r="' + r + '"/><circle class="fg" cx="46" cy="46" r="' + r + '" stroke-dasharray="' + (c * p).toFixed(1) + " " + c.toFixed(1) + '"/></svg><b>' + f0(score) + "</b></div>";
  }
  const bar = s => '<div class="ss-bar"><i style="width:' + Math.max(0, Math.min(100, s || 0)).toFixed(0) + '%"></i></div>';

  function html(docs, opts) {
    const A = fromDocs(docs, opts);
    let body;
    if (A.overall == null) {
      body = '<p class="ss-sub">' + esc(A.bodyKg ? "No scorable lifts in the last " + (opts && opts.window > 0 ? opts.window : STALE_DAYS) + " days. Log a few main lifts (press, row or pulldown, squat or leg press) and the score appears here." : A.notes[0]) + "</p>"
        + (A.skipped.length ? '<ul class="ss-notes">' + A.skipped.slice(0, 6).map(s => "<li>" + esc(s.name) + ": " + esc(s.why) + "</li>").join("") + "</ul>" : "");
    } else {
      const chg = A.change28 == null ? "" : '<span class="ss-chg ' + (A.change28 >= 1 ? "up" : A.change28 <= -1 ? "down" : "") + '">' + (A.change28 >= 0 ? "+" : "") + f0(A.change28) + " in 28 days</span>";
      const lagging = new Set(A.flags.map(f => f.lag));
      body = '<div class="ss-hero">' + ring(A.overall) + '<div><div class="ss-level">' + esc(A.level) + chg + '</div><div class="ss-sub">Est. 1RM ÷ body weight (' + f0(A.bodyKg) + ' kg) across ' + A.lifts.length + ' lift' + (A.lifts.length === 1 ? "" : "s") + '. 0–100, 60 = intermediate.</div></div></div>'
        + '<div class="ss-groups">' + ["push", "pull", "legs"].map(k => { const g = A.groups[k]; return '<div class="ss-g' + (lagging.has(g.label) ? " lag" : "") + '"><div class="n">' + f0(g.score) + '</div><div class="l">' + esc(g.label) + " · " + esc(g.level) + "</div>" + bar(g.score) + "</div>"; }).join("") + "</div>"
        + A.flags.map(f => '<div class="ss-flag">' + esc(f.text) + "<small>" + esc(f.advice) + "</small></div>").join("")
        + (A.muscles.length ? '<div class="ss-muscles">' + A.muscles.map(m => '<div class="ss-m"><span>' + esc(m.label) + "</span>" + bar(m.score) + "<b>" + f0(m.score) + "</b></div>").join("") + "</div>" : "")
        + '<details><summary>Per lift (' + A.lifts.length + ")</summary><table><thead><tr><th>Lift</th><th class=\"r\">Est. 1RM</th><th class=\"r\">× BW</th><th class=\"r\">Score</th></tr></thead><tbody>"
        + A.lifts.map(r => "<tr><td>" + esc(r.name) + '</td><td class="r">' + f0(r.e1rmKg) + ' kg</td><td class="r">' + f2(r.ratio) + '</td><td class="r">' + f0(r.score) + " · " + esc(r.level) + "</td></tr>").join("")
        + "</tbody></table>" + (A.skipped.length ? '<ul class="ss-notes">' + A.skipped.map(s => "<li>Not scored: " + esc(s.name) + " (" + esc(s.why) + ")</li>").join("") + "</ul>" : "") + "</details>";
    }
    return '<section class="card ss-card"><h3>Strength score</h3>' + body + (A.notes.length ? '<ul class="ss-notes">' + A.notes.map(n => "<li>" + esc(n) + "</li>").join("") + "</ul>" : "") + "</section>";
  }

  function summary(docs, opts) {
    const A = fromDocs(docs, opts);
    if (A.overall == null) return "Strength score: not available yet (" + (A.notes[0] || "no scorable lifts") + ")";
    const out = ["Strength score " + f0(A.overall) + "/100 (" + A.level + ")" + (A.change28 != null ? ", " + (A.change28 >= 0 ? "+" : "") + f0(A.change28) + " in 28 days" : "") + ", body weight " + f0(A.bodyKg) + " kg."];
    out.push("Push " + f0(A.groups.push.score) + ", pull " + f0(A.groups.pull.score) + ", legs " + f0(A.groups.legs.score) + ".");
    A.flags.forEach(f => out.push("Imbalance: " + f.text + " " + f.advice));
    if (!A.flags.length) out.push("No push/pull or upper/lower imbalance.");
    return out.join("\n");
  }

  return { css, compute, fromDocs, html, summary, patternFor, scoreOf, levelOf, levelIdx, STANDARDS, LEVELS, GROUPS, GAP, STALE_DAYS, KIND_WEIGHT };
})();

if (typeof module !== "undefined" && module.exports) module.exports = StrengthScore;
