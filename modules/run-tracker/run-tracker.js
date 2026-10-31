/* RunTracker: GPS outdoor runs with a route map, splits, GPX and a Google Maps link.
 *
 * Plain JS, no imports, no network. Extends the cardio module: a finished run is saved as a
 * `cardio/{date}` session of kind "run" (so Cardio progress, the weekly report and the coach see
 * it) and the route itself goes to a new `runs/{date}` doc.
 *
 * API
 *   RunTracker.css
 *   RunTracker.haversine(a, b)                  -> metres between two [lat, lng] points
 *   RunTracker.accept(prev, p, acc)             -> keep a GPS fix? (accuracy, teleport and jitter filter)
 *   RunTracker.stats(pts)                       -> {km, sec, paceSec, splits:[{km, sec}], gain, maxKmh}
 *   RunTracker.thin(pts, max)                   -> at most `max` points, ends kept
 *   RunTracker.svg(pts, {w, h, splits})         -> drawn route (SVG string) with start, end and km dots
 *   RunTracker.mapsLink(pts)                    -> Google Maps directions URL along the route (walking)
 *   RunTracker.gpx(run) / parseGPX(text)        -> GPX export and import (Strava, Garmin, Google Fit…)
 *   RunTracker.runs(doc) / withRun / withoutRun -> runs/{date} helpers
 *   RunTracker.toSession(run, {weightKg})       -> the Cardio session a run becomes (kind "run")
 *   RunTracker.cardHTML(date, docs, live)       -> Train card (start / live stats / saved runs)
 *   RunTracker.progressHTML(docs, {today})      -> Progress card (last runs, best pace, total km)
 *   RunTracker.handle(el, ctx)                  -> click handler; buttons carry data-run="start|pause|finish|discard|del|gpx|import"
 *   RunTracker.live()                           -> the current live state ({} when not running)
 *   RunTracker.onPosition(pos) / tick()         -> fed by the host (or by handle via navigator.geolocation)
 *
 * Point = [lat, lng, ele|null, tSec]  (tSec since the run started). Stored thinned to ≤ 600 points.
 */
