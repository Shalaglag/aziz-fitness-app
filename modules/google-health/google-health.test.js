// Run: node --test modules/google-health/google-health.test.js
// Simulated Google Health API only; real sync is verified on Aziz's phone.
const test = require("node:test");
const assert = require("node:assert/strict");
const GH = require("./google-health.js");

const NOW = new Date(2026, 10, 1, 13, 0, 0); // Nov 1 2026, local
const iso = (d, h, m = 0) => new Date(2026, 10, d, h, m).toISOString();
const dp = (id, ml, d, h = 0, extra = {}) => ({
  name: `users/123/dataTypes/hydration-log/dataPoints/${id}`,
  dataSource: { platform: "FITBIT", application: { packageName: "com.waterh" } },
  hydrationLog: Object.assign({ interval: { startTime: iso(d, h), endTime: iso(d, h), civilStartTime: `2026-11-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00` }, amountConsumed: { milliliters: ml, userProvidedUnit: "MILLILITER" } }, extra),
});

function fakeGoogle({ grant = true } = {}) {
  const G = { points: [], grant, calls: [], status: 200, authCalls: [], pageSize: 1000 };
  G.authorize = async ({ interactive }) => { G.authCalls.push(interactive); return G.grant ? { granted: true, token: "tok" } : { granted: false }; };
  G.get = async ({ path, query, token }) => {
    G.calls.push({ path, query, token });
    if (G.throwNet) throw new Error("network");
    if (G.status !== 200) return { status: G.status, body: G.errBody || "" };
    if (query.filter && G.rejectFilter) return { status: 400, body: '{"error":{"code":400,"message":"Invalid filter","status":"INVALID_ARGUMENT"}}' };
    const from = query.filter ? query.filter.match(/>= "([^"]+)"/)[1] : "";
    const pts = G.points.filter(p => p.hydrationLog.interval.civilStartTime >= from)
      .sort((a, b) => b.hydrationLog.interval.startTime.localeCompare(a.hydrationLog.interval.startTime));
    const start = query.pageToken ? +query.pageToken : 0, size = G.pageSize;
    const page = pts.slice(start, start + size);
    return { status: 200, body: JSON.stringify({ dataPoints: page, nextPageToken: start + size < pts.length ? String(start + size) : "" }) };
  };
  return G;
}
function app(plugin) {
  const days = {}, store = {}, puts = [];
  const getDay = d => Object.assign({ date: d, food: [], water: 0, supps: {} }, days[d]);
  const put = (c, id, data) => { puts.push(id); days[id] = data; };
  const storage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const sync = GH.create({ plugin, getDay, put, storage, now: () => NOW });
  return { sync, days, getDay, puts, storage, store };
}

test("parses Google Health hydration data points into records on the right local day", () => {
  const r = GH.parseDataPoints({ dataPoints: [dp("a", 194, 1), dp("b", 258.4, 1, 9)] });
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(x => [x.id, x.date, x.origin]), [["gh:a", "2026-11-01", "com.waterh"], ["gh:b", "2026-11-01", "com.waterh"]]);
  assert.equal(GH.offsetSec("10800s"), 10800); assert.equal(GH.offsetSec("-3600s"), -3600); assert.equal(GH.offsetSec("+03:00"), 10800);
  assert.equal(GH.civilDate({ date: { year: 2026, month: 11, day: 1 } }), "2026-11-01");
  assert.deepEqual(GH.parseDataPoints({ dataPoints: [{ name: "x/y", hydrationLog: {} }, { foo: 1 }] }), []);
});

test("connect + first sync imports Fitbit water into today's bottle total", async () => {
  const G = fakeGoogle(); G.points = [dp("a", 194, 1), dp("b", 258, 1)];
  const A = app(G);
  const r = await A.sync.connect();
  assert.equal(r.imported, 2);
  const day = A.getDay("2026-11-01");
  assert.equal(day.waterh.ml, 452);
  assert.equal(day.waterh.source, "google-health");
  assert.equal(G.authCalls[0], true, "connect shows Google's consent screen");
  assert.equal(A.sync.status().state, "ready");
  assert.match(A.sync.html(day), /Fitbit \/ Google Health connected · 2 water logs today \(0\.45 L\)/);
  assert.equal(G.calls[0].path, "v4/users/me/dataTypes/hydration-log/dataPoints");
  assert.match(G.calls[0].query.filter, /^hydration_log\.interval\.civil_start_time >= "\d{4}-\d\d-\d\d"$/);
});

