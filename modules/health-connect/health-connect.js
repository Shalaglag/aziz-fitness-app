/* Health Connect → Water card: automatic WaterH sync on Android.
 *
 * Flow: WaterH bottle → WaterH app → Android Health Connect (HydrationRecord) → this module.
 * Nothing here talks to the network. The native side is a tiny Capacitor plugin
 * (android/HealthConnectPlugin.kt in this folder, `window.Capacitor.Plugins.HealthConnect`);
 * on the web, or before the Android thread registers the plugin, every call is a no-op and the
 * Water card keeps its paste / file fallback.
 *
 * Plugin interface this module expects (all methods return promises):
 *   isAvailable()                    → {status: "available"|"not_installed"|"not_supported"}
 *   hasHydrationAccess()             → {granted: bool}
 *   requestHydrationAccess()         → {granted: bool}
 *   (not checkPermissions/requestPermissions: those are Capacitor Plugin built-ins)
 *   readHydration({startMs, endMs})  → {records: [Rec]}
 *   getChangesToken()                → {token}
 *   getChanges({token})              → {changes: [{type:"upsert", record: Rec} | {type:"delete", id}],
 *                                       nextToken, hasMore, expired}
 *   openSettings()
 *   Rec = {id, startMs, endMs, ml, origin (package name), lastModifiedMs, startOffsetSec?}
 *
 * Day doc fields this module owns (same field the WaterH paste importer uses, so every
 * consumer that reads `waterh.ml` keeps working):
 *   waterh: { ml, at, source: "health-connect", records: { [hcId]: {ml, s, e, o, m} } }
 * `water` (manual taps) and the Drinks card are never touched, so a sip from the bottle and a
 * Gatorade logged by hand are never mixed. Dedupe is by Health Connect record id; a record that
 * repeats another one's start, end and ml from a different app is treated as a mirror and skipped.
 *
 * Device-local sync state (never synced to the cloud, a change token only means something on the
 * phone that issued it) lives in localStorage under "aziz-hc-sync":
 *   { token, lastSyncAt, lastError, lastCount, firstSyncAt }
 */
