// Run: node --test modules/app-update/app-update.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "../..");
const A = require("./app-update.js");

const release = (build, extra = {}) => ({
  body: `Newest build from main (build ${build}, 6ba312b68d46e0b8b4711d63f23d204aee7a69b2).\nInstall: …`,
  updated_at: "2026-11-01T11:29:33Z",
  assets: [{ name: "aziz-fitness.aab", url: "https://api.github.com/x/aab", size: 1 }, { name: "aziz-fitness.apk", url: "https://api.github.com/repos/Shalaglag/aziz-fitness-app/releases/assets/698147007", size: 5890736, updated_at: "2026-11-01T11:29:33Z" }],
  ...extra
});

const LATEST = { build: 110, sha: "abc1234", size: 16177772, at: "2026-11-01T18:00:00Z", versionName: "1.0.110" };

test("parseLatest reads CI's latest.json from the public release; the APK comes from the same release", () => {
  assert.deepEqual(A.parseLatest(LATEST), { build: 110, sha: "abc1234", assetUrl: "https://github.com/Shalaglag/mizan-releases/releases/download/android-latest/aziz-fitness.apk", size: 16177772, at: "2026-11-01T18:00:00Z", versionName: "1.0.110", source: "public" });
  assert.equal(A.LATEST_URL, "https://github.com/Shalaglag/mizan-releases/releases/download/android-latest/latest.json");
  assert.equal(A.parseLatest({ build: "x" }), null);
  assert.equal(A.parseLatest(null), null);
});

test("parseRelease reads the build number and the APK asset", () => {
  assert.deepEqual(A.parseRelease(release(71)), { build: 71, sha: "6ba312b68d46e0b8b4711d63f23d204aee7a69b2", assetUrl: "https://api.github.com/repos/Shalaglag/aziz-fitness-app/releases/assets/698147007", size: 5890736, at: "2026-11-01T11:29:33Z", source: "private" });
  assert.equal(A.parseRelease({ body: "build 5", assets: [] }), null, "no APK asset");
  assert.equal(A.parseRelease({ body: "nothing", assets: release(1).assets }), null, "no build number");
  assert.equal(A.parseRelease(null), null);
});

test("compare: only a higher build is an update", () => {
  assert.equal(A.compare({ versionCode: 70 }, { build: 71 }), "available");
  assert.equal(A.compare({ versionCode: 71 }, { build: 71 }), "up-to-date");
  assert.equal(A.compare({ versionCode: 72 }, { build: 71 }), "up-to-date");
  assert.equal(A.compare(null, { build: 71 }), "unknown");
  assert.equal(A.compare({ versionCode: 70 }, null), "unknown");
});

test("error messages say what to do", () => {
  assert.match(A.errorText("http", 401), /expired/);
  assert.match(A.errorText("http", 404), /Contents: Read-only/);
  assert.match(A.errorText("signature"), /isn't signed with your app's key/);
  assert.match(A.errorText("install-not-allowed"), /allow Mizan to install/);
  assert.match(A.errorText("offline"), /No internet/);
});

test("the key page link asks only for read access to contents, with no expiry", () => {
  const u = new URL(A.TOKEN_URL);
  assert.equal(u.origin + u.pathname, "https://github.com/settings/personal-access-tokens/new");
  assert.equal(u.searchParams.get("contents"), "read");
  assert.equal(u.searchParams.get("target_name"), "Shalaglag");
  assert.equal([...u.searchParams.keys()].filter(k => !["name", "description", "target_name", "expires_in", "contents"].includes(k)).length, 0, "no other permissions");
});

// pub: the public latest.json ({status, json}); the private release is answered with `status` + release(latest).
function fakePhone({ installed = 70, latest = 71, status = 200, canInstall = true, downloadErr = null, pub = { status: 404, json: null } } = {}) {
  const calls = [], mem = {};
  const AppUpdate = {
    info: async () => ({ versionCode: installed, versionName: "1.0" }),
    latest: async o => { calls.push(["latest", o]); if (/mizan-releases/.test(o.url)) return { status: pub.status, body: pub.json ? JSON.stringify(pub.json) : "Not Found" }; return { status, body: JSON.stringify(release(latest)) }; },
    canInstall: async () => ({ allowed: canInstall }),
    openInstallSettings: async () => { calls.push(["settings"]); },
    addListener: async (ev, fn) => { calls.push(["listen", ev]); fn({ done: 10, total: 20 }); return { remove() { calls.push(["unlisten"]); } }; },
    download: async o => { calls.push(["download", o]); if (downloadErr) throw downloadErr; return { path: "/cache/updates/aziz-fitness.apk", versionCode: latest }; },
    install: async o => { calls.push(["install", o]); }
  };
  globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { AppUpdate } };
  globalThis.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  Object.assign(A._state, { phase: "idle", current: null, latest: null, msg: "", editing: false, lastAuto: 0, dismissed: false });
  return { calls, mem };
}
const TOKEN = "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz";

