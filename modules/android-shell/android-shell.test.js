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

test("Complete set works with the app in the background: the plan rides on show(), queued ticks replay once with their times", async () => {
  delete require.cache[require.resolve("./android-shell.js")];
  const listeners = {}, rtListeners = {}, appListeners = {}, shown = [], fired = [];
  let queue = [{ at: 1000, end: 91000 }], takes = 0;
  const LocalNotifications = { checkPermissions: async () => ({ display: "granted" }), createChannel: async () => {}, schedule: async () => {}, cancel: async () => {} };
  const RestTimer = { show: async o => { shown.push(o); return { shown: true }; }, stop: async () => {}, addListener: (k, fn) => { rtListeners[k] = fn; },
    takePending: async () => { takes++; const items = queue; queue = []; return { items }; } };
  const App = { addListener: (k, fn) => { appListeners[k] = fn; } };
  global.CustomEvent = class { constructor(name, o) { this.type = name; this.detail = o && o.detail; } };
  global.window = { Capacitor: { isNativePlatform: () => true, Plugins: { LocalNotifications, RestTimer, App } }, addEventListener: (k, fn) => { listeners[k] = fn; }, dispatchEvent: e => fired.push(e) };
  global.document = { documentElement: { classList: { add() {} } }, body: {} };
  const A = require("./android-shell.js");
  A.init({});
  await new Promise(r => setTimeout(r, 10));
  // At start: a tick queued while the app slept is replayed with the phone's times
  assert.deepEqual(fired.map(e => [e.type, e.detail]), [["lb:workout-complete", { at: 1000, end: 91000 }]]);
  // The workout view carries what Complete set leads to
  listeners["lb:workout"]({ detail: { name: "Push A", start: 1, exercise: "Bench Press", set: "Set 2 of 4", next: "Incline Press", done: 3, total: 16,
    after: { ok: true, rest: 120, sound: "gong", exercise: "Bench Press", set: "Set 3 of 4", next: "Incline Press", done: 4, total: 16 } } });
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(shown[0].complete, { rest: 120, sound: "gong", body: "Bench Press \u00b7 Set 3 of 4", sub: "Next: Incline Press" });
  assert.equal(shown[0].name, "Push A");
  // No numbers to tick: no plan, the web app decides (and says so) when it wakes
  listeners["lb:workout"]({ detail: { name: "Push A", start: 1, exercise: "Bench Press", set: "Set 2 of 4", after: { ok: false } } });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(shown[1].complete, null);
  // The button: queued → take the queue; not queued → the old event
  fired.length = 0; queue = [{ at: 5000, end: 0 }];
  rtListeners.complete({ queued: true });
  await new Promise(r => setTimeout(r, 10));
  rtListeners.complete({ queued: false });
  assert.deepEqual(fired.map(e => [e.type, e.detail]), [["lb:workout-complete", { at: 5000, end: 0 }], ["lb:workout-complete", {}]]);
  // Reopening the app takes the queue again; an empty queue fires nothing
  fired.length = 0; const before = takes;
  appListeners.resume();
  await new Promise(r => setTimeout(r, 10));
  assert.equal(takes, before + 1); assert.equal(fired.length, 0);
  delete global.document; delete global.CustomEvent; global.window = {};
});

test("RestTimerPlugin.kt acts on Complete set / −15 / +15 / Skip itself before telling the web app", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "android", "RestTimerPlugin.kt"), "utf8");
  for (const k of ["fun takePending", "completeNative()", "adjustNative(d)", "skipNative()", "RestRing.arm(context, end, a.sound", "getObject(\"complete\")"]) assert.ok(src.includes(k), k);
});

test("RestTimerPlugin.kt and its layout are copied into the Android project unchanged", () => {
  const fs = require("fs"), path = require("path"), root = path.join(__dirname, "..", "..");
  for (const [src, dst] of [["RestTimerPlugin.kt", "android/app/src/main/java/com/azizfitness/app/RestTimerPlugin.kt"], ["RestRing.kt", "android/app/src/main/java/com/azizfitness/app/RestRing.kt"], ["RestRingReceiver.kt", "android/app/src/main/java/com/azizfitness/app/RestRingReceiver.kt"], ["notification_rest.xml", "android/app/src/main/res/layout/notification_rest.xml"], ["notification_rest_clock.xml", "android/app/src/main/res/layout/notification_rest_clock.xml"], ["notification_rest_bar.xml", "android/app/src/main/res/layout/notification_rest_bar.xml"]]) {
    assert.equal(fs.readFileSync(path.join(root, dst), "utf8"), fs.readFileSync(path.join(__dirname, "android", src), "utf8"), "copy modules/android-shell/android/" + src + " into " + dst);
  }
  const main = fs.readFileSync(path.join(root, "android/app/src/main/java/com/azizfitness/app/MainActivity.java"), "utf8");
  assert.ok(main.includes("registerPlugin(RestTimerPlugin.class)"), "RestTimerPlugin registered in MainActivity");
});

