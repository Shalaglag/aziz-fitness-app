const test = require("node:test");
const assert = require("node:assert");

function fakeDoc(dialogs) {
  const mk = (sel) => ({ querySelector: (q) => (sel && q.includes(sel) ? { click() { this.clicked = true; } } : null), offsetWidth: 1, getClientRects: () => [1] });
  const els = dialogs.map(mk);
  return { querySelectorAll: () => els, documentElement: { getAttribute: () => null }, body: {} };
}

test("back press: registered handler wins", () => {
  delete require.cache[require.resolve("./android-shell.js")];
  const A = require("./android-shell.js");
  const off = A.onBack(() => true);
  assert.equal(A.backPress(fakeDoc([])), "handler");
  off();
  assert.equal(A.backPress(fakeDoc([])), "exit");
});

test("back press closes a visible sheet before leaving the tab", () => {
  delete require.cache[require.resolve("./android-shell.js")];
  const A = require("./android-shell.js");
  assert.equal(A.backPress(fakeDoc(["closeSheet"])), "sheet");
  assert.equal(A.backPress(fakeDoc([])), "exit");
});

test("back press goes to Today before minimising", () => {
  delete require.cache[require.resolve("./android-shell.js")];
  const A = require("./android-shell.js");
  let tab = "train", went = 0;
  global.window = {}; // not native: init returns false but options are kept
  assert.equal(A.init({ isHome: () => tab === "today", goHome: () => { went++; tab = "today"; } }), false);
  assert.equal(A.backPress(fakeDoc([])), "home");
  assert.equal(went, 1);
  assert.equal(A.backPress(fakeDoc([])), "exit");
  delete global.window;
});

test("rest notification uses the rest channel with the GymSounds ding", async () => {
  delete require.cache[require.resolve("./android-shell.js")];
  const listeners = {}, channels = [], scheduled = [];
  const LocalNotifications = {
    checkPermissions: async () => ({ display: "granted" }),
    createChannel: async c => { channels.push(c); },
    schedule: async o => { scheduled.push(...o.notifications); },
    cancel: async () => {}
  };
  global.window = { Capacitor: { isNativePlatform: () => true, Plugins: { LocalNotifications } }, addEventListener: (k, fn) => { listeners[k] = fn; } };
  global.document = { documentElement: { classList: { add() {} } }, body: {} };
  const A = require("./android-shell.js");
  assert.equal(A.init({}), true);
  listeners["lb:rest"]({ detail: { end: 1e12, total: 90 } });
  listeners["lb:rest"]({ detail: { end: 1e12 + 5000, total: 95 } });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(channels.length, 1, "channel created once");
  assert.equal(channels[0].sound, "rest_done.wav");
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[0].channelId, A.REST_CHANNEL.id);
  assert.equal(scheduled[0].id, 7001);
  // A different rest sound picked in Settings rings through its own channel and wav
  listeners["lb:rest"]({ detail: { end: 1e12, total: 90, sound: "boxing" } });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(channels.length, 2);
  assert.deepEqual([channels[1].id, channels[1].sound], ["rest_boxing_v1", "rest_boxing.wav"]);
  assert.equal(scheduled[2].channelId, "rest_boxing_v1");
  assert.equal(A.channelFor("restDone").id, "rest_v1");
  assert.equal(A.channelFor("../x").id, "rest_v1", "odd ids fall back to the bell");
  delete global.document; global.window = {};
});

test("back press walks the tab history before going to Today", () => {
  delete require.cache[require.resolve("./android-shell.js")];
  const A = require("./android-shell.js");
  let tab = "today"; const went = [];
  global.window = {};
  A.init({ isHome: () => tab === "today", goHome: () => { tab = "today"; A.visit(tab); went.push("home"); },
    setTab: (t, y) => { tab = t; A.visit(t, 0); went.push(t + "@" + y); } });
  A.visit("today", 0); A.visit("train", 120); A.visit("train", 300); A.visit("food", 50);
  assert.equal(A.backPress(fakeDoc(["closeSheet"])), "sheet"); // a sheet still closes first
  assert.equal(A.backPress(fakeDoc([])), "tab"); assert.equal(tab, "train");
  assert.equal(A.backPress(fakeDoc([])), "tab"); assert.equal(tab, "today");
  assert.deepEqual(went, ["train@50", "today@120"]);
  assert.equal(A.backPress(fakeDoc([])), "exit");
  // opening on a non-home tab with no history still goes to Today first
  A.visit("progress", 0); A.backPress(fakeDoc([])); // back to today via history
  assert.equal(tab, "today");
  delete global.window;
});

test("going Today from a tab with no history clears it, then exits", () => {
  delete require.cache[require.resolve("./android-shell.js")];
  const A = require("./android-shell.js");
  let tab = "food";
  global.window = {};
  A.init({ isHome: () => tab === "today", goHome: () => { tab = "today"; A.visit(tab); }, setTab: (t) => { tab = t; A.visit(t); } });
  A.visit("food", 0);
  assert.equal(A.backPress(fakeDoc([])), "home");
  A.visit("train", 0); // today -> train
  assert.equal(A.backPress(fakeDoc([])), "tab"); assert.equal(tab, "today");
  assert.equal(A.backPress(fakeDoc([])), "exit");
  delete global.window;
});

