const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const MC = require("./music-control.js");

test("settings: strip look on by default, bad looks fall back, store is used", () => {
  let saved = null;
  MC.init({ get: () => saved, set: v => { saved = v; } });
  assert.deepEqual(MC.settings(), { on: true, look: "strip", playlist: "", meta: false });
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
  assert.ok(!manifest.includes("MEDIA_CONTENT_CONTROL") && !/uses-permission[^>]*NOTIFICATION_LISTENER/.test(manifest), "no new uses-permission");
  assert.ok(manifest.includes('android:name=".NowPlayingListener"') && manifest.includes("android.service.notification.NotificationListenerService"), "notification listener declared (opt-in from Settings)");
  assert.equal(fs.readFileSync(path.join(root, "android/app/src/main/java/com/azizfitness/app/NowPlayingListener.kt"), "utf8"), fs.readFileSync(path.join(__dirname, "android/NowPlayingListener.kt"), "utf8"), "copy NowPlayingListener.kt into android/");
});

test("now playing: off by default; with the switch on it shows the song, the access nudge, or nothing-playing; pause icon follows the state", async () => {
  let saved = { on: true, look: "strip", playlist: "", meta: false };
  MC.init({ get: () => saved, set: v => { saved = v; }, toast: () => {} });
  MC._setNp(null);
  assert.ok(!MC.html.strip(true).includes("mc-art"), "meta off: plain strip");
  saved.meta = true;
  globalThis.AndroidShell = { isNative: () => true };
  const calls = [];
  let answer = { access: false };
  globalThis.Capacitor = { Plugins: { MediaKeys: { nowPlaying: async () => answer, hasAccess: async () => ({ access: answer.access }), requestAccess: async () => { calls.push("requestAccess"); return { opened: true }; }, press: async o => { calls.push(o.key); } } } };
  await MC.poll();
  assert.ok(MC.html.strip(true).includes('data-mc="access"'), "no access → Allow notification access");
  assert.ok(MC.html.panel().includes('data-mc="access"') && MC.html.workout(true).includes('data-mc="access"'));
  answer = { access: true, session: true, title: "Eye of the Tiger", artist: "Survivor", playing: true, art: "data:image/jpeg;base64,AAA=" };
  await MC.poll();
  const h = MC.html.strip(true);
  assert.ok(h.includes("Eye of the Tiger") && h.includes("Survivor") && h.includes('class="mc-art"'), "song, artist and cover shown");
  assert.ok(h.includes('aria-label="Pause"'), "playing → pause icon");
  answer = { access: true, session: false };
  await MC.poll();
  assert.ok(MC.html.strip(true).includes("Nothing playing"));
  assert.ok(MC.html.strip(true).includes('aria-label="Play"'));
  // enableMeta without access sends the user to the Android settings page once
  answer = { access: false };
  assert.equal(await MC.enableMeta(true), false);
  assert.deepEqual(calls, ["requestAccess"]);
  assert.equal(MC.settings().meta, true);
  await MC.enableMeta(false);
  assert.equal(MC.settings().meta, false);
  assert.equal(MC.nowPlaying(), null);
  delete globalThis.AndroidShell; delete globalThis.Capacitor;
});

test("icon pop-up: a song change repaints the open panel instead of closing it; a look change closes it", async () => {
  // minimal DOM stand-in: document with createElement/body, an anchor with a rect
  const made = [];
  const mk = () => { const el = { children: [], _html: "", style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, getAttribute() { return null; }, remove() { el.removed = true; }, contains: () => false, querySelector: () => null, querySelectorAll: () => [], appendChild(c) { el.children.push(c); c.parent = el; }, prepend() {}, after() {}, closest: () => null };
    Object.defineProperty(el, "innerHTML", { get() { return el._html; }, set(v) { el._html = v; el.firstElementChild = v ? mk() : null; if (el.firstElementChild) el.firstElementChild._html = v.replace(/^<div class="mc-panel"[^>]*>|<\/div>$/g, ""); } });
    return el; };
  const body = mk();
  globalThis.document = { createElement: () => mk(), body, head: { appendChild() {} }, querySelectorAll: () => [], addEventListener() {} };
  globalThis.innerWidth = 360;
  let saved = { on: true, look: "icon", playlist: "", meta: true };
  MC.init({ get: () => saved, set: v => { saved = v; }, toast: () => {} });
  globalThis.AndroidShell = { isNative: () => true };
  let answer = { access: true, session: true, title: "Song A", artist: "X", playing: true };
  globalThis.Capacitor = { Plugins: { MediaKeys: { nowPlaying: async () => answer, press: async () => ({}) } } };
  const anchor = mk(); anchor.getBoundingClientRect = () => ({ bottom: 50, right: 300 }); anchor.classList.contains = c => c === "mc-icon";
  anchor.dataset = { mc: "toggle" };
  MC._act(anchor);                       // opens the panel
  assert.equal(body.children.length, 1, "panel appended");
  const panel = body.children[0];
  await MC.poll();
  assert.ok(panel.innerHTML.includes("Song A"));
  answer = { access: true, session: true, title: "Song B", artist: "Y", playing: true };
  await MC.poll();                        // song changed → render()
  assert.ok(!panel.removed, "panel still open after the song changed");
  assert.ok(panel.innerHTML.includes("Song B"), "panel repainted with the new song");
  MC.setSettings({ look: "strip" });     // a look change does close it
  assert.ok(panel.removed, "panel closed when the look changes");
  delete globalThis.document; delete globalThis.innerWidth; delete globalThis.AndroidShell; delete globalThis.Capacitor;
});

test("every class in the music markup and CSS carries the mc- prefix (a bare .pp from Progress photos once blanked the play button)", () => {
  MC.init({ get: () => ({ on: true, look: "strip", playlist: "", meta: false }), set: () => {}, toast: () => {} });
  const html = [MC.html.icon(false), MC.html.panel(), MC.html.strip(true), MC.html.strip(false), MC.html.workout(true), MC.html.workout(false)].join("");
  const classes = new Set(); for (const m of html.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach(c => classes.add(c));
  const bare = [...classes].filter(c => !c.startsWith("mc-"));
  assert.deepEqual(bare, [], "classes without the mc- prefix: " + bare.join(", "));
  const src = require("fs").readFileSync(__dirname + "/music-control.js", "utf8");
  const css = src.slice(src.indexOf("const CSS = `") + 13, src.indexOf("`;", src.indexOf("const CSS = `")));
  const bareSel = [...css.matchAll(/\.([a-z][\w-]*)/g)].map(m => m[1]).filter(c => !c.startsWith("mc-") && !/^\d/.test(c) && !["datepick", "lb-live", "lb-live-body"].includes(c));   // shell and workout-logger hooks the control sits in
  assert.deepEqual([...new Set(bareSel)], [], "CSS selectors without the mc- prefix");
});
