/* StrongCSV: turns a Strong app export (Settings > Export Strong Data > CSV) into
 * the app's workouts/{date} docs. Plain JS, no imports, no network.
 *
 *   StrongCSV.parse(text, {unit})            -> [{date, title, durationMin, exercises:[{name, sets:[{w,r,kind,unit}]}]}]
 *   StrongCSV.toWorkouts(text, opts)          -> {docs:{<date>:workoutDoc}, report}
 *     opts.program   PROGRAM object ({session:[[name,w,r,sets,unit,...]]}), required
 *     opts.rotation  ROTATION array, required
 *     opts.existing  current workouts docs by date (manual sets are kept for exercises Strong didn't log)
 *     opts.unit      "kg" | "lb": weight unit when the CSV header doesn't say (Strong's own unit setting). Default "kg".
 *     opts.since     ISO date; skip workouts before it
 *   StrongCSV.matchName(strongName, programNames) -> app exercise name or null
 *
 * Handles both export layouts: the older comma file ("Weight", "Duration" like "1h 5m")
 * and the newer semicolon file ("Weight (kg)" / "Weight (lbs)", "Duration (sec)", "Workout #").
 * Warm-up sets ("W") are dropped; drop ("D") and failure ("F") sets are kept. "Rest Timer" rows are ignored.
 * Weights are converted to the unit the program lists for that exercise (lb for the DB lifts).
 */
