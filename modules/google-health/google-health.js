/* Google Health (Fitbit) → Water card.
 *
 * Why: WaterH writes each sip to Fitbit, but Fitbit / Google Health does not share water with Android
 * Health Connect on Aziz's phone (checked Nov 1, 2026). So the app reads the water log straight from the
 * Google Health API (the Fitbit Web API's successor): GET
 *   https://health.googleapis.com/v4/users/me/dataTypes/hydration-log/dataPoints
 * with the read-only scope googlehealth.nutrition.readonly. No server, no secret: the Android plugin
 * (android/GoogleHealthPlugin.kt) gets a short-lived access token from Google Play services'
 * AuthorizationClient and makes the GET; this module does all the logic and is tested in Node.
 *
 * Plugin interface (window.Capacitor.Plugins.GoogleHealth):
 *   authorize({interactive}) → {granted, token?}     interactive:false never shows UI
 *   get({path, query, token}) → {status, body}        only https://health.googleapis.com/
 *
 * Day doc: the same `waterh` field as Health Connect, source "google-health", records keyed "gh:<id>",
 * so every consumer of waterh.ml keeps working; manual taps (`water`) and Drinks are never touched.
 * Device-local state: localStorage "aziz-gh-sync" {connected, lastSyncAt, lastError, lastResult, synced}.
 */
