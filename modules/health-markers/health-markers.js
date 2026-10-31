/* Health markers for the Aziz Cut Tracker: user-defined numbers that aren't weight, food or lifts
 * (resting heart rate, blood pressure, waist, lab values…), each with a unit, an optional reference
 * range, a history and a chart. Plain JS, no imports, no network.
 *
 * Data (one synced collection, in the shell's COLS so backups include it):
 *   markers/{id} = {id, name, unit, kind:"num"|"bp", low, high, decimals, note, createdAt,
 *                   entries:[{id, date "YYYY-MM-DD", v, v2?, note?, at}]}
 *   kind "bp" stores systolic in v and diastolic in v2 and is typed as "120/80".
 *   low/high are the user's own reference range (null when not set); nothing is diagnosed, a value
 *   outside the range only gets a "Low"/"High" pill.
 *
 * API (browser global HealthMarkers or CommonJS):
 *   HealthMarkers.css                              -> string, inject once (uses the app's tokens)
 *   HealthMarkers.PRESETS                          -> [{key, name, unit, kind, low, high, decimals}] common markers
 *   HealthMarkers.defs(docs)                       -> marker docs sorted by name (docs = S.docs, reads docs.markers)
 *   HealthMarkers.newMarker(input, {now, uid})     -> {ok, doc, errors}; input = {preset} or {name, unit, kind, low, high}
 *   HealthMarkers.parseValue(text, def)            -> {ok, v, v2}  ("72", "120/80", "5,4")
 *   HealthMarkers.addEntry(doc, {date, value, note}, {now, uid}) -> {ok, doc, errors}
 *   HealthMarkers.removeEntry(doc, entryId)        -> new doc
 *   HealthMarkers.entries(doc)                     -> entries oldest first
 *   HealthMarkers.latest(doc)                      -> newest entry or null
 *   HealthMarkers.status(def, entry)               -> "low" | "high" | "ok" | null (null when no range)
 *   HealthMarkers.format(def, entry)               -> "72 bpm", "120/80 mmHg"
 *   HealthMarkers.stats(doc, {today, days})        -> {latest, prev, change, n, min, max, avg} over the window
 *   HealthMarkers.chartSvg(doc, {today, days})     -> SVG string ("" with fewer than 2 points)
 *   HealthMarkers.html(docs, {today, date, openId, adding, confirmDel}) -> Progress card
 *   HealthMarkers.summary(docs, {today})           -> plain-text lines for the coach / reports
 *   HealthMarkers.handle(el, ctx)                  -> true when it handled a click; ctx = {docs, date, put, remove,
 *                                                     toast, rerender, uid}. Buttons carry data-hm="…".
 */
