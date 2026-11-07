const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const MC = require("./music-control.js");

test("settings: strip look on by default, bad looks fall back, store is used", () => {
  let saved = null;
  MC.init({ get: () => saved, set: v => { saved = v; } });
  assert.deepEqual(MC.settings(), { on: true, look: "strip", playlist: "" });
  MC.setSettings({ look: "workout" }); assert.equal(saved.look, "workout");
  MC.setSettings({ look: "nope" }); assert.equal(saved.look, "strip");
  MC.setSettings({ on: false }); assert.equal(MC.settings().on, false);
  assert.deepEqual(MC.LOOKS.map(l => l[0]), ["strip", "icon", "workout"]);
});

test("validPlaylist keeps only YouTube / YouTube Music links", () => {
  assert.equal(MC.validPlaylist("https://music.youtube.com/playlist?list=PL123"), "https://music.youtube.com/playlist?list=PL123");
  assert.equal(MC.validPlaylist("music.youtube.com/playlist?list=PL123"), "https://music.youtube.com/playlist?list=PL123");
  assert.equal(MC.validPlaylist("http://www.youtube.com/playlist?list=X"), "https://www.youtube.com/playlist?list=X");
  assert.equal(MC.validPlaylist("https://youtu.be/abc"), "https://youtu.be/abc");
  assert.equal(MC.validPlaylist("https://example.com/youtube.com"), null);
  assert.equal(MC.validPlaylist(""), null);
  assert.equal(MC.validPlaylist("not a url at all"), null);
});

test("markup: every look carries the actions, the playlist row depends on the saved link", () => {
  let saved = { on: true, look: "strip", playlist: "" };
  MC.init({ get: () => saved, set: v => { saved = v; } });
  for (const h of [MC.html.panel(), MC.html.strip(true), MC.html.workout(true)]) {
    for (const a of ["prev", "pp", "next", "open"]) assert.ok(h.includes('data-mc="' + a + '"'), a + " in " + h.slice(0, 40));
    assert.ok(h.includes('data-mc="settings"'), "no playlist yet → settings link");
  }
  saved.playlist = "https://music.youtube.com/playlist?list=PL1";
  assert.ok(MC.html.workout(true).includes('data-mc="playlist"'));
  assert.ok(MC.html.strip(false).includes('data-mc="toggle"') && MC.html.workout(false).includes("mc-fab"));
  assert.ok(MC.html.icon(false).includes('aria-haspopup="dialog"'));
  assert.ok(MC.html.panel().includes('role="dialog"') && MC.html.panel().includes('aria-label="Close"'), "panel closes with the back button");
});

test("press: no plugin → toast and false; with the MediaKeys plugin → the key is sent", async () => {
  const toasts = [];
  MC.init({ toast: m => toasts.push(m) });
  assert.equal(await MC.press("next"), false);
  assert.equal(toasts.length, 1);
  const sent = [];
  globalThis.AndroidShell = { isNative: () => true };
  globalThis.Capacitor = { Plugins: { MediaKeys: { press: async o => { sent.push(o.key); return { sent: true }; }, open: async o => { sent.push("open:" + o.pkg + ":" + o.url); return { opened: true }; } } } };
  assert.equal(await MC.press("toggle"), true);
  assert.equal(await MC.open("https://music.youtube.com/playlist?list=PL1"), true);
  assert.deepEqual(sent, ["toggle", "open:" + MC.PKG + ":https://music.youtube.com/playlist?list=PL1"]);
  delete globalThis.AndroidShell; delete globalThis.Capacitor;
});

test("MediaKeysPlugin.kt is copied into the Android project, registered, and YouTube Music is queryable", () => {
  const root = path.join(__dirname, "..", "..");
  assert.equal(fs.readFileSync(path.join(root, "android/app/src/main/java/com/azizfitness/app/MediaKeysPlugin.kt"), "utf8"), fs.readFileSync(path.join(__dirname, "android/MediaKeysPlugin.kt"), "utf8"), "copy modules/music-control/android/MediaKeysPlugin.kt into android/");
  const main = fs.readFileSync(path.join(root, "android/app/src/main/java/com/azizfitness/app/MainActivity.java"), "utf8");
  assert.ok(main.includes("registerPlugin(MediaKeysPlugin.class)"));
  const manifest = fs.readFileSync(path.join(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
  assert.ok(manifest.includes('<package android:name="' + MC.PKG + '" />'));
  assert.ok(!manifest.includes("BIND_NOTIFICATION_LISTENER_SERVICE") && !manifest.includes("MEDIA_CONTENT_CONTROL"), "no new permissions");
});