test("no key, no setup: the public release is checked, Today shows a banner, Update downloads the public APK without a key", async () => {
  const { calls } = fakePhone({ pub: { status: 200, json: LATEST } });
  const s = await A.check();
  assert.equal(s.phase, "available");
  assert.equal(calls.length, 1, "only the public latest.json was fetched");
  assert.equal(calls[0][1].token, "", "no key sent");
  assert.equal(calls[0][1].url, A.LATEST_URL);
  const html = A.cardHTML();
  assert.match(html, /Build 110 is ready/);
  assert.match(html, /Installed: build 70/);
  assert.doesNotMatch(html, /auToken/, "no key box");
  assert.doesNotMatch(html, /One-time setup/);
  assert.match(html, /Advanced: use a GitHub key/);
  assert.match(A.bannerHTML(), /New version ready/);
  await A.update();
  const dl = calls.find(c => c[0] === "download")[1];
  assert.deepEqual(dl, { url: A.APK_URL, token: "", minVersion: 71 });
  assert.deepEqual(calls.find(c => c[0] === "install")[1], { path: "/cache/updates/aziz-fitness.apk" });
  assert.equal(A._state.phase, "installing");
});

test("no key and nothing published yet: a plain message, no setup steps", async () => {
  const { calls } = fakePhone();
  const s = await A.check();
  assert.equal(s.phase, "error");
  assert.match(s.msg, /No update has been published yet/);
  assert.equal(calls.length, 1, "the private release is not tried without a key");
  const html = A.cardHTML();
  assert.match(html, /data-au="check"/);
  assert.doesNotMatch(html, /auToken/);
  assert.equal(A.bannerHTML(), "");
});

test("public release wins over the private one even with a key saved", async () => {
  const { calls } = fakePhone({ pub: { status: 200, json: LATEST } }); A.setToken(TOKEN);
  assert.equal((await A.check()).phase, "available");
  assert.equal(calls.length, 1);
  await A.update();
  assert.equal(calls.find(c => c[0] === "download")[1].token, "", "the key is never sent for the public file");
});

test("Advanced link opens the key steps; with a key the private release is the fallback: finds build 71, downloads with the key", async () => {
  fakePhone();
  Object.assign(A._state, { editing: true });
  const edit = A.cardHTML();
  assert.match(edit, /Contents: Read-only/);
  assert.match(edit, /id="auToken" type="password"/);
  Object.assign(A._state, { editing: false });
  const { calls, mem } = fakePhone();
  A.setToken(TOKEN);
  assert.equal(mem["aziz-update-token"], TOKEN, "kept in this phone's storage only");
  const s = await A.check();
  assert.equal(s.phase, "available");
  assert.equal(calls[0][1].token, "", "public first");
  assert.equal(calls[1][1].token, TOKEN);
  assert.match(calls[1][1].url, /releases\/tags\/android-latest$/);
  assert.match(A.cardHTML(), /Build 71 is ready/);
  assert.match(A.bannerHTML(), /New version ready/);
  await A.update();
  const dl = calls.find(c => c[0] === "download")[1];
  assert.equal(dl.minVersion, 71, "must be newer than the installed build");
  assert.match(dl.url, /releases\/assets\/698147007$/);
  assert.deepEqual(calls.find(c => c[0] === "install")[1], { path: "/cache/updates/aziz-fitness.apk" });
  assert.ok(calls.some(c => c[0] === "unlisten"), "progress listener removed");
  assert.equal(A._state.phase, "installing");
});

test("already newest: no banner; bad key: clear message", async () => {
  fakePhone({ installed: 71, latest: 71 }); A.setToken(TOKEN);
  assert.equal((await A.check()).phase, "up-to-date");
  assert.equal(A.bannerHTML(), "");
  fakePhone({ status: 401 }); A.setToken(TOKEN);
  const s = await A.check();
  assert.equal(s.phase, "error");
  assert.match(s.msg, /rejected the key/);
});

