// Run: node --test modules/steps/health-connect-steps.test.js
// Simulated Health Connect only. Real-device sync is verified on Aziz's phone, not here.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const HCS = require("./health-connect-steps.js");

const NOW = new Date(2026, 10, 1, 15, 0, 0); // local time, Nov 1 2026
const TODAY = "2026-11-01";

function fakePlugin({ status = "available", granted = true, days = {} } = {}) {
  const P = {
    calls: [], status, granted, days, zone: "Asia/Kuwait",
    async isAvailable() { P.calls.push("isAvailable"); return { status: P.status }; },
    async hasStepsAccess() { P.calls.push("hasStepsAccess"); return { granted: P.granted }; },
    async requestStepsAccess() { P.calls.push("requestStepsAccess"); P.granted = P.grantOnRequest ?? P.granted; return { granted: P.granted }; },
    async readDailySteps({ startMs, endMs }) {
      P.calls.push("readDailySteps"); P.lastRange = { startMs, endMs };
      if (!P.granted) throw new Error("SecurityException: permission denied");
      return { zone: P.zone, days: Object.entries(P.days).map(([date, v]) => ({ date, steps: v.steps, origins: v.origins || ["com.sec.android.app.shealth"] })) };
    },
    async openSettings() { P.calls.push("openSettings"); },
  };
  return P;
}

function fakeApp(plugin, opts = {}) {
  const days = {}; const store = {}; const puts = [];
  const getDay = d => Object.assign({ date: d, food: [], water: 0 }, days[d]);
  const put = (col, id, data, o) => { puts.push([col, id, o]); days[id] = data; };
  const storage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const sync = HCS.create(Object.assign({ plugin, getDay, put, storage, now: () => NOW }, opts));
  return { sync, days, store, puts, getDay };
}

test("today's total from Health Connect lands in days/{date}.steps with source health-connect", async () => {
  const P = fakePlugin({ days: { [TODAY]: { steps: 6420 }, "2026-10-31": { steps: 10210 } } });
  const A = fakeApp(P);
  const r = await A.sync.syncNow();
  assert.equal(r.mode, "read"); assert.equal(r.changed, 2); assert.equal(r.today, 6420);
  assert.deepEqual(A.getDay(TODAY).steps, { count: 6420, at: NOW.toISOString(), source: "health-connect", origins: ["com.sec.android.app.shealth"] });
  assert.equal(A.getDay("2026-10-31").steps.count, 10210);
  assert.equal(A.sync.status().state, "ready");
  assert.ok(JSON.parse(A.store[HCS.KEY]).lastSyncAt);
  assert.ok(A.puts.every(p => p[2] && p[2].quiet), "puts are quiet so the shell renders once");
});

test("reads the last 7 local days, not more", async () => {
  const P = fakePlugin({ days: {} });
  const A = fakeApp(P);
  await A.sync.syncNow();
  assert.equal(new Date(P.lastRange.startMs).getDate(), 26); // Oct 26 .. Nov 1 = 7 days
  assert.equal(P.lastRange.endMs, NOW.getTime());
});

test("syncing again replaces the day instead of adding (no double count)", async () => {
  const P = fakePlugin({ days: { [TODAY]: { steps: 6420 } } });
  const A = fakeApp(P);
  await A.sync.syncNow();
  const r2 = await A.sync.syncNow();
  assert.equal(r2.changed, 0, "same figure: no write");
  assert.equal(A.getDay(TODAY).steps.count, 6420);
  P.days[TODAY].steps = 7100;
  const r3 = await A.sync.syncNow();
  assert.equal(r3.changed, 1); assert.equal(A.getDay(TODAY).steps.count, 7100);
});

test("the aggregate is one figure per day even with several sources (phone + watch are not summed here)", async () => {
  const P = fakePlugin({ days: { [TODAY]: { steps: 8000, origins: ["com.sec.android.app.shealth", "com.samsung.android.wear.shealth"] } } });
  const A = fakeApp(P);
  const r = await A.sync.syncNow();
  assert.equal(A.getDay(TODAY).steps.count, 8000);
  assert.deepEqual(r.origins, ["com.sec.android.app.shealth", "com.samsung.android.wear.shealth"]);
  assert.match(A.sync.html(A.getDay(TODAY)), /Samsung Health, Galaxy Watch/);
});