test("a closed sheet that still has a size (aria-hidden / visibility:hidden) does not swallow back", () => {
  delete require.cache[require.resolve("./android-shell.js")];
  const A = require("./android-shell.js");
  let tab = "today", clicked = 0;
  global.window = {};
  global.getComputedStyle = (el) => ({ visibility: el._vis || "visible", display: "block", opacity: "1" });
  A.init({ isHome: () => tab === "today", goHome: () => { tab = "today"; A.visit(tab); }, setTab: (t) => { tab = t; A.visit(t); } });
  const closedPanel = { nodeType: 1, offsetWidth: 390, getAttribute: (k) => (k === "aria-hidden" ? "true" : null), _vis: "hidden", parentElement: null,
    querySelector: () => ({ click() { clicked++; } }) };
  const doc = { querySelectorAll: () => [closedPanel] };
  A.visit("today"); A.visit("train"); A.visit("food");
  assert.equal(A.backPress(doc), "tab"); assert.equal(tab, "train");
  assert.equal(A.backPress(doc), "tab"); assert.equal(tab, "today");
  assert.equal(clicked, 0);
  delete global.window; delete global.getComputedStyle;
});

test("workout notification: shows the workout, turns into the rest countdown, buttons fire events", async () => {
  delete require.cache[require.resolve("./android-shell.js")];
  const listeners = {}, rtListeners = {}, shown = [], fired = [];
  let stops = 0;
  const LocalNotifications = { checkPermissions: async () => ({ display: "granted" }), createChannel: async () => {}, schedule: async () => {}, cancel: async () => {} };
  const RestTimer = { show: async o => { shown.push(o); return { shown: true }; }, stop: async () => { stops++; }, addListener: (k, fn) => { rtListeners[k] = fn; } };
  global.CustomEvent = class { constructor(name, o) { this.type = name; this.detail = o && o.detail; } };
  global.window = { Capacitor: { isNativePlatform: () => true, Plugins: { LocalNotifications, RestTimer } }, addEventListener: (k, fn) => { listeners[k] = fn; }, dispatchEvent: e => fired.push(e) };
  global.document = { documentElement: { classList: { add() {} } }, body: {} };
  const A = require("./android-shell.js");
  assert.equal(A.init({}), true);
  // Workout starts: elapsed-time view with exercise, set and next
  const start = Date.now() - 60000;
  listeners["lb:workout"]({ detail: { name: "Push A", start, exercise: "Bench Press", set: "Set 2 of 4", next: "Incline Press", done: 3, total: 16, look: "clock" } });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(shown.length, 1);
  assert.deepEqual([shown[0].title, shown[0].body, shown[0].sub, shown[0].workout, shown[0].start, shown[0].end, shown[0].look], ["Push A", "Bench Press \u00b7 Set 2 of 4", "Next: Incline Press", true, start, 0, "clock"]);
  // A rest inside the workout: countdown with the exercise kept
  const end = Date.now() + 90000;
  listeners["lb:rest"]({ detail: { end, total: 90, sound: "restDone", look: "bar" } });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(shown.length, 2);
  assert.deepEqual([shown[1].title, shown[1].end, shown[1].total, shown[1].workout, shown[1].look], ["Rest timer", end, 90, true, "bar"]);
  // Rest ends: back to the workout view, not cancelled
  listeners["lb:rest-stop"]();
  await new Promise(r => setTimeout(r, 10));
  assert.equal(shown.length, 3); assert.equal(shown[2].end, 0); assert.equal(stops, 0);
  // Workout ends: cleared
  listeners["lb:workout-stop"]();
  assert.equal(stops, 1);
  // A rest with no workout (Quick log): plain countdown, unknown look falls back to big
  listeners["lb:rest"]({ detail: { end, total: 90, look: "../odd" } });
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual([shown[3].workout, shown[3].body, shown[3].look], [false, "Rest 1:30", "big"]);
  listeners["lb:rest-stop"]();
  assert.equal(stops, 2);
  rtListeners.skip(); rtListeners.adjust({ seconds: -15 }); rtListeners.complete(); rtListeners.rest();
  assert.deepEqual(fired.map(e => [e.type, e.detail]), [["lb:rest-skip", {}], ["lb:rest-adjust", { d: -15 }], ["lb:workout-complete", {}], ["lb:rest-start", {}]]);
  delete global.document; delete global.CustomEvent; global.window = {};
});

test("RestTimerPlugin.kt and its layout are copied into the Android project unchanged", () => {
  const fs = require("fs"), path = require("path"), root = path.join(__dirname, "..", "..");
  for (const [src, dst] of [["RestTimerPlugin.kt", "android/app/src/main/java/com/azizfitness/app/RestTimerPlugin.kt"], ["notification_rest.xml", "android/app/src/main/res/layout/notification_rest.xml"], ["notification_rest_clock.xml", "android/app/src/main/res/layout/notification_rest_clock.xml"], ["notification_rest_bar.xml", "android/app/src/main/res/layout/notification_rest_bar.xml"]]) {
    assert.equal(fs.readFileSync(path.join(root, dst), "utf8"), fs.readFileSync(path.join(__dirname, "android", src), "utf8"), "copy modules/android-shell/android/" + src + " into " + dst);
  }
  const main = fs.readFileSync(path.join(root, "android/app/src/main/java/com/azizfitness/app/MainActivity.java"), "utf8");
  assert.ok(main.includes("registerPlugin(RestTimerPlugin.class)"), "RestTimerPlugin registered in MainActivity");
});