test("installs not allowed yet: asks to allow instead of failing; wrong signature is refused", async () => {
  let ph = fakePhone({ canInstall: false }); A.setToken(TOKEN);
  await A.check(); await A.update();
  assert.equal(A._state.phase, "allow");
  assert.match(A.cardHTML(), /data-au="allow"/);
  assert.ok(!ph.calls.some(c => c[0] === "download"), "nothing downloaded before Android allows installs");
  ph = fakePhone({ downloadErr: Object.assign(new Error("signed with a different key"), { code: "signature" }) }); A.setToken(TOKEN);
  await A.check(); await A.update();
  assert.ok(!ph.calls.some(c => c[0] === "install"), "not handed to the installer");
  assert.match(A._state.msg, /isn't signed with your app's key/);
});

test("auto-check runs on open/resume at most every 10 minutes, with or without a key", () => {
  const { calls } = fakePhone({ pub: { status: 200, json: LATEST } });
  assert.equal(A.autoCheck(1e12), true, "no key needed");
  assert.equal(A.autoCheck(1e12 + 5 * 60e3), false, "five minutes later: skipped");
  assert.equal(A.autoCheck(1e12 + 11 * 60e3), true, "eleven minutes later: checks again");
  void calls;
});

test("off Android the card points to the release page and never asks for a key", () => {
  globalThis.Capacitor = undefined;
  Object.assign(A._state, { phase: "idle" });
  const html = A.cardHTML();
  assert.match(html, /inside the Android app/);
  assert.doesNotMatch(html, /auToken/);
});

test("native plugin: compiled copy matches, registered, permission declared, key never stored natively", () => {
  const src = fs.readFileSync(path.join(__dirname, "android/AppUpdatePlugin.kt"), "utf8");
  const built = fs.readFileSync(path.join(root, "android/app/src/main/java/com/azizfitness/app/AppUpdatePlugin.kt"), "utf8");
  assert.equal(built, src, "copy modules/app-update/android/AppUpdatePlugin.kt into android/app/src/main/java/com/azizfitness/app/");
  assert.match(fs.readFileSync(path.join(root, "android/app/src/main/java/com/azizfitness/app/MainActivity.java"), "utf8"), /registerPlugin\(AppUpdatePlugin\.class\)/);
  assert.match(fs.readFileSync(path.join(root, "android/app/src/main/AndroidManifest.xml"), "utf8"), /android\.permission\.REQUEST_INSTALL_PACKAGES/);
  assert.doesNotMatch(src, /SharedPreferences|getSharedPreferences/, "the plugin does not keep the key");
  assert.match(src, /url\.host == "api\.github\.com"/, "the key is only sent to api.github.com, not to the redirect target");
  assert.match(src, /signingCertificateHistory/, "signature check present");
});

test("a newer build shows the 'Update required' popup; Close hides it until the app is opened or resumed again", async () => {
  fakePhone({ pub: { status: 200, json: LATEST } });
  await A.check({ quiet: true });
  const html = A.promptHTML();
  assert.match(html, /role="dialog"/);
  assert.match(html, /Update required/);
  assert.match(html, /build 110/);
  assert.match(html, /data-au="update"/);
  assert.match(html, /aria-label="Close"/, "Android back button can close it");
  assert.match(html, /data-au="dismiss"[^>]*data-close/);
  A._state.dismissed = true;
  assert.equal(A.promptHTML(), "", "closed");
  A.onOpen(1e12 + 1); // resume within 10 minutes: no new check, but the popup comes back
  assert.match(A.promptHTML(), /Update required/);
});

test("no popup when already newest, when nothing is published, or off Android", async () => {
  fakePhone({ installed: 200, pub: { status: 200, json: LATEST } });
  await A.check({ quiet: true });
  assert.equal(A.promptHTML(), "");
  fakePhone();
  await A.check({ quiet: true });
  assert.equal(A.promptHTML(), "");
  fakePhone({ pub: { status: 200, json: LATEST } });
  await A.check({ quiet: true });
  globalThis.Capacitor = undefined;
  assert.equal(A.promptHTML(), "");
});

test("popup follows the update: allow, then download progress, then the installer step", async () => {
  fakePhone({ canInstall: false, pub: { status: 200, json: LATEST } });
  await A.check({ quiet: true });
  await A.update();
  assert.match(A.promptHTML(), /data-au="allow"/);
  fakePhone({ pub: { status: 200, json: LATEST } });
  await A.check({ quiet: true });
  A._state.phase = "downloading"; A._state.done = 5; A._state.total = 10;
  assert.match(A.promptHTML(), /Downloading build 110/);
  assert.match(A.promptHTML(), /width:50%/);
  await A.update();
  assert.match(A.promptHTML(), /Open the installer again/);
});
