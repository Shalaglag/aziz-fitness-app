// Daily steps: parses what the phone hands over (a typed number, or an export
// from Health Connect or a step app), folds it into a `days/{date}` doc, and
// renders the "Steps" goal card for the Today tab. Plain ES module, no
// dependencies, no network.
//
// A Claude Artifact can't read Health Connect or any step app's account, so
// the phone hands the numbers over. Health Connect is the hub on Android:
// most step apps write to it, and one exporter covers them all. Where an app
// doesn't, its own data export is read directly (see STEP_SOURCES).
//
// Accepted input (one paste or one file; the format is detected):
//   8432 / 8,432 / 8.4k             <- a bare number = today
//   STEPS 2026-10-25 8432           <- one line per day (latest line wins)
//   Health Connect exporter CSV     daily (Date,Steps), records (start_time,count,data_origin), long (time,type,value)
//   Samsung Health "Download personal data": step_daily_trend / step_count CSVs
//   Fitbit: steps-*.json (Takeout / data export) or the account export CSV
//   Garmin: Connect Reports CSV (,Actual,Goal) or UDSFile_*.json
//   Google Fit Takeout: Daily activity metrics.csv ("Step count")
//   Apple Health export.xml (HKQuantityTypeIdentifierStepCount)
// Exports list the phone and a watch separately, so records are summed per
// source and the day takes the biggest source, never phone + watch added.
//
// Day doc field this module owns:
//   steps: { count, at (ISO of last change), source: "manual"|"line"|"csv"|"json"|"apple-xml" }
// Goal lives in prefs/main.stepGoal (default DEFAULT_GOAL).

export const DEFAULT_GOAL = 10000;

// How to get steps out of each app, shown in the card's import section.
// `hc`: the app can write steps to Health Connect.
export const STEP_SOURCES = [
  { id: "hc", name: "Any app via Health Connect", hc: true,
    how: "In your step app, turn on Health Connect sync (Settings → Health Connect → App permissions → allow Steps). Then export Steps as CSV with a Health Connect exporter app from Play and pick the file here. Covers Google Fit, Fitbit, Samsung Health, Garmin, Mi Fitness, Zepp, Oura and most others." },
  { id: "samsung", name: "Samsung Health", hc: true,
    how: "Samsung Health → ⋮ → Settings → Download personal data. Open Download/Samsung Health on the phone and pick the file starting com.samsung.shealth.step_daily_trend." },
  { id: "fitbit", name: "Fitbit", hc: true,
    how: "Export your data (Fitbit app or Google Takeout → Fitbit), unzip it, and pick a steps-YYYY-MM-DD.json from Physical Activity. The fitbit.com account export CSV works too." },
  { id: "garmin", name: "Garmin Connect", hc: true,
    how: "Garmin Connect on the web → Reports → Steps → Export (CSV). For full history, the account data export's UDSFile_*.json also works." },
  { id: "googlefit", name: "Google Fit", hc: true,
    how: "Google Takeout → Fit → unzip and pick \"Daily activity metrics.csv\" from Daily activity metrics." },
  { id: "apple", name: "Apple Health (iPhone)", hc: false,
    how: "Health → your picture → Export All Health Data, unzip, pick export.xml." },
  { id: "manual", name: "Just type it", hc: false,
    how: "Read today's count off your phone or watch and type it in the box above. Quickest day to day." },
];
const MAX_DAY = 100000; // anything above is a bad row, not a day

