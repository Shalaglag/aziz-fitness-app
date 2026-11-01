/* AppShortcuts: home-screen shortcuts (long-press the app icon) that open the app on one action.
 * The manifest's shortcut URLs end in a hash such as #log-weight; parse() turns that hash into
 * the tab to show and the element to focus. Pure lookup, no DOM, so it is testable in node.
 *
 *   AppShortcuts.parse("#log-weight") -> {action:"log-weight", tab:"today", focus:"#wkg", ...}
 *   AppShortcuts.parse("#food")       -> null   (plain tab hashes are handled by the shell)
 */
const AppShortcuts = (() => {
  const ACTIONS = {
    "log-weight":    { tab: "today", focus: "#wkg", label: "Log weight" },
    "add-water":     { tab: "today", focus: '#waterCard [data-act="water"][data-ml="250"]', label: "Add water" },
    "start-workout": { tab: "train", focus: null, label: "Start workout" },
    "log-food":      { tab: "food", focus: "#fname", label: "Log food" }
  };

  function parse(hash) {
    const key = String(hash || "").replace(/^#/, "").trim().toLowerCase();
    const a = ACTIONS[key];
    return a ? { action: key, ...a } : null;
  }

  // Manifest "shortcuts" entries, kept here so the list and the handler can't drift apart.
  function manifestShortcuts(base) {
    const b = base || "./index.html";
    return Object.keys(ACTIONS).map(k => ({ name: ACTIONS[k].label, short_name: ACTIONS[k].label, url: b + "#" + k }));
  }

  return { ACTIONS, parse, manifestShortcuts };
})();

if (typeof module !== "undefined" && module.exports) module.exports = AppShortcuts;
