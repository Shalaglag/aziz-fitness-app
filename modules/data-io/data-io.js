/* DataIO: imports, backups and restore for the app shell.
 * Plain JS, no imports, no network. Works on a snapshot of the app's collections
 * ({<collection>: {<docId>: doc}}) and returns plans of writes; it never touches storage itself.
 *
 *   DataIO.makeBackup(snapshot, {now, appVersion})     -> backup object (JSON.stringify it to save)
 *   DataIO.readBackup(textOrObject)                     -> {source, schema, exported, collections, counts, warnings}
 *        Reads this module's backups, the shell's own browser save ("aziz-cut" localStorage blob)
 *        and Liftbook backups (liftbook-backup-*.json). Older formats are migrated, bad docs dropped with a warning.
 *   DataIO.planRestore(backup, current, {mode})        -> plan
 *        mode "merge" (default): adds what's missing, fills empty fields, never overwrites what you have.
 *        mode "replace": the backup wins; docs not in the backup are removed (only in collections the backup has).
 *   DataIO.detect(text, filename)                       -> kind id (see KINDS) or null
 *   DataIO.importText(text, opts)                       -> plan
 *        opts: {filename, kind, current, today, now, unit, overwrite, program, rotation, deps:{StrongCSV, Steps, WaterH}}
 *   DataIO.applyPlan(plan, {put, remove})               -> Promise<count>; put(col,id,doc), remove(col,id)
 *   DataIO.toCsv(snapshot, what, opts)                  -> CSV text; what: "weights" | "food" | "workouts" | "daily"
 *        opts (daily only): {kcalTarget(date) -> kcal, proteinMin} from AppTargets / the shell; adds target columns
 *   DataIO.mount(host, opts)                            -> {refresh()}; the "Your data" card (see README)
 *
 * A plan is {kind, label, writes:[{col,id,doc}], deletes:[{col,id}], counts:{col:{add,update,same,kept,remove}},
 *            lines:[human summary], warnings:[string], range:{from,to}|null}.
 * Nothing is invented: rows without a usable date or value are skipped and counted in warnings.
 */
