/* AndroidShell: the glue between the web app and the Capacitor Android wrapper.
 * Plain JS, no imports. Does nothing outside the Android app (window.Capacitor missing),
 * so the same app/index.html still runs in a browser or inside Claude.
 *
 *   AndroidShell.isNative()              -> true inside the Android app
 *   AndroidShell.init({ tabs, goHome })  -> wires back button, status bar, rest-timer notifications
 *   AndroidShell.onBack(fn)              -> fn() returns true when it handled the back press
 *                                           (a module with an open sheet calls this); returns an unregister fn
 *   AndroidShell.backPress()             -> what the hardware back button does (exposed for tests)
 *   AndroidShell.visit(tab, scrollY)     -> the host calls this on every render; a tab change records the tab
 *                                           being left (and its scroll) so back returns to it
 *   AndroidShell.notifyAt(id, when, title, body) / AndroidShell.cancel(id)
 *
 * Back button order: a registered handler → a visible sheet/dialog's close button → the previously visited tab
 * (opts.setTab(tab, scrollY), a history stack) → the Today tab → minimise the app.
 * Rest timer: the workout logger fires "lb:rest" {end,total,sound} and "lb:rest-stop" on window; a local
 * notification is scheduled 1 s after the end so the in-app beep (which cancels it) wins while the app is open,
 * and the RestTimer plugin keeps a persistent workout notification in the shade ("lb:workout" {name,start,exercise,
 * set,next,done,total,look} / "lb:workout-stop" from the logger) that turns into the live countdown during a rest.
 * Its buttons fire "lb:rest-skip", "lb:rest-adjust" {d: ±15}, "lb:workout-complete" and "lb:rest-start" on window.
 */
