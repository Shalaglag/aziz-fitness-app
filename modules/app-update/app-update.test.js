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

test("parseRelease reads the build number and the APK asset", () => {
  assert.deepEqual(A.parseRelease(release(71)), { build: 71, sha: "6ba312b68d46e0b8b4711d63f23d204aee7a69b2", assetUrl: "https://api.github.com/repos/Shalaglag/aziz-fitness-app/releases/assets/698147007", size: 5890736, at: "2026-11-01T11:29:33Z" });
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

function fakePhone({ installed = 70, latest = 71, status = 200, canInstall = true, downloadErr = null } = {}) {
  const calls = [], mem = {};
  const AppUpdate = {
    info: async () => ({ versionCode: installed, versionName: "1.0" }),
    latest: async o => { calls.push(["latest", o]); return { status, body: JSON.stringify(release(latest)) }; },
    canInstall: async () => ({ allowed: canInstall }),
    openInstallSettings: async () => { calls.push(["settings"]); },
    addListener: async (ev, fn) => { calls.push(["listen", ev]); fn({ done: 10, total: 20 }); return { remove() { calls.push(["unlisten"]); } }; },
    download: async o => { calls.push(["download", o]); if (downloadErr) throw downloadErr; return { path: "/cache/updates/aziz-fitness.apk", versionCode: latest }; },
    install: async o => { calls.push(["install", o]); }
  };
  globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { AppUpdate } };
  globalThis.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  Object.assign(A._state, { phase: "idle", current: null, latest: null, msg: "", editing: false, lastAuto: 0 });
  return { calls, mem };
}
const TOKEN = "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz";

test("no key: the card shows the one-time setup and nothing is fetched", async () => {
  const { calls } = fakePhone();
  const s = await A.check();
  assert.equal(s.phase, "no-token");
  assert.deepEqual(calls, []);
  const html = A.cardHTML();
  assert.match(html, /One-time setup/);
  assert.match(html, /Contents: Read-only/);
  assert.match(html, /id="auToken" type="password"/);
  assert.match(html, /Installed: build 70/);
  assert.equal(A.bannerHTML(), "");
});

test("with a key: finds build 71, Today shows a banner, Update downloads it and opens the installer", async () => {
  const { calls, mem } = fakePhone();
  A.setToken(TOKEN);
  assert.equal(mem["aziz-update-token"], TOKEN, "kept in this phone's storage only");
  const s = await A.check();
  assert.equal(s.phase, "available");
  assert.equal(calls[0][1].token, TOKEN);
  assert.match(calls[0][1].url, /releases\/tags\/android-latest$/);
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

test("auto-check runs at most every 6 hours and only with a key", () => {
  const { calls } = fakePhone();
  assert.equal(A.autoCheck(1e12), false, "no key, no check");
  A.setToken(TOKEN);
  assert.equal(A.autoCheck(1e12), true);
  assert.equal(A.autoCheck(1e12 + 3600e3), false, "an hour later: skipped");
  assert.equal(A.autoCheck(1e12 + 7 * 3600e3), true, "seven hours later: checks again");
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