const HealthMarkers = (() => {
  const DAY = 864e5;
  const COL = "markers";
  const PRESETS = [
    { key: "rhr", name: "Resting heart rate", unit: "bpm", kind: "num", low: 50, high: 80, decimals: 0 },
    { key: "bp", name: "Blood pressure", unit: "mmHg", kind: "bp", low: 90, high: 130, decimals: 0 },
    { key: "waist", name: "Waist", unit: "cm", kind: "num", low: null, high: null, decimals: 1 },
    { key: "bodyfat", name: "Body fat", unit: "%", kind: "num", low: null, high: null, decimals: 1 },
    { key: "hrv", name: "HRV", unit: "ms", kind: "num", low: null, high: null, decimals: 0 },
    { key: "glucose", name: "Fasting glucose", unit: "mmol/L", kind: "num", low: 3.9, high: 5.6, decimals: 1 },
    { key: "hba1c", name: "HbA1c", unit: "%", kind: "num", low: null, high: 5.7, decimals: 1 },
    { key: "chol", name: "Total cholesterol", unit: "mmol/L", kind: "num", low: null, high: 5.2, decimals: 2 },
    { key: "ldl", name: "LDL", unit: "mmol/L", kind: "num", low: null, high: 3.4, decimals: 2 },
    { key: "hdl", name: "HDL", unit: "mmol/L", kind: "num", low: 1.0, high: null, decimals: 2 },
    { key: "trig", name: "Triglycerides", unit: "mmol/L", kind: "num", low: null, high: 1.7, decimals: 2 },
    { key: "vitd", name: "Vitamin D", unit: "ng/mL", kind: "num", low: 30, high: 100, decimals: 0 },
    { key: "ferritin", name: "Ferritin", unit: "ng/mL", kind: "num", low: 30, high: 400, decimals: 0 },
    { key: "testo", name: "Testosterone", unit: "ng/dL", kind: "num", low: 300, high: 1000, decimals: 0 },
    { key: "tsh", name: "TSH", unit: "mIU/L", kind: "num", low: 0.4, high: 4.0, decimals: 2 },
    { key: "temp", name: "Body temperature", unit: "°C", kind: "num", low: 36.1, high: 37.2, decimals: 1 },
  ];
  const PRESET = Object.fromEntries(PRESETS.map(p => [p.key, p]));

  const ms = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const localISO = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const num = v => {
    if (typeof v === "string") { v = v.trim().replace(",", "."); if (v === "") return null; v = Number(v); }
    return typeof v === "number" && isFinite(v) ? v : null;
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const defaultUid = () => Math.random().toString(36).slice(2, 9);
  const nowISO = o => (o && o.now ? new Date(o.now) : new Date()).toISOString();
  const todayOf = o => (o && o.today) || localISO(new Date());
  const fmtDate = s => { const d = new Date(ms(s)); return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); };
  const fmtN = (n, dec) => n == null ? "—" : Number(n).toFixed(dec == null ? (Math.abs(n) < 10 ? 1 : 0) : dec);
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "marker";

  function defs(docs) {
    const m = (docs && docs[COL]) || {};
    return Object.values(m).filter(d => d && d.id && d.name).sort((a, b) => a.name.localeCompare(b.name));
  }

  function newMarker(input, opts = {}) {
    input = input || {};
    const p = input.preset ? PRESET[input.preset] : null;
    const name = String(input.name != null && String(input.name).trim() ? input.name : p ? p.name : "").trim().slice(0, 40);
    const unit = String(input.unit != null && String(input.unit).trim() ? input.unit : p ? p.unit : "").trim().slice(0, 12);
    const kind = input.kind || (p ? p.kind : "num");
    const hasOwnRange = input.low !== undefined || input.high !== undefined; // the form always sends both; cleared = no range
    const low = hasOwnRange ? num(input.low) : p ? p.low : null;
    const high = hasOwnRange ? num(input.high) : p ? p.high : null;
    const errors = [];
    if (!name) errors.push("name");
    if (kind !== "num" && kind !== "bp") errors.push("kind");
    if ((input.low != null && String(input.low).trim() !== "" && low == null) || (input.high != null && String(input.high).trim() !== "" && high == null)) errors.push("range");
    if (low != null && high != null && low >= high) errors.push("range");
    if (errors.length) return { ok: false, errors };
    const id = (opts.uid || defaultUid)();
    const decimals = input.decimals != null ? num(input.decimals) : p ? p.decimals : null;
    return { ok: true, errors: [], doc: { id: slug(name) + "-" + id, name, unit, kind, low, high, decimals, preset: p ? p.key : null, createdAt: nowISO(opts), entries: [] } };
  }

  function parseValue(text, def) {
    const kind = (def && def.kind) || "num";
    const t = String(text == null ? "" : text).trim();
    if (kind === "bp") {
      const m = t.match(/^(\d+(?:[.,]\d+)?)\s*[\/ ]\s*(\d+(?:[.,]\d+)?)$/);
      if (!m) return { ok: false };
      const v = num(m[1]), v2 = num(m[2]);
      if (v == null || v2 == null || v <= 0 || v2 <= 0 || v2 >= v) return { ok: false };
      return { ok: true, v, v2 };
    }
    const v = num(t);
    if (v == null) return { ok: false };
    return { ok: true, v };
  }

  function entries(doc) {
    const list = (doc && Array.isArray(doc.entries) ? doc.entries : []).filter(e => e && isDate(e.date) && num(e.v) != null);
    return list.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.at || "").localeCompare(String(b.at || "")));
  }
  const latest = doc => { const l = entries(doc); return l.length ? l[l.length - 1] : null; };

  function addEntry(doc, input, opts = {}) {
    input = input || {};
    const errors = [];
    const date = isDate(input.date) ? input.date : null;
    if (!date) errors.push("date");
    const pv = parseValue(input.value, doc);
    if (!pv.ok) errors.push("value");
    if (errors.length) return { ok: false, errors };
    const note = input.note ? String(input.note).trim().slice(0, 80) : "";
    const e = { id: (opts.uid || defaultUid)(), date, v: pv.v, at: nowISO(opts) };
    if (pv.v2 != null) e.v2 = pv.v2;
    if (note) e.note = note;
    return { ok: true, errors: [], doc: Object.assign({}, doc, { entries: entries(doc).concat([e]) }) };
  }

  function removeEntry(doc, id) {
    return Object.assign({}, doc, { entries: entries(doc).filter(e => e.id !== id) });
  }

  function status(def, e) {
    if (!def || !e || (def.low == null && def.high == null)) return null;
    if (def.kind === "bp") {
      // systolic against the range, diastolic high when 85+ (the usual companion to a 130 systolic cut-off)
      if (def.high != null && (e.v > def.high || (e.v2 != null && e.v2 > Math.round(def.high * 0.65)))) return "high";
      if (def.low != null && e.v < def.low) return "low";
      return "ok";
    }
    if (def.high != null && e.v > def.high) return "high";
    if (def.low != null && e.v < def.low) return "low";
    return "ok";
  }
  const STATUS_LABEL = { low: "Low", high: "High", ok: "In range" };
  const STATUS_CLASS = { low: "warn", high: "warn", ok: "good" };

  function format(def, e) {
    if (!e) return "—";
    const dec = def && def.decimals != null ? def.decimals : null;
    const val = def && def.kind === "bp" ? fmtN(e.v, 0) + "/" + fmtN(e.v2, 0) : fmtN(e.v, dec);
    return val + (def && def.unit ? " " + def.unit : "");
  }

  function stats(doc, opts = {}) {
    const today = todayOf(opts), days = opts.days || 90;
    const all = entries(doc);
    const from = iso(ms(today) - (days - 1) * DAY);
    const win = all.filter(e => e.date >= from && e.date <= today);
    const last = all.length ? all[all.length - 1] : null, prev = all.length > 1 ? all[all.length - 2] : null;
    const vals = win.map(e => e.v);
    const r = { latest: last, prev, change: last && prev ? last.v - prev.v : null, n: win.length, min: null, max: null, avg: null };
    if (vals.length) { r.min = Math.min(...vals); r.max = Math.max(...vals); r.avg = vals.reduce((a, b) => a + b, 0) / vals.length; }
    return r;
  }

  function chartSvg(doc, opts = {}) {
    const today = todayOf(opts), days = opts.days || 90;
    const from = iso(ms(today) - (days - 1) * DAY);
    let rows = entries(doc).filter(e => e.date <= today);
    const inWin = rows.filter(e => e.date >= from);
    rows = inWin.length >= 2 ? inWin : rows.slice(-12);
    if (rows.length < 2) return "";
    const W = 320, H = 110, P = { l: 34, r: 8, t: 8, b: 18 };
    const bp = doc.kind === "bp";
    const vals = rows.flatMap(e => bp && e.v2 != null ? [e.v, e.v2] : [e.v]).concat(doc.low != null ? [doc.low] : [], doc.high != null ? [doc.high] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const t0 = ms(rows[0].date), t1 = Math.max(ms(rows[rows.length - 1].date), t0 + DAY);
    const x = d => P.l + (ms(d) - t0) / (t1 - t0) * (W - P.l - P.r);
    const y = v => P.t + (hi - v) / (hi - lo) * (H - P.t - P.b);
    const dec = doc.decimals != null ? doc.decimals : (hi - lo < 5 ? 1 : 0);
    let g = "";
    if (doc.low != null && doc.high != null) g += `<rect x="${P.l}" y="${y(doc.high).toFixed(1)}" width="${W - P.l - P.r}" height="${Math.max(0, y(doc.low) - y(doc.high)).toFixed(1)}" fill="var(--good)" opacity=".12"/>`;
    for (const b of [doc.low, doc.high]) if (b != null) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(b).toFixed(1)}" y2="${y(b).toFixed(1)}" stroke="var(--good)" stroke-dasharray="3 3" stroke-width="1"/>`;
    g += `<line x1="${P.l}" x2="${P.l}" y1="${P.t}" y2="${H - P.b}" stroke="var(--line)"/>`;
    g += `<text x="${P.l - 4}" y="${y(hi - pad).toFixed(1) + 4}" text-anchor="end" font-size="9" fill="var(--muted)">${fmtN(hi - pad, dec)}</text>`;
    g += `<text x="${P.l - 4}" y="${y(lo + pad).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${fmtN(lo + pad, dec)}</text>`;
    g += `<text x="${P.l}" y="${H - 4}" font-size="9" fill="var(--muted)">${fmtDate(rows[0].date)}</text>`;
    g += `<text x="${W - P.r}" y="${H - 4}" text-anchor="end" font-size="9" fill="var(--muted)">${fmtDate(rows[rows.length - 1].date)}</text>`;
    const line = (key, stroke, dash) => `<path d="${rows.map((e, i) => (i ? "L" : "M") + x(e.date).toFixed(1) + " " + y(e[key]).toFixed(1)).join("")}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"${dash ? ' stroke-dasharray="4 3"' : ""}/>`
      + rows.map(e => `<circle cx="${x(e.date).toFixed(1)}" cy="${y(e[key]).toFixed(1)}" r="2.6" fill="${stroke}"/>`).join("");
    g += line("v", "var(--accent)", false);
    if (bp && rows.every(e => e.v2 != null)) g += line("v2", "var(--muted)", true);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(doc.name)} over time">${g}</svg>`;
  }

  const css = `
.hm-card .hm-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 10px;background:var(--sunk);border-radius:8px;cursor:pointer;border:0;width:100%;text-align:left;font:inherit;color:var(--ink)}
.hm-card .hm-row b{font-family:var(--mono);font-weight:600;white-space:nowrap}
.hm-card .hm-row .hm-name{flex:1;min-width:0}
.hm-card .hm-row .hm-sub{display:block;font-size:.78rem;color:var(--muted)}
.hm-card .hm-list{display:flex;flex-direction:column;gap:6px}
.hm-card .hm-open{border:1px solid var(--line);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:10px}
.hm-card .hm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}
.hm-card label.hm-f{display:flex;flex-direction:column;gap:3px;font-size:.8rem;color:var(--muted)}
.hm-card label.hm-f input,.hm-card label.hm-f select{font:inherit;font-size:1rem;color:var(--ink);background:var(--sunk);border:1px solid var(--line);border-radius:8px;padding:8px;min-width:0;width:100%;box-sizing:border-box}
.hm-card .hm-bad input{border-color:var(--bad)}
.hm-card .hm-err{color:var(--bad);font-size:.85rem}
.hm-card .hm-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.hm-card .hm-stat{background:var(--sunk);border-radius:8px;padding:8px;text-align:center}
.hm-card .hm-stat b{display:block;font-family:var(--mono);font-size:1.05rem}
.hm-card .hm-stat span{font-size:.75rem;color:var(--muted)}
.hm-card svg{width:100%;height:auto;display:block}
.hm-card table{width:100%;border-collapse:collapse;font-size:.85rem}
.hm-card td,.hm-card th{padding:5px 4px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
.hm-card td:first-child,.hm-card th:first-child{text-align:left}
.hm-card td.hm-note{text-align:left;white-space:normal;color:var(--muted)}
.hm-card th{color:var(--muted);font-weight:500}
.hm-card .hm-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.hm-card .hm-x{background:none;border:0;color:var(--muted);cursor:pointer;font-size:1rem;padding:0 4px}
@media (max-width:420px){.hm-card .hm-stats{grid-template-columns:repeat(2,1fr)}}`;

  function changeText(def, st) {
    if (st.change == null) return "";
    const dec = def.decimals != null ? def.decimals : (Math.abs(st.change) < 10 ? 1 : 0);
    const s = (st.change > 0 ? "+" : "") + fmtN(st.change, dec);
    return `<span class="hm-sub">${s}${def.unit ? " " + esc(def.unit) : ""} since ${fmtDate(st.prev.date)}</span>`;
  }

  function pill(def, e) {
    const st = status(def, e);
    return st ? `<span class="pill ${STATUS_CLASS[st]}">${STATUS_LABEL[st]}</span>` : "";
  }

  function rowHTML(def, today) {
    const st = stats(def, { today });
    const l = st.latest;
    return `<button type="button" class="hm-row" data-hm="open" data-id="${esc(def.id)}">
      <span class="hm-name">${esc(def.name)}<span class="hm-sub">${l ? "Last " + fmtDate(l.date) : "Nothing logged yet"}</span>${changeText(def, st)}</span>
      ${pill(def, l)}<b>${esc(format(def, l))}</b></button>`;
  }

  function openHTML(def, opts) {
    const today = todayOf(opts), date = isDate(opts.date) ? opts.date : today;
    const st = stats(def, { today, days: 90 });
    const list = entries(def).slice().reverse();
    const dec = def.decimals;
    const rangeTxt = def.low != null || def.high != null
      ? `Range ${def.low != null ? fmtN(def.low, dec) : "…"}–${def.high != null ? fmtN(def.high, dec) : "…"}${def.kind === "bp" ? " systolic" : ""}${def.unit ? " " + esc(def.unit) : ""}`
      : "No range set";
    const placeholder = def.kind === "bp" ? "120/80" : "e.g. 72";
    const confirm = opts.confirmDel === def.id;
    return `<div class="hm-open" data-id="${esc(def.id)}">
      <div class="hm-actions" style="justify-content:space-between">
        <div><strong>${esc(def.name)}</strong> <span class="muted" style="font-size:.85rem">${rangeTxt}</span></div>
        <button type="button" class="hm-x" data-hm="close" aria-label="Close">✕</button>
      </div>
      <form class="hm-form" data-id="${esc(def.id)}" onsubmit="return false">
        <div class="hm-grid">
          <label class="hm-f" data-hm-f="date">Date<input type="date" name="date" value="${esc(date)}" max="${esc(today)}"></label>
          <label class="hm-f" data-hm-f="value">${def.kind === "bp" ? "Sys/dia" : "Value"}${def.unit ? " (" + esc(def.unit) + ")" : ""}<input name="value" inputmode="decimal" placeholder="${placeholder}" autocomplete="off"></label>
          <label class="hm-f">Note<input name="note" maxlength="80" placeholder="optional"></label>
        </div>
        <p class="hm-err" hidden></p>
        <div class="hm-actions" style="margin-top:8px"><button type="button" class="btn small" data-hm="log">Log it</button></div>
      </form>
      ${st.latest ? `<div class="hm-stats">
        <div class="hm-stat"><b>${esc(format(def, st.latest))}</b><span>Latest</span></div>
        <div class="hm-stat"><b>${st.n ? fmtN(st.avg, dec != null ? dec : 1) : "—"}</b><span>90-day avg</span></div>
        <div class="hm-stat"><b>${st.n ? fmtN(st.min, dec) : "—"}</b><span>90-day low</span></div>
        <div class="hm-stat"><b>${st.n ? fmtN(st.max, dec) : "—"}</b><span>90-day high</span></div>
      </div>` : ""}
      ${chartSvg(def, { today, days: 90 })}
      ${list.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>${def.kind === "bp" ? "Sys/dia" : "Value"}</th><th></th><th></th></tr></thead><tbody>
        ${list.slice(0, 30).map(e => `<tr><td>${fmtDate(e.date)}</td><td><b style="font-family:var(--mono)">${esc(format(def, e))}</b></td><td class="hm-note">${pill(def, e)}${e.note ? " " + esc(e.note) : ""}</td><td><button type="button" class="hm-x" data-hm="del-entry" data-id="${esc(def.id)}" data-entry="${esc(e.id)}" aria-label="Remove entry">✕</button></td></tr>`).join("")}
      </tbody></table></div>${list.length > 30 ? `<p class="muted" style="font-size:.8rem">Showing the last 30 of ${list.length}.</p>` : ""}` : `<p class="muted">Log the first value above. Two or more make a chart.</p>`}
      <div class="hm-actions"><button type="button" class="btn ghost small" data-hm="del-marker" data-id="${esc(def.id)}"${confirm ? ' data-confirm="1"' : ""}>${confirm ? "Tap again to delete this marker and its history" : "Delete marker"}</button></div>
    </div>`;
  }

  function addFormHTML(opts) {
    const sel = opts.preset || "";
    const p = PRESET[sel];
    return `<form class="hm-add hm-open" onsubmit="return false">
      <div class="hm-actions" style="justify-content:space-between"><strong>New marker</strong><button type="button" class="hm-x" data-hm="close" aria-label="Close">✕</button></div>
      <div class="hm-grid">
        <label class="hm-f">Pick one<select name="preset" data-hm-sel="preset">
          <option value="">Custom…</option>
          ${PRESETS.map(x => `<option value="${x.key}" ${x.key === sel ? "selected" : ""}>${esc(x.name)} (${esc(x.unit)})</option>`).join("")}
        </select></label>
        <label class="hm-f" data-hm-f="name">Name<input name="name" maxlength="40" value="${p ? esc(p.name) : ""}" placeholder="e.g. Resting HR"></label>
        <label class="hm-f">Unit<input name="unit" maxlength="12" value="${p ? esc(p.unit) : ""}" placeholder="e.g. bpm"></label>
        <label class="hm-f" data-hm-f="range">Range low<input name="low" inputmode="decimal" value="${p && p.low != null ? p.low : ""}" placeholder="optional"></label>
        <label class="hm-f" data-hm-f="range">Range high<input name="high" inputmode="decimal" value="${p && p.high != null ? p.high : ""}" placeholder="optional"></label>
      </div>
      <input type="hidden" name="kind" value="${p ? p.kind : "num"}">
      <p class="hm-err" hidden></p>
      <div class="hm-actions"><button type="button" class="btn small" data-hm="add-marker">Add marker</button></div>
    </form>`;
  }

  function html(docs, opts = {}) {
    const today = todayOf(opts);
    const list = defs(docs);
    const open = opts.openId ? list.find(d => d.id === opts.openId) : null;
    let body;
    if (opts.adding) body = addFormHTML(opts);
    else if (open) body = openHTML(open, Object.assign({}, opts, { today }));
    else body = list.length
      ? `<div class="hm-list">${list.map(d => rowHTML(d, today)).join("")}</div>`
      : `<p class="muted">Track anything that isn't on the scale: resting heart rate, blood pressure, waist, a blood test. Each marker keeps its unit, a range and a chart.</p>`;
    const add = opts.adding || open ? "" : `<div class="hm-actions" style="margin-top:10px"><button type="button" class="btn ghost small" data-hm="add">+ Add a marker</button></div>`;
    return `<div class="card hm-card"><h3>Health markers</h3>${body}${add}</div>`;
  }

  function summary(docs, opts = {}) {
    const today = todayOf(opts);
    return defs(docs).map(d => {
      const st = stats(d, { today, days: 90 });
      if (!st.latest) return null;
      const s = status(d, st.latest);
      return `${d.name}: ${format(d, st.latest)} on ${fmtDate(st.latest.date)}` + (s && s !== "ok" ? ` (${STATUS_LABEL[s].toLowerCase()})` : "") + (st.change != null ? `, ${st.change > 0 ? "+" : ""}${fmtN(st.change, d.decimals != null ? d.decimals : 1)} since the previous reading` : "");
    }).filter(Boolean);
  }

  function readForm(form) {
    const o = {};
    form.querySelectorAll("input,select").forEach(i => { if (i.name) o[i.name] = i.value; });
    return o;
  }
  function showErr(form, errors, labels) {
    form.querySelectorAll(".hm-bad").forEach(x => x.classList.remove("hm-bad"));
    errors.forEach(k => form.querySelectorAll(`[data-hm-f="${k}"]`).forEach(f => f.classList.add("hm-bad")));
    const err = form.querySelector(".hm-err");
    if (err) { err.hidden = false; err.textContent = "Check " + errors.map(k => labels[k] || k).join(", ") + "."; }
  }

  function handle(el, ctx) {
    const b = el && el.closest && el.closest("[data-hm]");
    if (!b) return false;
    const act = b.dataset.hm, card = b.closest(".hm-card");
    const docs = ctx.docs || {}, markers = docs[COL] || {};
    const rer = o => ctx.rerender && ctx.rerender(o || {});
    if (act === "add") { rer({ adding: true }); return true; }
    if (act === "close") { rer({}); return true; }
    if (act === "open") { rer({ openId: b.dataset.id }); return true; }
    if (act === "add-marker") {
      const form = b.closest("form");
      const res = newMarker(readForm(form), { uid: ctx.uid });
      if (!res.ok) { showErr(form, res.errors, { name: "the name", range: "the range (low must be under high)", kind: "the kind" }); return true; }
      ctx.put(COL, res.doc.id, res.doc);
      ctx.toast && ctx.toast(res.doc.name + " added");
      rer({ openId: res.doc.id });
      return true;
    }
    const id = b.dataset.id || (b.closest("[data-id]") && b.closest("[data-id]").dataset.id);
    const doc = markers[id];
    if (!doc) { rer({}); return true; }
    if (act === "log") {
      const form = b.closest("form");
      const res = addEntry(doc, readForm(form), { uid: ctx.uid });
      if (!res.ok) { showErr(form, res.errors, { date: "the date", value: doc.kind === "bp" ? "the reading (type it as 120/80)" : "the value" }); return true; }
      ctx.put(COL, id, res.doc);
      const e = res.doc.entries[res.doc.entries.length - 1];
      const st = status(doc, e);
      ctx.toast && ctx.toast(`${doc.name}: ${format(doc, e)}` + (st && st !== "ok" ? ` (${STATUS_LABEL[st].toLowerCase()} for your range)` : ""));
      rer({ openId: id });
      return true;
    }
    if (act === "del-entry") {
      ctx.put(COL, id, removeEntry(doc, b.dataset.entry));
      ctx.toast && ctx.toast("Entry removed");
      rer({ openId: id });
      return true;
    }
    if (act === "del-marker") {
      if (!b.dataset.confirm) { rer({ openId: id, confirmDel: id }); return true; }
      ctx.remove(COL, id);
      ctx.toast && ctx.toast(doc.name + " deleted");
      rer({});
      return true;
    }
    return false;
  }

  // Preset picker: fill name/unit/range when the select changes (wire to a "change" listener or call from the shell)
  function onPresetChange(sel) {
    const form = sel && sel.closest && sel.closest("form.hm-add");
    if (!form) return false;
    const p = PRESET[sel.value];
    const set = (n, v) => { const i = form.querySelector(`[name="${n}"]`); if (i) i.value = v == null ? "" : v; };
    set("name", p ? p.name : ""); set("unit", p ? p.unit : ""); set("low", p ? p.low : ""); set("high", p ? p.high : ""); set("kind", p ? p.kind : "num");
    return true;
  }

  return { css, COL, PRESETS, defs, newMarker, parseValue, entries, latest, addEntry, removeEntry, status, format, stats, chartSvg, html, summary, handle, onPresetChange };
})();
if (typeof module !== "undefined" && module.exports) module.exports = { HealthMarkers };