const HealthConnectSync = (() => {
  const KEY = "aziz-hc-sync";
  const SOURCE = "health-connect";
  const DEFAULT_LOOKBACK_DAYS = 14;
  const EXPIRED_LOOKBACK_DAYS = 30;     // a change token unused for 30 days expires
  const AUTO_MIN_GAP_MS = 60 * 1000;    // autoSync (open / resume) at most once a minute
  const MAX_RECORD_ML = 5000;           // a single "sip" above this is a bad record

  const z = n => String(n).padStart(2, "0");

  // The day a record belongs to is the local day where it was drunk. Health Connect keeps the
  // writer's zone offset; fall back to the phone's zone.
  function localDate(ms, offsetSec) {
    if (offsetSec == null || !isFinite(offsetSec)) {
      const d = new Date(ms);
      return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
    }
    const d = new Date(ms + offsetSec * 1000);
    return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}`;
  }

  function dayOf(rec) { return localDate(rec.startMs, rec.startOffsetSec); }

  function cleanRecord(rec, ownPackage) {
    if (!rec || !rec.id) return null;
    const ml = Math.round(Number(rec.ml));
    if (!isFinite(ml) || ml <= 0 || ml > MAX_RECORD_ML) return null;
    if (ownPackage && rec.origin === ownPackage) return null; // never re-import our own writes
    return { ml, s: Number(rec.startMs) || 0, e: Number(rec.endMs) || Number(rec.startMs) || 0, o: rec.origin || "", m: Number(rec.lastModifiedMs) || 0 };
  }

  function mirrorOf(records, id, r) {
    return Object.keys(records).some(k => k !== id && records[k].s === r.s && records[k].e === r.e && records[k].ml === r.ml && records[k].o !== r.o);
  }

  function rebuild(day, records, now) {
    const out = Object.assign({}, day);
    const ids = Object.keys(records);
    if (!ids.length) { delete out.waterh; return out; }
    const ml = ids.reduce((a, k) => a + records[k].ml, 0);
    out.waterh = { ml, at: now.toISOString(), source: SOURCE, records };
    return out;
  }

  function currentRecords(day) {
    const w = day && day.waterh;
    return w && w.source === SOURCE && w.records ? Object.assign({}, w.records) : {};
  }

  // Upsert Health Connect records into a day (returns a new day, or the same object if nothing changed).
  function applyRecords(day, recs, { now = new Date(), ownPackage } = {}) {
    const records = currentRecords(day);
    let changed = !(day && day.waterh && day.waterh.source === SOURCE); // first HC sync replaces a pasted figure
    for (const rec of recs || []) {
      const r = cleanRecord(rec, ownPackage);
      if (!r) { if (rec && rec.id && records[rec.id]) { delete records[rec.id]; changed = true; } continue; }
      const old = records[rec.id];
      if (old && old.ml === r.ml && old.s === r.s && old.e === r.e) continue;
      if (!old && mirrorOf(records, rec.id, r)) continue;
      records[rec.id] = r; changed = true;
    }
    if (!changed) return day;
    return rebuild(day, records, now);
  }

  function removeRecords(day, ids, { now = new Date() } = {}) {
    const records = currentRecords(day);
    let changed = false;
    for (const id of ids || []) if (records[id]) { delete records[id]; changed = true; }
    return changed ? rebuild(day, records, now) : day;
  }

  function bottleMl(day) { return (day && day.waterh && day.waterh.ml) || 0; }

  function readState(storage) {
    try { const j = storage && storage.getItem(KEY); return j ? JSON.parse(j) : {}; } catch (e) { return {}; }
  }
  function writeState(storage, st) { try { storage && storage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }

  function errorText(e) {
    const m = String((e && e.message) || e || "");
    if (/expired/i.test(m)) return "Health Connect sync token expired; re-read the last 30 days.";
    if (/permission|denied|SecurityException/i.test(m)) return "Health Connect access was denied. Tap Allow access, or open Health Connect → App permissions.";
    if (/not.?installed|unavailable|SDK_UNAVAILABLE/i.test(m)) return "Health Connect is not installed on this phone.";
    return m || "Sync failed.";
  }

  function fmtTime(iso) {
    if (!iso) return "never";
    const d = new Date(iso), n = new Date();
    const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return d.toDateString() === n.toDateString() ? t : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${t}`;
  }

  const APP_NAMES = { "com.fitbit.FitbitMobile": "Fitbit", "com.google.android.apps.fitness": "Google Fit", "com.sec.android.app.shealth": "Samsung Health", "com.waterh": "WaterH", "com.google.android.apps.healthdata": "Health Connect" };
  function appName(pkg) { return APP_NAMES[pkg] || String(pkg).split(".").slice(-1)[0]; }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ---- the live sync object ---------------------------------------------------------------
  function create({ plugin, getDay, put, storage, now = () => new Date(), lookbackDays = DEFAULT_LOOKBACK_DAYS, ownPackage, onChange } = {}) {
    let st = readState(storage);
    let hc = { status: null, granted: null };   // what the plugin last told us
    let busy = null, lastAuto = 0;

    const save = () => writeState(storage, st);
    const emit = () => { try { onChange && onChange(status()); } catch (e) {} };

    function available() { return !!plugin; }

    function status() {
      let state;
      if (!plugin) state = "no-plugin";
      else if (hc.status === "not_installed") state = "not-installed";
      else if (hc.status === "not_supported") state = "not-supported";
      else if (hc.granted === false) state = "needs-permission";
      else if (hc.granted === true) state = st.lastError ? "error" : "ready";
      else state = "unknown";
      return { state, busy: !!busy, lastSyncAt: st.lastSyncAt || null, lastError: st.lastError || null, lastCount: st.lastCount || 0, hasToken: !!st.token, firstSyncAt: st.firstSyncAt || null, lastResult: st.lastResult || null };
    }

    async function probe() {
      if (!plugin) return status();
      try {
        const a = await plugin.isAvailable();
        hc.status = (a && a.status) || "not_supported";
        if (hc.status === "available") { const p = await plugin.hasHydrationAccess(); hc.granted = !!(p && p.granted); }
      } catch (e) { hc.status = "not_supported"; st.lastError = errorText(e); }
      return status();
    }

    async function requestAccess() {
      if (!plugin) return false;
      await probe();
      if (hc.status !== "available") return false;
      try { const p = await plugin.requestHydrationAccess(); hc.granted = !!(p && p.granted); }
      catch (e) { hc.granted = false; st.lastError = errorText(e); save(); }
      emit();
      return hc.granted;
    }

    async function openSettings() { if (plugin && plugin.openSettings) try { await plugin.openSettings(); } catch (e) {} }

    // Apply a batch of upserts/deletes grouped by day through put(); returns {imported, removed, days}.
    function applyBatch(upserts, deletes) {
      const t = now();
      const byDay = {};
      for (const r of upserts) { const d = dayOf(r); (byDay[d] = byDay[d] || { up: [], del: [] }).up.push(r); }
      // A deletion carries only the id: find which day holds it.
      const pendingDel = deletes.filter(id => !upserts.some(r => r.id === id));
      if (pendingDel.length) {
        for (const d of knownDays()) {
          const recs = currentRecords(getDay(d));
          const hits = pendingDel.filter(id => recs[id]);
          if (hits.length) (byDay[d] = byDay[d] || { up: [], del: [] }).del.push(...hits);
        }
      }
      let imported = 0, removed = 0, days = 0;
      for (const d of Object.keys(byDay).sort()) {
        const before = getDay(d);
        const beforeIds = Object.keys(currentRecords(before));
        let day = applyRecords(before, byDay[d].up, { now: t, ownPackage });
        day = removeRecords(day, byDay[d].del, { now: t });
        if (day === before) continue;
        const afterIds = Object.keys(currentRecords(day));
        imported += afterIds.filter(id => !beforeIds.includes(id)).length;
        removed += beforeIds.filter(id => !afterIds.includes(id)).length;
        days++;
        put("days", d, day, { quiet: true });
      }
      return { imported, removed, days };
    }

    // Days that may hold HC records: the lookback window plus tomorrow (zone slack).
    function knownDays() {
      const out = [], t = now();
      for (let i = -1; i <= EXPIRED_LOOKBACK_DAYS; i++) {
        const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - i);
        out.push(localDate(d.getTime()));
      }
      return out;
    }

    function originsOf(recs) { return [...new Set(recs.map(x => x && x.origin).filter(Boolean))].slice(0, 4); }
    function daysOf(recs) { const ds = recs.map(x => x && x.startMs ? dayOf(x) : null).filter(Boolean).sort(); return ds.length ? [ds[0], ds[ds.length - 1]] : []; }

    async function fullRead(days) {
      const t = now();
      const startMs = new Date(t.getFullYear(), t.getMonth(), t.getDate() - days).getTime();
      const endMs = t.getTime() + 36 * 3600 * 1000;
      const res = await plugin.readHydration({ startMs, endMs });
      const recs = (res && res.records) || [];
      // Records that vanished from Health Connect inside the window are deletions we missed.
      const seen = new Set(recs.map(r => r.id));
      const gone = [];
      for (const d of knownDays()) {
        const dayMs = new Date(d + "T12:00:00").getTime();
        if (dayMs < startMs) continue;
        for (const id of Object.keys(currentRecords(getDay(d)))) if (!seen.has(id)) gone.push(id);
      }
      const r = applyBatch(recs, gone);
      r.seen = recs.length; r.origins = originsOf(recs); r.recDays = daysOf(recs);
      const tok = await plugin.getChangesToken();
      st.token = tok && tok.token || null;
      return Object.assign({ mode: "full" }, r);
    }

    async function readChanges() {
      let token = st.token, up = [], del = [], loops = 0;
      for (;;) {
        const res = await plugin.getChanges({ token });
        if (!res || res.expired) throw new Error("token expired");
        for (const c of res.changes || []) {
          if (c.type === "upsert" && c.record) up.push(c.record);
          else if (c.type === "delete" && c.id) del.push(c.id);
        }
        token = res.nextToken || token;
        if (!res.hasMore || ++loops > 50) break;
      }
      const r = applyBatch(up, del);
      r.seen = up.length + del.length; r.origins = originsOf(up); r.recDays = daysOf(up);
      st.token = token;
      return Object.assign({ mode: "changes" }, r);
    }

    async function syncNow({ reason = "manual" } = {}) {
      if (busy) return busy;
      busy = (async () => {
        if (!plugin) return { mode: "skipped", error: "no-plugin" };
        await probe();
        if (hc.status !== "available") { st.lastError = hc.status === "not_installed" ? "Health Connect is not installed on this phone." : "Health Connect is not available on this phone."; save(); emit(); return { mode: "skipped", error: st.lastError }; }
        if (!hc.granted) {
          if (reason === "manual") await requestAccess();
          if (!hc.granted) { st.lastError = "Health Connect access not granted yet."; save(); emit(); return { mode: "skipped", error: st.lastError }; }
        }
        let r;
        try {
          r = st.token ? await readChanges() : await fullRead(lookbackDays);
        } catch (e) {
          if (/expired/i.test(String(e && e.message))) {
            st.token = null;
            try { r = await fullRead(EXPIRED_LOOKBACK_DAYS); }
            catch (e2) { r = { mode: "error", error: errorText(e2) }; }
          } else r = { mode: "error", error: errorText(e) };
        }
        if (r.error) { st.lastError = r.error; st.token = r.mode === "error" && /expired|denied|permission/i.test(r.error) ? null : st.token; }
        else { st.lastError = null; st.lastSyncAt = now().toISOString(); st.firstSyncAt = st.firstSyncAt || st.lastSyncAt; st.lastCount = r.imported; st.lastResult = { mode: r.mode, seen: r.seen || 0, imported: r.imported || 0, removed: r.removed || 0, origins: r.origins || [], recDays: r.recDays || [] }; }
        save(); emit();
        return r;
      })();
      try { return await busy; } finally { busy = null; }
    }

    // On open / resume: cheap, throttled, never prompts for permission.
    async function autoSync() {
      if (!plugin) return { mode: "skipped", error: "no-plugin" };
      const t = now().getTime();
      if (t - lastAuto < AUTO_MIN_GAP_MS) return { mode: "skipped", error: "throttled" };
      lastAuto = t;
      return syncNow({ reason: "auto" });
    }

    function reset() { st = {}; save(); emit(); }

    // "Re-read 14 days": forget the change token and read the window again. Dedupe by id means
    // nothing doubles; use it when Health Connect shows water the app hasn't picked up.
    async function reread() { st.token = null; save(); return syncNow({ reason: "manual" }); }

    // ---- Water card block ----------------------------------------------------------------
    function html(day) {
      const s = status();
      const ml = bottleMl(day);
      const n = day && day.waterh && day.waterh.records ? Object.keys(day.waterh.records).length : 0;
      const line = (dot, text) => `<p class="muted hc-line" style="font-size:.85rem;margin:4px 0"><span class="hc-dot hc-${dot}"></span>${text}</p>`;
      let head;
      if (s.state === "no-plugin") head = line("off", "WaterH auto-sync runs in the Android app. Here, paste the WaterH line or pick a file below.");
      else if (s.state === "not-installed") head = line("warn", "Health Connect is not installed. Install it from Google Play, then tap Sync now.");
      else if (s.state === "not-supported") head = line("warn", "Health Connect is not supported on this phone (needs Android 9 or newer).");
      else if (s.state === "needs-permission") head = line("warn", "Health Connect: hydration access not allowed yet.");
      else if (s.state === "error") head = line("bad", `Health Connect: ${esc(s.lastError)}`);
      else if (s.state === "ready") head = line("ok", `Health Connect connected${n ? ` · ${n} water record${n === 1 ? "" : "s"} today (${(ml / 1000).toFixed(2)} L)` : " · no water records for today yet"}`);
      else head = line("off", "Checking Health Connect…");
      const lr = s.lastResult;
      const what = lr ? ` · ${lr.mode === "full" ? "read" : "checked changes:"} ${lr.seen} record${lr.seen === 1 ? "" : "s"}${lr.origins.length ? ` from ${lr.origins.map(appName).join(", ")}` : ""}${lr.recDays.length ? ` (${lr.recDays[0] === lr.recDays[1] ? lr.recDays[0] : lr.recDays.join(" to ")})` : ""} · ${lr.imported} new` : "";
      const sync = s.state === "no-plugin" ? "" : `<p class="muted" style="font-size:.85rem;margin:4px 0">Last sync ${fmtTime(s.lastSyncAt)}${s.busy ? " · syncing…" : esc(what)}</p>`;
      const btns = s.state === "no-plugin" ? "" : `<div class="row">
        ${s.state === "needs-permission" || s.state === "unknown" ? `<button class="btn small" data-act="hcperm">Allow access</button>` : ""}
        <button class="btn ${s.state === "needs-permission" ? "ghost " : ""}small" data-act="hcsync" ${s.busy ? "disabled" : ""}>Sync now</button>
        ${s.state === "ready" || s.state === "error" ? `<button class="btn ghost small" data-act="hcreread" ${s.busy ? "disabled" : ""}>Re-read ${lookbackDays} days</button>` : ""}
        ${s.state === "not-installed" ? "" : `<button class="btn ghost small" data-act="hcsettings">Health Connect settings</button>`}
      </div>`;
      return `<div class="hc-block" style="margin:6px 0 2px">${head}${sync}${btns}</div>`;
    }

    function guideHTML() {
      return `<details><summary>Set up WaterH auto-sync (Android)</summary>
        <ol class="muted" style="font-size:.85rem;padding-left:18px;margin:6px 0;display:flex;flex-direction:column;gap:4px">
          <li><b>Check how WaterH reaches Health Connect.</b> WaterH does not write to Health Connect itself (it is not in Health Connect → App permissions). It sends water to <b>Fitbit / Google Health</b>, which can pass Hydration on to Health Connect. Test it once, outside this app: drink a little, open WaterH so it syncs the bottle, open the Fitbit / Google Health app and check the sip is in its water log (if not, reconnect Fitbit inside WaterH). Then in Health Connect → App permissions → Fitbit / Google Health, allow it to <i>write</i> Hydration, wait a few minutes, and look in Health Connect → Data and access → Hydration. If the sip is there, auto-sync below will see it. If not, keep using the paste / file box below.</li>
          <li>In this app tap <b>Allow access</b> and allow <i>Hydration</i> (read only). Nothing else is requested.</li>
          <li>Tap <b>Sync now</b> once. The first sync reads the last ${lookbackDays} days; after that only new, changed or deleted records are read.</li>
          <li>The app syncs by itself every time you open it or come back to it. Android does not let apps read Health Connect in the background without a separate permission, and the bottle only reaches Health Connect when the WaterH app has talked to it, so open WaterH, then this app.</li>
          <li>Bottle water is kept apart from the +250 ml taps and the Drinks card, so nothing is counted twice. Syncing again never adds the same sip again.</li>
          <li>If Health Connect is missing, install it from Google Play (on Android 14 and newer it is built into Settings).</li>
        </ol>
      </details>`;
    }

    return { available, status, probe, requestAccess, openSettings, syncNow, autoSync, reset, reread, html, guideHTML, state: () => Object.assign({}, st) };
  }

  const CSS = `.hc-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;background:var(--muted,#888)}.hc-ok{background:#2e9e5b}.hc-warn{background:#d9a21b}.hc-bad{background:#d14b3c}.hc-off{background:#9aa0a6}`;

  return { KEY, SOURCE, DEFAULT_LOOKBACK_DAYS, EXPIRED_LOOKBACK_DAYS, localDate, applyRecords, removeRecords, bottleMl, create, errorText, CSS };
})();
if (typeof module !== "undefined" && module.exports) module.exports = HealthConnectSync;
