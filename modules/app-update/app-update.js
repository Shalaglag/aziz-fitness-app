/*
 * AppUpdate: an "Update" button inside the Android app.
 *
 * It reads `latest.json` from the PUBLIC releases-only repository (Shalaglag/mizan-releases, release
 * `android-latest`, which CI fills on every merge to main), compares its build number with the installed
 * versionCode, downloads aziz-fitness.apk from the same release and hands it to Android's installer.
 * No account, key or setup: anyone with the APK gets updates. Android still shows its own "Update"
 * confirmation; the app's data stays because every build is signed with the same key (the native side
 * refuses a file signed otherwise).
 *
 * Fallback (Advanced): until the public repository exists, or if it is ever taken down, a read-only
 * GitHub key for the private code repository still works. It is pasted in Settings and kept only on
 * this phone (localStorage key "aziz-update-token"): never in the APK, synced data or backups.
 *
 * Native side: Capacitor plugin "AppUpdate" (android/AppUpdatePlugin.kt in this folder):
 *   info() -> {versionCode, versionName}      latest({token, url}) -> {status, body}
 *   download({url, token, minVersion}) -> {path, versionCode}   install({path})
 *   canInstall() -> {allowed}                 openInstallSettings()
 *   event "progress" {done, total}
 *
 * Shell API: AppUpdate.bind({render, toast}); AppUpdate.cardHTML(); AppUpdate.bannerHTML();
 * AppUpdate.autoCheck(). Pure helpers for tests: parseLatest, parseRelease, compare, errorText, LATEST_URL, APK_URL, TOKEN_URL.
 */