test("re-syncing never doubles; edits and deletions in Fitbit are followed", async () => {
  const G = fakeGoogle(); G.points = [dp("a", 194, 1), dp("b", 258, 1)];
  const A = app(G);
  await A.sync.connect();
  let r = await A.sync.syncNow();
  assert.equal(r.imported, 0); assert.equal(A.getDay("2026-11-01").waterh.ml, 452);
  G.points = [dp("a", 300, 1), dp("c", 100, 1, 11)]; // a edited, b deleted, c new
  r = await A.sync.syncNow();
  assert.equal(r.imported, 1); assert.equal(r.removed, 1);
  assert.equal(A.getDay("2026-11-01").waterh.ml, 400);
  G.points = [];
  await A.sync.syncNow();
  assert.equal(A.getDay("2026-11-01").waterh, undefined);
});

test("manual taps, drinks and a pasted figure on a day without Fitbit logs are left alone", async () => {
  const G = fakeGoogle(); G.points = [dp("a", 500, 1)];
  const A = app(G);
  A.days["2026-11-01"] = { date: "2026-11-01", water: 750, food: [{ slot: "Drink", drink: { key: "gatorade", ml: 1000 }, eaten: true }], supps: {} };
  A.days["2026-10-30"] = { date: "2026-10-30", water: 0, food: [], supps: {}, waterh: { ml: 2350, at: "x", source: "shortcut" } };
  await A.sync.connect();
  const d = A.getDay("2026-11-01");
  assert.equal(d.water, 750); assert.equal(d.food.length, 1); assert.equal(d.waterh.ml, 500);
  assert.equal(A.getDay("2026-10-30").waterh.ml, 2350, "a day with no Fitbit logs keeps its pasted WaterH figure");
  assert.ok(!A.puts.includes("2026-10-30"));
});

test("first sync reads 14 days, later syncs 3; pages are followed; restart keeps state", async () => {
  const G = fakeGoogle(); G.pageSize = 2;
  G.points = [dp("a", 100, 1), dp("b", 100, 1, 2), dp("c", 100, 1, 3), dp("old", 200, 20 - 31 + 31, 0)];
  G.points[3].hydrationLog.interval = { startTime: new Date(2026, 9, 20, 8).toISOString(), endTime: new Date(2026, 9, 20, 8).toISOString(), civilStartTime: "2026-10-20T08:00:00" };
  const A = app(G);
  await A.sync.connect();
  assert.equal(A.getDay("2026-11-01").waterh.ml, 300);
  assert.equal(A.getDay("2026-10-20").waterh.ml, 200, "back-filled from 12 days ago");
  assert.ok(G.calls.length >= 2, "followed nextPageToken");
  const firstFrom = G.calls[0].query.filter.match(/"(.+)"/)[1];
  const B = GH.create({ plugin: G, getDay: A.getDay, put: (c, id, d) => { A.days[id] = d; }, storage: A.storage, now: () => NOW });
  assert.equal(B.status().state, "ready", "connection survives an app restart");
  G.calls = [];
  await B.syncNow();
  const nextFrom = G.calls[0].query.filter.match(/"(.+)"/)[1];
  assert.ok(nextFrom > firstFrom, "later syncs only look back 3 days");
  assert.equal(A.getDay("2026-10-20").waterh.ml, 200, "older days are not wiped by the short window");
});

