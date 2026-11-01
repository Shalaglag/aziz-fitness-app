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
