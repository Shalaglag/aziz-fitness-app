// Run: node --test modules/cloud-store/cloud-store.test.js
const test = require("node:test");
const assert = require("assert");
const C = require("./cloud-store.js");

const CFG = { apiKey: "k", authDomain: "x.firebaseapp.com", projectId: "x", appId: "1:2:web:3" };

test("validConfig needs apiKey, authDomain, projectId and appId", () => {
  assert.strictEqual(C.validConfig(CFG), true);
  assert.strictEqual(C.validConfig({ ...CFG, appId: "" }), false);
  assert.strictEqual(C.validConfig({ apiKey: "k" }), false);
  assert.strictEqual(C.validConfig(null), false);
  assert.strictEqual(C.validConfig("x"), false);
});

test("configured is false without a window config", () => {
  assert.strictEqual(C.configured(), false);
});

// A fake Firestore that records paths, enough to check scoping and error mapping.
function fakeFs(log) {
  const doc = path => ({
    id: path.split("/").pop(),
    collection: c => col(path + "/" + c),
    set: d => (log.push(["set", path, d]), Promise.resolve()),
    get: () => Promise.resolve({ path }),
    delete: () => (log.push(["delete", path]), Promise.resolve()),
    update: () => { const e = new Error("No document to update"); e.code = "not-found"; return Promise.reject(e); }
  });
  const col = path => ({
    doc: id => doc(path + "/" + id),
    add: d => (log.push(["add", path, d]), Promise.resolve()),
    get: () => Promise.resolve({ path }),
    onSnapshot: (next) => { next({ docs: [], path }); return () => {}; }
  });
  return { collection: c => col(c) };
}

test("scoped db writes under users/{uid}", async () => {
  const log = [];
  const db = C.scoped(fakeFs(log), "u1");
  await db.collection("days").doc("2026-10-26").set({ water: 500 });
  await db.collection("weights").doc("2026-10-26").delete();
  await db.collection("lb_workouts").add({ a: 1 });
  let seen;
  db.collection("days").onSnapshot(qs => { seen = qs.path; });
  assert.deepStrictEqual(log, [
    ["set", "users/u1/days/2026-10-26", { water: 500 }],
    ["delete", "users/u1/weights/2026-10-26"],
    ["add", "users/u1/lb_workouts", { a: 1 }]
  ]);
  assert.strictEqual(seen, "users/u1/days");
  assert.strictEqual(db.collection("days").doc("d1").id, "d1");
});

test("update on a missing doc reports invalid_argument so the outbox falls back to set", async () => {
  const db = C.scoped(fakeFs([]), "u1");
  await assert.rejects(db.collection("days").doc("x").update({ a: 1 }), e => e.code === "invalid_argument");
});