test("errors: not granted, account not linked, API disabled, offline, expired token retry", async () => {
  const N = app(fakeGoogle({ grant: false }));
  const r0 = await N.sync.connect();
  assert.ok(r0.error); assert.equal(N.sync.status().state, "not-connected");
  assert.match(N.sync.html({}), /data-act="ghconnect"/);

  const G = fakeGoogle(); G.points = [dp("a", 100, 1)];
  const A = app(G);
  await A.sync.connect();
  G.status = 400; G.errBody = '{"error":{"status":"FAILED_PRECONDITION","details":[{"reason":"ACCOUNT_NOT_LINKED"}]}}';
  await A.sync.syncNow();
  assert.match(A.sync.status().lastError, /isn't linked to Google Health/);
  G.status = 403; G.errBody = "SERVICE_DISABLED";
  await A.sync.syncNow();
  assert.match(A.sync.status().lastError, /isn't switched on/);
  G.status = 200; G.throwNet = true;
  const r = await A.sync.syncNow();
  assert.match(r.error, /No internet/);
  G.throwNet = false;
  await A.sync.syncNow();
  assert.equal(A.sync.status().state, "ready");
  assert.equal(A.getDay("2026-11-01").waterh.ml, 100, "nothing lost or doubled across failures");

  // 401 → one silent re-authorize, then success
  let first = true; const real = G.get;
  G.get = async (q) => { if (first) { first = false; return { status: 401, body: "" }; } return real(q); };
  const before = G.authCalls.length;
  const r2 = await A.sync.syncNow();
  assert.ok(!r2.error);
  assert.ok(G.authCalls.slice(before).every(x => x === false), "auto retry never pops UI");
});

test("autoSync is throttled, silent, and does nothing until connected; disconnect keeps logged data", async () => {
  const G = fakeGoogle(); G.points = [dp("a", 100, 1)];
  const A = app(G);
  assert.equal((await A.sync.autoSync()).skipped, true);
  await A.sync.connect();
  G.calls = [];
  await A.sync.autoSync(); await A.sync.autoSync();
  assert.equal(G.calls.length, 1);
  A.sync.disconnect();
  assert.equal(A.sync.status().state, "not-connected");
  assert.equal(A.getDay("2026-11-01").waterh.ml, 100);
});

test("no plugin (web / PC): renders nothing and never throws", async () => {
  const W = app(null);
  assert.equal(W.sync.html({}), "");
  assert.equal(W.sync.guideHTML(), "");
  assert.equal((await W.sync.syncNow()).error, "no-plugin");
});

test("the compiled Android plugin matches the module copy and is registered", () => {
  const fs = require("fs"), path = require("path");
  const root = path.resolve(__dirname, "../..");
  const src = fs.readFileSync(path.join(__dirname, "android/GoogleHealthPlugin.kt"), "utf8");
  assert.equal(fs.readFileSync(path.join(root, "android/app/src/main/java/com/azizfitness/app/GoogleHealthPlugin.kt"), "utf8"), src);
  assert.match(fs.readFileSync(path.join(root, "android/app/src/main/java/com/azizfitness/app/MainActivity.java"), "utf8"), /registerPlugin\(GoogleHealthPlugin\.class\)/);
  for (const m of ["authorize", "get"]) assert.match(src, new RegExp(`@PluginMethod\\s+fun ${m}\\(`));
  assert.ok(src.includes(GH.SCOPE));
  assert.match(src, /https:\/\/health\.googleapis\.com\//);
});

test("a rejected filter (400) falls back to an unfiltered newest-first read and shows Google's message", async () => {
  const G = fakeGoogle(); G.rejectFilter = true; G.pageSize = 2;
  G.points = [dp("a", 150, 1, 8), dp("b", 250, 1, 9), dp("c", 300, 31 - 31 + 25, 10)];
  G.points[2].hydrationLog.interval = { startTime: new Date(2026, 9, 1, 10).toISOString(), endTime: new Date(2026, 9, 1, 10).toISOString(), civilStartTime: "2026-10-01T10:00:00" };
  const A = app(G);
  await A.sync.connect();
  assert.equal(A.getDay("2026-11-01").waterh.ml, 400);
  assert.equal(A.getDay("2026-10-01").waterh, undefined, "outside the window");
  assert.equal(A.sync.status().lastError || null, null);
  G.calls = [];
  await A.sync.syncNow();
  assert.ok(G.calls.every(c => !c.query.filter), "remembers to skip the filter");
  assert.match(GH.errorText(500, '{"error":{"code":500,"message":"Backend broke","status":"INTERNAL"}}'), /error 500: Backend broke/);
});
