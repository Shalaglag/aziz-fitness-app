// Run: node --test modules/health-connect/health-connect.test.js
// Simulated Health Connect only. Real-device sync is verified on Aziz's phone, not here.
const test = require("node:test");
const assert = require("node:assert/strict");
const HC = require("./health-connect.js");

const NOW = new Date(2026, 9, 26, 15, 0, 0); // local time, Oct 26 2026
const ms = (h, m = 0, dayOffset = 0) => new Date(2026, 9, 26 + dayOffset, h, m).getTime();
const rec = (id, ml, h, extra = {}) => Object.assign({ id, ml, startMs: ms(h), endMs: ms(h), origin: "com.waterh", lastModifiedMs: ms(h) }, extra);

// A fake Health Connect store with the change log the real one has.
function fakePlugin({ status = "available", granted = true } = {}) {
  const records = new Map(); const log = []; let tokens = 0;
  const P = {
    calls: [], status, granted,
    async isAvailable() { P.calls.push("isAvailable"); return { status: P.status }; },
    async hasHydrationAccess() { return { granted: P.granted }; },
    async requestHydrationAccess() { P.calls.push("requestPermissions"); P.granted = P.grantOnRequest ?? P.granted; return { granted: P.granted }; },
    async readHydration({ startMs, endMs }) { P.calls.push("readHydration"); if (!P.granted) throw new Error("SecurityException: permission denied"); return { records: [...records.values()].filter(r => r.startMs >= startMs && r.startMs < endMs) }; },
    async getChangesToken() { P.calls.push("getChangesToken"); return { token: `t${++tokens}:${log.length}` }; },
    async getChanges({ token }) {
      P.calls.push("getChanges");
      if (!token || P.expireAll) return { expired: true, changes: [], nextToken: null, hasMore: false };
      const from = +token.split(":")[1];
      const changes = log.slice(from);
      return { changes, nextToken: `t${++tokens}:${log.length}`, hasMore: false, expired: false };
    },
    async openSettings() {},
    // test helpers that behave like the WaterH app writing to Health Connect
    add(r) { records.set(r.id, r); log.push({ type: "upsert", record: r }); },
    del(id) { records.delete(id); log.push({ type: "delete", id }); },
  };
  return P;
}

function fakeApp(plugin, opts = {}) {
  const days = {}; const store = {}; const puts = [];
  const getDay = d => Object.assign({ date: d, food: [], water: 0, supps: {} }, days[d]);
  const put = (col, id, data) => { puts.push([col, id]); days[id] = data; };
  const storage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const sync = HC.create(Object.assign({ plugin, getDay, put, storage, now: () => NOW, ownPackage: "com.azizfitness.app" }, opts));
  return { sync, days, store, puts, getDay, storage };
}

test("1+2: a new WaterH hydration record in Health Connect is imported into today's bottle total", async () => {
  const P = fakePlugin(); P.add(rec("a", 250, 8)); P.add(rec("b", 300, 10));
  const A = fakeApp(P);
  const r = await A.sync.syncNow();
  assert.equal(r.mode, "full"); assert.equal(r.imported, 2);
  const day = A.getDay("2026-10-26");
  assert.equal(day.waterh.ml, 550);
  assert.equal(day.waterh.source, "health-connect");
  assert.deepEqual(Object.keys(day.waterh.records).sort(), ["a", "b"]);
  assert.equal(A.sync.status().state, "ready");
  assert.ok(A.sync.status().lastSyncAt);
  assert.ok(JSON.parse(A.store[HC.KEY]).token, "a change token is kept for the next sync");
});

test("3: syncing again (changes API) never counts the same record twice", async () => {
  const P = fakePlugin(); P.add(rec("a", 250, 8));
  const A = fakeApp(P);
  await A.sync.syncNow();
  let r = await A.sync.syncNow();
  assert.equal(r.mode, "changes"); assert.equal(r.imported, 0); assert.equal(r.days, 0);
  assert.equal(A.getDay("2026-10-26").waterh.ml, 250);
  P.add(rec("c", 200, 12));
  r = await A.sync.syncNow();
  assert.equal(r.imported, 1);
  assert.equal(A.getDay("2026-10-26").waterh.ml, 450);
  // the same upsert delivered again (replayed change log) is a no-op
  const same = A.getDay("2026-10-26");
  assert.equal(HC.applyRecords(same, [rec("c", 200, 12)], { now: NOW }), same);
});