test("a hand-typed day is kept when Health Connect has nothing for it, replaced when it has a count", () => {
  const manual = { date: TODAY, steps: { count: 5000, at: "x", source: "manual" } };
  assert.equal(HCS.applyDaily(manual, { date: TODAY, steps: 0 }), manual, "zero from HC: untouched");
  const after = HCS.applyDaily(manual, { date: TODAY, steps: 6000 }, NOW);
  assert.equal(after.steps.count, 6000); assert.equal(after.steps.source, "health-connect");
  const bare = { date: TODAY, steps: 4200 };
  assert.equal(HCS.applyDaily(bare, { date: TODAY, steps: 0 }), bare);
  // a day that came from Health Connect follows it back to 0 (record deleted)
  const hc = { date: TODAY, steps: { count: 900, at: "x", source: "health-connect" } };
  assert.equal(HCS.applyDaily(hc, { date: TODAY, steps: 0 }, NOW).steps.count, 0);
});

test("future dates and malformed rows are ignored", async () => {
  const P = fakePlugin({ days: { "2026-11-02": { steps: 100 }, "bad": { steps: 5 }, [TODAY]: { steps: 10 } } });
  const A = fakeApp(P);
  const r = await A.sync.syncNow();
  assert.equal(r.seen, 1); assert.equal(r.changed, 1);
});

test("no permission: autoSync never prompts, syncNow (button) does and then reads", async () => {
  const P = fakePlugin({ granted: false, days: { [TODAY]: { steps: 1234 } } });
  const A = fakeApp(P);
  const a = await A.sync.autoSync();
  assert.equal(a.error, "needs-permission");
  assert.ok(!P.calls.includes("requestStepsAccess"));
  assert.equal(A.sync.status().state, "needs-permission");
  assert.match(A.sync.html(A.getDay(TODAY)), /Allow access/);
  P.grantOnRequest = true;
  const m = await A.sync.syncNow();
  assert.ok(P.calls.includes("requestStepsAccess"));
  assert.equal(m.today, 1234);
});

test("autoSync is throttled to once a minute; syncNow is not", async () => {
  const P = fakePlugin({ days: { [TODAY]: { steps: 10 } } });
  const A = fakeApp(P);
  await A.sync.autoSync();
  const r = await A.sync.autoSync();
  assert.equal(r.error, "throttled");
  assert.equal(P.calls.filter(c => c === "readDailySteps").length, 1);
  await A.sync.syncNow();
  assert.equal(P.calls.filter(c => c === "readDailySteps").length, 2);
});

test("Health Connect missing or unsupported: clear state and no reads", async () => {
  for (const [status, state] of [["not_installed", "not-installed"], ["not_supported", "not-supported"]]) {
    const P = fakePlugin({ status });
    const A = fakeApp(P);
    const r = await A.sync.syncNow();
    assert.equal(r.mode, "skipped");
    assert.equal(A.sync.status().state, state);
    assert.ok(!P.calls.includes("readDailySteps"));
  }
});

test("a read error is shown and recovers on the next sync", async () => {
  const P = fakePlugin({ days: { [TODAY]: { steps: 300 } } });
  const A = fakeApp(P);
  P.readDailySteps = async () => { throw new Error("boom"); };
  const r = await A.sync.syncNow();
  assert.equal(r.error, "boom");
  assert.equal(A.sync.status().state, "error");
  assert.match(A.sync.html(A.getDay(TODAY)), /boom/);
  delete P.readDailySteps; // back to the prototype-less fake: re-create the method
  P.readDailySteps = fakePlugin({ days: P.days }).readDailySteps;
  const r2 = await A.sync.syncNow();
  assert.equal(r2.today, 300); assert.equal(A.sync.status().state, "ready");
});

test("without the plugin (web, PC) everything is a no-op and the card block is empty", async () => {
  const A = fakeApp(null);
  assert.equal(A.sync.available(), false);
  assert.equal((await A.sync.syncNow()).error, "no-plugin");
  assert.equal(await A.sync.requestAccess(), false);
  assert.equal(A.sync.html(A.getDay(TODAY)), "");
  assert.match(A.sync.guideHTML(), /Samsung Health/);
});

test("the Kotlin plugin exposes the steps methods and the manifest asks for READ_STEPS", () => {
  const root = path.join(__dirname, "..", "..");
  const kt = fs.readFileSync(path.join(root, "modules/health-connect/android/HealthConnectPlugin.kt"), "utf8");
  for (const m of ["fun hasStepsAccess", "fun requestStepsAccess", "fun readDailySteps", "StepsRecord.COUNT_TOTAL", "AggregateGroupByPeriodRequest"]) assert.ok(kt.includes(m), m);
  const manifest = fs.readFileSync(path.join(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
  assert.ok(manifest.includes("android.permission.health.READ_STEPS"));
  assert.ok(manifest.includes("android.permission.health.READ_HYDRATION"), "hydration permission kept");
});
