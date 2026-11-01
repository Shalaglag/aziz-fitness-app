/* Health Connect → Steps card: today's step count on Android, no export files.
 *
 * Flow: Samsung Health / Galaxy Watch / Google Fit → Android Health Connect (StepsRecord) → this module.
 * Nothing here talks to the network. The native side is the shared Capacitor plugin
 * (modules/health-connect/android/HealthConnectPlugin.kt, `window.Capacitor.Plugins.HealthConnect`);
 * on the web, or without the plugin, every call is a no-op and the Steps card keeps its manual
 * entry and file import.
 *
 * Plugin methods this module uses (all return promises):
 *   isAvailable()                     → {status: "available"|"not_installed"|"not_supported"}
 *   hasStepsAccess()                  → {granted: bool}
 *   requestStepsAccess()              → {granted: bool}
 *   readDailySteps({startMs, endMs})  → {days: [{date: "YYYY-MM-DD", steps, origins: [package]}], zone}
 *   openSettings()
 *
 * Double counting: the plugin asks Health Connect for its own daily aggregate (COUNT_TOTAL), which
 * already merges overlapping records from several apps (phone + watch, Samsung Health + Google Fit)
 * by the app-priority list in Health Connect. The app stores that one figure per day; syncing again
 * replaces the day, so nothing is ever added twice.
 *
 * Day doc field (same shape the Steps module writes, so every consumer of `steps` keeps working):
 *   steps: { count, at, source: "health-connect", origins: [package] }
 * A day typed by hand ("manual") or imported from a file is replaced only when Health Connect has
 * a count for it; a day Health Connect knows nothing about is left as it was.
 *
 * Device-local state in localStorage under "aziz-hc-steps": { lastSyncAt, lastError, lastResult }.
 */