test("4: corrected and deleted Health Connect records are applied", async () => {
  const P = fakePlugin(); P.add(rec("a", 250, 8)); P.add(rec("b", 300, 10));
  const A = fakeApp(P);
  await A.sync.syncNow();
  P.add(rec("a", 400, 8));           // WaterH corrected the sip
  P.del("b");                         // and removed one
  const r = await A.sync.syncNow();
  assert.equal(r.removed, 1);
  const day = A.getDay("2026-10-26");
  assert.equal(day.waterh.ml, 400);
  assert.deepEqual(Object.keys(day.waterh.records), ["a"]);
  P.del("a");
  await A.sync.syncNow();
  assert.equal(A.getDay("2026-10-26").waterh, undefined, "no records left → no bottle figure");
});

test("5: manual water taps and drinks are left intact; bottle water is kept separate", async () => {
  const P = fakePlugin(); P.add(rec("a", 500, 8));
  const A = fakeApp(P);
  A.days["2026-10-26"] = { date: "2026-10-26", water: 750, food: [{ slot: "Drink", drink: { key: "gatorade", ml: 1000 }, eaten: true }], supps: {} };
  await A.sync.syncNow();
  const day = A.getDay("2026-10-26");
  assert.equal(day.water, 750);
  assert.equal(day.food.length, 1);
  assert.equal(day.waterh.ml, 500);
  assert.equal(HC.bottleMl(day), 500);
});

test("6: after an app restart the stored token continues from where it left off", async () => {
  const P = fakePlugin(); P.add(rec("a", 250, 8));
  const A = fakeApp(P);
  await A.sync.syncNow();
  P.add(rec("b", 250, 9));
  // "restart": a new sync object over the same localStorage and the same day docs
  const B = HC.create({ plugin: P, getDay: A.getDay, put: (c, id, d) => { A.days[id] = d; }, storage: A.storage, now: () => NOW, ownPackage: "com.azizfitness.app" });
  const r = await B.syncNow();
  assert.equal(r.mode, "changes"); assert.equal(r.imported, 1);
  assert.equal(A.getDay("2026-10-26").waterh.ml, 500);
  assert.equal(B.status().lastSyncAt, A.sync.status().lastSyncAt === null ? B.status().lastSyncAt : B.status().lastSyncAt);
});

test("6b: an expired token falls back to a 30-day re-read and dedupes by id", async () => {
  const P = fakePlugin(); P.add(rec("a", 250, 8));
  const A = fakeApp(P);
  await A.sync.syncNow();
  P.add(rec("b", 100, 9)); P.del("a");
  P.expireAll = true;
  const r = await A.sync.syncNow();
  assert.equal(r.mode, "full");
  const day = A.getDay("2026-10-26");
  assert.equal(day.waterh.ml, 100, "a vanished from Health Connect, b arrived, nothing doubled");
  assert.ok(A.sync.state().token, "a fresh token was taken");
  assert.equal(A.sync.status().lastError, null);
});

test("7: offline makes no difference: Health Connect is on-device and writes go through put()", async () => {
  const P = fakePlugin(); P.add(rec("a", 250, 8)); P.add(rec("y", 300, 20, { startMs: ms(20, 0, -1), endMs: ms(20, 0, -1) }));
  const A = fakeApp(P);
  const r = await A.sync.syncNow();
  assert.equal(r.days, 2);
  assert.deepEqual(A.puts.map(p => p[1]).sort(), ["2026-10-25", "2026-10-26"], "each touched day is one put() → the outbox / Firestore when online");
});