const AndroidShell = (function () {
  const handlers = [];
  let opts = {};
  // Tab history: tabs visited before the current one, newest last.
  const TAB_MAX = 30;
  let tabStack = [], curTab = null;
  function visit(tab, scrollY) {
    if (!tab || tab === curTab) return;
    if (curTab) {
      tabStack.push({ tab: curTab, y: +scrollY || 0 });
      if (tabStack.length > TAB_MAX) tabStack.shift();
    }
    curTab = tab;
  }
  function tabBack() {
    while (tabStack.length) {
      const prev = tabStack.pop();
      if (prev.tab === curTab) continue;
      curTab = prev.tab; // set before setTab so the render's visit() does not push it again
      if (opts.setTab) opts.setTab(prev.tab, prev.y);
      return true;
    }
    return false;
  }
  const REST_ID = 7001;

  function cap() { return (typeof window !== "undefined" && window.Capacitor) || null; }
  function plugin(name) { const c = cap(); return (c && c.Plugins && c.Plugins[name]) || null; }
  function isNative() { const c = cap(); try { return !!(c && c.isNativePlatform && c.isNativePlatform()); } catch (e) { return false; } }

  function onBack(fn) { handlers.push(fn); return function () { const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1); }; }

  // A closed sheet can still have a size (the coach panel slides off-screen with visibility:hidden), so check
  // hidden/aria-hidden/visibility/display too, or back would "close" it forever and never change tab.
  function visible(el) {
    if (!el || !(el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length))) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden || (n.getAttribute && n.getAttribute("aria-hidden") === "true")) return false;
    }
    try {
      const cs = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
      if (cs && (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0")) return false;
    } catch (e) { }
    return true;
  }
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
    if (opts.setTab && tabBack()) return "tab";
    if (opts.isHome && !opts.isHome()) { tabStack = []; curTab = null; opts.goHome && opts.goHome(); return "home"; }
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

  // The rest notification has its own channel that plays the rest sound picked in Settings (GymSounds
  // REST_SOUNDS; android/app/src/main/res/raw/rest_*.wav, written by modules/gym-sounds/make-wav.js).
  // A channel's sound is fixed once created, so each sound has its own channel, and a changed sound needs a new id.
  const REST_CHANNEL = { id: "rest_v1", name: "Rest timer", description: "Rings when your rest is over", importance: 5, visibility: 1, sound: "rest_done.wav", vibration: true };
  function channelFor(sound) {
    if (!sound || sound === "restDone" || !/^[a-z0-9]+$/i.test(sound)) return REST_CHANNEL;
    const GS = typeof window !== "undefined" && window.GymSounds;
    const pick = GS && GS.REST_SOUNDS && GS.REST_SOUNDS.find(s => s.id === sound);
    if (GS && GS.REST_SOUNDS && !pick) return REST_CHANNEL;
    return Object.assign({}, REST_CHANNEL, { id: "rest_" + sound.toLowerCase() + "_v1", name: "Rest timer: " + (pick ? pick.label : sound), sound: "rest_" + sound.toLowerCase() + ".wav" });
  }
  const channelReady = {};
  function restChannel(ln, ch) {
    ch = ch || REST_CHANNEL;
    if (!channelReady[ch.id]) channelReady[ch.id] = Promise.resolve(ln.createChannel ? ln.createChannel(ch) : null).then(() => true, () => false);
    return channelReady[ch.id];
  }
  function restSound(d) {
    if (d && d.sound) return d.sound;
    try { return window.WorkoutLogger && WorkoutLogger.settings && WorkoutLogger.settings().restSound; } catch (e) { return null; }
  }

  async function notifyAt(id, when, title, body, extra) {
    const ln = plugin("LocalNotifications"); if (!ln) return false;
    try {
      let p = await ln.checkPermissions();
      if (p.display !== "granted") p = await ln.requestPermissions();
      if (p.display !== "granted") return false;
      await ln.schedule({ notifications: [Object.assign({ id, title, body, schedule: { at: new Date(when), allowWhileIdle: true }, smallIcon: "ic_stat_notify" }, extra || {})] });
      return true;
    } catch (e) { return false; }
  }
  // Persistent workout notification (Strong-style), RestTimerPlugin.kt. Between rests it shows the workout's
  // elapsed time, the current exercise and set and the next exercise, with "Complete set" / "Rest" buttons;
  // during a rest its chronometer counts down to d.end on its own with −15 s / +15 s / Skip. The plugin flips
  // back to the workout view when the rest ends. A rest with no workout (Quick log) is a countdown that clears
  // itself. Buttons come back as "skip" / "adjust" {seconds} / "next" / "rest" and are fired on window.
  const LOOKS = ["big", "clock", "bar", "plain", "endsAt"]; // RestTimerPlugin looks; the logger's restNotify setting
  const live = { workout: null, rest: null };
  function liveShow() {
    const rt = plugin("RestTimer"); if (!rt || !rt.show) return Promise.resolve(false);
    const w = live.workout, r = live.rest; if (!w && !r) return Promise.resolve(false);
    const look = LOOKS.includes((r && r.look) || (w && w.look)) ? ((r && r.look) || (w && w.look)) : "big";
    const ex = w && w.exercise ? w.exercise + (w.set ? " \u00b7 " + w.set : "") : "";
    const left = r ? Math.round((r.end - Date.now()) / 1000) : 0;
    const o = {
      title: r ? "Rest timer" : (w.name || "Workout"),
      body: ex || (r ? "Rest " + mmss(r.total || left) : "Workout running"),
      sub: w && w.next ? "Next: " + w.next : (w && w.total ? w.done + " of " + w.total + " sets done" : ""),
      look, workout: !!w, start: w ? w.start : 0, end: r ? r.end : 0, total: r ? r.total || 0 : 0
    };
    return Promise.resolve(rt.show(o)).then(x => !!(x && x.shown), () => false);
  }
  function liveRest(d) { live.rest = { end: d.end, total: d.total || 0, look: d.look }; return liveShow(); }
  function liveRestStop() { live.rest = null; if (live.workout) liveShow(); else liveStop(); }
  function liveWorkout(d) { live.workout = d || null; if (live.workout) liveShow(); else if (live.rest) liveShow(); else liveStop(); }
  function liveStop() { const rt = plugin("RestTimer"); if (rt && rt.stop) try { rt.stop(); } catch (e) { } }
  function liveRestButtons() {
    const rt = plugin("RestTimer"); if (!rt || !rt.addListener) return;
    try {
      rt.addListener("skip", () => fire("lb:rest-skip", {}));
      rt.addListener("adjust", d => fire("lb:rest-adjust", { d: (d && +d.seconds) || 15 }));
      rt.addListener("next", () => fire("lb:workout-next", {}));
      rt.addListener("complete", () => fire("lb:workout-complete", {}));
      rt.addListener("rest", () => fire("lb:rest-start", {}));
    } catch (e) { }
  }
  function fire(name, detail) { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { } }
  function mmss(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

  async function cancel(id) { const ln = plugin("LocalNotifications"); if (!ln) return; try { await ln.cancel({ notifications: [{ id }] }); } catch (e) { } }

  function init(o) {
    opts = o || {};
    tabStack = []; curTab = null;
    if (!isNative()) return false;
    document.documentElement.classList.add("android-app");
    const app = plugin("App");
    if (app && app.addListener) app.addListener("backButton", () => backPress(document));
    syncStatusBar(document);
    try { new MutationObserver(() => syncStatusBar(document)).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] }); } catch (e) { }
    if (window.matchMedia) { try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => syncStatusBar(document)); } catch (e) { } }
    window.addEventListener("lb:rest", e => {
      const d = (e && e.detail) || {}; if (!d.end) return;
      const ch = channelFor(restSound(d));
      restChannel(plugin("LocalNotifications") || {}, ch)
        .then(ok => notifyAt(REST_ID, d.end + 1000, "Rest is over", "Back to the next set.", ok ? { channelId: ch.id, sound: ch.sound } : null))
        .then(() => liveRest(d)); // after notifyAt, so the notification permission has been asked for
    });
    window.addEventListener("lb:rest-stop", () => { cancel(REST_ID); liveRestStop(); });
    window.addEventListener("lb:workout", e => liveWorkout((e && e.detail) || null));
    window.addEventListener("lb:workout-stop", () => liveWorkout(null));
    liveRestButtons();
    // The logger may have restored a running workout before these listeners existed.
    setTimeout(() => { try { const i = window.WorkoutLogger && WorkoutLogger.workoutInfo && WorkoutLogger.workoutInfo(); if (i && !live.workout) liveWorkout(i); } catch (e) { } }, 2000);
    return true;
  }

  return { isNative, init, onBack, backPress, visit, notifyAt, cancel, syncStatusBar, REST_CHANNEL, channelFor, liveRest, liveRestStop, liveWorkout, LOOKS, _live: live, _handlers: handlers };
})();
if (typeof module !== "undefined" && module.exports) module.exports = AndroidShell;
