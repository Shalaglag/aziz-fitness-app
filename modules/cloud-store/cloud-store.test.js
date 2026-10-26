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