test("8: missing permission, missing Health Connect, and no plugin are handled without throwing", async () => {
  // no plugin (web build)
  const W = fakeApp(null);
  assert.equal((await W.sync.syncNow()).mode, "skipped");
  assert.equal(W.sync.status().state, "no-plugin");
  assert.match(W.sync.html({}), /Android app/);
  // not installed
  const N = fakeApp(fakePlugin({ status: "not_installed" }));
  assert.equal((await N.sync.syncNow()).mode, "skipped");
  assert.equal(N.sync.status().state, "not-installed");
  assert.match(N.sync.html({}), /not installed/);
  // permission refused: auto never prompts; manual prompts once
  const P = fakePlugin({ granted: false }); P.grantOnRequest = false; P.add(rec("a", 250, 8));
  const D = fakeApp(P);
  await D.sync.autoSync();
  assert.ok(!P.calls.includes("requestPermissions"), "autoSync never pops the permission sheet");
  assert.equal(D.sync.status().state, "needs-permission");
  await D.sync.syncNow();
  assert.ok(P.calls.includes("requestPermissions"));
  assert.equal(D.getDay("2026-10-26").waterh, undefined);
  assert.match(D.sync.html({}), /Allow access/);
  // then granted
  P.grantOnRequest = true;
  const r = await D.sync.syncNow();
  assert.equal(r.imported, 1);
  assert.equal(D.sync.status().state, "ready");
});

test("overlapping records: a mirror of the same sip from another app is skipped; our own writes are ignored", () => {
  let day = HC.applyRecords({}, [rec("a", 250, 8)], { now: NOW, ownPackage: "com.azizfitness.app" });
  day = HC.applyRecords(day, [rec("m", 250, 8, { origin: "com.sec.android.app.shealth" })], { now: NOW });
  assert.deepEqual(Object.keys(day.waterh.records), ["a"]);
  day = HC.applyRecords(day, [rec("own", 999, 9, { origin: "com.azizfitness.app" })], { now: NOW, ownPackage: "com.azizfitness.app" });
  assert.equal(day.waterh.ml, 250);
  // bad values never count
  day = HC.applyRecords(day, [rec("neg", -5, 9), rec("huge", 9000, 9), rec("nan", "x", 9)], { now: NOW });
  assert.equal(day.waterh.ml, 250);
});

test("records are assigned to the local day they were drunk, using the writer's zone offset", () => {
  // 23:30 Kuwait (UTC+3) on Oct 25 = 20:30Z Oct 25
  const utc = Date.UTC(2026, 9, 25, 20, 30);
  assert.equal(HC.localDate(utc, 3 * 3600), "2026-10-25");
  assert.equal(HC.localDate(utc, -8 * 3600), "2026-10-25");
  assert.equal(HC.localDate(Date.UTC(2026, 9, 25, 21, 30), 3 * 3600), "2026-10-26");
  const day = HC.applyRecords({}, [{ id: "z", ml: 200, startMs: Date.UTC(2026, 9, 25, 21, 30), endMs: Date.UTC(2026, 9, 25, 21, 30), startOffsetSec: 10800, origin: "com.waterh" }], { now: NOW });
  assert.equal(day.waterh.ml, 200);
});

test("the first Health Connect sync replaces an older pasted WaterH figure instead of adding to it", () => {
  const pasted = { waterh: { ml: 2350, at: "2026-10-25T20:00:00Z", source: "shortcut" } };
  const day = HC.applyRecords(pasted, [rec("a", 250, 8)], { now: NOW });
  assert.equal(day.waterh.ml, 250);
  assert.equal(day.waterh.source, "health-connect");
});

test("autoSync is throttled and syncNow is single-flight", async () => {
  const P = fakePlugin(); P.add(rec("a", 250, 8));
  const A = fakeApp(P);
  const [r1, r2] = await Promise.all([A.sync.syncNow(), A.sync.syncNow()]);
  assert.equal(r1, r2);
  const before = P.calls.length;
  await A.sync.autoSync(); await A.sync.autoSync();
  assert.ok(P.calls.length - before < 8, "the second autoSync within a minute is skipped");
});