const DataIO = (() => {
  const FORMAT = "aziz-fitness-backup";
  const SCHEMA = 1;

  // Collections the shell and its mounted modules keep. Unknown collections found in a snapshot are backed up too.
  const COLLECTIONS = {
    days: "Days (food, water, steps, sleep)", weights: "Weigh-ins", workouts: "Workouts", prefs: "Settings",
    meals: "Saved meals", barcodes: "Scanned foods", photos: "Progress photo records", menus: "Imported menus",
    lb_workouts: "Full-logger workouts", lb_templates: "Workout templates", lb_exercises: "Custom exercises",
    lb_measures: "Body measurements", lb_meta: "Logger settings", cardio: "Cardio sessions", markers: "Health markers", runs: "GPS runs (routes)",
  };
  const DATE_KEYED = ["days", "weights", "workouts", "cardio", "runs"];

  const KINDS = {
    backup: "App backup",
    strong: "Strong workouts",
    hevy: "Hevy workouts",
    "workouts-csv": "Workout log (CSV)",
    nutrition: "Food log",
    weights: "Weigh-ins",
    measurements: "Body measurements",
    steps: "Steps",
    water: "Water",
    health: "Health export (weight, steps, water)",
  };

  // ---------- small helpers ----------
  const clone = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
  const isObj = o => o && typeof o === "object" && !Array.isArray(o);
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const pad = n => String(n).padStart(2, "0");
  const localISO = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const round = (n, p) => { const k = Math.pow(10, p || 0); return Math.round(n * k) / k; };

  function stable(v) {
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    if (isObj(v)) return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
    return JSON.stringify(v);
  }
  const same = (a, b) => stable(a) === stable(b);

  function num(v) {
    if (v == null) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    let s = String(v).trim().replace(/\s/g, "");
    if (!s || s === "-") return null;
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    else s = s.replace(",", ".");
    const m = s.match(/^-?\d*\.?\d+/);
    return m ? parseFloat(m[0]) : null;
  }

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function valid(y, m, d) { return y > 1970 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31; }
  function ymd(y, m, d) { return y + "-" + pad(m) + "-" + pad(d); }

  // Reads one date/time cell. Returns {date, time, ambiguous} or null.
  // Times with a zone (Z, +03:00) or epoch numbers are moved to this device's local day.
  function parseWhen(v, opts) {
    if (v == null) return null;
    let s = String(v).trim();
    if (!s) return null;
    const timeOf = str => { const t = str.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i); if (!t) return null; let h = +t[1]; if (t[3]) { const pm = /p/i.test(t[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; } return pad(h) + ":" + t[2]; };
    if (/^\d{10}(\.\d+)?$|^\d{13}$/.test(s)) {
      const d = new Date(s.length === 13 ? +s : +s * 1000);
      return { date: localISO(d), time: pad(d.getHours()) + ":" + pad(d.getMinutes()) };
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s) || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})? ?[+-]\d{4}$/.test(s)) {
      const d = new Date(s.replace(" ", "T").replace(/ ?([+-]\d{2})(\d{2})$/, "$1:$2"));
      if (!isNaN(d)) return { date: localISO(d), time: pad(d.getHours()) + ":" + pad(d.getMinutes()) };
    }
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m && valid(+m[1], +m[2], +m[3])) return { date: ymd(+m[1], +m[2], +m[3]), time: timeOf(s.slice(m[0].length)) };
    m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*\.?[ -,]+(\d{4})/);            // 25 Oct 2026, 25-Oct-2026
    if (m && MONTHS[m[2].toLowerCase()] && valid(+m[3], MONTHS[m[2].toLowerCase()], +m[1])) return { date: ymd(+m[3], MONTHS[m[2].toLowerCase()], +m[1]), time: timeOf(s.slice(m[0].length)) };
    m = s.match(/^([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}),? (\d{4})/);                    // Oct 25, 2026
    if (m && MONTHS[m[1].toLowerCase()] && valid(+m[3], MONTHS[m[1].toLowerCase()], +m[2])) return { date: ymd(+m[3], MONTHS[m[1].toLowerCase()], +m[2]), time: timeOf(s.slice(m[0].length)) };
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);                            // 25/10/2026 or 10/25/2026
    if (m) {
      let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
      let day, mon, ambiguous = false;
      if (a > 12) { day = a; mon = b; } else if (b > 12) { day = b; mon = a; }
      else { ambiguous = a !== b; const mdy = opts && opts.dateOrder === "mdy"; day = mdy ? b : a; mon = mdy ? a : b; }
      if (valid(y, mon, day)) return { date: ymd(y, mon, day), time: timeOf(s.slice(m[0].length)), ambiguous };
    }
    return null;
  }

  // ---------- CSV ----------
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
        if (row.some(c => c.trim() !== "")) rows.push(row);
        row = [];
      } else cur += ch;
    }
    row.push(cur); if (row.some(c => c.trim() !== "")) rows.push(row);
    return rows;
  }

  // Returns {head (lowercased, trimmed), rows, col(regex|[regex], not?)}. Skips Samsung Health's metadata first line.
  function readCsv(text) {
    text = String(text || "").replace(/^﻿/, "");
    let lines = text.split(/\r?\n/);
    if (/^com\.samsung\./i.test(lines[0] || "")) { lines = lines.slice(1); text = lines.join("\n"); }
    const first = lines.find(l => l.trim()) || "";
    const count = ch => first.split(ch).length - 1;
    const delim = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0];
    const rows = splitRows(text, delim);
    if (!rows.length) return null;
    const head = rows[0].map(h => h.trim().toLowerCase().replace(/^com\.samsung\.health\.[a-z_.]*\./, ""));
    const col = (res, not) => {
      for (const re of [].concat(res)) { const i = head.findIndex(h => re.test(h) && !(not && not.test(h))); if (i >= 0) return i; }
      return -1;
    };
    return { head, rows: rows.slice(1), col };
  }

  const csvCell = v => { v = v == null ? "" : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const toCsvText = rows => rows.map(r => r.map(csvCell).join(",")).join("\n") + "\n";

  // ---------- validation ----------
  function cleanFoodItem(it, warn) {
    if (!isObj(it) || typeof it.name !== "string" || !it.name.trim()) { warn("a food item without a name"); return null; }
    const o = clone(it);
    for (const k of ["kcal", "p", "c", "f"]) {
      if (o[k] == null || o[k] === "") { o[k] = k === "kcal" ? null : 0; continue; }
      const n = num(o[k]); if (n == null || n < 0) { warn("a food item with a bad " + k + " value (" + it.name + ")"); return null; }
      o[k] = n;
    }
    if (o.kcal == null) { warn("a food item without calories (" + it.name + ")"); return null; }
    if (!o.id) o.id = "r" + Math.abs(hash(stable(it))).toString(36);
    o.eaten = !!o.eaten;
    return o;
  }

  // Returns the cleaned doc, or null (and a warning) when it can't be kept.
  function cleanDoc(col, id, doc, warn) {
    if (!isObj(doc)) { warn(col + "/" + id + " is not a record"); return null; }
    const d = clone(doc);
    if (DATE_KEYED.includes(col)) {
      if (!ISO.test(id)) { warn(col + "/" + id + " has no valid date"); return null; }
      d.date = id;
    }
    if (col === "weights") {
      const kg = num(d.kg);
      if (kg == null || kg < 25 || kg > 350) { warn("weigh-in on " + id + " has no usable weight"); return null; }
      d.kg = round(kg, 2);
    }
    if (col === "days") {
      if (d.food != null) {
        if (!Array.isArray(d.food)) { warn("days/" + id + " food list is broken; dropped the list"); d.food = []; }
        else d.food = d.food.map(it => cleanFoodItem(it, w => warn(id + ": skipped " + w))).filter(Boolean);
      }
      if (d.water != null && num(d.water) == null) { warn("days/" + id + " water is not a number; dropped it"); delete d.water; }
      else if (d.water != null) d.water = num(d.water);
    }
    if (col === "workouts" && d.sets != null) {
      if (!isObj(d.sets)) { warn("workouts/" + id + " sets are broken; dropped them"); d.sets = {}; }
      else for (const k of Object.keys(d.sets)) {
        const arr = Array.isArray(d.sets[k]) ? d.sets[k] : [];
        d.sets[k] = arr.filter(s => isObj(s) && num(s.r) != null).map(s => Object.assign({}, s, { w: num(s.w) || 0, r: num(s.r) }));
        if (!d.sets[k].length) delete d.sets[k];
      }
    }
    return d;
  }

  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  // ---------- backups ----------
  function makeBackup(snapshot, opts) {
    opts = opts || {};
    const now = opts.now ? new Date(opts.now) : new Date();
    const collections = {}, counts = {};
    for (const col of Object.keys(snapshot || {})) {
      const docs = snapshot[col];
      if (!isObj(docs)) continue;
      const out = {};
      for (const id of Object.keys(docs)) {
        if (col === "lb_meta" && id === "active") continue;            // an in-progress workout is not history
        if (docs[id] !== undefined) out[id] = clone(docs[id]);
      }
      collections[col] = out; counts[col] = Object.keys(out).length;
    }
    return {
      format: FORMAT, schema: SCHEMA, exported: now.toISOString(), app: "Aziz Cut Tracker",
      appVersion: opts.appVersion || null, counts, collections,
      notes: ["Progress photo images stay in the app; this file holds their records (date, pose, link) only."],
    };
  }

  function backupFilename(now) { return "fitness-backup-" + localISO(now ? new Date(now) : new Date()) + ".json"; }

  // Format migrations: MIGRATIONS[n] turns a schema-n backup into schema n+1.
  // Schema 0 is the shell's own browser save: {days:{}, weights:{}, ...} at the top level.
  const MIGRATIONS = {
    0: raw => {
      const collections = {};
      for (const k of Object.keys(raw)) if (isObj(raw[k])) collections[k] = raw[k];
      return { format: FORMAT, schema: 1, exported: null, collections };
    },
  };

  function fromLiftbook(j) {
    const data = j.data || {}, collections = {};
    for (const [k, col] of [["templates", "lb_templates"], ["workouts", "lb_workouts"], ["exercises", "lb_exercises"], ["measures", "lb_measures"]]) {
      if (!isObj(data[k])) continue;
      collections[col] = {};
      for (const doc of Object.values(data[k])) if (isObj(doc) && doc.id) collections[col][doc.id] = doc;
    }
    if (isObj(j.settings)) collections.lb_meta = { settings: Object.assign({ id: "settings" }, j.settings) };
    return { format: FORMAT, schema: 1, exported: j.exported ? new Date(j.exported).toISOString() : null, collections };
  }

  function looksLikeBrowserSave(j) {
    const keys = Object.keys(j);
    return keys.length > 0 && ["days", "weights", "workouts"].some(k => isObj(j[k])) &&
      keys.every(k => isObj(j[k]));
  }

  function readBackup(input) {
    let j = input;
    if (typeof input === "string") {
      try { j = JSON.parse(input.replace(/^﻿/, "")); }
      catch (e) { throw new Error("This file isn't valid JSON, so it can't be a backup."); }
    }
    if (!isObj(j)) throw new Error("This file isn't a backup from the app.");
    let source, b;
    if (j.format === FORMAT) {
      if (!(j.schema >= 0)) throw new Error("This backup has no version number.");
      if (j.schema > SCHEMA) throw new Error("This backup was made by a newer version of the app. Update the app first.");
      source = "app"; b = j;
    } else if (j.app === "liftbook" && isObj(j.data)) { source = "liftbook"; b = fromLiftbook(j); }
    else if (looksLikeBrowserSave(j)) { source = "browser-save"; b = Object.assign({ schema: 0 }, j); }
    else throw new Error("This file isn't a backup from the app, Liftbook or the browser save.");
    const fromSchema = b.schema;
    while (b.schema < SCHEMA) b = MIGRATIONS[b.schema](b);
    if (!isObj(b.collections)) throw new Error("This backup has no data in it.");

    const warnings = [], collections = {}, counts = {};
    let skipped = 0;
    for (const col of Object.keys(b.collections)) {
      const docs = b.collections[col]; if (!isObj(docs)) { warnings.push("Skipped " + col + ": not a list of records"); continue; }
      collections[col] = {};
      for (const id of Object.keys(docs)) {
        if (col === "lb_meta" && id === "active") continue;
        const d = cleanDoc(col, id, docs[id], w => { warnings.push(w); });
        if (d) collections[col][id] = d; else skipped++;
      }
      counts[col] = Object.keys(collections[col]).length;
    }
    if (skipped) warnings.unshift(skipped + " record" + (skipped === 1 ? "" : "s") + " couldn't be read and will be left out.");
    return { source, schema: fromSchema, exported: b.exported || null, collections, counts, warnings };
  }

  // Merge helper: keeps everything in `cur`, adds what `bak` has and `cur` lacks.
  // Food lists are joined by item id. Other arrays are left as they are in `cur`.
  function fillMissing(cur, bak, key) {
    if (cur === undefined || cur === null || cur === "") return clone(bak);
    if (key === "food" && Array.isArray(cur) && Array.isArray(bak)) {
      const ids = new Set(cur.map(i => i && i.id));
      return cur.concat(bak.filter(i => i && !ids.has(i.id)).map(clone));
    }
    if (isObj(cur) && isObj(bak)) {
      const out = Object.assign({}, cur);
      for (const k of Object.keys(bak)) out[k] = fillMissing(cur[k], bak[k], k);
      return out;
    }
    return cur;
  }

  function emptyCounts() { return { add: 0, update: 0, same: 0, kept: 0, remove: 0 }; }

  function planRestore(backup, current, opts) {
    const mode = (opts && opts.mode) === "replace" ? "replace" : "merge";
    current = current || {};
    const writes = [], deletes = [], counts = {};
    for (const col of Object.keys(backup.collections)) {
      const bak = backup.collections[col], cur = current[col] || {}, c = counts[col] = emptyCounts();
      for (const id of Object.keys(bak)) {
        const have = cur[id];
        if (have === undefined) { writes.push({ col, id, doc: clone(bak[id]) }); c.add++; continue; }
        if (same(have, bak[id])) { c.same++; continue; }
        if (mode === "replace") { writes.push({ col, id, doc: clone(bak[id]) }); c.update++; continue; }
        const merged = fillMissing(have, bak[id]);
        if (same(merged, have)) c.kept++;
        else { writes.push({ col, id, doc: merged }); c.update++; }
      }
      if (mode === "replace") for (const id of Object.keys(cur)) {
        if (bak[id] === undefined && !(col === "lb_meta" && id === "active")) { deletes.push({ col, id }); c.remove++; }
      }
    }
    const lines = [];
    for (const col of Object.keys(counts)) {
      const c = counts[col], name = COLLECTIONS[col] || col, bits = [];
      if (c.add) bits.push(c.add + " new");
      if (c.update) bits.push(c.update + (mode === "merge" ? " filled in" : " replaced"));
      if (c.kept) bits.push(c.kept + " kept as you have them");
      if (c.remove) bits.push(c.remove + " removed");
      if (c.same) bits.push(c.same + " already the same");
      if (bits.length) lines.push(name + ": " + bits.join(", "));
    }
    const dates = Object.keys(backup.collections.days || {}).concat(Object.keys(backup.collections.weights || {}), Object.keys(backup.collections.workouts || {})).sort();
    return {
      kind: "backup", label: KINDS.backup + (backup.source === "liftbook" ? " (Liftbook)" : backup.source === "browser-save" ? " (browser save)" : ""),
      mode, writes, deletes, counts, lines, warnings: backup.warnings.slice(),
      range: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    };
  }

  // ---------- detection ----------
  function sniffJson(text) {
    try { return JSON.parse(text.replace(/^﻿/, "")); } catch (e) { return undefined; }
  }

  function detect(text, filename) {
    text = String(text || "").replace(/^﻿/, "");
    const t = text.trim(), fn = String(filename || "").toLowerCase();
    if (!t) return null;
    if (t[0] === "{" || t[0] === "[") {
      const j = sniffJson(t);
      if (j === undefined) return null;
      if (isObj(j) && (j.format === FORMAT || (j.app === "liftbook" && j.data) || looksLikeBrowserSave(j))) return "backup";
      const arr = Array.isArray(j) ? j : null;
      const first = arr && arr.find(isObj);
      if (first && ("kg" in first || "weight" in first || "weightKg" in first || "weight_kg" in first)) return "weights";
      if (first && ("waist" in first || "chest" in first || "bodyfat" in first)) return "measurements";
      return "steps";                                    // Fitbit / Garmin JSON; the steps parser decides
    }
    if (/<HealthData|<Record\b/.test(t.slice(0, 5000)) || /HKQuantityTypeIdentifier/.test(t)) return "health";
    if (/^(WATERH)\b/im.test(t)) return "water";
    if (/^(STEPS)\b/im.test(t)) return "steps";
    const csv = readCsv(t);
    if (!csv) return null;
    const h = csv.head, has = re => h.some(x => re.test(x));
    if (has(/^exercise_title$/) && has(/^set_type$/)) return "hevy";
    if (has(/^exercise name$/) && (has(/^set order$/) || has(/^workout name$/))) return "strong";
    if (has(/^(type|data ?type|metric|record ?type)$/) && has(/^(value|qty|amount)$/)) return "health";
    if (has(/^(food name|food|item|description|name)$/) && has(/calor|energy|kcal/)) return "nutrition";
    if (has(/^(meal|group|meal name)$/) && has(/calor|energy|kcal/)) return "nutrition";
    if (has(/^(exercise|exercise name|movement|lift)$/) && has(/^reps?$/)) return "workouts-csv";
    if (has(/waist|chest|hips?\b|neck|bicep|thigh|body ?fat|fat ?%/)) return "measurements";
    if (has(/(^|[^a-z])(weight|body ?mass)([^a-z]|$)/) && !has(/^reps?$/)) return "weights";
    if (has(/energy \(kcal\)|^calories/) && has(/protein/)) return "nutrition";
    if (has(/water|hydration|volume/) || /water/.test(fn)) return "water";
    if (has(/step/) || /step/.test(fn)) return "steps";
    return null;
  }

  // ---------- weigh-ins ----------
  function weightUnit(label, fallback) {
    const s = String(label || "").toLowerCase();
    if (/\b(lb|lbs|pounds?)\b/.test(s)) return "lb";
    if (/\bkg|kilo/.test(s)) return "kg";
    if (/\bst\b|stone/.test(s)) return "st";
    return fallback;
  }
  const toKg = (v, unit) => unit === "lb" ? v * 0.45359237 : unit === "st" ? v * 6.35029318 : v;

  // -> {rows:[{date, time, kg}], skipped, ambiguous}
  function parseWeights(text, opts) {
    opts = opts || {};
    const fallback = opts.unit === "lb" ? "lb" : "kg";
    const out = []; let skipped = 0, ambiguous = 0;
    const push = (when, val, unit) => {
      if (!when) { skipped++; return; }
      const kg = toKg(val, unit);
      if (val == null || !(kg >= 25 && kg <= 350)) { skipped++; return; }
      if (when.ambiguous) ambiguous++;
      out.push({ date: when.date, time: when.time || null, kg: round(kg, 2) });
    };
    const t = String(text || "").replace(/^﻿/, "").trim();
    if (/HKQuantityTypeIdentifierBodyMass"/.test(t)) {
      const re = /<Record\b[^>]*type="HKQuantityTypeIdentifierBodyMass"[^>]*>/g; let m;
      while ((m = re.exec(t))) {
        const attr = k => (m[0].match(new RegExp("\\b" + k + '="([^"]*)"')) || [])[1];
        push(parseWhen(attr("startDate")), num(attr("value")), weightUnit(attr("unit"), "kg"));
      }
    } else if (t[0] === "[" || t[0] === "{") {
      const j = sniffJson(t); const arr = Array.isArray(j) ? j : isObj(j) && Array.isArray(j.weights) ? j.weights : [];
      for (const r of arr) {
        if (!isObj(r)) { skipped++; continue; }
        const v = r.kg != null ? num(r.kg) : num(r.weightKg != null ? r.weightKg : r.weight_kg != null ? r.weight_kg : r.weight);
        const unit = r.kg != null || r.weightKg != null || r.weight_kg != null ? "kg" : weightUnit(r.unit, weightUnit(r.weight, fallback));
        push(parseWhen(r.date || r.time || r.timestamp || r.calendarDate, opts), v, unit);
      }
    } else if (t) {
      const csv = readCsv(t); if (!csv) return { rows: [], skipped, ambiguous };
      const typeCol = csv.col(/^(type|data ?type|metric|record ?type)$/);
      const dateCol = csv.col([/^(date|day)$/, /^(start_?time|time of measurement|measured|timestamp|datetime|date ?time|time|create_time)$/, /date|time/]);
      if (dateCol < 0) throw new Error("No date column found.");
      if (typeCol >= 0) {
        const valCol = csv.col(/^(value|qty|amount)$/), unitCol = csv.col(/^unit/);
        for (const r of csv.rows) {
          if (!/weight|body ?mass/i.test(r[typeCol] || "") || /fat|lean|goal/i.test(r[typeCol])) continue;
          push(parseWhen(r[dateCol], opts), num(r[valCol]), weightUnit(unitCol >= 0 ? r[unitCol] : "", weightUnit(r[valCol], fallback)));
        }
      } else {
        const wCol = csv.col([/^(weight|body ?weight|body ?mass)\b/, /(^|[^a-z])(weight|body ?mass)([^a-z]|$)/], /goal|target|change|diff|fat|water|bone|muscle|lean|ideal/);
        if (wCol < 0) throw new Error("No weight column found.");
        const unitCol = csv.col(/^unit/);
        const headUnit = weightUnit(csv.head[wCol], null);
        for (const r of csv.rows) {
          const cell = r[wCol];
          push(parseWhen(r[dateCol], opts), num(cell), headUnit || weightUnit(cell, unitCol >= 0 ? weightUnit(r[unitCol], fallback) : fallback));
        }
      }
    }
    // One per day: the earliest reading (the morning weigh-in); rows without a time keep the first one seen.
    const byDay = {};
    for (const r of out) {
      const b = byDay[r.date];
      if (!b || (r.time && (!b.time || r.time < b.time))) byDay[r.date] = r;
    }
    return { rows: Object.values(byDay).sort((a, b) => a.date < b.date ? -1 : 1), skipped, ambiguous };
  }

  // ---------- food log ----------
  function mealSlot(meal) {
    const m = String(meal || "").toLowerCase();
    if (/breakfast/.test(m)) return "Breakfast";
    if (/lunch|meal ?1/.test(m)) return "Meal 1";
    if (/dinner|supper|meal ?2/.test(m)) return "Meal 2";
    if (/snack/.test(m)) return "Snack";
    return "Extra";
  }

  // -> {source, rows:[{date, time, meal, name, kcal, p, c, f, est}], skipped, estimated, ambiguous}
  function parseFood(text, opts) {
    const csv = readCsv(text);
    if (!csv) throw new Error("The file is empty.");
    const h = csv.head, has = re => h.some(x => re.test(x));
    const c = {
      date: csv.col([/^(date|day)$/, /^date/, /date|day/]),
      time: csv.col(/^time$/),
      meal: csv.col(/^(meal|group|meal name|meal type|category)$/),
      name: csv.col([/^(food name|food|item|description|name)$/, /food|item/], /group|calor|energy/),
      kcal: csv.col([/^(calories|energy|kcal)\b/, /calor|energy|kcal/], /goal|target|burn|from fat/),
      p: csv.col(/^protein/),
      cb: csv.col([/^(carbohydrates|carbs?)\b/, /^carb/, /^net carb/]),
      f: csv.col([/^(fat|total fat)\b/, /^fat/], /sat|trans|mono|poly/),
    };
    if (c.date < 0) throw new Error("No date column found.");
    if (c.kcal < 0 && c.p < 0) throw new Error("No calories or protein column found.");
    const kj = c.kcal >= 0 && /kj/.test(h[c.kcal]) && !/kcal/.test(h[c.kcal]);
    const source = has(/^food name$/) && has(/^group$/) ? "cronometer" : (has(/^meal$/) && has(/sodium/)) || /myfitnesspal|mfp/i.test(opts.filename || "") ? "mfp" : has(/^energy \(kcal\)$/) && c.name < 0 ? "cronometer" : "csv";
    const rows = []; let skipped = 0, estimated = 0, ambiguous = 0;
    for (const r of csv.rows) {
      const when = parseWhen(r[c.date], opts);
      if (!when) { skipped++; continue; }
      if (when.ambiguous) ambiguous++;
      let kcal = c.kcal >= 0 ? num(r[c.kcal]) : null;
      if (kcal != null && kj) kcal = kcal / 4.184;
      const p = c.p >= 0 ? num(r[c.p]) : null, cb = c.cb >= 0 ? num(r[c.cb]) : null, f = c.f >= 0 ? num(r[c.f]) : null;
      let est = false;
      if (kcal == null) {
        if (p == null || cb == null || f == null) { skipped++; continue; }
        kcal = p * 4 + cb * 4 + f * 9; est = true; estimated++;           // worked out from macros, flagged for checking
      }
      if (kcal < 0 || kcal > 10000) { skipped++; continue; }
      const meal = c.meal >= 0 ? (r[c.meal] || "").trim() : "";
      let name = c.name >= 0 ? (r[c.name] || "").trim() : "";
      if (!name) name = meal ? meal + (source === "mfp" ? " (MyFitnessPal total)" : " total") : source === "cronometer" ? "Day total (Cronometer)" : "Day total";
      rows.push({ date: when.date, time: c.time >= 0 ? (r[c.time] || "").trim() : when.time, meal, name, kcal: round(kcal, 0), p: round(p || 0, 1), c: round(cb || 0, 1), f: round(f || 0, 1), est });
    }
    return { source, rows, skipped, estimated, ambiguous };
  }

  // ---------- workouts (Strong, Hevy, generic CSV) ----------
  // Hevy and generic logs are rewritten as a Strong CSV so StrongCSV does the name matching,
  // session guess and kg/lb conversion the same way for every source.
  function toStrongCsv(text, kind, opts) {
    const csv = readCsv(text); if (!csv) throw new Error("The file is empty.");
    const c = kind === "hevy" ? {
      date: csv.col(/^start_time$/), end: csv.col(/^end_time$/), title: csv.col(/^title$/), ex: csv.col(/^exercise_title$/),
      type: csv.col(/^set_type$/), w: csv.col(/^weight_(kg|lbs?)$/), r: csv.col(/^reps$/),
    } : {
      date: csv.col([/^(date|day)$/, /date|time/]), end: -1, title: csv.col(/^(workout|workout name|session|title|routine)$/),
      ex: csv.col(/^(exercise|exercise name|movement|lift)$/), type: csv.col(/^(set type|type|set order|kind)$/),
      w: csv.col([/^(weight|load)\b/, /weight|load|kg|lb/]), r: csv.col(/^reps?$/), unit: csv.col(/^(unit|weight unit)$/),
    };
    if (c.date < 0 || c.ex < 0 || c.r < 0) throw new Error("Needs date, exercise and reps columns.");
    const headUnit = c.w >= 0 ? weightUnit(csv.head[c.w], null) : null;
    const sets = [];
    let skipped = 0, ambiguous = 0;
    const counters = {};
    for (const r of csv.rows) {
      const when = parseWhen(r[c.date], opts);
      const reps = num(r[c.r]);
      if (!when || reps == null) { skipped++; continue; }
      if (when.ambiguous) ambiguous++;
      const name = (r[c.ex] || "").trim(); if (!name) { skipped++; continue; }
      const unit = headUnit || (c.unit >= 0 ? weightUnit(r[c.unit], null) : null) || weightUnit(r[c.w], null) || (opts.unit === "lb" ? "lb" : "kg");
      const w = c.w >= 0 ? num(r[c.w]) : 0;
      const ty = String(c.type >= 0 ? r[c.type] : "").toLowerCase();
      const title = c.title >= 0 ? (r[c.title] || "").trim() : "";
      const key = when.date + "|" + title + "|" + name;
      const order = /warm|^w$/.test(ty) ? "W" : /drop|^d$/.test(ty) ? "D" : /fail|^f$/.test(ty) ? "F" : String(counters[key] = (counters[key] || 0) + 1);
      let dur = "";
      if (c.end >= 0) {
        const a = parseWhenMs(r[c.date]), b = parseWhenMs(r[c.end]);
        if (a && b && b > a) dur = Math.round((b - a) / 60000) + "m";
      }
      sets.push({ row: [when.date + " " + (when.time || "00:00") + ":00", title, dur, name, order], w: w == null ? 0 : w, unit, reps: Math.round(reps) });
    }
    // One unit in the file: hand it to StrongCSV as-is. Mixed units: convert to kg (to the nearest 0.25, like StrongCSV).
    const units = new Set(sets.map(x => x.unit)), one = units.size === 1 && (units.has("lb") || units.has("kg")) ? [...units][0] : null;
    const out = [["Date", "Workout Name", "Duration", "Exercise Name", "Set Order", one === "lb" ? "Weight (lbs)" : "Weight (kg)", "Reps"]];
    for (const x of sets) out.push(x.row.concat(one ? x.w : Math.round(toKg(x.w, x.unit) * 4) / 4, x.reps));
    return { csv: toCsvText(out), skipped, ambiguous };
  }

  function parseWhenMs(v) {
    const p = parseWhen(v); if (!p) return null;
    const [y, m, d] = p.date.split("-").map(Number), [hh, mm] = (p.time || "00:00").split(":").map(Number);
    return new Date(y, m - 1, d, hh, mm).getTime();
  }

  // ---------- measurements ----------
  const MEASURE_COLS = [
    ["bodyfat", /body ?fat|fat ?%|^fat$/], ["waist", /waist/], ["chest", /chest/], ["shoulders", /shoulder/], ["neck", /neck/],
    ["hips", /hips?\b/], ["bicepL", /(left|^l\b).*(bicep|arm)|(bicep|arm).*(left|\bl\b)/], ["bicepR", /(right|^r\b).*(bicep|arm)|(bicep|arm).*(right|\br\b)/],
    ["bicepR", /^(bicep|biceps|arm|arms)\b/], ["forearm", /forearm/],
    ["thighL", /(left|^l\b).*thigh|thigh.*(left|\bl\b)/], ["thighR", /(right|^r\b).*thigh|thigh.*(right|\br\b)|^thighs?\b/], ["calf", /calf|calves/],
  ];
  const noonMs = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d, 12).getTime(); };

  function parseMeasures(text, opts) {
    const t = String(text || "").trim(); let records = [];
    if (t[0] === "[") {
      const j = sniffJson(t) || [];
      records = j.filter(isObj).map(o => ({ date: o.date, cells: o, unit: o.unit }));
    } else {
      const csv = readCsv(t); if (!csv) throw new Error("The file is empty.");
      const dc = csv.col([/^(date|day)$/, /date|time/]);
      if (dc < 0) throw new Error("No date column found.");
      records = csv.rows.map(r => { const o = {}; csv.head.forEach((h, i) => { o[h] = r[i]; }); return { date: r[dc], cells: o }; });
    }
    const rows = [], weights = []; let skipped = 0, ambiguous = 0;
    for (const rec of records) {
      const when = parseWhen(rec.date, opts);
      if (!when) { skipped++; continue; }
      if (when.ambiguous) ambiguous++;
      const used = new Set();
      for (const key of Object.keys(rec.cells)) {
        const k = String(key).toLowerCase();
        if (k === "date" || k === "unit") continue;
        if (/(^|[^a-z])weight([^a-z]|$)/.test(k) && !/goal|target/.test(k)) {
          const v = num(rec.cells[key]); const kg = v == null ? null : toKg(v, weightUnit(k, weightUnit(rec.cells[key], opts.unit === "lb" ? "lb" : "kg")));
          if (kg >= 25 && kg <= 350) weights.push({ date: when.date, kg: round(kg, 2) });
          continue;
        }
        const hit = MEASURE_COLS.find(([type, re]) => re.test(k) && !used.has(type));
        if (!hit) continue;
        const v = num(rec.cells[key]); if (v == null || v <= 0) continue;
        const inches = /\(in\)|\binch|\bin\b/.test(k) || /^in/i.test(String(rec.unit || ""));
        const value = hit[0] === "bodyfat" ? round(v, 1) : round(inches ? v * 2.54 : v, 1);
        if (hit[0] === "bodyfat" ? value > 70 : value > 250) { skipped++; continue; }
        used.add(hit[0]);
        rows.push({ type: hit[0], date: when.date, value });
      }
    }
    return { rows, weights, skipped, ambiguous };
  }

  // ---------- import plans ----------
  function newDay(date) { return { date, food: [], water: 0, supps: {}, treadmill: false }; }

  function rangeOf(dates) { const s = dates.filter(Boolean).sort(); return s.length ? { from: s[0], to: s[s.length - 1] } : null; }

  function weightPlan(rows, current, opts, plan) {
    const cur = (current && current.weights) || {}, c = plan.counts.weights = plan.counts.weights || emptyCounts();
    for (const r of rows) {
      const have = cur[r.date];
      if (have && Math.abs(num(have.kg) - r.kg) < 0.05) { c.same++; continue; }
      if (have && !opts.overwrite) { c.kept++; continue; }
      const doc = Object.assign({}, have || {}, { date: r.date, kg: round(r.kg, 1) });
      plan.writes.push({ col: "weights", id: r.date, doc });
      have ? c.update++ : c.add++;
    }
  }

  function dayWriter(plan, current) {
    const days = {};
    return {
      get(date) { if (!days[date]) days[date] = Object.assign(newDay(date), clone((current && current.days || {})[date])); return days[date]; },
      set(date, doc) { days[date] = doc; },
      flush(countKey) {
        const c = plan.counts.days = plan.counts.days || emptyCounts();
        for (const date of Object.keys(days)) {
          const before = (current && current.days || {})[date];
          if (before && same(Object.assign(newDay(date), before), days[date])) { c.same++; continue; }
          plan.writes.push({ col: "days", id: date, doc: days[date] });
          before ? c.update++ : c.add++;
        }
      },
    };
  }

  function needs(deps, name) {
    const g = typeof globalThis !== "undefined" ? globalThis : {};
    const d = (deps && deps[name]) || g[name];
    if (!d) throw new Error(name + " isn't loaded, so this file type can't be imported.");
    return d;
  }

  function importText(text, opts) {
    opts = opts || {};
    text = String(text == null ? "" : text);
    let kind = opts.kind || detect(text, opts.filename);
    // Not recognised: the Steps and WaterH parsers know more device layouts (Fitbit, Garmin, Health Connect records).
    if (!kind) for (const [k, dep, fn] of [["steps", "Steps", "parseSteps"], ["water", "WaterH", "parseWaterH"]]) {
      try { if ((needs(opts.deps, dep)[fn](text, opts.now ? new Date(opts.now) : new Date()) || []).length) { kind = k; break; } } catch (e) { /* not this one */ }
    }
    if (!kind) throw new Error("Couldn't tell what this file is. Supported: app backups, Strong, Hevy, MyFitnessPal, Cronometer, weigh-in, measurement, steps and water exports, or a CSV with a date column.");
    const now = opts.now ? new Date(opts.now) : new Date();
    const today = opts.today || localISO(now);
    const current = opts.current || {};
    if (kind === "backup") return planRestore(readBackup(text), current, { mode: opts.mode || "merge" });

    const plan = { kind, label: KINDS[kind], mode: "merge", writes: [], deletes: [], counts: {}, lines: [], warnings: [], range: null };
    const warnAmbiguous = n => { if (n) plan.warnings.push(n + " date" + (n === 1 ? " was" : "s were") + " ambiguous (like 03/04/2026) and read as " + (opts.dateOrder === "mdy" ? "month/day" : "day/month") + "."); };
    const warnSkipped = (n, what) => { if (n) plan.warnings.push(n + " " + what + (n === 1 ? "" : "s") + " had no usable date or value and were skipped."); };

    if (kind === "strong" || kind === "hevy" || kind === "workouts-csv") {
      const Strong = needs(opts.deps, "StrongCSV");
      if (!opts.program || !opts.rotation) throw new Error("Workout import needs the app's program.");
      let csv = text, skipped = 0, ambiguous = 0;
      if (kind !== "strong") ({ csv, skipped, ambiguous } = toStrongCsv(text, kind, opts));
      const { docs, report } = Strong.toWorkouts(csv, { program: opts.program, rotation: opts.rotation, existing: current.workouts || {}, unit: opts.unit, since: opts.since });
      const c = plan.counts.workouts = emptyCounts();
      for (const date of Object.keys(docs).sort()) {
        const doc = docs[date];
        if (kind !== "strong") { doc.source = kind === "hevy" ? "hevy" : "csv"; doc.imported = doc.strong; delete doc.strong; }
        const before = (current.workouts || {})[date];
        const cmp = d => { const x = clone(d) || {}; delete x.strong; delete x.imported; return x; };
        if (before && same(cmp(before), cmp(doc))) { c.same++; continue; }
        plan.writes.push({ col: "workouts", id: date, doc });
        before ? c.update++ : c.add++;
      }
      plan.lines.push(report.workouts + " workout" + (report.workouts === 1 ? "" : "s") + " on " + report.days + " day" + (report.days === 1 ? "" : "s") + ", " + report.sets + " working sets (warm-ups left out)");
      if (c.update) plan.lines.push(c.update + " day" + (c.update === 1 ? "" : "s") + " already had a workout: imported lifts are added, your other lifts stay");
      const un = Object.keys(report.unmatched);
      if (un.length) plan.warnings.push("Not in your program, saved under their own names: " + un.slice(0, 8).join(", ") + (un.length > 8 ? " and " + (un.length - 8) + " more" : ""));
      warnSkipped(skipped, "row"); warnAmbiguous(ambiguous);
      plan.range = rangeOf(Object.keys(docs));
      return plan;
    }

    if (kind === "nutrition") {
      const r = parseFood(text, { filename: opts.filename, dateOrder: opts.dateOrder });
      const days = dayWriter(plan, current), byDate = {};
      r.rows.forEach(x => (byDate[x.date] = byDate[x.date] || []).push(x));
      let planned = 0;
      for (const date of Object.keys(byDate)) {
        const day = days.get(date), prefix = "imp:" + r.source + ":";
        const items = byDate[date].map((x, i) => ({
          id: prefix + date + ":" + i, name: x.name, slot: mealSlot(x.meal), kcal: x.kcal, p: x.p, c: x.c, f: x.f,
          eaten: date < today, est: x.est, src: r.source,
        }));
        if (date >= today) planned += items.length;
        day.food = (day.food || []).filter(i => !(i && typeof i.id === "string" && i.id.indexOf(prefix) === 0)).concat(items);
      }
      days.flush();
      const total = r.rows.length, nd = Object.keys(byDate).length;
      plan.lines.push(total + " food entr" + (total === 1 ? "y" : "ies") + " on " + nd + " day" + (nd === 1 ? "" : "s") + " (" + ({ mfp: "MyFitnessPal", cronometer: "Cronometer" }[r.source] || "CSV") + ")");
      plan.lines.push("Past days count as eaten. Importing the same file again replaces these entries instead of doubling them.");
      if (planned) plan.warnings.push(planned + " entr" + (planned === 1 ? "y is" : "ies are") + " for today or later and come in as planned, not eaten. Tick them when you eat them.");
      if (r.estimated) plan.warnings.push(r.estimated + " entr" + (r.estimated === 1 ? "y has" : "ies have") + " no calories in the file; worked out from protein, carbs and fat and marked as estimates.");
      warnSkipped(r.skipped, "row"); warnAmbiguous(r.ambiguous);
      plan.range = rangeOf(Object.keys(byDate));
      return plan;
    }

    if (kind === "measurements") {
      const r = parseMeasures(text, opts);
      const cur = current.lb_measures || {}, c = plan.counts.lb_measures = emptyCounts();
      for (const m of r.rows) {
        const id = m.type + "-" + m.date, have = cur[id];
        if (have && Math.abs(num(have.value) - m.value) < 0.05) { c.same++; continue; }
        if (have && !opts.overwrite) { c.kept++; continue; }
        plan.writes.push({ col: "lb_measures", id, doc: { id, type: m.type, value: m.value, date: noonMs(m.date) } });
        have ? c.update++ : c.add++;
      }
      if (r.weights.length) weightPlan(r.weights, current, opts, plan);
      plan.lines.push(r.rows.length + " measurement" + (r.rows.length === 1 ? "" : "s") + (r.weights.length ? " and " + r.weights.length + " weigh-ins" : ""));
      warnSkipped(r.skipped, "row"); warnAmbiguous(r.ambiguous);
      plan.range = rangeOf(r.rows.map(x => x.date).concat(r.weights.map(x => x.date)));
      return plan;
    }

    // weights / steps / water, alone or together (health exports)
    const dates = [];
    let found = 0;
    if (kind === "weights" || kind === "health") {
      let r = { rows: [], skipped: 0, ambiguous: 0 };
      try { r = parseWeights(text, opts); } catch (e) { if (kind === "weights") throw e; }
      if (r.rows.length) {
        weightPlan(r.rows, current, opts, plan);
        const c = plan.counts.weights;
        plan.lines.push(r.rows.length + " weigh-in" + (r.rows.length === 1 ? "" : "s") + " (the earliest reading of each day)" + (c.kept ? "; " + c.kept + " day" + (c.kept === 1 ? "" : "s") + " you already logged keep your number" : ""));
        r.rows.forEach(x => dates.push(x.date)); found++;
      }
      if (kind === "weights") { warnSkipped(r.skipped, "row"); warnAmbiguous(r.ambiguous); }
    }
    const days = dayWriter(plan, current);
    if (kind === "steps" || kind === "health") {
      let rows = [];
      try { rows = needs(opts.deps, "Steps").parseSteps(text, now) || []; } catch (e) { if (kind === "steps") throw e; }
      const Steps = rows.length ? needs(opts.deps, "Steps") : null;
      rows.forEach(r => { days.set(r.date, Steps.applySteps(days.get(r.date), r, now)); dates.push(r.date); });
      if (rows.length) { plan.lines.push("Steps for " + rows.length + " day" + (rows.length === 1 ? "" : "s") + " (a day imported again is replaced, not added)"); found++; }
    }
    if (kind === "water" || kind === "health") {
      let rows = [];
      try { rows = needs(opts.deps, "WaterH").parseWaterH(text, now) || []; } catch (e) { if (kind === "water") throw e; }
      const WaterH = rows.length ? needs(opts.deps, "WaterH") : null;
      rows.forEach(r => { days.set(r.date, WaterH.applyWaterH(days.get(r.date), r, now)); dates.push(r.date); });
      if (rows.length) { plan.lines.push("Water for " + rows.length + " day" + (rows.length === 1 ? "" : "s") + " (stored as the bottle/Health figure; your manual drinks stay separate)"); found++; }
    }
    days.flush();
    if (!found) throw new Error("No " + (kind === "health" ? "weight, steps or water" : KINDS[kind].toLowerCase()) + " found in this file.");
    plan.range = rangeOf(dates);
    return plan;
  }

  async function applyPlan(plan, io) {
    let n = 0;
    for (const w of plan.writes) { await io.put(w.col, w.id, w.doc); n++; }
    for (const d of plan.deletes || []) { await io.remove(d.col, d.id); n++; }
    return n;
  }

  // ---------- CSV exports ----------
  function toCsv(snapshot, what, opts) {
    opts = opts || {};
    const s = snapshot || {}, days = s.days || {}, weights = s.weights || {}, workouts = s.workouts || {};
    const sorted = o => Object.keys(o).filter(k => ISO.test(k)).sort();
    if (what === "weights") return toCsvText([["Date", "Weight (kg)"]].concat(sorted(weights).map(d => [d, weights[d].kg])));
    if (what === "food") {
      const rows = [["Date", "Slot", "Food", "Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Eaten", "Estimate"]];
      sorted(days).forEach(d => (days[d].food || []).forEach(i => rows.push([d, i.slot || "", i.name, i.kcal, i.p, i.c, i.f, i.eaten ? "yes" : "no", i.est ? "yes" : "no"])));
      return toCsvText(rows);
    }
    if (what === "workouts") {
      const rows = [["Date", "Session", "Exercise", "Set", "Weight", "Reps"]];
      sorted(workouts).forEach(d => { const w = workouts[d]; Object.keys(w.sets || {}).forEach(ex => (w.sets[ex] || []).forEach((st, i) => rows.push([d, w.session || "", ex, i + 1, st.w, st.r]))); });
      return toCsvText(rows);
    }
    if (what === "daily") {
      const tgt = typeof opts.kcalTarget === "function", pmin = num(opts.proteinMin);
      const rows = [["Date", "Calories eaten", "Protein eaten (g)", "Calories planned", "Water (ml)", "Steps", "Sleep (h)", "Weight (kg)", "Workout"]
        .concat(tgt ? ["Calorie target"] : [], pmin != null ? ["Protein target (g)"] : [])];
      const all = Array.from(new Set(sorted(days).concat(sorted(weights), sorted(workouts)))).sort();
      for (const d of all) {
        const day = days[d] || {}, food = day.food || [];
        const sum = (k, f) => round(food.filter(f).reduce((a, i) => a + (num(i[k]) || 0), 0), 0);
        const water = (num(day.water) || 0) + (day.waterh && num(day.waterh.ml) || 0);
        const steps = day.steps == null ? "" : typeof day.steps === "object" ? day.steps.count : day.steps;
        rows.push([d, sum("kcal", i => i.eaten), sum("p", i => i.eaten), sum("kcal", () => true), water || "", steps, day.sleep == null ? "" : day.sleep,
          weights[d] ? weights[d].kg : "", workouts[d] ? workouts[d].session || "" : ""]
          .concat(tgt ? [opts.kcalTarget(d) == null ? "" : opts.kcalTarget(d)] : [], pmin != null ? [pmin] : []));
      }
      return toCsvText(rows);
    }
    throw new Error("Unknown export: " + what);
  }

  // ---------- "Your data" card ----------
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const fmtDate = iso => { if (!iso) return ""; const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); };

  const CSS = `
.dio{display:grid;gap:14px}
.dio h3{margin:0 0 4px}
.dio p{margin:.3em 0}
.dio .dio-muted{color:var(--muted);font-size:.88rem}
.dio-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.dio-btn{appearance:none;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:9px 16px;font:600 .92rem var(--body,inherit);cursor:pointer;min-height:40px;display:inline-flex;align-items:center;gap:6px}
.dio-btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.dio-btn.danger{color:var(--bad);border-color:var(--bad)}
.dio-btn:disabled{opacity:.5;cursor:default}
.dio-btn input{display:none}
.dio textarea{width:100%;box-sizing:border-box;min-height:84px;border:1px solid var(--line);border-radius:10px;background:var(--sunk);color:var(--ink);padding:10px;font:.85rem var(--mono,monospace)}
.dio-plan{border:1px solid var(--line);border-radius:var(--r,12px);padding:12px 14px;background:var(--sunk)}
.dio-plan ul{margin:6px 0;padding-left:18px}
.dio-plan li{margin:2px 0}
.dio-warn{color:var(--warn)}
.dio-bad{color:var(--bad)}
.dio-good{color:var(--good)}
.dio-seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;overflow:hidden}
.dio-seg button{appearance:none;border:0;background:transparent;color:var(--ink);padding:8px 14px;font:600 .85rem var(--body,inherit);cursor:pointer}
.dio-seg button[aria-pressed="true"]{background:var(--accent);color:var(--accent-ink)}
.dio details{border-top:1px solid var(--line);padding-top:8px}
.dio summary{cursor:pointer;font-weight:600}
.dio dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;font-size:.88rem;margin:8px 0}
.dio dt{font-weight:600}
.dio dd{margin:0;color:var(--muted)}
`;

  const SOURCES = [
    ["Backups", "A fitness-backup-*.json from this app, a Liftbook backup, or the app's own browser save."],
    ["Strong", "Strong → Settings → Export Strong Data → CSV."],
    ["Hevy", "Hevy → Profile → Settings → Export & Import Data → Export Workouts (CSV)."],
    ["MyFitnessPal", "Web → Reports → Export (Nutrition Summary CSV). Premium on the phone app."],
    ["Cronometer", "Web → Settings → Account → Export Data → Food & Recipe Entries or Daily Nutrition."],
    ["Scales", "Renpho, Samsung Health (weight CSV), Garmin, Fitbit or any CSV with a date and a weight column."],
    ["Health Connect", "On Android, a Health Connect exporter app can save weight, steps and hydration as CSV."],
    ["Apple Health", "Health → your picture → Export All Health Data → export.xml (weight, steps and water)."],
    ["Any spreadsheet", "A CSV with a date column plus weight, waist/chest/hips…, food + calories, or exercise + reps."],
  ];

  // Age of the last backup from prefs/main. `due` after DUE_DAYS (7) or when there has never been one.
  const DUE_DAYS = 7;
  function backupStatus(prefsMain, { now, dueDays } = {}) {
    const lastBackup = (prefsMain || {}).lastBackup || null;
    const t = lastBackup ? new Date(lastBackup).getTime() : NaN;
    const ageDays = Number.isFinite(t) ? Math.max(0, Math.floor(((now || Date.now()) - t) / 86400000)) : null;
    const limit = dueDays == null ? DUE_DAYS : dueDays;
    const due = ageDays == null || ageDays >= limit;
    const label = ageDays == null ? "No backup yet" : ageDays === 0 ? "Backed up today" : ageDays === 1 ? "Last backup yesterday" : `Last backup ${ageDays} days ago`;
    return { lastBackup: Number.isFinite(t) ? lastBackup : null, ageDays, due, label };
  }

  function mount(host, opts) {
    opts = opts || {};
    if (!document.getElementById("dio-style")) { const st = document.createElement("style"); st.id = "dio-style"; st.textContent = CSS; document.head.appendChild(st); }
    const ui = { plan: null, name: "", text: "", backup: null, mode: "merge", msg: "", busy: false, err: "" };
    const today = () => opts.today ? opts.today() : localISO(new Date());

    async function save(filename, data, mime) {
      if (opts.download) return opts.download(filename, data, mime);
      const blob = new Blob([data], { type: mime || "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      return true;
    }

    function lastBackup() { return backupStatus((opts.snapshot().prefs || {}).main).lastBackup; }

    function planHtml(p) {
      const c = p.counts, n = p.writes.length + p.deletes.length;
      return `<div class="dio-plan" role="status">
        <p><b>${esc(p.label)}</b>${ui.name ? ` · <span class="dio-muted">${esc(ui.name)}</span>` : ""}${p.range ? `<br><span class="dio-muted">${fmtDate(p.range.from)}${p.range.to !== p.range.from ? " – " + fmtDate(p.range.to) : ""}</span>` : ""}</p>
        ${p.kind === "backup" ? `<div class="dio-row"><span class="dio-seg" role="group" aria-label="How to restore">
          <button data-dio="mode" data-m="merge" aria-pressed="${p.mode === "merge"}">Add to what I have</button>
          <button data-dio="mode" data-m="replace" aria-pressed="${p.mode === "replace"}">Replace everything</button></span></div>
          <p class="dio-muted">${p.mode === "merge" ? "Adds anything missing and fills empty fields. Nothing you have is overwritten." : "<span class=\"dio-bad\">Your data becomes exactly the backup.</span> Records not in the backup are removed. A backup of your current data downloads first."}</p>` : ""}
        <ul>${p.lines.map(l => `<li>${esc(l)}</li>`).join("") || "<li>Nothing new in this file.</li>"}</ul>
        ${p.warnings.length ? `<ul class="dio-warn">${p.warnings.slice(0, 6).map(w => `<li>${esc(w)}</li>`).join("")}${p.warnings.length > 6 ? `<li>…and ${p.warnings.length - 6} more</li>` : ""}</ul>` : ""}
        <div class="dio-row">
          <button class="dio-btn ${p.mode === "replace" ? "danger" : "primary"}" data-dio="apply" ${n && !ui.busy ? "" : "disabled"}>${n ? (p.mode === "replace" ? "Replace with backup" : "Import " + n + " change" + (n === 1 ? "" : "s")) : "Nothing to import"}</button>
          <button class="dio-btn" data-dio="cancel">Cancel</button>
        </div></div>`;
    }

    function render() {
      const bs = backupStatus((opts.snapshot().prefs || {}).main), lb = bs.lastBackup, age = bs.ageDays;
      host.innerHTML = `<section class="card dio" aria-label="Your data">
        <div><h3>Your data</h3>
          <p class="dio-muted">Back up everything, bring in history from other apps, or export spreadsheets.</p></div>
        <div>
          <p><b>Backup</b> · ${lb ? `last one ${age === 0 ? "today" : age === 1 ? "yesterday" : age + " days ago"}` : "<span class=\"dio-warn\">no backup yet</span>"}${lb && bs.due ? ` <span class="dio-warn">(time for a new one)</span>` : ""}</p>
          <div class="dio-row">
            <button class="dio-btn primary" data-dio="backup" ${ui.busy ? "disabled" : ""}>Download backup</button>
            <label class="dio-btn">Restore or import a file<input type="file" data-dio="file" accept=".json,.csv,.txt,.xml,.tsv,application/json,text/csv,text/plain,text/xml"></label>
          </div>
          <p class="dio-muted">The backup is one file with every log, setting and saved meal. Progress photo images aren't inside it; they stay in the app.</p>
        </div>
        ${ui.err ? `<p class="dio-bad" role="alert">${esc(ui.err)}</p>` : ""}
        ${ui.msg ? `<p class="dio-good" role="status">${esc(ui.msg)}</p>` : ""}
        ${ui.plan ? planHtml(ui.plan) : ""}
        <details><summary>Paste instead of picking a file</summary>
          <textarea id="dio-paste" placeholder="Paste CSV, JSON or lines like STEPS 2026-10-25 8432" aria-label="Paste data">${esc(ui.text)}</textarea>
          <div class="dio-row"><button class="dio-btn" data-dio="paste">Check pasted data</button></div></details>
        <details><summary>Export spreadsheets (CSV)</summary>
          <div class="dio-row">
            <button class="dio-btn" data-dio="csv" data-w="daily">Daily summary</button>
            <button class="dio-btn" data-dio="csv" data-w="weights">Weigh-ins</button>
            <button class="dio-btn" data-dio="csv" data-w="food">Food log</button>
            <button class="dio-btn" data-dio="csv" data-w="workouts">Workouts</button>
          </div></details>
        <details><summary>What can I import?</summary>
          <dl>${SOURCES.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join("")}</dl>
          <p class="dio-muted">The file type is detected for you. You always see what will change before anything is saved, and importing the same file twice doesn't double anything.</p></details>
      </section>`;
    }

    function check(text, name) {
      ui.err = ""; ui.msg = ""; ui.plan = null; ui.name = name || ""; ui.text = name ? "" : text; ui.mode = "merge";
      try {
        ui.plan = importText(text, {
          filename: name, current: opts.snapshot(), today: today(), program: opts.program, rotation: opts.rotation,
          deps: opts.deps, unit: opts.unit, dateOrder: opts.dateOrder,
        });
        ui.source = text;
      } catch (e) { ui.err = e.message || String(e); }
      render();
    }

    async function doBackup() {
      const snap = opts.snapshot();
      await save(backupFilename(), JSON.stringify(makeBackup(snap, { appVersion: opts.appVersion }), null, 1), "application/json");
      if (opts.put) { const main = Object.assign({}, (snap.prefs || {}).main || {}, { lastBackup: new Date().toISOString() }); await opts.put("prefs", "main", main); }
    }

    host.addEventListener("click", async e => {
      const b = e.target.closest("[data-dio]"); if (!b || b.tagName === "INPUT") return;
      const a = b.dataset.dio;
      try {
        if (a === "backup") { ui.busy = true; render(); await doBackup(); ui.busy = false; ui.msg = "Backup saved."; ui.err = ""; render(); }
        else if (a === "cancel") { ui.plan = null; ui.err = ""; render(); }
        else if (a === "paste") { const t = host.querySelector("#dio-paste").value; if (t.trim()) check(t, ""); }
        else if (a === "mode") { ui.mode = b.dataset.m; ui.plan = planRestore(readBackup(ui.source), opts.snapshot(), { mode: ui.mode }); render(); }
        else if (a === "csv") { const w = b.dataset.w; await save("fitness-" + w + "-" + today() + ".csv", toCsv(opts.snapshot(), w, { kcalTarget: opts.kcalTarget, proteinMin: opts.proteinMin }), "text/csv"); }
        else if (a === "apply" && ui.plan) {
          ui.busy = true; render();
          if (ui.plan.mode === "replace") await doBackup();                  // safety copy before anything is removed
          // Re-plan against the latest data so changes synced since the preview aren't lost.
          const fresh = ui.plan.kind === "backup" ? planRestore(readBackup(ui.source), opts.snapshot(), { mode: ui.plan.mode })
            : importText(ui.source, { filename: ui.name, kind: ui.plan.kind, current: opts.snapshot(), today: today(), program: opts.program, rotation: opts.rotation, deps: opts.deps, unit: opts.unit, dateOrder: opts.dateOrder });
          const n = await applyPlan(fresh, { put: opts.put, remove: opts.remove });
          ui.busy = false; ui.plan = null; ui.text = ""; ui.err = "";
          ui.msg = n ? `Done: ${n} record${n === 1 ? "" : "s"} saved${fresh.mode === "replace" ? " (your previous data was downloaded first)" : ""}.` : "Nothing needed changing.";
          render(); if (opts.onDone) opts.onDone(fresh);
        }
      } catch (err) { ui.busy = false; ui.err = "Didn't finish: " + (err.message || err); render(); }
    });
    host.addEventListener("change", async e => {
      const inp = e.target.closest('input[data-dio="file"]'); if (!inp || !inp.files || !inp.files[0]) return;
      const f = inp.files[0]; inp.value = "";
      if (f.size > 60e6) { ui.err = "That file is over 60 MB. For Apple Health, unzip it and pick export.xml; for others, export a shorter date range."; render(); return; }
      if (/\.zip$/i.test(f.name)) { ui.err = "Unzip the file first, then pick the CSV, JSON or XML inside."; render(); return; }
      check(await f.text(), f.name);
    });
    render();
    return { refresh: render };
  }

  return {
    FORMAT, SCHEMA, COLLECTIONS, KINDS, MIGRATIONS,
    makeBackup, backupFilename, readBackup, planRestore, detect, importText, applyPlan, toCsv, mount,
    backupStatus, DUE_DAYS,
    parseWhen, parseWeights, parseFood, parseMeasures, toStrongCsv, readCsv,
  };
})();
if (typeof module !== "undefined") module.exports = DataIO;