test("auth errors become plain sentences", () => {
  assert.match(C.authMessage("auth/invalid-credential"), /wrong/);
  assert.match(C.authMessage("auth/network-request-failed"), /internet/);
  assert.match(C.authMessage("something-else"), /Couldn't sign in/);
});

test("loadConfig resolves false when the config file can't be loaded", async () => {
  assert.strictEqual(await C.loadConfig(), false);
});

test("loadSdk tries the bundled copy first and falls back to the CDN", async () => {
  const seen = [];
  delete globalThis.firebase;
  await C.loadSdk(async src => { seen.push(src); if (src.startsWith(C.LOCAL_SDK)) throw new Error("404"); if (src.endsWith("firestore-compat.js")) globalThis.firebase = { firestore() {} }; });
  assert.ok(seen[0].startsWith("vendor/firebase-10.14.1/"), "bundled copy first");
  assert.ok(seen.slice(1).every(s => s.startsWith(C.SDK)), "then the CDN");
  assert.ok(globalThis.firebase);
  delete globalThis.firebase;
  const local = [];
  await C.loadSdk(async src => { local.push(src); globalThis.firebase = { firestore() {} }; });
  assert.ok(local.length >= 1 && local.every(s => s.startsWith(C.LOCAL_SDK)), "no CDN request when the bundled copy loads");
  delete globalThis.firebase;
});

test("the bundled Firebase files exist next to the app", () => {
  const fs = require("fs"), path = require("path");
  for (const p of ["app", "auth", "firestore"]) {
    const f = path.join(__dirname, "../../app", C.LOCAL_SDK, "firebase-" + p + "-compat.js");
    assert.ok(fs.statSync(f).size > 10000, f);
  }
});

// Google sign-in: native goes through the GoogleSignIn plugin and signs Firebase in with the ID token;
// the website uses Firebase's own pop-up. Both end in the same Firebase account (one uid per person).
function fakeFb(log) {
  function GoogleAuthProvider() { this.setCustomParameters = p => log.push(["params", p]); }
  GoogleAuthProvider.credential = tok => ({ providerId: "google.com", idToken: tok });
  const auth = {
    signInWithPopup: p => (log.push(["popup", p.constructor === GoogleAuthProvider]), Promise.resolve({ user: { uid: "web1", email: "w@x.com" } })),
    signInWithCredential: c => (log.push(["credential", c]), Promise.resolve({ user: { uid: "nat1", email: "n@x.com" } }))
  };
  return { fb: { auth: Object.assign(() => auth, { GoogleAuthProvider }) }, auth };
}

test("Google on Android: plugin idToken → signInWithCredential", async () => {
  const log = []; const { fb, auth } = fakeFb(log);
  const plugin = { signIn: o => (log.push(["plugin", o]), Promise.resolve({ idToken: "tok123", email: "n@x.com" })) };
  const u = await C.signInWithGoogle({ fb, auth, native: true, plugin, clientId: " 123-abc.apps.googleusercontent.com " });
  assert.strictEqual(u.uid, "nat1");
  assert.deepStrictEqual(log, [["plugin", { clientId: "123-abc.apps.googleusercontent.com" }], ["credential", { providerId: "google.com", idToken: "tok123" }]]);
});

test("Google on Android without the client id or plugin says it isn't set up", async () => {
  const { fb, auth } = fakeFb([]);
  for (const deps of [{ plugin: { signIn: () => Promise.resolve({ idToken: "t" }) }, clientId: "" }, { plugin: null, clientId: "x" }]) {
    await assert.rejects(C.signInWithGoogle({ fb, auth, native: true, ...deps }), e => e.code === "google/not-set-up");
  }
  assert.match(C.authMessage("google/not-set-up"), /Use your email/);
});

test("Google on Android: plugin errors keep their code, cancel is silent", async () => {
  const { fb, auth } = fakeFb([]);
  const rej = code => ({ signIn: () => Promise.reject(Object.assign(new Error("x"), { code })) });
  for (const [code, want] of [["cancelled", "google/cancelled"], ["no-account", "google/no-account"], ["16: developer error", "google/failed"]]) {
    await assert.rejects(C.signInWithGoogle({ fb, auth, native: true, plugin: rej(code), clientId: "id" }), e => e.code === want);
  }
  assert.strictEqual(C.cancelled("google/cancelled"), true);
  assert.strictEqual(C.cancelled("auth/popup-closed-by-user"), true);
  assert.strictEqual(C.cancelled("google/failed"), false);
  assert.match(C.authMessage("google/no-account"), /Google account/);
});

test("Google on the website: Firebase pop-up", async () => {
  const log = []; const { fb, auth } = fakeFb(log);
  const u = await C.signInWithGoogle({ fb, auth, native: false });
  assert.strictEqual(u.uid, "web1");
  assert.deepStrictEqual(log, [["params", { prompt: "select_account" }], ["popup", true]]);
});

test("the native plugin source is the one compiled into the Android app", () => {
  const fs = require("fs"), path = require("path");
  const root = path.join(__dirname, "../..");
  const src = fs.readFileSync(path.join(__dirname, "android/GoogleSignInPlugin.kt"), "utf8");
  assert.equal(fs.readFileSync(path.join(root, "android/app/src/main/java/com/azizfitness/app/GoogleSignInPlugin.kt"), "utf8"), src);
  assert.match(fs.readFileSync(path.join(root, "android/app/src/main/java/com/azizfitness/app/MainActivity.java"), "utf8"), /registerPlugin\(GoogleSignInPlugin\.class\)/);
  assert.match(src, new RegExp(`@CapacitorPlugin\\(name = "${C.GOOGLE_PLUGIN}"\\)`));
  assert.match(src, /@PluginMethod\s+fun signIn\(/);
  for (const code of ["cancelled", "no-account", "not-set-up"]) assert.ok(src.includes(`"${code}"`), code);
  const gradle = fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8");
  assert.match(gradle, /androidx\.credentials:credentials-play-services-auth/);
  assert.match(gradle, /com\.google\.android\.libraries\.identity\.googleid:googleid/);
});