const RunTracker = (() => {
  const R = 6371000, DAY = 864e5;
  const MAX_ACC = 35;        // metres: fixes less accurate than this are skipped
  const MAX_MS = 8;          // m/s: faster than this between fixes is a GPS jump, not running
  const MIN_STEP = 2.5;      // metres: smaller moves are jitter while standing
  const GAP_SEC = 60;        // a gap longer than this between fixes counts as paused, not moving
  const MAX_PTS = 600;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const localISO = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const f2 = n => (Math.round(n * 100) / 100).toFixed(2);
  const rad = d => d * Math.PI / 180;
  const mmss = s => { s = Math.round(s); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const hms = s => { s = Math.round(s); return s >= 3600 ? Math.floor(s / 3600) + ":" + String(Math.floor(s % 3600 / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0") : mmss(s); };
  const pace = (km, sec) => km > 0.05 ? mmss(sec / km) + " /km" : "—";
  const fmtDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); };

  function haversine(a, b) {
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // prev = last accepted point or null, p = candidate point, acc = reported accuracy in metres.
  function accept(prev, p, acc) {
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) return false;
    if (acc != null && acc > MAX_ACC) return false;
    if (!prev) return true;
    const d = haversine(prev, p), dt = p[3] - prev[3];
    if (d < MIN_STEP) return false;
    if (dt > 0 && d / dt > MAX_MS) return false;
    return true;
  }

  function stats(pts) {
    let m = 0, sec = 0, gain = 0, maxKmh = 0, nextKm = 1000, splitStart = 0;
    const splits = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const d = haversine(a, b), dt = b[3] - a[3];
      const moving = dt > 0 && dt <= GAP_SEC ? dt : 0;   // a gap over GAP_SEC is a pause: distance counts, time doesn't
      const secBefore = sec; sec += moving;
      if (moving && d / dt * 3.6 > maxKmh) maxKmh = d / dt * 3.6;
      if (a[2] != null && b[2] != null && b[2] > a[2]) gain += b[2] - a[2];
      const before = m; m += d;
      while (m >= nextKm) {                               // interpolate the moment the km line was crossed
        const frac = d > 0 ? (nextKm - before) / d : 1;
        const at = secBefore + moving * frac;
        splits.push({ km: nextKm / 1000, sec: Math.round(at - splitStart), t: a[3] + (dt > 0 ? dt : 0) * frac });
        splitStart = at; nextKm += 1000;
      }
    }
    const km = m / 1000;
    return { km: Math.round(km * 1000) / 1000, sec: Math.round(sec), paceSec: km > 0.05 ? Math.round(sec / km) : null, splits, gain: Math.round(gain), maxKmh: Math.round(maxKmh * 10) / 10 };
  }

  function thin(pts, max = MAX_PTS) {
    if (pts.length <= max) return pts.slice();
    const out = [], step = (pts.length - 1) / (max - 1);
    for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
    return out;
  }

  // Equirectangular projection fitted into w×h, aspect kept.
  function project(pts, w, h, pad) {
    const lats = pts.map(p => p[0]), lngs = pts.map(p => p[1]);
    const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2, k = Math.cos(rad(lat0));
    const xs = pts.map(p => p[1] * k), ys = pts.map(p => -p[0]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 1e-6);
    const s = Math.min(w - 2 * pad, h - 2 * pad) / span;
    const ox = (w - (maxX - minX) * s) / 2, oy = (h - (maxY - minY) * s) / 2;
    return pts.map((p, i) => [ox + (xs[i] - minX) * s, oy + (ys[i] - minY) * s]);
  }

  function svg(pts, opts = {}) {
    const w = opts.w || 320, h = opts.h || 200, pad = 14;
    if (!pts || pts.length < 2) return `<div class="rt-nomap muted">No route yet</div>`;
    const xy = project(thin(pts, 400), w, h, pad);
    const d = xy.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
    const dots = (opts.splits || []).map(sp => {
      // place each km dot at the point whose time is nearest the crossing
      let best = 0; for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i][3] - sp.t) < Math.abs(pts[best][3] - sp.t)) best = i;
      const q = project(pts, w, h, pad)[best];
      return `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="7" fill="var(--surface)" stroke="var(--ink)"/><text x="${q[0].toFixed(1)}" y="${(q[1] + 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--ink)">${sp.km}</text>`;
    }).join("");
    const a = xy[0], z = xy[xy.length - 1];
    return `<svg class="rt-map" viewBox="0 0 ${w} ${h}" role="img" aria-label="Route map, ${pts.length} GPS points">
      <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/>
      ${dots}<circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="5" fill="var(--good)" stroke="var(--surface)" stroke-width="2"><title>Start</title></circle>
      <rect x="${(z[0] - 4.5).toFixed(1)}" y="${(z[1] - 4.5).toFixed(1)}" width="9" height="9" fill="var(--ink)" stroke="var(--surface)" stroke-width="2"><title>Finish</title></rect></svg>`;
  }

  const ll = p => p[0].toFixed(5) + "," + p[1].toFixed(5);
  function mapsLink(pts) {
    if (!pts || !pts.length) return null;
    if (pts.length === 1) return "https://www.google.com/maps/search/?api=1&query=" + ll(pts[0]);
    const n = Math.min(9, pts.length - 2), mid = [];   // Google Maps takes at most 9 waypoints in a URL
    for (let i = 1; i <= n; i++) mid.push(pts[Math.round(i * (pts.length - 1) / (n + 1))]);
    return "https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=" + ll(pts[0]) + "&destination=" + ll(pts[pts.length - 1]) +
      (mid.length ? "&waypoints=" + mid.map(ll).join("|") : "");
  }

  function gpx(run) {
    const t0 = Date.parse(run.startAt) || 0;
    const trk = (run.pts || []).map(p => `<trkpt lat="${p[0]}" lon="${p[1]}">${p[2] != null ? `<ele>${p[2]}</ele>` : ""}<time>${new Date(t0 + p[3] * 1000).toISOString()}</time></trkpt>`).join("\n      ");
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Aziz Cut Tracker" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><time>${new Date(t0).toISOString()}</time></metadata>
  <trk><name>Run ${esc(run.date || "")}</name><type>running</type>
    <trkseg>
      ${trk}
    </trkseg>
  </trk>
</gpx>
`;
  }

  // Minimal GPX reader: every <trkpt> (or <rtept>) with lat/lon, optional <ele> and <time>.
  function parseGPX(text) {
    const pts = [];
    const re = /<(?:trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/(?:trkpt|rtept)>|<(?:trkpt|rtept)\b([^>]*)\/>/g;
    let m, t0 = null;
    while ((m = re.exec(text))) {
      const attrs = m[1] || m[3] || "", inner = m[2] || "";
      const lat = Number((attrs.match(/lat="([^"]+)"/) || [])[1]), lon = Number((attrs.match(/lon="([^"]+)"/) || [])[1]);
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const ele = (inner.match(/<ele>([^<]+)<\/ele>/) || [])[1], tm = (inner.match(/<time>([^<]+)<\/time>/) || [])[1];
      const ts = tm ? Date.parse(tm) : NaN;
      if (t0 == null && isFinite(ts)) t0 = ts;
      pts.push([lat, lon, ele != null && isFinite(Number(ele)) ? Math.round(Number(ele) * 10) / 10 : null, isFinite(ts) && t0 != null ? Math.round((ts - t0) / 1000) : pts.length]);
    }
    const name = (text.match(/<name>([^<]*)<\/name>/) || [])[1];
    return { pts, startAt: t0 != null ? new Date(t0).toISOString() : null, name: name ? name.trim() : null };
  }

  function runs(doc) { return Array.isArray(doc && doc.runs) ? doc.runs.filter(r => r && Array.isArray(r.pts)) : []; }
  function withRun(doc, run, date) { return { date: (doc && doc.date) || date, runs: [...runs(doc).filter(r => r.id !== run.id), run] }; }
  function withoutRun(doc, id, date) { return { date: (doc && doc.date) || date, runs: runs(doc).filter(r => r.id !== id) }; }

  // Build the stored run from raw points.
  function makeRun(pts, startAt, extra = {}) {
    const s = stats(pts);
    return Object.assign({ id: uid(), date: localISO(new Date(startAt)), startAt: new Date(startAt).toISOString(), km: s.km, sec: s.sec, paceSec: s.paceSec, gain: s.gain, maxKmh: s.maxKmh,
      splits: s.splits.map(x => ({ km: x.km, sec: x.sec, t: Math.round(x.t) })), pts: thin(pts) }, extra);
  }

  function toSession(run, opts = {}) {
    const min = Math.max(1, Math.round(run.sec / 60));
    const input = { kind: "run", min, km: run.km, source: run.source || "gps", at: run.startAt, id: "run-" + run.id };
    let s;
    if (typeof Cardio !== "undefined" && Cardio && Cardio.clean) s = Cardio.clean(input, { weightKg: opts.weightKg }).session;
    else s = Object.assign({ speed: run.km > 0 ? Math.round(run.km / (min / 60) * 10) / 10 : null, effort: null }, input);
    s.runId = run.id;
    return s;
  }

  /* ---------- live tracking ---------- */
  let L = {};             // {startAt, pts:[], raw:0, paused, lastAcc, err, watchId, timer, wake}
  const live = () => L;
  function reset() { if (L.watchId != null && L.geo) { try { L.geo.clearWatch(L.watchId); } catch (e) {} } if (L.timer) clearInterval(L.timer); try { L.wake && L.wake.release(); } catch (e) {} L = {}; }

  function onPosition(pos) {
    if (!L.startAt || L.paused) return;
    const c = pos.coords || pos;
    const t = ((pos.timestamp || Date.now()) - L.startAt) / 1000;
    const p = [c.latitude, c.longitude, c.altitude != null && isFinite(c.altitude) ? Math.round(c.altitude * 10) / 10 : null, Math.round(t)];
    L.raw = (L.raw || 0) + 1; L.lastAcc = c.accuracy;
    if (accept(L.pts[L.pts.length - 1] || null, p, c.accuracy)) L.pts.push(p);
    tick();
  }

  // Updates the live card in place; the host calls render() only on start/finish.
  function tick(doc) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    if (!doc || !L.startAt) return;
    const s = stats(L.pts);
    const el = id => doc.getElementById(id);
    const set = (id, v) => { const e = el(id); if (e) e.textContent = v; };
    set("rt-time", hms(L.paused ? L.pausedAt - L.startAt - (L.pausedTotal || 0) : Date.now() - L.startAt - (L.pausedTotal || 0)) );
    set("rt-km", f2(s.km)); set("rt-pace", pace(s.km, s.sec));
    set("rt-gps", L.err ? L.err : L.lastAcc != null ? `GPS ±${Math.round(L.lastAcc)} m · ${L.pts.length} points` : "Waiting for GPS…");
    const map = el("rt-livemap"); if (map && L.pts.length >= 2 && L.pts.length % 3 === 0) map.innerHTML = svg(L.pts, { w: 320, h: 160 });
  }

  function start(ctx) {
    const geo = ctx.geo || (typeof navigator !== "undefined" ? navigator.geolocation : null);
    if (!geo) { ctx.toast && ctx.toast("No GPS on this device/browser"); return false; }
    reset();
    L = { startAt: ctx.now ? ctx.now() : Date.now(), pts: [], raw: 0, paused: false, pausedTotal: 0, geo };
    try {
      L.watchId = geo.watchPosition(onPosition, e => { L.err = e && e.code === 1 ? "Location blocked. Allow it in the browser/site settings, or import a GPX file below." : "GPS error: " + (e && e.message || "unknown"); tick(); },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    } catch (e) { L.err = "GPS error: " + e.message; }
    if (typeof setInterval !== "undefined" && !ctx.noTimer) L.timer = setInterval(() => tick(), 1000);
    try { if (typeof navigator !== "undefined" && navigator.wakeLock) navigator.wakeLock.request("screen").then(w => { L.wake = w; }).catch(() => {}); } catch (e) {}
    return true;
  }

  function finish(ctx) {
    if (!L.startAt) return null;
    const pts = L.pts.slice(), startAt = L.startAt;
    reset();
    if (pts.length < 2) { ctx.toast && ctx.toast("Not enough GPS points to save a run"); return null; }
    const run = makeRun(pts, startAt);
    saveRun(run, ctx);
    ctx.toast && ctx.toast(`Run saved: ${f2(run.km)} km in ${hms(run.sec)} (${pace(run.km, run.sec)})`);
    return run;
  }

  function saveRun(run, ctx) {
    const docs = ctx.docs || {};
    ctx.put("runs", run.date, withRun((docs.runs || {})[run.date], run, run.date));
    if (typeof Cardio !== "undefined" && Cardio && Cardio.withSession) {
      const before = (docs.cardio || {})[run.date];
      ctx.put("cardio", run.date, Cardio.withSession(before, toSession(run, { weightKg: ctx.weightKg }), run.date));
    }
  }

  function importGPX(text, ctx, dateHint) {
    const g = parseGPX(text);
    if (g.pts.length < 2) { ctx.toast && ctx.toast("No track points found in that file"); return null; }
    const startAt = g.startAt ? Date.parse(g.startAt) : Date.parse((dateHint || localISO(new Date())) + "T07:00:00");
    const run = makeRun(g.pts, startAt, { source: "gpx", name: g.name || undefined });
    saveRun(run, ctx);
    ctx.toast && ctx.toast(`Imported ${f2(run.km)} km run on ${fmtDate(run.date)}`);
    return run;
  }

  /* ---------- HTML ---------- */
  const css = `
.rt-card .rt-big{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center}
.rt-card .rt-big b{display:block;font-size:1.5rem;font-variant-numeric:tabular-nums}
.rt-card .rt-big span{font-size:.75rem;color:var(--muted)}
.rt-map{width:100%;height:auto;background:var(--sunk);border:1px solid var(--line);border-radius:10px;display:block}
.rt-nomap{background:var(--sunk);border:1px dashed var(--line);border-radius:10px;padding:28px;text-align:center}
.rt-run{display:flex;flex-direction:column;gap:8px;padding:10px 0;border-top:1px solid var(--line)}
.rt-run .rt-line{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.rt-splits{display:flex;gap:6px;flex-wrap:wrap;font-size:.8rem}
.rt-splits span{background:var(--sunk);border-radius:6px;padding:2px 6px;font-variant-numeric:tabular-nums}
.rt-card .btn.go{background:var(--good);border-color:var(--good);color:#fff}
.rt-card .btn.stop{background:var(--ink);border-color:var(--ink);color:var(--surface)}
`;

  function runHTML(r, opts = {}) {
    const link = mapsLink(r.pts);
    return `<div class="rt-run" data-id="${esc(r.id)}">
      <div class="rt-line"><div><b>${f2(r.km)} km</b> · ${hms(r.sec)} · ${pace(r.km, r.sec)}${r.gain ? ` · ↑${r.gain} m` : ""}${r.source === "gpx" ? ' <span class="muted">(imported)</span>' : ""}</div>
        <span class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn small ghost" data-run="gpx" data-id="${esc(r.id)}" data-date="${esc(r.date)}">GPX</button><button class="btn small ghost" data-run="del" data-id="${esc(r.id)}" data-date="${esc(r.date)}" aria-label="Delete run">✕</button></span></div>
      ${opts.map === false ? "" : svg(r.pts, { w: 320, h: 180, splits: r.splits })}
      ${r.splits && r.splits.length ? `<div class="rt-splits">${r.splits.map(s => `<span>km ${s.km} · ${mmss(s.sec)}</span>`).join("")}</div>` : ""}
      ${link ? `<a class="btn ghost small" href="${esc(link)}" target="_blank" rel="noopener">Open route in Google Maps ↗</a>` : ""}
    </div>`;
  }

  function cardHTML(date, docs, liveState) {
    docs = docs || {}; const Lv = liveState || L;
    const list = runs((docs.runs || {})[date]).sort((a, b) => (a.startAt || "").localeCompare(b.startAt || ""));
    let body;
    if (Lv.startAt) {
      const s = stats(Lv.pts || []);
      body = `<div class="rt-big"><div><b id="rt-time">${hms(Date.now() - Lv.startAt)}</b><span>time</span></div><div><b id="rt-km">${f2(s.km)}</b><span>km</span></div><div><b id="rt-pace">${pace(s.km, s.sec)}</b><span>pace</span></div></div>
        <div id="rt-livemap">${svg(Lv.pts || [], { w: 320, h: 160 })}</div>
        <p class="muted" id="rt-gps" style="margin:0;font-size:.85rem">${esc(Lv.err || (Lv.lastAcc != null ? `GPS ±${Math.round(Lv.lastAcc)} m · ${Lv.pts.length} points` : "Waiting for GPS…"))}</p>
        <div class="row"><button class="btn" data-run="pause">${Lv.paused ? "Resume" : "Pause"}</button><button class="btn stop" data-run="finish">Finish &amp; save</button><button class="btn ghost" data-run="discard">Discard</button></div>
        <p class="muted" style="font-size:.8rem;margin:0">Keep the screen on and the app open while you run. The route is drawn as you go; it's saved as a cardio session when you finish.</p>`;
    } else {
      body = `<div class="row"><button class="btn go" data-run="start">▶ Start GPS run</button>
          <label class="btn ghost small" style="cursor:pointer">Import GPX<input type="file" id="rtFile" accept=".gpx,application/gpx+xml" hidden></label><button class="btn ghost small" data-run="import" data-date="${esc(date)}">Add file</button></div>
        <p class="muted" style="font-size:.8rem;margin:0">Uses your phone's GPS. If location is blocked here, export a GPX from Strava, Garmin or Google Fit and import it.</p>`;
    }
    const saved = list.length ? list.map(r => runHTML(r)).join("") : "";
    return `<div class="card rt-card" id="rtCard"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Outdoor run${list.length ? ` <span class="muted" style="font-weight:normal">${f2(list.reduce((a, r) => a + r.km, 0))} km today</span>` : ""}</h3></div>${body}${saved}</div>`;
  }

  function history(runsMap) {
    return Object.values(runsMap || {}).flatMap(d => runs(d)).sort((a, b) => (a.startAt || "").localeCompare(b.startAt || ""));
  }

  function progressHTML(docs, opts = {}) {
    const all = history((docs || {}).runs);
    if (!all.length) return "";
    const today = opts.today || localISO(new Date());
    const t0 = Date.parse(today + "T00:00:00Z");
    const inWeek = (r, n) => { const t = Date.parse(r.date + "T00:00:00Z"); return t > t0 - n * DAY && t <= t0 - (n - 7) * DAY; };
    const wk = all.filter(r => inWeek(r, 7)), prev = all.filter(r => inWeek(r, 14));
    const km = rs => rs.reduce((a, r) => a + r.km, 0);
    const best = all.filter(r => r.km >= 1).reduce((b, r) => (!b || r.paceSec < b.paceSec) ? r : b, null);
    const longest = all.reduce((b, r) => (!b || r.km > b.km) ? r : b, null);
    const delta = km(wk) - km(prev);
    const recent = all.slice(-5).reverse();
    return `<div class="card rt-card"><h3 style="margin:0">Running</h3>
      <div class="rt-big"><div><b>${f1(km(wk))}</b><span>km this week${prev.length ? ` (${delta >= 0 ? "+" : ""}${f1(delta)})` : ""}</span></div><div><b>${best ? mmss(best.paceSec) : "—"}</b><span>best pace /km</span></div><div><b>${longest ? f1(longest.km) : "—"}</b><span>longest km</span></div></div>
      <p class="muted" style="margin:0;font-size:.85rem">${all.length} run${all.length === 1 ? "" : "s"} · ${f1(km(all))} km in total. Pace is moving time only (stops over a minute are skipped).</p>
      <details><summary class="muted">Last ${recent.length} run${recent.length === 1 ? "" : "s"}</summary>${recent.map(r => `<div class="rt-run"><div class="rt-line"><div><b>${esc(fmtDate(r.date))}</b> · ${f2(r.km)} km · ${hms(r.sec)} · ${pace(r.km, r.sec)}</div></div>${svg(r.pts, { w: 320, h: 120 })}</div>`).join("")}</details></div>`;
  }

  function summary(docs, opts = {}) {
    const all = history((docs || {}).runs);
    if (!all.length) return "";
    const today = opts.today || localISO(new Date());
    const wk = all.filter(r => Date.parse(r.date) > Date.parse(today) - 7 * DAY);
    return `Running: ${wk.length} run${wk.length === 1 ? "" : "s"} this week, ${f1(wk.reduce((a, r) => a + r.km, 0))} km${wk.length ? ", avg pace " + mmss(wk.reduce((a, r) => a + r.sec, 0) / Math.max(0.01, wk.reduce((a, r) => a + r.km, 0))) + " /km" : ""}.`;
  }

  function download(name, text, ctx) {
    if (ctx.download) return ctx.download(name, text);
    try {
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/gpx+xml" })); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    } catch (e) { ctx.toast && ctx.toast("Couldn't download: " + e.message); }
  }

  // ctx = {docs, put, toast, rerender, weightKg, geo?, now?, download?, readFile?}
  function handle(el, ctx) {
    const b = el && el.closest && el.closest("[data-run]");
    if (!b) return false;
    const act = b.dataset.run, docs = ctx.docs || {};
    if (act === "start") { if (start(ctx)) { ctx.toast && ctx.toast("GPS run started"); ctx.rerender && ctx.rerender(); } }
    else if (act === "pause") {
      if (!L.startAt) return true;
      if (L.paused) { L.pausedTotal = (L.pausedTotal || 0) + (Date.now() - L.pausedAt); L.paused = false; } else { L.paused = true; L.pausedAt = Date.now(); }
      ctx.rerender && ctx.rerender();
    }
    else if (act === "finish") { finish(ctx); ctx.rerender && ctx.rerender(); }
    else if (act === "discard") { reset(); ctx.toast && ctx.toast("Run discarded"); ctx.rerender && ctx.rerender(); }
    else if (act === "del") {
      const date = b.dataset.date, id = b.dataset.id;
      ctx.put("runs", date, withoutRun((docs.runs || {})[date], id, date));
      if (typeof Cardio !== "undefined" && Cardio && Cardio.withoutSession && (docs.cardio || {})[date]) ctx.put("cardio", date, Cardio.withoutSession(docs.cardio[date], "run-" + id, date));
      ctx.toast && ctx.toast("Run removed");
    }
    else if (act === "gpx") {
      const r = runs((docs.runs || {})[b.dataset.date]).find(x => x.id === b.dataset.id);
      if (r) download(`run-${r.date}.gpx`, gpx(r), ctx);
    }
    else if (act === "import") {
      const inp = typeof document !== "undefined" ? document.getElementById("rtFile") : null;
      const file = inp && inp.files && inp.files[0];
      if (!file) { ctx.toast && ctx.toast("Choose a .gpx file first"); return true; }
      const done = text => { importGPX(text, ctx, b.dataset.date); ctx.rerender && ctx.rerender(); };
      if (ctx.readFile) ctx.readFile(file).then(done); else { const fr = new FileReader(); fr.onload = () => done(String(fr.result)); fr.readAsText(file); }
    }
    return true;
  }

  return { css, MAX_ACC, haversine, accept, stats, thin, svg, mapsLink, gpx, parseGPX, runs, withRun, withoutRun, makeRun, toSession, live, onPosition, tick, start, finish, importGPX, history, cardHTML, progressHTML, summary, handle, _reset: reset };
})();
if (typeof module !== "undefined") module.exports = { RunTracker };
