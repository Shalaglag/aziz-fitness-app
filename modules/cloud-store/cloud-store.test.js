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