export function localISODate(d) {
  const z = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// "8432", "8,432", "8 432", "8.4k" -> 8432 / 8400. Null if not a count.
export function toCount(s) {
  s = String(s == null ? "" : s).trim().toLowerCase().replace(/^"|"$/g, "");
  let m = s.match(/^(\d+(?:[.,]\d+)?)\s*k$/);
  if (m) return Math.round(parseFloat(m[1].replace(",", ".")) * 1000);
  s = s.replace(/[\s,']/g, "");
  if (/^\d+\.\d{3}$/.test(s)) s = s.replace(".", ""); // 8.432 = European thousands
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(parseFloat(s));
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, mo, da) => `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;

// The local calendar day a timestamp belongs to. A timestamp with a zone
// (Z or +03:00) is converted to this device's day; a bare one is taken as written.
// Epoch ms/s are converted too, except `utcDay` values (Samsung's day_time is
// UTC midnight of the day it means).
function toDate(s, utcDay = false) {
  s = String(s == null ? "" : s).trim().replace(/^"|"$/g, "");
  if (/^\d{10,13}$/.test(s)) {
    const d = new Date(+s * (s.length <= 10 ? 1000 : 1));
    return utcDay ? d.toISOString().slice(0, 10) : localISODate(d);
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s.replace(" ", "T").replace(/\s+([+-]\d{2})/, "$1").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    if (!isNaN(d)) return localISODate(d);
  }
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/);
  if (m) {
    const a = +m[1], b = +m[2]; // month/day unless the first can't be a month
    const [mo, da] = a > 12 ? [b, a] : [a, b];
    return iso(m[3].length === 2 ? 2000 + +m[3] : m[3], mo, da);
  }
  m = s.match(/^(?:[a-z]{3,9},?\s+)?([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i); // Oct 25, 2026 / Sun, Oct 25 2026
  if (m && MONTHS[m[1].toLowerCase()]) return iso(m[3], MONTHS[m[1].toLowerCase()], m[2]);
  m = s.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})/i); // 25 Oct 2026
  if (m && MONTHS[m[2].toLowerCase()]) return iso(m[3], MONTHS[m[2].toLowerCase()], m[1]);
  return null;
}

function splitCsvLine(line, sep) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === sep && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim());
}

// Records -> one figure per day. Each source (phone, watch, app) is summed on
// its own and the day takes the biggest, so the same walk logged by phone and
// watch is never added twice. Returns [{date, steps, source}].
function perDay(records, source) {
  const byDay = {};
  for (const { date, origin, n } of records) {
    if (!date || n == null || !(n >= 0)) continue;
    const d = byDay[date] || (byDay[date] = {});
    d[origin || ""] = (d[origin || ""] || 0) + n;
  }
  return Object.entries(byDay).map(([date, src]) => ({ date, steps: Math.max(...Object.values(src)), source }));
}

function parseLines(text, today) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m = line.match(/^STEPS\s+(\d{4}-\d{2}-\d{2})\s+(.+?)\s*(steps?)?$/i);
    if (m) { const n = toCount(m[2]); if (n != null) rows.push({ date: m[1], steps: n, source: "line" }); continue; }
    const n = toCount(line.replace(/\s*steps?$/i, ""));
    if (n != null) rows.push({ date: today, steps: n, source: "manual" });
  }
  return rows; // each is a whole-day figure: the latest per day wins
}

// Column picking, shared by CSV and JSON. Names are lower-cased with any
// "com.samsung.health.step_count." style prefix removed.
const DATE_KEYS = [/^(day_?time|calendar_?date|summary_?date)$/, /^(start|start_?time|starttime|start_?gmt|start_?local|from|datetime|date_?time)$/,
  /^(date|day)\b/, /^(timestamp|time|end_?time)$/, /date|time|start/];
const COUNT_KEYS = [/^(steps?|step_?count|total_?steps|daily_?steps|steps? \(count\)|steps? count|actual)$/, /^(count|value|amount|quantity|qty)\b/, /step/];
const NOT_COUNT = /goal|run|walk|length|speed|date|time|type|distance|calorie|unit|source|device|id$/;
// Most specific first: Samsung lists both an app package and a device per row.
const ORIGIN_KEYS = [/^device_?uuid$/, /^(data_?origin|origin)$/, /^(source_?name|device)$/, /^(source_?pkg_?name|pkg_?name|package(_?name)?|source|app)$/];
const pick = (names, tests, not) => {
  for (const re of tests) { const i = names.findIndex(n => re.test(n) && !(not && not.test(n) && !/^steps?$|step_?count|total_?steps/.test(n))); if (i >= 0) return i; }
  return -1;
};
const cleanName = h => h.toLowerCase().replace(/^"|"$/g, "").replace(/^com\.[a-z.]+?\.(step_count|step_daily_trend|pedometer_[a-z_]+|activity[a-z_.]*)\./, "").trim();

// "2026-10-24 22:30:00.000" in UTC + "UTC+0300" -> "2026-10-25".
function shiftedDate(ts, offset) {
  const m = String(offset || "").match(/([+-])(\d{2}):?(\d{2})/), t = Date.parse(String(ts).trim().replace(" ", "T") + "Z");
  if (!m || isNaN(t)) return toDate(ts);
  return new Date(t + (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) * 60000).toISOString().slice(0, 10);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  // The header is the first of the top lines with both a date and a count
  // column (Samsung puts a metadata line above it; Fitbit a section title).
  for (let h = 0; h < Math.min(6, lines.length - 1); h++) {
    const sep = [",", ";", "\t"].sort((a, b) => lines[h].split(b).length - lines[h].split(a).length)[0];
    const head = splitCsvLine(lines[h], sep).map(cleanName);
    // Garmin Connect's report export has a blank first header over the dates.
    const dateCol = head[0] === "" && head.length > 1 ? 0 : pick(head, DATE_KEYS), countCol = pick(head, COUNT_KEYS, NOT_COUNT);
    if (dateCol < 0 || countCol < 0 || dateCol === countCol) continue;
    const typeCol = head.findIndex(x => /^(type|data ?type|metric|record ?type)$/.test(x));
    const originCol = pick(head, ORIGIN_KEYS);
    const utcDay = /day_?time/.test(head[dateCol]);
    const offsetCol = head.findIndex(x => /^time_?offset$/.test(x)); // Samsung: times are UTC, offset beside them
    const recs = [];
    for (const line of lines.slice(h + 1)) {
      const c = splitCsvLine(line, sep);
      if (c.length < 2) break; // next Fitbit section
      if (typeCol >= 0 && !/step/i.test(c[typeCol] || "")) continue;
      recs.push({ date: offsetCol >= 0 ? shiftedDate(c[dateCol], c[offsetCol]) : toDate(c[dateCol], utcDay), n: toCount(c[countCol]), origin: originCol >= 0 ? c[originCol] : "" });
    }
    const rows = perDay(recs, "csv");
    if (rows.length) return rows;
  }
  return [];
}

// Garmin (UDSFile_*.json: calendarDate + totalSteps), Fitbit (steps-*.json:
// dateTime + value per minute), Health Connect / Google Fit JSON dumps.
function parseJson(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return []; }
  const recs = [];
  const walk = (v, depth) => {
    if (depth > 6 || v == null || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(x => walk(x, depth + 1)); return; }
    const keys = Object.keys(v), names = keys.map(cleanName);
    const di = pick(names, DATE_KEYS), ci = pick(names, COUNT_KEYS, NOT_COUNT);
    const type = v.type || v.dataType || v.recordType || "";
    if (di >= 0 && ci >= 0 && (typeof v[keys[ci]] !== "object") && (!type || /step/i.test(type))) {
      const oi = pick(names, ORIGIN_KEYS);
      const o = oi >= 0 ? v[keys[oi]] : "";
      recs.push({ date: toDate(v[keys[di]]), n: toCount(v[keys[ci]]), origin: typeof o === "object" ? JSON.stringify(o) : o });
      return;
    }
    keys.forEach(k => walk(v[k], depth + 1));
  };
  walk(data, 0);
  return perDay(recs, "json");
}

// Apple Health export.xml (for an iPhone or an old export).
function parseAppleXml(text) {
  const recs = [], re = /<Record\b[^>]*type="HKQuantityTypeIdentifierStepCount"[^>]*>/g;
  let m;
  while ((m = re.exec(text))) {
    const tag = m[0], attr = k => (tag.match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1];
    recs.push({ date: toDate(attr("startDate")), n: toCount(attr("value")), origin: attr("sourceName") });
  }
  return perDay(recs, "apple-xml");
}

// Returns [{date, steps, source}] sorted by date, one row per day.
// source: "manual" | "line" | "csv" | "json" | "apple-xml".
export function parseSteps(text, now = new Date()) {
  text = String(text || "").replace(/^﻿/, "").trim();
  const top = text.split(/\r?\n/).slice(0, 3);
  let rows;
  if (/HKQuantityTypeIdentifierStepCount/.test(text)) rows = parseAppleXml(text);
  else if (/^[\[{]/.test(text)) rows = parseJson(text);
  else if (top.some(l => /[,;\t]/.test(l) && /[a-z]/i.test(l) && !/^STEPS\s/i.test(l))) rows = parseCsv(text);
  else rows = parseLines(text, localISODate(now));
  const byDay = {};
  for (const r of rows) if (r.steps >= 0 && r.steps <= MAX_DAY) byDay[r.date] = r;
  return Object.values(byDay).filter(r => r.steps > 0 || r.source === "manual" || r.source === "line").sort((a, b) => a.date.localeCompare(b.date));
}

// Count on a day doc. Accepts the object form or a bare number.
export function stepCount(day) {
  const s = day && day.steps;
  if (typeof s === "number") return s;
  return s && s.count || 0;
}

// Sets the day's count (returns a new day doc). Importing a day again replaces
// it, so syncing twice never double counts.
export function setSteps(day, count, source = "manual", now = new Date()) {
  count = Math.max(0, Math.min(MAX_DAY, Math.round(+count || 0)));
  return Object.assign({}, day, { steps: { count, at: now.toISOString(), source } });
}

export function applySteps(day, row, now = new Date()) {
  return setSteps(day, row.steps, row.source, now);
}

// Adds to the day's count (the +1,000 chips). Never goes below 0.
export function addSteps(day, delta, now = new Date()) {
  return setSteps(day, stepCount(day) + (+delta || 0), "manual", now);
}

export function stepGoal(prefs) {
  const g = prefs && +prefs.stepGoal;
  return g >= 1000 && g <= MAX_DAY ? Math.round(g) : DEFAULT_GOAL;
}

// Progress for the card: {count, goal, pct (0-100), left, hit}.
export function stepProgress(day, goal = DEFAULT_GOAL) {
  const count = stepCount(day);
  return { count, goal, pct: Math.min(100, Math.round(count / goal * 100)), left: Math.max(0, goal - count), hit: count >= goal };
}

// The 7 days ending on `date`: {avg (over days with a count), logged, hitDays}.
// getDay(isoDate) -> day doc or undefined.
export function weekSteps(getDay, date, goal = DEFAULT_GOAL) {
  const [y, m, d] = date.split("-").map(Number);
  let sum = 0, logged = 0, hitDays = 0;
  for (let i = 0; i < 7; i++) {
    const n = stepCount(getDay(localISODate(new Date(y, m - 1, d - i))));
    if (n > 0) { sum += n; logged++; if (n >= goal) hitDays++; }
  }
  return { avg: logged ? Math.round(sum / logged) : 0, logged, hitDays };
}

const fmtN = n => Math.round(n).toLocaleString("en-US");

// The Today-tab card, in the app's own classes (.card .spread .row .bigk .num
// .muted .bar .chip .btn). Wire these in the app's click/change handlers:
//   data-act="stepsadd" data-n="1000"   -> addSteps
//   data-act="stepsset"                 -> setSteps from #stepsInput
//   data-act="stepsimport"              -> parseSteps(#stepsText) + applySteps per row
//   #stepsFile (change)                 -> same, from the file's text
//   data-act="stepsgoal"                -> prefs/main.stepGoal from #stepsGoalInput
//   syncHTML: an optional block (the Health Connect status, HealthConnectSteps.html) shown under the bar.
//   When the day's source is "health-connect" the +chips and Set box are hidden: the next sync would
//   overwrite them anyway.
export function stepsCardHTML(day, { goal = DEFAULT_GOAL, week = null, syncHTML = "" } = {}) {
  const p = stepProgress(day, goal);
  const s = day && day.steps && typeof day.steps === "object" ? day.steps : null;
  const hc = !!(s && s.source === "health-connect");
  const status = p.hit ? `Goal hit, ${fmtN(p.count - goal)} over` : `${fmtN(p.left)} to go`;
  const synced = s && s.at ? ` · ${s.source === "manual" || s.source === "line" ? "updated" : hc ? "synced" : "imported"} ${new Date(s.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "";
  const origin = hc ? "From your phone via Health Connect" : s && (s.source === "manual" || s.source === "line") ? "Entered by hand" : "Imported from a step app";
  const weekLine = week && week.logged ? `<p class="muted" style="font-size:.85rem">7-day average <span class="num">${fmtN(week.avg)}</span> · goal hit ${week.hitDays} of ${week.logged} logged days</p>` : "";
  const field = "border:1px solid var(--line);background:var(--sunk);border-radius:8px;padding:6px 8px;font-family:var(--mono);font-size:.85rem;color:var(--ink)";
  return `<div class="card steps-card">
  <div class="spread"><h3>Steps</h3><span class="muted">Goal ${fmtN(goal)}</span></div>
  <div class="row"><span class="bigk num">${fmtN(p.count)}</span><span class="muted">${status}</span></div>
  <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}" aria-label="Steps toward goal"><span style="width:${p.pct}%;--value:${p.pct}${p.hit ? ";background:var(--good)" : ""}"></span></div>
  ${s ? `<p class="muted" style="font-size:.85rem">${origin}${synced}</p>` : ""}
  ${weekLine}
  ${syncHTML || ""}
  ${hc ? "" : `<div class="row"><button class="chip" data-act="stepsadd" data-n="1000">+1,000</button><button class="chip" data-act="stepsadd" data-n="2500">+2,500</button><button class="chip" data-act="stepsadd" data-n="-1000">−1,000</button></div>
  <div class="row"><input id="stepsInput" type="number" inputmode="numeric" min="0" max="${MAX_DAY}" placeholder="Today's count" aria-label="Today's step count" style="width:9rem;${field}"><button class="btn small" data-act="stepsset">Set</button></div>`}
  <details><summary>Import from a step app</summary>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
      <p class="muted" style="font-size:.85rem">Pick an export file from any app below, or paste lines like <span class="num">STEPS 2026-10-25 8432</span>. The format is detected. Importing a day again replaces its count, and phone + watch are never added twice.</p>
      ${STEP_SOURCES.map(s => `<details class="steps-src"><summary>${s.name}${s.hc ? ' <span class="muted" style="font-size:.8rem">· Health Connect</span>' : ""}</summary><p class="muted" style="font-size:.85rem;margin:4px 0 0">${s.how}</p></details>`).join("")}
      <textarea id="stepsText" rows="2" style="width:100%;${field}" placeholder="STEPS 2026-10-25 8432"></textarea>
      <div class="row"><button class="btn small" data-act="stepsimport">Apply</button><label class="btn ghost small" style="cursor:pointer">Choose file<input type="file" id="stepsFile" accept=".csv,.json,.xml,.txt" hidden></label></div>
    </div>
  </details>
  <details><summary>Change goal</summary>
    <div class="row" style="margin-top:8px"><input id="stepsGoalInput" type="number" inputmode="numeric" min="1000" max="${MAX_DAY}" step="500" value="${goal}" aria-label="Daily step goal" style="width:7rem;${field}"><button class="btn small ghost" data-act="stepsgoal">Save goal</button></div>
  </details>
  <p class="muted" style="font-size:.88rem">Your 30-minute treadmill walk after lifting covers roughly 3,000 to 4,000 of these. Steady daily steps keep the cut moving without eating into recovery.</p>
</div>`;
}
