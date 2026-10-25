// WaterH import: turns what the phone hands over (a Shortcut line, a Health
// Connect / Health Auto Export CSV, or Apple Health's export.xml) into daily
// water totals, and folds them into a `days/{date}` doc. Plain ES module, no
// dependencies, no network.
//
// WaterH has no public API. It writes every sip to Apple Health (iPhone) or
// Google Fit / Health Connect (Android), so the bridge is the phone's health
// store, not WaterH itself.
//
// Accepted input (any mix, one paste or one file):
//   WATERH 2026-10-25 2350          <- the iPhone Shortcut line (ml)
//   WATERH 2026-10-25 2.35 L        <- units: ml, l, L, oz, fl oz, cup
//   2350                            <- a bare number = today
//   CSV with a date/time column and a water/volume/hydration column
//   Apple export.xml <Record type="HKQuantityTypeIdentifierDietaryWater" .../>
//
// Day doc fields this module owns:
//   waterh: { ml, at (ISO of import), source: "shortcut"|"csv"|"apple-xml"|"manual" }
// `water` stays the manual counter (Gatorade, shakes, glasses not from the
// bottle). The day's total is totalWater(day) = water + waterh.ml.

const UNIT_ML = { ml: 1, milliliter: 1, milliliters: 1, l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000,
  oz: 29.5735, floz: 29.5735, "fl oz": 29.5735, "fl_oz_us": 29.5735, cup: 236.588, cups: 236.588 };

function toMl(value, unit, fallbackUnit) {
  const n = parseFloat(String(value).replace(",", "."));
  if (!isFinite(n)) return null;
  let u = String(unit || fallbackUnit || "").toLowerCase().replace(/[()\s]+/g, " ").trim();
  if (u === "fl oz" || u === "fl_oz" || u === "fl oz us") u = "oz";
  let f = UNIT_ML[u];
  if (f == null) f = n < 20 ? 1000 : 1; // unitless: small numbers are litres
  return Math.round(n * f);
}

export function localISODate(d) {
  const z = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// "2026-10-25 14:03:00 +0300", "2026-10-25T11:03:00Z", "10/25/2026", "25/10/2026 14:03"
function toDate(s) {
  s = String(s || "").trim().replace(/^"|"$/g, "");
  // The date as written is the phone's local day, which is the day Aziz drank it.
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (m) {
    let a = +m[1], b = +m[2]; // month/day unless the first can't be a month
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

function parseShortcutLines(text, today) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m = line.match(/^WATERH\s+(\d{4}-\d{2}-\d{2})\s+([\d.,]+)\s*([a-zA-Z ]*)$/i);
    if (m) { rows.push({ date: m[1], ml: toMl(m[2], m[3], "ml"), source: "shortcut", whole: true }); continue; }
    m = line.match(/^([\d.,]+)\s*(ml|l|oz|fl oz|cups?)?$/i);
    if (m && line) rows.push({ date: today, ml: toMl(m[1], m[2], "ml"), source: "manual", whole: true });
  }
  return rows;
}

function parseAppleXml(text) {
  const rows = [];
  const re = /<Record\b[^>]*type="HKQuantityTypeIdentifierDietaryWater"[^>]*>/g;
  let m;
  while ((m = re.exec(text))) {
    const tag = m[0], attr = k => (tag.match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1];
    const date = toDate(attr("startDate"));
    const ml = toMl(attr("value"), attr("unit"), "ml");
    if (date && ml != null) rows.push({ date, ml, source: "apple-xml" });
  }
  return rows;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const sep = [",", ";", "\t"].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const head = splitCsvLine(lines[0], sep).map(h => h.toLowerCase());
  const dateCol = head.findIndex(h => /(^|\b)(date|start|time|day)/.test(h));
  let volCol = head.findIndex(h => /water|hydration|volume|intake/.test(h) && !/date|time|type/.test(h));
  // Long format (time,type,value,unit): keep only the water rows.
  const typeCol = head.findIndex(h => /^(type|data ?type|metric|record ?type)$/.test(h));
  if (volCol < 0) volCol = head.findIndex(h => /^(value|amount|quantity|qty)/.test(h));
  if (dateCol < 0 || volCol < 0) return [];
  const unitCol = head.findIndex(h => /^unit/.test(h));
  const headUnit = (head[volCol].match(/\(([^)]+)\)/) || [])[1]
    || (head[volCol].match(/\b(ml|l|oz|fl oz|liters?|litres?)\b/) || [])[1];
  const rows = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line, sep);
    if (typeCol >= 0 && !/water|hydration/i.test(c[typeCol] || "")) continue;
    const date = toDate(c[dateCol]);
    if (!date || c[volCol] === "" || c[volCol] == null) continue;
    const ml = toMl(c[volCol], unitCol >= 0 ? c[unitCol] : headUnit, headUnit || "ml");
    if (ml != null) rows.push({ date, ml, source: "csv" });
  }
  return rows;
}

// Returns [{date, ml, source}] sorted by date, one row per day (summed).
export function parseWaterH(text, now = new Date()) {
  text = String(text || "");
  const today = localISODate(now);
  let rows;
  if (/HKQuantityTypeIdentifierDietaryWater/.test(text)) rows = parseAppleXml(text);
  else if (/^\s*WATERH\s|^\s*[\d.,]+\s*(ml|l|oz|fl oz|cups?)?\s*$/im.test(text) && !/[,;\t].*[,;\t]/.test(text.split(/\r?\n/)[0])) rows = parseShortcutLines(text, today);
  else rows = parseCsv(text);
  const byDay = {};
  for (const r of rows) {
    if (!r.ml || r.ml < 0) continue;
    const d = byDay[r.date] || (byDay[r.date] = { date: r.date, ml: 0, source: r.source });
    // A Shortcut line is already the day's total: the latest line wins, never summed.
    d.ml = r.whole ? r.ml : d.ml + r.ml;
  }
  return Object.values(byDay).filter(r => r.ml > 0 && r.ml < 20000).sort((a, b) => a.date.localeCompare(b.date));
}

// Writes the WaterH total onto a day doc (returns a new object). Re-importing
// the same day replaces the old figure, so syncing twice never double counts.
export function applyWaterH(day, row, now = new Date()) {
  return Object.assign({}, day, { waterh: { ml: Math.round(row.ml), at: now.toISOString(), source: row.source } });
}

export function totalWater(day) {
  return (day && day.water || 0) + (day && day.waterh && day.waterh.ml || 0);
}
