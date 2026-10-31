/* AndroidShell: the glue between the web app and the Capacitor Android wrapper.
 * Plain JS, no imports. Does nothing outside the Android app (window.Capacitor missing),
 * so the same app/index.html still runs in a browser or inside Claude.
 *
 *   AndroidShell.isNative()              -> true inside the Android app
 *   AndroidShell.init({ tabs, goHome })  -> wires back button, status bar, rest-timer notifications
 *   AndroidShell.onBack(fn)              -> fn() returns true when it handled the back press
 *                                           (a module with an open sheet calls this); returns an unregister fn
 *   AndroidShell.backPress()             -> what the hardware back button does (exposed for tests)
 *   AndroidShell.notifyAt(id, when, title, body) / AndroidShell.cancel(id)
 *
 * Back button order: a registered handler → a visible sheet/dialog's close button → the Today tab → minimise the app.
 * Rest timer: the workout logger fires "lb:rest" {end,total} and "lb:rest-stop" on window; a local
 * notification is scheduled 1 s after the end so the in-app beep (which cancels it) wins while the app is open.
 */
const AndroidShell = (function () {
  const handlers = [];
  let opts = {};
  const REST_ID = 7001;

  function cap() { return (typeof window !== "undefined" && window.Capacitor) || null; }
  function plugin(name) { const c = cap(); return (c && c.Plugins && c.Plugins[name]) || null; }
  function isNative() { const c = cap(); try { return !!(c && c.isNativePlatform && c.isNativePlatform()); } catch (e) { return false; } }

  function onBack(fn) { handlers.push(fn); return function () { const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1); }; }

  function visible(el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); }
  function closeTopSheet(doc) {
    const dialogs = Array.from(doc.querySelectorAll('[role="dialog"], dialog[open]')).filter(visible);
    const top = dialogs[dialogs.length - 1];
    if (!top) return false;
    const btn = top.querySelector('[data-a="closeSheet"], [data-close], button.close, [aria-label="Close"]');
    if (btn) { btn.click(); return true; }
    if (typeof top.close === "function") { top.close(); return true; }
    return false;
  }

  // Returns what happened: "handler" | "sheet" | "home" | "exit".
  function backPress(doc) {
    doc = doc || document;
    for (let i = handlers.length - 1; i >= 0; i--) { try { if (handlers[i]()) return "handler"; } catch (e) { } }
    if (closeTopSheet(doc)) return "sheet";
    if (opts.isHome && !opts.isHome()) { opts.goHome && opts.goHome(); return "home"; }
    const app = plugin("App");
    if (app) { if (app.minimizeApp) app.minimizeApp(); else if (app.exitApp) app.exitApp(); }
    return "exit";
  }

  function darkMode(doc) {
    const root = doc.documentElement, t = root.getAttribute("data-theme");
    if (t === "dark") return true;
    if (t === "light") return false;
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function rgbToHex(s) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || "");
    if (!m) return null;
    return "#" + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, "0")).join("");
  }
  function syncStatusBar(doc) {
    const sb = plugin("StatusBar"); if (!sb) return;
    const dark = darkMode(doc);
    try { sb.setStyle({ style: dark ? "DARK" : "LIGHT" }); } catch (e) { }
    try { const bg = rgbToHex(getComputedStyle(doc.body).backgroundColor); if (bg) sb.setBackgroundColor({ color: bg }); } catch (e) { }
  }

  async function notifyAt(id, when, title, body) {
    const ln = plugin("LocalNotifications"); if (!ln) return false;
    try {
      let p = await ln.checkPermissions();
      if (p.display !== "granted") p = await ln.requestPermissions();
      if (p.display !== "granted") return false;
      await ln.schedule({ notifications: [{ id, title, body, schedule: { at: new Date(when), allowWhileIdle: true }, smallIcon: "ic_stat_notify" }] });
      return true;
    } catch (e) { return false; }
  }
  async function cancel(id) { const ln = plugin("LocalNotifications"); if (!ln) return; try { await ln.cancel({ notifications: [{ id }] }); } catch (e) { } }

  function init(o) {
    opts = o || {};
    if (!isNative()) return false;
    document.documentElement.classList.add("android-app");
    const app = plugin("App");
    if (app && app.addListener) app.addListener("backButton", () => backPress(document));
    syncStatusBar(document);
    try { new MutationObserver(() => syncStatusBar(document)).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] }); } catch (e) { }
    if (window.matchMedia) { try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => syncStatusBar(document)); } catch (e) { } }
    window.addEventListener("lb:rest", e => { const d = (e && e.detail) || {}; if (d.end) notifyAt(REST_ID, d.end + 1000, "Rest is over", "Back to the next set."); });
    window.addEventListener("lb:rest-stop", () => cancel(REST_ID));
    return true;
  }

  return { isNative, init, onBack, backPress, notifyAt, cancel, syncStatusBar, _handlers: handlers };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AndroidShell;