(function (root) {
  // Public releases-only repository: APK + latest.json, no code, no key needed.
  const PUBLIC = { owner: "Shalaglag", repo: "mizan-releases", tag: "android-latest", asset: "aziz-fitness.apk" };
  const PUBLIC_BASE = `https://github.com/${PUBLIC.owner}/${PUBLIC.repo}/releases/download/${PUBLIC.tag}/`;
  const LATEST_URL = PUBLIC_BASE + "latest.json";
  const APK_URL = PUBLIC_BASE + PUBLIC.asset;
  // Private code repository (fallback with a read-only key).
  const REPO = { owner: "Shalaglag", repo: "aziz-fitness-app", tag: "android-latest", asset: "aziz-fitness.apk" };
  const RELEASE_URL = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/releases/tags/${REPO.tag}`;
  const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new?name=Aziz%20Fitness%20updates&description=Lets%20the%20Aziz%20Fitness%20app%20download%20its%20own%20updates&target_name=" + REPO.owner + "&expires_in=none&contents=read";
  const KEY = "aziz-update-token";
  const AUTO_EVERY = 6 * 3600e3;

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // latest.json from the public release ({build, sha, size, at, versionName}, written by CI) -> {build, sha, assetUrl, size, at}.
  function parseLatest(json) {
    if (!json || typeof json !== "object" || !(+json.build > 0)) return null;
    return { build: +json.build, sha: String(json.sha || ""), assetUrl: APK_URL, size: +json.size || 0, at: String(json.at || ""), versionName: String(json.versionName || ""), source: "public" };
  }
  // Private GitHub release JSON -> {build, sha, assetUrl, size, at}. The body says "Newest build from main (build 71, <sha>)".
  function parseRelease(json) {
    if (!json || typeof json !== "object") return null;
    const m = /build\s+(\d+)(?:,\s*([0-9a-f]{7,40}))?/i.exec(json.body || "");
    const a = (json.assets || []).find(x => x && x.name === REPO.asset);
    if (!m || !a || !a.url) return null;
    return { build: +m[1], sha: m[2] || "", assetUrl: a.url, size: +a.size || 0, at: a.updated_at || json.updated_at || "", source: "private" };
  }
  function compare(current, latest) {
    if (!latest) return "unknown";
    if (!current || !(current.versionCode > 0)) return "unknown";
    return latest.build > current.versionCode ? "available" : "up-to-date";
  }
  function errorText(code, status) {
    if (code === "no-token") return "Add your download key first.";
    if (code === "not-published") return "No update has been published yet. Try again later.";
    if (status === 401) return "GitHub rejected the key. It may have expired: make a new one and paste it again.";
    if (status === 403 || status === 404) return "The key can't see the app's repository. Make sure it's for aziz-fitness-app with Contents: Read-only.";
    if (code === "signature") return "That file isn't signed with your app's key, so it was not installed.";
    if (code === "not-newer") return "That build is not newer than the one you have.";
    if (code === "install-not-allowed") return "Android needs your OK first: allow Mizan to install updates, then tap Update again.";
    if (code === "offline") return "No internet connection. Try again on Wi-Fi or data.";
    return "Couldn't check for updates right now. Try again in a minute.";
  }

  const S = { phase: "idle", current: null, latest: null, msg: "", done: 0, total: 0, editing: false };
  let ctx = { render: () => {}, toast: () => {} };

  const cap = () => root.Capacitor || null;
  const native = () => { const c = cap(); try { return !!(c && c.isNativePlatform && c.isNativePlatform()); } catch (e) { return false; } };
  const plugin = () => { const c = cap(); return (c && c.Plugins && c.Plugins.AppUpdate) || null; };
  const store = () => { try { return root.localStorage || null; } catch (e) { return null; } };
  function getToken() { try { return (store() && store().getItem(KEY)) || ""; } catch (e) { return ""; } }
  function setToken(t) { try { const s = store(); if (!s) return; t ? s.setItem(KEY, t.trim()) : s.removeItem(KEY); } catch (e) { } }
  const redraw = () => { try { ctx.render(); } catch (e) { } };

  async function current() {
    if (S.current) return S.current;
    const p = plugin(); if (!p) return null;
    try { S.current = await p.info(); } catch (e) { S.current = null; }
    return S.current;
  }

  // Public release first (no key). If it is not there yet, the private release with the phone's key, if any.
  async function check(opts = {}) {
    const p = plugin(), token = getToken();
    if (!p) { S.phase = "web"; redraw(); return S; }
    await current();
    S.phase = "checking"; S.msg = ""; if (!opts.quiet) redraw();
    try {
      let latest = null;
      const pub = await p.latest({ token: "", url: LATEST_URL });
      if (pub.status === 200) latest = parseLatest(JSON.parse(pub.body));
      if (!latest) {
        if (!token) { S.phase = "error"; S.msg = errorText("not-published", pub.status); redraw(); return S; }
        const r = await p.latest({ token, url: RELEASE_URL });
        if (r.status !== 200) { S.phase = "error"; S.msg = errorText("http", r.status); redraw(); return S; }
        latest = parseRelease(JSON.parse(r.body));
      }
      S.latest = latest;
      const c = compare(S.current, S.latest);
      S.phase = c === "unknown" ? "error" : c; S.msg = c === "unknown" ? errorText() : "";
    } catch (e) { S.phase = "error"; S.msg = errorText(e && e.code === "offline" ? "offline" : ""); }
    redraw(); return S;
  }

  async function update() {
    const p = plugin(), token = getToken();
    if (!p || !S.latest) return;
    try {
      const ok = await p.canInstall();
      if (!ok.allowed) { S.phase = "allow"; S.msg = errorText("install-not-allowed"); redraw(); return; }
      S.phase = "downloading"; S.done = 0; S.total = S.latest.size; S.msg = ""; redraw();
      const sub = p.addListener ? await p.addListener("progress", e => { S.done = e.done || 0; S.total = e.total || S.total; const bar = root.document && root.document.getElementById("auBar"); if (bar) bar.style.width = pct() + "%"; }) : null;
      let got;
      try { got = await p.download({ url: S.latest.assetUrl, token: S.latest.source === "private" ? token : "", minVersion: (S.current && S.current.versionCode || 0) + 1 }); }
      finally { try { sub && sub.remove && sub.remove(); } catch (e) { } }
      S.phase = "installing"; redraw();
      await p.install({ path: got.path });
    } catch (e) {
      const code = e && e.code, status = e && e.data && e.data.status;
      S.phase = code === "install-not-allowed" ? "allow" : "available"; S.msg = errorText(code, status); redraw();
    }
  }
  const pct = () => S.total ? Math.min(100, Math.round(S.done / S.total * 100)) : 0;
  const mb = n => (n / 1048576).toFixed(1) + " MB";

  function cardHTML() {
    const cur = S.current, has = !!getToken();
    const ver = cur ? `Installed: build ${esc(cur.versionCode)}${cur.versionName ? " · " + esc(cur.versionName) : ""}` : "";
    let body = "";
    if (S.phase === "web" || !native()) return `<div class="card au"><h3>App updates</h3><p class="muted">Updates install from inside the Android app. Here, get the newest APK from the release page.</p></div>`;
    if (S.editing) {
      body = `<p class="muted">Advanced: a read-only GitHub key for the private code repository. Not needed for normal updates.</p>
      <ol class="au-steps">
        <li><a href="${TOKEN_URL}" target="_blank" rel="noopener">Open GitHub's key page</a> and sign in.</li>
        <li>Repository access: <b>Only select repositories</b> → <b>aziz-fitness-app</b>.</li>
        <li>Permissions → Repository → <b>Contents: Read-only</b> (nothing else).</li>
        <li>Tap <b>Generate token</b>, copy it and paste it here.</li>
      </ol>
      <div class="row"><input id="auToken" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…" aria-label="GitHub download key" style="flex:1;min-width:0">
      <button class="btn small" data-au="save">Save</button><button class="btn ghost small" data-au="cancel">Cancel</button></div>
      <p class="muted" style="font-size:.8rem">The key can only read this one repository and stays on this phone. It is not synced or put in backups.</p>`;
    } else if (S.phase === "downloading") {
      body = `<p>Downloading build ${esc(S.latest && S.latest.build)}…</p><div class="au-track" aria-hidden="true"><span id="auBar" style="width:${pct()}%"></span></div>`;
    } else if (S.phase === "installing") {
      body = `<p>Android is asking you to confirm. Tap <b>Update</b> there. Your data stays.</p><div class="row"><button class="btn ghost small" data-au="update">Open the installer again</button></div>`;
    } else if (S.phase === "available" || S.phase === "allow") {
      body = `<p><b>Build ${esc(S.latest.build)} is ready</b>${S.latest.size ? ` (${mb(S.latest.size)})` : ""}.</p>
      <div class="row">${S.phase === "allow" ? `<button class="btn small" data-au="allow">Allow updates</button>` : ""}<button class="btn small${S.phase === "allow" ? " ghost" : ""}" data-au="update">Update now</button></div>`;
    } else if (S.phase === "checking") {
      body = `<p class="muted">Checking…</p>`;
    } else if (S.phase === "up-to-date") {
      body = `<p>You have the newest version.</p><div class="row"><button class="btn ghost small" data-au="check">Check again</button></div>`;
    } else {
      body = `<p class="muted" style="font-size:.9rem">Updates download from inside the app. No account or setup needed.</p><div class="row"><button class="btn small" data-au="check">Check for updates</button></div>`;
    }
    const foot = S.editing ? "" : has ? `<p class="muted" style="font-size:.8rem"><button class="linkbtn" data-au="edit">Change download key</button> · <button class="linkbtn" data-au="forget">Remove it</button></p>` : `<p class="muted" style="font-size:.8rem"><button class="linkbtn" data-au="edit">Advanced: use a GitHub key</button></p>`;
    return `<div class="card au" id="auCard"><h3>App updates</h3>${ver ? `<p class="muted" style="font-size:.85rem">${ver}</p>` : ""}${body}${S.msg ? `<p class="au-msg" role="status">${esc(S.msg)}</p>` : ""}${foot}</div>`;
  }
  function bannerHTML() {
    if (!native() || !S.latest || !(S.phase === "available" || S.phase === "allow")) return "";
    return `<div class="card au-banner"><div class="spread"><span><b>New version ready</b> · build ${esc(S.latest.build)}</span><button class="btn small" data-au="update">Update</button></div></div>`;
  }

  async function onClick(e) {
    const b = e.target.closest && e.target.closest("[data-au]"); if (!b) return;
    const a = b.dataset.au;
    if (a === "save") {
      const v = (root.document.getElementById("auToken") || {}).value || "";
      if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(v.trim())) { ctx.toast("That doesn't look like a GitHub key (it starts with github_pat_)."); return; }
      setToken(v); S.editing = false; await check();
      if (S.phase === "error") { ctx.toast(S.msg); } else ctx.toast("Saved. Updates will be checked automatically.");
    } else if (a === "cancel") { S.editing = false; redraw(); }
    else if (a === "edit") { S.editing = true; redraw(); }
    else if (a === "forget") { setToken(""); S.phase = "idle"; S.latest = null; S.msg = ""; redraw(); ctx.toast("Download key removed from this phone."); }
    else if (a === "check") check();
    else if (a === "update") update();
    else if (a === "allow") { const p = plugin(); if (p) { try { await p.openInstallSettings(); } catch (er) { } } S.phase = "available"; S.msg = "After you allow it, come back and tap Update now."; redraw(); }
  }

  function bind(o) {
    ctx = Object.assign(ctx, o || {});
    if (root.document && !bind.done) { root.document.addEventListener("click", onClick); bind.done = true; }
    if (native()) {
      current().then(redraw); autoCheck();
      const app = cap().Plugins && cap().Plugins.App;
      if (app && app.addListener && !bind.resume) { bind.resume = true; try { app.addListener("resume", () => autoCheck()); } catch (e) { } }
    }
  }
  // Quietly checks at start-up and when the app comes back to the front, at most every 6 hours.
  function autoCheck(now) {
    if (!native()) return false;
    const t = now || Date.now();
    if (S.lastAuto && t - S.lastAuto < AUTO_EVERY) return false;
    S.lastAuto = t; check({ quiet: true });
    return true;
  }

  const css = `.au-steps{margin:.4em 0 .6em 1.2em;padding:0;font-size:.9rem}.au-steps li{margin:.2em 0}
.au-track{height:8px;border-radius:4px;background:var(--line,#ddd);overflow:hidden}.au-track span{display:block;height:100%;background:var(--accent,#2b6);transition:width .2s}
.au-msg{font-size:.88rem;margin:.5em 0 0}.au-banner .spread{gap:10px;align-items:center}
.linkbtn{background:none;border:0;padding:0;color:inherit;text-decoration:underline;font:inherit;cursor:pointer}`;

  const AppUpdate = { PUBLIC, LATEST_URL, APK_URL, REPO, RELEASE_URL, TOKEN_URL, parseLatest, parseRelease, compare, errorText, check, update, cardHTML, bannerHTML, bind, autoCheck, getToken, setToken, css, _state: S };
  root.AppUpdate = AppUpdate;
  if (typeof module !== "undefined" && module.exports) module.exports = AppUpdate;
})(typeof window !== "undefined" ? window : globalThis);