test("rest-over sound: native alarm + ducked ring, once per rest, skip disarms", async () => {
  delete require.cache[require.resolve("./android-shell.js")];
  const listeners = {}, calls = [];
  const LocalNotifications = { checkPermissions: async () => ({ display: "granted" }), createChannel: async () => {}, schedule: async () => { calls.push(["schedule"]); }, cancel: async () => {} };
  const RestTimer = { show: async () => ({ shown: true }), stop: async () => {}, addListener() {},
    arm: async o => { calls.push(["arm", o]); return { mode: "exact" }; }, disarm: async () => { calls.push(["disarm"]); },
    ring: async o => { calls.push(["ring", o]); return { played: true }; } };
  let hook = null, settings = { sound: true, restSound: "gong" };
  const GymSounds = { setNative: fn => { hook = fn; }, customMs: () => 4000 };
  global.CustomEvent = class { constructor(name, o) { this.type = name; this.detail = o && o.detail; } };
  global.window = { Capacitor: { isNativePlatform: () => true, Plugins: { LocalNotifications, RestTimer } }, GymSounds, WorkoutLogger: { settings: () => settings }, addEventListener: (k, fn) => { listeners[k] = fn; }, dispatchEvent() {} };
  global.WorkoutLogger = global.window.WorkoutLogger;
  global.document = { documentElement: { classList: { add() {} } }, body: {} };
  const A = require("./android-shell.js");
  A.init({});
  assert.equal(hook, A.ringRest, "GymSounds rest sounds go native");
  // A rest: exact alarm at its end with the picked sound, no LocalNotifications schedule
  let end = Date.now() + 60000;
  listeners["lb:rest"]({ detail: { end, total: 60, sound: "gong" } });
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(calls.filter(c => c[0] !== "disarm"), [["arm", { end, sound: "gong", silent: false }]]);
  // Skipped early: disarmed
  calls.length = 0; listeners["lb:rest-stop"]();
  assert.deepEqual(calls, [["disarm"]]);
  // A rest that ends on time: the alarm stays, and the ring right after lb:rest-stop still carries its end
  end = Date.now() + 500;
  listeners["lb:rest"]({ detail: { end, total: 30, sound: "gong" } });
  await new Promise(r => setTimeout(r, 10));
  calls.length = 0; listeners["lb:rest-stop"]();
  assert.equal(hook("gong", () => assert.fail("web fallback")), true);
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(calls, [["ring", { sound: "gong", end }]]);
  // A preview in Settings: end 0. The user's own sound: native only ducks, the web view plays it.
  calls.length = 0; let web = [];
  RestTimer.ring = async o => { calls.push(["ring", o]); return { played: false, ducked: o.sound === "custom" }; };
  await new Promise(r => setTimeout(r, 3600));
  assert.equal(hook("custom", n => web.push(n)), true);
  await new Promise(r => setTimeout(r, 260));
  assert.deepEqual([calls, web], [[["ring", { sound: "custom", end: 0, ms: 4000 }]], ["custom"]]);
  // Beep off: the alarm only buzzes
  settings = { sound: false }; calls.length = 0;
  listeners["lb:rest"]({ detail: { end: Date.now() + 90000, total: 90, sound: "restDone" } });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(calls[0][1].silent, true);
  delete global.document; delete global.CustomEvent; delete global.WorkoutLogger; global.window = {};
});

test("iPhone: platform() says ios, <html> gets ios-app, and the rest bell is a plain local notification (no Android channel, no RestTimer)", async () => {
  delete require.cache[require.resolve("./android-shell.js")];
  const listeners = {}, scheduled = [], classes = [];
  const LocalNotifications = {
    checkPermissions: async () => ({ display: "granted" }),
    createChannel: async () => { throw new Error("not implemented on iOS"); },
    schedule: async o => { scheduled.push(...o.notifications); },
    cancel: async () => {}
  };
  global.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: { LocalNotifications } }, addEventListener: (k, fn) => { listeners[k] = fn; } };
  global.document = { documentElement: { classList: { add(c) { classes.push(c); } } }, body: {} };
  const A = require("./android-shell.js");
  assert.equal(A.platform(), "ios");
  assert.equal(A.init({}), true);
  assert.deepEqual(classes, ["ios-app"]);
  listeners["lb:rest"]({ detail: { end: 1e12, total: 90 } });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].title, "Rest is over");
  assert.equal(scheduled[0].channelId, undefined, "no Android channel on iOS");
});

test("platform(): android inside the APK, web in a browser", () => {
  delete require.cache[require.resolve("./android-shell.js")];
  global.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => "android", Plugins: {} } };
  assert.equal(require("./android-shell.js").platform(), "android");
  delete require.cache[require.resolve("./android-shell.js")];
  global.window = {};
  assert.equal(require("./android-shell.js").platform(), "web");
});
