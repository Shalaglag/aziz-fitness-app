// Daily steps: parses what the phone hands over (a typed number or a Health
// Connect / Google Fit CSV), folds it into a `days/{date}` doc, and renders
// the "Steps" goal card for the Today tab. Plain ES module, no dependencies,
// no network.
//
// A Claude Artifact can't read Health Connect, so the phone hands the number
// over: type today's count from the phone's step widget, or export a CSV with
// a Health Connect exporter (e.g. "Health Data Export" on Play) for back-fill.
//
// Accepted input (one paste or one file):
//   8432 / 8,432 / 8.4k             <- a bare number = today
//   STEPS 2026-10-25 8432           <- one line per day (latest line wins)
//   CSV, daily:   Date,Steps        (also Google Fit "Step count")
//   CSV, records: start_time,end_time,count[,data_origin]
//   CSV, long:    time,type,value   (only rows whose type is steps)
// Health Connect record exports list the phone and a watch separately, so
// records are summed per source and the day takes the biggest source, never
// phone + watch added together.
//
// Day doc field this module owns:
//   steps: { count, at (ISO of last change), source: "manual"|"csv"|"line" }
// Goal lives in prefs/main.stepGoal (default DEFAULT_GOAL).

export const DEFAULT_GOAL = 10000;
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

// The local calendar day a timestamp belongs to. A timestamp with a zone
// (Z or +03:00) is converted to this device's day; a bare one is taken as written.
function toDate(s) {
  s = String(s || "").trim().replace(/^"|"$/g, "");
  if (/^\d{10,13}$/.test(s)) return localISODate(new Date(+s * (s.length === 10 ? 1000 : 1)));
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    if (!isNaN(d)) return localISODate(d);
  }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (m) {
    const a = +m[1], b = +m[2]; // month/day unless the first can't be a month
    const [mo, da] = a > 12 ? [b, a] : [a, b];
    return `${m[3]}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  }
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

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const sep = [",", ";", "\t"].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const head = splitCsvLine(lines[0], sep).map(h => h.toLowerCase().replace(/^"|"$/g, ""));
  const find = re => head.findIndex(h => re.test(h));
  const dateCol = [/^(start|start_?time|starttime|from)\b/, /^(date|day)\b/, /date|time|start/].map(find).find(i => i >= 0);
  const typeCol = find(/^(type|data ?type|metric|record ?type)$/);
  let countCol = find(/step/);
  if (countCol === dateCol) countCol = -1;
  if (countCol < 0) countCol = find(/^(count|value|amount|quantity|qty)\b/);
  const originCol = find(/origin|source|package|app/);
  if (dateCol == null || dateCol < 0 || countCol < 0) return [];
  // day -> origin -> sum
  const byDay = {};
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line, sep);
    if (typeCol >= 0 && !/step/i.test(c[typeCol] || "")) continue;
    const date = toDate(c[dateCol]), n = toCount(c[countCol]);
    if (!date || n == null) continue;
    const o = originCol >= 0 ? (c[originCol] || "") : "";
    const d = byDay[date] || (byDay[date] = {});
    d[o] = (d[o] || 0) + n;
  }
  return Object.entries(byDay).map(([date, src]) => ({ date, steps: Math.max(...Object.values(src)), source: "csv" }));
}

// Returns [{date, steps, source}] sorted by date, one row per day.
export function parseSteps(text, now = new Date()) {
  text = String(text || "").trim();
  const first = text.split(/\r?\n/)[0] || "";
  const isCsv = /[,;\t]/.test(first) && /[a-z]/i.test(first) && !/^STEPS\s/i.test(first);
  const rows = isCsv ? parseCsv(text) : parseLines(text, localISODate(now));
  const byDay = {};
  for (const r of rows) if (r.steps >= 0 && r.steps <= MAX_DAY) byDay[r.date] = r;
  return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
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
export function stepsCardHTML(day, { goal = DEFAULT_GOAL, week = null } = {}) {
  const p = stepProgress(day, goal);
  const s = day && day.steps && typeof day.steps === "object" ? day.steps : null;
  const status = p.hit ? `Goal hit, ${fmtN(p.count - goal)} over` : `${fmtN(p.left)} to go`;
  const synced = s && s.at ? ` · ${s.source === "csv" ? "imported" : "updated"} ${new Date(s.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "";
  const weekLine = week && week.logged ? `<p class="muted" style="font-size:.85rem">7-day average <span class="num">${fmtN(week.avg)}</span> · goal hit ${week.hitDays} of ${week.logged} logged days</p>` : "";
  const field = "border:1px solid var(--line);background:var(--sunk);border-radius:8px;padding:6px 8px;font-family:var(--mono);font-size:.85rem;color:var(--ink)";
  return `<div class="card steps-card">
  <div class="spread"><h3>Steps</h3><span class="muted">Goal ${fmtN(goal)}</span></div>
  <div class="row"><span class="bigk num">${fmtN(p.count)}</span><span class="muted">${status}</span></div>
  <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}" aria-label="Steps toward goal"><span style="width:${p.pct}%;--value:${p.pct}${p.hit ? ";background:var(--good)" : ""}"></span></div>
  ${s ? `<p class="muted" style="font-size:.85rem">${s.source === "csv" ? "From Health Connect" : "Entered by hand"}${synced}</p>` : ""}
  ${weekLine}
  <div class="row"><button class="chip" data-act="stepsadd" data-n="1000">+1,000</button><button class="chip" data-act="stepsadd" data-n="2500">+2,500</button><button class="chip" data-act="stepsadd" data-n="-1000">−1,000</button></div>
  <div class="row"><input id="stepsInput" type="number" inputmode="numeric" min="0" max="${MAX_DAY}" placeholder="Today's count" aria-label="Today's step count" style="width:9rem;${field}"><button class="btn small" data-act="stepsset">Set</button></div>
  <details><summary>Import from Health Connect</summary>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
      <p class="muted" style="font-size:.85rem">Export Steps as CSV with a Health Connect exporter, then pick the file, or paste lines like <span class="num">STEPS 2026-10-25 8432</span>. Importing a day again replaces its count instead of adding to it.</p>
      <textarea id="stepsText" rows="2" style="width:100%;${field}" placeholder="STEPS 2026-10-25 8432"></textarea>
      <div class="row"><button class="btn small" data-act="stepsimport">Apply</button><label class="btn ghost small" style="cursor:pointer">Choose file<input type="file" id="stepsFile" accept=".csv,.txt" hidden></label></div>
    </div>
  </details>
  <details><summary>Change goal</summary>
    <div class="row" style="margin-top:8px"><input id="stepsGoalInput" type="number" inputmode="numeric" min="1000" max="${MAX_DAY}" step="500" value="${goal}" aria-label="Daily step goal" style="width:7rem;${field}"><button class="btn small ghost" data-act="stepsgoal">Save goal</button></div>
  </details>
  <p class="muted" style="font-size:.88rem">Your 30-minute treadmill walk after lifting covers roughly 3,000 to 4,000 of these. Steady daily steps keep the cut moving without eating into recovery.</p>
</div>`;
}
