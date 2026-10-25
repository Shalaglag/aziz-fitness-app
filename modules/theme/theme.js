/* Fitness app theme switcher.
   Load early in <head> (before first paint) to avoid a flash of the wrong theme.
   API:
     FitTheme.mode            -> "system" | "light" | "dark"
     FitTheme.setMode(mode)
     FitTheme.accent          -> "red" | "blue" | "yellow" | "green"
     FitTheme.setAccent(name)
     FitTheme.isDark()        -> true when dark is showing right now
     FitTheme.onChange(fn)    -> fn({ mode, accent, dark })
*/
(function () {
  var KEY = "fit-theme";
  var ACCENTS = ["red", "blue", "yellow", "green"];
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  var listeners = [];

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: still works for this visit */ }
  }

  var state = load();
  if (["system", "light", "dark"].indexOf(state.mode) < 0) {
    // Nothing saved yet: respect a data-theme already on <html>, else follow the system.
    var preset = root.getAttribute("data-theme");
    state.mode = preset === "light" || preset === "dark" ? preset : "system";
  }
  if (ACCENTS.indexOf(state.accent) < 0) state.accent = "blue";

  function isDark() {
    if (state.mode === "dark") return true;
    if (state.mode === "light") return false;
    return !!(media && media.matches);
  }

  function syncThemeColor() {
    // Colors the phone's status bar / browser chrome to match the app background.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = getComputedStyle(root).getPropertyValue("--bg").trim() || (isDark() ? "#0D1013" : "#F2F4F6");
  }

  function apply(animate) {
    if (animate) {
      root.classList.add("is-theming");
      setTimeout(function () { root.classList.remove("is-theming"); }, 260);
    }
    if (state.mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", state.mode);
    root.setAttribute("data-accent", state.accent);
    syncThemeColor();
    var info = { mode: state.mode, accent: state.accent, dark: isDark() };
    listeners.forEach(function (fn) { fn(info); });
  }

  if (media && media.addEventListener) {
    media.addEventListener("change", function () { if (state.mode === "system") apply(true); });
  }

  window.FitTheme = {
    get mode() { return state.mode; },
    get accent() { return state.accent; },
    accents: ACCENTS.slice(),
    isDark: isDark,
    setMode: function (mode) {
      if (["system", "light", "dark"].indexOf(mode) < 0) return;
      state.mode = mode; save(state); apply(true);
    },
    setAccent: function (name) {
      if (ACCENTS.indexOf(name) < 0) return;
      state.accent = name; save(state); apply(true);
    },
    onChange: function (fn) { listeners.push(fn); }
  };

  apply(false);
})();