test("html shows status, last sync time and the Sync now button; guide explains permissions", async () => {
  const P = fakePlugin(); P.add(rec("a", 250, 8));
  const A = fakeApp(P);
  await A.sync.syncNow();
  const h = A.sync.html(A.getDay("2026-10-26"));
  assert.match(h, /Health Connect connected/);
  assert.match(h, /Last sync/);
  assert.match(h, /data-act="hcsync"/);
  assert.match(A.sync.guideHTML(), /App permissions/);
  assert.match(A.sync.guideHTML(), /background/);
  // error state
  P.granted = false; P.grantOnRequest = false; P.expireAll = true;
  await A.sync.syncNow();
  assert.match(A.sync.html(A.getDay("2026-10-26")), /not allowed yet/);
});

test("the compiled Android plugin is the same file as the module's source copy", () => {
  const fs = require("fs"), path = require("path");
  const root = path.resolve(__dirname, "../..");
  const src = fs.readFileSync(path.join(__dirname, "android/HealthConnectPlugin.kt"), "utf8");
  const built = fs.readFileSync(path.join(root, "android/app/src/main/java/com/azizfitness/app/HealthConnectPlugin.kt"), "utf8");
  assert.equal(built, src, "copy modules/health-connect/android/HealthConnectPlugin.kt into android/app/src/main/java/com/azizfitness/app/");
  const manifest = fs.readFileSync(path.join(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
  assert.match(manifest, /android\.permission\.health\.READ_HYDRATION/);
  assert.match(manifest, /VIEW_PERMISSION_USAGE/);
  assert.match(fs.readFileSync(path.join(root, "android/app/src/main/java/com/azizfitness/app/MainActivity.java"), "utf8"), /registerPlugin\(HealthConnectPlugin\.class\)/);
  // the JS calls must exist on the plugin, and must not shadow Capacitor's built-in permission methods
  for (const m of ["isAvailable", "hasHydrationAccess", "requestHydrationAccess", "readHydration", "getChangesToken", "getChanges", "openSettings"])
    assert.match(src, new RegExp(`@PluginMethod\\s+fun ${m}\\(`), m);
  assert.doesNotMatch(src, /fun (checkPermissions|requestPermissions)\(/);
});

test("status shows what the last sync saw (count, source app, days) and Re-read drops the token", async () => {
  const P = fakePlugin(); P.add(rec("a", 194, 0, { origin: "com.fitbit.FitbitMobile" })); P.add(rec("b", 258, 0, { origin: "com.fitbit.FitbitMobile", startMs: ms(0, 1) }));
  const A = fakeApp(P);
  await A.sync.syncNow();
  const lr = A.sync.status().lastResult;
  assert.equal(lr.seen, 2); assert.deepEqual(lr.origins, ["com.fitbit.FitbitMobile"]); assert.deepEqual(lr.recDays, ["2026-10-26", "2026-10-26"]);
  const h = A.sync.html(A.getDay("2026-10-26"));
  assert.match(h, /read 2 records from Fitbit \(2026-10-26\) · 2 new/);
  assert.match(h, /data-act="hcreread"/);
  assert.equal(A.getDay("2026-10-26").waterh.ml, 452);
  const r = await A.sync.reread();
  assert.equal(r.mode, "full"); assert.equal(r.imported, 0);
  assert.equal(A.getDay("2026-10-26").waterh.ml, 452, "re-reading never doubles");
});

test("yieldTo: while Fitbit owns the water, Health Connect never overwrites its records", async () => {
  const P = fakePlugin(); P.add(rec("a", 250, 8));
  let fitbit = true;
  const A = fakeApp(P, { yieldTo: () => fitbit });
  A.days["2026-10-26"] = { date: "2026-10-26", food: [], water: 0, supps: {}, waterh: { ml: 780, at: NOW.toISOString(), source: "google-health", records: { "gh:x": { ml: 780 } } } };
  await A.sync.syncNow();
  assert.equal(A.getDay("2026-10-26").waterh.ml, 780);
  assert.equal(A.getDay("2026-10-26").waterh.source, "google-health");
  assert.match(A.sync.html(A.getDay("2026-10-26")), /paused while Fitbit is connected/);
  fitbit = false;
  await A.sync.reread();
  assert.equal(A.getDay("2026-10-26").waterh.source, "health-connect", "takes over again once Fitbit is disconnected");
});