const GoogleHealthWater = (() => {
  const KEY = "aziz-gh-sync";
  const SOURCE = "google-health";
  const SCOPE = "https://www.googleapis.com/auth/googlehealth.nutrition.readonly";
  const PATH = "v4/users/me/dataTypes/hydration-log/dataPoints";
  const FIRST_DAYS = 14, NEXT_DAYS = 3;          // first sync back-fills two weeks; later ones re-check 3 days
  const AUTO_GAP_MS = 10 * 60 * 1000;            // open / resume sync at most every 10 minutes
  const TOKEN_MS = 50 * 60 * 1000;               // Google access tokens last ~60 min

  const HC = typeof HealthConnectSync !== "undefined" ? HealthConnectSync
    : (typeof require === "function" ? require("../health-connect/health-connect.js") : null);

  const z = n => String(n).padStart(2, "0");
  const ymd = d => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;

  // "10800s", "-3600s", "+03:00" → seconds
  function offsetSec(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return v;
    let m = String(v).match(/^(-?\d+(?:\.\d+)?)s$/);
    if (m) return Math.round(+m[1]);
    m = String(v).match(/^([+-])(\d{2}):?(\d{2})$/);
    if (m) return (m[1] === "-" ? -1 : 1) * (+m[2] * 3600 + +m[3] * 60);
    return null;
  }

  // civilStartTime may come as "2026-11-01T00:00:00" or {date:{year,month,day}, time:{...}}
  function civilDate(v) {
    if (!v) return null;
    if (typeof v === "string") { const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; }
    const d = v.date || v;
    return d && d.year && d.month && d.day ? `${d.year}-${z(d.month)}-${z(d.day)}` : null;
  }

  // Google Health dataPoints JSON → records in Health Connect's shape (+ `date`, the local day)
  function parseDataPoints(json) {
    const out = [];
    for (const dp of (json && json.dataPoints) || []) {
      const h = dp && dp.hydrationLog; if (!h) continue;
      const id = String(dp.name || "").split("/").pop(); if (!id) continue;
      const ml = Number(h.amountConsumed && h.amountConsumed.milliliters);
      const iv = h.interval || {};
      const startMs = Date.parse(iv.startTime || ""), endMs = Date.parse(iv.endTime || "") || startMs;
      const off = offsetSec(iv.startUtcOffset);
      const date = civilDate(iv.civilStartTime) || (isFinite(startMs) && HC ? HC.localDate(startMs, off) : null);
      if (!isFinite(ml) || !date) continue;
      const src = dp.dataSource || {};
      const origin = (src.application && (src.application.packageName || src.application.name)) || src.platform || "google-health";
      out.push({ id: "gh:" + id, ml, startMs: isFinite(startMs) ? startMs : 0, endMs: isFinite(endMs) ? endMs : 0, startOffsetSec: off, origin, date });
    }
    return out;
  }

  function errorText(status, body) {
    const b = String(body || "");
    if (/ACCOUNT_NOT_LINKED/.test(b)) return "Your Google account isn't linked to Google Health yet. Open the Fitbit / Google Health app and sign in with the same Google account, then tap Sync now.";
    if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(b)) return "The Google Health API isn't switched on in your Google Cloud project (setup step 2).";
    if (status === 401) return "Google sign-in expired. Tap Connect again.";
    if (status === 403) return "Google refused access to water data. Tap Connect and allow nutrition data.";
    if (status === 429) return "Google is rate-limiting; it will retry later.";
    if (status === 0) return "No internet. It will sync when you're back online.";
    return `Google Health error ${status}.`;
  }

  function readState(storage) { try { const j = storage && storage.getItem(KEY); return j ? JSON.parse(j) : {}; } catch (e) { return {}; } }
  function writeState(storage, st) { try { storage && storage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function fmtTime(iso) {
    if (!iso) return "never";
    const d = new Date(iso), n = new Date(), t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return d.toDateString() === n.toDateString() ? t : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${t}`;
  }

  function create({ plugin, getDay, put, storage, now = () => new Date(), onChange } = {}) {
    let st = readState(storage);
    let tok = null, busy = null, lastAuto = 0;
    const save = () => writeState(storage, st);
    const emit = () => { try { onChange && onChange(status()); } catch (e) {} };

    function status() {
      let state;
      if (!plugin) state = "no-plugin";
      else if (!st.connected) state = "not-connected";
      else if (st.lastError) state = "error";
      else state = "ready";
      return { state, busy: !!busy, connected: !!st.connected, lastSyncAt: st.lastSyncAt || null, lastError: st.lastError || null, lastResult: st.lastResult || null };
    }

    async function token(interactive) {
      if (tok && now().getTime() - tok.at < TOKEN_MS) return tok.token;
      const r = await plugin.authorize({ interactive: !!interactive });
      if (!r || !r.granted || !r.token) { tok = null; return null; }
      tok = { token: r.token, at: now().getTime() };
      return tok.token;
    }

    async function get(query, interactive) {
      let t = await token(interactive);
      if (!t) return { status: 401, body: "needs consent" };
      let res;
      try { res = await plugin.get({ path: PATH, query, token: t }); }
      catch (e) { return { status: 0, body: String(e && e.message || e) }; }
      if (res && res.status === 401) { // token revoked or expired early: one silent retry
        tok = null; t = await token(false);
        if (!t) return { status: 401, body: "needs consent" };
        try { res = await plugin.get({ path: PATH, query, token: t }); } catch (e) { return { status: 0, body: String(e) }; }
      }
      return res || { status: 0, body: "" };
    }

    // Reads `days` days (today included) and makes each day's Google Health records match exactly.
    async function pull(days, interactive) {
      const t = now();
      const first = new Date(t.getFullYear(), t.getMonth(), t.getDate() - (days - 1));
      const from = new Date(first.getTime() - 14 * 3600 * 1000).toISOString(); // zone slack
      const firstDay = ymd(first);
      let recs = [], pageToken = "", pages = 0;
      do {
        const query = { filter: `hydration_log.interval.start_time >= "${from}"`, pageSize: "1000" };
        if (pageToken) query.pageToken = pageToken;
        const res = await get(query, interactive);
        if (res.status !== 200) return { error: errorText(res.status, res.body), status: res.status };
        let json; try { json = JSON.parse(res.body || "{}"); } catch (e) { return { error: "Google Health sent an unreadable reply." }; }
        recs = recs.concat(parseDataPoints(json));
        pageToken = json.nextPageToken || "";
      } while (pageToken && ++pages < 20);
      recs = recs.filter(r => r.date >= firstDay);
      const byDay = {};
      for (const r of recs) (byDay[r.date] = byDay[r.date] || []).push(r);
      const dates = new Set(Object.keys(byDay));
      for (let d = new Date(first); d <= t; d.setDate(d.getDate() + 1)) dates.add(ymd(d));
      let imported = 0, removed = 0, touched = 0;
      for (const d of [...dates].sort()) {
        const before = getDay(d);
        const had = HC.currentRecords(before, SOURCE);
        const list = byDay[d] || [];
        if (!list.length && !Object.keys(had).length) continue; // never wipe a pasted / manual figure
        let day = HC.applyRecords(before, list, { now: t, source: SOURCE });
        const keep = new Set(list.map(r => r.id));
        day = HC.removeRecords(day, Object.keys(had).filter(id => !keep.has(id)), { now: t, source: SOURCE });
        if (day === before) continue;
        const after = HC.currentRecords(day, SOURCE);
        imported += Object.keys(after).filter(id => !had[id]).length;
        removed += Object.keys(had).filter(id => !after[id]).length;
        touched++;
        put("days", d, day, { quiet: true });
      }
      return { imported, removed, days: touched, seen: recs.length, todayMl: (byDay[ymd(t)] || []).reduce((a, r) => a + Math.round(r.ml), 0) };
    }

    async function connect() {
      if (!plugin) return { error: "no-plugin" };
      let t;
      try { t = await token(true); } catch (e) { t = null; st.lastError = "Google sign-in failed: " + String(e && e.message || e); }
      if (!t) { st.connected = false; st.lastError = st.lastError || "Google access was not granted."; save(); emit(); return { error: st.lastError }; }
      st.connected = true; st.lastError = null; st.synced = false; save();
      return syncNow({ reason: "manual" });
    }

    async function syncNow({ reason = "manual" } = {}) {
      if (busy) return busy;
      busy = (async () => {
        if (!plugin) return { error: "no-plugin" };
        if (!st.connected) return { error: "not-connected" };
        let r;
        try { r = await pull(st.synced ? NEXT_DAYS : FIRST_DAYS, reason === "manual"); }
        catch (e) { r = { error: "Sync failed: " + String(e && e.message || e) }; }
        if (r.error) { if (r.status !== 0 || !st.lastError) st.lastError = r.error; }
        else { st.lastError = null; st.synced = true; st.lastSyncAt = now().toISOString(); st.lastResult = { seen: r.seen, imported: r.imported, removed: r.removed, todayMl: r.todayMl }; }
        save(); emit();
        return r;
      })();
      try { return await busy; } finally { busy = null; }
    }

    async function autoSync() {
      if (!plugin || !st.connected) return { skipped: true };
      const t = now().getTime();
      if (t - lastAuto < AUTO_GAP_MS) return { skipped: true };
      lastAuto = t;
      return syncNow({ reason: "auto" });
    }

    function disconnect() { st = {}; tok = null; save(); emit(); }

    function html(day) {
      const s = status();
      if (s.state === "no-plugin") return "";
      const recs = HC ? HC.currentRecords(day, SOURCE) : {};
      const n = Object.keys(recs).length, ml = n ? Object.keys(recs).reduce((a, k) => a + recs[k].ml, 0) : 0;
      const dot = { ready: "ok", error: "bad", "not-connected": "off" }[s.state];
      const head = s.state === "not-connected" ? "Fitbit / Google Health: not connected"
        : s.state === "error" ? `Fitbit / Google Health: ${esc(s.lastError)}`
        : `Fitbit / Google Health connected${n ? ` · ${n} water log${n === 1 ? "" : "s"} today (${(ml / 1000).toFixed(2)} L)` : " · no water logs for today yet"}`;
      const lr = s.lastResult;
      const last = s.connected ? `<p class="muted" style="font-size:.85rem;margin:4px 0">Last sync ${fmtTime(s.lastSyncAt)}${s.busy ? " · syncing…" : lr ? ` · read ${lr.seen} log${lr.seen === 1 ? "" : "s"} · ${lr.imported} new` : ""}</p>` : "";
      const btns = s.connected
        ? `<div class="row"><button class="btn small" data-act="ghsync" ${s.busy ? "disabled" : ""}>Sync Fitbit now</button><button class="btn ghost small" data-act="ghdisconnect">Disconnect</button></div>`
        : `<div class="row"><button class="btn small" data-act="ghconnect">Connect Fitbit / Google Health</button></div>`;
      return `<div class="gh-block" style="margin:6px 0 2px"><p class="muted hc-line" style="font-size:.85rem;margin:4px 0"><span class="hc-dot hc-${dot}"></span>${head}</p>${last}${btns}</div>`;
    }

    function guideHTML() {
      if (!plugin) return "";
      return `<details><summary>How Fitbit water sync works</summary>
        <ol class="muted" style="font-size:.85rem;padding-left:18px;margin:6px 0;display:flex;flex-direction:column;gap:4px">
          <li>WaterH sends each sip to Fitbit. This app reads your Fitbit / Google Health water log over the internet with read-only access to nutrition data. Nothing is written back.</li>
          <li>Tap <b>Connect Fitbit / Google Health</b> once and pick the Google account you use in the Fitbit / Google Health app. Google may warn that the app is unverified; it is your own private app, so tap <i>Continue</i>.</li>
          <li>It syncs when you open or come back to the app (at most every 10 minutes) and when you tap <b>Sync Fitbit now</b>. Offline, it waits until you're online.</li>
          <li>Each Fitbit water log is counted once by its id; edits and deletions in Fitbit are followed for the last 3 days. Your +250 ml taps and the Drinks card stay separate.</li>
        </ol></details>`;
    }

    return { status, connect, syncNow, autoSync, disconnect, html, guideHTML, state: () => Object.assign({}, st) };
  }

  return { KEY, SOURCE, SCOPE, PATH, offsetSec, civilDate, parseDataPoints, errorText, create };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GoogleHealthWater;