const StrongCSV = (() => {
  const LB = 0.45359237;

  function splitRows(text, delim) {
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); cur = "";
        if (row.some(c => c !== "")) rows.push(row);
        row = [];
      } else cur += ch;
    }
    row.push(cur); if (row.some(c => c !== "")) rows.push(row);
    return rows;
  }

  const norm = s => String(s || "").toLowerCase().replace(/\(.*?\)/g, m => " " + m.slice(1, -1) + " ")
    .replace(/[^a-z0-9]+/g, " ").trim();

  function num(v) {
    if (v == null) return null;
    const s = String(v).trim().replace(",", ".");
    if (s === "") return null;
    const n = parseFloat(s); return isFinite(n) ? n : null;
  }

  function durationMin(v, secHeader) {
    if (v == null || v === "") return null;
    if (secHeader) { const n = num(v); return n == null ? null : Math.round(n / 60); }
    let m = 0, hit = false;
    String(v).replace(/(\d+)\s*h/, (_, h) => { m += h * 60; hit = true; }).replace(/(\d+)\s*m/, (_, x) => { m += +x; hit = true; });
    if (!hit) { const n = num(v); return n == null ? null : Math.round(n / 60); }
    return m;
  }

  function parse(text, opts) {
    opts = opts || {};
    text = String(text || "").replace(/^﻿/, "");
    const first = text.split(/\r?\n/, 1)[0] || "";
    const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
    const rows = splitRows(text, delim);
    if (!rows.length) throw new Error("The file is empty.");
    const head = rows[0].map(h => h.trim());
    const col = re => head.findIndex(h => re.test(h));
    const c = {
      date: col(/^date$/i), title: col(/^workout name$/i), dur: col(/^duration/i), ex: col(/^exercise name$/i),
      order: col(/^set order$/i), w: col(/^weight/i), r: col(/^reps$/i), num: col(/^workout #$/i),
    };
    if (c.date < 0 || c.ex < 0 || c.w < 0 || c.r < 0) throw new Error("This doesn't look like a Strong export (no Date / Exercise Name / Weight / Reps columns).");
    const wHead = head[c.w];
    const unit = /lb/i.test(wHead) ? "lb" : /kg/i.test(wHead) ? "kg" : (opts.unit === "lb" ? "lb" : "kg");
    const secDur = c.dur >= 0 && /sec/i.test(head[c.dur]);

    const byKey = new Map();
    for (const r of rows.slice(1)) {
      const rawDate = (r[c.date] || "").trim();
      const order = c.order >= 0 ? (r[c.order] || "").trim() : "";
      if (!rawDate || /rest/i.test(order)) continue;
      const date = rawDate.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const key = (c.num >= 0 ? r[c.num] : "") + "|" + rawDate + "|" + (r[c.title] || "");
      let wo = byKey.get(key);
      if (!wo) {
        wo = { date, start: rawDate, title: (c.title >= 0 ? r[c.title] : "").trim(), durationMin: c.dur >= 0 ? durationMin(r[c.dur], secDur) : null, exercises: [] };
        byKey.set(key, wo);
      }
      const name = (r[c.ex] || "").trim(); if (!name) continue;
      let ex = wo.exercises.find(e => e.name === name);
      if (!ex) { ex = { name, sets: [] }; wo.exercises.push(ex); }
      const kind = /^w$/i.test(order) ? "warmup" : /^d$/i.test(order) ? "drop" : /^f$/i.test(order) ? "failure" : "working";
      const w = num(r[c.w]), reps = num(r[c.r]);
      if (reps == null && w == null) continue;
      ex.sets.push({ w: w == null ? 0 : w, r: reps == null ? 0 : Math.round(reps), kind, unit });
    }
    return [...byKey.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
  }

  // Strong built-in names Aziz's gym exercises are likely saved under -> app names.
  const ALIASES = {
    "bench press barbell": "Bench Press (Barbell)",
    "lateral raise cable": "Lateral Raise (Cable)",
    "incline bench press dumbbell": "Incline DB Press",
    "incline dumbbell press": "Incline DB Press",
    "cable crossover": "Cable Crossover",
    "triceps extension cable": "Triceps Extension (Cable)",
    "triceps pushdown cable straight bar": "Triceps Pushdown (Straight bar)",
    "triceps pushdown": "Triceps Pushdown (Straight bar)",
    "triceps pushdown cable": "Triceps Pushdown (Straight bar)",
    "triceps pushdown rope": "Triceps Rope",
    "triceps rope pushdown": "Triceps Rope",
    "lateral raise machine": "Standing Side Delts (Machine)",
    "lat pulldown cable": "Lat Pulldown, Wide",
    "lat pulldown wide grip": "Lat Pulldown, Wide",
    "wide grip lat pulldown": "Lat Pulldown, Wide",
    "lat pulldown single arm": "Lat Pulldown, Single Arm",
    "single arm lat pulldown": "Lat Pulldown, Single Arm",
    "seated row cable": "Seated Row (Cable)",
    "seated cable row": "Seated Row (Cable)",
    "pullover machine": "Pullover (Machine)",
    "bicep curl dumbbell": "DB Curl",
    "biceps curl dumbbell": "DB Curl",
    "bicep curl machine": "Seated Bicep Curl",
    "preacher curl machine": "Seated Bicep Curl",
    "reverse fly machine": "Reverse Fly (Machine)",
    "rear delt fly machine": "Reverse Fly (Machine)",
    "leg extension machine": "Leg Extension",
    "hack squat": "Hack Squat",
    "hack squat machine": "Hack Squat",
    "squat smith machine": "Smith Squat",
    "smith machine squat": "Smith Squat",
    "lying leg curl machine": "Lying Leg Curl",
    "leg curl machine": "Lying Leg Curl",
    "hip adductor machine": "Hip Adductor",
    "hip abductor machine": "Hip Abductor",
    "standing calf raise machine": "Standing Calf Raise",
    "calf press on leg press": "Calf Press on Seated Leg Press",
    "calf press machine": "Calf Press on Seated Leg Press",
    "seated calf raise machine": "Calf Press on Seated Leg Press",
    "crunch machine": "Seated Abs",
    "ab crunch machine": "Seated Abs",
    "chest press machine": "Gundam (Chest Machine)",
    "seated overhead press dumbbell": "Seated DB Overhead Press",
    "overhead press dumbbell": "Seated DB Overhead Press",
    "shoulder press dumbbell": "Seated DB Overhead Press",
    "front raise dumbbell": "Front Raise (DB)",
    "lateral raise dumbbell": "Side Delts",
    "t bar row": "T-Bar Row",
    "iso lateral row machine": "Iso-Lateral Low Row",
    "iso lateral low row": "Iso-Lateral Low Row",
    "shrug machine": "Traps Machine",
    "bicep curl cable": "Cable Standing Biceps",
    "biceps curl cable": "Cable Standing Biceps",
    // Names from Aziz's real export (Nov 2024 - Oct 2026).
    "lat pulldown wide grip cable": "Lat Pulldown, Wide",
    "lat pulldown wide grip": "Lat Pulldown, Wide",
    "traps machine front back": "Traps Machine",
    "traps machine": "Traps Machine",
    "triceps rope cable": "Triceps Rope",
    "triceps rope": "Triceps Rope",
    "gundam": "Gundam (Chest Machine)",
    "gundam chest machine": "Gundam (Chest Machine)",
    "standing side delts": "Standing Side Delts (Machine)",
    "side delts shoulders": "Side Delts",
    "side delts": "Side Delts",
    "flat bench barbell": "Bench Press (Barbell)",
    "iso lateral low row plate": "Iso-Lateral Low Row",
    "bicep seated curl": "Seated Bicep Curl",
    "seated bicep curl": "Seated Bicep Curl",
  };

  function matchName(strongName, names) {
    const n = norm(strongName);
    const exact = names.find(x => norm(x) === n);
    if (exact) return exact;
    const a = ALIASES[n];
    if (a && names.includes(a)) return a;
    // Token overlap fallback, only when it's clearly one exercise: every token of the
    // shorter name must appear in the longer one, so "Bench Press (Dumbbell)" never
    // lands on "Bench Press (Barbell)" and "seated chest cable" never on "Seated Row (Cable)".
    const toks = new Set(n.split(" ").filter(t => t.length > 1));
    let best = null, bestScore = 0, second = 0;
    for (const x of names) {
      const xt = norm(x).split(" ").filter(t => t.length > 1);
      const hit = xt.filter(t => toks.has(t)).length;
      if (hit < Math.min(xt.length, toks.size)) continue;
      const score = hit / Math.max(xt.length, toks.size);
      if (score > bestScore) { second = bestScore; bestScore = score; best = x; } else if (score > second) second = score;
    }
    return bestScore >= 0.6 && bestScore - second >= 0.2 ? best : null;
  }

  function convert(w, from, to) {
    if (from === to) return w;
    const v = from === "lb" ? w * LB : w / LB;
    return Math.round(v * 4) / 4;
  }

  function toWorkouts(text, opts) {
    const { program, rotation } = opts || {};
    if (!program || !rotation) throw new Error("toWorkouts needs opts.program and opts.rotation.");
    const existing = opts.existing || {};
    const sessions = Object.keys(program);
    const unitOf = {};
    sessions.forEach(s => program[s].forEach(e => { unitOf[e[0]] = e[4] || "kg"; }));
    const allNames = Object.keys(unitOf);
    const parsed = parse(text, opts).filter(w => !opts.since || w.date >= opts.since);

    const docs = {}, report = { workouts: 0, days: 0, sets: 0, unmatched: {}, sessions: {} };
    for (const wo of parsed) {
      // Session: from the Strong workout title ("Push A", "Pull B – day 5"…), else best exercise overlap.
      const t = norm(wo.title);
      let session = sessions.find(s => t.includes(norm(s))) || null;
      if (!session) {
        let best = 0;
        for (const s of sessions) {
          const names = program[s].map(e => e[0]);
          const hits = wo.exercises.filter(e => matchName(e.name, names)).length;
          if (hits > best) { best = hits; session = s; }
        }
      }
      const pool = session ? program[session].map(e => e[0]) : [];
      const doc = docs[wo.date] || Object.assign({ date: wo.date, sets: {} }, JSON.parse(JSON.stringify(existing[wo.date] || {})));
      doc.sets = doc.sets || {};
      if (!docs[wo.date] && doc.strong && Array.isArray(doc.strong.names)) {
        // Earlier Strong import of this day: drop its exercises (even ones saved under an old name) before re-adding.
        doc.strong.names.forEach(k => { delete doc.sets[k]; });
      }
      if (session && (!doc.session || doc.source === "strong" || !docs[wo.date])) {
        doc.session = session; doc.idx = rotation.indexOf(session);
      }
      for (const ex of wo.exercises) {
        const name = matchName(ex.name, pool) || matchName(ex.name, allNames);
        if (!name) { report.unmatched[ex.name] = (report.unmatched[ex.name] || 0) + 1; }
        const key = name || ex.name;
        // An older import saved this exercise under its Strong name: drop that copy so the day isn't doubled.
        if (name && name !== ex.name && doc.source === "strong" && !(doc.strongNames || []).includes(ex.name)) delete doc.sets[ex.name];
        const to = unitOf[key] || ex.sets[0]?.unit || "kg";
        const sets = ex.sets.filter(s => s.kind !== "warmup" && s.r > 0).map(s => ({ w: convert(s.w, s.unit, to), r: s.r }));
        if (!sets.length) continue;
        doc.sets[key] = (doc.strongNames && doc.strongNames.includes(key)) ? doc.sets[key].concat(sets) : sets; // two Strong names on one app name (same day) add up
        doc.strongNames = (doc.strongNames || []).concat(key);
        report.sets += sets.length;
      }
      doc.source = "strong";
      doc.strong = { title: wo.title, durationMin: wo.durationMin, importedAt: new Date().toISOString(), names: [] };
      if (!docs[wo.date]) report.days++;
      docs[wo.date] = doc;
      report.workouts++;
      if (session) report.sessions[session] = (report.sessions[session] || 0) + 1;
    }
    for (const d of Object.values(docs)) { d.strong.names = [...new Set(d.strongNames || [])]; delete d.strongNames; }
    return { docs, report };
  }

  return { parse, toWorkouts, matchName, ALIASES };
})();
if (typeof module !== "undefined") module.exports = StrongCSV;