const HealthConnectSteps = (() => {
  const KEY = "aziz-hc-steps";
  const SOURCE = "health-connect";
  const DEFAULT_LOOKBACK_DAYS = 7;      // each sync re-reads the last week (aggregates are cheap)
  const AUTO_MIN_GAP_MS = 60 * 1000;    // autoSync (open / resume) at most once a minute
  const MAX_DAY = 200000;

  const z = n => String(n).padStart(2, "0");
  const localDate = d => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;

  function readState(storage) {
    try { const j = storage && storage.getItem(KEY); return j ? JSON.parse(j) : {}; } catch (e) { return {}; }
  }
  function writeState(storage, st) { try { storage && storage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }

  function errorText(e) {
    const m = String((e && e.message) || e || "");
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

  const APP_NAMES = { "com.sec.android.app.shealth": "Samsung Health", "com.samsung.android.wear.shealth": "Galaxy Watch", "com.google.android.apps.fitness": "Google Fit", "com.fitbit.FitbitMobile": "Fitbit", "com.google.android.apps.healthdata": "Health Connect", "com.garmin.android.apps.connectmobile": "Garmin Connect", "com.xiaomi.wearable": "Mi Fitness" };
  function appName(pkg) { return APP_NAMES[pkg] || String(pkg).split(".").slice(-1)[0]; }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  const fmtN = n => Math.round(n).toLocaleString("en-US");

  // Pure: the day doc after one Health Connect figure. Returns the same object when nothing changes.
  function applyDaily(day, row, now = new Date()) {
    const count = Math.max(0, Math.min(MAX_DAY, Math.round(+row.steps || 0)));
    const cur = day && day.steps;
    const curCount = typeof cur === "number" ? cur : (cur && cur.count) || 0;
    const curSource = cur && typeof cur === "object" ? cur.source : (typeof cur === "number" ? "manual" : null);
    if (count === 0 && curSource !== SOURCE) return day;        // nothing from Health Connect: keep hand entry
    if (curSource === SOURCE && curCount === count) return day;  // unchanged
    const origins = Array.isArray(row.origins) ? row.origins.slice(0, 8) : [];
    return Object.assign({}, day, { steps: { count, at: now.toISOString(), source: SOURCE, origins } });
  }

  function isSynced(day) { return !!(day && day.steps && typeof day.steps === "object" && day.steps.source === SOURCE); }

  // ---- the live sync object ---------------------------------------------------------------
  function create({ plugin, getDay, put, storage, now = () => new Date(), lookbackDays = DEFAULT_LOOKBACK_DAYS, onChange } = {}) {
    let st = readState(storage);
    let hc = { status: null, granted: null };
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
      return { state, busy: !!busy, lastSyncAt: st.lastSyncAt || null, lastError: st.lastError || null, lastResult: st.lastResult || null };
    }

    async function probe() {
      if (!plugin) return status();
      try {
        const a = await plugin.isAvailable();
        hc.status = (a && a.status) || "not_supported";
        if (hc.status === "available") { const p = await plugin.hasStepsAccess(); hc.granted = !!(p && p.granted); }
      } catch (e) { hc.status = "not_supported"; st.lastError = errorText(e); }
      return status();
    }

    async function requestAccess() {
      if (!plugin) return false;
      await probe();
      if (hc.status !== "available") return false;
      try { const p = await plugin.requestStepsAccess(); hc.granted = !!(p && p.granted); }
      catch (e) { hc.granted = false; st.lastError = errorText(e); save(); }
      emit();
      return hc.granted === true;
    }

    async function openSettings() { if (plugin) { try { await plugin.openSettings(); } catch (e) {} } }

    async function run(reason) {
      const t = now();
      const today = localDate(t);
      await probe();
      if (hc.status !== "available") return { mode: "skipped", error: hc.status === "not_installed" ? "not-installed" : "not-supported" };
      if (hc.granted !== true && reason === "manual") await requestAccess();
      if (hc.granted !== true) return { mode: "skipped", error: "needs-permission" };
      const start = new Date(t.getFullYear(), t.getMonth(), t.getDate() - (lookbackDays - 1));
      let res;
      try {
        res = await plugin.readDailySteps({ startMs: start.getTime(), endMs: t.getTime() });
      } catch (e) {
        st.lastError = errorText(e); st.lastSyncAt = t.toISOString(); save();
        if (/permission|denied/i.test(String(e && e.message))) hc.granted = false;
        return { mode: "read", error: st.lastError };
      }
      const rows = (res && res.days) || [];
      let changed = 0, seen = 0, todayCount = null; const origins = new Set();
      for (const row of rows) {
        if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.date)) || row.date > today) continue;
        seen++;
        (row.origins || []).forEach(o => origins.add(o));
        const before = getDay(row.date);
        const after = applyDaily(before, row, t);
        if (row.date === today) todayCount = Math.round(+row.steps || 0);
        if (after !== before) { changed++; put("days", row.date, after, { quiet: true }); }
      }
      st.lastError = null; st.lastSyncAt = t.toISOString();
      st.lastResult = { seen, changed, today: todayCount, origins: [...origins], reason };
      save();
      return { mode: "read", seen, changed, today: todayCount, origins: [...origins] };
    }

    async function syncNow({ reason = "manual" } = {}) {
      if (!plugin) return { mode: "skipped", error: "no-plugin" };
      if (busy) return busy;
      busy = run(reason).finally(() => { busy = null; emit(); });
      emit();
      return busy;
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

    // ---- Steps card block ----------------------------------------------------------------
    function html(day) {
      const s = status();
      if (s.state === "no-plugin") return "";
      const line = (dot, text) => `<p class="muted hc-line" style="font-size:.85rem;margin:4px 0"><span class="hc-dot hc-${dot}"></span>${text}</p>`;
      const lr = s.lastResult;
      const from = lr && lr.origins && lr.origins.length ? ` from ${lr.origins.map(appName).map(esc).join(", ")}` : "";
      let head;
      if (s.state === "not-installed") head = line("warn", "Health Connect is not installed. Install it from Google Play, then tap Sync now.");
      else if (s.state === "not-supported") head = line("warn", "Health Connect is not supported on this phone (needs Android 9 or newer).");
      else if (s.state === "needs-permission") head = line("warn", "Health Connect: steps access not allowed yet. Tap Allow access to sync your phone's step count automatically.");
      else if (s.state === "error") head = line("bad", `Health Connect: ${esc(s.lastError)}`);
      else if (s.state === "ready") head = line("ok", isSynced(day) ? `Steps synced from Health Connect${from}` : `Health Connect connected${lr && lr.today === 0 ? " · no steps recorded for today yet" : ""}`);
      else head = line("off", "Checking Health Connect…");
      const sync = `<p class="muted" style="font-size:.85rem;margin:4px 0">Last sync ${fmtTime(s.lastSyncAt)}${s.busy ? " · syncing…" : lr && s.state === "ready" ? ` · ${lr.seen} day${lr.seen === 1 ? "" : "s"} read, ${lr.changed} updated` : ""}. Refreshes each time you open the app.</p>`;
      const btns = `<div class="row">
        ${s.state === "needs-permission" || s.state === "unknown" ? `<button class="btn small" data-act="hcstepsperm">Allow access</button>` : ""}
        <button class="btn ${s.state === "needs-permission" ? "ghost " : ""}small" data-act="hcstepssync" ${s.busy ? "disabled" : ""}>Sync now</button>
        ${s.state === "not-installed" ? "" : `<button class="btn ghost small" data-act="hcstepssettings">Health Connect settings</button>`}
      </div>`;
      return `<div class="hc-block hc-steps" style="margin:6px 0 2px">${head}${sync}${btns}</div>`;
    }

    function guideHTML() {
      return `<details><summary>Steps from the phone (Health Connect)</summary>
        <ol class="muted" style="font-size:.85rem;padding-left:18px;margin:6px 0;display:flex;flex-direction:column;gap:4px">
          <li><b>Let Samsung Health share steps.</b> On the phone open Samsung Health → ☰ or profile → Settings → <b>Health Connect</b> → App permissions → Health Connect, and turn on <i>Steps</i> (write). Samsung Health then copies the phone's and the watch's steps into Health Connect; it already merges phone + watch into one count.</li>
          <li>In this app, Today → Steps → <b>Allow access</b>, and allow <i>Steps</i> (read only). Nothing else is requested.</li>
          <li>Tap <b>Sync now</b> once. After that the card refreshes by itself every time you open or come back to the app (at most once a minute). The last ${DEFAULT_LOOKBACK_DAYS} days are re-read each time, so yesterday's late steps are fixed too.</li>
          <li>The count is Health Connect's own daily total, which already removes overlaps between apps and devices. If two step apps both write (say Samsung Health and Google Fit), set the order under Health Connect → Data and access → Steps → <b>App priority</b>; one source is enough.</li>
          <li><b>Background:</b> Android only lets this app read Health Connect while it is on screen. Samsung Health also batches its steps into Health Connect with a delay, so a count can lag the Samsung Health widget by a few minutes. There is no background refresh; opening the app is the refresh.</li>
          <li>A day Health Connect knows is replaced on each sync, so the +1,000 chips and Set box are for days without a phone count (travel, a dead battery). Imports from files still work for back-fill.</li>
        </ol>
      </details>`;
    }

    return { available, status, probe, requestAccess, openSettings, syncNow, autoSync, reset, html, guideHTML, state: () => Object.assign({}, st) };
  }

  return { KEY, SOURCE, DEFAULT_LOOKBACK_DAYS, AUTO_MIN_GAP_MS, applyDaily, isSynced, create, errorText, appName };
})();
if (typeof module !== "undefined" && module.exports) module.exports = HealthConnectSteps;
